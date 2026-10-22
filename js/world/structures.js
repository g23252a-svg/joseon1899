// 건물·성벽·나무: 충돌 사각형(solids, 버킷 격자), 마을 집 절차 생성, 나무 목록,
// 그리고 HIGH 층 지붕 그리기(건물마다 오프스크린 캐시) + 땅에 붙는 그림자·기단(청크 렌더러가 부른다).

import { T, PASS, isSoftGround, SegIndex, inEdgeBand } from './terrain.js';
import { PAL } from '../engine/palette.js';
import { mulberry32, mixHex, rgba, clamp, pointInPolygon } from '../engine/util.js';

export const SOLID_BLOCKS = ['foot', 'swim', 'horse', 'wheel', 'boat']; // rail·ghost 는 통과 (노선 차량이 끼지 않게)
const TAU = Math.PI * 2;
// 빛은 북서에서 온다: 빛 쪽을 가리키는 단위 벡터 (지붕·수관 음영)
export const LIGHT_X = -0.6, LIGHT_Y = -0.8;

// ---------------------------------------------------------------- 공용

export function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w));
  h = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// 빠른 시드 난수 (나무 그리기처럼 많이 부르는 곳)
let _s = 1;
const srand = (seed) => (_s = (seed >>> 0) % 2147483646 || 1);
const rnd = () => (_s = (_s * 16807) % 2147483647) / 2147483647;

/**
 * 작은 도형이 아주 많은 경로는 잘게 끊어 칠해야 빠르다 (겹친 하위 경로 수천 개를 한 번에 칠하면 래스터화가 급격히 느려진다).
 * 도형 하나를 경로에 넣을 때마다 tick() 을 부른다. 끝나면 done().
 */
export function batcher(ctx, mode, every = 32) {
  let n = 0;
  const flush = () => {
    if (mode === 'fill') ctx.fill();
    else ctx.stroke();
    ctx.beginPath();
  };
  return {
    tick() {
      if (++n % every === 0) flush();
    },
    done() {
      flush();
      n = 0;
    },
  };
}

/** 회전 사각형 둘이 겹치는가 (분리축) — a, b = {x,y,w,h,angle}, margin 은 a 를 키운다 */
function obbOverlap(a, b, margin = 0) {
  const axes = [a.angle || 0, (a.angle || 0) + Math.PI / 2, b.angle || 0, (b.angle || 0) + Math.PI / 2];
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const ang of axes) {
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const ra = proj(a, ux, uy, margin), rb = proj(b, ux, uy, 0);
    if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
  }
  return true;
}
function proj(r, ux, uy, m) {
  const c = Math.cos(r.angle || 0), s = Math.sin(r.angle || 0);
  return Math.abs((c * ux + s * uy) * (r.w / 2 + m)) + Math.abs((-s * ux + c * uy) * (r.h / 2 + m));
}

// 지붕 종류: 정한 것(b.roof) > 특수 건물 > 양식(style) > 건물 종류
const STYLE_ROOF = { western: 'western', jp_wood: 'jp', cn_brick: 'cn', choga: 'thatch' };
const KIND_ROOF = { palace: 'palace', gate: 'gate', altar: 'altar', gate_monument: 'arch', wreck: 'wreck', hut: 'hut', pier: 'none' };
function roofOf(b) {
  if (b.roof) return b.roof;
  if (KIND_ROOF[b.kind]) return KIND_ROOF[b.kind];
  if (b.kind === 'pavilion') return b.style === 'jp_wood' ? 'jp' : 'pavilion';
  if (STYLE_ROOF[b.style]) return STYLE_ROOF[b.style];
  switch (b.kind) {
    case 'church': case 'legation': case 'customs': case 'hotel': case 'station': case 'depot': return 'western';
    case 'jumak': case 'smithy': case 'stable': case 'camp_hall': return 'thatch';
    default: return 'tile';
  }
}
const EAVE = { tile: 0.9, palace: 1.4, gate: 1.2, pavilion: 0.9, thatch: 0.55, hut: 0.4, western: 0.45, jp: 0.5, cn: 0.5, altar: 0, arch: 0, wreck: 0, none: 0 };
// 땅에 기단·마루를 그리지 않는 것 (지붕 그림이 몸체 전부)
const NO_BASE = { altar: 1, arch: 1, wreck: 1, none: 1 };

// ---------------------------------------------------------------- 본체

export class Structures {
  constructor(MAP, tr) {
    this.map = MAP;
    this.tr = tr;
    this.buildings = [];
    this.solids = [];
    this.bucket = new Map();
    this.bcell = 16;
    this._stamp = 0;
    this.bldBucket = new Map(); // 건물(지붕) 버킷 32m
    this.bbcell = 32;
    this.trees = null; // Float32Array [x, y, r, kind, seed] * n
    this.treeCount = 0;
    this.treeChunks = null; // 64m 청크별 나무 번호 배열
    this.tcell = 64;
    this.restricted = (MAP.zones || []).filter((z) => z.kind === 'restricted');
    // 미션·장소 자리는 마을 집이 덮지 않게 비워 둔다
    this.keepClear = (MAP.places || []).filter((p) => p.kind !== 'city' && p.kind !== 'village' && p.kind !== 'district').map((p) => ({ x: p.x, y: p.y, r: Math.min(p.radius ?? 6, 6) + 2 }));
  }

