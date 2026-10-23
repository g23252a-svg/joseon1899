// 탈것 기본 클래스. 말·배·가마·인력거·전차·기차가 모두 이것을 상속한다.
//
// GTA 식 공통 규칙
//  - F: 타기 / 내리기 / (NPC 가 몰고 있으면) 빼앗기
//  - 플레이어 조작은 '화면 기준 방향 조향': 누른 방향으로 머리를 돌리며 나아간다
//  - Shift: 질주(말) / 힘껏(노·인력거), Space: 급정지
//  - 빠르게 달리는 탈것은 행인을 넘어뜨린다(onCollide)
//
// 하위 클래스가 주로 덮어쓰는 것: physics(dt, game), drawVehicle(ctx, game), playerControls(input, dt, game)

import { Entity, LAYER } from '../engine/entity.js';
import { canStand, moveCircle } from '../engine/physics.js';
import { angleWrap, approach, clamp, damp, lerp } from '../engine/util.js';

export class Vehicle extends Entity {
  constructor(opts = {}) {
    super({ radius: opts.radius ?? 1.0, mass: opts.mass ?? 6, hp: opts.hp ?? 200, ...opts });
    this.kind = 'vehicle';
    this.vtype = opts.vtype || 'cart';
    this.displayName = opts.displayName || '탈것';
    // 좌석: x,y 는 탈것 기준 로컬 좌표(+x 가 앞), role: driver | passenger, pose: ride|sit|stand|row|pull|carry|hidden
    this.seats = (opts.seats || [{ x: 0, y: 0, role: 'driver', pose: 'sit' }]).map((s) => ({ facing: 0, ...s, occupant: null }));
    this.moveMode = opts.moveMode || 'wheel'; // foot | horse | wheel | boat | rail
    this.length = opts.length ?? 2;
    this.width = opts.width ?? 1;

    // 주행 수치 (m/s, m/s², rad/s)
    this.maxSpeed = opts.maxSpeed ?? 4;
    this.sprintSpeed = opts.sprintSpeed ?? this.maxSpeed;
    this.reverseSpeed = opts.reverseSpeed ?? 1;
    this.accel = opts.accel ?? 2;
    this.decel = opts.decel ?? 2.5; // 손 뗐을 때
    this.brakeDecel = opts.brakeDecel ?? 6;
    this.turnRate = opts.turnRate ?? 1.6;
    this.turnRefSpeed = opts.turnRefSpeed ?? 2; // 이 속도 이상에서 최대 회전
    this.turnInPlace = opts.turnInPlace ?? 0.25; // 정지 상태 회전 비율
    this.grip = opts.grip ?? 6; // 옆 미끄러짐 억제 강도 (클수록 안 미끄러짐)
    this.canReverse = opts.canReverse ?? true;

    this.speed = 0; // 앞방향 부호 있는 속도
    this.ctl = { throttle: 0, steer: 0, sprint: false, brake: false };
    this.owner = opts.owner ?? null; // 'player' | NPC id | 'public' | null
    this.stealable = opts.stealable ?? true;
    this.playerCanDrive = opts.playerCanDrive ?? true;
    this.fare = opts.fare ?? 0; // 승객 요금(전)
    this.cameraZoom = opts.cameraZoom ?? 1;
    this.wrecked = false;
    this.lastHit = 0;
    // 행인 치기 (스펙 C.1·C.3): 임계 속도 이상이면 넘어뜨리고 피해 = (속도 − 임계) × 7 × 배수. tramplePush 면 1 m 밀기만
    this.trampleThreshold = opts.trampleThreshold ?? 3.2;
    this.trampleMul = opts.trampleMul ?? 1;
    this.tramplePush = opts.tramplePush ?? false;
    // 맞음 판정 원 (로컬 좌표, +x 앞): [{x, y, r}]. 없으면 중심 원 하나
    this.hitCircles = opts.hitCircles || null;
  }

