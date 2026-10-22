// 말: 과하마(pony)·제주마(jeju_horse, horse 별칭). 걸음새·기력·유대·휘파람·낙마·안장주머니·다리 그림 (스펙 C.1·C.4·B.5)
import { Vehicle } from './vehicle.js';
import { PAL } from '../engine/palette.js';
import { angleWrap, approach, clamp, rand } from '../engine/util.js';
import { Bag, SHADOW, clearSpread, crashDamage, crime, lockRider, seatInteractions, setSpread, terrainMul, vehicleHit, warnAhead } from './common.js';

const SPEC = {
  pony: { name: '과하마', L: 1.9, W: 0.55, r: 0.35, walk: 1.8, trot: 3.6, max: 6.0, sprint: 9.5, accel: 3.0, turn: 3.0, gt: 0.6, grip: 9, hp: 220, st: 120, mass: 260, bag: 12, canter: 3, drain: 0.8, stride: 0.85, coat: '#7a4a32' },
  jeju_horse: { name: '제주마', L: 2.0, W: 0.6, r: 0.38, walk: 1.9, trot: 4.0, max: 6.5, sprint: 10.8, accel: 3.4, turn: 2.8, gt: 0.55, grip: 8, hp: 200, st: 100, mass: 300, bag: 10, canter: 1, drain: 1, stride: 1, coat: '#5b4a3a' },
};
const STRIDE = { stand: 1.6, walk: 1.6, trot: 2.4, canter: 3.0, gallop: 4.2 };
const AMP = { stand: 0, walk: 0.12, trot: 0.2, canter: 0.3, gallop: 0.38 };
const LEG = { stand: [0, 0, 0, 0], walk: [0.25, 0.75, 0, 0.5], trot: [0, 0.5, 0.5, 0], canter: [0.3, 0.6, 0, 0.3], gallop: [0.5, 0.6, 0, 0.1] }; // LF RF LH RH
const SPREAD = { stand: 0, walk: 0, trot: 2, canter: 4, gallop: 7 };
const REGEN = { stand: 15, walk: 12, trot: 8 };
export const BOND2_XP = 60;
export const josa = (s, a, b) => (s && (s.charCodeAt(s.length - 1) - 0xac00) % 28 > 0 ? a : b);

export class Horse extends Vehicle {
  constructor(vtype, opts = {}) {
    const P = SPEC[vtype] || SPEC.jeju_horse;
    super({
      displayName: opts.name || P.name, moveMode: 'horse', length: P.L, width: P.W, radius: P.r, maxSpeed: P.max, sprintSpeed: P.sprint,
      reverseSpeed: 1, accel: P.accel, decel: 2.5, brakeDecel: 6, turnRate: P.turn, turnRefSpeed: 1.5, turnInPlace: 0.6, grip: P.grip,
      hp: P.hp, mass: P.mass, cameraZoom: 0.95, trampleThreshold: 3.2, trampleMul: 1,
      hitCircles: [{ x: 0.5, y: 0, r: 0.33 }, { x: -0.5, y: 0, r: 0.33 }],
      seats: [{ x: 0.05, y: 0, role: 'driver', pose: 'ride' }, { x: -0.5, y: 0, role: 'passenger', pose: 'ride' }],
      ...opts,
      vtype: SPEC[vtype] ? vtype : 'jeju_horse',
    });
    this.P = P;
    this.coat = opts.coat || P.coat;
    this.stallion = opts.stallion ?? this.vtype === 'pony';
    this.gait = 'stand';
    this.want = null;
    this.legPhase = Math.random();
    this.maxStamina = this.stamina = P.st;
    this.bond = 1;
    this.bondXp = 0;
    this.walkLock = false;
    this.lockT = this.spookT = this.rearT = this.rearCd = this.kickCd = this.slideT = this.petCd = this.fightT = 0;
    this.down = false;
    this.downT = 0;
    this.stabled = null;
    this.route = null;
    this.topOverride = 0;
    this.travel = 0;
    this._fightCk = rand.next();
    this.initBag(P.bag, 1, 4);
  }