  _unbucket(map, cell, x0, y0, x1, y1, obj) {
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
      for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
        const a = map.get(this._bkey(cx, cy));
        const k = a ? a.indexOf(obj) : -1;
        if (k >= 0) a.splice(k, 1);
      }
  }
  /** 건물과 그 solids 를 뺀다 (지도 상태 변화용). 다시 넣을 때는 addBuilding(b) */
  removeBuilding(b) {
    if (!this.buildings.includes(b)) return false;
    this.buildings = this.buildings.filter((o) => o !== b);
    for (const s of this.solids) if (s.ref === b) this._unbucket(this.bucket, this.bcell, s.x0, s.y0, s.x1, s.y1, s);
    this.solids = this.solids.filter((s) => s.ref !== b);
    this._unbucket(this.bldBucket, this.bbcell, b.x - b._R, b.y - b._R, b.x + b._R, b.y + b._R, b);
    return true;
  }

  // ---------------- solids
  _bkey(cx, cy) {
    return (cx + 512) * 2048 + (cy + 512);
  }
  addSolid(s) {
    const c = Math.cos(s.angle || 0), n = Math.sin(s.angle || 0);
    const ex = Math.abs(c * s.w / 2) + Math.abs(n * s.h / 2), ey = Math.abs(n * s.w / 2) + Math.abs(c * s.h / 2);
    s.x0 = s.x - ex;
    s.y0 = s.y - ey;
    s.x1 = s.x + ex;
    s.y1 = s.y + ey;
    s._q = 0;
    if (!s.blocks) s.blocks = SOLID_BLOCKS;
    this.solids.push(s);
    const B = this.bcell;
    for (let cx = Math.floor(s.x0 / B); cx <= Math.floor(s.x1 / B); cx++)
      for (let cy = Math.floor(s.y0 / B); cy <= Math.floor(s.y1 / B); cy++) {
        const k = this._bkey(cx, cy);
        let b = this.bucket.get(k);
        if (!b) this.bucket.set(k, (b = []));
        b.push(s);
      }
    return s;
  }
  querySolids(x0, y0, x1, y1, out = []) {
    const B = this.bcell, st = ++this._stamp;
    const cx0 = Math.floor(x0 / B), cx1 = Math.floor(x1 / B), cy0 = Math.floor(y0 / B), cy1 = Math.floor(y1 / B);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const b = this.bucket.get(this._bkey(cx, cy));
        if (!b) continue;
        for (let i = 0; i < b.length; i++) {
          const s = b[i];
          if (s._q === st) continue;
          s._q = st;
          if (s.x1 < x0 || s.x0 > x1 || s.y1 < y0 || s.y0 > y1) continue;
          out.push(s);
        }
      }
    return out;
  }
  /** 점이 어떤 solid 안인가 (r 만큼 여유) */
  solidNear(x, y, r = 0) {
    const tmp = this.querySolids(x - r - 0.1, y - r - 0.1, x + r + 0.1, y + r + 0.1, []);
    for (const s of tmp) {
      const c = Math.cos(-(s.angle || 0)), n = Math.sin(-(s.angle || 0));
      const lx = (x - s.x) * c - (y - s.y) * n, ly = (x - s.x) * n + (y - s.y) * c;
      if (Math.abs(lx) <= s.w / 2 + r && Math.abs(ly) <= s.h / 2 + r) return true;
    }
    return false;
  }

  // ---------------- 건물 등록
  addBuilding(b) {
    b.roof = roofOf(b);
    b.eave = b.eave ?? EAVE[b.roof] ?? 0.6;
    b.angle = b.angle || 0;
    b.tags = b.tags || [];
    b.parts = b.parts || [{ x: 0, y: 0, w: b.w, h: b.h }];
    b.seed = b.seed ?? strHash(b.id);
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    // 지붕 그림 범위(로컬)
    let lx0 = Infinity, ly0 = Infinity, lx1 = -Infinity, ly1 = -Infinity;
    for (const p of b.parts) {
      lx0 = Math.min(lx0, p.x - p.w / 2);
      ly0 = Math.min(ly0, p.y - p.h / 2);
      lx1 = Math.max(lx1, p.x + p.w / 2);
      ly1 = Math.max(ly1, p.y + p.h / 2);
    }
    const pad = 1.2;
    b._lb = { x0: lx0 - pad, y0: ly0 - pad, x1: lx1 + pad, y1: ly1 + pad };
    const R = Math.hypot(Math.max(-b._lb.x0, b._lb.x1), Math.max(-b._lb.y0, b._lb.y1));
    b._R = R;
    // 충돌: 처마를 뺀 벽체
    if (b.roof !== 'none' && !b.noSolid) {
      for (const p of b.parts) {
        const wx = b.x + p.x * c - p.y * s, wy = b.y + p.x * s + p.y * c;
        const w = Math.max(0.6, p.w - 2 * b.eave), h = Math.max(0.6, p.h - 2 * b.eave);
        this.addSolid({ x: wx, y: wy, w, h, angle: b.angle, kind: b.kind === 'gate' ? 'gate' : 'building', ref: b });
      }
    }
    if (!b.door) b.door = this.doorOf(b);
    this.buildings.push(b);
    if (b.roof !== 'none') {
      const B = this.bbcell;
      for (let cx = Math.floor((b.x - R) / B); cx <= Math.floor((b.x + R) / B); cx++)
        for (let cy = Math.floor((b.y - R) / B); cy <= Math.floor((b.y + R) / B); cy++) {
          const k = this._bkey(cx, cy);
          let a = this.bldBucket.get(k);
          if (!a) this.bldBucket.set(k, (a = []));
          a.push(b);
        }
    }
    return b;
  }
  queryBuildings(x0, y0, x1, y1, out = []) {
    const B = this.bbcell, st = ++this._stamp;
    for (let cx = Math.floor(x0 / B); cx <= Math.floor(x1 / B); cx++)
      for (let cy = Math.floor(y0 / B); cy <= Math.floor(y1 / B); cy++) {
        const a = this.bldBucket.get(this._bkey(cx, cy));
        if (!a) continue;
        for (const b of a) {
          if (b._q === st) continue;
          b._q = st;
          if (b.x + b._R < x0 || b.x - b._R > x1 || b.y + b._R < y0 || b.y - b._R > y1) continue;
          out.push(b);
        }
      }
    return out;
  }

  /** 문 위치: front 가 주어지면 그 쪽, 아니면 가장 가까운 길 쪽 면의 가운데 바깥 */
  doorOf(b) {
    const c = Math.cos(b.angle), s = Math.sin(b.angle);
    if (b.kind === 'pier') {
      // 잔교: 뭍에 닿은 끝 (양 끝 중 물이 아닌 쪽)
      const long = b.w >= b.h, half = (long ? b.w : b.h) / 2;
      let best = null;
      for (const sd of [-1, 1]) {
        const lx = long ? sd * (half + 1.5) : 0, ly = long ? 0 : sd * (half + 1.5);
        const x = b.x + lx * c - ly * s, y = b.y + lx * s + ly * c;
        const t = this.tr.at(x, y);
        const dry = t !== T.SEA && t !== T.RIVER && t !== T.SHALLOW && t !== T.VOID;
        const ix = b.x + (lx * (half - 1)) / (half + 1.5) * c - (ly * (half - 1)) / (half + 1.5) * s;
        const iy = b.y + (lx * (half - 1)) / (half + 1.5) * s + (ly * (half - 1)) / (half + 1.5) * c;
        const p = dry ? { x, y } : { x: ix, y: iy };
        if (dry && !best?.dry) best = { ...p, dry };
        else if (!best) best = { ...p, dry };
      }
      return { x: best.x, y: best.y };
    }
    let side = b.front;
    if (!side) {
      const near = this.tr.roadIndex.nearest(b.x, b.y, 80);
      if (near) {
        const dx = near.x - b.x, dy = near.y - b.y;
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        side = Math.abs(lx) / (b.w || 1) > Math.abs(ly) / (b.h || 1) ? (lx > 0 ? 'e' : 'w') : ly > 0 ? 's' : 'n';
      } else side = 's';
      b.front = side;
    }
    const main = b.parts[0];
    const hw = main.w / 2 - b.eave, hh = main.h / 2 - b.eave;
    const at = (sd) => {
      let lx = main.x, ly = main.y;
      if (sd === 's') ly += hh + 0.6;
      else if (sd === 'n') ly -= hh + 0.6;
      else if (sd === 'e') lx += hw + 0.6;
      else lx -= hw + 0.6;
      return { x: b.x + lx * c - ly * s, y: b.y + lx * s + ly * c };
    };
    const p = at(side);
    if (!b.named || PASS.foot[this.tr.at(p.x, p.y)]) return p;
    // 문 앞이 물·바위면 걸을 수 있는 다른 면 (못 가운데 정자 등)
    for (const sd of ['e', 'w', 's', 'n']) {
      const q = at(sd);
      if (PASS.foot[this.tr.at(q.x, q.y)]) {
        b.front = sd;
        return q;
      }
    }
    return p;
  }

  // ---------------- 만들기
  build() {
    const tr = this.tr;
    // 성벽 solids
    for (const sg of tr.wallSegs) {
      const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay);
      const ux = (sg.bx - sg.ax) / (L || 1), uy = (sg.by - sg.ay) / (L || 1);
      const ea = sg.cutA ? 0 : sg.thickness / 2, eb = sg.cutB ? 0 : sg.thickness / 2;
      const a0 = -ea, a1 = L + eb;
      const mx = sg.ax + ux * (a0 + a1) / 2, my = sg.ay + uy * (a0 + a1) / 2;
      this.addSolid({ x: mx, y: my, w: a1 - a0, h: sg.thickness, angle: Math.atan2(uy, ux), kind: 'wall' });
    }
    // 대문 문루 + 석축
    for (const g of tr.gates) {
      const big = g.thickness >= 4;
      const W = g.w + g.thickness * 3 + (big ? 8 : 5);
      const H = g.thickness + (big ? 7 : 5);
      const b = this.addBuilding({ id: 'gate_' + g.id, kind: 'gate', name: g.name, hanja: g.hanja, x: g.x, y: g.y, w: W, h: H, angle: g.angle, tags: ['gate', 'landmark'], noSolid: true, gate: g, locked: g.locked, door: { x: g.x, y: g.y } });
      // 잠긴 문(숙정문): 문짝이 길을 막는다
      if (g.locked) this.addSolid({ x: g.x, y: g.y, w: g.w + 0.4, h: g.thickness, angle: g.angle, kind: 'gate', ref: b, locked: true });
      const L = W / 2 - b.eave - g.w / 2;
      if (L > 0.5) {
        const c = Math.cos(g.angle), s = Math.sin(g.angle);
        for (const sd of [-1, 1]) {
          const off = g.w / 2 + L / 2;
          this.addSolid({ x: g.x + c * off * sd, y: g.y + s * off * sd, w: L, h: H - 2 * b.eave + 1, angle: g.angle, kind: 'gate', ref: b });
        }
      }
    }
    // 이름 있는 건물
    for (const nb of this.map.buildings || []) {
      const b = this.addBuilding({ ...nb, tags: nb.tags ? nb.tags.slice() : [], named: true });
      if (b.kind === 'church') b.tower = true;
      this.paintYard(b, 2.5, 2.5);
    }
    // 큰 고을(도성)은 골목을 먼저 낸다 → 집이 골목을 따라 빽빽이
    for (const st of this.map.settlements || []) if (st.kind === 'city' || st.alleys) this.genAlleys(st);
    // 마을 집
    for (const st of this.map.settlements || []) this.placeSettlement(st);
    this.genTrees();
  }

  /** 골목: 큰길에서 곁가지로 휘며 뻗는 좁은 길 (지형에 STREET 로 칠하고 길 목록·색인에 넣는다) */
  genAlleys(st) {
    const tr = this.tr, rng = mulberry32((st.seed ?? strHash(st.id)) + 77);
    const W = st.alleyWidth ?? 4;
    const gap = st.alleyGap ?? 46;
    const base = tr.roadIndex.query(st.x - st.r, st.y - st.r, st.x + st.r, st.y + st.r, []).filter((s) => s.road.kind !== 'path');
    const alleys = [];
    const okAt = (x, y) => {
      if ((x - st.x) ** 2 + (y - st.y) ** 2 > st.r * st.r) return false;
      const t = tr.at(x, y);
      if (!(t === T.GRASS || t === T.YARD || t === T.FIELD || t === T.SAND || t === T.FOREST || (t === T.MOUNTAIN && tr.heightAt(x, y) < 0.33))) return false;
      return !this.inRestricted(x, y);
    };
    const roadHit = (x, y) => {
      const t = tr.at(x, y);
      return t === T.ROAD || t === T.MAIN_ROAD || t === T.STREET || t === T.BRIDGE;
    };
    const mine = new SegIndex(24);
    const walk = (sx, sy, ang, maxLen, depth) => {
      const pts = [[sx, sy]];
      let x = sx, y = sy, a = ang, len = 0, joined = false;
      const step = 4;
      while (len < maxLen) {
        a += (rng() - 0.5) * 0.22;
        const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
        if (len > 6 && roadHit(nx, ny)) {
          pts.push([nx, ny]);
          joined = true;
          break;
        }
        if (!okAt(nx, ny)) break;
        // 다른 골목에 너무 가까우면 거기 붙고 멈춘다
        if (len > 10) {
          const near = mine.nearest(nx, ny, W + 7);
          if (near) {
            pts.push([near.x, near.y]);
            joined = true;
            break;
          }
        }
        x = nx;
        y = ny;
        len += step;
        if (len % 12 < step) pts.push([x, y]);
      }
      if (!joined && (pts.length < 2 || pts[pts.length - 1][0] !== x)) pts.push([x, y]);
      if (len < 14 && !joined) return;
      // 짧은 마디는 줄여서
      const al = { id: `${st.id}_al${alleys.length}`, kind: 'street', alley: true, width: W, points: pts };
      alleys.push(al);
      for (let i = 0; i + 1 < pts.length; i++) mine.add({ ax: pts[i][0], ay: pts[i][1], bx: pts[i + 1][0], by: pts[i + 1][1] }, 0);
      // 곁가지
      if (depth < 1) {
        let d = 0;
        for (let i = 0; i + 1 < pts.length; i++) {
          const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
          const L = Math.hypot(bx - ax, by - ay);
          d += L;
          if (d < 26 || rng() > 0.5) continue;
          d = 0;
          const sd = rng() < 0.5 ? -1 : 1;
          const ba = Math.atan2(by - ay, bx - ax) + sd * (Math.PI / 2 + (rng() - 0.5) * 0.5);
          walk(bx + Math.cos(ba) * (W * 0.5 + 0.5), by + Math.sin(ba) * (W * 0.5 + 0.5), ba, 30 + rng() * 60, depth + 1);
        }
      }
    };
    for (const sg of base) {
      const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay);
      if (L < 8) continue;
      const ux = (sg.bx - sg.ax) / L, uy = (sg.by - sg.ay) / L;
      for (const sd of [-1, 1]) {
        for (let d = gap * (0.3 + rng() * 0.6); d < L - 4; d += gap * (0.75 + rng() * 0.5)) {
          const px = sg.ax + ux * d, py = sg.ay + uy * d;
          const off = sg.w / 2 + W * 0.5 + 0.3;
          const nx = -uy * sd, ny = ux * sd;
          const sx = px + nx * off, sy = py + ny * off;
          if (!okAt(sx, sy) || mine.nearest(sx, sy, gap * 0.4)) continue;
          walk(sx - nx * (W * 0.5), sy - ny * (W * 0.5), Math.atan2(ny, nx) + (rng() - 0.5) * 0.35, 50 + rng() * 110, 0);
        }
      }
    }
    for (const al of alleys) {
      const info = { id: al.id, name: null, kind: 'street', alley: true, points: al.points, width: W, terrain: T.STREET };
      tr.roads.push(info);
      tr.stampLine(al.points, W / 2, 1, (i, t) => (t === T.GRASS || t === T.YARD || t === T.FIELD || t === T.SAND || t === T.FOREST || t === T.MOUNTAIN || t === T.PADDY ? T.STREET : -1), 0.25);
      for (let s = 0; s + 1 < al.points.length; s++) {
        const [ax, ay] = al.points[s], [bx, by] = al.points[s + 1];
        tr.roadIndex.add({ ax, ay, bx, by, road: info, w: W }, W);
      }
    }
    st._alleys = alleys.length;
  }

  /** 건물 둘레를 마당으로 칠한다 (부드러운 땅만) */
  paintYard(b, front, other) {
    if (b.roof === 'none') return;
    const tr = this.tr, c = Math.cos(b.angle), s = Math.sin(b.angle), cell = tr.cell;
    for (const p of b.parts) {
      const x0 = p.x - p.w / 2 - other, x1 = p.x + p.w / 2 + other;
      const y0 = p.y - p.h / 2 - (b.front === 'n' ? front : other), y1 = p.y + p.h / 2 + (b.front === 's' || !b.front ? front : other);
      for (let ly = y0; ly <= y1; ly += cell * 0.7)
        for (let lx = x0; lx <= x1; lx += cell * 0.7) {
          const wx = b.x + lx * c - ly * s, wy = b.y + lx * s + ly * c;
          const i = tr.idx(wx, wy);
          if (i < 0) continue;
          const t = tr.grid[i];
          if (t === T.GRASS || t === T.FIELD || t === T.FOREST || t === T.SAND || (t === T.MOUNTAIN && tr.heightAt(wx, wy) < 0.4)) tr.grid[i] = T.YARD;
        }
    }
  }

  inRestricted(x, y) {
    for (const z of this.restricted) {
      if (z.poly ? pointInPolygon(x, y, z.poly) : (x - z.x) ** 2 + (y - z.y) ** 2 < (z.r || 0) ** 2) return true;
    }
    return false;
  }

  /** 후보 건물이 놓일 수 있는가: 지형·다른 solid·금지 구역 */
  canPlace(b, margin) {
    const tr = this.tr, c = Math.cos(b.angle), s = Math.sin(b.angle);
    const br = Math.max(b.w, b.h) / 2;
    for (const k of this.keepClear) if ((b.x - k.x) ** 2 + (b.y - k.y) ** 2 < (k.r + br) ** 2) return false;
    for (const p of b.parts) {
      const hw = p.w / 2 + margin, hh = p.h / 2 + margin;
      for (let ly = -hh; ly <= hh + 0.01; ly += Math.min(1.6, hh)) {
        for (let lx = -hw; lx <= hw + 0.01; lx += Math.min(1.6, hw)) {
          const wx = b.x + (p.x + lx) * c - (p.y + ly) * s, wy = b.y + (p.x + lx) * s + (p.y + ly) * c;
          const t = tr.at(wx, wy);
          if (!(t === T.GRASS || t === T.FIELD || t === T.FOREST || t === T.YARD || t === T.SAND || t === T.MOUNTAIN)) return false;
          if (t === T.MOUNTAIN && tr.heightAt(wx, wy) > 0.42) return false;
        }
      }
    }
    for (const p of b.parts) {
      const wx = b.x + p.x * c - p.y * s, wy = b.y + p.x * s + p.y * c;
      const ob = { x: wx, y: wy, w: p.w, h: p.h, angle: b.angle };
      const R = Math.hypot(p.w, p.h) / 2 + margin + 1;
      const near = this.querySolids(wx - R, wy - R, wx + R, wy + R, []);
      for (const o of near) if (obbOverlap(ob, o, margin)) return false;
      if (this.inRestricted(wx, wy)) return false;
    }
    return true;
  }

  /** 모양 고르기: 로컬 parts (앞 = +y) */
  shapeFor(style, rng, city) {
    const r = rng();
    let roof;
    if (style === 'western') roof = r < 0.85 ? 'western' : 'tile';
    else if (style === 'hanok') roof = r < 0.8 ? 'tile' : 'thatch';
    else if (style === 'choga') roof = r < 0.88 ? 'thatch' : 'tile';
    else if (style === 'camp') roof = 'hut';
    else if (style === 'jp_wood') roof = r < 0.88 ? 'jp' : 'tile';
    else if (style === 'cn_brick') roof = r < 0.9 ? 'cn' : 'tile';
    else roof = r < (city ? 0.55 : 0.4) ? 'tile' : 'thatch';
    const q = rng();
    if (roof === 'jp' || roof === 'cn') {
      // 일본식: 길에 면한 좁고 깊은 2층 상가 / 청국식: 벽돌 집 + 곁채
      const W = roof === 'jp' ? 6 + rng() * 3 : 8 + rng() * 3.5, H = roof === 'jp' ? 7 + rng() * 3 : 6 + rng() * 2;
      if (q < 0.3) return { roof, parts: [{ x: 0, y: 0, w: W, h: H }, { x: (rng() < 0.5 ? -1 : 1) * (W / 2 - 2), y: -H / 2 - 1.8, w: 4, h: 3.6 }] };
      return { roof, parts: [{ x: 0, y: 0, w: W, h: H }] };
    }
    if (roof === 'thatch' || roof === 'hut') {
      const W = roof === 'hut' ? 4.5 + rng() * 2 : 7 + rng() * 2.6, H = roof === 'hut' ? 3.6 + rng() : 4.6 + rng() * 1.1;
      if (roof === 'thatch' && q < 0.22) {
        const Ww = 4.4 + rng(), Lw = 2.5 + rng() * 2, sd = rng() < 0.5 ? -1 : 1;
        return { roof, parts: [{ x: sd * (W - Ww) / 2, y: H / 4 + Lw / 4, w: Ww, h: H / 2 + Lw }, { x: 0, y: -Lw / 2, w: W, h: H }] };
      }
      return { roof, parts: [{ x: 0, y: 0, w: W, h: H }] };
    }
    if (roof === 'western') {
      const W = 10 + rng() * 6, H = 8 + rng() * 4;
      if (q < 0.3) return { roof, parts: [{ x: W * 0.25, y: H * 0.35, w: W * 0.4, h: H * 0.5 }, { x: 0, y: 0, w: W, h: H }] };
      return { roof, parts: [{ x: 0, y: 0, w: W, h: H }] };
    }
    // 기와집: 一 / ㄱ / ㄷ
    const W = 9 + rng() * 4.5, H = 5.6 + rng() * 1.4;
    if (q < (city ? 0.45 : 0.6)) return { roof, parts: [{ x: 0, y: 0, w: W, h: H }] };
    const Ww = 5.2 + rng() * 1.2, Lw = 3 + rng() * 3;
    const wing = (sd) => ({ x: sd * (W - Ww) / 2, y: H / 4 + Lw / 4, w: Ww, h: H / 2 + Lw });
    if (q < (city ? 0.8 : 0.88)) return { roof, parts: [wing(rng() < 0.5 ? -1 : 1), { x: 0, y: -Lw / 2, w: W, h: H }] };
    return { roof, parts: [wing(-1), wing(1), { x: 0, y: -Lw / 2, w: W + 1, h: H }] };
  }

  placeSettlement(st) {
    const tr = this.tr;
    const rng = mulberry32(st.seed ?? strHash(st.id));
    const target = st.houses ?? 10;
    const city = st.kind === 'city' || (st.kind === 'town' && !!st.alleys); // 성안 골목 마을은 빽빽이
    const style = st.kind === 'camp' ? 'camp' : st.style || 'choga';
    let placed = 0;
    const segs = tr.roadIndex.query(st.x - st.r, st.y - st.r, st.x + st.r, st.y + st.r, []);
    const cands = [];
    for (const sg of segs) {
      const kind = sg.road.kind;
      if (kind === 'path' && !city && rng() < 0.6) continue;
      const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay);
      const ux = (sg.bx - sg.ax) / (L || 1), uy = (sg.by - sg.ay) / (L || 1);
      for (let d = rng() * 6; d < L; d += (city ? 8 : 11) + rng() * (city ? 5 : 9)) {
        const px = sg.ax + ux * d, py = sg.ay + uy * d;
        const dc = Math.hypot(px - st.x, py - st.y);
        if (dc > st.r) continue;
        for (const sd of [-1, 1]) {
          // n·sd 는 길에서 멀어지는 방향
          const nx = -uy * sd, ny = ux * sd;
          for (let row = 0; row < (city ? 3 : 2); row++) {
            const off = sg.w / 2 + 1.6 + row * (11 + rng() * 6);
            cands.push({ x: px + nx * off, y: py + ny * off, fx: -nx, fy: -ny, row, k: row * 0.6 + dc / st.r + rng() * 0.45 });
          }
        }
      }
    }
    cands.sort((a, b) => a.k - b.k);
    const tryPlace = (x, y, fx, fy, edge) => {
      const sh = this.shapeFor(style, rng, city);
      // 앞면이 (x,y) 에 오도록: 중심은 뒤쪽으로
      let lyFront = -Infinity;
      for (const p of sh.parts) lyFront = Math.max(lyFront, p.y + p.h / 2);
      const back = edge ? lyFront : 0;
      const b = { id: `${st.id}_h${placed}`, kind: 'house', x: x - fx * back, y: y - fy * back, w: 0, h: 0, angle: Math.atan2(-fx, fy) + (rng() - 0.5) * 0.05, roof: sh.roof, parts: sh.parts, settlement: st.id, style: st.style, front: 's' };
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of sh.parts) {
        x0 = Math.min(x0, p.x - p.w / 2);
        x1 = Math.max(x1, p.x + p.w / 2);
        y0 = Math.min(y0, p.y - p.h / 2);
        y1 = Math.max(y1, p.y + p.h / 2);
      }
      b.w = x1 - x0;
      b.h = y1 - y0;
      if (!this.canPlace(b, city ? 1.1 : 1.6)) return false;
      this.addBuilding(b);
      this.paintYard(b, city ? 2 : 3.2, city ? 0.8 : 1);
      placed++;
      return true;
    };
    for (const c of cands) {
      if (placed >= target) break;
      const p = city ? 0.92 - c.row * 0.12 : 0.75 - c.row * 0.25;
      if (rng() > p) continue;
      tryPlace(c.x, c.y, c.fx, c.fy, true);
    }
    // 나머지는 안쪽에 흩어서 (남향 위주)
    let attempts = target * 30;
    while (placed < target && attempts-- > 0) {
      const a = rng() * TAU, rr = st.r * Math.sqrt(rng()) * 0.95;
      const x = st.x + Math.cos(a) * rr, y = st.y + Math.sin(a) * rr;
      let fx = 0, fy = 1;
      const near = tr.roadIndex.nearest(x, y, 30);
      if (near && near.dist > 1) {
        fx = (near.x - x) / near.dist;
        fy = (near.y - y) / near.dist;
      } else {
        const j = (rng() - 0.5) * 0.5;
        fx = Math.sin(-j);
        fy = Math.cos(j);
      }
      tryPlace(x, y, fx, fy, false);
    }
    st._placed = placed;
  }

  // ---------------- 나무
  genTrees() {
    const tr = this.tr, M = this.map, forests = M.forests || [];
    const rng = mulberry32(4242);
    const list = [];
    // 철로 둘레(깎은 길)와 미션·장소 자리에는 수관이 덮지 않게
    const railIx = new SegIndex(48);
    for (const ln of M.lines || []) if (ln.kind === 'rail') for (let s = 0; s + 1 < ln.points.length; s++) railIx.add({ ax: ln.points[s][0], ay: ln.points[s][1], bx: ln.points[s + 1][0], by: ln.points[s + 1][1] }, 8);
    const clear = this.keepClear;
    const push = (x, y, r, kind) => {
      if (Math.min(x, y, tr.w - x, tr.h - y) < 52) return; // 가장자리 띠
      const n = railIx.nearest(x, y, r + 4);
      if (n && n.dist < r * 0.75 + 2.6) return;
      for (const k of clear) if ((x - k.x) ** 2 + (y - k.y) ** 2 < (k.r + r * 0.6) ** 2) return;
      list.push(x, y, r, kind, (rng() * 16777215) | 0); // 씨앗은 Float32 에 정확히 들어가는 24비트
    };
    const S = 4.6;
    const C = tr.cols;
    for (let gy = 0; gy * S < tr.h; gy++)
      for (let gx = 0; gx * S < tr.w; gx++) {
        const x = (gx + 0.15 + rng() * 0.7) * S, y = (gy + 0.15 + rng() * 0.7) * S;
        const i = tr.idx(x, y);
        if (i < 0) continue;
        const t = tr.grid[i];
        if (t !== T.FOREST && t !== T.MOUNTAIN && t !== T.GRASS) continue;
        // 지도 가장자리 띠: 종이로 번지기 전에 성기게 사라진다
        const de = Math.min(x, y, tr.w - x, tr.h - y);
        if (de < 80 && de < 44 + (tr.cn[i] / 255) * 40) continue;
        const fi = tr.forestIdx[i];
        const f = fi ? forests[fi - 1] : null;
        let p;
        if (t === T.FOREST) p = 0.12 + 0.85 * (f?.density ?? 0.7);
        else if (t === T.MOUNTAIN) p = f ? (f.density ?? 0.7) * 0.72 : 0.12 * clamp(tr.heightAt(x, y) * 2.2, 0, 1);
        else p = f ? 0.12 : 0.005;
        if (rng() > p) continue;
        const pineP = f ? f.pine ?? 0.5 : t === T.MOUNTAIN ? 0.85 : 0.3;
        const pine = rng() < pineP;
        const h = t === T.MOUNTAIN ? tr.heightAt(x, y) : 0;
        const sc = 1 - clamp((h - 0.3) * 0.8, 0, 0.35);
        const r = (pine ? 1.9 + rng() * 1.3 : 2.1 + rng() * 1.7) * sc;
        if (this.solidNear(x, y, r * 0.3)) continue;
        push(x, y, r, pine ? 0 : 1);
      }
    // 강가 버드나무
    for (const rv of tr.rivers) {
      for (const sg of rv.segs) {
        const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay);
        const ux = (sg.bx - sg.ax) / L, uy = (sg.by - sg.ay) / L;
        for (let d = rng() * 8; d < L; d += 7 + rng() * 9) {
          const wv = sg.wa + (sg.wb - sg.wa) * (d / L);
          for (const sd of [-1, 1]) {
            if (rng() < 0.45) continue;
            const off = wv / 2 + sg.shallow + 3 + rng() * 7;
            const x = sg.ax + ux * d - uy * off * sd, y = sg.ay + uy * d + ux * off * sd;
            const t = tr.at(x, y);
            if (t !== T.GRASS && t !== T.SAND && t !== T.FIELD) continue;
            if (this.solidNear(x, y, 1)) continue;
            push(x, y, 2.4 + rng() * 1.3, 2);
          }
        }
      }
    }
    // 마을 당산나무 + 집 뒤 감나무
    for (const st of M.settlements || []) {
      for (let k = 0; k < 30; k++) {
        const a = rng() * TAU, rr = st.r * 0.45 * Math.sqrt(rng());
        const x = st.x + Math.cos(a) * rr, y = st.y + Math.sin(a) * rr;
        const t = tr.at(x, y);
        if ((t === T.GRASS || t === T.YARD) && !this.solidNear(x, y, 4)) {
          push(x, y, 5 + rng() * 1.5, 3);
          break;
        }
      }
    }
    for (const b of this.buildings) {
      if (b.kind !== 'house' || rng() > 0.38) continue;
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      const lx = (rng() < 0.5 ? -1 : 1) * (b.w / 2 + 0.5), ly = -b.h / 2 - 1.5;
      const x = b.x + lx * c - ly * s, y = b.y + lx * s + ly * c;
      const t = tr.at(x, y);
      if (!isSoftGround(t) || t === T.PADDY || this.solidNear(x, y, 0.8)) continue;
      push(x, y, 1.8 + rng() * 0.8, rng() < 0.6 ? 4 : 1);
    }
    this.trees = new Float32Array(list);
    this.treeCount = list.length / 5;
    // 청크 버킷 (수관이 걸치는 청크 모두)
    const TC = this.tcell, ccols = Math.ceil(tr.w / TC), crows = Math.ceil(tr.h / TC);
    const tmp = Array.from({ length: ccols * crows }, () => []);
    const tt = this.trees;
    for (let n = 0; n < this.treeCount; n++) {
      const x = tt[n * 5], y = tt[n * 5 + 1], r = tt[n * 5 + 2] + 1;
      for (let cx = Math.max(0, Math.floor((x - r) / TC)); cx <= Math.min(ccols - 1, Math.floor((x + r) / TC)); cx++)
        for (let cy = Math.max(0, Math.floor((y - r) / TC)); cy <= Math.min(crows - 1, Math.floor((y + r) / TC)); cy++) tmp[cy * ccols + cx].push(n);
    }
    this.treeChunks = tmp.map((a) => Int32Array.from(a));
    this.tccols = ccols;
    this.tcrows = crows;
  }

  treesInChunk(ci, cj) {
    if (ci < 0 || cj < 0 || ci >= this.tccols || cj >= this.tcrows) return null;
    return this.treeChunks[cj * this.tccols + ci];
  }

  /** (x,y) 가 나무 수관 아래인가 */
  underCanopy(x, y) {
    const list = this.treesInChunk(Math.floor(x / this.tcell), Math.floor(y / this.tcell));
    if (!list) return false;
    const tt = this.trees;
    for (let k = 0; k < list.length; k++) {
      const n = list[k] * 5;
      const dx = tt[n] - x, dy = tt[n + 1] - y, r = tt[n + 2] * 0.85;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  /** (x,y) 가 이 건물 지붕 아래인가 */
  underRoof(b, x, y, extra = 0) {
    const c = Math.cos(-b.angle), s = Math.sin(-b.angle);
    const lx = (x - b.x) * c - (y - b.y) * s, ly = (x - b.x) * s + (y - b.y) * c;
    for (const p of b.parts) if (Math.abs(lx - p.x) < p.w / 2 + extra && Math.abs(ly - p.y) < p.h / 2 + extra) return true;
    return false;
  }
}

// ================================================================ 그리기

const ROOF_TIERS = [5, 10, 18, 30];

/** 지붕 하나를 로컬 좌표(1 = 1m, 중심 0,0)로 그린다 */
export function drawRoof(ctx, b) {
  srand(b.seed);
  if (!b.frame) return drawRoofBody(ctx, b);
  // 공사 중(골조): 지붕은 알파 0.4, 서까래·기둥이 드러난다 (A.6)
  ctx.globalAlpha = 0.4;
  drawRoofBody(ctx, b);
  ctx.globalAlpha = 1;
  for (const p of b.parts) drawFrame(ctx, p);
}

function drawRoofBody(ctx, b) {
  switch (b.roof) {
    case 'jp':
      for (const p of b.parts) gableRoof(ctx, p, b, false);
      if (b.parts[0]) signBoard(ctx, b);
      break;
    case 'cn':
      for (const p of b.parts) gableRoof(ctx, p, b, true);
      break;
    case 'altar':
      altarTop(ctx, b);
      break;
    case 'arch':
      archTop(ctx, b);
      break;
    case 'wreck':
      wreckTop(ctx, b);
      break;
    case 'tile':
      for (const p of b.parts) hipRoof(ctx, p, tileStyle(b), b);
      break;
    case 'palace':
    case 'gate':
    case 'pavilion': {
      const st = tileStyle(b);
      st.dancheong = true;
      st.flare = b.roof === 'pavilion' ? 0.5 : 0.7;
      for (const p of b.parts) {
        const dbl = b.roof !== 'pavilion' || Math.max(p.w, p.h) > 15;
        hipRoof(ctx, p, st, b);
        if (dbl) {
          // 중층: 위 지붕
          ctx.save();
          ctx.fillStyle = 'rgba(20,22,24,0.28)';
          const iw = p.w * 0.66, ih = p.h * 0.56;
          ctx.fillRect(p.x - iw / 2 + 0.25, p.y - ih / 2 + 0.35, iw, ih);
          ctx.restore();
          hipRoof(ctx, { x: p.x, y: p.y, w: iw, h: ih }, { ...st, flare: st.flare * 0.8, ridgeW: st.ridgeW }, b);
        }
      }
      break;
    }
    case 'thatch':
    case 'hut':
      for (const p of b.parts) thatchRoof(ctx, p, b);
      break;
    case 'western':
      for (const p of b.parts) westernRoof(ctx, p, b);
      if (b.tower) churchTower(ctx, b);
      break;
    default:
  }
}

function tileStyle(b) {
  const v = (rnd() - 0.5) * 0.12;
  const base = v > 0 ? mixHex(PAL.roofTile, '#8f9a9a', v * 2) : mixHex(PAL.roofTile, PAL.roofTileEdge, -v * 2);
  return { base, flare: 0.38, sag: 0.03, groove: 0.42, ridgeW: 0.34, dancheong: false, white: true };
}

/** 팔작/우진각 느낌의 기와 지붕 (위에서 본 모습) */
function hipRoof(ctx, p, st, b) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const long = p.w >= p.h;
  if (!long) ctx.rotate(Math.PI / 2);
  const W = long ? p.w : p.h, H = long ? p.h : p.w;
  const hw = W / 2, hh = H / 2, f = st.flare, sag = st.sag * W;
  const sagS = st.sag * H;
  const k = Math.min(hw, hh * 0.92);
  const rL = -hw + k, rR = hw - k; // 용마루 양 끝
  // 처마선: 모서리는 살짝 들려 바깥으로
  const TL = [-hw - f, -hh - f], TR = [hw + f, -hh - f], BR = [hw + f, hh + f], BL = [-hw - f, hh + f];
  const eave = () => {
    ctx.beginPath();
    ctx.moveTo(TL[0], TL[1]);
    ctx.quadraticCurveTo(0, -hh + sag, TR[0], TR[1]);
    ctx.quadraticCurveTo(hw - sagS, 0, BR[0], BR[1]);
    ctx.quadraticCurveTo(0, hh - sag, BL[0], BL[1]);
    ctx.quadraticCurveTo(-hw + sagS, 0, TL[0], TL[1]);
    ctx.closePath();
  };
  const facet = (pts, quad) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (quad) ctx.quadraticCurveTo(quad[0], quad[1], pts[1][0], pts[1][1]);
    else ctx.lineTo(pts[1][0], pts[1][1]);
    for (let i = 2; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  // 그림자 받침 (처마 아래 어둠)
  eave();
  ctx.fillStyle = mixHex(st.base, PAL.ink, 0.35);
  ctx.fill();
  // 네 면: 북(밝게) 남(어둡게) 서(조금 밝게) 동(어둡게)
  const shades = [
    [[TL, TR, [rR, 0], [rL, 0]], [0, -hh + sag], mixHex(st.base, '#c9cfc9', 0.22)],
    [[BR, BL, [rL, 0], [rR, 0]], [0, hh - sag], mixHex(st.base, PAL.ink, 0.12)],
    [[BL, TL, [rL, 0]], [-hw + sagS, 0], mixHex(st.base, '#c9cfc9', 0.1)],
    [[TR, BR, [rR, 0]], [hw - sagS, 0], mixHex(st.base, PAL.ink, 0.22)],
  ];
  for (const [pts, q, col] of shades) {
    facet(pts, q);
    ctx.fillStyle = col;
    ctx.fill();
  }
  // 기왓골: 앞뒤 면은 세로줄, 옆면은 가로줄
  ctx.lineWidth = 0.055;
  ctx.strokeStyle = rgba(PAL.ink, 0.42);
  for (let side = 0; side < 2; side++) {
    ctx.save();
    facet(shades[side][0], shades[side][1]);
    ctx.clip();
    ctx.beginPath();
    for (let x = -hw - f + st.groove * 0.5; x < hw + f; x += st.groove) {
      ctx.moveTo(x, -hh - f - 0.2);
      ctx.lineTo(x, hh + f + 0.2);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (let side = 2; side < 4; side++) {
    ctx.save();
    facet(shades[side][0], shades[side][1]);
    ctx.clip();
    ctx.beginPath();
    for (let y = -hh - f + st.groove * 0.5; y < hh + f; y += st.groove) {
      ctx.moveTo(-hw - f - 0.2, y);
      ctx.lineTo(hw + f + 0.2, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  // 와구토(막새) 흰 점 — 처마 끝
  if (st.white) {
    ctx.fillStyle = rgba(PAL.white, 0.55);
    for (let x = -hw + 0.3; x < hw - 0.2; x += st.groove) {
      const yy = hh - sag * (1 - (x / hw) ** 2) * 0.5 + f * (x / hw) ** 2;
      ctx.fillRect(x - 0.06, yy + 0.05, 0.12, 0.12);
      ctx.fillRect(x - 0.06, -yy - 0.17, 0.12, 0.12);
    }
  }
  // 단청 점 (처마 밑 끝선)
  if (st.dancheong) {
    // 처마 안쪽 단청 띠: 녹·적 0.6 m 씩 번갈아 (B.5)
    for (let k = 0, x = -hw; x < hw - 0.05; x += 0.6, k++) {
      const xm = x + 0.3, yy = hh - sag * (1 - (xm / hw) ** 2) * 0.5 + f * (xm / hw) ** 2;
      ctx.fillStyle = k & 1 ? rgba(PAL.dancheongGreen, 0.8) : rgba(PAL.seal, 0.72);
      ctx.fillRect(x, yy + 0.16, 0.6, 0.15);
      ctx.fillRect(x, -yy - 0.31, 0.6, 0.15);
    }
  }
  // 추녀마루 (모서리로 내려가는 마루)
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(PAL.ink, 0.85);
  ctx.lineWidth = st.ridgeW * 0.55;
  ctx.beginPath();
  ctx.moveTo(rL, 0);
  ctx.quadraticCurveTo(rL - k * 0.45, -hh * 0.5, TL[0] + 0.15, TL[1] + 0.15);
  ctx.moveTo(rL, 0);
  ctx.quadraticCurveTo(rL - k * 0.45, hh * 0.5, BL[0] + 0.15, BL[1] - 0.15);
  ctx.moveTo(rR, 0);
  ctx.quadraticCurveTo(rR + k * 0.45, -hh * 0.5, TR[0] - 0.15, TR[1] + 0.15);
  ctx.moveTo(rR, 0);
  ctx.quadraticCurveTo(rR + k * 0.45, hh * 0.5, BR[0] - 0.15, BR[1] - 0.15);
  ctx.stroke();
  if (st.dancheong) {
    // 잡상: 추녀마루 위 작은 점들
    ctx.fillStyle = rgba(PAL.ink, 0.9);
    for (const [ex, ey, sx] of [[TL[0], TL[1], rL], [BL[0], BL[1], rL], [TR[0], TR[1], rR], [BR[0], BR[1], rR]]) {
      for (let q = 0.3; q < 0.75; q += 0.12) {
        ctx.beginPath();
        ctx.arc(sx + (ex - sx) * q, (ey) * q, 0.13, 0, TAU);
        ctx.fill();
      }
    }
  }
  // 용마루: 굵은 먹선 + 가운데 밝은 줄, 양끝 살짝 들림
  if (rR > rL) {
    ctx.strokeStyle = rgba(PAL.ink, 0.95);
    ctx.lineWidth = st.ridgeW;
    ctx.beginPath();
    ctx.moveTo(rL - 0.25, -0.12);
    ctx.quadraticCurveTo(0, 0.06, rR + 0.25, -0.12);
    ctx.stroke();
    ctx.strokeStyle = rgba('#b9c1bd', 0.55);
    ctx.lineWidth = st.ridgeW * 0.28;
    ctx.beginPath();
    ctx.moveTo(rL, -0.14);
    ctx.quadraticCurveTo(0, 0.0, rR, -0.14);
    ctx.stroke();
  }
  // 처마 외곽 먹선 (굵기 변화: 두 번 긋기)
  eave();
  ctx.strokeStyle = rgba(PAL.ink, 0.9);
  ctx.lineWidth = 0.09;
  ctx.stroke();
  ctx.save();
  ctx.translate(0.06, 0.09);
  ctx.beginPath();
  ctx.moveTo(BL[0], BL[1]);
  ctx.quadraticCurveTo(0, hh - sag, BR[0], BR[1]);
  ctx.quadraticCurveTo(hw - sagS, 0, TR[0], TR[1]);
  ctx.strokeStyle = rgba(PAL.ink, 0.55);
  ctx.lineWidth = 0.14;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/** 초가: 볏짚 결(용마루에서 처마로 흘러내리는 곡선 붓질 여러 겹) + 새끼줄 그물 + 용마름 + 들쭉날쭉한 처마 끝 */
function thatchRoof(ctx, p, b) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const long = p.w >= p.h;
  if (!long) ctx.rotate(Math.PI / 2);
  const W = long ? p.w : p.h, H = long ? p.h : p.w;
  const hw = W / 2, hh = H / 2;
  const hut = b.roof === 'hut';
  // 빛(북서)을 이 지붕의 로컬 좌표로
  const th = (b.angle || 0) + (long ? 0 : Math.PI / 2);
  const ca = Math.cos(th), sa = Math.sin(th);
  const Lx = LIGHT_X * ca + LIGHT_Y * sa, Ly = -LIGHT_X * sa + LIGHT_Y * ca;
  const age = rnd();
  const base = mixHex(PAL.roofThatch, '#a49b86', age * 0.5); // 묵은 지붕은 잿빛
  const dark = mixHex(PAL.roofThatchEdge, '#5d584a', age * 0.45);
  const light = mixHex(PAL.roofThatch, '#f2e6c4', 0.55 - age * 0.25);
  const E = hut ? 2.3 : 2.7; // 초타원 지수 (클수록 네모)
  const k = Math.min(hw, hh * 0.95);
  const rL = -hw + k, rR = hw - k; // 용마루 양 끝
  const sePt = (cx, cy) => [Math.sign(cx) * Math.pow(Math.abs(cx), 2 / E), Math.sign(cy) * Math.pow(Math.abs(cy), 2 / E)];
  // 처마 외곽점 (볏짚 끝이라 들쭉날쭉, 크게는 조금 출렁)
  const N = Math.max(48, Math.round(((W + H) * 2.6) / 0.2));
  const OX = new Float32Array(N), OY = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const [sx, sy] = sePt(Math.cos(a), Math.sin(a));
    const j = 1 + (rnd() - 0.5) * 0.04 + Math.sin(a * 5 + (b.seed % 97)) * 0.012;
    OX[i] = sx * hw * j;
    OY[i] = sy * hh * j;
  }
  const outline = (sc = 1, ox = 0, oy = 0) => {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = OX[i] * sc + ox, y = OY[i] * sc + oy;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  // 1) 처마 두께(그늘 쪽으로 밀린 어두운 테) + 몸
  outline(1.03, -Lx * 0.14, -Ly * 0.14);
  ctx.fillStyle = rgba(dark, 0.92);
  ctx.fill();
  outline(1);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.save();
  outline(1);
  ctx.clip();
  // 2) 경사 음영: 용마루를 사이에 두고 빛 쪽 면은 밝게, 반대쪽은 어둡게 (부드러운 꺾임)
  const tone = (lit, s) => (lit >= 0 ? rgba(light, Math.min(0.55, lit * 0.5 * s)) : rgba(dark, Math.min(0.6, -lit * 0.55 * s)));
  const gy = ctx.createLinearGradient(0, -hh, 0, hh);
  gy.addColorStop(0, tone(-Ly, 1));
  gy.addColorStop(0.4, tone(-Ly, 0.55));
  gy.addColorStop(0.5, tone(0.3, 0.5));
  gy.addColorStop(0.6, tone(Ly, 0.55));
  gy.addColorStop(1, tone(Ly, 1));
  ctx.fillStyle = gy;
  ctx.fillRect(-hw - 1, -hh - 1, W + 2, H + 2);
  if (k > 0.4) {
    const f = Math.min(0.45, (k * 0.9) / W);
    const gx = ctx.createLinearGradient(-hw, 0, hw, 0);
    gx.addColorStop(0, tone(-Lx, 1));
    gx.addColorStop(f, tone(-Lx, 0));
    gx.addColorStop(1 - f, tone(Lx, 0));
    gx.addColorStop(1, tone(Lx, 1));
    ctx.fillStyle = gx;
    ctx.fillRect(-hw - 1, -hh - 1, W + 2, H + 2);
  }
  // 묵은 지붕: 잿빛·이끼 얼룩
  if (age > 0.45) {
    ctx.fillStyle = rgba(mixHex(PAL.treeDark, dark, 0.5), 0.1 + (age - 0.45) * 0.2);
    ctx.beginPath();
    for (let q = 0; q < 3; q++) {
      const x = (rnd() - 0.5) * W * 0.8, y = (rnd() - 0.5) * H * 0.8, r = 0.5 + rnd() * 0.9;
      ctx.moveTo(x + r, y);
      ctx.ellipse(x, y, r, r * 0.7, rnd() * 3, 0, TAU);
    }
    ctx.fill();
  }
  // 3) 볏짚 결: 용마루에서 처마로 흘러내리는 짧은 곡선 붓질. 빛 받는 정도·묵은 정도로 네 빛깔
  const S = hut ? 0.36 : 0.3;
  const BK = [[], [], [], []];
  const fOf = (x, y) => Math.pow(Math.pow(Math.abs(x / hw), E) + Math.pow(Math.abs(y / hh), E), 1 / E);
  const straw = (x, y, sc, out) => {
    const f = fOf(x, y);
    if (f > 0.985) return;
    const rx = x < rL ? rL : x > rR ? rR : x;
    let dx = x - rx, dy = y;
    const d = Math.hypot(dx, dy);
    if (d < 0.14) return; // 용마름 밑
    dx /= d;
    dy /= d;
    const lit = dx * Lx + dy * Ly;
    const len = (0.3 + rnd() * 0.3 + f * 0.16) * sc;
    const bend = (rnd() - 0.5) * 0.16;
    const v = lit * 0.9 + (rnd() - 0.5) * 0.9 - f * 0.4;
    const bi = out ? 3 - (v < -0.2 ? 1 : 0) : v > 0.35 ? 3 : v > -0.05 ? 2 : v > -0.45 ? 1 : 0;
    BK[bi].push(x - dx * len * 0.35, y - dy * len * 0.35, x - dy * bend, y + dx * bend, x + dx * len * 0.65, y + dy * len * 0.65);
  };
  const strokeBK = (cols) => {
    ctx.lineCap = 'round';
    for (let bi = 0; bi < 4; bi++) {
      const L = BK[bi];
      if (!L.length) continue;
      ctx.strokeStyle = rgba(cols[bi][0], cols[bi][1]);
      ctx.lineWidth = cols[bi][2];
      ctx.beginPath();
      for (let q = 0; q < L.length; q += 6) {
        ctx.moveTo(L[q], L[q + 1]);
        ctx.quadraticCurveTo(L[q + 2], L[q + 3], L[q + 4], L[q + 5]);
      }
      ctx.stroke();
      L.length = 0;
    }
  };
  for (let yy = -hh; yy < hh; yy += S) for (let xx = -hw; xx < hw; xx += S) straw(xx + rnd() * S, yy + rnd() * S, 1, false);
  strokeBK([
    [dark, 0.5, 0.065],
    [mixHex(base, dark, 0.5), 0.55, 0.055],
    [mixHex(base, light, 0.35), 0.55, 0.05],
    [light, 0.62, 0.045],
  ]);
  // 4) 새끼줄 그물: 용마루에서 앞뒤 처마로 내리는 줄 + 처마와 나란히 도는 줄 (꼬인 줄이라 점선, 옅게)
  ctx.setLineDash([0.12, 0.07]);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = rgba(mixHex(PAL.timber, dark, 0.45), 0.4);
  ctx.lineWidth = 0.055;
  ctx.beginPath();
  const M = Math.max(4, Math.round(0.85 / ((2 * (W + H) * 0.93) / N)));
  for (let i = (b.seed >>> 3) % M; i < N; i += M) {
    const ex = OX[i] * 0.97, ey = OY[i] * 0.97;
    const rx = ex < rL ? rL : ex > rR ? rR : ex;
    const sway = (rnd() - 0.5) * 0.25;
    ctx.moveTo(rx, 0);
    ctx.quadraticCurveTo((rx + ex) / 2 + sway, ey / 2, ex, ey);
  }
  for (const sc of hut ? [0.6] : [0.8, 0.55]) {
    const n2 = 40;
    for (let i = 0; i <= n2; i++) {
      const a = (i / n2) * TAU;
      const [sx, sy] = sePt(Math.cos(a), Math.sin(a));
      const x = sx * (hw - (1 - sc) * hh), y = sy * hh * sc;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // 5) 성긴 볏짚 붓질을 한 겹 더 (줄을 군데군데 덮어 그물이 바구니처럼 보이지 않게)
  for (let yy = -hh; yy < hh; yy += S * 2.1) for (let xx = -hw; xx < hw; xx += S * 2.1) straw(xx + rnd() * S * 2, yy + rnd() * S * 2, 1.1, true);
  strokeBK([
    [dark, 0.5, 0.06],
    [mixHex(base, dark, 0.5), 0.5, 0.055],
    [mixHex(base, light, 0.4), 0.55, 0.05],
    [mixHex(base, light, 0.6), 0.6, 0.05],
  ]);
  ctx.restore(); // 클립
  // 6) 처마 끝 술: 바깥으로 삐져나온 볏짚 끝 (그늘 쪽은 짙게)
  ctx.lineCap = 'round';
  for (const [col, al, lw, shadeSide] of [[dark, 0.6, 0.045, true], [mixHex(base, dark, 0.3), 0.55, 0.04, false]]) {
    ctx.strokeStyle = rgba(col, al);
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = shadeSide ? 0 : 1; i < N; i += 2) {
      const x = OX[i], y = OY[i];
      const r = Math.hypot(x, y) || 1, ux = x / r, uy = y / r;
      if ((ux * Lx + uy * Ly < 0) !== shadeSide && rnd() < 0.6) continue;
      const o = 0.06 + rnd() * 0.12, s = (rnd() - 0.5) * 0.1;
      ctx.moveTo(x - ux * 0.16, y - uy * 0.16);
      ctx.lineTo(x + ux * o - uy * s, y + uy * o + ux * s);
    }
    ctx.stroke();
  }
  // 7) 용마름: 엮어 얹은 꼭대기 이엉 (그늘 + 굵은 띠 + ㅅ자 결 + 가는 먹선)
  const rl = rL - (hut ? 0.12 : 0.3), rr = rR + (hut ? 0.12 : 0.3);
  if (rr - rl > 0.35) {
    const RW = hut ? 0.34 : 0.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(dark, 0.45);
    ctx.lineWidth = RW * 1.1;
    ctx.beginPath();
    ctx.moveTo(rl - Lx * 0.14, -Ly * 0.14);
    ctx.lineTo(rr - Lx * 0.14, -Ly * 0.14);
    ctx.stroke();
    ctx.strokeStyle = rgba(mixHex(base, dark, 0.3), 0.97);
    ctx.lineWidth = RW;
    ctx.beginPath();
    ctx.moveTo(rl, 0);
    ctx.lineTo(rr, 0);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = rgba(light, 0.75);
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (let x = rl - RW * 0.2; x < rr + RW * 0.1; x += 0.19) {
      ctx.moveTo(x, -RW * 0.42);
      ctx.lineTo(x + 0.13, 0);
      ctx.lineTo(x, RW * 0.42);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(PAL.ink, 0.42);
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    for (const sd of [-1, 1]) {
      ctx.moveTo(rl, (sd * RW) / 2);
      ctx.lineTo(rr, (sd * RW) / 2);
    }
    ctx.stroke();
  }
  // 8) 외곽 먹선: 들쭉날쭉한 처마선을 가늘게 + 그늘 쪽 겹선
  ctx.lineJoin = 'round';
  outline(1.005, -Lx * 0.07, -Ly * 0.07);
  ctx.strokeStyle = rgba(PAL.ink, 0.3);
  ctx.lineWidth = 0.1;
  ctx.stroke();
  outline(1);
  ctx.strokeStyle = rgba(PAL.ink, 0.6);
  ctx.lineWidth = 0.045;
  ctx.stroke();
  ctx.restore();
}

/** 양관: 붉은 벽돌빛(또는 슬레이트) 모임지붕 + 굴뚝 */
function westernRoof(ctx, p, b) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const long = p.w >= p.h;
  if (!long) ctx.rotate(Math.PI / 2);
  const W = long ? p.w : p.h, H = long ? p.h : p.w;
  const hw = W / 2, hh = H / 2;
  const slate = rnd() < 0.3;
  const base = slate ? '#5d6066' : mixHex(PAL.brick, '#7d4a3c', rnd() * 0.5);
  const k = Math.min(hw, hh);
  const rL = -hw + k, rR = hw - k;
  const faces = [
    [[[-hw, -hh], [hw, -hh], [rR, 0], [rL, 0]], mixHex(base, '#e8d5c0', 0.2)],
    [[[hw, hh], [-hw, hh], [rL, 0], [rR, 0]], mixHex(base, PAL.ink, 0.15)],
    [[[-hw, hh], [-hw, -hh], [rL, 0]], mixHex(base, '#e8d5c0', 0.08)],
    [[[hw, -hh], [hw, hh], [rR, 0]], mixHex(base, PAL.ink, 0.25)],
  ];
  for (const [pts, col] of faces) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  }
  // 기와 줄(가로)
  ctx.strokeStyle = rgba(PAL.ink, 0.2);
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  for (let y = -hh + 0.5; y < hh; y += 0.5) {
    const ax = Math.abs(y) < hh ? hw - (hh - Math.abs(y)) * (k / hh) : hw;
    ctx.moveTo(-hw + (hh - Math.abs(y)) * 0 + (k - (hh - Math.abs(y)) * (k / hh)) * 0, y);
    ctx.lineTo(hw, y);
    void ax;
  }
  ctx.stroke();
  // 마루선
  ctx.strokeStyle = rgba(PAL.ink, 0.75);
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  ctx.moveTo(-hw, -hh);
  ctx.lineTo(rL, 0);
  ctx.lineTo(-hw, hh);
  ctx.moveTo(hw, -hh);
  ctx.lineTo(rR, 0);
  ctx.lineTo(hw, hh);
  ctx.moveTo(rL, 0);
  ctx.lineTo(rR, 0);
  ctx.stroke();
  ctx.strokeStyle = rgba(PAL.ink, 0.9);
  ctx.lineWidth = 0.1;
  ctx.strokeRect(-hw, -hh, W, H);
  // 굴뚝
  const cxp = (rnd() - 0.5) * (W - 3), cyp = (rnd() < 0.5 ? -1 : 1) * hh * 0.45;
  ctx.fillStyle = mixHex(PAL.brick, PAL.ink, 0.25);
  ctx.fillRect(cxp - 0.45, cyp - 0.45, 0.9, 0.9);
  ctx.fillStyle = rgba(PAL.ink, 0.85);
  ctx.fillRect(cxp - 0.25, cyp - 0.25, 0.5, 0.5);
  ctx.strokeStyle = rgba(PAL.ink, 0.6);
  ctx.lineWidth = 0.05;
  ctx.strokeRect(cxp - 0.45, cyp - 0.45, 0.9, 0.9);
  ctx.restore();
}

/** 예배당·성당 종탑 (앞쪽 끝) */
function churchTower(ctx, b) {
  const p = b.parts[0];
  const long = p.w >= p.h;
  const s = Math.min(p.w, p.h) * 0.42;
  const tx = long ? p.x - p.w / 2 + s * 0.7 : p.x, ty = long ? p.y : p.y + p.h / 2 - s * 0.7;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.fillStyle = 'rgba(20,20,20,0.3)';
  ctx.fillRect(-s / 2 + 0.4, -s / 2 + 0.5, s, s);
  const tri = (a, b2, col) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(a[0], a[1]);
    ctx.lineTo(b2[0], b2[1]);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  };
  const h = s / 2, base = '#5d6066';
  tri([-h, -h], [h, -h], mixHex(base, '#dfe3e6', 0.25));
  tri([h, -h], [h, h], mixHex(base, PAL.ink, 0.3));
  tri([h, h], [-h, h], mixHex(base, PAL.ink, 0.15));
  tri([-h, h], [-h, -h], mixHex(base, '#dfe3e6', 0.1));
  ctx.strokeStyle = rgba(PAL.ink, 0.9);
  ctx.lineWidth = 0.08;
  ctx.strokeRect(-h, -h, s, s);
  ctx.beginPath();
  ctx.moveTo(-h, -h);
  ctx.lineTo(h, h);
  ctx.moveTo(h, -h);
  ctx.lineTo(-h, h);
  ctx.stroke();
  // 십자가
  ctx.lineWidth = 0.14;
  ctx.beginPath();
  ctx.moveTo(0, -0.7);
  ctx.lineTo(0, 0.7);
  ctx.moveTo(-0.45, -0.2);
  ctx.lineTo(0.45, -0.2);
  ctx.stroke();
  ctx.restore();
}

/** 지붕 로컬 좌표의 빛 방향 y 성분 (+ 면 = 빛 쪽이면 음수) */
function lightLy(b, long) {
  const th = (b.angle || 0) + (long ? 0 : Math.PI / 2);
  return -LIGHT_X * Math.sin(th) + LIGHT_Y * Math.cos(th);
}

/** 맞배지붕: 일본식(직선 박공, 곡선 없는 처마, jpRoof) / 청국식(회색, 용마루 끝 갈고리, 처마 붉은 등) */
function gableRoof(ctx, p, b, cn) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const long = p.w >= p.h;
  if (!long) ctx.rotate(Math.PI / 2);
  const W = long ? p.w : p.h, H = long ? p.h : p.w, hw = W / 2, hh = H / 2;
  const base = cn ? mixHex(PAL.cnBrick, '#55534f', rnd() * 0.45) : mixHex(PAL.jpRoof, '#5b6266', rnd() * 0.5);
  const lit = mixHex(base, '#dcdfd8', cn ? 0.17 : 0.13), shd = mixHex(base, PAL.ink, 0.15);
  const topLit = lightLy(b, long) < 0;
  ctx.fillStyle = 'rgba(20,20,20,0.24)';
  ctx.fillRect(-hw + 0.18, -hh + 0.26, W, H);
  // 담채: 먹선보다 조금 어긋나게 번진 바탕
  ctx.fillStyle = rgba(base, 0.3);
  ctx.fillRect(-hw - 0.22, -hh - 0.16, W + 0.3, H + 0.26);
  ctx.fillStyle = topLit ? lit : shd;
  ctx.fillRect(-hw, -hh, W, hh);
  ctx.fillStyle = topLit ? shd : lit;
  ctx.fillRect(-hw, 0, W, hh);
  // 기왓골: 청국식은 골이 깊고 성기게, 일본식은 촘촘하고 옅게 (용마루에서 처마로 곧게)
  ctx.strokeStyle = rgba(PAL.ink, cn ? 0.3 : 0.2);
  ctx.lineWidth = cn ? 0.05 : 0.04;
  ctx.beginPath();
  for (let x = -hw + 0.2, dx = cn ? 0.42 : 0.3; x < hw - 0.05; x += dx) {
    ctx.moveTo(x, -hh + 0.05);
    ctx.lineTo(x, hh - 0.05);
  }
  ctx.stroke();
  // 박공 끝 판재 + 외곽 (곧은 선, 붓끝 흔들림 ±0.05)
  ctx.strokeStyle = rgba(PAL.ink, 0.85);
  ctx.lineWidth = 0.09;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const jt = () => (rnd() - 0.5) * 0.1;
  ctx.moveTo(-hw + jt(), -hh + jt());
  ctx.lineTo(hw + jt(), -hh + jt());
  ctx.lineTo(hw + jt(), hh + jt());
  ctx.lineTo(-hw + jt(), hh + jt());
  ctx.closePath();
  ctx.stroke();
  ctx.lineWidth = 0.16;
  ctx.beginPath();
  ctx.moveTo(-hw, -hh);
  ctx.lineTo(-hw, hh);
  ctx.moveTo(hw, -hh);
  ctx.lineTo(hw, hh);
  ctx.stroke();
  // 용마루
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(PAL.ink, 0.92);
  ctx.lineWidth = cn ? 0.34 : 0.26;
  ctx.beginPath();
  ctx.moveTo(-hw + 0.1, 0);
  ctx.lineTo(hw - 0.1, 0);
  ctx.stroke();
  if (cn) {
    // 용마루 끝 갈고리 (말려 올라간 치미)
    ctx.lineWidth = 0.13;
    ctx.beginPath();
    for (const sd of [-1, 1]) {
      ctx.moveTo(sd * (hw - 0.3), 0);
      ctx.quadraticCurveTo(sd * (hw + 0.5), 0.05, sd * (hw + 0.35), -0.55);
      ctx.quadraticCurveTo(sd * (hw + 0.1), -0.62, sd * (hw + 0.16), -0.36);
    }
    ctx.stroke();
    // 처마 붉은 등 (작게, 몇 개만)
    const n = Math.max(1, Math.round(W / 4.5));
    for (let k = 0; k < n; k++) {
      const x = -hw + ((k + 0.5) * W) / n;
      ctx.fillStyle = rgba(PAL.seal, 0.9);
      ctx.beginPath();
      ctx.ellipse(x, hh + 0.3, 0.2, 0.26, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(PAL.lantern, 0.75);
      ctx.beginPath();
      ctx.arc(x - 0.05, hh + 0.25, 0.07, 0, TAU);
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = rgba('#c5cbc7', 0.45);
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(-hw + 0.2, -0.05);
    ctx.lineTo(hw - 0.2, -0.05);
    ctx.stroke();
  }
  ctx.restore();
}

/** 일본식 세로 간판: 앞면에서 길 쪽으로 내민 좁은 판 (먹 글씨 점) */
function signBoard(ctx, b) {
  const p = b.parts[0], f = b.front || 's';
  const ux = f === 'e' ? 1 : f === 'w' ? -1 : 0, uy = f === 's' ? 1 : f === 'n' ? -1 : 0;
  const ex = p.x + ux * (p.w / 2 + 0.15) + (uy ? p.w * 0.28 : 0), ey = p.y + uy * (p.h / 2 + 0.15) + (ux ? p.h * 0.28 : 0);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(Math.atan2(uy, ux));
  ctx.fillStyle = 'rgba(20,20,20,0.25)';
  ctx.fillRect(0.12, -0.08, 1.3, 0.42);
  ctx.fillStyle = PAL.whiteWall;
  ctx.fillRect(0, -0.2, 1.3, 0.4);
  ctx.strokeStyle = rgba(PAL.ink, 0.85);
  ctx.lineWidth = 0.05;
  ctx.strokeRect(0, -0.2, 1.3, 0.4);
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  for (let x = 0.22; x < 1.2; x += 0.3) {
    ctx.moveTo(x, -0.08);
    ctx.lineTo(x + 0.12, 0.06);
  }
  ctx.stroke();
  ctx.restore();
}

/** 환구단: 세 단 둥근 돌 제단 + 네 방향 계단 + 난간 */
function altarTop(ctx, b) {
  const R = Math.min(b.w, b.h) / 2;
  const stone = PAL.wallStone, lightS = mixHex(stone, PAL.paper, 0.45);
  ctx.fillStyle = 'rgba(30,28,24,0.22)';
  ctx.fillRect(-b.w / 2 + 0.5, -b.h / 2 + 0.7, b.w, b.h);
  ctx.fillStyle = mixHex(stone, PAL.paper, 0.25);
  ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
  ctx.strokeStyle = rgba(PAL.ink, 0.75);
  ctx.lineWidth = 0.1;
  ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
  const tiers = [0.86, 0.64, 0.42];
  tiers.forEach((k, n) => {
    const r = R * k;
    ctx.fillStyle = 'rgba(30,28,24,0.2)';
    ctx.beginPath();
    ctx.arc(0.25, 0.35, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = mixHex(stone, lightS, 0.3 + n * 0.25);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(PAL.ink, 0.8);
    ctx.lineWidth = 0.09;
    ctx.stroke();
    // 난간: 단 가장자리 안쪽 점선
    ctx.save();
    ctx.setLineDash([0.25, 0.35]);
    ctx.strokeStyle = rgba(PAL.ink2, 0.55);
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.35, 0, TAU);
    ctx.stroke();
    ctx.restore();
  });
  // 네 방향 계단
  const sw = R * 0.2;
  for (let q = 0; q < 4; q++) {
    ctx.save();
    ctx.rotate((q * Math.PI) / 2);
    ctx.fillStyle = mixHex(stone, PAL.paper, 0.55);
    ctx.fillRect(R * 0.3, -sw / 2, R * 0.66, sw);
    ctx.strokeStyle = rgba(PAL.ink, 0.5);
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    for (let x = R * 0.32; x < R * 0.96; x += 0.4) {
      ctx.moveTo(x, -sw / 2);
      ctx.lineTo(x, sw / 2);
    }
    ctx.stroke();
    ctx.strokeStyle = rgba(PAL.ink, 0.8);
    ctx.lineWidth = 0.07;
    ctx.strokeRect(R * 0.3, -sw / 2, R * 0.66, sw);
    ctx.restore();
  }
  ctx.fillStyle = rgba(PAL.paper, 0.9);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.12, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(PAL.ink, 0.7);
  ctx.lineWidth = 0.06;
  ctx.stroke();
}

/** 독립문: 위에서 본 화강암 덩어리 (마름돌 줄눈 + 여장 띠) */
function archTop(ctx, b) {
  const hw = b.w / 2, hh = b.h / 2;
  ctx.fillStyle = 'rgba(30,28,24,0.28)';
  ctx.fillRect(-hw + 0.35, -hh + 0.5, b.w, b.h);
  ctx.fillStyle = mixHex(PAL.wallStone, PAL.paper, 0.35);
  ctx.fillRect(-hw, -hh, b.w, b.h);
  ctx.fillStyle = mixHex(PAL.wallStone, PAL.ink, 0.12);
  ctx.fillRect(-hw, hh - 0.45, b.w, 0.45);
  ctx.strokeStyle = rgba(PAL.ink2, 0.35);
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  for (let y = -hh + 0.6, row = 0; y < hh; y += 0.6, row++) {
    ctx.moveTo(-hw, y);
    ctx.lineTo(hw, y);
    for (let x = -hw + (row & 1 ? 0.45 : 0.9); x < hw; x += 0.9) {
      ctx.moveTo(x, y - 0.6);
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.strokeStyle = rgba(PAL.ink, 0.88);
  ctx.lineWidth = 0.1;
  ctx.strokeRect(-hw, -hh, b.w, b.h);
  ctx.lineWidth = 0.05;
  ctx.strokeRect(-hw + 0.3, -hh + 0.3, b.w - 0.6, b.h - 0.6);
  // 가운데 현판 자리
  ctx.fillStyle = rgba(PAL.ink, 0.7);
  ctx.fillRect(-0.7, -0.18, 1.4, 0.36);
}

/** 불탄 전차 잔해: 그을린 차체, 무너진 지붕판 사이로 드러난 갈비뼈, 꺾인 집전봉 */
function wreckTop(ctx, b) {
  const hw = b.w / 2, hh = b.h / 2;
  ctx.fillStyle = rgba(PAL.ink, 0.22);
  ctx.beginPath();
  ctx.ellipse(0.3, 0.4, hw + 1.2, hh + 1.1, 0, 0, TAU);
  ctx.fill();
  const char = mixHex(PAL.tram, PAL.ink, 0.72);
  ctx.fillStyle = char;
  ctx.fillRect(-hw, -hh, b.w, b.h);
  // 남은 지붕판 (군데군데)
  for (let x = -hw + 0.2; x < hw - 0.3; x += 0.9) {
    if (rnd() < 0.45) continue;
    ctx.fillStyle = rgba(mixHex(PAL.tram, PAL.ink, 0.35 + rnd() * 0.3), 0.9);
    ctx.fillRect(x, -hh + 0.2, 0.8, b.h - 0.4 - rnd() * 0.6);
  }
  ctx.fillStyle = rgba(PAL.tram, 0.55);
  ctx.fillRect(-hw + 0.1, -hh + 0.1, 0.9, b.h - 0.2);
  ctx.strokeStyle = rgba(PAL.ink, 0.85);
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  for (let x = -hw + 0.45; x < hw; x += 0.9) {
    ctx.moveTo(x, -hh);
    ctx.lineTo(x + (rnd() - 0.5) * 0.15, hh);
  }
  ctx.stroke();
  ctx.lineWidth = 0.12;
  ctx.strokeRect(-hw, -hh, b.w, b.h);
  // 그을음 얼룩·재
  ctx.fillStyle = rgba(PAL.ink, 0.35);
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const x = (rnd() - 0.5) * b.w * 0.9, y = (rnd() - 0.5) * b.h * 0.8, r = 0.25 + rnd() * 0.5;
    ctx.moveTo(x + r, y);
    ctx.ellipse(x, y, r, r * 0.7, rnd() * 3, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = rgba(PAL.paper, 0.45);
  for (let k = 0; k < 14; k++) ctx.fillRect((rnd() - 0.5) * b.w, (rnd() - 0.5) * b.h, 0.1, 0.1);
  // 꺾인 집전봉
  ctx.strokeStyle = rgba(PAL.ink, 0.9);
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(-0.4, 0);
  ctx.lineTo(1.2, 0.5);
  ctx.lineTo(2.1, 1.6);
  ctx.stroke();
}

/** 공사 중 골조: 기둥·도리·서까래 */
function drawFrame(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const long = p.w >= p.h;
  if (!long) ctx.rotate(Math.PI / 2);
  const W = long ? p.w : p.h, H = long ? p.h : p.w, hw = W / 2 - 0.4, hh = H / 2 - 0.4;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = rgba(PAL.timber, 0.95);
  ctx.lineWidth = 0.12;
  ctx.beginPath();
  for (let x = -hw; x <= hw + 0.01; x += 0.8) {
    ctx.moveTo(x, -hh);
    ctx.lineTo(x, hh);
  }
  ctx.stroke();
  ctx.lineWidth = 0.2;
  ctx.beginPath();
  for (const y of [-hh, 0, hh]) {
    ctx.moveTo(-hw - 0.2, y);
    ctx.lineTo(hw + 0.2, y);
  }
  ctx.stroke();
  ctx.fillStyle = rgba(mixHex(PAL.timber, PAL.ink, 0.35), 0.95);
  for (let x = -hw; x <= hw + 0.01; x += Math.max(1.6, (2 * hw) / Math.round((2 * hw) / 2.4)))
    for (const y of [-hh, hh]) ctx.fillRect(x - 0.17, y - 0.17, 0.34, 0.34);
  ctx.strokeStyle = rgba(PAL.ink, 0.5);
  ctx.lineWidth = 0.04;
  ctx.strokeRect(-hw, -hh, 2 * hw, 2 * hh);
  ctx.restore();
}

/** 빠른 대체 그림 (캐시가 아직 없을 때) */
function drawRoofSimple(ctx, b) {
  const R = b.roof;
  const col = R === 'thatch' || R === 'hut' ? PAL.roofThatch : R === 'western' ? PAL.brick : R === 'jp' ? PAL.jpRoof : R === 'cn' ? PAL.cnBrick : R === 'altar' || R === 'arch' ? PAL.wallStone : R === 'wreck' ? PAL.ink2 : PAL.roofTile;
  ctx.fillStyle = col;
  ctx.strokeStyle = rgba(PAL.ink, 0.8);
  ctx.lineWidth = 0.1;
  for (const p of b.parts) {
    ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
    ctx.strokeRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
  }
}

/** HIGH 층 지붕 렌더러: 건물별 오프스크린 캐시(LRU, 화소 예산), 처마 밑이면 반투명 */
export class RoofRenderer {
  constructor(st) {
    this.st = st;
    this.cache = new Map(); // id → {tier, canvas, px}
    this.px = 0;
    this.budgetPx = 8e6;
    this.perFrame = 8;
    this._vis = [];
    this._pre = [];
  }
  /** 지붕 캐시: 건물 각도까지 돌려서 그려 둔다 (그릴 때 회전·save/restore 가 필요 없다) */
  _entry(b, tier) {
    const lb = b._lb, c = Math.cos(b.angle || 0), sn = Math.sin(b.angle || 0);
    let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
    for (const [lx, ly] of [[lb.x0, lb.y0], [lb.x1, lb.y0], [lb.x1, lb.y1], [lb.x0, lb.y1]]) {
      const x = lx * c - ly * sn, y = lx * sn + ly * c;
      if (x < rx0) rx0 = x;
      if (x > rx1) rx1 = x;
      if (y < ry0) ry0 = y;
      if (y > ry1) ry1 = y;
    }
    let t = tier;
    let w = (rx1 - rx0) * t, h = (ry1 - ry0) * t;
    const mx = Math.max(w, h);
    if (mx > 1400) {
      t *= 1400 / mx;
      w = (rx1 - rx0) * t;
      h = (ry1 - ry0) * t;
    }
    const cv = makeCanvas(w, h);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    ctx.setTransform(t * c, t * sn, -t * sn, t * c, -rx0 * t, -ry0 * t);
    ctx.lineJoin = 'round';
    drawRoof(ctx, b);
    return { tier, scale: t, canvas: cv, px: Math.ceil(w) * Math.ceil(h), rx0, ry0, rw: rx1 - rx0, rh: ry1 - ry0 };
  }
  /** 건물 하나의 지붕 캐시를 버린다 (골조 ↔ 완성 등) */
  invalidate(id) {
    const e = this.cache.get(id);
    if (!e) return;
    this.px -= e.px;
    this.cache.delete(id);
  }
  /** 화면 배율(기기 px/m)에 맞는 지붕 캐시 해상도 */
  tierFor(game) {
    const cam = game.camera;
    const zpx = (cam.zoom || 14) * (cam.dpr || 1);
    for (const t of ROOF_TIERS) if (t >= zpx * 0.9) return t;
    return ROOF_TIERS[ROOF_TIERS.length - 1];
  }
  /** 지붕 캐시 하나 만들어 넣기 → 항목(실패면 기존 것) */
  _put(b, tier) {
    const old = this.cache.get(b.id);
    const ne = this._entry(b, tier);
    if (!ne) return old || null;
    if (old) this.px -= old.px;
    this.cache.delete(b.id);
    this.cache.set(b.id, ne);
    this.px += ne.px;
    return ne;
  }
  /** rect 안 건물 지붕을 가까운 것부터 미리 만든다 (workLeft() > 0 인 동안, 최대 maxN 채) */
  prebuild(game, rect, workLeft, maxN = 4) {
    const tier = this.tierFor(game);
    const list = this.st.queryBuildings(rect.x0 - 2, rect.y0 - 2, rect.x1 + 2, rect.y1 + 2, (this._pre.length = 0, this._pre));
    const cx = (rect.x0 + rect.x1) / 2, cy = (rect.y0 + rect.y1) / 2;
    let need = 0;
    for (const b of list) if (this.cache.get(b.id)?.tier !== tier) list[need++] = b;
    list.length = need;
    if (!need) return 0;
    list.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
    let n = 0;
    for (const b of list) {
      if (n >= maxN || workLeft() <= 0) break;
      this._put(b, tier);
      n++;
    }
    return n;
  }
  draw(ctx, game, view, workLeft = null) {
    const st = this.st;
    const tier = this.tierFor(game);
    const vis = st.queryBuildings(view.x0 - 2, view.y0 - 2, view.x1 + 2, view.y1 + 2, (this._vis.length = 0, this._vis));
    vis.sort((a, b) => a.y - b.y);
    const pl = game.player, tgt = pl?.vehicle || pl;
    let made = 0;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
    const t0 = now();
    const rt = game.realTime || 0;
    const dt = Math.min(0.1, Math.max(0, rt - (this._lastRT ?? rt)));
    this._lastRT = rt;
    ctx.globalAlpha = 1;
    for (const b of vis) {
      let e = this.cache.get(b.id);
      if (!e || e.tier !== tier) {
        // 다른 해상도 캐시가 있으면 그것으로 버티고, 없으면 적어도 하나는 만든다
        if (made < this.perFrame && ((made === 0 && !e) || (workLeft ? workLeft() > 0 : now() - t0 < 2.5))) {
          e = this._put(b, tier);
          made++;
        }
      } else {
        // LRU: 최근 사용을 뒤로
        this.cache.delete(b.id);
        this.cache.set(b.id, e);
      }
      const under = tgt && Math.abs(tgt.x - b.x) < b._R + 1 && Math.abs(tgt.y - b.y) < b._R + 1 && st.underRoof(b, tgt.x, tgt.y, 0.2);
      const want = under ? 0.22 : 1;
      b._fade = b._fade == null ? want : b._fade + (want - b._fade) * Math.min(1, dt * 8);
      const fade = b._fade < 0.995;
      if (fade) ctx.globalAlpha = b._fade;
      if (e) ctx.drawImage(e.canvas, b.x + e.rx0, b.y + e.ry0, e.rw, e.rh);
      else {
        ctx.save();
        ctx.translate(b.x, b.y);
        if (b.angle) ctx.rotate(b.angle);
        drawRoofSimple(ctx, b);
        ctx.restore();
      }
      if (fade) ctx.globalAlpha = 1;
    }
    // 화소 예산 초과분 정리 (오래된 것부터)
    if (this.px > this.budgetPx) {
      for (const [id, e] of this.cache) {
        if (this.px <= this.budgetPx * 0.85) break;
        this.cache.delete(id);
        this.px -= e.px;
      }
    }
  }
}

// ---------------------------------------------------------------- 땅에 붙는 것 (청크 렌더러가 부름)

/** 둥근 모서리 사각형 경로 (지금 변환 기준) */
function rrPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const isThatch = (b) => b.roof === 'thatch' || b.roof === 'hut';

/** 건물 그림자와 기단·바닥 (지붕이 반투명일 때 보인다) */
export function drawBuildingGround(ctx, st, x0, y0, x1, y1) {
  const list = st.queryBuildings(x0 - 4, y0 - 4, x1 + 4, y1 + 4, []);
  if (!list.length) return;
  // 그림자: 남동쪽으로 번지게 두 겹 (초가는 지붕처럼 둥글게)
  for (const [off, grow, a] of [[1.6, 0.9, 0.09], [0.9, 0.25, 0.14]]) {
    ctx.fillStyle = `rgba(40,36,30,${a})`;
    ctx.beginPath();
    for (const b of list) {
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      for (const p of b.parts) {
        const hw = p.w / 2 + grow * 0.5, hh = p.h / 2 + grow * 0.5;
        const cx = b.x + p.x * c - p.y * s + off * 0.8, cy = b.y + p.x * s + p.y * c + off;
        if (isThatch(b)) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(b.angle);
          rrPath(ctx, -hw, -hh, hw * 2, hh * 2, Math.min(hw, hh) * 0.75);
          ctx.restore();
          continue;
        }
        ctx.moveTo(cx + (-hw) * c - (-hh) * s, cy + (-hw) * s + (-hh) * c);
        ctx.lineTo(cx + hw * c - (-hh) * s, cy + hw * s + (-hh) * c);
        ctx.lineTo(cx + hw * c - hh * s, cy + hw * s + hh * c);
        ctx.lineTo(cx + (-hw) * c - hh * s, cy + (-hw) * s + hh * c);
        ctx.closePath();
      }
    }
    ctx.fill();
  }
  // 기단(돌)·벽체·바닥
  for (const b of list) {
    if (NO_BASE[b.roof]) {
      if (b.roof === 'wreck') scorch(ctx, b);
      continue;
    }
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    const western = b.roof === 'western', jp = b.roof === 'jp', cn = b.roof === 'cn';
    if (isThatch(b)) {
      // 초가: 낮은 흙 기단 + 둥근 처마 밖으로 모서리가 비어져 나오지 않게 안으로 들이고 모를 죽인다
      for (const p of b.parts) {
        const ins = b.eave + 0.25, hw = p.w / 2 - ins, hh = p.h / 2 - ins;
        if (hw <= 0 || hh <= 0) continue;
        ctx.beginPath();
        rrPath(ctx, p.x - hw - 0.15, p.y - hh - 0.15, hw * 2 + 0.3, hh * 2 + 0.3, 1);
        ctx.fillStyle = mixHex(PAL.wallStone, PAL.mud, 0.4);
        ctx.fill();
        ctx.beginPath();
        rrPath(ctx, p.x - hw, p.y - hh, hw * 2, hh * 2, 0.85);
        ctx.fillStyle = mixHex(PAL.timber, PAL.paper, 0.6);
        ctx.fill();
        ctx.strokeStyle = rgba(PAL.ink, 0.55);
        ctx.lineWidth = 0.07;
        ctx.stroke();
        ctx.strokeStyle = rgba(PAL.timber, 0.3);
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        for (let x = p.x - hw + 0.6; x < p.x + hw - 0.3; x += 0.5) {
          ctx.moveTo(x, p.y - hh + 0.3);
          ctx.lineTo(x, p.y + hh - 0.3);
        }
        ctx.stroke();
      }
      ctx.restore();
      if (b.door) {
        ctx.fillStyle = rgba(PAL.wallStone, 0.95);
        ctx.fillRect(b.door.x - 0.45, b.door.y - 0.3, 0.9, 0.6);
      }
      continue;
    }
    for (const p of b.parts) {
      const hw = p.w / 2 - b.eave, hh = p.h / 2 - b.eave;
      if (hw <= 0 || hh <= 0) continue;
      ctx.fillStyle = western ? mixHex(PAL.brick, PAL.paper, 0.35) : cn ? mixHex(PAL.cnBrick, PAL.paper, 0.15) : PAL.wallStone;
      ctx.fillRect(p.x - hw - 0.35, p.y - hh - 0.35, hw * 2 + 0.7, hh * 2 + 0.7);
      ctx.fillStyle = western ? PAL.whiteWall : jp ? mixHex(PAL.roofThatch, PAL.paper, 0.55) : cn ? mixHex(PAL.cnBrick, PAL.paper, 0.5) : mixHex(PAL.timber, PAL.paper, 0.55);
      ctx.fillRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
      ctx.strokeStyle = rgba(PAL.ink, 0.6);
      ctx.lineWidth = 0.08;
      ctx.strokeRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
      if (jp || cn) {
        // 다다미(0.9×1.8) / 벽돌 바닥 줄눈
        const gx = jp ? 1.8 : 0.5, gy = jp ? 0.9 : 0.25;
        ctx.strokeStyle = rgba(jp ? PAL.timber : PAL.ink2, jp ? 0.35 : 0.2);
        ctx.lineWidth = jp ? 0.05 : 0.03;
        ctx.beginPath();
        for (let x = p.x - hw + gx; x < p.x + hw; x += gx) {
          ctx.moveTo(x, p.y - hh);
          ctx.lineTo(x, p.y + hh);
        }
        for (let y = p.y - hh + gy; y < p.y + hh; y += gy) {
          ctx.moveTo(p.x - hw, y);
          ctx.lineTo(p.x + hw, y);
        }
        ctx.stroke();
      } else if (!western) {
        // 마루 널 + 기둥
        ctx.strokeStyle = rgba(PAL.timber, 0.35);
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        for (let x = p.x - hw + 0.5; x < p.x + hw; x += 0.5) {
          ctx.moveTo(x, p.y - hh);
          ctx.lineTo(x, p.y + hh);
        }
        ctx.stroke();
        ctx.fillStyle = rgba(PAL.timber, 0.9);
        for (let x = p.x - hw; x <= p.x + hw + 0.01; x += Math.max(1.8, (hw * 2) / Math.round((hw * 2) / 2.4))) {
          ctx.fillRect(x - 0.15, p.y - hh - 0.15, 0.3, 0.3);
          ctx.fillRect(x - 0.15, p.y + hh - 0.15, 0.3, 0.3);
        }
      }
    }
    ctx.restore();
    // 문 자리 (디딤돌)
    if (b.door && b.roof !== 'none' && b.kind !== 'gate') {
      ctx.fillStyle = rgba(PAL.wallStone, 0.95);
      ctx.fillRect(b.door.x - 0.45, b.door.y - 0.3, 0.9, 0.6);
    }
    // 잠긴 성문: 닫힌 두 문짝 (문루 밑으로 들어가면 보인다)
    if (b.locked && b.gate) {
      const g = b.gate;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      ctx.fillStyle = mixHex(PAL.timber, PAL.ink, 0.3);
      ctx.fillRect(-g.w / 2, -0.32, g.w, 0.64);
      ctx.strokeStyle = rgba(PAL.ink, 0.85);
      ctx.lineWidth = 0.07;
      ctx.strokeRect(-g.w / 2, -0.32, g.w, 0.64);
      ctx.beginPath();
      ctx.moveTo(0, -0.32);
      ctx.lineTo(0, 0.32);
      ctx.stroke();
      ctx.fillStyle = rgba(PAL.ink, 0.8);
      for (let x = -g.w / 2 + 0.4; x < g.w / 2; x += 0.55) ctx.fillRect(x - 0.05, -0.05, 0.1, 0.1);
      ctx.restore();
    }
  }
}

/** 불탄 자리: 땅에 번진 그을음과 재 */
function scorch(ctx, b) {
  srand(b.seed + 5);
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  for (const [s, a] of [[1.9, 0.12], [1.35, 0.18], [1, 0.22]]) {
    ctx.fillStyle = rgba(PAL.ink, a);
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const x = (rnd() - 0.5) * b.w * 0.8, y = (rnd() - 0.5) * b.h, rx = (b.w / 4) * s * (0.7 + rnd() * 0.5), ry = b.h * 0.55 * s * (0.7 + rnd() * 0.5);
      ctx.moveTo(x + rx, y);
      ctx.ellipse(x, y, rx, ry, (rnd() - 0.5) * 0.4, 0, TAU);
    }
    ctx.fill();
  }
  ctx.restore();
}

/** 나무 밑동 그림자 (땅 청크) */
export function drawTreeShadows(ctx, st, ci, cj, x0, y0, x1, y1) {
  const list = st.treesInChunk(ci, cj);
  if (!list || !list.length) return;
  const tt = st.trees;
  ctx.fillStyle = 'rgba(52,58,40,0.16)';
  ctx.beginPath();
  for (let k = 0; k < list.length; k++) {
    const n = list[k] * 5;
    const x = tt[n] + tt[n + 2] * 0.35, y = tt[n + 1] + tt[n + 2] * 0.45, r = tt[n + 2] * 0.95;
    if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
    ctx.moveTo(x + r, y);
    ctx.ellipse(x, y, r, r * 0.85, 0, 0, TAU);
  }
  ctx.fill();
  ctx.fillStyle = rgba(PAL.timber, 0.55);
  ctx.beginPath();
  for (let k = 0; k < list.length; k++) {
    const n = list[k] * 5;
    const x = tt[n], y = tt[n + 1], r = tt[n + 2];
    if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
    const tr = r * 0.12 + 0.1;
    ctx.moveTo(x + tr, y);
    ctx.arc(x, y, tr, 0, TAU);
  }
  ctx.fill();
}

/**
 * 나무 윗부분(수관) — 수관 청크에 일괄로 그린다. 여러 프레임에 나눠 단계(stage)별로.
 *  활엽: 잎 무리(엽군) 여러 개의 옅은 물감 → 짧은 붓 점(미점) 세 농담 → 그늘 쪽 먹 점·끊긴 먹선
 *  소나무: 가지 먹선 → 납작한 잎판 물감 → 바늘 묶음(부채꼴 솔잎) 두 농담
 *  버들: 물감 → 늘어진 실 붓선.  감나무: 붉은 열매
 * detail: 1 = 가까이(20px/m), 0.45 = 보통(8px/m) — 붓 점·솔잎 수를 줄이고 번짐 한 겹을 뺀다
 */
export const CANOPY_STAGES = 7;

// 엽군(잎 무리) 배치: 나무마다 같은 씨앗으로 늘 같은 모양 → out = [cx, cy, rc, lit] * n
function leafClusters(tt, n, out) {
  const x = tt[n], y = tt[n + 1], r = tt[n + 2], kind = tt[n + 3];
  srand(tt[n + 4] + 101);
  out.length = 0;
  if (kind === 0) {
    // 소나무: 큰 가지 두셋 방향으로 몰린, 크기가 제각각인 솔잎 바퀴(차륜) 여러 개 — 대칭이 되지 않게
    const nb = 2 + (rnd() < 0.5 ? 1 : 0), a0 = rnd() * TAU;
    const cnt = Math.max(4, Math.round(r * r * 0.75));
    for (let i = 0; i < cnt; i++) {
      const br = a0 + ((i % nb) / nb) * TAU + (rnd() - 0.5) * 0.4;
      const a = br + (rnd() - 0.5) * 1.5;
      const d = r * (i === 0 ? 0.1 : 0.22 + Math.sqrt(rnd()) * 0.46);
      const rc = r * (0.25 + rnd() * 0.14) * (i === 0 ? 1.2 : 1);
      const ux = Math.cos(a), uy = Math.sin(a);
      out.push(x + ux * d, y + uy * d, rc, ux * LIGHT_X + uy * LIGHT_Y + (rnd() - 0.5) * 0.6);
    }
    return out;
  }
  const cnt = kind === 3 ? 8 : kind === 2 ? 5 : 6;
  const a0 = rnd() * TAU;
  out.push(x + (rnd() - 0.5) * r * 0.15, y + (rnd() - 0.5) * r * 0.15, r * (0.42 + rnd() * 0.1), 0);
  for (let i = 0; i < cnt; i++) {
    const a = a0 + (i / cnt) * TAU + (rnd() - 0.5) * 0.8;
    const d = r * (0.34 + rnd() * 0.2);
    const rc = r * (0.3 + rnd() * 0.15);
    const ux = Math.cos(a), uy = Math.sin(a);
    out.push(x + ux * d, y + uy * d * 0.94, rc, ux * LIGHT_X + uy * LIGHT_Y);
  }
  return out;
}

export function drawCanopy(ctx, st, ci, cj, x0, y0, x1, y1, stage = -1, detail = 1) {
  const list = st.treesInChunk(ci, cj);
  if (!list || !list.length) return 0;
  const tt = st.trees;
  const idx = [];
  for (let k = 0; k < list.length; k++) {
    const n = list[k] * 5;
    const x = tt[n], y = tt[n + 1], r = tt[n + 2] + 0.6;
    if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
    idx.push(n);
  }
  if (!idx.length) return 0;
  idx.sort((a, b) => tt[a + 1] - tt[b + 1]);
  const all = stage < 0;
  const CL = [];
  const isPine = (n) => tt[n + 3] === 0;
  const isBroad = (n) => tt[n + 3] !== 0 && tt[n + 3] !== 2;
  const isWillow = (n) => tt[n + 3] === 2;
  const BROAD = mixHex(PAL.forest, PAL.treeDark, 0.3);
  const BROAD_L = mixHex(PAL.treeLight, PAL.paper, 0.3);
  const BROAD_D = mixHex(PAL.treeDark, PAL.ink, 0.18);
  const PINE_D = mixHex(PAL.pine, PAL.ink, 0.3);
  const PINE_L = mixHex(PAL.pine, PAL.treeLight, 0.55);
  ctx.lineCap = 'round';

  // 엽군 물감 한 겹: 원 대신 조금 일그러진 타원 (sc 배, 빛 반대쪽으로 off 만큼 밀어서)
  const washPass = (pred, color, alpha, sc, off = 0) => {
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    const bt = batcher(ctx, 'fill', 40);
    for (const n of idx) {
      if (!pred(n)) continue;
      leafClusters(tt, n, CL);
      srand(tt[n + 4] + 7);
      for (let q = 0; q < CL.length; q += 4) {
        const rc = CL[q + 2] * sc * (0.94 + rnd() * 0.12);
        const cx = CL[q] - LIGHT_X * off * CL[q + 2], cy = CL[q + 1] - LIGHT_Y * off * CL[q + 2];
        const rot = rnd() * 3;
        ctx.moveTo(cx + rc * Math.cos(rot), cy + rc * Math.sin(rot));
        ctx.ellipse(cx, cy, rc, rc * (0.8 + rnd() * 0.15), rot, 0, TAU);
        bt.tick();
      }
    }
    bt.done();
  };

  // ---- 0) 바탕 물감: 활엽·버들 엽군, 소나무 가지
  if (all || stage === 0) {
    if (detail >= 1) washPass((n) => !isPine(n), mixHex(BROAD, PAL.treeLight, 0.35), 0.12, 1.16); // 번진 테두리
    washPass((n) => !isPine(n), BROAD_D, 0.24, 1.0, 0.22); // 그늘 쪽 덩이
    washPass((n) => !isPine(n) && (tt[n + 4] & 1), mixHex(BROAD, PAL.treeLight, 0.3), 0.4, 0.9);
    washPass((n) => !isPine(n) && !(tt[n + 4] & 1), mixHex(PAL.treeLight, PAL.forest, 0.5), 0.4, 0.9);
    // 소나무 가지: 줄기에서 큰 솔잎 바퀴로 뻗는 붉은 먹빛 가지 (잎 사이로 군데군데 보인다)
    ctx.strokeStyle = rgba(mixHex(PAL.timber, PAL.ink, 0.4), 0.7);
    ctx.lineWidth = detail >= 1 ? 0.1 : 0.14;
    ctx.beginPath();
    for (const n of idx) {
      if (!isPine(n)) continue;
      leafClusters(tt, n, CL);
      const x = tt[n], y = tt[n + 1];
      for (let q = 4; q < CL.length; q += 8) {
        const ex = x + (CL[q] - x) * 0.75, ey = y + (CL[q + 1] - y) * 0.75;
        const mx = (x + ex) / 2 + (ey - y) * 0.2, my = (y + ey) / 2 - (ex - x) * 0.2;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(mx, my, ex, ey);
      }
    }
    ctx.stroke();
  }

  // ---- 1) 소나무 잎판 물감 + 버들 실가지
  if (all || stage === 1) {
    washPass(isPine, PINE_D, 0.24, 1.05, 0.3); // 그늘 (번짐 겸)
    washPass(isPine, PAL.pine, 0.4, 0.84);
    // 버들: 가지 끝에서 실처럼 흘러내리는 잔 붓선
    for (const [col, al, lw, so] of [[mixHex(PAL.treeDark, PAL.ink, 0.2), 0.5, 0.05, 3], [mixHex(PAL.treeLight, PAL.paper, 0.15), 0.55, 0.045, 7]]) {
      ctx.strokeStyle = rgba(col, al);
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const n of idx) {
        if (!isWillow(n)) continue;
        const x = tt[n], y = tt[n + 1], r = tt[n + 2];
        srand(tt[n + 4] + so);
        for (let c = 0; c < 7; c++) {
          const a = rnd() * TAU, d = r * (0.25 + rnd() * 0.5);
          const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
          const bend = (rnd() - 0.5) * 0.8;
          for (let b = 0; b < 6; b++) {
            const sx = cx + (rnd() - 0.5) * r * 0.3, sy = cy + (rnd() - 0.5) * r * 0.3;
            const L = r * (0.35 + rnd() * 0.3);
            const ua = a + (rnd() - 0.5) * 0.5;
            ctx.moveTo(sx, sy);
            ctx.quadraticCurveTo(sx + Math.cos(ua) * L * 0.5 - Math.sin(ua) * bend, sy + Math.sin(ua) * L * 0.5 + Math.cos(ua) * bend + 0.15, sx + Math.cos(ua) * L, sy + Math.sin(ua) * L + 0.35);
          }
        }
      }
      ctx.stroke();
    }
  }

  // ---- 2·3·4) 활엽 미점(짧게 누운 붓 점): 중간 → 그늘 짙은 점 → 볕 밝은 점 (4 에서 소나무 짙은 솔잎, 5 에서 밝은 솔잎·먹)
  // 점마다 빛 받는 정도로 농담을 가른다: 0 짙게, 1 중간, 2 밝게
  const dabs = (want, color, alpha, lw, len, seedOff) => {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineWidth = lw;
    ctx.beginPath();
    const bt = batcher(ctx, 'stroke', 64);
    for (const n of idx) {
      if (!isBroad(n)) continue;
      const big = tt[n + 3] === 3;
      leafClusters(tt, n, CL);
      srand(tt[n + 4] + seedOff);
      for (let q = 0; q < CL.length; q += 4) {
        const cx = CL[q], cy = CL[q + 1], rc = CL[q + 2], cl = CL[q + 3];
        const cnt = Math.round(rc * rc * (big ? 14 : 16) * detail) + 2;
        for (let m = 0; m < cnt; m++) {
          const a = rnd() * TAU, d = rc * Math.sqrt(rnd()) * 0.98;
          const ux = Math.cos(a), uy = Math.sin(a);
          const lit = cl * 0.45 + (ux * LIGHT_X + uy * LIGHT_Y) * (d / rc) * 0.75 + (rnd() - 0.5) * 0.55;
          const tone = lit > 0.32 ? 2 : lit < -0.22 ? 0 : 1;
          const tilt = (rnd() - 0.5) * 0.7, l = len * (0.7 + rnd() * 0.6);
          if (tone !== want) continue;
          const px = cx + ux * d, py = cy + uy * d;
          const tx = Math.cos(tilt) * l * 0.5, ty = Math.sin(tilt) * l * 0.5;
          ctx.moveTo(px - tx, py - ty);
          ctx.lineTo(px + tx, py + ty);
          bt.tick();
        }
      }
    }
    bt.done();
  };
  const dw = detail >= 1 ? 0.33 : 0.42;
  if (all || stage === 2) dabs(1, mixHex(PAL.treeDark, PAL.forest, 0.35), 0.62, dw * 1.1, 0.1, 11); // 둥근 점
  if (all || stage === 3) dabs(0, mixHex(PAL.treeDark, PAL.ink, 0.35), 0.6, dw, 0.18, 11); // 누운 점(미점)
  if (all || stage === 4) {
    dabs(2, BROAD_L, 0.72, dw * 0.9, 0.14, 11);
    // 소나무 솔잎: 솔잎 바퀴(차륜) — 가운데서 사방으로 뻗는 바늘 묶음. 그늘 바퀴는 짙게 먼저, 볕 바퀴는 밝게 위에
    needles(0);
  }
  if (all || stage === 5) {
    needles(1);
    needles(2);
  }
  /** 솔잎 한 겹. pass 0: 모든 바퀴 짙은 솔잎, 1: 볕 받는 바퀴에 밝은 솔잎을 엇갈려 덧, 2: 그늘 바퀴에 먹 */
  function needles(pass) {
    const nlw = detail >= 1 ? 1 : 1.6;
    const [col, al, lw] = [[PINE_D, 0.62, 0.045], [PINE_L, 0.7, 0.04], [PAL.ink, 0.32, 0.035]][pass];
    ctx.strokeStyle = rgba(col, al);
    ctx.lineWidth = lw * nlw;
    ctx.beginPath();
    const bt = batcher(ctx, 'stroke', 16);
    for (const n of idx) {
      if (!isPine(n)) continue;
      leafClusters(tt, n, CL);
      for (let q = 0; q < CL.length; q += 4) {
        const cx = CL[q], cy = CL[q + 1], rc = CL[q + 2], sun = CL[q + 3];
        if ((pass === 1 && sun < 0.1) || (pass === 2 && sun > -0.2)) continue;
        srand(tt[n + 4] + q * 13 + 37 + pass * 5);
        const K = Math.max(4, Math.round((7 + rc * 6) * (detail >= 1 ? 1 : 0.55) * (pass === 1 ? 0.55 : pass === 2 ? 0.4 : 1)));
        const a0 = rnd() * TAU;
        for (let s = 0; s < K; s++) {
          const aa = a0 + (s / K) * TAU + (rnd() - 0.5) * 0.35;
          const ln = rc * (pass === 1 ? 0.6 + rnd() * 0.3 : 0.8 + rnd() * 0.3);
          const ca = Math.cos(aa), sa = Math.sin(aa);
          ctx.moveTo(cx + ca * rc * 0.12, cy + sa * rc * 0.12);
          ctx.lineTo(cx + ca * ln, cy + sa * ln);
        }
        bt.tick();
      }
    }
    bt.done();
  }

  // ---- 6) 먹: 그늘 쪽 먹 점(태점처럼), 엽군 가장자리의 끊긴 먹선, 감 열매
  if (all || stage === 6) {
    ctx.strokeStyle = rgba(PAL.ink, 0.5);
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    let bt = batcher(ctx, 'stroke', 64);
    for (const n of idx) {
      const kind = tt[n + 3];
      if (kind === 2) continue;
      leafClusters(tt, n, CL);
      srand(tt[n + 4] + 61);
      for (let q = 0; q < CL.length; q += 4) {
        const cx = CL[q], cy = CL[q + 1], rc = CL[q + 2], cl = CL[q + 3];
        if (cl > 0.3 && rnd() < 0.7) continue;
        if (kind === 0) continue; // 소나무는 솔잎 먹으로 충분
        const cnt = Math.round(2.5 * rc * detail + rnd());
        for (let m = 0; m < cnt; m++) {
          // 빛 반대쪽(남동) 가장자리에 모인다
          const a = Math.atan2(-LIGHT_Y, -LIGHT_X) + (rnd() - 0.5) * 2.4, d = rc * (0.55 + rnd() * 0.45);
          const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
          const tl = (rnd() - 0.5) * 0.8, l = 0.07 + rnd() * 0.08;
          ctx.moveTo(px - Math.cos(tl) * l, py - Math.sin(tl) * l);
          ctx.lineTo(px + Math.cos(tl) * l, py + Math.sin(tl) * l);
          bt.tick();
        }
      }
    }
    bt.done();
    // 활엽 엽군 가장자리: 그늘 쪽으로 끊어진 가는 먹선 몇 획
    ctx.strokeStyle = rgba(PAL.ink, 0.28);
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    bt = batcher(ctx, 'stroke', 32);
    for (const n of idx) {
      if (!isBroad(n)) continue;
      leafClusters(tt, n, CL);
      srand(tt[n + 4] + 17);
      for (let q = 4; q < CL.length; q += 4) {
        if (CL[q + 3] > 0.1 || rnd() < 0.35) continue;
        const cx = CL[q], cy = CL[q + 1], rc = CL[q + 2] * 1.02;
        const a0 = Math.atan2(-LIGHT_Y, -LIGHT_X) - 0.9 + rnd() * 0.8, a1 = a0 + 0.5 + rnd() * 0.7;
        ctx.moveTo(cx + Math.cos(a0) * rc, cy + Math.sin(a0) * rc);
        ctx.arc(cx, cy, rc, a0, a1);
        bt.tick();
      }
    }
    bt.done();
    // 감나무 열매
    ctx.fillStyle = rgba(PAL.dusk, 0.85);
    ctx.beginPath();
    for (const n of idx) {
      if (tt[n + 3] !== 4) continue;
      const x = tt[n], y = tt[n + 1], r = tt[n + 2];
      srand(tt[n + 4] + 19);
      for (let b = 0; b < 6; b++) {
        const a = rnd() * TAU, d = r * rnd() * 0.75;
        const dx = x + Math.cos(a) * d, dy = y + Math.sin(a) * d;
        ctx.moveTo(dx + 0.13, dy);
        ctx.arc(dx, dy, 0.13, 0, TAU);
      }
    }
    ctx.fill();
  }
  return idx.length;
}

export function buildStructures(MAP, tr) {
  const st = new Structures(MAP, tr);
  st.build();
  return st;
}
