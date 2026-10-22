// 선로 차량: 전차(tram)·경인선 열차(train = 기관차+객차+화차 편성). 교행·시각표·요금·검표·장애물 (스펙 C.1·C.6·C.7·B.5)
import { Vehicle } from './vehicle.js';
import { PAL } from '../engine/palette.js';
import { approach, clamp, closestOnPolyline, pointAtDistance, rand } from '../engine/util.js';
import { SHADOW, ask, clearSpread, crime, drawDummies, flagOn, hourNow, lockRider, makeCrew, pay, setSpread, vehicleHit, warnAhead } from './common.js';

const S = (x, y, role = 'passenger', pose = 'sit', outside = false) => ({ x, y, role, pose, outside });
const SEATS = {
  tram() {
    const s = [S(4.1, 0, 'driver', 'stand'), S(-4.0, 0.6, 'crew', 'stand')];
    for (const x of [-1.5, -0.5, 0.5, 1.5]) for (const y of [-0.6, 0.6]) s.push(S(x, y)); // 2~9 상등
    for (const x of [-3.3, 3.3]) for (const y of [-0.6, -0.2, 0.2, 0.6]) s.push(S(x, y)); // 10~17 하등
    for (const x of [-4.4, 4.4]) for (const y of [-1.15, 1.15]) s.push(S(x, y, 'passenger', 'stand', true)); // 18~21 매달림
    return s;
  },
  loco: () => [S(-3.5, 0.6, 'driver', 'stand'), S(-3.5, -0.6, 'crew', 'stand')],
  coach() {
    const s = [];
    for (const x of [4, 2.4, -0.8, 0.8, -2.4, -4]) for (const y of [-0.65, 0.65]) s.push(S(x, y));
    for (const x of [-5.2, 5.2]) for (const y of [-1, 1]) s.push(S(x, y, 'passenger', 'stand', true));
    return s;
  },
  wagon: () => [S(0, -0.5, 'passenger', 'hidden'), S(0, 0.5, 'passenger', 'hidden')],
};
const CARS = {
  tram: { L: 9, W: 2.1, mass: 6000, hp: 800, name: '전차', seats: 'tram' },
  loco: { L: 9.13, W: 2.64, mass: 34300, hp: 3000, name: '기관차', seats: 'loco' },
  coach1: { L: 11, W: 2.6, mass: 12000, hp: 1200, name: '1·2등 객차', seats: 'coach', color: PAL.coach1 },
  coach3: { L: 11, W: 2.6, mass: 12000, hp: 1200, name: '3등 객차', seats: 'coach', color: PAL.coach3 },
  wagon: { L: 9, W: 2.6, mass: 9000, hp: 1200, name: '화차', seats: 'wagon' },
};

