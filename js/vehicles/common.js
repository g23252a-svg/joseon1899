// 탈것 공통 도구: 지형 배율(C.2), 좌석 고르기·빼앗기(C.3), 승무원, 피하기, 사격 흔들림, 짐칸, 날짜 플래그(0.2)
import { Human, makeLook } from '../entities/human.js';
import { moveCircle } from '../engine/physics.js';
import { rand } from '../engine/util.js';

// C.2 [과하마, 제주마, 보교, 인력거, 소달구지, 나룻배, 돛배, 증기선], 0 = 통행 불가
const TM = {
  SEA: [0, 0, 0, 0, 0, 1, 1, 1], RIVER: [0, 0, 0, 0, 0, 1, 1, 1], SHALLOW: [0.6, 0.6, 0.45, 0, 0, 0.7, 0.5, 0], MUD: [0.5, 0.45, 0.4, 0, 0, 0, 0, 0],
  SAND: [0.8, 0.8, 0.75, 0.6, 0.6, 0, 0, 0], GRASS: [1, 1, 0.95, 0.75, 0.75, 0, 0, 0], FIELD: [0.8, 0.8, 0.8, 0.6, 0.6, 0, 0, 0], PADDY: [0.6, 0.55, 0.5, 0, 0, 0, 0, 0],
  FOREST: [0.69, 0.6, 0.6, 0, 0, 0, 0, 0], MOUNTAIN: [0.58, 0.5, 0.5, 0, 0, 0, 0, 0], ROAD: [1.1, 1.1, 1, 1, 1, 0, 0, 0], MAIN_ROAD: [1.15, 1.15, 1, 1.1, 1.1, 0, 0, 0],
  STREET: [1, 1, 1, 1.05, 1.05, 0, 0, 0], YARD: [0.9, 0.9, 0.95, 0.9, 0.9, 0, 0, 0], BRIDGE: [1.05, 1.05, 1, 1, 1, 1, 1, 0], RAIL: [0.8, 0.8, 0.8, 0.5, 0.5, 0, 0, 0],
  PIER: [0.9, 0.9, 0.95, 0.9, 0.9, 0.5, 0.5, 0.5], REED: [0.55, 0.5, 0.45, 0, 0, 0.4, 0.3, 0],
};
const COL = { pony: 0, jeju_horse: 1, gama: 2, rickshaw: 3, oxcart: 4, rowboat: 5, sailboat: 6, steamer: 7 };
let tmWorld = null, tmTab = null, wetT = null;

/** 탈것별 지형 속도 배율 (비: 바퀴 ×0.85, 말 ×0.95) */
export function terrainMul(v, game) {
  const w = game.world;
  if (!w?.terrainAt || !w.T) return 1;
  if (tmWorld !== w) {
    tmWorld = w;
    tmTab = Object.keys(COL).map(() => []);
    for (const [k, row] of Object.entries(TM)) if (w.T[k] != null) row.forEach((m, c) => (tmTab[c][w.T[k]] = m));
    wetT = new Set(['ROAD', 'STREET', 'FIELD', 'SAND'].map((k) => w.T[k]));
  }
  const t = w.terrainAt(v.x, v.y);
  let m = tmTab[COL[v.vtype] ?? 1]?.[t];
  if (m == null) m = w.speedMul?.(v.x, v.y, v.moveMode) ?? 1;
  if (/rain|storm/.test(game.sys.time?.weather || '')) {
    if (v.moveMode === 'wheel' && wetT.has(t)) m *= 0.85;
    else if (v.moveMode === 'horse') m *= 0.95;
  }
  return m > 0 ? m : 0.3;
}

// ---------------------------------------------------------------- 날짜 플래그 (0.2). 미션이 켠 플래그 우선, 없으면 날짜로 판단
const DATES = { tram_running: ['1899-05-17'], rail_trial: ['1899-06-17'], rail_open: ['1899-09-18'], steamer_reduced: ['1899-09-18'], tram_resumed: ['1899-09-28'], rail_construction: ['1899-05-17', '1899-09-17'] };
export function flagOn(game, name) {
  const f = game.flags || {};
  if (f[name]) return true;
  const d = f.date, r = DATES[name];
  if (!d) return name === 'tram_running';
  return !!r && d >= r[0] && (!r[1] || d <= r[1]);
}
export const hourNow = (game) => game.sys.time?.hour ?? game.hour ?? 12;
export const dayNum = (game) => (game.flags?.date ? parseInt(game.flags.date.slice(8), 10) : game.sys.time?.day ?? 1);
export const absHour = (game) => ((game.sys.time?.day ?? 1) - 1) * 24 + hourNow(game);
export const isNightHire = (game) => { const h = hourNow(game); return h >= 21 || h < 5; };

