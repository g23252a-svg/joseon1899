// 지형 격자: MAP(§9 형식)을 2m 칸 Uint8Array 로 래스터화하고, 8m 거친 높이장·물 거리장을 만든다.
// 경계는 도메인 왜곡(노이즈)으로 번지듯 자연스럽게. 엔진은 데이터 형식만 알고 특정 지명에 의존하지 않는다.
// 성능: 칸마다 노이즈 함수를 부르지 않고, 미리 만든 칸 단위 왜곡·노이즈 배열(Int8/Uint8)을 읽는다.

import { closestOnSegment, mulberry32, polylineCumulative, pointAtDistance, closestOnPolyline } from '../engine/util.js';

// ---------------------------------------------------------------- 지형 enum·표

export const T = {
  VOID: 0, SEA: 1, RIVER: 2, SHALLOW: 3, MUD: 4, SAND: 5, GRASS: 6, FIELD: 7, PADDY: 8, FOREST: 9,
  MOUNTAIN: 10, ROCK: 11, ROAD: 12, MAIN_ROAD: 13, STREET: 14, YARD: 15, WALL: 16, BRIDGE: 17, RAIL: 18, PIER: 19,
  REED: 20,
};
export const T_COUNT = 21;

// 스펙 A.2: [key, 이름, foot, horse, wheel, boat, 은신 배율(작을수록 숨기 좋음), 발소리]  (0 = 통행 불가)
const TABLE = [
  ['VOID', '지도 밖', 0, 0, 0, 0, 1, null],
  ['SEA', '바다', 0, 0, 0, 1, 1, 'splash'],
  ['RIVER', '강', 0, 0, 0, 1, 1, 'splash'],
  ['SHALLOW', '얕은 물', 0.55, 0.6, 0, 0.7, 1.0, 'water'],
  ['MUD', '갯벌', 0.5, 0.45, 0, 0, 1.2, 'mud'],
  ['SAND', '모래', 0.85, 0.8, 0.6, 0, 1.2, 'sand'],
  ['GRASS', '풀밭', 1, 1, 0.75, 0, 1.0, 'grass'],
  ['FIELD', '밭', 0.85, 0.8, 0.6, 0, 0.9, 'dirt'],
  ['PADDY', '논', 0.6, 0.55, 0, 0, 0.85, 'mud'],
  ['FOREST', '숲', 0.8, 0.6, 0, 0, 0.6, 'leaves'],
  ['MOUNTAIN', '산비탈', 0.65, 0.5, 0, 0, 0.8, 'gravel'],
  ['ROCK', '바위·벼랑', 0, 0, 0, 0, 1, null],
  ['ROAD', '길', 1.05, 1.1, 1.0, 0, 1.1, 'dirt'],
  ['MAIN_ROAD', '큰길', 1.05, 1.15, 1.1, 0, 1.15, 'dirt'],
  ['STREET', '거리', 1.05, 1.0, 1.05, 0, 1.1, 'dirt'],
  ['YARD', '마당', 1, 0.9, 0.9, 0, 1.0, 'dirt'],
  ['WALL', '성벽', 0, 0, 0, 0, 1, null],
  ['BRIDGE', '다리', 1.05, 1.05, 1.0, 0, 1.1, 'wood'],
  ['RAIL', '철로', 0.9, 0.8, 0.5, 0, 1.1, 'gravel'],
  ['PIER', '부두·나루', 1, 0.9, 0.9, 0.5, 1.0, 'wood'],
  ['REED', '갈대밭', 0.6, 0.5, 0, 0.4, 0.45, 'reed'],
];
// 스펙 A.2 효과 열 (있는 것만)
const EFFECT = {
  SHALLOW: { misfire: 0.15, steamerBlock: true }, MUD: { footprints: 60 }, SAND: { footprints: 30 }, FIELD: { footprints: 30 },
  PADDY: { dike: 1 }, FOREST: { blocksSight: true, gather: 'ssari' }, MOUNTAIN: { staminaMul: 1.5 }, ROCK: { echo: true },
  ROAD: { rainWheelMul: 0.85 }, MAIN_ROAD: { crowd: true }, STREET: { drains: true }, YARD: { private: true },
  RAIL: { trainDeadly: true }, PIER: { boarding: true }, REED: { hideBoat: true, animals: ['water_deer', 'pheasant'] },
};

export const TERRAIN = TABLE.map(([key, name, foot, horse, wheel, boat, stealth, step], id) => ({
  id, key, name, foot, horse, wheel, boat, stealth, step,
  swim: id === T.SEA || id === T.RIVER || id === T.SHALLOW ? 1 : 0,
  water: id === T.SEA || id === T.RIVER || id === T.SHALLOW,
  deep: id === T.SEA || id === T.RIVER,
  road: id === T.ROAD || id === T.MAIN_ROAD || id === T.STREET || id === T.BRIDGE,
  ...(EFFECT[key] || {}),
}));

/** 모드별 통행(0/1)·속도 표. 모르는 모드는 foot 로 취급 */
export const PASS = {};
export const SPEED = {};
for (const mode of ['foot', 'horse', 'wheel', 'boat', 'swim', 'rail', 'ghost']) {
  const p = new Uint8Array(T_COUNT), s = new Float32Array(T_COUNT);
  for (const info of TERRAIN) {
    let v;
    if (mode === 'swim') v = info.water ? 1 : 0;
    else if (mode === 'rail' || mode === 'ghost') v = info.id === T.VOID ? 0 : 1;
    else v = info[mode];
    p[info.id] = v > 0 ? 1 : 0;
    s[info.id] = v > 0 ? v : 0;
  }
  PASS[mode] = p;
  SPEED[mode] = s;
}

export const isWaterT = (t) => t === T.SEA || t === T.RIVER || t === T.SHALLOW;
const ROAD_RANK = { [T.ROAD]: 1, [T.STREET]: 2, [T.MAIN_ROAD]: 3 };

/** 집 마당 등으로 바꿔 칠해도 되는 땅 */
export function isSoftGround(t) {
  return t === T.GRASS || t === T.FIELD || t === T.FOREST || t === T.MOUNTAIN || t === T.SAND || t === T.YARD || t === T.PADDY;
}

/** 지도 가장자리 띠(스펙 A.1: 60 m 안쪽은 한지로 번져 사라진다). 칸 cn(0..255) 으로 경계를 번지게 → 지나갈 수 없는 칸인가 */
export const EDGE_BAND = 60;
export function inEdgeBand(x, y, w, h, n255) {
  const d = Math.min(x, y, w - x, h - y);
  return d < EDGE_BAND && d < EDGE_BAND - 16 + (n255 / 255) * 16 - 2;
}

// ---------------------------------------------------------------- 주기 노이즈 텍스처 (빠른 표본)

