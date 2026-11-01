// 지도 기하: 해안선·강·산(경위도) → 화면 단위 좌표, 보로노이 고을 경계, 인접 관계.
// DOM 을 쓰지 않으므로 Node(헤드리스 시험)에서도 그대로 돈다.
import { REGIONS, SEA_LINKS, LAND_LINKS } from '../data/regions.js';
import { hash, strHash, pointInPoly } from './util.js';

export const MAP_W = 720;
export const MAP_H = 1260;
export const proj = (lon, lat) => [(lon - 124.0) * 100, (43.1 - lat) * 125];

// 한반도 본토 해안선(압록강 하구에서 시계 방향). 북쪽 경계는 압록강·두만강.
const MAINLAND = [
  [124.32, 39.95], [124.6, 40.22], [124.95, 40.45], [125.35, 40.62], [125.75, 40.85], [126.15, 41.08], [126.5, 41.38],
  [126.88, 41.78], [127.25, 41.55], [127.7, 41.45], [128.15, 41.4], [128.08, 41.75], [128.1, 42.0], [128.45, 42.02],
  [128.85, 42.08], [129.2, 42.22], [129.5, 42.4], [129.75, 42.45], [129.8, 42.72], [129.99, 42.97], [130.22, 42.8],
  [130.4, 42.6], [130.62, 42.42], [130.69, 42.29], [130.45, 42.27], [130.25, 42.18], [129.95, 41.95], [129.78, 41.78],
  [129.68, 41.55], [129.62, 41.3], [129.42, 40.98], [129.2, 40.7], [128.95, 40.48], [128.65, 40.3], [128.3, 40.12],
  [128.05, 40.0], [127.85, 39.98], [127.62, 39.82], [127.42, 39.72], [127.3, 39.55], [127.38, 39.32], [127.48, 39.15],
  [127.62, 39.05], [127.9, 38.92], [128.15, 38.72], [128.38, 38.48], [128.58, 38.22], [128.7, 38.02], [128.85, 37.85],
  [129.0, 37.68], [129.15, 37.48], [129.3, 37.25], [129.42, 37.0], [129.45, 36.7], [129.42, 36.4], [129.4, 36.15],
  [129.57, 36.08], [129.5, 35.8], [129.43, 35.5], [129.28, 35.28], [129.15, 35.12], [129.0, 35.05], [128.8, 35.08],
  [128.68, 34.92], [128.55, 34.78], [128.38, 34.86], [128.15, 34.9], [127.95, 34.75], [127.8, 34.86], [127.68, 34.68],
  [127.48, 34.72], [127.33, 34.5], [127.12, 34.62], [126.95, 34.52], [126.78, 34.42], [126.6, 34.3], [126.45, 34.36],
  [126.28, 34.42], [126.3, 34.62], [126.38, 34.8], [126.38, 35.0], [126.4, 35.25], [126.48, 35.45], [126.5, 35.62],
  [126.66, 35.85], [126.68, 36.0], [126.55, 36.15], [126.48, 36.35], [126.32, 36.55], [126.15, 36.75], [126.32, 36.95],
  [126.6, 36.92], [126.85, 36.96], [126.78, 37.12], [126.65, 37.3], [126.6, 37.45], [126.52, 37.62], [126.4, 37.78],
  [126.18, 37.88], [125.95, 37.9], [125.72, 37.96], [125.52, 37.85], [125.3, 37.92], [125.0, 37.95], [124.75, 38.12],
  [124.82, 38.35], [125.05, 38.52], [125.3, 38.7], [125.18, 38.92], [125.3, 39.12], [125.42, 39.35], [125.4, 39.55],
  [125.15, 39.65], [124.9, 39.75], [124.62, 39.78], [124.42, 39.86],
];
const JEJU = (() => {
  const pts = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const wob = 1 + 0.06 * Math.sin(a * 3 + 1.2);
    pts.push([126.55 + Math.cos(a) * 0.37 * wob, 33.38 + Math.sin(a) * 0.16 * wob]);
  }
  return pts;
})();
const ULLEUNG = [[130.82, 37.52], [130.9, 37.53], [130.92, 37.48], [130.85, 37.46]];
const GEOJE = [[128.55, 34.95], [128.72, 34.98], [128.75, 34.82], [128.62, 34.72], [128.52, 34.84]];
const JINDO = [[126.15, 34.52], [126.35, 34.55], [126.38, 34.4], [126.2, 34.36]];
const NAMHAE = [[127.85, 34.85], [128.02, 34.86], [128.05, 34.72], [127.88, 34.7]];
const GANGHWA = [[126.38, 37.8], [126.52, 37.78], [126.53, 37.62], [126.4, 37.6]];

