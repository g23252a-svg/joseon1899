// 공용 수학·난수·노이즈·폴리라인 도구. 모든 모듈이 자유롭게 import 한다.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** 각도를 (-PI, PI] 로 정규화 */
export function angleWrap(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
/** a 에서 b 로 가장 짧은 방향으로 t 만큼 회전 */
export const angleLerp = (a, b, t) => a + angleWrap(b - a) * t;
/** a 를 b 쪽으로 최대 step(rad) 만큼 회전 */
export function angleApproach(a, b, step) {
  const d = angleWrap(b - a);
  if (Math.abs(d) <= step) return b;
  return a + Math.sign(d) * step;
}
/** v 를 target 쪽으로 최대 delta 만큼 이동 */
export function approach(v, target, delta) {
  if (v < target) return Math.min(v + delta, target);
  return Math.max(v - delta, target);
}
/** 프레임 독립 지수 감쇠 보간 계수: rate 가 클수록 빠르게 수렴 */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

// ---------------------------------------------------------------- 난수

/** 시드 기반 난수 함수 [0,1) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1899) {
    this.f = mulberry32(seed);
  }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(a + (b - a + 1) * this.f()); } // a..b 포함
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  chance(p) { return this.f() < p; }
  /** 가중치 목록 [{w, ...}] 에서 하나 */
  weighted(list, key = 'w') {
    let total = 0;
    for (const it of list) total += it[key];
    let r = this.f() * total;
    for (const it of list) {
      r -= it[key];
      if (r <= 0) return it;
    }
    return list[list.length - 1];
  }
  gauss() {
    return (this.f() + this.f() + this.f() - 1.5) / 1.5;
  }
}

/** 전역 비결정 난수 (게임플레이용) */
export const rand = new RNG((Math.random() * 2 ** 31) | 0);

/** 정수 좌표 해시 → [0,1) */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 부드러운 value noise [0,1) */
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 프랙탈 노이즈 [0,1) 근사 */
export function fbm(x, y, octaves = 4, seed = 0) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- 기하

/** 점 p 에서 선분 ab 까지의 거리와 가장 가까운 점, 선분 위 비율 t */
export function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, t, dist: Math.hypot(px - x, py - y) };
}
export const distToSegment = (px, py, ax, ay, bx, by) => closestOnSegment(px, py, ax, ay, bx, by).dist;

/** 폴리라인은 [[x,y], [x,y], ...] 형식 */
export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** 각 꼭짓점까지의 누적 거리 배열 (pointAtDistance 를 빠르게 하려고 미리 계산) */
export function polylineCumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

/** 폴리라인 시작에서 거리 d 지점의 좌표와 진행 방향. cum 은 polylineCumulative 결과(선택) */
export function pointAtDistance(pts, d, cum = null) {
  cum = cum || polylineCumulative(pts);
  const total = cum[cum.length - 1];
  d = clamp(d, 0, total);
  // 이분 탐색
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const segLen = cum[hi] - cum[lo] || 1;
  const t = (d - cum[lo]) / segLen;
  const a = pts[lo], b = pts[hi];
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
    seg: lo,
  };
}

/** 폴리라인 위에서 점과 가장 가까운 지점. d 는 시작점부터의 거리 */
export function closestOnPolyline(pts, px, py, cum = null) {
  cum = cum || polylineCumulative(pts);
  let best = { x: pts[0][0], y: pts[0][1], dist: Infinity, d: 0, seg: 0, angle: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const c = closestOnSegment(px, py, a[0], a[1], b[0], b[1]);
    if (c.dist < best.dist) {
      best = { x: c.x, y: c.y, dist: c.dist, d: cum[i - 1] + (cum[i] - cum[i - 1]) * c.t, seg: i - 1, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
  }
  return best;
}

/** 다각형 [[x,y],...] 내부 판정 (짝홀 규칙) */
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 폴리곤/폴리라인의 경계 상자 */
export function bounds(pts, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

export const rectsOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * 원(cx,cy,r) 과 회전 사각형(중심 x,y / 폭 w / 높이 h / 각 angle) 충돌.
 * 겹치면 원을 밀어낼 벡터 {nx, ny, depth} 반환, 아니면 null
 */
export function circleVsRect(cx, cy, r, rect) {
  const ca = Math.cos(-(rect.angle || 0)), sa = Math.sin(-(rect.angle || 0));
  const lx = (cx - rect.x) * ca - (cy - rect.y) * sa;
  const ly = (cx - rect.x) * sa + (cy - rect.y) * ca;
  const hw = rect.w / 2, hh = rect.h / 2;
  const qx = clamp(lx, -hw, hw), qy = clamp(ly, -hh, hh);
  let dx = lx - qx, dy = ly - qy;
  let d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  let nx, ny, depth;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d; depth = r - d;
  } else {
    // 중심이 사각형 안: 가장 가까운 변으로 밀어냄
    const px = hw - Math.abs(lx), py = hh - Math.abs(ly);
    if (px < py) { nx = Math.sign(lx) || 1; ny = 0; depth = px + r; }
    else { nx = 0; ny = Math.sign(ly) || 1; depth = py + r; }
  }
  // 로컬 → 월드 법선
  const c2 = Math.cos(rect.angle || 0), s2 = Math.sin(rect.angle || 0);
  return { nx: nx * c2 - ny * s2, ny: nx * s2 + ny * c2, depth };
}

// ---------------------------------------------------------------- 색

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex, a = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function mixHex(h1, h2, t) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- 기타

let _uid = 1;
export const uid = (prefix = 'e') => `${prefix}${_uid++}`;

export function shuffle(arr, rng = rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 0 ~ 24 시각을 "해시 (亥時)" 같은 십이시 이름으로 */
const SIJIN = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
export function sijin(hour) {
  if (!Number.isFinite(hour)) return '';
  const h = ((hour % 24) + 24) % 24;
  const idx = Math.floor(((h + 1) % 24) / 2);
  return SIJIN[idx] + '시';
}
