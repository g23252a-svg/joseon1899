// 메는·끄는 탈것: 보교(gama)·인력거(rickshaw)·소달구지(oxcart). 가마꾼·차부 걸음, 고용 삯, 기력, 주막 들르기, 전복, 진흙 빠짐 (스펙 C.1·C.9·B.5)
import { Vehicle } from './vehicle.js';
import { PAL } from '../engine/palette.js';
import { angleWrap, approach, clamp, damp, lerp, rand } from '../engine/util.js';
import { Bag, SHADOW, ask, clearSpread, crashDamage, crime, fleeFrom, isNightHire, lockRider, makeCrew, pay, seatInteractions, setSpread, terrainMul, vehicleHit } from './common.js';

const S = (x, y, role, pose) => ({ x, y, role, pose });
const SPEC = {
  gama: { name: '보교', mode: 'foot', L: 3.2, W: 1.2, r: 0.7, max: 2.2, sprint: 2.8, rev: 0.4, acc: 0.8, dec: 1.5, brake: 2, turn: 1.2, ref: 0.5, tip: 0.8, grip: 30, hp: 120, mass: 210, bag: [2, 0, 0], lock: 1.2,
    seats: [S(1.3, 0, 'driver', 'carry'), S(-1.3, 0, 'crew', 'carry'), S(0, 0, 'passenger', 'hidden')], hit: [0.8, -0.8], push: true },
  rickshaw: { name: '인력거', mode: 'wheel', L: 2.6, W: 1.15, r: 0.55, max: 3.4, sprint: 4.4, rev: 0.6, acc: 1.6, dec: 1.8, brake: 3.5, turn: 2, ref: 0.8, tip: 0.5, grip: 14, hp: 120, mass: 110, bag: [3, 0, 0], lock: 0.5,
    seats: [S(0.95, 0, 'driver', 'pull'), S(-0.35, 0, 'passenger', 'sit')], hit: [0.6, -0.5], thr: 3.2, mul: 0.6 },
  oxcart: { name: '소달구지', mode: 'wheel', L: 5.6, W: 1.8, r: 0.9, max: 1.4, sprint: 1.7, rev: 0.5, acc: 0.35, dec: 0.8, brake: 1.5, turn: 0.7, ref: 0.8, tip: 0.15, grip: 20, hp: 350, mass: 900, bag: [24, 4, 4], lock: 0.8,
    seats: [S(0, -0.5, 'driver', 'sit'), S(-1.2, -0.4, 'passenger', 'sit'), S(-1.2, 0.4, 'passenger', 'sit')], hit: [1.9, 0, -1.9], push: true },
};
const HANSEONG = { x: 2840, y: 760, r: 520 };
let jumaks = null, jumakWorld = null;

export class Carried extends Vehicle {
  constructor(vtype, opts = {}) {
    const P = SPEC[vtype] || SPEC.rickshaw;
    super({
      displayName: opts.name || P.name, moveMode: P.mode, length: P.L, width: P.W, radius: P.r, maxSpeed: P.max, sprintSpeed: P.sprint, reverseSpeed: P.rev, accel: P.acc, decel: P.dec,
      brakeDecel: P.brake, turnRate: P.turn, turnRefSpeed: P.ref, turnInPlace: P.tip, grip: P.grip, hp: P.hp, mass: P.mass, cameraZoom: 1, seats: P.seats,
      hitCircles: P.hit.map((x) => ({ x, y: 0, r: P.W / 2 })), tramplePush: !!P.push, trampleThreshold: P.thr ?? 3.2, trampleMul: P.mul ?? 1, stealable: vtype !== 'gama', ...opts, vtype: SPEC[vtype] ? vtype : 'rickshaw',
    });
    this.P = P;
    this.lockT = this.restT = this.stopT = this.tipT = this.hurryT = this.latA = this.ckT = this.phase = 0;
    this.st = 100; // 가마꾼·소 기력
    this.stuck = null;
    this.hire = null; // {fare, paid, dist, mul}
    this.seen = new Set();
    this.interactRange = vtype === 'rickshaw' ? 3 : 1.7;
    this.initBag(...P.bag);
  }

