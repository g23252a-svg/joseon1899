// 배: 나룻배(rowboat)·황포돛배(sailboat)·증기선(steamer). 노·돛·물살·침몰, 나루 운행, 증기선 항로 (스펙 C.1·C.5·C.8·B.5)
import { Vehicle } from './vehicle.js';
import { PAL } from '../engine/palette.js';
import { canStand, moveCircle } from '../engine/physics.js';
import { angleWrap, approach, clamp, damp, lerp, pointAtDistance, rand } from '../engine/util.js';
import { Bag, SHADOW, ask, clearSpread, crashDamage, crime, dayNum, drawDummies, flagOn, hourNow, hullPath, isNightHire, lockRider, makeCrew, pay, seatInteractions, setSpread, terrainMul, vehicleHit, wantedLevel } from './common.js';

const P = (x, y, role = 'passenger', pose = 'sit') => ({ x, y, role, pose });
const ROW = [P(-3.3, 0, 'driver', 'row')];
for (const x of [1.8, 0.6, -0.6, -1.8]) for (const y of [-0.55, 0.55]) ROW.push(P(x, y));
const STEAM = [P(-2, 0, 'driver', 'stand'), P(-7, -1.3, 'crew', 'stand'), P(-7, 1.3, 'crew', 'stand'), P(6.5, 0, 'crew', 'stand')];
for (const x of [-5, -3.5, 0.5, 2, 3.5, 5]) for (const y of [-1.45, 1.45]) STEAM.push(P(x, y));
const SPEC = {
  rowboat: { name: '나룻배', L: 8, W: 2.4, r: 1.1, max: 1.8, sprint: 2.4, rev: 0.6, acc: 0.5, dec: 0.35, brake: 0.9, turn: 0.55, ref: 0.6, tip: 0.4, grip: 1.5, hp: 150, mass: 600, zoom: 0.9, bag: 6, seats: ROW, lock: 0.7 },
  sailboat: { name: '황포돛배', L: 9, W: 2.4, r: 1.2, max: 4.5, sprint: 4.5, rev: 0.4, acc: 0.25, dec: 0.2, brake: 0.5, turn: 0.45, ref: 1.2, tip: 0.1, grip: 1, hp: 300, mass: 2500, zoom: 0.75, bag: 30, lock: 1,
    seats: [P(-3.8, 0, 'driver', 'stand'), P(-2.2, 0.6, 'crew', 'row'), P(-0.8, -0.6), P(-0.8, 0.6), P(0.6, 0)] },
  steamer: { name: '증기선', L: 20, W: 4.2, r: 2, max: 4.6, sprint: 4.6, rev: 1, acc: 0.15, dec: 0.12, brake: 0.3, turn: 0.15, ref: 2, tip: 0.05, grip: 0.8, hp: 1500, mass: 30000, zoom: 0.6, bag: 0, seats: STEAM, lock: 1 },
};
const EFF = [[0, 0.55], [30, 0.75], [60, 0.9], [90, 0.8], [110, 0.45], [120, 0]];
/** 돛 효율 f(α), α 는 도(°) (C.5) */
export function sailEff(deg) {
  for (let i = 1; i < EFF.length; i++) if (deg <= EFF[i][0]) return EFF[i - 1][1] + ((EFF[i][1] - EFF[i - 1][1]) * (deg - EFF[i - 1][0])) / (EFF[i][0] - EFF[i - 1][0]);
  return 0;
}
const RUMORS = ['전기거가 비를 막는다는 소문이 돕디다.', '제물포까지 쇠길을 놓는다지요. 배 장사도 끝이오.', '염창 갈대밭엔 요즘 수적이 숨는다오.'];