  // ------------------------------------------------------------ 갱신
  update(dt, game) {
    if (this.stabled) return;
    for (const k of ['lockT', 'spookT', 'rearT', 'rearCd', 'kickCd', 'slideT', 'petCd']) this[k] -= dt;
    if (this.down) {
      this.speed = this.vx = this.vy = 0;
      if ((this.downT -= dt) <= 0) this.recover(game);
      return;
    }
    super.update(dt, game);
    const d = this.driver, p2 = this.seats[1].occupant;
    const sp = SPREAD[this.gait] * (this.bond >= 2 ? 0.85 : 1);
    if (d) setSpread(d, sp, false, this.gait !== 'stand' && this.gait !== 'walk');
    if (p2) setSpread(p2, sp + 2, false, true);
    if (d?.isPlayer && this.owner === 'player' && (this.travel += Math.abs(this.speed) * dt) >= 50) {
      this.travel -= 50;
      this.dayXp(game, 1);
    }
    if (this.gait !== 'gallop' && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt);
    if (this.stallion && (this._fightCk -= dt) <= 0) {
      this._fightCk = 0.5;
      this.checkFight(game);
    }
  }

  physics(dt, game) {
    const P = this.P, c = this.ctl;
    if (this.spookT > 0) (c.throttle = c.steer = 0), (c.brake = true);
    let want = this.want || (c.sprint ? 'gallop' : 'canter');
    const limp = this.hp < this.maxHp * 0.3;
    this.strain = false;
    if (want === 'gallop' && (limp || this.stamina <= 0)) {
      if (!limp && this.driver?.isPlayer && c.sprint) this.strain = true; // 기력 0 인데 Shift: 말이 버틴다
      else want = 'canter';
    }
    const gs = { stand: 0, walk: P.walk, trot: P.trot, canter: P.max, gallop: P.sprint }[want] ?? P.max;
    const top = (this.topOverride || gs) * terrainMul(this, game) * (limp && want === 'canter' ? 0.6 : 1) * (this.seats[1].occupant ? 0.75 : 1) * (this.strain ? 0.7 : 1);
    const target = c.throttle >= 0 ? c.throttle * top : c.throttle * this.reverseSpeed;
    if (c.brake || this.slideT > 0) this.speed = approach(this.speed, 0, (this.slideT > 0 ? 9 : this.brakeDecel) * dt);
    else this.speed = approach(this.speed, target, (Math.abs(target) > Math.abs(this.speed) ? this.accel : this.decel) * dt);
    const tf = clamp(Math.abs(this.speed) / this.turnRefSpeed, this.turnInPlace, 1) * (this.speed > P.max * 1.05 ? P.gt : 1);
    this.angle += c.steer * this.turnRate * tf * dt * (this.speed < -0.05 ? -1 : 1);
    const g0 = this.grip;
    if (this.slideT > 0) this.grip = 3; // 급정지 미끄러짐
    this.integrate(dt, game);
    this.grip = g0;
    const a = Math.abs(this.speed);
    this.gait = a < 0.2 ? 'stand' : a <= P.walk * 1.15 ? 'walk' : a <= P.trot * 1.1 ? 'trot' : a <= P.max * 1.05 ? 'canter' : 'gallop';
    const skill = this.owner === 'player' ? game.sys.skills?.mod?.('horseStamina', 1) ?? 1 : 1;
    this.maxStamina = P.st * (this.bond >= 2 ? 1.1 : 1) * skill;
    const rate = this.gait === 'gallop' ? -5 * P.drain * (this.bond >= 2 ? 0.95 : 1) : this.gait === 'canter' ? P.canter : REGEN[this.gait];
    this.stamina = clamp(this.stamina + rate * dt, 0, this.maxStamina);
    if (this.strain) {
      this.hp = Math.max(1, this.hp - 2 * dt);
      this.addBond(-dt, game);
    }
    this.legPhase += (this.speed / (STRIDE[this.gait] * P.stride)) * dt;
  }