  // ------------------------------------------------------------ 갱신
  update(dt, game) {
    for (const k of ['lockT', 'restT', 'stopT', 'tipT']) this[k] = Math.max(0, this[k] - dt);
    if (this.vtype === 'gama' && this.driver && !this.driver.isPlayer && !this.seats[1].occupant && !this.dropped && (!this._crewed || !game.camera.visible(this.x, this.y, 4))) {
      this._crewed = true;
      const h = makeCrew(game, this, 1, { name: '가마꾼', role: 'porter', brain: 'idle' });
      h.maxHp = h.hp = 60;
    }
    super.update(dt, game);
    const sp = Math.abs(this.speed);
    this.phase += sp * dt * 0.6;
    for (const s of this.seats) {
      const o = s.occupant;
      if (!o) continue;
      if (s.pose === 'carry' || s.pose === 'pull') (o.speedNow = sp), (o.walkPhase += sp * dt * 3.2);
      if (o.tags?.has('crew')) continue;
      const pas = s.role === 'passenger';
      setSpread(o, pas && this.vtype !== 'oxcart' ? 3 : 0, (this.vtype === 'oxcart' && sp > 0.2) || (this.vtype === 'rickshaw' && !pas), sp > 0.3);
    }
    this.tickStamina(dt, game, sp);
    if ((this.ckT -= dt) <= 0) (this.ckT = 1), this.checkEach(game, sp);
  }

  /** 운전: 플레이어가 끌기·몰기 / 플레이어가 승객이면 방향 지시 / NPC 는 미션·운전 두뇌일 때만 움직인다 */
  readControls(dt, game) {
    const c = this.ctl, d = this.driver, b = d?.brain, p = game.player;
    const crewOk = this.vtype !== 'gama' || this.seats[1].occupant;
    if (this.restT > 0 || this.stopT > 0 || this.tipT > 0 || this.stuck || this.lockT > 0 || !d || !crewOk) return void Object.assign(c, { throttle: 0, steer: 0, sprint: false, brake: true });
    if (d.isPlayer) return super.readControls(dt, game);
    if (this.vtype !== 'oxcart' && p?.vehicle === this && p.state === 'normal' && this.passengerControls(game.input, game)) return;
    if (b?.drive && (b.kind === 'mission_go' || !b.type || b.type === 'driver')) return b.drive(this, d, dt, game);
    Object.assign(c, { throttle: 0, steer: 0, sprint: false, brake: true });
  }
  /** 승객 지시 (C.9): 방향키 = 방향, 지도 표식 = 목적지, Shift 재촉, Space 멈춤. 지시가 없으면 false */
  passengerControls(input, game) {
    const c = this.ctl, a = input.axis(), mag = Math.hypot(a.x, a.y), wp = game.waypoint;
    c.sprint = input.down('sprint') && this.st > 1;
    c.brake = input.down('brake');
    const hold = () => (Object.assign(c, { throttle: 0, steer: 0, brake: true }), true);
    let tx, ty;
    if (c.brake) return hold();
    if (mag > 0.1) (tx = this.x + a.x * 10), (ty = this.y + a.y * 10), (this.route = null);
    else if (wp && Number.isFinite(wp.x)) {
      const key = `${wp.x | 0},${wp.y | 0}`;
      if (this.routeKey !== key) (this.routeKey = key), (this.route = { pts: game.world?.findPath?.(this.x, this.y, wp.x, wp.y, this.moveMode) || [[wp.x, wp.y]], i: 0 });
      const r = this.route;
      while (r.i < r.pts.length - 1 && Math.hypot(r.pts[r.i][0] - this.x, r.pts[r.i][1] - this.y) < 3) r.i++;
      [tx, ty] = r.pts[r.i];
      if (r.i >= r.pts.length - 1 && Math.hypot(tx - this.x, ty - this.y) < 4) {
        if (!r.done) (r.done = true), this.driver?.say?.('다 왔습니다요.', 3);
        return hold();
      }
    } else return false;
    const diff = angleWrap(Math.atan2(ty - this.y, tx - this.x) - this.angle);
    c.steer = clamp(diff * 2, -1, 1);
    c.throttle = Math.abs(diff) > 1.5 ? 0.2 : 1;
    return true;
  }