export class Boat extends Vehicle {
  constructor(vtype, opts = {}) {
    const S = SPEC[vtype] || SPEC.rowboat, st = vtype === 'steamer';
    super({
      displayName: opts.name || S.name, moveMode: 'boat', length: S.L, width: S.W, radius: S.r, maxSpeed: S.max, sprintSpeed: S.sprint, reverseSpeed: S.rev,
      accel: S.acc, decel: S.dec, brakeDecel: S.brake, turnRate: S.turn, turnRefSpeed: S.ref, turnInPlace: S.tip, grip: S.grip, hp: S.hp, mass: S.mass, cameraZoom: S.zoom, seats: S.seats,
      hitCircles: st ? [-8, -4, 0, 4, 8].map((x) => ({ x, y: 0, r: 2.1 })) : [-S.L / 3, 0, S.L / 3].map((x) => ({ x, y: 0, r: S.W / 2 })),
      trampleThreshold: 1.5, trampleMul: 0.8, stealable: !st, playerCanDrive: !st, ...opts, vtype: SPEC[vtype] ? vtype : 'rowboat',
    });
    this.S = S;
    this.sail = this.oar = this.sinkT = this.lockT = this.spaceT = this.crowd = 0;
    this.tipMul = 1;
    this.anchor = false;
    this.initBag(S.bag, vtype === 'rowboat' ? 1 : 4, 4);
  }

  update(dt, game) {
    this.lockT -= dt;
    if (this.sinkT > 0) return void ((this.sinkT -= dt) <= 0 && game.remove(this));
    if (this.follow) this.placeOccupants(); // 증기선: 항로는 SteamerService 가 정한다
    else super.update(dt, game);
    for (const s of this.seats) {
      const o = s.occupant;
      if (!o || o.tags?.has('crew')) continue;
      const rower = s.role === 'driver' && this.vtype === 'rowboat';
      setSpread(o, rower ? 0 : 2, false, rower && this.oar > 0);
      o.mountedOnly = s.role === 'driver' && this.vtype === 'sailboat' ? 'pistol' : null; // 돛배 키잡이는 육혈포만
    }
  }