// 이웃 땅(만주·연해주, 일본) — 놀 수 없는 배경
const NORTH_FOREIGN_TAIL = [[131.5, 42.7], [131.5, 43.4], [123.5, 43.4], [123.5, 39.75], [124.0, 39.85]];
const JAPAN = [[131.5, 34.25], [131.0, 33.98], [130.6, 33.85], [130.35, 33.62], [130.0, 33.52], [129.65, 33.38], [129.5, 33.1], [131.5, 33.0]];
const TSUSHIMA = [[129.22, 34.68], [129.38, 34.62], [129.45, 34.38], [129.32, 34.12], [129.2, 34.3]];

// 강(발원지 → 하구)
const RIVERS = [
  { name: '압록강', pts: MAINLAND.slice(0, 11), border: true },
  { name: '두만강', pts: MAINLAND.slice(11, 24), border: true },
  { name: '청천강', pts: [[126.8, 40.35], [126.35, 40.05], [125.95, 39.75], [125.66, 39.62], [125.42, 39.56]] },
  { name: '대동강', pts: [[126.85, 39.85], [126.4, 39.5], [126.05, 39.2], [125.78, 39.02], [125.55, 38.86], [125.32, 38.72]] },
  { name: '임진강', pts: [[127.3, 38.65], [127.1, 38.25], [126.85, 37.95], [126.62, 37.76]] },
  { name: '한강', pts: [[128.75, 37.2], [128.25, 37.12], [127.93, 37.02], [127.62, 37.3], [127.32, 37.53], [127.0, 37.53], [126.78, 37.6], [126.58, 37.72]] },
  { name: '북한강', pts: [[127.62, 38.35], [127.73, 37.9], [127.5, 37.62], [127.32, 37.53]] },
  { name: '금강', pts: [[127.55, 35.8], [127.55, 36.1], [127.58, 36.38], [127.42, 36.5], [127.12, 36.47], [126.92, 36.28], [126.95, 36.12], [126.72, 36.0]] },
  { name: '낙동강', pts: [[128.98, 37.12], [128.85, 36.8], [128.7, 36.56], [128.4, 36.45], [128.38, 36.15], [128.45, 35.85], [128.4, 35.55], [128.75, 35.38], [128.95, 35.1]] },
  { name: '영산강', pts: [[126.98, 35.3], [126.85, 35.15], [126.7, 35.02], [126.5, 34.85], [126.38, 34.8]] },
  { name: '섬진강', pts: [[127.25, 35.62], [127.35, 35.35], [127.48, 35.2], [127.72, 35.05], [127.78, 34.93]] },
];