// ---------------------------------------------------------------- 돈·범죄·대화
export function pay(game, n, reason) {
  if (!(n > 0)) return true;
  const inv = game.sys.inventory;
  if (!inv?.spendMoney) return true; // 소지품 시스템이 없으면 공짜
  return !!inv.spendMoney(n, reason);
}
export const crime = (game, kind, x, y, offender, victim) => game.emit('crime', { kind, x, y, offender, victim });
/** 선택지 (UI 없으면 첫 항목) */
export function ask(game, q, opts) {
  const ui = game.sys.ui;
  if (!ui?.choice) return Promise.resolve(0);
  try {
    return Promise.resolve(ui.choice(q, opts)).then((i) => (typeof i === 'number' ? i : -1));
  } catch {
    return Promise.resolve(0);
  }
}
export const wantedLevel = (game) => game.sys.wanted?.level ?? 0;

// ---------------------------------------------------------------- 좌석 (C.3): 가장 가까운 좌석, 같으면 운전석 > 승객석 > 매달림
export function nearestSeat(v, actor, ok) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < v.seats.length; i++) {
    const s = v.seats[i];
    if (!ok(s, i)) continue;
    const p = v.seatWorld(i);
    const d = Math.hypot(p.x - actor.x, p.y - actor.y) + (s.role === 'driver' ? 0 : s.outside ? 0.02 : 0.01);
    if (d < bd) (bd = d), (best = i);
  }
  return best;
}

/** 플레이어 F 상호작용: 타기·빼앗기·승객. v.board(actor, i, game) 가 있으면 승객 탑승은 그쪽으로 */
export function seatInteractions(v, actor, game) {
  if (!actor.isPlayer || actor.vehicle === v || v.wrecked || v.down || v.stabled || v.noBoard) return [];
  // 운전석(노·고삐)이 비어 있으면 가까운 승객석보다 먼저 그 자리를 잡는다.
  // (빈 거룻배 옆에서 F 를 눌렀는데 승객석에 앉으면 노를 저을 수 없어 조작이 멈춘 것처럼 보인다)
  const di = v.playerCanDrive ? v.seats.findIndex((q) => q.role === 'driver' && !q.occupant) : -1;
  if (di >= 0) return [{ key: 'enter', label: `${v.displayName} 타기`, priority: 5, run: (a) => takeDriver(v, a, game, di) }];
  const i = nearestSeat(v, actor, (s) => s.role !== 'crew' && (s.role !== 'driver' || v.playerCanDrive) && (!s.occupant || (s.role === 'driver' && v.stealable && !s.occupant.isPlayer)));
  if (i < 0) return [];
  const s = v.seats[i];
  if (s.occupant) return [{ key: 'enter', label: `${v.displayName} 빼앗기`, priority: 4, run: (a) => v.steal(a, game) }];
  if (s.role === 'driver') return [{ key: 'enter', label: `${v.displayName} 타기`, priority: 5, run: (a) => takeDriver(v, a, game, i) }];
  const label = v.boardLabel?.(i) || `${v.displayName}에 오르기`;
  return [{ key: 'enter', label, priority: 3, run: (a) => (v.board ? v.board(a, i, game) : v.enter(a, game, i)) }];
}

/** 운전석에 오르기: 남의 매어 둔 말·배를 쓰면 theft (C.3) */
function takeDriver(v, a, game, i) {
  const o = v.owner;
  if (o && o !== 'player' && o !== 'public' && o !== 'stolen' && o !== 'rental') {
    crime(game, 'theft', v.x, v.y, a, v);
    v.owner = 'stolen';
    v.stolenAt = game.time;
  }
  v.enter(a, game, i);
}

/** 타기·내리기 연출 잠금 (조작 잠금 sec 초) */
export function lockRider(v, h, sec) {
  v.lockT = Math.max(v.lockT || 0, sec);
  if (h?.isPlayer && !h.controlLocked) {
    h.controlLocked = true;
    h._vehLock = sec;
  }
}
export function tickLocks(game, dt) {
  const p = game.player;
  if (p?._vehLock > 0 && (p._vehLock -= dt) <= 0) (p._vehLock = 0), (p.controlLocked = false);
}

/** 탈것 위 사격 흔들림 (전투 담당이 읽는다): deg, 쏠 수 없음, 화승총 장전 불가 */
export function setSpread(h, deg, noFire = false, noReload = false) {
  if (!h) return;
  h.mountedSpread = deg;
  h.mountedNoFire = noFire;
  h.mountedNoReload = noReload;
}
export const clearSpread = (h) => setSpread(h, 0, false, false);

