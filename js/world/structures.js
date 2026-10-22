// 건물·성벽·나무: 충돌 사각형(solids, 버킷 격자), 마을 집 절차 생성, 나무 목록,
// 그리고 HIGH 층 지붕 그리기(건물마다 오프스크린 캐시) + 땅에 붙는 그림자·기단(청크 렌더러가 부른다).

import { T, isSoftGround, SegIndex } from './terrain.js';
import { PAL } from '../engine/palette.js';
import { mulberry32, mixHex, rgba, clamp, pointInPolygon } from '../engine/util.js';

export const SOLID_BLOCKS = ['foot', 'swim', 'horse', 'wheel', 'boat']; // rail·ghost 는 통과 (노선 차량이 끼지 않게)
const TAU = Math.PI * 2;

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

function roofOf(b) {
  if (b.roof) return b.roof;
  switch (b.kind) {
    case 'palace': return 'palace';
    case 'gate': return 'gate';
    case 'pavilion': return 'pavilion';
    case 'church': case 'legation': case 'customs': case 'hotel': case 'station': case 'depot': case 'hospital': case 'warehouse': return 'western';
    case 'jumak': case 'smithy': case 'stable': case 'camp_hall': return 'thatch';
    case 'hut': return 'hut';
    case 'pier': return 'none';
    default: return b.style === 'western' ? 'western' : b.style === 'choga' ? 'thatch' : 'tile';
  }
}
const EAVE = { tile: 0.9, palace: 1.4, gate: 1.2, pavilion: 0.9, thatch: 0.55, hut: 0.4, western: 0.45, none: 0 };

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
    let lx = main.x, ly = main.y;
    if (side === 's') ly += hh + 0.6;
    else if (side === 'n') ly -= hh + 0.6;
    else if (side === 'e') lx += hw + 0.6;
    else lx -= hw + 0.6;
    return { x: b.x + lx * c - ly * s, y: b.y + lx * s + ly * c };
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
      const b = this.addBuilding({ id: 'gate_' + g.id, kind: 'gate', name: g.name, hanja: g.hanja, x: g.x, y: g.y, w: W, h: H, angle: g.angle, tags: ['gate', 'landmark'], noSolid: true, gate: g, door: { x: g.x, y: g.y } });
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
    else roof = r < (city ? 0.55 : 0.4) ? 'tile' : 'thatch';
    const q = rng();
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
    const city = st.kind === 'city';
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
    const push = (x, y, r, kind) => list.push(x, y, r, kind, (rng() * 1e9) | 0);
    const S = 4.6;
    const C = tr.cols;
    for (let gy = 0; gy * S < tr.h; gy++)
      for (let gx = 0; gx * S < tr.w; gx++) {
        const x = (gx + 0.15 + rng() * 0.7) * S, y = (gy + 0.15 + rng() * 0.7) * S;
        const i = tr.idx(x, y);
        if (i < 0) continue;
        const t = tr.grid[i];
        if (t !== T.FOREST && t !== T.MOUNTAIN && t !== T.GRASS) continue;
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
  switch (b.roof) {
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
    for (let x = -hw; x <= hw; x += 0.55) {
      const yy = hh - sag * (1 - (x / hw) ** 2) * 0.5 + f * (x / hw) ** 2;
      ctx.fillStyle = Math.round(x / 0.55) % 2 ? rgba(PAL.dancheongGreen, 0.85) : rgba(PAL.seal, 0.8);
      ctx.fillRect(x - 0.1, yy + 0.18, 0.2, 0.16);
      ctx.fillRect(x - 0.1, -yy - 0.34, 0.2, 0.16);
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

/** 초가: 둥근 볏짚 지붕 + 새끼줄 */
function thatchRoof(ctx, p, b) {
  ctx.save();
  ctx.translate(p.x, p.y);
  const long = p.w >= p.h;
  if (!long) ctx.rotate(Math.PI / 2);
  const W = long ? p.w : p.h, H = long ? p.h : p.w;
  const hw = W / 2, hh = H / 2;
  const age = rnd();
  const base = mixHex(PAL.roofThatch, '#9c9585', age * 0.45);
  const edge = mixHex(PAL.roofThatchEdge, '#6f6a5c', age * 0.4);
  // 둥근 외곽 (흔들림)
  const outline = (sc = 1) => {
    ctx.beginPath();
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const cx = Math.cos(a), cy = Math.sin(a);
      // 둥근 사각형 근사(superellipse)
      const e = 3.2;
      const sx = Math.sign(cx) * Math.pow(Math.abs(cx), 2 / e), sy = Math.sign(cy) * Math.pow(Math.abs(cy), 2 / e);
      const wob = 1 + (Math.sin(a * 5 + b.seed) * 0.012 + Math.sin(a * 11 + b.seed * 0.3) * 0.01);
      const x = sx * hw * sc * wob, y = sy * hh * sc * wob;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  outline(1.02);
  ctx.fillStyle = edge;
  ctx.fill();
  outline(0.96);
  const grd = ctx.createLinearGradient(0, -hh, 0, hh);
  grd.addColorStop(0, mixHex(base, '#efe2bd', 0.25));
  grd.addColorStop(0.5, base);
  grd.addColorStop(1, mixHex(base, edge, 0.55));
  ctx.fillStyle = grd;
  ctx.fill();
  // 볏짚 결
  ctx.save();
  outline(0.96);
  ctx.clip();
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = rgba(edge, 0.45);
  ctx.beginPath();
  for (let i = 0; i < W * H * 1.1; i++) {
    const x = (rnd() - 0.5) * W, y = (rnd() - 0.5) * H;
    const l = 0.35 + rnd() * 0.4;
    const dir = y < 0 ? -1 : 1;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 0.12, y + dir * l);
  }
  ctx.stroke();
  // 새끼줄 그물
  ctx.strokeStyle = rgba(PAL.timber, 0.5);
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  for (let y = -hh + 0.7; y < hh - 0.3; y += 0.8) {
    ctx.moveTo(-hw, y);
    ctx.quadraticCurveTo(0, y + (y / hh) * 0.35, hw, y);
  }
  for (let x = -hw + 0.6; x < hw; x += 1.0) {
    ctx.moveTo(x, -hh);
    ctx.quadraticCurveTo(x + (x / hw) * 0.3, 0, x, hh);
  }
  ctx.stroke();
  ctx.restore();
  // 용마름 (꼭대기 이엉)
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(mixHex(edge, PAL.ink, 0.25), 0.9);
  ctx.lineWidth = 0.42;
  ctx.beginPath();
  ctx.moveTo(-hw + hh * 0.75, 0);
  ctx.lineTo(hw - hh * 0.75, 0);
  ctx.stroke();
  ctx.strokeStyle = rgba(base, 0.9);
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  for (let x = -hw + hh * 0.75; x < hw - hh * 0.75; x += 0.3) {
    ctx.moveTo(x, -0.18);
    ctx.lineTo(x + 0.15, 0.18);
  }
  ctx.stroke();
  // 외곽 먹선
  outline(1.02);
  ctx.strokeStyle = rgba(PAL.ink, 0.7);
  ctx.lineWidth = 0.07;
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

/** 빠른 대체 그림 (캐시가 아직 없을 때) */
function drawRoofSimple(ctx, b) {
  const col = b.roof === 'thatch' || b.roof === 'hut' ? PAL.roofThatch : b.roof === 'western' ? PAL.brick : PAL.roofTile;
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
  draw(ctx, game, view, workLeft = null) {
    const st = this.st, cam = game.camera;
    const zpx = (cam.zoom || 14) * (cam.dpr || 1);
    let tier = ROOF_TIERS[ROOF_TIERS.length - 1];
    for (const t of ROOF_TIERS) if (t >= zpx * 0.9) {
      tier = t;
      break;
    }
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
        if (made < this.perFrame && (made === 0 || (workLeft ? workLeft() > 0 : now() - t0 < 2.5))) {
          const ne = this._entry(b, tier);
          made++;
          if (ne) {
            if (e) this.px -= e.px;
            e = ne;
            this.cache.delete(b.id);
            this.cache.set(b.id, e);
            this.px += e.px;
          }
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

/** 건물 그림자와 기단·바닥 (지붕이 반투명일 때 보인다) */
export function drawBuildingGround(ctx, st, x0, y0, x1, y1) {
  const list = st.queryBuildings(x0 - 4, y0 - 4, x1 + 4, y1 + 4, []);
  if (!list.length) return;
  // 그림자: 남동쪽으로 번지게 두 겹
  for (const [off, grow, a] of [[1.6, 0.9, 0.09], [0.9, 0.25, 0.14]]) {
    ctx.fillStyle = `rgba(40,36,30,${a})`;
    ctx.beginPath();
    for (const b of list) {
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      for (const p of b.parts) {
        const hw = p.w / 2 + grow * 0.5, hh = p.h / 2 + grow * 0.5;
        const cx = b.x + p.x * c - p.y * s + off * 0.8, cy = b.y + p.x * s + p.y * c + off;
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
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    const western = b.roof === 'western';
    for (const p of b.parts) {
      const hw = p.w / 2 - b.eave, hh = p.h / 2 - b.eave;
      if (hw <= 0 || hh <= 0) continue;
      ctx.fillStyle = western ? mixHex(PAL.brick, PAL.paper, 0.35) : PAL.wallStone;
      ctx.fillRect(p.x - hw - 0.35, p.y - hh - 0.35, hw * 2 + 0.7, hh * 2 + 0.7);
      ctx.fillStyle = western ? PAL.whiteWall : mixHex(PAL.timber, PAL.paper, 0.55);
      ctx.fillRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
      ctx.strokeStyle = rgba(PAL.ink, 0.6);
      ctx.lineWidth = 0.08;
      ctx.strokeRect(p.x - hw, p.y - hh, hw * 2, hh * 2);
      if (!western) {
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
  }
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

/** 나무 윗부분(수관) — 캔오피 청크에 일괄로 그린다. 번지는 물감 덩이 + 점엽(먹 점) + 솔잎 */
/** 수관 그리기 단계 수 (청크 하나를 여러 프레임에 나눠 그린다) */
export const CANOPY_STAGES = 5;

export function drawCanopy(ctx, st, ci, cj, x0, y0, x1, y1, stage = -1) {
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
  // 수관 덩이 모양 (물감 번짐): 잎 무리 몇 개
  const lobes = (n, sc, seedOff) => {
    const x = tt[n], y = tt[n + 1], r = tt[n + 2], kind = tt[n + 3];
    srand(tt[n + 4] + seedOff);
    const cnt = kind === 3 ? 7 : kind === 0 ? 5 : kind === 2 ? 6 : 5;
    for (let b = 0; b < cnt; b++) {
      const a = rnd() * TAU, d = r * (0.12 + rnd() * 0.36), rr = r * sc * (0.38 + rnd() * 0.22) * (kind === 0 ? 0.92 : 1);
      const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
      ctx.moveTo(bx + rr, by);
      ctx.arc(bx, by, rr, 0, TAU);
    }
  };
  const fillLobes = (filter, color, alpha, sc, seedOff = 0) => {
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    for (const n of idx) if (filter(tt[n + 3], n)) lobes(n, sc, seedOff);
    ctx.fill();
  };
  const broad = (k) => k !== 0;
  const pine = (k) => k === 0;
  const BROAD = mixHex(PAL.forest, PAL.treeDark, 0.3);
  const BROAD2 = mixHex(PAL.treeLight, PAL.forest, 0.5);
  const all = stage < 0;
  if (all || stage === 0) {
  // 1) 번짐 테두리 (옅고 넓게) → 2) 몸 물감 (두 가지 빛깔을 섞어서)
  fillLobes(broad, mixHex(BROAD, PAL.treeLight, 0.3), 0.15, 1.16);
  fillLobes((k, n) => k !== 0 && (tt[n + 4] & 1), BROAD, 0.62, 1, 0);
  fillLobes((k, n) => k !== 0 && !(tt[n + 4] & 1), BROAD2, 0.66, 1, 0);
  }
  if (all || stage === 1) {
  fillLobes(pine, PAL.pine, 0.24, 1.15, 5);
  fillLobes(pine, mixHex(PAL.pine, PAL.ink, 0.12), 0.74, 0.95, 5);
  // 3) 밝은 쪽(북서) 잎 몇 점
  ctx.fillStyle = rgba(mixHex(PAL.treeLight, PAL.paper, 0.25), 0.38);
  ctx.beginPath();
  const bh = batcher(ctx, 'fill', 8);
  for (const n of idx) {
    bh.tick();
    const kind = tt[n + 3];
    const x = tt[n], y = tt[n + 1], r = tt[n + 2];
    srand(tt[n + 4] + 23);
    const cnt = kind === 0 ? 2 : 4;
    for (let b = 0; b < cnt; b++) {
      const a = -2.3 + (rnd() - 0.5) * 1.6, d = r * (0.2 + rnd() * 0.35), rr = r * (0.12 + rnd() * 0.12);
      const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
      ctx.moveTo(bx + rr * 1.3, by);
      ctx.ellipse(bx, by, rr * 1.3, rr, rnd() - 0.5, 0, TAU);
    }
  }
  bh.done();
  // 4) 버들: 늘어진 가지 붓선
  // 가지 끝에서 실처럼 흘러내리는 잔 붓선 (다발마다 같은 쪽으로 휘게)
  for (const [col, al, lw, so] of [[mixHex(PAL.treeDark, PAL.ink, 0.2), 0.5, 0.055, 3], [mixHex(PAL.treeLight, PAL.paper, 0.15), 0.55, 0.05, 7]]) {
    ctx.strokeStyle = rgba(col, al);
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (const n of idx) {
      if (tt[n + 3] !== 2) continue;
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
  if (all || stage === 2 || stage === 3) {
  // 5) 점엽: 가로로 누운 먹 점 (그늘 쪽·가장자리에 많이)
  for (const [al, dark] of [[0.3, false], [0.55, true]]) {
    if (!all && stage !== (dark ? 3 : 2)) continue;
    ctx.fillStyle = rgba(dark ? PAL.ink : mixHex(PAL.ink, PAL.treeDark, 0.5), al);
    ctx.beginPath();
    const bt = batcher(ctx, 'fill', 24);
    for (const n of idx) {
      const kind = tt[n + 3];
      if (kind === 0 || kind === 2) continue;
      const x = tt[n], y = tt[n + 1], r = tt[n + 2];
      srand(tt[n + 4] + (dark ? 31 : 11));
      const cnt = Math.round((kind === 3 ? 2.6 : 1.9) * r * r * (dark ? 0.45 : 1));
      for (let b = 0; b < cnt; b++) {
        const a = rnd() * TAU, d = r * Math.sqrt(0.08 + rnd() * 0.84);
        const shade = Math.cos(a - 0.85);
        if (shade < -0.35 && rnd() < 0.75) continue;
        if (dark && shade < 0.1) continue;
        const dx = x + Math.cos(a) * d, dy = y + Math.sin(a) * d;
        const rr = r * (0.055 + rnd() * 0.05);
        const rot = (rnd() - 0.5) * 0.7;
        // 누운 붓 점 (작아서 마름모 넷 꼭짓점이면 충분 — 타원보다 훨씬 싸다)
        const ca = Math.cos(rot), sa = Math.sin(rot), lx = rr * 1.9, ly = rr * 0.85;
        ctx.moveTo(dx + ca * lx, dy + sa * lx);
        ctx.lineTo(dx - sa * ly + ca * lx * 0.1, dy + ca * ly + sa * lx * 0.1);
        ctx.lineTo(dx - ca * lx, dy - sa * lx);
        ctx.lineTo(dx + sa * ly * 0.8, dy - ca * ly * 0.8);
        ctx.closePath();
        bt.tick();
      }
    }
    bt.done();
  }
  }
  if (all || stage === 3) {
  // 6) 솔잎: 진한 먹 바늘 덩어리 (방사형 짧은 획)
  ctx.lineCap = 'round';
  for (const [al, w, sc, so] of [[0.4, 0.05, 1.05, 13], [0.68, 0.065, 0.8, 37]]) {
    ctx.strokeStyle = rgba(PAL.ink, al);
    ctx.lineWidth = w;
    ctx.beginPath();
    const bt = batcher(ctx, 'stroke', 6);
    for (const n of idx) {
      if (tt[n + 3] !== 0) continue;
      const x = tt[n], y = tt[n + 1], r = tt[n + 2];
      srand(tt[n + 4] + so);
      const clusters = 4 + ((rnd() * 3) | 0);
      for (let c = 0; c < clusters; c++) {
        const a = rnd() * TAU, d = r * (0.12 + rnd() * 0.5);
        const cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d;
        const L = r * (0.2 + rnd() * 0.12) * sc;
        const a0 = rnd() * TAU;
        for (let k = 0; k < 8; k++) {
          const aa = a0 + (k / 8) * TAU + (rnd() - 0.5) * 0.3;
          ctx.moveTo(cx + Math.cos(aa) * L * 0.2, cy + Math.sin(aa) * L * 0.2);
          ctx.lineTo(cx + Math.cos(aa) * L, cy + Math.sin(aa) * L);
        }
        bt.tick();
      }
    }
    bt.done();
  }
  }
  if (all || stage === 4) {
  // 7) 활엽 외곽 먹선 일부 (남동쪽 호, 끊어지게)
  ctx.strokeStyle = rgba(PAL.ink, 0.3);
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  const bo = batcher(ctx, 'stroke', 16);
  for (const n of idx) {
    const kind = tt[n + 3];
    if (kind === 0 || kind === 2) continue;
    const x = tt[n], y = tt[n + 1], r = tt[n + 2];
    bo.tick();
    srand(tt[n + 4] + 17);
    for (let q = 0; q < 2; q++) {
      const a0 = -0.2 + q * 1.1 + rnd() * 0.4, a1 = a0 + 0.5 + rnd() * 0.5;
      const rr = r * (0.86 + rnd() * 0.1);
      ctx.moveTo(x + Math.cos(a0) * rr, y + Math.sin(a0) * rr);
      ctx.arc(x, y, rr, a0, a1);
    }
  }
  bo.done();
  // 8) 감나무 열매
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