const TS = 256, TM = 255;
/** 256×256 주기 value noise (격자 8텍셀). 렌더러도 쓴다 */
export function makeNoiseTex(seed = 1) {
  const L = 32, rnd = mulberry32(seed);
  const lat = new Float32Array(L * L);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const tex = new Float32Array(TS * TS);
  for (let y = 0; y < TS; y++) {
    const fy = y / 8, iy = fy | 0, ty0 = fy - iy, ty = ty0 * ty0 * (3 - 2 * ty0);
    const y0 = (iy % L) * L, y1 = ((iy + 1) % L) * L;
    for (let x = 0; x < TS; x++) {
      const fx = x / 8, ix = fx | 0, tx0 = fx - ix, tx = tx0 * tx0 * (3 - 2 * tx0);
      const x0 = ix % L, x1 = (ix + 1) % L;
      const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
      tex[y * TS + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return tex;
}
/** 텍스처 표본. x,y 는 텍셀 단위(주기 256) → 0..1 */
export function texAt(tex, x, y) {
  const fx = Math.floor(x), fy = Math.floor(y);
  const tx = x - fx, ty = y - fy;
  const x0 = fx & TM, y0 = fy & TM, x1 = (x0 + 1) & TM, y1 = (y0 + 1) & TM;
  const r0 = y0 << 8, r1 = y1 << 8;
  const a = tex[r0 + x0], b = tex[r0 + x1], c = tex[r1 + x0], d = tex[r1 + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
/** 월드 좌표 노이즈: 주기 per 미터 크기 feat(=격자 한 칸) 로 */
export function noiseAt(tex, x, y, feat, off = 0) {
  return texAt(tex, (x / feat) * 8 + off, (y / feat) * 8 + off * 1.37);
}
export function fbmAt(tex, x, y, feat, oct = 3, off = 0) {
  let s = 0, a = 0.5, n = 0, f = feat;
  for (let i = 0; i < oct; i++) {
    s += a * noiseAt(tex, x, y, f, off + i * 41.3);
    n += a;
    a *= 0.5;
    f /= 2.07;
  }
  return s / n;
}

// ---------------------------------------------------------------- 선분 버킷 색인

/** 선분을 격자 버킷에 넣어 두고 가까운 것을 빨리 찾는다 (강 흐름, 가까운 길, 렌더링) */
export class SegIndex {
  constructor(cell = 64) {
    this.cell = cell;
    this.map = new Map();
    this.segs = [];
    this._stamp = 0;
  }
  _key(cx, cy) {
    return (cx + 1024) * 4096 + (cy + 1024);
  }
  /** seg = {ax, ay, bx, by, ...데이터} */
  add(seg, pad = 0) {
    seg._q = 0;
    this.segs.push(seg);
    const c = this.cell;
    const x0 = Math.floor((Math.min(seg.ax, seg.bx) - pad) / c), x1 = Math.floor((Math.max(seg.ax, seg.bx) + pad) / c);
    const y0 = Math.floor((Math.min(seg.ay, seg.by) - pad) / c), y1 = Math.floor((Math.max(seg.ay, seg.by) + pad) / c);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = this._key(cx, cy);
        let b = this.map.get(k);
        if (!b) this.map.set(k, (b = []));
        b.push(seg);
      }
  }
  query(x0, y0, x1, y1, out = []) {
    const c = this.cell, st = ++this._stamp;
    for (let cx = Math.floor(x0 / c), ex = Math.floor(x1 / c); cx <= ex; cx++)
      for (let cy = Math.floor(y0 / c), ey = Math.floor(y1 / c); cy <= ey; cy++) {
        const b = this.map.get(this._key(cx, cy));
        if (!b) continue;
        for (const s of b) {
          if (s._q === st) continue;
          s._q = st;
          out.push(s);
        }
      }
    return out;
  }
  /** (x,y) 에서 maxR 안의 가장 가까운 선분 위 점 {x, y, dist, t, seg}|null. filter(seg) 로 거른다 */
  nearest(x, y, maxR = 400, filter = null) {
    let best = null, bd = Infinity;
    const tmp = [];
    for (let r = this.cell; ; r *= 2) {
      const rr = Math.min(r, maxR);
      tmp.length = 0;
      this.query(x - rr, y - rr, x + rr, y + rr, tmp);
      for (const s of tmp) {
        if (filter && !filter(s)) continue;
        const c = closestOnSegment(x, y, s.ax, s.ay, s.bx, s.by);
        if (c.dist < bd) {
          bd = c.dist;
          best = { x: c.x, y: c.y, dist: c.dist, t: c.t, seg: s };
        }
      }
      if (best && bd <= rr) return best;
      if (rr >= maxR) return best && bd <= maxR ? best : null;
    }
  }
}

// ---------------------------------------------------------------- 보조 함수

/** 다각형들(짝홀 규칙: 여러 개면 합쳐서 — 안쪽 다각형은 구멍)을 칸 격자 일부에 래스터화 */
function rasterPolys(polys, cell, x0c, y0c, wc, hc) {
  const mask = new Uint8Array(wc * hc);
  const xs = [];
  for (let r = 0; r < hc; r++) {
    const y = (y0c + r + 0.5) * cell;
    xs.length = 0;
    for (const poly of polys) {
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i][1], yj = poly[j][1];
        if (yi > y !== yj > y) xs.push(poly[i][0] + ((y - yi) / (yj - yi)) * (poly[j][0] - poly[i][0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let c0 = Math.ceil(xs[k] / cell - 0.5) - x0c, c1 = Math.floor(xs[k + 1] / cell - 0.5) - x0c;
      if (c0 < 0) c0 = 0;
      if (c1 >= wc) c1 = wc - 1;
      for (let c = c0; c <= c1; c++) mask[r * wc + c] = 1;
    }
  }
  return mask;
}

/** 근사 거리 변환(체임퍼). src[i]=1 인 칸까지 거리(m), cap 으로 자른다 */
export function chamfer(src, wc, hc, cell, cap = 1e9) {
  const INF = 1e9;
  const d = new Float32Array(wc * hc);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
  const a = cell, b = cell * 1.4142;
  for (let y = 0; y < hc; y++) {
    const row = y * wc;
    for (let x = 0; x < wc; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0 && d[i - 1] + a < v) v = d[i - 1] + a;
      if (y > 0) {
        const u = i - wc;
        if (d[u] + a < v) v = d[u] + a;
        if (x > 0 && d[u - 1] + b < v) v = d[u - 1] + b;
        if (x < wc - 1 && d[u + 1] + b < v) v = d[u + 1] + b;
      }
      d[i] = v;
    }
  }
  for (let y = hc - 1; y >= 0; y--) {
    const row = y * wc;
    for (let x = wc - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < wc - 1 && d[i + 1] + a < v) v = d[i + 1] + a;
      if (y < hc - 1) {
        const u = i + wc;
        if (d[u] + a < v) v = d[u] + a;
        if (x < wc - 1 && d[u + 1] + b < v) v = d[u + 1] + b;
        if (x > 0 && d[u - 1] + b < v) v = d[u - 1] + b;
      }
      d[i] = v > cap ? cap : v;
    }
  }
  return d;
}

/** 정수 체임퍼 거리 변환 (Uint16, 단위는 호출자가 정함: A=직교, B=대각 가중치) */
function chamferU16(src, w, h, A, B, cap) {
  const d = new Uint16Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : cap;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      let q;
      if (x > 0 && (q = d[i - 1] + A) < v) v = q;
      if (y > 0) {
        const u = i - w;
        if ((q = d[u] + A) < v) v = q;
        if (x > 0 && (q = d[u - 1] + B) < v) v = q;
        if (x < w - 1 && (q = d[u + 1] + B) < v) v = q;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      let q;
      if (x < w - 1 && (q = d[i + 1] + A) < v) v = q;
      if (y < h - 1) {
        const u = i + w;
        if ((q = d[u] + A) < v) v = q;
        if (x < w - 1 && (q = d[u + 1] + B) < v) v = q;
        if (x > 0 && (q = d[u - 1] + B) < v) v = q;
      }
      d[i] = v;
    }
  }
  return d;
}

/** 지형 플래그 표 */
function flagsOf(list) {
  const f = new Uint8Array(32);
  for (const t of list) f[t] = 1;
  return f;
}

function polyBounds(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys)
    for (const q of p) {
      if (q[0] < x0) x0 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[0] > x1) x1 = q[0];
      if (q[1] > y1) y1 = q[1];
    }
  return { x0, y0, x1, y1 };
}

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------- 지형 본체

export class Terrain {
  constructor(MAP) {
    this.map = MAP;
    this.w = MAP.size.w;
    this.h = MAP.size.h;
    this.cell = MAP.cell || 2;
    this.cols = Math.ceil(this.w / this.cell);
    this.rows = Math.ceil(this.h / this.cell);
    const n = this.cols * this.rows;
    this.grid = new Uint8Array(n).fill(T.GRASS);
    // 8m 거친 격자 (꼭짓점 기준, 쌍선형 보간)
    this.hc = 8;
    this.hcols = Math.ceil(this.w / this.hc) + 2;
    this.hrows = Math.ceil(this.h / this.hc) + 2;
    const hn = this.hcols * this.hrows;
    this.height = new Float32Array(hn);
    this.rockiness = new Float32Array(hn);
    this.waterDist = new Float32Array(hn); // +: 물 속에서 물가까지, -: 땅에서 물까지 (m)
    this.WX = new Float32Array(hn);
    this.WY = new Float32Array(hn);
    this.N1 = new Float32Array(hn); // 저주파 0..1 (≈160m)
    // 칸 단위 미리 계산 배열
    this.cwx = new Int8Array(n); // 왜곡 -127..127 → -1..1
    this.cwy = new Int8Array(n);
    this.cn = new Uint8Array(n); // 잔 노이즈 ≈10m, 0..255
    this.cl = new Uint8Array(n); // 저주파 ≈160m
    this.forestIdx = new Uint8Array(n); // 숲 정의 번호+1 (나무 배치용)
    this.bridgeUnder = new Map(); // 다리 칸 → 아래 물 지형
    this.bridges = []; // {id, points, width, auto, road?, rail?}
    this.rivers = [];
    this.riverIndex = new SegIndex(64);
    this.roadIndex = new SegIndex(96);
    this.roads = [];
    this.wallSegs = []; // {ax,ay,bx,by,thickness,wall}
    this.walls = [];
    this.gates = []; // {id, name, hanja, x, y, w, angle, thickness, wall}
    this.piers = [];
    this.platforms = []; // 승강장 {line, stop, d0, d1, inner, outer, poly}
    this.seed = 1899;
    this.tex = makeNoiseTex(this.seed);
    this.tex2 = makeNoiseTex(this.seed + 7);
    // 64×64 칸 잔떨림 표
    const rnd = mulberry32(this.seed + 3);
    this.jit = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) this.jit[i] = rnd() - 0.5;
  }

  // ---------------- 조회
  idx(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return ((y / this.cell) | 0) * this.cols + ((x / this.cell) | 0);
  }
  at(x, y) {
    if (!(x >= 0 && y >= 0 && x < this.w && y < this.h)) return T.VOID;
    return this.grid[((y / this.cell) | 0) * this.cols + ((x / this.cell) | 0)];
  }
  atCell(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return T.VOID;
    return this.grid[cy * this.cols + cx];
  }
  /** 거친 격자 쌍선형 보간 */
  bil(arr, x, y) {
    let fx = x / this.hc, fy = y / this.hc;
    if (fx < 0) fx = 0;
    else if (fx > this.hcols - 1.001) fx = this.hcols - 1.001;
    if (fy < 0) fy = 0;
    else if (fy > this.hrows - 1.001) fy = this.hrows - 1.001;
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
    const W = this.hcols, k = iy * W + ix;
    const a = arr[k], b = arr[k + 1], c = arr[k + W], d = arr[k + W + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  /** 가장자리 띠(지나갈 수 없는 한지)인가 */
  edgeVoid(x, y) {
    const i = this.idx(x, y);
    return i < 0 || inEdgeBand(x, y, this.w, this.h, this.cn[i]);
  }
  heightAt(x, y) {
    return this.bil(this.height, x, y);
  }
  waterDistAt(x, y) {
    return this.bil(this.waterDist, x, y);
  }
  /** 높이 기울기 (단위: 높이/m) */
  slopeAt(x, y, out = { x: 0, y: 0 }) {
    const e = 6;
    out.x = (this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (2 * e);
    out.y = (this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (2 * e);
    return out;
  }
  noise(x, y, feat, off = 0) {
    return noiseAt(this.tex, x, y, feat, off);
  }

  // ---------------- 생성 단계
  async build(onProgress = () => {}) {
    const steps = [
      ['noise', '한지를 펴는 중'],
      ['sea', '바다를 그리는 중'],
      ['mountains', '산을 세우는 중'],
      ['forests', '숲을 심는 중'],
      ['fields', '논밭을 가는 중'],
      ['rivers', '강을 흘려보내는 중'],
      ['ponds', '못을 파는 중'],
      ['sands', '모래톱을 쌓는 중'],
      ['reeds', '갈대를 심는 중'],
      ['channels', '뱃길을 트는 중'],
      ['banks', '물가를 다듬는 중'],
      ['yards', '마을 마당을 다지는 중'],
      ['roads', '길을 내는 중'],
      ['bridges', '다리를 놓는 중'],
      ['rails', '철로를 까는 중'],
      ['platforms', '승강장을 다지는 중'],
      ['piers', '나루를 세우는 중'],
      ['walls', '성벽을 쌓는 중'],
      ['edges', '종이 끝을 번지게 하는 중'],
      ['finish', '먹을 가는 중'],
    ];
    this.timings = {};
    let last = now();
    for (let i = 0; i < steps.length; i++) {
      const [fn, msg] = steps[i];
      // 너무 잦은 양보는 느리므로 30ms 마다
      if (now() - last > 30) {
        onProgress(i / steps.length, msg);
        await yieldFrame();
        last = now();
      }
      const t0 = now();
      this['step_' + fn]();
      this.timings[fn] = Math.round(now() - t0);
    }
    onProgress(1, '');
    return this;
  }

  step_noise() {
    const { hcols, hrows, hc, tex, tex2 } = this;
    for (let j = 0; j < hrows; j++)
      for (let i = 0; i < hcols; i++) {
        const x = i * hc, y = j * hc, k = j * hcols + i;
        this.WX[k] = (fbmAt(tex, x, y, 70, 2, 3.1) - 0.5) * 3.4;
        this.WY[k] = (fbmAt(tex2, x, y, 70, 2, 11.7) - 0.5) * 3.4;
        this.N1[k] = fbmAt(tex, x, y, 160, 2, 23.9);
      }
    // 칸 단위: 거친 왜곡을 행 단위로 보간 + 잔 노이즈
    const { cols, rows, cell, cwx, cwy, cn, cl, WX, WY, N1 } = this;
    const tk = cell * 0.8; // 잔 노이즈: 텍셀 = 1.25m → 격자 10m
    for (let cy = 0; cy < rows; cy++) {
      const y = (cy + 0.5) * cell, fy = y / hc, iy = fy | 0, ty = fy - iy;
      const r0 = iy * hcols, r1 = r0 + hcols;
      const vy = (cy + 0.5) * tk, vyi = Math.floor(vy), vty = vy - vyi;
      const t0 = (vyi & TM) << 8, t1 = ((vyi + 1) & TM) << 8;
      for (let cx = 0; cx < cols; cx++) {
        const x = (cx + 0.5) * cell, fx = x / hc, ix = fx | 0, tx = fx - ix;
        const k0 = r0 + ix, k1 = r1 + ix;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const i = cy * cols + cx;
        let v = (WX[k0] * w00 + WX[k0 + 1] * w10 + WX[k1] * w01 + WX[k1 + 1] * w11) * 110;
        cwx[i] = v > 127 ? 127 : v < -127 ? -127 : v;
        v = (WY[k0] * w00 + WY[k0 + 1] * w10 + WY[k1] * w01 + WY[k1 + 1] * w11) * 110;
        cwy[i] = v > 127 ? 127 : v < -127 ? -127 : v;
        cl[i] = (N1[k0] * w00 + N1[k0 + 1] * w10 + N1[k1] * w01 + N1[k1 + 1] * w11) * 255;
        const vx = (cx + 0.5) * tk, vxi = Math.floor(vx), vtx = vx - vxi;
        const xa = vxi & TM, xb = (vxi + 1) & TM;
        const a = tex2[t0 + xa], b = tex2[t0 + xb], c = tex2[t1 + xa], d = tex2[t1 + xb];
        cn[i] = (a + (b - a) * vtx + (c - a) * vty + (a - b - c + d) * vtx * vty) * 255;
      }
    }
  }

  /** 칸 i(cx,cy) 의 왜곡 표본 위치 → o[0], o[1] (m). amp 미터, fine 은 잔떨림(m) */
  warp(i, cx, cy, amp, fine, o) {
    const a = amp / 110;
    o[0] = (cx + 0.5) * this.cell + this.cwx[i] * a + this.jit[(cx & 63) | ((cy & 63) << 6)] * fine;
    o[1] = (cy + 0.5) * this.cell + this.cwy[i] * a + this.jit[((cx + 17) & 63) | (((cy + 29) & 63) << 6)] * fine;
    return o;
  }

  /** 다각형 집합을 왜곡 경계로 칠한다. fn(i, t, cx, cy) → 새 지형 또는 -1(그대로) */
  paintPolys(polys, amp, fine, fn) {
    if (!polys || !polys.length) return;
    const b = polyBounds(polys);
    const c = this.cell, pad = amp * 1.6 + fine + 4;
    // 마스크는 지도 밖까지 포함 (가장자리에서 왜곡 표본이 밖을 봐도 되게)
    const mx0 = Math.floor((b.x0 - pad) / c), my0 = Math.floor((b.y0 - pad) / c);
    const mx1 = Math.ceil((b.x1 + pad) / c), my1 = Math.ceil((b.y1 + pad) / c);
    const mw = mx1 - mx0 + 1, mh = my1 - my0 + 1;
    const mask = rasterPolys(polys, c, mx0, my0, mw, mh);
    const cx0 = Math.max(0, mx0), cy0 = Math.max(0, my0);
    const cx1 = Math.min(this.cols - 1, mx1), cy1 = Math.min(this.rows - 1, my1);
    const g = this.grid, C = this.cols, cwx = this.cwx, cwy = this.cwy, jit = this.jit;
    const a = amp / 110 / c, fj = fine / c;
    for (let cy = cy0; cy <= cy1; cy++) {
      const j1 = (cy & 63) << 6, j2 = ((cy + 29) & 63) << 6, ry = cy + 0.5;
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * C + cx;
        const sx = Math.floor(cx + 0.5 + cwx[i] * a + jit[(cx & 63) | j1] * fj) - mx0;
        const sy = Math.floor(ry + cwy[i] * a + jit[((cx + 17) & 63) | j2] * fj) - my0;
        if (sx < 0 || sy < 0 || sx >= mw || sy >= mh || !mask[sy * mw + sx]) continue;
        const nt = fn(i, g[i], cx, cy);
        if (nt >= 0) g[i] = nt;
      }
    }
  }

  /** 원 모양 영역. 반경은 저주파 노이즈로 흔들어 덩어리 모양으로. fn(i, t, cx, cy, d/r) */
  paintCircle(x, y, r, amp, fn) {
    const c = this.cell, pad = r * 0.3 + amp * 1.6 + 4;
    const cx0 = Math.max(0, Math.floor((x - r - pad) / c)), cx1 = Math.min(this.cols - 1, Math.ceil((x + r + pad) / c));
    const cy0 = Math.max(0, Math.floor((y - r - pad) / c)), cy1 = Math.min(this.rows - 1, Math.ceil((y + r + pad) / c));
    const g = this.grid, C = this.cols, cl = this.cl, cwx = this.cwx, cwy = this.cwy, jit = this.jit;
    const a = amp / 110, rk = (r * 0.56) / 255, r0 = r * 0.72;
    for (let cy = cy0; cy <= cy1; cy++) {
      const j1 = (cy & 63) << 6, j2 = ((cy + 29) & 63) << 6, wy = (cy + 0.5) * c - y;
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * C + cx;
        const dx = (cx + 0.5) * c - x + cwx[i] * a + jit[(cx & 63) | j1] * 1.5;
        const dy = wy + cwy[i] * a + jit[((cx + 17) & 63) | j2] * 1.5;
        const rr = r0 + rk * cl[i];
        const d2 = dx * dx + dy * dy;
        if (d2 > rr * rr) continue;
        const nt = fn(i, g[i], cx, cy, Math.sqrt(d2) / rr);
        if (nt >= 0) g[i] = nt;
      }
    }
  }

  /**
   * 4m(2칸) 거친 격자 거리장. flags[t]=1 인 지형이 원천. 영역은 칸 단위 [cx0..cx1]×[cy0..cy1].
   * 반환 F, 칸 거리(m)는 this.sampleDist(F, cx, cy)
   */
  coarseDist(flags, cx0, cy0, cx1, cy1, capM = 200) {
    cx0 = Math.max(0, cx0) & ~1;
    cy0 = Math.max(0, cy0) & ~1;
    cx1 = Math.min(this.cols - 1, cx1);
    cy1 = Math.min(this.rows - 1, cy1);
    const gx0 = cx0 >> 1, gy0 = cy0 >> 1;
    const w = (cx1 >> 1) - gx0 + 1, h = (cy1 >> 1) - gy0 + 1;
    const src = new Uint8Array(w * h), g = this.grid, C = this.cols, R = this.rows;
    for (let y = 0; y < h; y++) {
      const fy = (gy0 + y) * 2;
      for (let x = 0; x < w; x++) {
        const fx = (gx0 + x) * 2;
        const i = fy * C + fx;
        let v = flags[g[i]];
        if (!v && fx + 1 < C) v = flags[g[i + 1]];
        if (!v && fy + 1 < R) v = flags[g[i + C]] || (fx + 1 < C && flags[g[i + C + 1]]);
        src[y * w + x] = v ? 1 : 0;
      }
    }
    const cs = this.cell * 2; // 4m
    return { d: chamferU16(src, w, h, cs * 10, Math.round(cs * 14.14), Math.min(65000, capM * 10)), gx0, gy0, w, h, cs };
  }
  /** 거친 거리장을 칸 중심에서 쌍선형 표본 (m) */
  sampleDist(F, cx, cy) {
    let u = (cx + 0.5) / 2 - 0.5 - F.gx0, v = (cy + 0.5) / 2 - 0.5 - F.gy0;
    if (u < 0) u = 0;
    else if (u > F.w - 1.001) u = F.w - 1.001;
    if (v < 0) v = 0;
    else if (v > F.h - 1.001) v = F.h - 1.001;
    const iu = u | 0, iv = v | 0, tu = u - iu, tv = v - iv, k = iv * F.w + iu;
    const d = F.d, W = F.w;
    const a = d[k], b = d[k + 1], c = d[k + W], e = d[k + W + 1];
    return (a + (b - a) * tu + (c - a) * tv + (a - b - c + e) * tu * tv) * 0.1;
  }

  // 바다 → 갯벌 → 얕은 물 띠 → 모래 해변
  step_sea() {
    const M = this.map;
    if (!M.sea?.length) return;
    this.paintPolys(M.sea, 10, 2.2, () => T.SEA);
    // 갯벌 띠가 얇으니(20~40 m) 경계 흔들림을 작게
    this.paintPolys(M.mudflats, 6, 2, (i, t) => (t === T.SEA ? T.MUD : -1));
    // 바다 칸 범위
    const g = this.grid, C = this.cols;
    let x0 = C, y0 = this.rows, x1 = -1, y1 = -1;
    for (let cy = 0; cy < this.rows; cy++) {
      const r = cy * C;
      for (let cx = 0; cx < C; cx++) {
        const t = g[r + cx];
        if (t !== T.SEA && t !== T.MUD) continue;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
      }
    }
    if (x1 < 0) return;
    const m = 16;
    const notSea = flagsOf([T.MUD, T.SAND, T.GRASS, T.FIELD, T.PADDY, T.FOREST, T.MOUNTAIN, T.ROCK, T.YARD, T.VOID]);
    const L = this.coarseDist(notSea, x0 - m, y0 - m, x1 + m, y1 + m, 60);
    const S = this.coarseDist(flagsOf([T.SEA]), x0 - m, y0 - m, x1 + m, y1 + m, 60);
    const cn = this.cn, cl = this.cl;
    const ex0 = Math.max(0, x0 - m), ey0 = Math.max(0, y0 - m), ex1 = Math.min(C - 1, x1 + m), ey1 = Math.min(this.rows - 1, y1 + m);
    for (let cy = ey0; cy <= ey1; cy++)
      for (let cx = ex0; cx <= ex1; cx++) {
        const i = cy * C + cx, t = g[i];
        if (t === T.SEA) {
          if (this.sampleDist(L, cx, cy) < 2 + 6 * (cn[i] / 255)) g[i] = T.SHALLOW;
        } else if (t === T.GRASS) {
          const nl = cl[i] / 255;
          if (this.sampleDist(S, cx, cy) < 3 + 10 * nl * nl + (cn[i] / 255) * 3) g[i] = T.SAND;
        } else if (t === T.MUD) {
          if (cn[i] > 190 && cl[i] > 110 && this.sampleDist(S, cx, cy) > 8) g[i] = T.SAND; // 갯벌 속 모래톱
        }
      }
  }

  // 높이장(8m) + 산비탈/바위
  step_mountains() {
    const M = this.map, mts = M.mountains || [];
    const { hcols, hrows, hc, tex } = this;
    for (let j = 0; j < hrows; j++)
      for (let i = 0; i < hcols; i++) {
        const k = j * hcols + i, x = i * hc, y = j * hc;
        let h = 0.05 * this.N1[k]; // 낮은 구릉
        let rock = 0, best = 0;
        const wx = this.WX[k], wy = this.WY[k];
        for (let m = 0; m < mts.length; m++) {
          const mt = mts[m];
          const dx = x - mt.x + wx * mt.r * 0.16, dy = y - mt.y + wy * mt.r * 0.16;
          if (dx > mt.r * 1.5 || dx < -mt.r * 1.5 || dy > mt.r * 1.5 || dy < -mt.r * 1.5) continue;
          const d0 = Math.sqrt(dx * dx + dy * dy);
          // 방향에 따라 반경을 흔든다 (산줄기 모양)
          const ux = d0 > 1e-3 ? dx / d0 : 1, uy = d0 > 1e-3 ? dy / d0 : 0;
          const rr = mt.r * (0.74 + 0.5 * texAt(tex, ux * 10 + m * 23.1, uy * 10 + m * 7.7));
          const d = d0 / rr;
          if (d >= 1.25) continue;
          const ridge = 1 - Math.abs(2 * fbmAt(tex, x + m * 97, y - m * 61, 95, 3, 50) - 1);
          const p = Math.pow(1 - d / 1.25, 1.6) * (mt.height ?? 0.7) * (0.6 + 0.55 * ridge);
          if (p > best) {
            best = p;
            rock = mt.rock ?? 0.3;
          }
          h = 1 - (1 - h) * (1 - p); // 부드러운 최댓값
        }
        this.height[k] = h;
        this.rockiness[k] = rock;
      }
    // 칸 단위 분류: 높이가 있을 법한 거친 칸만
    const g = this.grid, C = this.cols, c = this.cell, cn = this.cn, H = this.height, Rk = this.rockiness, tex2 = this.tex2;
    const per = hc / c; // 거친 칸 하나에 4×4 칸
    for (let j = 0; j + 1 < hrows; j++)
      for (let i = 0; i + 1 < hcols; i++) {
        const k = j * hcols + i;
        const h00 = H[k], h10 = H[k + 1], h01 = H[k + hcols], h11 = H[k + hcols + 1];
        if (h00 < 0.19 && h10 < 0.19 && h01 < 0.19 && h11 < 0.19) continue;
        const r00 = Rk[k], r10 = Rk[k + 1], r01 = Rk[k + hcols], r11 = Rk[k + hcols + 1];
        for (let sy = 0; sy < per; sy++) {
          const cy = j * per + sy;
          if (cy >= this.rows) break;
          const ty = (sy + 0.5) / per;
          for (let sx = 0; sx < per; sx++) {
            const cx = i * per + sx;
            if (cx >= C) break;
            const idx = cy * C + cx;
            if (g[idx] !== T.GRASS) continue;
            const tx = (sx + 0.5) / per;
            const hb = h00 + (h10 - h00) * tx + (h01 - h00) * ty + (h00 - h10 - h01 + h11) * tx * ty;
            const det = cn[idx] / 255;
            const hh = hb + (det - 0.5) * 0.07 + this.jit[(cx & 63) | ((cy & 63) << 6)] * 0.02;
            if (hh < 0.25) continue;
            g[idx] = T.MOUNTAIN;
            const rk = r00 + (r10 - r00) * tx + (r01 - r00) * ty + (r00 - r10 - r01 + r11) * tx * ty;
            const thr = 0.6 + (1 - rk) * 0.4;
            // 바위 노이즈: 축에 맞춰 네모지지 않게 좌표를 돌리고 두 겹을 섞는다
            const crag = texAt(tex, cx * 0.37 + cy * 0.26 + 90, cy * 0.37 - cx * 0.26 + 13) * 0.62 + texAt(tex2, cx * 0.61 - cy * 0.52 + 7, cx * 0.52 + cy * 0.61 + 31) * 0.38;
            if ((hh > thr && crag > 0.5) || (hh > 0.42 && crag > 0.72 - rk * 0.1)) g[idx] = T.ROCK;
          }
        }
      }
  }

  step_forests() {
    const fs = this.map.forests || [];
    const fi = this.forestIdx, cn = this.cn, tex = this.tex;
    fs.forEach((f, n) => {
      const id = n + 1;
      const dens = f.density ?? 0.7;
      const thr = 1 - dens * 0.95;
      const fn = (i, t, cx, cy) => {
        if (!fi[i]) fi[i] = id;
        if (t !== T.GRASS) return -1;
        const clear = texAt(tex, cx * 0.25 + cy * 0.17 + n * 31, cy * 0.25 - cx * 0.17 + n * 17) * 0.7 + (cn[i] / 255) * 0.3;
        return clear > thr ? T.FOREST : -1;
      };
      if (f.poly) this.paintPolys([f.poly], 18, 3, fn);
      else this.paintCircle(f.x, f.y, f.r, 16, fn);
    });
  }

  step_fields() {
    for (const f of this.map.fields || []) {
      const tt = f.kind === 'paddy' ? T.PADDY : T.FIELD;
      this.paintPolys([f.poly], 5, 1.5, (i, t) => (t === T.GRASS || t === T.FOREST || t === T.SAND ? tt : -1));
    }
  }

  step_rivers() {
    const g = this.grid, C = this.cols, c = this.cell, cl = this.cl;
    // 모래톱(sands) 자리: 큰 강은 여기를 비워 둔다 (섬). 지류(샛강 등)는 그대로 흐른다
    let sm = null;
    if (this.map.sands?.length) {
      sm = this.sandMask = new Uint8Array(g.length);
      this.paintPolys(this.map.sands, 5, 1.5, (i) => ((sm[i] = 1), -1));
    }
    (this.map.rivers || []).forEach((rv, ri) => {
      const pts = rv.points;
      const sh = rv.shallow ?? 6;
      const widths = rv.widths && rv.widths.length === pts.length ? rv.widths : null;
      const wide = sm && Math.max(rv.width ?? 0, ...(widths || [0])) >= 40;
      const info = { id: rv.id, name: rv.name, hanja: rv.hanja, points: pts, width: rv.width ?? 20, shallow: sh, widths, segs: [] };
      this.rivers.push(info);
      for (let s = 0; s + 1 < pts.length; s++) {
        const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
        const wa = widths ? widths[s] : info.width, wb = widths ? widths[s + 1] : info.width;
        const seg = { ax, ay, bx, by, wa, wb, shallow: sh, river: info, ri, si: s };
        info.segs.push(seg);
        const R = Math.max(wa, wb) * 0.5 * 1.15 + sh * 1.3 + 10;
        this.riverIndex.add(seg, R);
        const cx0 = Math.max(0, Math.floor((Math.min(ax, bx) - R) / c)), cx1 = Math.min(C - 1, Math.ceil((Math.max(ax, bx) + R) / c));
        const cy0 = Math.max(0, Math.floor((Math.min(ay, by) - R) / c)), cy1 = Math.min(this.rows - 1, Math.ceil((Math.max(ay, by) + R) / c));
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const cwx = this.cwx, cwy = this.cwy, jit = this.jit, cn = this.cn, a = 6 / 110;
        for (let cy = cy0; cy <= cy1; cy++) {
          const j1 = (cy & 63) << 6, j2 = ((cy + 29) & 63) << 6, py0 = (cy + 0.5) * c;
          for (let cx = cx0; cx <= cx1; cx++) {
            const i = cy * C + cx, t = g[i];
            if (t === T.RIVER || t === T.SEA || (wide && sm[i])) continue;
            const ox = (cx + 0.5) * c + cwx[i] * a + jit[(cx & 63) | j1] * 1.2;
            const oy = py0 + cwy[i] * a + jit[((cx + 17) & 63) | j2] * 1.2;
            let u = ((ox - ax) * dx + (oy - ay) * dy) / L2;
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            const px = ax + dx * u - ox, py = ay + dy * u - oy;
            const d2 = px * px + py * py;
            const half = (wa + (wb - wa) * u) * 0.5 * (0.9 + 0.22 * (cl[i] / 255));
            if (d2 < half * half) g[i] = T.RIVER;
            else if (t !== T.SHALLOW) {
              const hs = half + sh * (0.7 + 0.6 * (cn[i] / 255));
              if (d2 < hs * hs) g[i] = T.SHALLOW;
            }
          }
        }
      }
    });
  }

  step_ponds() {
    const g = this.grid, C = this.cols;
    const notPond = flagsOf([T.MUD, T.SAND, T.GRASS, T.FIELD, T.PADDY, T.FOREST, T.MOUNTAIN, T.ROCK, T.YARD, T.VOID, T.WALL, T.SEA]);
    for (const p of this.map.ponds || []) {
      this.paintPolys([p], 3, 1.2, (i, t) => (t === T.WALL ? -1 : T.SHALLOW));
      const b = polyBounds([p]);
      const cx0 = Math.floor(b.x0 / this.cell) - 6, cy0 = Math.floor(b.y0 / this.cell) - 6;
      const cx1 = Math.ceil(b.x1 / this.cell) + 6, cy1 = Math.ceil(b.y1 / this.cell) + 6;
      const F = this.coarseDist(notPond, cx0, cy0, cx1, cy1, 60);
      for (let cy = Math.max(0, cy0); cy <= Math.min(this.rows - 1, cy1); cy++)
        for (let cx = Math.max(0, cx0); cx <= Math.min(C - 1, cx1); cx++) {
          const i = cy * C + cx;
          if (g[i] === T.SHALLOW && this.sampleDist(F, cx, cy) > 6) g[i] = T.RIVER;
        }
    }
  }

  /** 다각형들 경계 상자 → 칸 범위 [cx0, cy0, cx1, cy1] (pad m) */
  _cellBox(polys, pad) {
    const b = polyBounds(polys), c = this.cell;
    return [Math.max(0, Math.floor((b.x0 - pad) / c)), Math.max(0, Math.floor((b.y0 - pad) / c)), Math.min(this.cols - 1, Math.ceil((b.x1 + pad) / c)), Math.min(this.rows - 1, Math.ceil((b.y1 + pad) / c))];
  }

  // 모래톱·섬(sands): 큰 강이 비워 둔 자리를 모래로, 둘레 깊은 물은 얕은 물 띠로
  step_sands() {
    const sm = this.sandMask;
    if (!sm) return;
    const g = this.grid, C = this.cols, cn = this.cn;
    const [cx0, cy0, cx1, cy1] = this._cellBox(this.map.sands, 16);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * C + cx, t = g[i];
        if (sm[i] && !isWaterT(t) && t !== T.WALL) g[i] = T.SAND;
      }
    const F = this.coarseDist(flagsOf([T.SAND]), cx0, cy0, cx1, cy1, 30);
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * C + cx, t = g[i];
        if ((t === T.RIVER || t === T.SEA) && this.sampleDist(F, cx, cy) < 2.5 + 4 * (cn[i] / 255)) g[i] = T.SHALLOW;
      }
    this.sandMask = null;
  }

  // 갈대밭(reeds): 물가 뭍·얕은 물 위
  step_reeds() {
    const R = this.map.reeds;
    if (!R?.length) return;
    const ok = flagsOf([T.GRASS, T.FIELD, T.SAND, T.MUD, T.SHALLOW, T.PADDY, T.FOREST]);
    this.paintPolys(R, 5, 1.5, (i, t) => (ok[t] ? T.REED : -1));
  }

  // 물길 노선(증기선) 둘레 R m 는 깊은 물: 모래톱·갯벌·얕은 물에 걸려 좌초하지 않게 (A.5)
  step_channels() {
    const g = this.grid, C = this.cols, R = 6, c = this.cell;
    const soft = flagsOf([T.SHALLOW, T.MUD, T.SAND, T.REED]);
    for (const ln of this.map.lines || []) {
      if (ln.kind !== 'water') continue;
      let deep = T.RIVER;
      for (let s = 0; s + 1 < ln.points.length; s++) {
        const [ax, ay] = ln.points[s], [bx, by] = ln.points[s + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
          let sea = 0, riv = 0;
          for (let q = 0; q < 8; q++) {
            const t = this.at(x + Math.cos(q * 0.785) * (R + 5), y + Math.sin(q * 0.785) * (R + 5));
            if (t === T.SEA) sea++;
            else if (t === T.RIVER) riv++;
          }
          if (sea) deep = T.SEA;
          else if (riv) deep = T.RIVER;
          const x0 = Math.max(0, Math.floor((x - R) / c)), x1 = Math.min(C - 1, Math.floor((x + R) / c));
          const y0 = Math.max(0, Math.floor((y - R) / c)), y1 = Math.min(this.rows - 1, Math.floor((y + R) / c));
          for (let cy = y0; cy <= y1; cy++)
            for (let cx = x0; cx <= x1; cx++) {
              const px = (cx + 0.5) * c - x, py = (cy + 0.5) * c - y, i = cy * C + cx;
              if (px * px + py * py <= R * R && soft[g[i]]) g[i] = deep;
            }
        }
      }
    }
  }

  // 강변 모래톱
  step_banks() {
    if (!this.rivers.length) return;
    const g = this.grid, C = this.cols, R = this.rows, cl = this.cl, cn = this.cn;
    const F = this.coarseDist(flagsOf([T.RIVER, T.SHALLOW]), 0, 0, C - 1, R - 1, 40);
    for (let cy = 0; cy < R; cy++)
      for (let cx = 0; cx < C; cx++) {
        const i = cy * C + cx, t = g[i];
        if (t !== T.GRASS && t !== T.FIELD) continue;
        if (cl[i] < 133) continue; // 저주파 노이즈가 높은 곳에만 모래톱
        const dd = this.sampleDist(F, cx, cy);
        if (dd > 26) continue;
        if (dd < (cl[i] / 255 - 0.52) * 70 + (cn[i] / 255) * 3) g[i] = T.SAND;
      }
  }

  step_yards() {
    for (const s of this.map.settlements || []) {
      const city = s.kind === 'city', dense = city || (s.kind === 'town' && s.alleys), camp = s.kind === 'camp';
      const rr = s.r * (city ? 0.9 : dense ? 0.75 : camp ? 0.8 : 0.26);
      const cn = this.cn;
      this.paintCircle(s.x, s.y, rr, dense ? 26 : 9, (i, t, cx, cy, dn) => {
        if (t !== T.GRASS && t !== T.FIELD && t !== T.FOREST && t !== T.SAND && !(camp && t === T.PADDY)) return -1;
        const n = cn[i] / 255;
        return n > (dense ? 0.1 + dn * 0.22 : camp ? 0.12 + dn * 0.3 : 0.36 + dn * 0.34) ? T.YARD : -1;
      });
    }
  }

  /** 두꺼운 선을 원 도장으로 찍는다. fn(i, t) → 새 지형/-1. jitter: 반경 흔들림(m) */
  stampLine(pts, radius, step, fn, jitter = 0) {
    const c = this.cell, C = this.cols, g = this.grid, tex = this.tex;
    for (let s = 0; s + 1 < pts.length; s++) {
      const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
      const L = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
        const r = radius + (jitter ? (texAt(tex, x * 0.9, y * 0.9) - 0.5) * 2 * jitter : 0);
        const r2 = r * r;
        const cx0 = Math.max(0, Math.floor((x - r) / c)), cx1 = Math.min(C - 1, Math.floor((x + r) / c));
        const cy0 = Math.max(0, Math.floor((y - r) / c)), cy1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
        for (let cy = cy0; cy <= cy1; cy++) {
          const py = (cy + 0.5) * c - y;
          for (let cx = cx0; cx <= cx1; cx++) {
            const px = (cx + 0.5) * c - x;
            if (px * px + py * py > r2) continue;
            const i = cy * C + cx;
            const nt = fn(i, g[i]);
            if (nt >= 0) g[i] = nt;
          }
        }
      }
    }
  }

  /** 폴리라인을 따라 걸으며 물을 건너는 짧은 구간(양 끝이 땅)을 찾는다 → [[a],[b]] 목록 */
  findWaterRuns(pts, maxLen) {
    const runs = [];
    let cur = null, walked = 0;
    for (let s = 0; s + 1 < pts.length; s++) {
      const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
      const L = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(L));
      const last = s + 2 === pts.length;
      for (let k = 0; k <= (last ? n : n - 1); k++) {
        const t = k / n;
        const p = { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, d: walked + L * t };
        const wet = isWaterT(this.at(p.x, p.y));
        if (wet && !cur) cur = { start: p, end: p, touchStart: p.d < 1.5 };
        else if (wet && cur) cur.end = p;
        else if (!wet && cur) {
          runs.push(cur);
          cur = null;
        }
      }
      walked += L;
    }
    if (cur) {
      cur.touchEnd = true;
      runs.push(cur);
    }
    return runs
      .filter((r) => !r.touchStart && !r.touchEnd && r.end.d - r.start.d <= maxLen)
      .map((r) => {
        const a = r.start, b = r.end;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const e = 3, ca = Math.cos(ang), sa = Math.sin(ang);
        return [[a.x - ca * e, a.y - sa * e], [b.x + ca * e, b.y + sa * e]];
      });
  }

  step_roads() {
    const roads = this.map.roads || [];
    this._roadBridges = [];
    for (const rd of roads) {
      const w = rd.width ?? (rd.kind === 'main' ? 10 : rd.kind === 'path' ? 2.5 : 6);
      const tt = rd.kind === 'main' ? T.MAIN_ROAD : rd.kind === 'street' ? T.STREET : T.ROAD;
      const rank = ROAD_RANK[tt];
      const info = { id: rd.id, name: rd.name, kind: rd.kind || 'road', points: rd.points, width: w, terrain: tt };
      this.roads.push(info);
      // 물을 건너는 짧은 구간은 다리
      for (const bp of this.findWaterRuns(rd.points, 70)) this._roadBridges.push({ id: `${rd.id}_br${this._roadBridges.length}`, points: bp, width: Math.max(4, w + 1), auto: true, road: rd.id });
      const jitter = rd.kind === 'path' ? 0.4 : rd.kind === 'street' ? 0.15 : 0.5;
      this.stampLine(rd.points, w / 2, Math.max(0.6, Math.min(1.5, w / 4)), (i, t) => {
        if (t === T.SEA || t === T.RIVER || t === T.SHALLOW || t === T.WALL || t === T.BRIDGE || t === T.PIER) return -1;
        const rk = ROAD_RANK[t];
        if (rk && rk >= rank) return -1;
        return tt;
      }, jitter);
      for (let s = 0; s + 1 < rd.points.length; s++) {
        const [ax, ay] = rd.points[s], [bx, by] = rd.points[s + 1];
        this.roadIndex.add({ ax, ay, bx, by, road: info, w }, w);
      }
    }
  }

  paintBridge(br) {
    this.stampLine(br.points, br.width / 2, 0.8, (i, t) => {
      if (t === T.WALL) return -1;
      if (isWaterT(t) && !this.bridgeUnder.has(i)) this.bridgeUnder.set(i, t);
      return T.BRIDGE;
    });
    this.bridges.push(br);
  }

  step_bridges() {
    for (const br of this._roadBridges || []) this.paintBridge(br);
    for (const br of this.map.bridges || []) this.paintBridge({ id: br.id, name: br.name, points: br.points, width: br.width ?? 6, auto: false });
  }

  step_rails() {
    for (const ln of this.map.lines || []) {
      if (ln.kind !== 'rail') continue;
      const embedded = ln.embedded ?? ln.id === 'tram';
      if (embedded) continue;
      for (const bp of this.findWaterRuns(ln.points, 400)) this.paintBridge({ id: `${ln.id}_br${this.bridges.length}`, points: bp, width: 5, auto: true, rail: ln.id });
      this.stampLine(ln.points, 1.7, 0.7, (i, t) => (isWaterT(t) || t === T.WALL || t === T.BRIDGE || t === T.PIER ? -1 : T.RAIL));
    }
  }

  // 승강장: 정차점 기준 선로 북쪽 띠 (A.4: 선로 중심에서 off0~off1 m, 길이 len m)
  step_platforms() {
    for (const ln of this.map.lines || []) {
      const pf = ln.platform;
      if (!pf || ln.kind !== 'rail') continue;
      const pts = ln.points, cum = polylineCumulative(pts), L = cum[cum.length - 1];
      const stops = pf.stops ? (ln.stops || []).filter((s) => pf.stops.includes(s.id)) : ln.stops || [];
      for (const s of stops) {
        const sd = s.d ?? closestOnPolyline(pts, s.x, s.y, cum).d;
        const d0 = Math.max(0, sd - pf.len / 2), d1 = Math.min(L, sd + pf.len / 2);
        const inner = [], outer = [];
        for (let d = d0; d <= d1 + 0.01; d += 0.5) {
          const p = pointAtDistance(pts, Math.min(d, d1), cum);
          let nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
          if (ny > 0) (nx = -nx), (ny = -ny); // 북쪽
          inner.push([p.x + nx * pf.off0, p.y + ny * pf.off0]);
          outer.push([p.x + nx * pf.off1, p.y + ny * pf.off1]);
          for (let o = pf.off0; o <= pf.off1 + 0.01; o += 0.6) {
            const i = this.idx(p.x + nx * o, p.y + ny * o);
            if (i >= 0 && isSoftGround(this.grid[i])) this.grid[i] = T.STREET;
          }
        }
        this.platforms.push({ line: ln.id, stop: s.id, name: s.name, d0, d1, inner, outer, poly: inner.concat(outer.slice().reverse()) });
      }
    }
  }

  step_piers() {
    const c = this.cell, C = this.cols, g = this.grid;
    for (const b of this.map.buildings || []) {
      if (b.kind !== 'pier') continue;
      const a = b.angle || 0, ca = Math.cos(a), sa = Math.sin(a);
      const hw = b.w / 2, hh = b.h / 2;
      const R = Math.hypot(hw, hh);
      const cx0 = Math.max(0, Math.floor((b.x - R) / c)), cx1 = Math.min(C - 1, Math.ceil((b.x + R) / c));
      const cy0 = Math.max(0, Math.floor((b.y - R) / c)), cy1 = Math.min(this.rows - 1, Math.ceil((b.y + R) / c));
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const dx = (cx + 0.5) * c - b.x, dy = (cy + 0.5) * c - b.y;
          const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
          if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) g[cy * C + cx] = T.PIER;
        }
      this.piers.push(b);
    }
  }

  step_walls() {
    for (const wall of this.map.walls || []) {
      const pts = wall.points.slice();
      const closed = wall.closed ?? true;
      if (closed) pts.push(pts[0]);
      const th = wall.thickness ?? 4;
      // 대문을 성벽 선 위로 붙인다
      const gates = (wall.gates || []).map((gt) => {
        let best = null;
        for (let s = 0; s + 1 < pts.length; s++) {
          const c = closestOnSegment(gt.x, gt.y, pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1]);
          if (!best || c.dist < best.dist) best = { ...c, s };
        }
        let a = pts[best.s], b = pts[best.s + 1];
        // 꼭짓점 위 대문은 양옆 성벽의 가운데 방향으로 (꺾인 자리에 문루가 비뚤지 않게)
        const n = pts.length - (closed ? 1 : 0);
        if (Math.hypot(b[0] - best.x, b[1] - best.y) < 0.6 && (closed || best.s + 2 < pts.length)) b = pts[(best.s + 2) % n];
        else if (Math.hypot(a[0] - best.x, a[1] - best.y) < 0.6 && (closed || best.s > 0)) a = pts[(best.s - 1 + n) % n];
        const g = { id: gt.id, name: gt.name, hanja: gt.hanja, x: best.x, y: best.y, w: gt.w ?? 8, angle: Math.atan2(b[1] - a[1], b[0] - a[0]), thickness: th, wall: wall.id, wallName: wall.name, locked: !!gt.locked };
        this.gates.push(g);
        return g;
      });
      const inGap = (x, y, extra) => {
        for (const g of gates) {
          const dx = x - g.x, dy = y - g.y;
          const ca = Math.cos(g.angle), sa = Math.sin(g.angle);
          const along = Math.abs(dx * ca + dy * sa);
          const across = Math.abs(-dx * sa + dy * ca);
          if (along < g.w / 2 + extra && across < th * 2 + 2) return true;
        }
        return false;
      };
      const c = this.cell, C = this.cols, g = this.grid, r = th / 2, r2 = r * r + 0.5;
      for (let s = 0; s + 1 < pts.length; s++) {
        const [ax, ay] = pts[s], [bx, by] = pts[s + 1];
        const L = Math.hypot(bx - ax, by - ay);
        const n = Math.max(1, Math.ceil(L / 0.7));
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
          if (inGap(x, y, r)) continue;
          const cx0 = Math.max(0, Math.floor((x - r) / c)), cx1 = Math.min(C - 1, Math.floor((x + r) / c));
          const cy0 = Math.max(0, Math.floor((y - r) / c)), cy1 = Math.min(this.rows - 1, Math.floor((y + r) / c));
          for (let cy = cy0; cy <= cy1; cy++)
            for (let cx = cx0; cx <= cx1; cx++) {
              const px = (cx + 0.5) * c - x, py = (cy + 0.5) * c - y;
              if (px * px + py * py <= r2) g[cy * C + cx] = T.WALL;
            }
        }
        // 충돌·그리기용 선분 (대문 구간을 잘라낸다)
        const ux = (bx - ax) / (L || 1), uy = (by - ay) / (L || 1);
        let cuts = [[0, L]];
        for (const gt of gates) {
          const t = (gt.x - ax) * ux + (gt.y - ay) * uy;
          const off = Math.abs(-(gt.x - ax) * uy + (gt.y - ay) * ux);
          if (off > th + 1 || t < -gt.w || t > L + gt.w) continue;
          const g0 = t - gt.w / 2, g1 = t + gt.w / 2;
          const next = [];
          for (const [a0, a1] of cuts) {
            if (g1 <= a0 || g0 >= a1) next.push([a0, a1]);
            else {
              if (g0 > a0) next.push([a0, g0]);
              if (g1 < a1) next.push([g1, a1]);
            }
          }
          cuts = next;
        }
        for (const [a0, a1] of cuts) {
          if (a1 - a0 < 0.3) continue;
          // cutA/cutB: 그 끝이 대문 자리로 잘린 끝인가 (충돌 사각형을 늘리지 않는다)
          this.wallSegs.push({ ax: ax + ux * a0, ay: ay + uy * a0, bx: ax + ux * a1, by: ay + uy * a1, thickness: th, wall: wall.id, cutA: a0 > 0, cutB: a1 < L });
        }
      }
      this.walls.push({ id: wall.id, name: wall.name, points: pts, thickness: th, gates });
    }
  }

  // 가장자리 바위 띠 (A.1: 북한산 y < 80, 관악산 남쪽 y > 2350). 양 끝은 얕아지고 경계는 노이즈로 들쭉날쭉
  step_edges() {
    const g = this.grid, C = this.cols, c = this.cell, cn = this.cn;
    for (const e of this.map.edgeRock || []) {
      const north = e.side !== 's';
      const span = Math.max(1, e.x1 - e.x0);
      for (let cx = Math.max(0, Math.floor(e.x0 / c)); cx <= Math.min(C - 1, Math.floor(e.x1 / c)); cx++) {
        const u = ((cx + 0.5) * c - e.x0) / span, taper = Math.min(1, u * 5, (1 - u) * 5);
        const depth = e.d * taper, n = Math.min(this.rows, Math.ceil((depth + 12) / c));
        for (let k = 0; k < n; k++) {
          const cy = north ? k : this.rows - 1 - k, i = cy * C + cx;
          if ((k + 0.5) * c < depth - 8 + (cn[i] / 255) * 20 && !isWaterT(g[i])) g[i] = T.ROCK;
        }
      }
    }
  }

  step_finish() {
    const { hcols, hrows, hc } = this;
    // 물 칸의 높이는 0, 거친 격자의 물/땅 거리
    const wet = new Uint8Array(hcols * hrows);
    for (let j = 0; j < hrows; j++)
      for (let i = 0; i < hcols; i++) {
        const k = j * hcols + i;
        const x = Math.min(this.w - 1, i * hc), y = Math.min(this.h - 1, j * hc);
        const t = this.at(x, y);
        const isW = isWaterT(t) || (t === T.BRIDGE && this.bridgeUnder.has(this.idx(x, y)));
        wet[k] = isW ? 1 : 0;
        if (isW) this.height[k] = Math.min(this.height[k], 0.02);
      }
    const src = new Uint8Array(wet.length);
    for (let k = 0; k < wet.length; k++) src[k] = wet[k] ? 0 : 1;
    const dl = chamfer(src, hcols, hrows, hc, 400);
    const dw = chamfer(wet, hcols, hrows, hc, 400);
    for (let k = 0; k < wet.length; k++) this.waterDist[k] = wet[k] ? dl[k] : -dw[k];
  }

  /** 통계: 지형별 칸 수 */
  histogram() {
    const h = new Array(T_COUNT).fill(0);
    for (let i = 0; i < this.grid.length; i++) h[this.grid[i]]++;
    return Object.fromEntries(TERRAIN.map((t) => [t.key, h[t.id]]));
  }
}

/** MAP → Terrain (단계마다 양보하며 onProgress(0..1, 문구)) */
export async function buildTerrain(MAP, onProgress = () => {}) {
  const tr = new Terrain(MAP);
  await tr.build(onProgress);
  return tr;
}