// ---------------------------------------------------------------- 승무원
/** 좌석 i 에 앉힐 NPC. npcs.makeBrain 이 있으면 그 두뇌를 내릴 때만 쓴다 */
export function makeCrew(game, v, i, o = {}) {
  const p = v.seatWorld(i);
  const role = o.role || 'villager';
  const h = new Human({ x: p.x, y: p.y, role, faction: o.faction || 'civilian', name: o.name || '사공', look: o.look || makeLook(role, o.lookOver || {}) });
  h.tags.add('crew');
  let inner = null;
  try {
    inner = game.sys.npcs?.makeBrain?.(o.brain || 'driver', { vehicle: v, home: { x: p.x, y: p.y } }) || null;
  } catch {
    inner = null;
  }
  h.brain = crewBrain(inner);
  game.add(h);
  v.enter(h, game, i);
  return h;
}
/** 탈것에 탄 동안은 탈것이 몰고, 내리면 원래 두뇌(없으면 서 있기·도망) */
export function crewBrain(inner) {
  return {
    inner,
    update(h, dt, game) {
      if (h.vehicle) return;
      const f = h.data.flee;
      if (f && (f.t -= dt) > 0) {
        const dx = h.x - f.x, dy = h.y - f.y, d = Math.hypot(dx, dy) || 1;
        h.moveX = dx / d;
        h.moveY = dy / d;
        h.gait = 'sprint';
        return;
      }
      if (inner?.update) inner.update(h, dt, game);
      else h.moveX = h.moveY = 0;
    },
    onRobbed: (h, r, g) => inner?.onRobbed?.(h, r, g),
    onDamaged: (h, i, g) => inner?.onDamaged?.(h, i, g),
  };
}
export function fleeFrom(h, x, y, t = 12) {
  h.data.flee = { x, y, t };
}

// ---------------------------------------------------------------- 비키기 (종·기적·"비키시오", 앞발 들기)
const dodgers = [];
/** 앞쪽 range m, 부채꼴 안 행인이 옆으로 비킨다. radial=true 면 둘레에서 물러선다 */
export function warnAhead(game, v, range, chance = 1, radial = false) {
  const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
  const cx = radial ? v.x : v.x + (fx * range) / 2, cy = radial ? v.y : v.y + (fy * range) / 2;
  for (const h of game.query(cx, cy, radial ? range : range / 2 + 2, (e) => e.kind === 'human' && !e.isPlayer && !e.vehicle && e.state === 'normal')) {
    const rx = h.x - v.x, ry = h.y - v.y;
    const lx = rx * fx + ry * fy, ly = -rx * fy + ry * fx;
    if (!radial && (lx < 0 || lx > range || Math.abs(ly) > 2.5 + lx * 0.3)) continue;
    if (rand.next() > chance || dodgers.some((d) => d.h === h)) continue;
    let dx, dy;
    if (radial) {
      const d = Math.hypot(rx, ry) || 1;
      (dx = rx / d), (dy = ry / d);
    } else {
      const s = ly >= 0 ? 1 : -1;
      (dx = -fy * s), (dy = fx * s);
    }
    dodgers.push({ h, dx, dy, t: 0.75 });
    h.data.dodgeUntil = game.time + 1;
  }
  game.emit('vehicle:warn', { vehicle: v, range });
}
export function updateDodgers(game, dt) {
  for (let i = dodgers.length - 1; i >= 0; i--) {
    const d = dodgers[i];
    if ((d.t -= dt) <= 0 || !d.h.alive || d.h.vehicle || d.h.state !== 'normal') {
      dodgers.splice(i, 1);
      continue;
    }
    moveCircle(game.world, d.h, d.dx * 2.6 * dt, d.dy * 2.6 * dt, 'foot');
    d.h.angle = Math.atan2(d.dy, d.dx);
  }
}

// ---------------------------------------------------------------- 충돌 (C.3)
const MASS_CLASS = { horse: 6, wheel: 4, foot: 4, boat: 10, rail: 10 };
/** 벽 충돌: 탈것 피해 (속도 − 4) × 질량등급 */
export function crashDamage(v, sp, game) {
  if (sp > 4) v.damage((sp - 4) * (MASS_CLASS[v.moveMode] || 4), { kind: 'fall', source: null, x: v.x, y: v.y }, game);
}
/** 탈것끼리: Δv ≥ 4 면 Δv × (상대 질량 / 합) × 20 */
export function vehicleHit(v, other, impact, game) {
  if (other.kind !== 'vehicle' || impact < 4 || game.time - (v._vvHit || -9) < 0.6) return false;
  v._vvHit = game.time;
  const m1 = v.mass || 1, m2 = other.mass || 1;
  v.damage(impact * (m2 / (m1 + m2)) * 20, { kind: 'fall', source: other.driver || other, x: v.x, y: v.y }, game);
  return true;
}