// 산(백두대간을 따라 먹으로 찍는 봉우리)
const MOUNTAINS = [
  { name: '백두산', lon: 128.08, lat: 41.98, big: 1.6 }, { name: '개마고원', lon: 127.5, lat: 40.85, big: 1.2 },
  { name: '낭림산', lon: 126.8, lat: 40.4, big: 1.1 }, { name: '묘향산', lon: 126.2, lat: 40.0, big: 1.0 },
  { name: '금강산', lon: 128.1, lat: 38.62, big: 1.2 }, { name: '설악산', lon: 128.45, lat: 38.12, big: 1.0 },
  { name: '오대산', lon: 128.55, lat: 37.78, big: 0.9 }, { name: '태백산', lon: 128.9, lat: 37.1, big: 1.0 },
  { name: '소백산', lon: 128.5, lat: 36.95, big: 0.9 }, { name: '속리산', lon: 127.87, lat: 36.54, big: 0.9 },
  { name: '덕유산', lon: 127.75, lat: 35.86, big: 0.9 }, { name: '지리산', lon: 127.73, lat: 35.33, big: 1.3 },
  { name: '한라산', lon: 126.53, lat: 33.38, big: 1.0 }, { name: '구월산', lon: 125.3, lat: 38.5, big: 0.8 },
  { name: '', lon: 127.0, lat: 41.0, big: 0.9 }, { name: '', lon: 128.6, lat: 41.3, big: 1.0 }, { name: '', lon: 129.0, lat: 41.7, big: 0.9 },
  { name: '', lon: 127.9, lat: 40.3, big: 0.8 }, { name: '', lon: 127.4, lat: 39.4, big: 0.8 }, { name: '', lon: 127.8, lat: 39.0, big: 0.8 },
  { name: '', lon: 128.25, lat: 38.4, big: 0.8 }, { name: '', lon: 128.7, lat: 37.45, big: 0.8 }, { name: '', lon: 128.2, lat: 36.7, big: 0.7 },
  { name: '', lon: 127.95, lat: 36.2, big: 0.7 }, { name: '', lon: 127.6, lat: 35.6, big: 0.7 }, { name: '', lon: 128.3, lat: 35.6, big: 0.6 },
  { name: '', lon: 126.4, lat: 40.6, big: 0.8 }, { name: '', lon: 128.3, lat: 37.9, big: 0.7 },
];

// Catmull-Rom 으로 부드럽게 + 아주 약한 붓 떨림
function smooth(pts, closed, sub = 3, jitter = 0.6, seed = 1) {
  const P = pts.map(([lo, la]) => proj(lo, la));
  const n = P.length, out = [];
  const get = (i) => (closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  const lim = closed ? n : n - 1;
  for (let i = 0; i < lim; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      let x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      let y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      if (jitter && s) {
        x += (hash(seed * 7919 + i * 31 + s) - 0.5) * jitter * 2;
        y += (hash(seed * 104729 + i * 17 + s) - 0.5) * jitter * 2;
      }
      out.push([x, y]);
    }
  }
  if (!closed) out.push(P[n - 1]);
  return out;
}

// 보로노이 셀(가장자리마다 이웃 번호를 붙여 둔다)
function clipCell(poly, mx, my, nx, ny, label) {
  const out = [];
  const L = poly.length;
  for (let k = 0; k < L; k++) {
    const a = poly[k], b = poly[(k + 1) % L];
    const fa = (a.x - mx) * nx + (a.y - my) * ny;
    const fb = (b.x - mx) * nx + (b.y - my) * ny;
    if (fa <= 0) {
      out.push({ x: a.x, y: a.y, e: a.e });
      if (fb > 0) {
        const t = fa / (fa - fb);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, e: label });
      }
    } else if (fb <= 0) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, e: a.e });
    }
  }
  return out;
}

// 이웃 사이 경계선을 결정적으로 구불구불하게(두 셀이 같은 선을 쓰도록 정규 방향을 정함)
function wigglyEdge(ax, ay, bx, by, key) {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(2, Math.ceil(len / 5));
  const amp = Math.min(7, len * 0.09);
  const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
  const h1 = hash(key), h2 = hash(key * 3 + 7), h3 = hash(key * 13 + 1);
  const f1 = 1 + Math.floor(h1 * 3), f2 = 3 + Math.floor(h2 * 4);
  const pts = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const d = amp * Math.sin(Math.PI * t) * (0.65 * Math.sin(Math.PI * 2 * (t * f1 + h2)) + 0.35 * Math.sin(Math.PI * 2 * (t * f2 + h3)));
    pts.push([ax + (bx - ax) * t + nx * d, ay + (by - ay) * t + ny * d]);
  }
  return pts;
}

let GEO = null;