  physics(dt, game) {
    const c = this.ctl, npcPull = this.vtype === 'rickshaw' && !this.driver?.isPlayer;
    const sprint = c.sprint && this.st > 0 && (this.vtype !== 'rickshaw' || !this.driver?.isPlayer || this.driver.stamina > 1);
    const top = (npcPull ? (sprint ? 3.8 : 3.2) : sprint ? this.sprintSpeed : this.maxSpeed) * terrainMul(this, game) * (this.stuck ? 0 : 1);
    const target = c.throttle >= 0 ? c.throttle * top : c.throttle * this.reverseSpeed;
    if (c.brake) this.speed = approach(this.speed, 0, this.brakeDecel * dt);
    else this.speed = approach(this.speed, target, (Math.abs(target) > Math.abs(this.speed) ? this.accel : this.decel) * dt);
    const a0 = this.angle;
    this.angle += c.steer * this.turnRate * clamp(Math.abs(this.speed) / this.turnRefSpeed, this.turnInPlace, 1) * dt * (this.speed < -0.05 ? -1 : 1);
    this.integrate(dt, game);
    this.sprinting = sprint && Math.abs(this.speed) > 0.3;
    // 인력거 측면 가속 > 4.5 m/s² → 3초 전복 (C.9)
    this.latA = lerp(this.latA, Math.abs((this.speed * angleWrap(this.angle - a0)) / Math.max(dt, 1e-3)), damp(5, dt));
    if (this.vtype === 'rickshaw' && this.driver?.isPlayer && this.latA > 4.5) this.tipOver(game);
  }

  tickStamina(dt, game, sp) {
    const v = this.vtype, d = this.driver, moving = sp > 0.3;
    if (v === 'gama') {
      this.st = clamp(this.st + (moving ? (this.sprinting ? -1.5 : -0.3) : 5) * dt, 0, 100);
      if (this.st <= 0 && this.restT <= 0 && moving) (this.restT = 30), d?.say?.('아이고 다리야… 좀 쉬었다 갑시다요.', 4);
    } else if (v === 'oxcart') this.st = clamp(this.st + (this.sprinting ? -2 : moving ? 0 : 3) * dt, 0, 100);
    else if (d?.isPlayer && moving) d.stamina = Math.max(0, d.stamina - ((this.sprinting ? 8 : 2) + 8) * dt); // 탄 동안 코어가 +8 회복하므로 상쇄
    // 재촉 삯: 30실초마다 1전 (보교·인력거 승객)
    const h = this.hire;
    if (h && this.sprinting && (this.hurryT += dt) >= 30) (this.hurryT = 0), (h.extra = (h.extra || 0) + 1);
    if (h && moving) h.dist += sp * dt;
  }

  /** 1초마다: 주막 들르기(보교), 진흙 빠짐(소달구지), 선불 거리 넘은 삯(보교) */
  checkEach(game, sp) {
    const w = game.world, p = game.player, h = this.hire;
    if (this.vtype === 'gama' && h && sp > 0.3 && this.st < 70) {
      if (jumakWorld !== w) (jumakWorld = w), (jumaks = (w?.buildings || []).filter((b) => b.kind === 'jumak'));
      const j = jumaks.find((b) => !this.seen.has(b.id) && Math.hypot(b.x - this.x, b.y - this.y) < 25);
      if (j) this.seen.add(j.id), rand.chance(0.4) && ((this.stopT = 20), this.driver?.say?.('나리, 목 좀 축이고 갑시다요.', 4));
    }
    if (this.vtype === 'gama' && h && h.dist > h.paidDist + 100) (h.paidDist += 100), pay(game, 1 * h.mul, 'gama') || (this.stopT = 5, this.driver?.say?.('삯이 모자라면 못 갑니다요.', 3));
    if (this.vtype === 'oxcart' && !this.stuck && sp > 0.2 && w?.terrainAt) {
      const t = w.terrainAt(this.x, this.y), T = w.T, wet = /rain|storm/.test(game.sys.time?.weather || '') || game.flags?.wet_ground;
      if ((t === T.SAND || (wet && t === T.FIELD)) && rand.chance(wet ? 0.1 : 0.05)) {
        this.stuck = { n: 0, t: 6, help: 0 };
        this.speed = 0;
        if (this.hasPlayer) game.notify('바퀴가 진흙에 빠졌다! E 를 여러 번 눌러 빼낸다', 'warn');
      }
    }
    const s = this.stuck;
    if (s && (s.t -= 1) <= 0) (s.t = 6), (s.n = 0); // 6초 안에 12번
    if (s && game.query(this.x, this.y, 8, (e) => e.kind === 'human' && e.faction === 'gang' && !e.isPlayer && e.state === 'normal').length && (s.help += 1) >= 30) this.unstick(game, '일행이 수레를 밀어 냈다');
  }
  unstick(game, msg) {
    this.stuck = null;
    if (this.hasPlayer) game.notify(msg, 'good');
  }