  /** 월드 점(px,py)과 반지름 r 이 맞음 판정 원에 닿는가 (총알·화살 판정용) */
  hitTest(px, py, r = 0) {
    const circles = this.hitCircles;
    if (!circles || !circles.length) return Math.hypot(px - this.x, py - this.y) <= this.radius + r;
    const c = Math.cos(this.angle), n = Math.sin(this.angle);
    for (const h of circles) {
      const hx = this.x + h.x * c - (h.y || 0) * n, hy = this.y + h.x * n + (h.y || 0) * c;
      if (Math.hypot(px - hx, py - hy) <= h.r + r) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ 좌석

  get driver() {
    return this.seats.find((s) => s.role === 'driver')?.occupant || null;
  }
  get occupants() {
    return this.seats.filter((s) => s.occupant).map((s) => s.occupant);
  }
  get hasPlayer() {
    return this.seats.some((s) => s.occupant?.isPlayer);
  }
  freeSeatIndex(role = null) {
    return this.seats.findIndex((s) => !s.occupant && (!role || s.role === role));
  }
  seatWorld(i) {
    const s = this.seats[i];
    const c = Math.cos(this.angle), n = Math.sin(this.angle);
    return { x: this.x + s.x * c - s.y * n, y: this.y + s.x * n + s.y * c, angle: this.angle + (s.facing || 0) };
  }

  enter(human, game, seatIndex = null) {
    if (human.vehicle) human.vehicle.exit(human, game, { silent: true });
    if (seatIndex == null || seatIndex < 0) seatIndex = this.freeSeatIndex();
    if (seatIndex < 0) return false;
    const seat = this.seats[seatIndex];
    if (seat.occupant) return false;
    seat.occupant = human;
    human.vehicle = this;
    human.seatIndex = seatIndex;
    human.seatPose = seat.pose;
    human.solid = false;
    human.moveX = human.moveY = 0;
    human.aiming = false;
    this.placeOccupants();
    if (human.isPlayer && seat.role === 'driver' && !this.owner) this.owner = 'player';
    game?.events.emit('vehicle:enter', { human, vehicle: this, seat: seatIndex, role: seat.role });
    this.onEnter?.(human, seat, game);
    return true;
  }

  /** 내리기. opts.force: 위치를 못 찾아도 내림, opts.silent: 이벤트 생략 */
  exit(human, game, opts = {}) {
    const i = this.seats.findIndex((s) => s.occupant === human);
    if (i < 0) return false;
    if (!opts.force && this.canExit && !this.canExit(human, game)) return false;
    const spot = this.findExitSpot(i, game);
    if (!spot && !opts.force) {
      game?.notify('여기서는 내릴 수 없습니다', 'warn');
      return false;
    }
    this.seats[i].occupant = null;
    human.vehicle = null;
    human.seatIndex = -1;
    human.seatPose = null;
    human.solid = human.state !== 'dead';
    const p = spot || { x: this.x, y: this.y };
    human.x = p.x;
    human.y = p.y;
    human.vx = this.vx;
    human.vy = this.vy;
    // 빠르게 달리다 뛰어내리면 구른다
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 3.2 && human.state !== 'dead') {
      human.knockDown(this.vx / sp, this.vy / sp, sp * 0.6, 1.2);
      human.damage(Math.max(0, (sp - 3) * 4), { kind: 'fall', source: null }, game);
    }
    if (!opts.silent) game?.events.emit('vehicle:exit', { human, vehicle: this, seat: i });
    this.onExit?.(human, game);
    return true;
  }

  ejectAll(game) {
    for (const s of this.seats) if (s.occupant) this.exit(s.occupant, game, { force: true });
  }

  /** 내릴 자리: 좌석 옆 → 반대편 → 뒤 → 앞 순서로 서 있을 수 있는 곳 */
  findExitSpot(seatIndex, game) {
    const w = game?.world;
    const s = this.seats[seatIndex];
    const c = Math.cos(this.angle), n = Math.sin(this.angle);
    const side = s.y >= 0 ? 1 : -1;
    const hw = this.width / 2 + 0.6, hl = this.length / 2 + 0.6;
    const cands = [
      [s.x, side * hw],
      [s.x, -side * hw],
      [-hl, 0],
      [hl, 0],
      [0, side * (hw + 1)],
      [0, -side * (hw + 1)],
    ];
    for (const [lx, ly] of cands) {
      const x = this.x + lx * c - ly * n, y = this.y + lx * n + ly * c;
      if (!w || canStand(w, x, y, 0.33, 'foot')) return { x, y };
    }
    // 배 위라면 물로 뛰어든다
    for (const [lx, ly] of cands) {
      const x = this.x + lx * c - ly * n, y = this.y + lx * n + ly * c;
      if (w && canStand(w, x, y, 0.33, 'swim')) return { x, y };
    }
    return null;
  }

  placeOccupants() {
    for (let i = 0; i < this.seats.length; i++) {
      const o = this.seats[i].occupant;
      if (!o) continue;
      const p = this.seatWorld(i);
      o.x = p.x;
      o.y = p.y;
      o.angle = this.seats[i].pose === 'ride' || !o.aiming ? p.angle : o.angle;
    }
  }

  // ------------------------------------------------------------ 갱신

  update(dt, game) {
    if (this.wrecked) {
      this.speed = approach(this.speed, 0, 8 * dt);
    } else {
      this.readControls(dt, game);
    }
    this.physics(dt, game);
    this.placeOccupants();
  }

  readControls(dt, game) {
    const d = this.driver;
    const c = this.ctl;
    if (d && d.isPlayer && d.state === 'normal') {
      this.playerControls(game.input, dt, game);
    } else if (this.autopilot && (!d || !d.isPlayer)) {
      // 나루·노선처럼 운행 자동조종이 있는 탈것은 운전하는 NPC 의 두뇌보다 자동조종이 먼저다
      // (이름 있는 사공의 두뇌가 나룻배를 엉뚱한 곳으로 몰던 문제)
      this.autopilot(dt, game);
    } else if (d && d.brain?.drive) {
      d.brain.drive(this, d, dt, game);
    } else {
      c.throttle = 0;
      c.steer = 0;
      c.sprint = false;
      c.brake = !d;
    }
  }

  /** 화면 기준 방향 조향: 누른 방향으로 머리를 돌리며 전진 */
  playerControls(input, dt, game) {
    const c = this.ctl;
    const a = input.axis();
    const mag = Math.min(1, Math.hypot(a.x, a.y));
    c.sprint = input.down('sprint');
    c.brake = input.down('brake');
    if (mag < 0.1) {
      c.throttle = 0;
      c.steer = 0;
      return;
    }
    const target = Math.atan2(a.y, a.x);
    let diff = angleWrap(target - this.angle);
    if (this.canReverse && Math.abs(diff) > 2.5 && this.speed < 0.8) {
      // 뒤쪽을 누르면 후진
      const back = angleWrap(target + Math.PI - this.angle);
      c.throttle = -mag;
      c.steer = clamp(-back * 2, -1, 1);
      return;
    }
    c.steer = clamp(diff * 2.2, -1, 1);
    c.throttle = mag * (Math.abs(diff) > 1.7 ? 0.25 : Math.abs(diff) > 0.9 ? 0.7 : 1);
  }

  /** 기본 물리: 땅 위 수레형 */
  physics(dt, game) {
    const c = this.ctl;
    const w = game.world;
    const mul = w?.speedMul ? w.speedMul(this.x, this.y, this.moveMode) : 1;
    const top = (c.sprint ? this.sprintSpeed : this.maxSpeed) * mul;
    let target = c.throttle >= 0 ? c.throttle * top : c.throttle * this.reverseSpeed * mul;
    if (c.brake) this.speed = approach(this.speed, 0, this.brakeDecel * dt);
    else {
      const rate = Math.abs(target) > Math.abs(this.speed) && Math.sign(target || 1) === Math.sign(this.speed || target || 1) ? this.accel : this.decel;
      this.speed = approach(this.speed, target, rate * dt);
    }
    const tf = clamp(Math.abs(this.speed) / this.turnRefSpeed, this.turnInPlace, 1);
    this.angle += c.steer * this.turnRate * tf * dt * (this.speed < -0.05 ? -1 : 1);
    this.integrate(dt, game);
  }

  /** speed·angle 로 속도를 만들고 이동. 옆 미끄러짐은 grip 으로 억제 */
  integrate(dt, game) {
    const fx = Math.cos(this.angle), fy = Math.sin(this.angle);
    const k = damp(this.grip, dt);
    this.vx = lerp(this.vx, fx * this.speed, k);
    this.vy = lerp(this.vy, fy * this.speed, k);
    const res = moveCircle(game.world, this, this.vx * dt, this.vy * dt, this.moveMode);
    if (res.hit) {
      const sp = Math.abs(this.speed);
      if (sp > 4 && game.time - this.lastHit > 0.5) {
        this.lastHit = game.time;
        this.onCrash?.(sp, game);
        game.events.emit('vehicle:crash', { vehicle: this, speed: sp });
        game.camera.shake(Math.min(0.5, sp * 0.04), 0.25);
      }
      this.speed *= 0.35;
      if (res.hitX) this.vx *= -0.2;
      if (res.hitY) this.vy *= -0.2;
    }
  }

  // ------------------------------------------------------------ 상호작용

  /** 플레이어가 타고 내릴 수 있는 거리 판정 (긴 탈것은 덮어쓴다) */
  interactDistance(actor) {
    // 탈것의 실제 몸통(길이 × 폭 회전 사각형) 바깥 테두리까지의 거리.
    // 중심 원으로 재면 8 m 나룻배·전차·기차는 가운데까지 다가가야 탈 수 있었다.
    const c = Math.cos(-this.angle), n = Math.sin(-this.angle);
    const dx = actor.x - this.x, dy = actor.y - this.y;
    const lx = dx * c - dy * n, ly = dx * n + dy * c;
    const qx = Math.max(Math.abs(lx) - (this.length || 0) / 2, 0);
    const qy = Math.max(Math.abs(ly) - (this.width || 0) / 2, 0);
    return Math.min(Math.hypot(qx, qy), Math.hypot(dx, dy) - this.radius);
  }

  getInteractions(actor, game) {
    if (!actor.isPlayer || actor.vehicle === this || this.wrecked) return [];
    const out = [];
    const di = this.freeSeatIndex('driver');
    const d = this.driver;
    if (this.playerCanDrive && di >= 0) {
      out.push({ key: 'enter', label: `${this.displayName} 타기`, priority: 5, run: (a) => this.enter(a, game, di) });
    } else if (this.playerCanDrive && d && !d.isPlayer && this.stealable) {
      out.push({ key: 'enter', label: `${this.displayName} 빼앗기`, priority: 4, run: (a) => this.steal(a, game) });
    } else {
      const pi = this.freeSeatIndex('passenger');
      if (pi >= 0) {
        const fare = this.fare;
        out.push({
          key: 'enter',
          label: fare ? `${this.displayName}에 오르기 (${fare}전)` : `${this.displayName}에 오르기`,
          priority: 3,
          run: (a) => this.boardPassenger(a, game, pi),
        });
      }
    }
    return out;
  }

  /** 승객으로 타기: 요금은 inventory 시스템이 있으면 낸다(돈이 없으면 무임승차 → 경범죄) */
  boardPassenger(actor, game, seatIndex) {
    if (this.fare > 0) {
      const inv = game.sys.inventory;
      if (inv?.spendMoney?.(this.fare)) game.notify(`삯 ${this.fare}전을 냈습니다`);
      else {
        game.notify('삯을 내지 않고 올라탔습니다', 'warn');
        game.events.emit('crime', { kind: 'fare_evasion', x: this.x, y: this.y, offender: actor, victim: this });
      }
    }
    this.enter(actor, game, seatIndex);
  }

  /** 남이 몰던 탈것 빼앗기 */
  steal(actor, game) {
    const d = this.driver;
    if (d) {
      this.exit(d, game, { force: true });
      const a = Math.atan2(d.y - this.y, d.x - this.x);
      d.knockDown(Math.cos(a), Math.sin(a), 3, 2);
      d.brain?.onRobbed?.(d, actor, game);
    }
    game.events.emit('crime', { kind: 'theft', x: this.x, y: this.y, offender: actor, victim: d || this });
    this.owner = 'stolen';
    this.enter(actor, game, this.freeSeatIndex('driver'));
  }

  /** 행인 치기 */
  onCollide(other, impact, game) {
    if (other.kind !== 'human' || other.vehicle) return;
    const sp = Math.hypot(this.vx, this.vy);
    const a = Math.atan2(other.y - this.y, other.x - this.x);
    if (this.tramplePush) {
      // 소달구지·가마: 넘어뜨리지 않고 1 m 밀기
      if (sp > 0.3) {
        other.x += Math.cos(a) * 0.15;
        other.y += Math.sin(a) * 0.15;
      }
      return;
    }
    if (sp < this.trampleThreshold) return;
    other.knockDown(Math.cos(a), Math.sin(a), sp * 0.7, 1.8);
    other.damage(Math.max(0, sp - this.trampleThreshold) * 7 * this.trampleMul, { kind: 'trample', source: this.driver || this }, game);
    const d = this.driver;
    game.events.emit('trample', { vehicle: this, victim: other, driver: d });
    if (d?.isPlayer && other.faction !== 'rival') game.events.emit('crime', { kind: 'assault', x: other.x, y: other.y, offender: d, victim: other });
    this.speed *= 0.8;
  }

  damage(amount, info = {}, game) {
    if (this.wrecked) return;
    this.hp -= amount;
    game?.events.emit('damage', { target: this, amount, ...info });
    if (this.hp <= 0) {
      this.hp = 0;
      this.wrecked = true;
      this.ejectAll(game);
      game?.events.emit('vehicle:wrecked', { vehicle: this, info });
    }
  }

  // ------------------------------------------------------------ 그리기

  draw(ctx, game) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    this.drawVehicle(ctx, game);
    this.drawOccupants(ctx, game);
    this.drawOver?.(ctx, game);
    ctx.restore();
  }

  /** 기본 모양: 나무 수레 */
  drawVehicle(ctx, game) {
    ctx.fillStyle = '#8a6a44';
    ctx.strokeStyle = '#1d1b18';
    ctx.lineWidth = 0.05;
    ctx.fillRect(-this.length / 2, -this.width / 2, this.length, this.width);
    ctx.strokeRect(-this.length / 2, -this.width / 2, this.length, this.width);
  }

  drawOccupants(ctx, game) {
    for (const s of this.seats) {
      const o = s.occupant;
      if (!o || s.pose === 'hidden') continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.facing || 0);
      if (o.aiming) ctx.rotate(angleWrap(o.aimAngle - this.angle - (s.facing || 0)));
      o.drawSeated(ctx, game, s.pose);
      ctx.restore();
    }
  }
}

export { LAYER };