export function buildGeo() {
  if (GEO) return GEO;
  const mainland = smooth(MAINLAND, true, 3, 0.7, 11);
  const islands = [JEJU, GEOJE, JINDO, NAMHAE, GANGHWA, ULLEUNG].map((p, i) => smooth(p, true, 3, 0.25, 20 + i));
  const land = [mainland, ...islands];
  // 북쪽 이웃 땅: 압록강~두만강 경계를 그대로 잇는다
  const borderPts = MAINLAND.slice(0, 24).map(([a, b]) => proj(a, b));
  const north = [...borderPts, ...NORTH_FOREIGN_TAIL.map(([a, b]) => proj(a, b))];
  const foreign = [north, smooth(JAPAN, true, 3, 0.5, 40), smooth(TSUSHIMA, true, 3, 0.3, 41)];
  const rivers = RIVERS.map((r, i) => ({ name: r.name, border: !!r.border, pts: smooth(r.pts, false, 3, r.border ? 0.3 : 0.5, 60 + i) }));
  const mountains = MOUNTAINS.map((m) => {
    const [x, y] = proj(m.lon, m.lat);
    return { name: m.name, x, y, big: m.big };
  });
  const onLand = (x, y) => land.some((poly) => pointInPoly(x, y, poly));

  // 고을 씨앗
  const seeds = REGIONS.map((r) => {
    const [x, y] = proj(r.lon, r.lat);
    return { id: r.id, x, y };
  });
  const idx = Object.fromEntries(seeds.map((s, i) => [s.id, i]));
  const M = 80;
  const cells = {};
  const edgeList = [];
  seeds.forEach((s, i) => {
    let poly = [
      { x: -M, y: -M, e: -1 }, { x: MAP_W + M, y: -M, e: -1 },
      { x: MAP_W + M, y: MAP_H + M, e: -1 }, { x: -M, y: MAP_H + M, e: -1 },
    ];
    seeds.forEach((t, j) => {
      if (i === j) return;
      poly = clipCell(poly, (s.x + t.x) / 2, (s.y + t.y) / 2, t.x - s.x, t.y - s.y, j);
    });
    // 경계선 구불구불하게
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      out.push([a.x, a.y]);
      if (a.e >= 0) {
        const j = a.e;
        const key = strHash(i < j ? `${i}-${j}` : `${j}-${i}`);
        const canonical = a.x < b.x - 1e-6 || (Math.abs(a.x - b.x) <= 1e-6 && a.y < b.y);
        const pts = canonical ? wigglyEdge(a.x, a.y, b.x, b.y, key) : wigglyEdge(b.x, b.y, a.x, a.y, key).reverse();
        out.push(...pts);
        if (i < j) edgeList.push({ a: s.id, b: seeds[j].id, pts: [[a.x, a.y], ...pts, [b.x, b.y]] });
      }
    }
    // 인접: 공유 변이 땅 위를 지나야 함
    const neighbors = new Set();
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      if (a.e < 0) continue;
      let hits = 0;
      for (let q = 1; q < 12; q++) {
        const t = q / 12;
        if (onLand(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) hits++;
      }
      if (hits >= 2) neighbors.add(seeds[a.e].id);
    }
    cells[s.id] = { id: s.id, x: s.x, y: s.y, poly: out, raw: poly.map((p) => [p.x, p.y]), neighbors };
  });
  // 대칭 맞추기 + 바닷길
  for (const id in cells) for (const n of cells[id].neighbors) cells[n].neighbors.add(id);
  for (const [a, b] of LAND_LINKS) {
    cells[a].neighbors.add(b);
    cells[b].neighbors.add(a);
  }
  for (const [a, b] of SEA_LINKS) {
    cells[a].neighbors.add(b);
    cells[b].neighbors.add(a);
    (cells[a].sea ||= new Set()).add(b);
    (cells[b].sea ||= new Set()).add(a);
  }
  const adj = {};
  for (const id in cells) adj[id] = [...cells[id].neighbors].sort();

  function regionAt(x, y) {
    if (!onLand(x, y)) return null;
    let best = null, bd = Infinity;
    for (const s of seeds) {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = s.id; }
    }
    return best;
  }
  function nearestSeeds(x, y, k = 3) {
    return seeds.map((s) => [s.id, (s.x - x) ** 2 + (s.y - y) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, k).map((e) => e[0]);
  }
  const isSeaLink = (a, b) => !!cells[a]?.sea?.has(b);

  GEO = { W: MAP_W, H: MAP_H, land, foreign, rivers, mountains, cells, adj, seeds, idx, edgeList, regionAt, nearestSeeds, onLand, isSeaLink, proj };
  return GEO;
}

export const adjOf = (id) => buildGeo().adj[id] || [];
export const isAdjacent = (a, b) => adjOf(a).includes(b);