  tipOver(game) {
    if (this.tipT > 0) return;
    this.tipT = this.lockT = 3;
    this.speed *= 0.2;
    this.latA = 0;
    const o = this.seats[1].occupant;
    if (o && this.exit(o, game, { force: true })) o.knockDown(Math.cos(this.angle + 1.57), Math.sin(this.angle + 1.57), 3, 1.5), o.damage(8, { kind: 'fall', source: null, x: o.x, y: o.y }, game);
    game.notify('인력거가 엎어졌다!', 'bad');
  }
  /** 승객이 총을 쏘면 가마꾼 70% 가 가마를 내려놓고 달아난다 (C.3) */
  scare(game) {
    if (this.vtype !== 'gama' || this.dropped || !rand.chance(0.7)) return;
    this.dropped = true;
    for (const i of [0, 1]) {
      const o = this.seats[i].occupant;
      if (o && !o.isPlayer && this.exit(o, game, { force: true })) fleeFrom(o, this.x, this.y, 12), o.say?.('사람 살려!', 2);
    }
    this.hire = null;
  }

  // ------------------------------------------------------------ 상호작용
  getInteractions(actor, game) {
    if (!actor.isPlayer || actor.vehicle || this.wrecked || this.dropped) return [];
    const d = this.driver;
    if (this.vtype === 'gama') return d && !d.isPlayer && !this.seats[2].occupant && this.restT <= 0 ? [{ key: 'enter', label: '보교 타기 (삯 선불)', priority: 5, run: (a) => this.hireRide(a, game) }] : [];
    const out = seatInteractions(this, actor, game).filter((it) => !(this.vtype === 'rickshaw' && d && !d.isPlayer && it.label.endsWith('오르기')));
    if (this.vtype === 'rickshaw' && d && !d.isPlayer && !this.seats[1].occupant) out.push({ key: 'interact', label: '인력거 타기', priority: 4, run: (a) => this.hireRide(a, game) });
    return out;
  }
  /** 고용: 밤(21~5시)에는 삯 ×3 이어야 응한다 (C.3). 보교는 선불 6전 + 100 m당 1전, 인력거는 내릴 때 2전 + 100 m당 0.5전 */
  hireRide(a, game) {
    const night = isNightHire(game), gama = this.vtype === 'gama', d = this.driver, wp = game.waypoint;
    const go = (mul) => {
      const est = gama && wp ? Math.hypot(wp.x - this.x, wp.y - this.y) : 0, fare = gama ? Math.round((6 + Math.ceil(est / 100)) * mul) : 0;
      if (fare && !pay(game, fare, 'gama')) return game.notify('돈이 모자랍니다', 'warn');
      if (!this.enter(a, game, gama ? 2 : 1)) return;
      this.hire = { mul, dist: 0, paidDist: est, extra: 0, fare };
      this.seen.clear();
      d?.say?.(gama ? (fare ? `${fare}전 받았습니다요. 가십시다.` : '어디로 모실깝쇼? (지도에 표식을 찍으시오)') : '어디로 모실까요?', 3);
      if (fare) game.emit('fare', { line: this.vtype, amount: fare });
    };
    if (!night) return go(1);
    ask(game, `${gama ? '가마꾼' : '차부'}: 밤길은 안 갑니다요. 삯을 세 곱 주시면 모를까.`, ['세 곱 주마', '그만두세']).then((i) => i === 0 && go(3));
  }
  getRiderInteractions(p, game) {
    const out = [];
    if (this.stopT > 0 && this.hire) out.push({ key: 'interact', label: '"그냥 가세" (팁 2전)', priority: 3, run: () => pay(game, 2, 'tip') && ((this.stopT = 0), this.driver?.say?.('예이, 갑시다요.', 2)) });
    if (this.stuck && this.driver === p) out.push({ key: 'interact', label: `바퀴 빼내기 (${this.stuck.n}/12)`, priority: 4, run: () => ++this.stuck.n >= 12 && this.unstick(game, '바퀴를 빼냈다') });
    return out;
  }
  get exitLabel() {
    return this.vtype === 'gama' ? '보교에서 내리기' : `${this.displayName}에서 내리기`;
  }
  onEnter(h, seat) {
    if (h.isPlayer) lockRider(this, h, seat.role === 'passenger' && this.vtype === 'rickshaw' ? 0.8 : this.P.lock);
  }
  onExit(h, game) {
    clearSpread(h);
    if (!h.isPlayer) return;
    lockRider(this, h, this.vtype === 'gama' && this.hire ? 1 : 0.3);
    const r = this.hire;
    this.hire = null;
    this.route = this.routeKey = null;
    if (!r) return;
    if (this.vtype === 'rickshaw') {
      if (Math.abs(this.speed) > 1) return crime(game, 'fare_evasion', this.x, this.y, h, this.driver || this); // 도중에 뛰어내림
      const half = game.flags?.rickshaw_friend && Math.hypot(this.x - HANSEONG.x, this.y - HANSEONG.y) < HANSEONG.r ? 0.5 : 1;
      const fare = Math.max(1, Math.round((2 + Math.ceil((r.dist / 100) * 0.5)) * r.mul * half)) + r.extra;
      if (pay(game, fare, 'rickshaw')) game.notify(`인력거 삯 ${fare}전을 냈습니다`), game.emit('fare', { line: 'rickshaw', amount: fare });
      else this.driver?.say?.('삯도 안 내고 가시오?!', 3), crime(game, 'fare_evasion', this.x, this.y, h, this.driver || this);
    } else if (r.extra) pay(game, r.extra, 'gama_hurry');
  }
  onCollide(other, impact, game) {
    if (!vehicleHit(this, other, impact, game)) super.onCollide(other, impact, game);
  }
  onCrash(sp, game) {
    crashDamage(this, sp, game);
  }