  physics(dt, game) {
    const c = this.ctl, w = game.world, drv = this.driver;
    let target = 0;
    this.leeway = null;
    if (this.vtype === 'sailboat') {
      const wind = game.sys.time?.wind || w?.wind || { angle: 0, strength: 0 }, W = wind.strength * 12;
      this.windSpeed = W;
      this.sailEff = sailEff((Math.abs(angleWrap(this.angle - wind.angle)) * 180) / Math.PI);
      const sailV = Math.min(4.5, W * 0.8 * this.sailEff * this.sail);
      const crew = this.seats[1].occupant, shallow = w?.terrainAt?.(this.x, this.y) === w?.T?.SHALLOW;
      const oarV = shallow ? 1.3 : crew ? (c.throttle > 0.5 ? 1.2 : 0.9) : c.throttle > 0.5 ? 0.6 : 0;
      target = this.anchor || !drv ? 0 : Math.max(sailV, oarV); // 돛과 노는 더하지 않고 큰 값
      this.leeway = { x: Math.cos(wind.angle) * W * 0.03 * this.sail, y: Math.sin(wind.angle) * W * 0.03 * this.sail };
    } else if (this.vtype === 'rowboat') {
      const rowing = drv && !drv.aiming && drv.state === 'normal' && !c.brake && Math.abs(c.throttle) > 0.05;
      const top = drv && !drv.isPlayer ? 1.7 * this.tipMul : c.sprint && drv?.stamina > 1 ? this.sprintSpeed : this.maxSpeed;
      target = rowing ? (c.throttle > 0 ? c.throttle * top : c.throttle * this.reverseSpeed) : 0;
      if (rowing && drv.isPlayer) drv.stamina = Math.max(0, drv.stamina - ((c.sprint ? 6 : 0.8) + 8) * dt); // 탄 동안 코어가 +8 회복하므로 상쇄
      this.oar = rowing ? 1 : 0;
    }
    target *= terrainMul(this, game);
    const rate = c.brake && this.vtype === 'rowboat' ? this.brakeDecel : Math.abs(target) > Math.abs(this.speed) ? this.accel : this.decel;
    this.speed = approach(this.speed, target, rate * dt);
    const tf = clamp(Math.abs(this.speed) / this.turnRefSpeed, this.vtype === 'sailboat' ? 0.35 : this.turnInPlace, 1);
    this.angle += c.steer * this.turnRate * tf * dt * (this.speed < -0.05 ? -1 : 1);
    // 땅에 대한 속도 = 물에 대한 속도 + 물살 (+ 옆밀림). 매어 둔 배는 물살을 안 탄다
    const f = this.moored ? null : w?.flowAt?.(this.x, this.y), lw = this.leeway, k = damp(this.grip, dt);
    this.vx = lerp(this.vx, Math.cos(this.angle) * this.speed + (f?.x || 0) + (lw?.x || 0), k);
    this.vy = lerp(this.vy, Math.sin(this.angle) * this.speed + (f?.y || 0) + (lw?.y || 0), k);
    const res = moveCircle(w, this, this.vx * dt, this.vy * dt, 'boat');
    if (!res.hit) return;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 4 && game.time - this.lastHit > 0.5) (this.lastHit = game.time), crashDamage(this, sp, game), game.emit('vehicle:crash', { vehicle: this, speed: sp });
    this.speed *= 0.35;
    if (res.hitX) this.vx *= -0.2;
    if (res.hitY) this.vy *= -0.2;
  }

  playerControls(input, dt, game) {
    const c = this.ctl;
    if (this.lockT > 0) return void ((c.throttle = c.steer = 0), (c.brake = false));
    super.playerControls(input, dt, game);
    if (this.vtype !== 'sailboat') return;
    // 돛배: 방향키 = 키, Shift 탭 = 돛 올림, Space 탭 = 돛 내림, Space 1초 = 돛 0 + 닻
    c.brake = c.sprint = false;
    if (input.pressed('sprint')) (this.sail = Math.min(1, this.sail + 0.5)), (this.anchor = false);
    if (input.down('brake')) {
      if ((this.spaceT += dt) >= 1 && !this.anchor) (this.sail = 0), (this.anchor = true), game.notify('닻을 내렸다');
    } else {
      if (this.spaceT > 0 && this.spaceT < 1) this.sail = Math.max(0, this.sail - 0.5);
      this.spaceT = 0;
    }
  }

  onCollide(other, impact, game) {
    if (vehicleHit(this, other, impact, game)) return;
    if (other.kind === 'human' && other.swimming && this.vtype === 'rowboat') super.onCollide(other, impact, game); // 헤엄치는 사람만 친다
  }
  damage(amount, info, game) {
    if (this.sinkT > 0) return;
    super.damage(amount, info, game);
    if (this.wrecked && this.vtype !== 'steamer') (this.sinkT = 10), (this.solid = false); // 10초 동안 가라앉는다
  }
  findExitSpot(i, game) {
    const w = game?.world, c = Math.cos(this.angle), n = Math.sin(this.angle), hl = this.length / 2, hw = this.width / 2;
    for (const k of [1, 3])
      for (const [lx, ly] of [[hl + k, 0], [-hl - k, 0], [0, hw + k], [0, -hw - k]]) {
        const x = this.x + lx * c - ly * n, y = this.y + lx * n + ly * c;
        if (w && canStand(w, x, y, 0.33, 'foot')) return { x, y };
      }
    return this.dockSpot || super.findExitSpot(i, game); // 못 찾으면 물로 뛰어든다
  }
  onEnter(h) {
    if (h.isPlayer) lockRider(this, h, this.S.lock);
  }
  onExit(h) {
    clearSpread(h);
    h.mountedOnly = null;
  }
  /** 타는 거리: 증기선은 가운데 현문 근처에서만(20 m 선체 어디서나 잡히면 옆의 작은 배를 가린다),
   *  나룻배·돛배는 물가에서 한 걸음 건너 탈 수 있게 몸통 테두리 기준 */
  interactDistance(actor) {
    if (this.vtype === 'steamer') return Math.hypot(actor.x - this.x, actor.y - this.y) - 3;
    return super.interactDistance(actor);
  }
  get interactRange() {
    return this.vtype === 'steamer' ? 1.7 : 2.8;
  }
  getInteractions(actor, game) {
    return this.follow ? [] : seatInteractions(this, actor, game);
  }
  board(a, i, game) {
    const f = this.ferry;
    if (f && wantedLevel(game) >= 2) return void this.driver?.say?.('수배된 사람은 못 태우오', 3);
    if (this.enter(a, game, i) && f) f.boardT = f.t;
  }
  getRiderInteractions(p, game) {
    const f = this.ferry;
    return f && f.state === 'wait' && this.driver && !this.driver.isPlayer ? [{ key: 'interact', label: '사공에게 "출발하세"', priority: 2, run: () => f.askGo(game) }] : this.ffItems?.(p, game) || [];
  }

  // ------------------------------------------------------------ 그리기 (B.5)
  drawVehicle(ctx, game) {
    const L = this.length, W = this.width, t = game.time;
    if (this.sinkT > 0) ctx.globalAlpha = Math.max(0.1, this.sinkT / 10);
    ctx.fillStyle = SHADOW;
    hullPath(ctx, L + 0.4, W + 0.4);
    ctx.fill();
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.06;
    if (this.vtype === 'steamer') return this.drawSteamer(ctx, t);
    hullPath(ctx, L, W, this.vtype === 'rowboat' ? 0.12 : 0.28, 0.1);
    ctx.fillStyle = this.vtype === 'rowboat' ? '#8b6c4a' : '#7a5a3c';
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(29,27,24,0.35)';
    ctx.lineWidth = 0.03;
    for (let x = -L / 2 + 1; x < L / 2 - 0.5; x += 1.2) ctx.beginPath(), ctx.moveTo(x, -W / 2 + 0.15), ctx.lineTo(x, W / 2 - 0.15), ctx.stroke(); // 가룡목
    drawDummies(ctx, this, this.crowd, this.id.length);
    // 노: ±0.35 rad, 0.9 Hz
    const th = 0.2 + (this.oar || (this.vtype === 'sailboat' && this.seats[1].occupant && this.speed > 0.2) ? 0.35 * Math.sin(t * Math.PI * 1.8) : 0);
    ctx.strokeStyle = PAL.timber;
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(-L / 2 + 0.6, 0);
    ctx.lineTo(-L / 2 + 0.6 - 2.6 * Math.cos(th), 2.6 * Math.sin(th));
    ctx.stroke();
    if (this.vtype === 'sailboat') this.drawSail(ctx, game);
  }
  drawSail(ctx, game) {
    const wind = game.sys.time?.wind || game.world?.wind || { angle: 0 };
    const rel = angleWrap(wind.angle - this.angle), boom = clamp(rel * 0.5, -1.3, 1.3) + Math.PI; // 돛대 뒤로, 바람 따라 비스듬히
    ctx.save();
    ctx.translate(1.2, 0);
    ctx.fillStyle = PAL.timber;
    ctx.beginPath();
    ctx.arc(0, 0, 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(boom);
    const len = 3.6, belly = 0.25 + this.sail * 0.6;
    if (this.sail > 0) {
      ctx.globalAlpha *= 0.85;
      ctx.fillStyle = PAL.sail;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len / 2, belly * Math.sign(rel || 1), len, 0);
      ctx.lineTo(len, 0.12);
      ctx.lineTo(0, 0.12);
      ctx.fill();
      ctx.globalAlpha /= 0.85;
      ctx.strokeStyle = PAL.ink2;
      ctx.lineWidth = 0.03;
      for (let i = 1; i <= 5; i++) ctx.beginPath(), ctx.moveTo((len * i) / 6, 0), ctx.lineTo((len * i) / 6, belly * 0.75 * Math.sign(rel || 1)), ctx.stroke(); // 살대 5줄
    }
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();
  }
  drawSteamer(ctx, t) {
    hullPath(ctx, 20, 4.2, 0.25, 0.12);
    ctx.fillStyle = '#3a3532';
    ctx.fill();
    ctx.stroke();
    hullPath(ctx, 18.6, 3.4, 0.25, 0.12);
    ctx.fillStyle = '#9a7f5e';
    ctx.fill();
    ctx.fillStyle = PAL.whiteWall;
    ctx.fillRect(-3.2, -1.1, 6, 2.2); // 선실
    ctx.strokeRect(-3.2, -1.1, 6, 2.2);
    drawDummies(ctx, this, this.crowd || 0.55, 7);
    ctx.fillStyle = '#2a2624';
    ctx.beginPath();
    ctx.arc(0.6, 0, 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.seal;
    ctx.fillRect(0.3, -0.12, 0.6, 0.24);
    // 연기
    for (let i = 0; i < 5; i++) {
      const k = (t * 0.6 + i / 5) % 1;
      ctx.fillStyle = `rgba(60,58,55,${0.35 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(0.6 - k * 7, Math.sin(i * 2.1 + t) * 0.5 * k, 0.6 + k * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
Object.assign(Boat.prototype, Bag);

// ---------------------------------------------------------------- 나루 운행 (A.4 ferries, C.5)
const PERIOD = { ferry_mapo: 20, ferry_noryang: 8, ferry_yanghwa: 15, ferry_hangang: 8, ferry_wolmi: 30 };
export class FerryService {
  constructor(f) {
    this.f = f;
    this.side = 'b';
    this.state = 'wait';
    this.t = 0;
    this.period = (f.period ?? PERIOD[f.id] ?? 15) * 2; // 게임 분 → 실초
    this.boat = null;
  }
  dock(s) {
    const p = this.f[s], o = this.f[s === 'a' ? 'b' : 'a'];
    return { x: p.x, y: p.y, angle: Math.atan2(o.y - p.y, o.x - p.x) }; // 뱃머리는 건너편을 본다
  }
  adopt(b) {
    if (this.boat && this.boat !== b && !this.boat.hasPlayer) {
      if (this.boat.driver && !b.driver) {
        const d = this.boat.driver;
        this.boat.exit(d, null, { force: true, silent: true });
        b.enter(d, null, 0);
      }
      this.boat.ejectAll(null);
      this.boat.alive = false;
    }
    this.boat = b;
    b.ferry = this;
    b.owner = b.owner || 'public';
    b.autopilot = (dt, g) => this.drive(b, dt, g);
  }
  update(dt, game) {
    let b = this.boat;
    const first = !this._init;
    this._init = true;
    if (b?.owner === 'stolen' && Math.hypot(b.x - this.f.a.x, b.y - this.f.a.y) > 150) (b.ferry = null), delete b.autopilot, (b = this.boat = null); // 빼앗긴 배는 놓아준다
    if (!b?.alive || b.wrecked) {
      const d = this.dock(this.side);
      if (!first && game.camera.visible(d.x, d.y, 12)) return;
      this.adopt((b = game.add(new Boat('rowboat', { x: d.x, y: d.y, angle: d.angle, owner: 'public', name: '나룻배' }))));
      b.persistent = true;
      this.state = 'wait';
    }
    if (!b.driver && (first || !game.camera.visible(b.x, b.y, 8))) {
      const named = this.f.id === 'ferry_noryang' ? game.byId('sagong_noryang') || game.sys.npcs?.named?.('sagong_noryang') : null;
      if (named?.alive && named.state === 'normal' && !named.vehicle && Math.hypot(named.x - b.x, named.y - b.y) < 40) b.enter(named, game, 0);
      else makeCrew(game, b, 0, { name: '사공', role: 'porter', brain: 'driver' });
    }
    if (!b.driver || b.driver.isPlayer || b.owner === 'stolen') return void (b.moored = false); // 빼앗긴 배
    this.t += dt;
    const pl = b.hasPlayer, night = isNightHire(game);
    b.moored = this.state === 'wait';
    if (this.state === 'wait') {
      const home = this.dock(this.side);
      if (Math.hypot(home.x - b.x, home.y - b.y) > 1) (b.x += (home.x - b.x) * dt * 0.5), (b.y += (home.y - b.y) * dt * 0.5); // 매어 둔 자리로
      const go = this.go || (pl && !night && this.t > (this.boardT ?? 0) + 6) || (!pl && !night && this.t > this.period + 8);
      if (!go) return;
      this.go = false;
      this.state = 'cross';
      this.target = this.dock(this.side === 'a' ? 'b' : 'a');
      if (!pl) b.crowd = rand.next() * 0.5;
    } else if (Math.hypot(this.target.x - b.x, this.target.y - b.y) < 2.5) {
      this.state = 'wait';
      this.side = this.side === 'a' ? 'b' : 'a';
      this.t = 0;
      this.boardT = null;
      b.speed = 0;
      if (pl) b.driver.say?.('다 왔소. 살펴 가시오.', 3);
      b.tipMul = 1;
    }
  }
  /** 사공 조종: 건너편을 겨누되 물살만큼 거슬러 겨냥 */
  drive(b, dt, game) {
    const c = b.ctl, home = this.dock(this.side), t = this.state === 'cross' ? this.target : home;
    const dx = t.x - b.x, dy = t.y - b.y, d = Math.hypot(dx, dy) || 1;
    if (this.state !== 'cross') {
      c.steer = clamp(angleWrap(home.angle - b.angle) * 2, -1, 1); // 기다리며 뱃머리를 돌린다
      c.throttle = 0;
      c.brake = true;
      return;
    }
    const f = game.world.flowAt?.(b.x, b.y) || { x: 0, y: 0 }, sp = 1.7 * b.tipMul;
    const diff = angleWrap(Math.atan2((dy / d) * sp - f.y, (dx / d) * sp - f.x) - b.angle);
    c.steer = clamp(diff * 2, -1, 1);
    c.brake = false;
    c.throttle = Math.abs(diff) > 1.2 ? 0.2 : Math.min(1, d / 6 + 0.25);
  }
  askGo(game) {
    const night = isNightHire(game), b = this.boat;
    const q = night ? '사공: 밤에는 배를 안 띄우오. 삯을 세 곱 주면 모를까.' : '사공: 떠나리까? 관선이라 삯은 없소만, 막걸리 값은 인정이오.';
    ask(game, q, night ? ['3전 주고 건너세', '그만두세'] : ['그냥 가세', '1전 주고 가세', '3전 주고 가세']).then((i) => {
      if (i < 0 || !b?.alive) return;
      if (night) return void (i === 0 && (pay(game, 3, 'ferry') ? (this.go = true) : game.notify('돈이 모자랍니다', 'warn')));
      const tip = [0, 1, 3][i] ?? 0;
      if (!pay(game, tip, 'ferry_tip')) return game.notify('돈이 모자랍니다', 'warn');
      b.tipMul = tip >= 3 ? 1.15 : tip ? 1 : 0.85;
      b.driver?.say?.(tip >= 3 ? rand.pick(RUMORS) : tip ? '고맙소. 갑시다.' : '공짜 배라고 막 타는구먼…', 4);
      this.go = true;
    });
  }
  /** 말 타고 나루에 오면: 말은 따로 한 척 (팁 3전). 페이드로 건넌다 */
  horseOffer(actor, game) {
    const h = actor.vehicle;
    if (!h || h.moveMode !== 'horse' || h.driver !== actor || isNightHire(game)) return null;
    const near = ['a', 'b'].find((s) => Math.hypot(this.f[s].x - actor.x, this.f[s].y - actor.y) < 28);
    if (!near) return null;
    return { key: 'interact', label: '말을 배에 싣고 건너기 (3전)', priority: 3, d: 1, run: () => this.ferryHorse(actor, h, near, game) };
  }
  ferryHorse(actor, h, from, game) {
    if (wantedLevel(game) >= 2) return game.notify('사공이 고개를 젓는다 (수배 중)', 'warn');
    if (!pay(game, 3, 'ferry_horse')) return game.notify('돈이 모자랍니다', 'warn');
    const o = this.f[from === 'a' ? 'b' : 'a'], p = this.f[from], L = Math.hypot(o.x - p.x, o.y - p.y) || 1;
    const spot = game.world.randomPassableNear?.(o.x + ((o.x - p.x) / L) * 14, o.y + ((o.y - p.y) / L) * 14, 12, 'horse');
    if (!spot) return game.notify('건너편에 말을 내릴 자리가 없소', 'warn');
    const go = () => {
      h.x = spot.x;
      h.y = spot.y;
      h.speed = h.vx = h.vy = 0;
      h.angle = Math.atan2(o.y - p.y, o.x - p.x);
      h.placeOccupants();
      game.camera.snap(h.x, h.y);
      game.sys.time?.skip?.(L / 1.7 / 120);
      game.sys.ui?.fade?.(false, 400);
    };
    const fp = game.sys.ui?.fade?.(true, 400);
    fp?.then ? fp.then(go) : go();
  }
}

// ---------------------------------------------------------------- 증기선 운항 (C.8)
const AGROUND_D = 1189.7, SEA_D = 2604;
export class SteamerService {
  constructor(game, line) {
    this.line = line;
    this.boats = [];
    this.done = new Set();
    this.dockSpots = {};
  }
  sd(id) {
    return this.line.stops.find((s) => s.id === id)?.d ?? (id === 'yongsan' ? 0 : id === 'mapo' ? 427.9 : this.line.length);
  }
  /** 오늘 출발할 편: 상행 제물포 06:00, 하행 용산 07:00. steamer_reduced 면 짝수 날 상행만·홀수 날 하행만 */
  runFrom(at, game) {
    const red = flagOn(game, 'steamer_reduced'), even = dayNum(game) % 2 === 0;
    if (at === 'jemulpo_port' && (!red || even)) return { dep: 6, dir: -1, stops: ['mapo', 'yongsan'] };
    if (at === 'yongsan' && (!red || !even)) return { dep: 7, dir: 1, stops: ['mapo', 'jemulpo_port'] };
    return null;
  }
  setup(game) {
    for (const v of this.boats) v.alive = false;
    this.boats = ['jemulpo_port', 'yongsan'].map((at, i) => {
      const v = game.add(new Boat('steamer', { id: `steamer_${i + 1}`, name: i ? '용산호' : '한강호', owner: 'public' }));
      v.follow = true;
      v.persistent = v.line = 'steamer';
      v.sv = { d: this.sd(at), dir: at === 'yongsan' ? 1 : -1, state: 'dock', at, stops: [] };
      makeCrew(game, v, 0, { name: '선장', role: 'foreigner', faction: 'company', lookOver: { coat: '#34405a', hat: 'cap' }, brain: 'idle' });
      for (const k of [1, 2, 3]) makeCrew(game, v, k, { name: k === 3 ? '사무장' : '선원', role: 'porter', brain: 'idle' });
      return v;
    });
    this.resync(game);
  }
  /** 시각에 맞춰 배 자리를 다시 잡는다 (시간 건너뛰기·불러오기 뒤). 0번 배 = 오늘 상행, 1번 배 = 오늘 하행 */
  resync(game) {
    const h = hourNow(game), day = game.sys.time?.day ?? 1;
    this.boats.forEach((v, i) => {
      const home = i ? 'yongsan' : 'jemulpo_port', run = this.runFrom(home, game), s = v.sv, dur = i ? 7.58 : 8.42;
      const dock = (at) => Object.assign(s, { state: 'dock', at, d: this.sd(at), dir: at === 'yongsan' ? 1 : -1, stops: [] });
      if (!run || h < run.dep) dock(home);
      else if (h >= run.dep + dur) dock(run.stops[1]), this.done.add(`${day}:${home}`);
      else {
        const from = this.sd(home), d = from + (this.sd(run.stops[1]) - from) * ((h - run.dep) / dur);
        Object.assign(s, { state: 'run', dir: run.dir, d, at: null, stops: run.stops.filter((id) => (this.sd(id) - d) * run.dir > 0) });
        this.done.add(`${day}:${home}`);
      }
      v.speed = 0;
      this.place(v);
    });
  }
  place(v) {
    const s = v.sv, L = this.line, p = pointAtDistance(L.points, s.d, L.cum);
    const a = pointAtDistance(L.points, s.d - 9, L.cum), b = pointAtDistance(L.points, s.d + 9, L.cum);
    v.x = p.x;
    v.y = p.y;
    v.angle = Math.atan2(b.y - a.y, b.x - a.x) + (s.dir < 0 ? Math.PI : 0);
    v.vx = Math.cos(v.angle) * v.speed;
    v.vy = Math.sin(v.angle) * v.speed;
    v.dockSpot = s.state === 'run' ? null : this.dockSpot(s.at || s.stops[0], v.game);
  }
  dockSpot(id, game) {
    if (!id || !game?.world) return null;
    const st = this.line.stops.find((s) => s.id === id);
    return (this.dockSpots[id] ??= st ? game.world.randomPassableNear?.(st.sx ?? st.x, st.sy ?? st.y, 35, 'foot') || null : null);
  }
  update(dt, game) {
    if (!this.boats.length) this.setup(game);
    const h = hourNow(game), day = game.sys.time?.day ?? 1;
    for (const v of this.boats) {
      if (!v.alive) continue;
      v.game = game;
      const s = v.sv, pl = v.hasPlayer;
      if (s.state === 'dock' || s.state === 'dwell') {
        v.speed = 0;
        if (s.state === 'dwell' && (s.dwell -= dt) <= 0) this.depart(v, game, s.stops[0]);
        else if (s.state === 'dock') {
          const run = this.runFrom(s.at, game), key = `${day}:${s.at}`;
          if (run && h >= run.dep && h < run.dep + 2 && !this.done.has(key)) {
            this.done.add(key);
            Object.assign(s, { dir: run.dir, stops: run.stops.slice() });
            this.depart(v, game, s.at);
          }
        }
      } else {
        const next = s.stops[0], dist = (this.sd(next) - s.d) * s.dir;
        let tgt = Math.min(s.d < SEA_D ? (s.dir < 0 ? 4.1 : 5.1) : 4.6, Math.sqrt(2 * 0.12 * Math.max(0, dist - 0.5)));
        if (game.flags?.steamer_aground && s.dir < 0 && Math.abs(s.d - AGROUND_D) < 45 && !this.refloat) {
          tgt = 0; // M10 좌초: 밀물 때(게임 3시간)까지 선다
          if ((s.aground = (s.aground || 0) + dt) > 360) this.refloat = true;
        }
        v.speed = tgt < v.speed ? Math.max(tgt, v.speed - Math.max(0.12, v.speed * 0.5) * dt) : approach(v.speed, tgt, 0.15 * dt);
        s.d += s.dir * v.speed * dt;
        if (dist < 0.8 && v.speed < 0.3) this.arrive(v, game, next);
      }
      this.place(v);
      if (pl) this.purser(v, dt, game);
    }
  }
  depart(v, game, stop) {
    const s = v.sv;
    s.state = 'run';
    s.at = null;
    v.crowd = 0.3 + rand.next() * 0.4;
    game.emit('rail:depart', { line: 'steamer', stop, vehicle: v, playerAboard: v.hasPlayer });
  }
  arrive(v, game, stop) {
    const s = v.sv;
    s.stops.shift();
    s.d = this.sd(stop);
    v.speed = 0;
    s.state = s.stops.length ? 'dwell' : 'dock';
    s.dwell = 20; // 마포 10게임분
    s.at = stop;
    game.emit('rail:arrive', { line: 'steamer', stop, vehicle: v, playerAboard: v.hasPlayer });
    game.sys.vehicles?.fastForward?.(1);
    if (v.hasPlayer && v.unpaid) {
      const p = game.player;
      v.seats[3].occupant?.say?.('뱃삯도 안 낸 이는 내리시오!', 3);
      this.place(v);
      v.exit(p, game, { force: true });
      crime(game, 'fare_evasion', v.x, v.y, p, v);
      v.unpaid = false;
    }
  }
  /** 사무장이 10초 안에 뱃삯을 묻는다 (75전, 용산–마포 10전) */
  purser(v, dt, game) {
    if (v.paid || v.asking || (v.payT = (v.payT ?? 10) - dt) > 0) return;
    const s = v.sv, short = (v.boardAt === 'yongsan' && s.dir > 0) || (v.boardAt === 'mapo' && s.dir < 0);
    const waive = game.sys.vehicles?.waiveFares;
    if (waive) return void (v.paid = true);
    v.asking = true;
    const opts = short ? ['10전 낸다', '안 낸다'] : ['75전 낸다', '안 낸다'], fare = short ? 10 : 75;
    ask(game, `사무장: 뱃삯 ${fare}전이오.`, opts).then((i) => {
      v.asking = false;
      if (i === 0 && pay(game, fare, 'steamer')) return void ((v.paid = true), game.emit('fare', { line: 'steamer', amount: fare }));
      if (i === 0) game.notify('돈이 모자랍니다', 'warn');
      v.unpaid = true;
      v.paid = true; // 다음 정박지에서 내리라 한다
    });
  }
  /** 정박한 증기선 25 m 안에서 F */
  offer(actor, game) {
    if (actor.vehicle) return null;
    // 미션 단계가 다른 탈것(예: 거룻배)을 요구하면 증기선 안내로 F 를 가로채지 않는다
    const ms = game.sys.missions?.active, step = ms?.def?.steps?.[ms.step];
    if (step?.type === 'mount' && step.vtype && step.vtype !== 'steamer') return null;
    for (const v of this.boats) {
      if (!v.alive || v.sv.state === 'run' || Math.hypot(v.x - actor.x, v.y - actor.y) > 25) continue;
      const i = v.seats.findIndex((s) => s.role === 'passenger' && !s.occupant);
      if (i < 0) continue;
      return { key: 'enter', label: '증기선에 오르기', priority: 3, d: 2, run: (a) => {
        v.boardAt = v.sv.at;
        v.paid = v.unpaid = v.asking = false;
        v.payT = 10;
        v.enter(a, game, i);
      } };
    }
    return null;
  }
}