  playerControls(input, dt, game) {
    const c = this.ctl;
    if (this.lockT > 0) {
      c.throttle = c.steer = 0;
      c.sprint = c.brake = false;
      return;
    }
    if (input.pressed('CapsLock')) this.walkLock = !this.walkLock;
    super.playerControls(input, dt, game);
    const ax = input.axis(), mag = Math.min(1, Math.hypot(ax.x, ax.y));
    if (c.throttle > 0) c.throttle = Math.min(1, c.throttle / Math.max(mag, 0.1));
    this.want = this.walkLock ? 'walk' : c.sprint ? 'gallop' : mag < 0.6 ? 'trot' : 'canter';
    this.topOverride = 0;
    if (input.pressed('brake')) {
      input.consume('brake');
      if (Math.abs(this.speed) < 0.3) this.doRear(game);
      else if (this.speed > this.P.trot) this.slideT = 0.3;
    }
    if (input.pressed('crouch')) this.kick(game);
  }

  /** 휘파람·길찾기로 가는 자율 주행 (NPC 기수가 drive 를 안 줄 때도) */
  autopilot(dt, game) {
    const c = this.ctl, r = this.route;
    c.sprint = false;
    this.topOverride = 0;
    if (!r) {
      c.throttle = c.steer = 0;
      c.brake = true;
      this.want = 'stand';
      return;
    }
    const t = r.pts[r.i], dx = t[0] - this.x, dy = t[1] - this.y, dist = Math.hypot(dx, dy);
    const last = r.i >= r.pts.length - 1;
    if (dist < (last ? 1.2 : 3)) {
      if (!last) return void r.i++;
      this.route = null;
      r.done?.(this);
      return this.autopilot(dt, game);
    }
    r.stuck = Math.abs(this.speed) < 0.4 ? (r.stuck || 0) + dt : 0;
    if (r.stuck > 4 && !game.camera.visible(this.x, this.y, 4)) (this.x = t[0]), (this.y = t[1]), (r.stuck = 0);
    const diff = angleWrap(Math.atan2(dy, dx) - this.angle);
    c.steer = clamp(diff * 2.2, -1, 1);
    c.brake = false;
    c.throttle = Math.abs(diff) > 1.7 ? 0.25 : Math.abs(diff) > 0.9 ? 0.6 : 1;
    const rem = last ? dist : Infinity;
    this.want = rem < 5 ? 'walk' : rem < 12 ? 'trot' : r.gait || 'canter';
    if (this.want === 'canter' && r.speed) this.topOverride = r.speed;
  }

  /** 길찾기로 (x,y) 까지 간다. 물(나루)을 건너야 하면 false */
  goTo(x, y, game, o = {}) {
    const w = game.world;
    let pts = w?.findPath?.(this.x, this.y, x, y, 'horse') || null;
    if (pts?.some((p, i) => i > 0 && w.isDeepWater?.((p[0] + pts[i - 1][0]) / 2, (p[1] + pts[i - 1][1]) / 2))) pts = null; // 나루 간선은 말이 못 건넌다
    if (!pts && Math.hypot(x - this.x, y - this.y) > 30) return false;
    this.route = { pts: pts?.length ? pts.concat([[x, y]]) : [[x, y]], i: 0, speed: o.speed, gait: o.gait, done: o.done };
    return true;
  }

  /** 휘파람 (C.4) */
  whistleTo(p, game) {
    if (this.stabled) return game.notify('마방에서 찾으시오', 'warn'), false;
    if (p.vehicle === this) return false;
    const R = (this.bond >= 2 ? 150 : 80) * (game.sys.skills?.has?.('gim_bond') ? 1.5 : 1);
    const d = Math.hypot(p.x - this.x, p.y - this.y);
    if (d > R || this.down) return game.notify('말이 너무 멀리 있습니다', 'warn'), false;
    if (this.driver) return false;
    game.sfx('horse_neigh', { x: this.x, y: this.y });
    if (d < 3) return true;
    const ok = this.goTo(p.x + Math.cos(p.angle) * 2, p.y + Math.sin(p.angle) * 2, game, { speed: 7, done: (h) => (h.angle = Math.atan2(p.y - h.y, p.x - h.x)) });
    if (!ok) return game.notify('말이 올 길이 없습니다', 'warn'), false;
    this.whistled = true;
    return true;
  }