  // ------------------------------------------------------------ 그리기 (B.5)
  drawOccupants(ctx, game) {
    const saved = this.seats.map((s) => s.pose);
    this.seats.forEach((s) => s.pose === 'carry' && (s.pose = 'hidden')); // 가마꾼은 스스로 그린다
    super.drawOccupants(ctx, game);
    this.seats.forEach((s, i) => (s.pose = saved[i]));
  }
  drawVehicle(ctx, game) {
    const L = this.length, W = this.width;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.05;
    ctx.fillStyle = SHADOW;
    ctx.fillRect(-L / 2 + 0.15, -W / 2 + 0.2, L, W);
    if (this.vtype === 'gama') return this.drawGama(ctx);
    if (this.vtype === 'rickshaw') return this.drawRickshaw(ctx);
    this.drawOxcart(ctx);
  }
  drawGama(ctx) {
    ctx.strokeStyle = PAL.timber; // 가마채 두 개
    ctx.lineWidth = 0.09;
    for (const y of [-0.34, 0.34]) ctx.beginPath(), ctx.moveTo(-1.6, y), ctx.lineTo(1.6, y), ctx.stroke();
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.05;
    ctx.fillStyle = '#6b4a32';
    ctx.fillRect(-0.6, -0.5, 1.2, 1.0);
    ctx.strokeRect(-0.6, -0.5, 1.2, 1.0);
    ctx.fillStyle = 'rgba(47,74,122,0.8)'; // 쪽빛 휘장 지붕
    ctx.beginPath();
    ctx.roundRect?.(-0.52, -0.42, 1.04, 0.84, 0.18) ?? ctx.rect(-0.52, -0.42, 1.04, 0.84);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PAL.seal;
    ctx.beginPath();
    ctx.arc(0, 0, 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  drawRickshaw(ctx) {
    if (this.tipT > 0) ctx.rotate(0.5), ctx.scale(1, 0.7);
    ctx.strokeStyle = PAL.ink2; // 채
    ctx.lineWidth = 0.05;
    for (const y of [-0.32, 0.32]) ctx.beginPath(), ctx.moveTo(-0.2, y), ctx.lineTo(1.15, y * 0.85), ctx.stroke();
    ctx.fillStyle = '#1f1d1b'; // 바퀴 (위에서 본 납작한 판)
    for (const y of [-0.55, 0.55]) ctx.fillRect(-0.72, y - 0.04, 0.74, 0.08);
    ctx.strokeStyle = PAL.ink;
    ctx.fillStyle = '#2a2622';
    ctx.beginPath();
    ctx.roundRect?.(-0.75, -0.42, 0.8, 0.84, 0.15) ?? ctx.rect(-0.75, -0.42, 0.8, 0.84);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3a3632'; // 접은 포장
    ctx.beginPath();
    ctx.ellipse(-0.72, 0, 0.22, 0.44, 0, Math.PI / 2, -Math.PI / 2);
    ctx.fill();
    ctx.stroke();
  }
  drawOxcart(ctx) {
    const ph = this.phase, tilt = this.wrecked ? 0.25 : 0;
    ctx.save();
    ctx.rotate(tilt);
    ctx.strokeStyle = PAL.timber; // 멍에·끌채
    ctx.lineWidth = 0.08;
    for (const y of [-0.3, 0.3]) ctx.beginPath(), ctx.moveTo(0.4, y), ctx.lineTo(1.3, y * 0.6), ctx.stroke();
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.05;
    ctx.fillStyle = '#8a6a44'; // 짐칸 널
    ctx.fillRect(-2.6, -0.8, 3.1, 1.6);
    ctx.strokeRect(-2.6, -0.8, 3.1, 1.6);
    ctx.strokeStyle = 'rgba(29,27,24,0.35)';
    for (let x = -2.2; x < 0.5; x += 0.45) ctx.beginPath(), ctx.moveTo(x, -0.8), ctx.lineTo(x, 0.8), ctx.stroke();
    ctx.fillStyle = '#2a2420'; // 큰 바퀴
    for (const y of this.wrecked ? [-0.95] : [-0.95, 0.95]) ctx.fillRect(-1.6, y - 0.07, 1.2, 0.14);
    const c = this.cargo, n = Math.min(4, c.items.length + c.large.length * 2 + (this.crowd ? 3 : 0));
    ctx.strokeStyle = PAL.ink;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = c.large.length && i < 2 ? c.large[0]?.color || '#7a5a3a' : '#c9b080'; // 볏섬·짐승
      ctx.beginPath();
      ctx.ellipse(-2.2 + (i % 2) * 0.9 + (i > 1 ? 0.45 : 0), i > 1 ? 0.35 : -0.3, 0.42, 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    // 소: 몸통 타원 + 머리 + 뿔 + 다리 4획
    ctx.save();
    ctx.translate(1.85, 0);
    ctx.strokeStyle = PAL.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.09;
    [[0.4, -0.3, 0], [0.4, 0.3, 0.5], [-0.45, -0.3, 0.5], [-0.45, 0.3, 0]].forEach(([x, y, o]) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin((ph + o) * Math.PI * 2) * 0.15, y * 1.35);
      ctx.stroke();
    });
    ctx.lineWidth = 0.05;
    ctx.fillStyle = '#6a4a30';
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.75, 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0.85, 0, 0.24, 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#d8cfba';
    ctx.lineWidth = 0.04;
    for (const s of [-1, 1]) ctx.beginPath(), ctx.moveTo(0.8, s * 0.15), ctx.quadraticCurveTo(0.85, s * 0.32, 0.98, s * 0.3), ctx.stroke();
    ctx.restore();
  }
}
Object.assign(Carried.prototype, Bag);