export class RailCar extends Vehicle {
  constructor(kind, opts = {}) {
    const C = CARS[kind] || CARS.tram, tram = kind === 'tram';
    super({
      displayName: C.name, moveMode: 'rail', length: C.L, width: C.W, radius: C.W / 2, mass: C.mass, hp: C.hp, maxSpeed: tram ? 4.5 : 15.3,
      cameraZoom: tram ? 0.85 : 0.6, stealable: false, playerCanDrive: false, owner: 'public', seats: SEATS[C.seats](),
      hitCircles: [-C.L / 3, 0, C.L / 3].map((x) => ({ x, y: 0, r: C.W / 2 })), trampleThreshold: 2, trampleMul: 2.5, ...opts, vtype: tram ? 'tram' : 'train',
    });
    this.carKind = kind;
    this.C = C;
    this.consist = null;
    this.interactRange = 2.5;
    this.lockT = this.burnT = this.crowd = 0;
  }
  update(dt, game) {
    this.lockT -= dt;
    if (this.burnT > 0) this.burnT -= dt;
    if (!this.consist) this.speed = this.vx = this.vy = 0; // 노선 밖 전차(미션·차고): 서 있다
    this.placeOccupants();
    for (const s of this.seats) if (s.occupant && !s.occupant.tags?.has('crew')) setSpread(s.occupant, this.vtype === 'train' && Math.abs(this.speed) > 10 ? 3 : 2);
  }
  /** 승강대까지 거리 (몸통 사각형) */
  interactDistance(a) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle), rx = a.x - this.x, ry = a.y - this.y;
    return Math.hypot(Math.max(0, Math.abs(rx * c + ry * s) - this.length / 2), Math.max(0, Math.abs(-rx * s + ry * c) - this.width / 2));
  }
  /** 정차 중이면 가장 가까운 빈자리, 달리는 중이면 매달리기 (속도차 전차 2.0 / 기차 3.0) */
  getInteractions(actor, game) {
    const k = this.consist;
    if (!actor.isPlayer || actor.vehicle || !k || k.noBoard || this.wrecked || this.carKind === 'loco') return [];
    const moving = Math.abs(this.speed) > 0.3;
    let best = -1, bd = Infinity;
    this.seats.forEach((s, i) => {
      if (s.occupant || s.role !== 'passenger' || (moving && !s.outside && s.pose !== 'hidden')) return;
      const p = this.seatWorld(i), d = Math.hypot(p.x - actor.x, p.y - actor.y) + (s.outside ? 0.5 : 0);
      if (d < bd) (bd = d), (best = i);
    });
    if (best < 0) return [];
    const cls = this.seatClass(best), label = moving ? `달리는 ${this.vtype === 'tram' ? '전차' : '열차'}에 매달리기` : `${this.displayName}에 오르기${cls ? ` (${cls})` : ''}`;
    return [{ key: 'enter', label, priority: 4, run: (a) => this.boardAt(a, best, moving, game) }];
  }
  seatClass(i) {
    if (this.carKind === 'tram') return i >= 2 && i <= 9 ? '상등' : '하등';
    if (this.carKind === 'coach1') return this.seats[i].x >= 2.4 ? '1등' : '2등';
    return this.carKind === 'coach3' ? '3등' : this.carKind === 'wagon' ? '숨기' : '';
  }
  boardAt(a, i, moving, game) {
    const lim = this.vtype === 'tram' ? 2 : 3, rel = Math.hypot(this.vx - a.vx, this.vy - a.vy);
    if (moving && rel > lim) {
      a.knockDown(Math.cos(this.angle), Math.sin(this.angle), 3, 1.2);
      return a.damage(Math.max(0, rel - 3) * 4 + 5, { kind: 'fall', source: null, x: a.x, y: a.y }, game);
    }
    if (!this.enter(a, game, i)) return;
    lockRider(this, a, moving ? (this.vtype === 'tram' ? 0.4 : 0.8) : this.vtype === 'tram' ? 0.6 : 1);
    this.consist.onBoard?.(a, this, i, game);
  }
  getRiderInteractions(p, game) {
    return this.consist?.riderItems?.(p, this, game) || [];
  }
  onExit(h) {
    clearSpread(h);
  }
  onCollide(o, impact, game) {
    if (vehicleHit(this, o, impact, game)) return void (this.consist && (this.consist.emerg = 1));
    if (o.vehicle || (o.kind !== 'human' && o.kind !== 'animal')) return;
    if (this.vtype === 'tram') return o.kind === 'human' && super.onCollide(o, impact, game);
    const sp = Math.abs(this.speed); // 기차: 3.0 이상 즉사, 미만 1.5 m 밀고 10
    if (sp >= 3) o.damage(9999, { kind: 'trample', source: this, x: o.x, y: o.y }, game);
    else if (sp > 0.3 && game.time - (o._railHit || -9) > 1) {
      o._railHit = game.time;
      o.knockDown?.(Math.cos(this.angle), Math.sin(this.angle), 6, 1.2);
      o.damage(10, { kind: 'trample', source: this, x: o.x, y: o.y }, game);
    }
  }
  burn() {
    this.burnT = 25;
    this.burnt = true;
    this.noBoard = true;
  }

  // ------------------------------------------------------------ 그리기 (B.5)
  drawVehicle(ctx, game) {
    const L = this.length, W = this.width, k = this.carKind, t = game.time;
    ctx.fillStyle = SHADOW;
    ctx.fillRect(-L / 2 + 0.2, -W / 2 + 0.25, L, W);
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.06;
    if (k === 'tram') {
      ctx.fillStyle = this.burnt ? '#2e2724' : PAL.tram;
      ctx.fillRect(-L / 2, -W / 2, L, W);
      ctx.strokeRect(-L / 2, -W / 2, L, W);
      ctx.fillStyle = this.burnt ? '#3a332e' : '#b89a72'; // 앞뒤 승강대 2.2 m (하등)
      for (const x of [-L / 2 + 0.15, L / 2 - 2.35]) ctx.fillRect(x, -W / 2 + 0.15, 2.2, W - 0.3);
    } else if (k === 'loco') {
      ctx.fillStyle = '#333133';
      ctx.fillRect(-L / 2, -W / 2, L, W);
      ctx.strokeRect(-L / 2, -W / 2, L, W);
      ctx.fillStyle = '#4a4648'; // 양옆 물탱크
      for (const y of [-W / 2 + 0.1, W / 2 - 0.55]) ctx.fillRect(-1.6, y, 4.6, 0.45);
      ctx.fillStyle = '#1f1d1e'; // 보일러 5.0×1.3
      ctx.beginPath();
      ctx.roundRect?.(-1.6, -0.65, 5.0, 1.3, 0.6) ?? ctx.rect(-1.6, -0.65, 5.0, 1.3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#121112';
      ctx.beginPath();
      ctx.arc(2.9, 0, 0.3, 0, Math.PI * 2); // 굴뚝
      ctx.fill();
      ctx.fillStyle = PAL.seal;
      ctx.fillRect(L / 2 - 0.12, -W / 2, 0.12, W);
    } else {
      ctx.fillStyle = k === 'wagon' ? '#5e5246' : this.C.color;
      ctx.fillRect(-L / 2, -W / 2, L, W);
      ctx.strokeRect(-L / 2, -W / 2, L, W);
      if (k === 'coach1') (ctx.strokeStyle = PAL.gold), ctx.strokeRect(-L / 2 + 0.12, -W / 2 + 0.12, L - 0.24, W - 0.24);
      if (k === 'wagon') {
        ctx.strokeStyle = 'rgba(29,27,24,0.4)';
        for (let x = -L / 2 + 1; x < L / 2; x += 1) ctx.beginPath(), ctx.moveTo(x, -W / 2), ctx.lineTo(x, W / 2), ctx.stroke();
      }
    }
    drawDummies(ctx, this, this.crowd, this.id.length);
  }
  drawOver(ctx, game) {
    const L = this.length, W = this.width, k = this.carKind, t = game.time, me = this.hasPlayer;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.05;
    if (k === 'tram') {
      ctx.globalAlpha = me ? 0.45 : 0.9;
      ctx.fillStyle = this.burnt ? '#1f1a18' : '#5a2a20'; // 가운데 4.6 m 지붕 칸 (상등)
      ctx.fillRect(-2.3, -W / 2 - 0.05, 4.6, W + 0.1);
      ctx.strokeRect(-2.3, -W / 2 - 0.05, 4.6, W + 0.1);
      ctx.globalAlpha = 1;
      if (!this.burnt) {
        const back = this.consist?.dir < 0 ? 1 : -1; // 집전봉 3.3 m, 뒤로 눕힌다
        ctx.strokeStyle = PAL.ink2;
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(back * 3.3, 0.15);
        ctx.stroke();
      }
    } else if (k === 'coach1' || k === 'coach3') {
      ctx.globalAlpha = me ? 0.35 : 0.85;
      ctx.fillStyle = k === 'coach1' ? '#252d45' : '#55473a';
      ctx.fillRect(-L / 2 + 0.3, -W / 2 + 0.1, L - 0.6, W - 0.2);
      ctx.globalAlpha = 1;
    } else if (k === 'loco' && (Math.abs(this.speed) > 0.2 || this.consist?.state !== 'idle')) {
      for (let i = 0; i < 5; i++) {
        const q = (t * 0.8 + i / 5) % 1;
        ctx.fillStyle = `rgba(70,66,62,${0.4 * (1 - q)})`;
        ctx.beginPath();
        ctx.arc(2.9 - q * (2 + Math.abs(this.speed) * 0.6), Math.sin(i * 1.7 + t) * 0.4 * q, 0.6 + q * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.burnT > 0) {
      for (let i = 0; i < 8; i++) {
        const q = (t * 1.3 + i / 8) % 1;
        ctx.fillStyle = `rgba(${200 + i * 6},${90 + i * 10},40,${0.6 * (1 - q)})`;
        ctx.beginPath();
        ctx.arc(-L / 2 + (i + 0.5) * (L / 8), Math.sin(i * 3.1) * 0.6 - q * 1.5, 0.4 + q, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ---------------------------------------------------------------- 편성: 맨 앞 차의 d·방향·속도로 줄줄이
export class Consist {
  constructor(game, line, kinds, o = {}) {
    this.line = line;
    this.d = o.d ?? 0;
    this.dir = o.dir ?? 1;
    this.speed = 0;
    this.lat = 0;
    this.state = 'idle';
    this.cars = kinds.map((k, i) => {
      const c = game.add(new RailCar(k, { id: o.id && !i ? o.id : undefined }));
      c.consist = this;
      c.persistent = true;
      return c;
    });
    this.off = [0];
    for (let i = 1; i < this.cars.length; i++) this.off[i] = this.off[i - 1] + this.cars[i - 1].length / 2 + 1.2 + this.cars[i].length / 2;
    this.place();
  }
  get lead() {
    return this.cars[0];
  }
  get playerCar() {
    return this.cars.find((c) => c.hasPlayer) || null;
  }
  place() {
    const L = this.line;
    this.cars.forEach((car, i) => {
      const d = this.d - this.dir * this.off[i], h = car.length / 3;
      const a = pointAtDistance(L.points, d - h, L.cum), b = pointAtDistance(L.points, d + h, L.cum);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      car.x = (a.x + b.x) / 2 - Math.sin(ang) * this.lat;
      car.y = (a.y + b.y) / 2 + Math.cos(ang) * this.lat;
      car.angle = ang + (this.dir < 0 ? Math.PI : 0);
      car.speed = this.speed;
      car.vx = Math.cos(car.angle) * this.speed;
      car.vy = Math.sin(car.angle) * this.speed;
    });
  }
  /** 기관차가 다시 앞에 서도록 뒤집는다 (종점 기관차 돌려 붙이기) */
  reverse() {
    this.d -= this.dir * this.off[this.off.length - 1];
    this.dir = -this.dir;
  }
  remove() {
    for (const c of this.cars) {
      for (const s of c.seats) if (s.occupant) s.occupant.tags?.has('crew') ? (s.occupant.alive = false) : c.exit(s.occupant, null, { force: true });
      c.alive = false;
    }
    this.cars = [];
  }
  /** 앞쪽 장애물까지 거리 (사람·동물·탈것·'rail_obstacle'). 행인은 종·기적에 비킨다 */
  scan(game, from, sight, warn) {
    const L = this.line, own = new Set(this.cars);
    let best = null;
    for (let s = from; s <= from + sight; s += 5) {
      const p = pointAtDistance(L.points, this.d + this.dir * s, L.cum);
      for (const e of game.query(p.x, p.y, 1.8, (e) => !own.has(e) && !e.vehicle && e.alive && (e.tags?.has('rail_obstacle') || (e.solid && (e.kind === 'human' || e.kind === 'animal' || e.kind === 'vehicle'))))) {
        if (e.kind === 'human' && !e.isPlayer && e.state === 'normal' && s > 8) {
          warn?.(s);
          if ((e.speedNow || 0) > 0.5 || s > 40) continue; // 걸어가는 행인은 비킨다고 본다
        }
        best = Math.min(best ?? Infinity, s);
      }
      if (best != null) break;
    }
    return best;
  }
}

// ---------------------------------------------------------------- 전차 운행 (C.6)
const SID = [0, 216.9, 612, 832, 978.9, 1187.4, 1333.3]; // 교행 측선
const BOUND = [612, 979, 1187, 1333.3]; // 요금 구간 경계 (0 다음)
const LOWER = [2, 3, 5, 6], UPPER = [4, 7, 11, 14];
export class TramService {
  constructor(game, line) {
    this.line = line;
    this.trams = [];
    this.spares = [];
    this.blocks = SID.slice(1).map(() => new Set());
    this.lastDep = [-1e9, -1e9];
    this.hail = null;
  }
  sd(id) {
    return this.line.stops.find((s) => s.id === id)?.d ?? 0;
  }
  crew(game, c) {
    const car = c.lead, jp = !flagOn(game, 'tram_resumed');
    if (!car.driver) makeCrew(game, car, 0, { name: '운전수', role: 'foreigner', faction: 'company', lookOver: jp ? { coat: '#34405a', hat: 'cap' } : { coat: '#3b3530', hat: 'western' }, brain: 'idle' });
    if (!car.seats[1].occupant) makeCrew(game, car, 1, { name: '차장', role: 'porter', faction: 'company', brain: 'idle' });
  }
  setup(game) {
    const lay = [[0, 1], [2, -1], [3, 1], [4, -1], [6, -1]];
    for (const [i, dir] of lay) {
      const c = new Consist(game, this.line, ['tram'], { d: SID[i], dir });
      c.blk = -1;
      c.state = i === 0 || i === 6 ? 'term' : 'run';
      c.wait = 10 + rand.next() * 30;
      this.crew(game, c);
      this.trams.push(c);
    }
    const dep = game.world.buildings?.find?.((b) => b.id === 'tram_depot') || { x: 3215, y: 740, h: 14 };
    for (let k = 0; k < 3; k++) {
      const v = game.add(new RailCar('tram', { x: dep.x - 10 + k * 10, y: dep.y + (dep.h || 14) / 2 + 6, angle: Math.PI / 2 }));
      v.noBoard = true;
      v.persistent = true;
      this.spares.push(v);
    }
  }
  /** 운행 여부: tram_running 이고 운휴(tram_suspended~tram_resumed)가 아님 */
  serviceOn(game) {
    return flagOn(game, 'tram_running') && (!game.flags?.tram_suspended || flagOn(game, 'tram_resumed'));
  }
  canEnter(b, c) {
    for (const o of this.blocks[b]) if (o !== c && (o.dir !== c.dir || (o.d - c.d) * c.dir < 70)) return false;
    return true;
  }
  update(dt, game) {
    if (!this.trams.length) this.setup(game);
    const on = this.serviceOn(game), h = hourNow(game), hours = h >= 6 && h < 20;
    if (this.hail && ((this.hail.t -= dt) <= 0 || Math.hypot(game.player.x - this.hail.x, game.player.y - this.hail.y) > 6 || game.player.vehicle)) this.hail = null;
    for (const c of this.trams) {
      c.noBoard = !on;
      if (!on) {
        this.park(c, game, 978.9 + (this.trams.indexOf(c) - 2) * 11); // 운휴: 동대문 차고 앞 측선
        continue;
      }
      if (c.parked) {
        if (!hours || game.camera.visible(c.lead.x, c.lead.y, 20)) continue;
        c.parked = false; // 아침: 측선으로 다시 나온다
        c.lead.hidden = false;
        c.lead.solid = true;
      }
      if (!c.lead.driver) {
        c.speed = approach(c.speed, 0, 2.2 * dt);
        if (!game.camera.visible(c.lead.x, c.lead.y, 10)) this.crew(game, c);
      } else this.step(c, dt, game, hours);
      c.place();
      if (c.lead.hasPlayer) this.fare(c, dt, game);
    }
  }
  park(c, game, d) {
    if (c.parkD === d) return;
    if (game.camera.visible(c.lead.x, c.lead.y, 10) && c.parkD == null && Math.abs(c.speed) > 0.1) return void (c.speed = approach(c.speed, 0, 1.1 / 60));
    for (const b of this.blocks) b.delete(c);
    c.lead.ejectAll(game);
    Object.assign(c, { parkD: d, d, speed: 0, lat: 3.2, blk: -1, nb: null, state: 'term', stopAt: null });
    c.place();
  }
  step(c, dt, game, hours) {
    c.parkD = null;
    const dir = c.dir;
    const si = SID.findIndex((x) => Math.abs(x - c.d) < 1);
    // 블록: 지금 블록 끝 측선에 닿으면 놓고, 다음 블록은 미리 잡는다
    if (c.blk >= 0) {
      const end = dir > 0 ? SID[c.blk + 1] : SID[c.blk];
      if ((end - c.d) * dir < 0.8) this.blocks[c.blk].delete(c), (c.blk = c.nb ?? -1), (c.nb = null);
    }
    const here = c.blk >= 0 ? null : si >= 0 ? si : SID.findIndex((x, i) => i < SID.length - 1 && (x - c.d) * (SID[i + 1] - c.d) < 0);
    let holdAt = null;
    if (c.blk < 0 && here != null) {
      const nb = dir > 0 ? here : here - 1;
      if (c.state === 'term' && (c.wait -= dt) > 0) holdAt = c.d;
      else if (nb < 0 || nb >= this.blocks.length || (c.state === 'term' && (!hours || game.time - this.lastDep[dir > 0 ? 0 : 1] < 160)) || !this.canEnter(nb, c)) holdAt = c.d;
      else {
        this.blocks[nb].add(c);
        c.blk = nb;
        if (c.state === 'term') (this.lastDep[dir > 0 ? 0 : 1] = game.time), (c.state = 'run'), (c.decided = new Set()), (c.lead.crowd = rand.next() * 0.6), game.emit('rail:depart', { line: 'tram', stop: this.stopNear(c.d), vehicle: c.lead, playerAboard: c.lead.hasPlayer });
      }
      c.waited = holdAt != null ? (c.waited || 0) + dt : 0;
      if (c.waited > 150 && !game.camera.visible(c.lead.x, c.lead.y, 10)) (c.dir = -c.dir), (c.waited = 0); // 안전판: 오래 막히면 되돌아간다
    } else if (c.blk >= 0 && c.nb == null) {
      const end = dir > 0 ? SID[c.blk + 1] : SID[c.blk], nb = dir > 0 ? c.blk + 1 : c.blk - 1, dist = (end - c.d) * dir;
      const term = nb < 0 || nb >= this.blocks.length;
      if (term) {
        if (dist < 0.8 && c.speed < 0.2) return this.terminal(c, game, hours);
        holdAt = end;
      } else if (dist < 30 && this.canEnter(nb, c)) this.blocks[nb].add(c), (c.nb = nb);
      else holdAt = end;
    }
    c.lat = approach(c.lat, holdAt != null && c.blk < 0 ? 3.2 : 0, 1.5 * dt);
    // 정류: 손 든 사람, 요청, 요금 경계 표석 (50%)
    const hl = this.hail;
    if (hl && c.stopAt == null && !hl.claimed && c.lat < 1 && (hl.d - c.d) * dir > 15 && (hl.d - c.d) * dir < 120) (c.stopAt = hl.d + dir * 3.5), (hl.claimed = c);
    for (const s of this.line.stops) if (c.decided && !c.decided.has(s.id) && (s.d - c.d) * dir > 10 && (s.d - c.d) * dir < 40) c.decided.add(s.id), rand.chance(0.5) && c.stopAt == null && (c.stopAt = s.d);
    // 속도
    let v = flagOn(game, 'tram_festival') || game.flags?.date === '1899-05-17' ? (c.d > 612 && c.d < 800 ? 3 : 4.5) : 4.5;
    const lim = (at, pad = 0) => at != null && (at - c.d) * dir > -1 && (v = Math.min(v, Math.sqrt(2 * 1.1 * Math.max(0, (at - c.d) * dir - pad))));
    lim(holdAt);
    lim(c.stopAt);
    for (const o of this.trams) if (o !== c && !o.parked && (o.d - c.d) * dir > 0 && (o.d - c.d) * dir < 90 && (o.dir === dir || o.lat < 1)) lim(o.d, o.dir === dir ? 60 : 12);
    if ((c.scanT = (c.scanT || 0) - dt) <= 0) {
      c.scanT = 0.2;
      c.obst = c.state === 'dwell' ? null : c.scan(game, 4.5, 25, (s) => {
        if (game.time - (c.bellT || -9) > 2) (c.bellT = game.time), game.sfx('tram_bell', { x: c.lead.x, y: c.lead.y }), warnAhead(game, c.lead, 25, 1);
      });
    }
    if (c.obst != null) v = Math.min(v, Math.sqrt(2 * 2.2 * Math.max(0, c.obst - 2)));
    if (c.state === 'dwell') v = 0;
    const emerg = c.obst != null && c.obst < 8;
    c.speed = approach(c.speed, v, (v < c.speed ? (emerg ? 2.2 : 1.1) : 0.7) * dt);
    c.d += dir * c.speed * dt;
    if (c.state === 'dwell' && (c.wait -= dt) <= 0) (c.state = 'run'), game.emit('rail:depart', { line: 'tram', stop: this.stopNear(c.d), vehicle: c.lead, playerAboard: c.lead.hasPlayer });
    if (c.stopAt != null && Math.abs(c.stopAt - c.d) < 0.6 && c.speed < 0.2) this.dwell(c, game);
  }
  dwell(c, game) {
    c.stopAt = null;
    c.state = 'dwell';
    c.wait = 6 + rand.int(0, 3); // 6초 + 타고 내리는 사람 1명당 1초
    if (this.hail?.claimed === c) this.hail = null;
    game.emit('rail:arrive', { line: 'tram', stop: this.stopNear(c.d), vehicle: c.lead, playerAboard: c.lead.hasPlayer });
    if (c.fareInfo?.evade && c.lead.hasPlayer) this.evict(c, game);
  }
  terminal(c, game, hours) {
    for (const b of this.blocks) b.delete(c);
    c.blk = -1;
    c.nb = null;
    c.stopAt = null;
    c.speed = 0;
    c.dir = -c.dir; // 종점: 30초 뒤 angle += π
    c.state = 'term';
    c.wait = 30;
    game.emit('rail:arrive', { line: 'tram', stop: this.stopNear(c.d), vehicle: c.lead, playerAboard: c.lead.hasPlayer });
    if (c.fareInfo?.evade && c.lead.hasPlayer) this.evict(c, game);
    if (!hours && !c.lead.hasPlayer) (c.parked = true), (c.lead.hidden = true), (c.lead.solid = false), c.lead.ejectAll(game); // 밤: 차고로 들어간 셈
  }
  stopNear(d) {
    return this.line.stops.find((s) => Math.abs(s.d - d) < 30)?.id || null;
  }
  /** 선로 중심 4 m 안에서 E (손 들기 1초) */
  offer(actor, game) {
    if (actor.vehicle || !this.serviceOn(game)) return null;
    const cp = closestOnPolyline(this.line.points, actor.x, actor.y, this.line.cum);
    if (cp.dist > 4) return null;
    return { key: 'interact', label: this.hail ? '전차를 기다리는 중' : '손 들어 전차 세우기', priority: 1, d: 1.5, run: () => ((this.hail = { x: actor.x, y: actor.y, d: cp.d, t: 90 }), actor.say?.('여보시오, 전차!', 1.5)) };
  }
  riderItems(p, car, game) {
    const c = car.consist;
    if (c.state === 'dwell' || c.state === 'term' || c.stopAt != null) return [];
    return [{ key: 'interact', label: '"내리겠소"', priority: 2, run: () => (c.stopAt = c.d + c.dir * Math.max(20, (c.speed * c.speed) / 2.2 + 2)) }];
  }
  /** 요금 (C.6): 탄 뒤 8초에 차장이 묻는다. 구간 수 고르기, 산 구간을 넘으면 다시 */
  fare(c, dt, game) {
    const car = c.lead, p = game.player, si = car.seats.findIndex((s) => s.occupant === p);
    if (si < 0) return;
    const f = (c.fareInfo ??= { t: 8, paidTo: null, upper: si >= 2 && si <= 9, hang: si >= 18, hangT: 5 });
    if (f.asking || f.evade) return;
    if (f.hang) {
      if ((f.hangT -= dt) <= 0 && ((f.hangT = 5), rand.chance(0.25))) (f.hang = false), (f.t = 0), car.seats[1].occupant?.say?.('매달린 양반, 삯을 내시오!', 3);
      return;
    }
    if (f.paidTo != null && (c.d - f.paidTo) * c.dir > 0.5) (f.paidTo = null), (f.t = 0);
    if (f.paidTo != null || (f.t -= dt) > 0) return;
    const ahead = BOUND.concat([0]).filter((b) => (b - c.d) * c.dir > 1).sort((a, b) => (a - b) * c.dir);
    if (!ahead.length) return void (f.paidTo = c.d + c.dir * 999);
    if (game.sys.vehicles?.waiveFares) return void (f.paidTo = ahead[ahead.length - 1]);
    const n = Math.min(4, ahead.length), price = f.upper ? UPPER : LOWER;
    const opts = [];
    for (let i = 0; i < n; i++) opts.push(`${i + 1}구간 ${price[i]}전`);
    f.asking = true;
    ask(game, `차장: ${f.upper ? '상등' : '하등'} 삯이오. 몇 구간 가시오?`, opts.concat(['안 낸다'])).then((i) => {
      f.asking = false;
      if (i >= 0 && i < n && pay(game, price[i], 'tram')) return void ((f.paidTo = ahead[i]), game.emit('fare', { line: 'tram', amount: price[i] }));
      f.evade = true;
      car.seats[1].occupant?.say?.('삯을 안 내면 내리시오!', 3);
    });
  }
  evict(c, game) {
    const p = game.player;
    c.lead.seats[1].occupant?.say?.('내리시오!', 3);
    c.lead.exit(p, game, { force: true });
    crime(game, 'fare_evasion', p.x, p.y, p, c.lead);
    c.fareInfo = null;
  }
  /** M02: 그 정류점에 withinSec 초 안에 전차가 오게 한다 */
  forceArrival(stopId, withinSec = 20, game) {
    const sd = this.sd(stopId);
    let c = this.trams.filter((t) => !t.lead.hasPlayer).sort((a, b) => Math.abs(a.d - sd) - Math.abs(b.d - sd))[0];
    if (!c) return false;
    const back = 4.5 * withinSec * 0.85;
    const dir = sd - back >= 5 ? 1 : -1;
    for (const b of this.blocks) b.delete(c);
    Object.assign(c, { parked: false, parkD: null, dir, d: clamp(sd - dir * back, 2, this.line.length - 2), speed: 4.5, state: 'run', blk: -1, nb: null, lat: 0, stopAt: sd + dir * 3.5, forced: true });
    c.blk = SID.findIndex((x, i) => i < SID.length - 1 && SID[i] <= c.d && SID[i + 1] >= c.d);
    if (c.blk >= 0) this.blocks[c.blk].add(c);
    c.lead.hidden = false;
    c.lead.solid = true;
    for (const o of this.trams) if (o !== c && o.blk === c.blk && o.dir !== dir && !o.lead.hasPlayer) this.park(o, game, SID[c.blk + (dir > 0 ? 1 : 0)]), (o.parkD = null), (o.state = 'term'), (o.wait = 30);
    c.place();
    return true;
  }
}

// ---------------------------------------------------------------- 경인선 운행 (C.7)
const RUNS = {
  open: [[7, 'jemulpo', 'noryangjin'], [9, 'noryangjin', 'jemulpo'], [13, 'jemulpo', 'noryangjin'], [15, 'noryangjin', 'jemulpo']],
  trial: [[10, 'jemulpo', 'sosa'], [11, 'sosa', 'jemulpo'], [14, 'jemulpo', 'sosa'], [15, 'sosa', 'jemulpo']],
};
const DUR = { open: 1.67, trial: 0.95 };
/** 시각표 (출발 시각 기준 경과 게임시): 중간역 출발 */
const TT = { jemulpo: { chukhyeon: 0.33, sosa: 0.85, oryu: 1.32, noryangjin: 1.67 }, noryangjin: { oryu: 0.37, sosa: 0.87, chukhyeon: 1.38, jemulpo: 1.67 } };
export const SLOW_ZONES = [{ line: 'train', d0: 804.1, d1: 924.1, speed: 8, sightLimit: 60 }];
const CROSS = [897.7, 1933.1, 1993.3];
const FARE = {};
'noryangjin-oryu:40,25,15|noryangjin-sosa:85,45,25|noryangjin-chukhyeon:130,70,35|noryangjin-jemulpo:150,80,40|oryu-sosa:45,25,15|oryu-chukhyeon:90,50,25|oryu-jemulpo:115,60,30|sosa-chukhyeon:50,25,15|sosa-jemulpo:70,40,20|chukhyeon-jemulpo:40,20,10'
  .split('|').forEach((s) => {
    const [k, v] = s.split(':'), [a, b] = k.split('-');
    FARE[k] = FARE[`${b}-${a}`] = v.split(',').map(Number);
  });
export const trainFare = (a, b, cls) => FARE[`${a}-${b}`]?.[cls - 1] ?? 40;

export class TrainService {
  constructor(game, line) {
    this.line = line;
    this.mode = 'none';
    this.c = null;
    this.done = new Set();
    this.req = new Set();
    this.sightLimit = 60;
  }
  sd(id) {
    return this.line.stops.find((s) => s.id === id)?.d ?? 0;
  }
  leadAt(id, dir) {
    return clamp(this.sd(id) + dir * (this.mode === 'open' ? 22.6 : 9), 5, this.line.length - 5);
  }
  update(dt, game) {
    const mode = flagOn(game, 'rail_open') ? 'open' : flagOn(game, 'rail_trial') ? 'trial' : 'none';
    if (mode !== this.mode) {
      this.c?.remove();
      this.c = null;
      this.mode = mode;
      if (mode !== 'none') this.build(game);
    }
    const c = this.c;
    if (!c) return;
    if (!c.lead.driver && !game.camera.visible(c.lead.x, c.lead.y, 10)) makeCrew(game, c.lead, 0, { name: '기관사', role: 'foreigner', faction: 'company', lookOver: { coat: '#34405a', hat: 'cap' }, brain: 'idle' });
    this.step(c, dt, game);
    c.place();
    if (c.playerCar) this.inspect(c, dt, game);
  }
  build(game) {
    const c = (this.c = new Consist(game, this.line, this.mode === 'open' ? ['loco', 'coach1', 'coach3', 'coach3', 'wagon'] : ['loco', 'wagon', 'wagon'], { id: 'train_1' }));
    c.max = this.mode === 'open' ? 15.3 : 8;
    c.svc = this;
    c.onBoard = (a, car, i) => this.onBoard(a, car, i, game);
    c.riderItems = (p, car) => this.riderItems(p, car, game);
    makeCrew(game, c.lead, 0, { name: '기관사', role: 'foreigner', faction: 'company', lookOver: { coat: '#34405a', hat: 'cap' }, brain: 'idle' });
    makeCrew(game, c.lead, 1, { name: '화부', role: 'porter', faction: 'company', brain: 'idle' });
    this.resync(game);
  }
  /** 시각에 맞춰 편성 자리를 다시 잡는다 */
  resync(game) {
    const c = this.c;
    if (!c) return;
    const h = hourNow(game), day = game.sys.time?.day ?? 1, runs = RUNS[this.mode], dur = DUR[this.mode];
    let at = runs[0][1], run = null;
    for (const r of runs) {
      if (h >= r[0] + dur) (at = r[2]), this.done.add(`${day}:${r[0]}`);
      else if (h >= r[0]) (run = r), this.done.add(`${day}:${r[0]}`);
    }
    c.speed = 0;
    if (run) {
      const from = this.leadAt(run[1], 1), to = this.leadAt(run[2], 1), dir = Math.sign(to - from);
      if (c.dir !== dir) c.reverse();
      c.d = from + (to - from) * ((h - run[0]) / dur);
      Object.assign(c, { state: 'run', at: null, from: run[1], stops: this.stopsFor(run, c.d, dir) });
    } else {
      const dir = this.sd(at) > this.line.length / 2 ? -1 : 1; // 다음에 떠날 쪽을 본다
      if (c.dir !== dir) c.reverse();
      Object.assign(c, { state: 'idle', at, d: this.leadAt(at, dir), stops: [] });
    }
    c.place();
  }
  stopsFor(run, d, dir) {
    const to = this.sd(run[2]);
    return this.line.stops.filter((s) => (s.d - d) * dir > 1 && (to - s.d) * dir >= 0 && (s.id !== 'oryu' || this.req.has('oryu') || s.id === run[2])).sort((a, b) => (a.d - b.d) * dir).map((s) => s.id);
  }
  step(c, dt, game) {
    const h = hourNow(game), day = game.sys.time?.day ?? 1;
    if (c.state === 'idle') {
      c.speed = 0;
      const run = RUNS[this.mode].find((r) => r[1] === c.at && h >= r[0] && h < r[0] + 1 && !this.done.has(`${day}:${r[0]}`));
      if (!run) return;
      this.done.add(`${day}:${run[0]}`);
      const dir = Math.sign(this.sd(run[2]) - this.sd(run[1]));
      if (c.dir !== dir) c.reverse(), (c.d = this.leadAt(c.at, dir));
      Object.assign(c, { state: 'dwell', wait: 2, from: run[1], stops: this.stopsFor(run, c.d, dir), whistled: new Set() });
      for (const car of c.cars) car.crowd = car.carKind.startsWith('coach') ? 0.3 + rand.next() * 0.5 : 0;
      game.sfx('train_whistle', { x: c.lead.x, y: c.lead.y }); // 출발 2초 전
      return;
    }
    if (c.state === 'dwell') {
      c.speed = 0;
      if ((c.wait -= dt) <= 0) (c.state = 'run'), (c.inspT = 20 + rand.next() * 40), game.emit('rail:depart', { line: 'train', stop: c.at, vehicle: c.lead, playerAboard: !!c.playerCar });
      return;
    }
    if (this.req.has('oryu') && !c.stops.includes('oryu') && (this.sd('oryu') - c.d) * c.dir > 60) c.stops.unshift('oryu'), c.stops.sort((a, b) => (this.sd(a) - this.sd(b)) * c.dir);
    const next = c.stops[0];
    if (!next) return void (c.state = 'idle');
    const dir = c.dir, dist = (this.leadAt(next, dir) - c.d) * dir;
    let v = Math.min(c.max, Math.sqrt(2 * 1.2 * Math.max(0, dist)));
    const z = SLOW_ZONES[0], zd = dir > 0 ? z.d0 - c.d : c.d - z.d1, tail = c.d - dir * c.off[c.off.length - 1];
    const inZone = (c.d >= z.d0 && c.d <= z.d1) || (tail >= z.d0 && tail <= z.d1);
    if (inZone) v = Math.min(v, z.speed);
    else if (zd > 0) v = Math.min(v, Math.sqrt(z.speed ** 2 + 2 * 1.2 * zd));
    if (game.sys.time?.weather === 'fog') v = Math.min(v, 10);
    if (!c.lead.driver) v = 0;
    if ((c.scanT = (c.scanT || 0) - dt) <= 0) {
      c.scanT = 0.25;
      const sight = inZone ? this.sightLimit : game.sys.time?.isNight?.() ? 90 : 180;
      c.obst = c.scan(game, c.lead.length / 2, sight, (s) => {
        if (game.time - (c.whT || -9) > 4) (c.whT = game.time), game.sfx('train_whistle', { x: c.lead.x, y: c.lead.y }), warnAhead(game, c.lead, Math.min(60, s + 10), 1);
      });
    }
    if (c.obst != null) v = Math.min(v, Math.sqrt(2 * 1.6 * Math.max(0, c.obst - 12)));
    const emerg = c.obst != null || c.emerg;
    c.emerg = 0;
    c.speed = approach(c.speed, v, (v < c.speed ? (emerg ? 1.6 : 1.2) : 1.0) * dt);
    c.d += dir * c.speed * dt;
    for (const x of CROSS) if (!c.whistled?.has(x) && (x - c.d) * dir > 0 && (x - c.d) * dir < 150) c.whistled?.add(x), game.sfx('train_whistle', { x: c.lead.x, y: c.lead.y }); // 건널목 150 m 전
    if (dist < 0.5 && c.speed < 0.3) this.arrive(c, next, game);
  }
  arrive(c, stop, game) {
    c.stops.shift();
    c.speed = 0;
    c.at = stop;
    c.state = c.stops.length ? 'dwell' : 'idle';
    c.wait = 6;
    this.req.delete(stop);
    game.emit('rail:arrive', { line: 'train', stop, vehicle: c.lead, playerAboard: !!c.playerCar });
    game.sys.vehicles?.fastForward?.(1);
    const car = c.playerCar;
    if (car && c.evader) {
      const p = game.player;
      car.exit(p, game, { force: true });
      game.notify('차장이 열차에서 내리라 한다', 'warn');
      if (stop === 'jemulpo' || stop === 'noryangjin') crime(game, 'fare_evasion', p.x, p.y, p, car);
      c.evader = false;
    }
  }
  onBoard(a, car, i, game) {
    const c = this.c;
    c.board = { from: c.at || c.from, cls: car.carKind === 'coach1' ? (car.seats[i].x >= 2.4 ? 1 : 2) : 3, hidden: car.carKind === 'wagon', checked: false };
    c.evader = false;
    c.inspT = c.state === 'run' ? 20 + rand.next() * 40 : c.inspT;
    if (this.mode === 'trial') crime(game, 'trespass', a.x, a.y, a, car); // 시운전 열차 몰래 타기
  }
  riderItems(p, car, game) {
    const c = this.c, out = [];
    if (c.state === 'run' && !c.stops.includes('oryu') && (this.sd('oryu') - c.d) * c.dir > 80) out.push({ key: 'interact', label: '"오류동에서 내리겠소"', priority: 2, run: () => this.req.add('oryu') });
    return out;
  }
  /** 검표 (C.7): 출발 뒤 20~60초. 3등 60%, 1·2등 100%. 화차 숨기는 30초마다 15% 발견 */
  inspect(c, dt, game) {
    const b = c.board;
    if (!b || c.state !== 'run' || b.checked || c.asking || game.sys.vehicles?.waiveFares) return;
    if (b.hidden) {
      if ((b.hideT = (b.hideT ?? 30) - dt) <= 0) (b.hideT = 30), rand.chance(0.15) && ((b.hidden = false), (c.inspT = 0), game.notify('화차에 숨은 것이 들켰다!', 'warn'));
      return;
    }
    if ((c.inspT -= dt) > 0) return;
    b.checked = true;
    if (b.cls === 3 && !rand.chance(0.6) && !c.playerCar.seats.some((s) => s.outside && s.occupant?.isPlayer)) return;
    const inv = game.sys.inventory;
    for (let k = 1; k <= b.cls; k++) if (inv?.has?.(`ticket_train_${k}`)) return void (inv.remove(`ticket_train_${k}`, 1), game.notify('차장이 표에 구멍을 뚫었다'));
    if (!inv) return;
    const fine = trainFare(b.from, c.stops[c.stops.length - 1] || 'jemulpo', b.cls) * 2;
    c.asking = true;
    ask(game, `차장: 표를 보여 주시오. 없으면 벌금 ${fine}전이오.`, [`벌금 ${fine}전을 낸다`, '못 낸다']).then((i) => {
      c.asking = false;
      if (i === 0 && pay(game, fine, 'train_fine')) return game.emit('fare', { line: 'train', amount: fine });
      c.evader = true;
      game.notify('다음 역에서 내려야 한다', 'warn');
    });
  }
  /** 승객 건너뛰기: 다음 정차지 시각으로 (사건(rail_obstacle)이 있으면 그 앞에서 멈춤) */
  skip(game) {
    const c = this.c;
    if (!c || c.state !== 'run' || !c.stops[0]) return false;
    const target = this.leadAt(c.stops[0], c.dir), dist = Math.abs(target - c.d);
    const obs = game.findByTag('rail_obstacle').map((e) => closestOnPolyline(this.line.points, e.x, e.y, this.line.cum)).filter((p) => p.dist < 4 && (p.d - c.d) * c.dir > 0 && (p.d - target) * c.dir < 0);
    game.sys.vehicles?.markSkip?.();
    game.sys.time?.skip?.((dist / 12 + 3) / 120);
    if (obs.length) {
      const od = obs.sort((a, b) => (a.d - b.d) * c.dir)[0].d;
      c.d = od - c.dir * 70;
      c.speed = 6;
    } else {
      c.d = target;
      this.arrive(c, c.stops[0], game);
    }
    c.place();
    return true;
  }
  /** 다음 출발 게임 시각 (stopId 에서) */
  nextDeparture(stopId, game) {
    if (this.mode === 'none') return null;
    const h = hourNow(game), list = [];
    for (const [dep, from, to] of RUNS[this.mode]) {
      if (from === stopId) list.push(dep);
      else if (this.mode === 'open' && TT[from]?.[stopId] != null && stopId !== to) list.push(dep + TT[from][stopId]);
    }
    list.sort((a, b) => a - b);
    return list.find((t) => t >= h) ?? (list[0] != null ? list[0] : null);
  }
}