/** 긴 탈것(배·수레·전차·객차) 몸통 사각형에서 사람·작은 탈것을 밀어낸다. onCollide 를 대신 부른다 */
export function pushOutRect(game, v) {
  const L = v.length / 2, W = v.width / 2;
  const c = Math.cos(v.angle), s = Math.sin(v.angle);
  const pred = (o) => o !== v && o.solid && !o.static && !o.vehicle && (o.kind !== 'vehicle' || ((o.mass || 1) < (v.mass || 1) && !(o.consist && o.consist === v.consist)));
  for (const e of game.query(v.x, v.y, L + 1, pred)) {
    const rx = e.x - v.x, ry = e.y - v.y, r = e.radius || 0.3;
    const lx = rx * c + ry * s, ly = -rx * s + ry * c;
    const ox = L + r - Math.abs(lx), oy = W + r - Math.abs(ly);
    if (ox <= 0 || oy <= 0) continue;
    let nx, ny, depth;
    if (oy < ox) (nx = -s * Math.sign(ly || 1)), (ny = c * Math.sign(ly || 1)), (depth = oy);
    else (nx = c * Math.sign(lx || 1)), (ny = s * Math.sign(lx || 1)), (depth = ox);
    moveCircle(game.world, e, nx * depth, ny * depth, e.moveMode || 'foot');
    const impact = (v.vx - (e.vx || 0)) * nx + (v.vy - (e.vy || 0)) * ny;
    if (impact > 0.5) {
      v.onCollide(e, impact, game);
      e.onCollide?.(v, impact, game);
    }
  }
}

// ---------------------------------------------------------------- 짐칸 (안장주머니·짐칸). 파밍 담당이 큰 짐승을 싣는다
export const Bag = {
  initBag(items, large, small) {
    this.cargo = { items: [], large: [], small: [], cap: { items, large, small } };
  },
  /** kind: 'large' | 'small' | 'item'. 실으면 true */
  stow(obj, kind = 'item') {
    const c = this.cargo;
    if (!c) return false;
    const k = kind === 'large' ? 'large' : kind === 'small' ? 'small' : 'items';
    if (c[k].length >= c.cap[k]) return false;
    c[k].push(obj);
    return true;
  },
  /** 하나 내린다 (kind 생략: 큰 것 → 작은 것 → 물건) */
  unstow(kind) {
    const c = this.cargo;
    if (!c) return null;
    for (const k of kind ? [kind === 'item' ? 'items' : kind] : ['large', 'small', 'items']) if (c[k]?.length) return c[k].pop();
    return null;
  },
  bagFree(kind = 'item') {
    const c = this.cargo, k = kind === 'item' ? 'items' : kind;
    return c ? c.cap[k] - c[k].length : 0;
  },
};

// ---------------------------------------------------------------- 그리기 도구
export function hullPath(ctx, L, W, bow = 0.3, stern = 0.15) {
  const hl = L / 2, hw = W / 2;
  ctx.beginPath();
  ctx.moveTo(hl, 0);
  ctx.quadraticCurveTo(hl - L * bow * 0.2, -hw, hl - L * bow, -hw);
  ctx.lineTo(-hl + L * stern, -hw);
  ctx.quadraticCurveTo(-hl, -hw, -hl, 0);
  ctx.quadraticCurveTo(-hl, hw, -hl + L * stern, hw);
  ctx.lineTo(hl - L * bow, hw);
  ctx.quadraticCurveTo(hl - L * bow * 0.2, hw, hl, 0);
  ctx.closePath();
}
/** 빈 자리에 앉은 손님 모양 (엔티티 없이 그림만) */
export function drawDummies(ctx, v, frac, seed = 1) {
  if (!(frac > 0)) return;
  for (let i = 0; i < v.seats.length; i++) {
    const s = v.seats[i];
    if (s.occupant || s.role !== 'passenger' || s.pose === 'hidden' || s.outside) continue;
    const hsh = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const r = hsh - Math.floor(hsh);
    if (r > frac) continue;
    ctx.fillStyle = r < frac * 0.3 ? '#d8e3dc' : '#ece6d6';
    ctx.strokeStyle = '#1d1b18';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.ellipse(s.x - 0.04, s.y, 0.19, 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = r < frac * 0.5 ? 'rgba(25,22,20,0.45)' : '#1c1a17';
    ctx.beginPath();
    ctx.arc(s.x, s.y, r < frac * 0.5 ? 0.24 : 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
}
export const SHADOW = 'rgba(29,27,24,0.15)';