  // ------------------------------------------------------------ 유대
  addBond(n, game) {
    if (this.owner !== 'player') return;
    this.bondXp = Math.max(0, this.bondXp + n);
    if (this.bond < 2 && this.bondXp >= BOND2_XP) {
      this.bond = 2;
      game?.emit('horse:bond', { level: 2, horse: this });
      game?.notify(`${this.displayName}${josa(this.displayName, '과', '와')}의 정이 깊어졌다 (유대 2단계)`, 'good');
    }
  }
  dayXp(game, n) {
    const day = game.sys.time?.day ?? 0;
    if (this._xpDay !== day) (this._xpDay = day), (this._xpToday = 0);
    if (this._xpToday >= 60) return;
    this._xpToday += n;
    this.addBond(n, game);
  }
  feed(game) {
    this.stamina = Math.min(this.maxStamina, this.stamina + 40);
    this.hp = Math.min(this.maxHp, this.hp + 20);
    this.addBond(6, game);
  }

  // ------------------------------------------------------------ 사건
  onEnter(h, seat, game) {
    this.route = null;
    if (h.isPlayer) {
      lockRider(this, h, 0.6);
      if (this.whistled && this.owner === 'player') this.addBond(1, game);
    }
    this.whistled = false;
  }
  onExit(h) {
    clearSpread(h);
    if (h.isPlayer) lockRider(this, h, 0.6);
  }
  onCrash(sp, game) {
    crashDamage(this, sp, game);
    this.checkFall(sp, game);
  }
  onCollide(other, impact, game) {
    if (vehicleHit(this, other, impact, game)) return this.checkFall(impact, game);
    super.onCollide(other, impact, game);
  }
  /** 낙마 임계: 유대 1단계 6 m/s, 2단계 7 m/s */
  checkFall(sp, game) {
    const thr = this.bond >= 2 ? 7 : 6;
    if (sp >= thr) this.throwRiders(sp, thr, game);
  }
  throwRiders(sp, thr, game) {
    const vx = this.vx, vy = this.vy, a = this.angle;
    this.vx = this.vy = 0; // 코어 exit 의 뛰어내림 피해가 겹치지 않게
    for (const s of this.seats) {
      const o = s.occupant;
      if (!o || !this.exit(o, game, { force: true })) continue;
      o.knockDown(Math.cos(a), Math.sin(a), 2.5, 1.5);
      o.damage(Math.max(0, sp - thr) * 6 + 5, { kind: 'fall', source: null, x: o.x, y: o.y }, game);
    }
    this.vx = vx * 0.3;
    this.vy = vy * 0.3;
    this.speed *= 0.3;
  }
  hearShot(x, y, game) {
    if (this.down || this.stabled || Math.hypot(x - this.x, y - this.y) > 25) return;
    let p = this.bond >= 2 ? 0.25 : 0.35;
    if (game.query(this.x, this.y, 30, (e) => e.species === 'tiger' && !e.dead).length) p *= 2;
    if (!rand.chance(p)) return;
    this.spookT = this.rearT = 1.2;
    game.sfx('horse_neigh', { x: this.x, y: this.y });
    if (this.bond < 2 && this.driver && rand.chance(0.2)) this.throwRiders(5, 0, game);
  }
  doRear(game) {
    if (this.rearCd > 0) return;
    this.rearCd = 5;
    this.rearT = 1;
    warnAhead(game, this, 6, 1, true);
    game.sfx('horse_neigh', { x: this.x, y: this.y });
  }
  /** 뒷발차기 (C, 유대 2단계): 뒤쪽 120°·2.2 m 안 1명에 35, 3 m 밀기 */
  kick(game) {
    if (this.kickCd > 0) return;
    if (this.bond < 2) return game.notify('뒷발차기는 유대 2단계부터', 'warn');
    this.kickCd = 4;
    this.rearT = 0.4;
    const back = this.angle + Math.PI;
    const t = game.nearest(this.x, this.y, 2.2, (e) => e !== this && !e.vehicle && (e.kind === 'human' || e.kind === 'animal') && e.state !== 'dead' && !e.dead && Math.abs(angleWrap(Math.atan2(e.y - this.y, e.x - this.x) - back)) < Math.PI / 3);
    if (!t) return;
    const d = this.driver, a = Math.atan2(t.y - this.y, t.x - this.x);
    t.damage(35, { kind: 'melee', weapon: 'horse_kick', source: d || this, x: t.x, y: t.y }, game);
    if (t.knockDown) t.knockDown(Math.cos(a), Math.sin(a), 11, 1.2);
    if (t.kind === 'human' && t.faction !== 'rival' && d?.isPlayer) crime(game, 'assault', t.x, t.y, d, t);
  }
  checkFight(game) {
    const o = game.nearest(this.x, this.y, 2.5, (e) => e !== this && e.vtype === 'pony' && e.stallion && !e.down && !e.stabled);
    if (!o) return void (this.fightT = 0);
    if ((this.fightT += 0.5) < 3) return;
    this.fightT = 0;
    if (!rand.chance(this.bond >= 2 || o.bond >= 2 ? 0.15 : 0.3)) return;
    for (const h of [this, o]) {
      h.damage(10, { kind: 'animal', source: h === this ? o : this, x: h.x, y: h.y }, game);
      h.spookT = 1;
    }
    game.sfx('horse_neigh', { x: this.x, y: this.y, pitch: 1.2 });
  }

  /** 말은 죽지 않는다(P): HP 0 → 쓰러짐 10초 → 마방 */
  damage(amount, info = {}, game) {
    if (this.down || this.stabled || !(amount > 0)) return;
    if (info.source?.isPlayer && this.owner === 'player' && info.kind !== 'fall') this.addBond(-30, game);
    this.hp -= amount;
    game?.emit('damage', { target: this, amount, ...info });
    if (this.hp <= 0) this.goDown(game);
  }
  goDown(game) {
    this.hp = 0;
    this.down = true;
    this.downT = 10;
    this.route = null;
    this.throwRiders(0, 0, game);
    this.speed = this.vx = this.vy = 0;
    game?.emit('horse:down', { horse: this });
  }
  recover(game) {
    this.down = false;
    this.hp = this.maxHp * 0.3;
    const st = this.owner === 'player' ? game.sys.vehicles?.nearestStable?.(this.x, this.y) : null;
    if (!st) return;
    this.stableAt(st, game);
    game.notify(`${this.displayName}${josa(this.displayName, '이', '가')} ${st.name}으로 실려 갔소`, 'warn');
  }
  stableAt(st, game) {
    this.ejectAll(game);
    this.stabled = st.id;
    this.hidden = true;
    this.solid = false;
    this.x = st.x;
    this.y = st.y;
    this.speed = this.vx = this.vy = 0;
    this.route = null;
  }
  unstable(x, y, a = 0) {
    this.stabled = null;
    this.hidden = false;
    this.solid = true;
    this.down = false;
    this.x = x;
    this.y = y;
    this.angle = a;
  }

  // ------------------------------------------------------------ 상호작용
  getInteractions(actor, game) {
    if (this.stabled) return [];
    const out = seatInteractions(this, actor, game);
    if (actor.isPlayer && !actor.vehicle && this.owner === 'player' && !this.down) {
      if (this.petCd <= 0) out.push({ key: 'interact', label: '말 쓰다듬기', priority: 3, run: () => ((this.petCd = 120), this.addBond(3, game), game.notify(`${this.displayName}${josa(this.displayName, '이', '가')} 코를 부빈다`)) });
      if (game.sys.inventory?.has?.('f_maljuk')) out.push({ key: 'interact', label: '말죽 먹이기', priority: 4, run: () => game.sys.inventory.remove('f_maljuk', 1) && this.feed(game) });
    }
    return out;
  }
  getRiderInteractions(p, game) {
    const out = [{ key: 'interact', label: '비키시오', priority: 0, run: () => (warnAhead(game, this, 25, 1), p.say?.('비키시오!', 1.5)) }];
    const st = this.owner === 'player' && this.driver === p ? game.sys.vehicles?.nearestStable?.(this.x, this.y, 18) : null;
    if (st) out.push({ key: 'interact', label: `${st.name}에 말 맡기기`, priority: 2, run: () => (this.stableAt(st, game), game.notify(`${this.displayName}${josa(this.displayName, '을', '를')} 맡겼다`)) });
    return out;
  }

  // ------------------------------------------------------------ 그리기 (B.5 말 다리)
  drawVehicle(ctx, game) {
    const P = this.P, L = P.L, W = P.W, t = game.time;
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(0.14, 0.18, L * 0.5, W * (this.down ? 1 : 0.75), 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.rearT > 0) ctx.scale(1 - this.rearT * 0.12, 1);
    if (this.down) ctx.scale(1, 1.3);
    // 다리 4획
    const amp = AMP[this.gait] * P.stride, ph = LEG[this.gait], hx = L * 0.27, hy = W * 0.36;
    ctx.strokeStyle = PAL.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.08;
    [[hx, -hy], [hx, hy], [-hx, -hy], [-hx, hy]].forEach(([bx, by], k) => {
      const sy = by < 0 ? -1 : 1;
      const off = this.down ? 0 : amp * Math.sin((this.legPhase + ph[k]) * Math.PI * 2);
      const ey = this.down ? 0.45 : sy * 0.12;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + off, by + ey);
      ctx.stroke();
    });
    // 꼬리
    const sw = Math.sin(t * (this.gait === 'stand' ? 1.3 : 6) + this.legPhase) * 0.12;
    ctx.strokeStyle = '#2a211b';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(-L * 0.42, 0);
    ctx.quadraticCurveTo(-L * 0.55, sw * 0.5, -L * 0.62 - (this.gait === 'gallop' ? 0.12 : 0), sw);
    ctx.stroke();
    // 몸통·목·머리
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.04;
    ctx.fillStyle = this.coat;
    ctx.beginPath();
    ctx.ellipse(-0.02, 0, L * 0.36, W * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const bob = this.gait === 'stand' ? (Math.sin(t * 0.7 + this.x) > 0.6 ? 0.08 : 0) : Math.sin(this.legPhase * Math.PI * 4) * 0.03;
    const strain = this.strain ? Math.sin(t * 30) * 0.06 : 0;
    ctx.save();
    ctx.translate(L * 0.3 + bob, strain);
    ctx.beginPath();
    ctx.ellipse(0.12, 0, 0.24, W * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0.38, 0, 0.17, W * 0.21, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#2a211b';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(-0.08, 0);
    ctx.lineTo(0.3, 0);
    ctx.stroke();
    ctx.fillStyle = PAL.ink;
    for (const s of [-1, 1]) ctx.fillRect(0.26, s * W * 0.14 - 0.02, 0.07, 0.04);
    ctx.restore();
    if (this.down) return;
    // 안장·짐
    const c = this.cargo;
    if (this.owner === 'player' || this.driver || this.owner === 'rental') {
      ctx.fillStyle = '#6b3a2a';
      ctx.fillRect(-0.22, -W * 0.46, 0.44, W * 0.92);
    }
    if (c.items.length || c.small.length) {
      ctx.fillStyle = '#8a6a44';
      for (const s of [-1, 1]) ctx.fillRect(-L * 0.28, s * W * 0.42 - 0.08, 0.3, 0.16);
    }
    if (c.large.length) {
      ctx.fillStyle = c.large[0]?.color || '#8a6a48';
      ctx.beginPath();
      ctx.ellipse(-L * 0.24, 0, 0.36, W * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------ 저장
  save() {
    const plain = (a) => a.filter((o) => o && typeof o === 'object' && !(o instanceof Vehicle) && !o.update).map((o) => ({ ...o }));
    return { vtype: this.vtype, id: this.id, name: this.displayName, x: this.x, y: this.y, angle: this.angle, hp: this.hp, stamina: this.stamina, bond: this.bond, bondXp: this.bondXp, stabled: this.stabled, coat: this.coat, stallion: this.stallion, cargo: { items: plain(this.cargo.items), small: plain(this.cargo.small), large: plain(this.cargo.large) } };
  }
}
Object.assign(Horse.prototype, Bag);
