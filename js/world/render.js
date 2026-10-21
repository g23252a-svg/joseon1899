// 지형 렌더러: '한 폭의 수묵 지도'.
//  - GROUND: 청크(64m) 캐시. 바탕 물감층(약 2.5px/m ImageData, 번짐·얼룩·종이 비침) → 부드럽게 확대 →
//    고해상도(10px/m) 먹 디테일(해안 먹선·물결·논둑·밭고랑·길 가장자리·준법·바위·철로·다리·성벽·그림자) → 한지 섬유.
//    멀리 볼 때는 128m·4px/m 거친 청크. 아직 없는 청크는 전체 지도(mapCanvas) 확대로 임시 표시.
//  - DECAL: 물 위에서 천천히 움직이는 붓선(흐름·잔물결).
//  - HIGH: 나무 수관 청크 캐시(플레이어 주변은 구멍을 내어 비침) + 지붕(structures.RoofRenderer).
//  - 전체 지도 mapCanvas(0.5px/m, 지명 없음).

import { T, T_COUNT, isWaterT, texAt } from './terrain.js';
import { makeCanvas, drawBuildingGround, drawTreeShadows, drawCanopy, RoofRenderer } from './structures.js';
import { PAL } from '../engine/palette.js';
import { hexToRgb, mixHex, rgba, hash2 } from '../engine/util.js';

const TAU = Math.PI * 2;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ss = (a, b, v) => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------- 지형 플래그

function flags(list) {
  const f = new Uint8Array(32);
  for (const t of list) f[t] = 1;
  return f;
}
const F_WET = flags([T.SEA, T.RIVER, T.SHALLOW]);
const F_DEEP = flags([T.SEA, T.RIVER]);
const F_ROCK = flags([T.ROCK]);
const F_ROADISH = flags([T.ROAD, T.MAIN_ROAD, T.STREET, T.BRIDGE, T.RAIL, T.PIER, T.WALL]);
const F_ROADCORE = flags([T.ROAD, T.MAIN_ROAD, T.STREET, T.BRIDGE]);
const F_HILL = flags([T.MOUNTAIN, T.ROCK, T.FOREST, T.GRASS]);

// ---------------------------------------------------------------- 마칭 스퀘어

/**
 * 꼭짓점 값 f((nx+1)×(ny+1), 원점 ox,oy, 간격 s) 의 iso 등치선 → out 에 [x1,y1,x2,y2, ...]
 */
function contour(f, nx, ny, ox, oy, s, iso, out) {
  const W = nx + 1;
  for (let j = 0; j < ny; j++) {
    const y = oy + j * s;
    for (let i = 0; i < nx; i++) {
      const k = j * W + i;
      const a = f[k], b = f[k + 1], c = f[k + W + 1], d = f[k + W]; // 좌상 우상 우하 좌하
      const code = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const x = ox + i * s;
      const tx = x + (s * (iso - a)) / (b - a || 1e-9), ty = y; // 위
      const rx = x + s, ry = y + (s * (iso - b)) / (c - b || 1e-9); // 오른쪽
      const bx = x + (s * (iso - d)) / (c - d || 1e-9), by = y + s; // 아래
      const lx = x, ly = y + (s * (iso - a)) / (d - a || 1e-9); // 왼쪽
      switch (code) {
        case 1: case 14: out.push(lx, ly, bx, by); break;
        case 2: case 13: out.push(bx, by, rx, ry); break;
        case 3: case 12: out.push(lx, ly, rx, ry); break;
        case 4: case 11: out.push(tx, ty, rx, ry); break;
        case 6: case 9: out.push(tx, ty, bx, by); break;
        case 7: case 8: out.push(lx, ly, tx, ty); break;
        case 5: {
          const m = (a + b + c + d) * 0.25;
          if (m > iso) out.push(lx, ly, tx, ty, bx, by, rx, ry);
          else out.push(tx, ty, rx, ry, lx, ly, bx, by);
          break;
        }
        case 10: {
          const m = (a + b + c + d) * 0.25;
          if (m > iso) out.push(tx, ty, rx, ry, lx, ly, bx, by);
          else out.push(lx, ly, tx, ty, bx, by, rx, ry);
          break;
        }
        default:
      }
    }
  }
  return out;
}

/** 선분 a→b 중 사각형 안에 드는 매개변수 구간 [t0, t1] (없으면 null) */
function clipSeg(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const P = [-dx, dx, -dy, dy], Q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i++) {
    const p = P[i], q = Q[i];
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

// ---------------------------------------------------------------- 한지 섬유 텍스처

function makePaperTexture(size = 256) {
  const cv = makeCanvas(size, size);
  if (!cv) return null;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  let s = 7331;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  // 닥 섬유: 짧게 굽은 실오라기 (밝은 것·어두운 것)
  for (let pass = 0; pass < 2; pass++) {
    ctx.strokeStyle = pass ? 'rgba(255,250,236,0.11)' : 'rgba(96,80,56,0.06)';
    ctx.lineWidth = pass ? 0.9 : 0.7;
    ctx.beginPath();
    for (let i = 0; i < 150; i++) {
      const x = r() * size, y = r() * size, a = r() * TAU, L = 6 + r() * 18;
      const mx = x + Math.cos(a) * L * 0.5 + (r() - 0.5) * 5, my = y + Math.sin(a) * L * 0.5 + (r() - 0.5) * 5;
      for (const ox of [-size, 0, size])
        for (const oy of [-size, 0, size]) {
          if (x + ox < -30 || x + ox > size + 30 || y + oy < -30 || y + oy > size + 30) continue;
          ctx.moveTo(x + ox, y + oy);
          ctx.quadraticCurveTo(mx + ox, my + oy, x + Math.cos(a) * L + ox, y + Math.sin(a) * L + oy);
        }
    }
    ctx.stroke();
  }
  // 티끌
  for (let i = 0; i < 900; i++) {
    const x = r() * size, y = r() * size, rr = 0.3 + r() * 0.8;
    ctx.fillStyle = r() < 0.5 ? `rgba(80,66,46,${0.05 + r() * 0.07})` : `rgba(255,252,240,${0.08 + r() * 0.1})`;
    ctx.fillRect(x, y, rr, rr);
  }
  return cv;
}

// ---------------------------------------------------------------- 렌더러

export class WorldRenderer {
  constructor(tr, st, map, world) {
    this.tr = tr;
    this.st = st;
    this.map = map;
    this.world = world;
    this.tiers = [
      { id: 0, cs: 64, res: 10, step: 0.4, jit: 1.5, edge: 0.9, max: 48, lod: 0, marg: 3 },
      { id: 1, cs: 128, res: 4, step: 0.8, jit: 2.0, edge: 1.4, max: 40, lod: 1, marg: 3 },
    ];
    this.tierSwitch = 6.5; // 기기 px/m 이 이보다 작으면 거친 청크
    this.cache = new Map(); // key → {canvas, tier, ci, cj}
    this.jobs = new Map(); // key → 그리는 중인 청크 작업
    this.frameBudget = 4; // 프레임당 청크 만들기 시간(ms)
    this.pool = [[], []];
    this.canopy = new Map(); // key → {canvas|null}
    this.canopyPool = [];
    this.CRES = 8; // 수관 캐시 px/m
    this.canopyMax = 40;
    this.buildMs = 0; // 최근 청크 하나 그리는 시간(ms)
    this.stats = { built: 0, canopyBuilt: 0, frameMs: 0 };
    this._seg = [];
    this._tmpSlope = { x: 0, y: 0 };
    this._treeStamp = null;
    this._stampN = 0;
    this._holeA = 0;
    this._flowCache = new Map();
    this._flowStep = 0;
    this.mapCanvas = null;
    this.mapScale = 0.5;
    this.roofs = new RoofRenderer(st);
    this._colorTables();
    this._shadeField();
    this._tables();
    this._prepVectors();
    this.paperTex = makePaperTexture(256);
    this.scratch = this.tiers.map((tier) => {
      const n = Math.round(tier.cs / tier.step) + tier.marg * 2;
      const cv = makeCanvas(n, n);
      const ctx = cv?.getContext('2d');
      const img = ctx?.createImageData?.(n, n) || { width: n, height: n, data: new Uint8ClampedArray(n * n * 4) };
      return { n, cv, ctx, img };
    });
  }

  // ---------------------------------------------------------------- 색
  _colorTables() {
    const N = T_COUNT;
    this.CB = new Float32Array(N * 3);
    this.CA = new Float32Array(N * 3);
    this.AMT = new Float32Array(N);
    this.GRN = new Float32Array(N);
    this.GRP = new Uint8Array(N);
    this.SHK = new Float32Array(N);
    const set = (t, base, alt, amt, grain, grp, shk) => {
      const b = hexToRgb(base), a = hexToRgb(alt);
      this.CB.set(b, t * 3);
      this.CA.set(a, t * 3);
      this.AMT[t] = amt;
      this.GRN[t] = grain;
      this.GRP[t] = grp;
      this.SHK[t] = shk;
    };
    const mx = mixHex;
    set(T.VOID, PAL.paperShade, PAL.paperDeep, 0.3, 4, 0, 0);
    set(T.SEA, PAL.sea, PAL.seaDeep, 0.25, 7, 1, 0);
    set(T.RIVER, PAL.river, PAL.sea, 0.25, 5, 1, 0);
    set(T.SHALLOW, PAL.shallow, mx(PAL.shallow, PAL.sand, 0.6), 0.45, 4, 1, 0);
    set(T.MUD, PAL.mud, mx(PAL.mud, PAL.shallow, 0.55), 0.7, 7, 2, 0.15);
    set(T.SAND, PAL.sand, mx(PAL.sand, PAL.paper, 0.6), 0.5, 5, 3, 0.2);
    set(T.GRASS, PAL.grass, mx(PAL.meadow, PAL.treeLight, 0.4), 0.85, 4, 4, 0.55);
    set(T.FIELD, PAL.field, mx(PAL.field, PAL.furrow, 0.7), 0.45, 4, 5, 0.4);
    set(T.PADDY, PAL.paddy, PAL.paddyWater, 0.75, 3, 6, 0.3);
    set(T.FOREST, mx(PAL.forest, PAL.grass, 0.35), mx(PAL.treeLight, PAL.grass, 0.4), 0.6, 4, 4, 0.6);
    set(T.MOUNTAIN, mx(mx(PAL.mountain, PAL.treeLight, 0.38), PAL.ink3, 0.12), mx(PAL.meadow, PAL.forest, 0.3), 0.6, 8, 4, 1);
    set(T.ROCK, mx(mx(PAL.rock, PAL.paper, 0.3), PAL.mountain, 0.2), mx(PAL.rock, PAL.ink3, 0.4), 0.55, 10, 7, 1.1);
    set(T.ROAD, PAL.road, mx(PAL.road, PAL.paperShade, 0.7), 0.5, 3, 8, 0.25);
    set(T.MAIN_ROAD, mx(PAL.mainRoad, PAL.furrow, 0.18), mx(PAL.mainRoad, PAL.paperShade, 0.6), 0.45, 3, 8, 0.2);
    set(T.STREET, mx(PAL.street, PAL.furrow, 0.16), mx(PAL.street, PAL.paperShade, 0.6), 0.45, 3, 8, 0.2);
    set(T.YARD, mx(PAL.yard, PAL.paper, 0.15), mx(PAL.yard, PAL.dike, 0.3), 0.55, 4, 9, 0.2);
    set(T.WALL, PAL.wallStone, PAL.wallTop, 0.3, 6, 10, 0.2);
    set(T.BRIDGE, mx(PAL.timber, PAL.paper, 0.45), PAL.timber, 0.2, 4, 11, 0);
    set(T.RAIL, mx(PAL.road, PAL.ink3, 0.45), mx(PAL.road, PAL.ink3, 0.6), 0.4, 8, 12, 0.2);
    set(T.PIER, mx(PAL.timber, PAL.paper, 0.4), PAL.timber, 0.2, 4, 13, 0);
    this.paper = hexToRgb(PAL.paper);
    // 물 깊이 색띠 (64단)
    const ramp = (stops) => {
      const r = new Float32Array(64 * 3);
      for (let i = 0; i < 64; i++) {
        const v = i / 63;
        let k = 0;
        while (k + 1 < stops.length - 1 && v > stops[k + 1][0]) k++;
        const [v0, c0] = stops[k], [v1, c1] = stops[k + 1];
        const t = Math.max(0, Math.min(1, (v - v0) / (v1 - v0 || 1)));
        const a = hexToRgb(c0), b = hexToRgb(c1);
        r[i * 3] = a[0] + (b[0] - a[0]) * t;
        r[i * 3 + 1] = a[1] + (b[1] - a[1]) * t;
        r[i * 3 + 2] = a[2] + (b[2] - a[2]) * t;
      }
      return r;
    };
    // 바다: 0..160m
    this.seaRamp = ramp([[0, mx(PAL.shallow, PAL.sea, 0.25)], [0.05, mx(PAL.shallow, PAL.sea, 0.6)], [0.22, PAL.sea], [0.6, mx(PAL.sea, PAL.seaDeep, 0.75)], [1, PAL.seaDeep]]);
    // 강: 0..60m
    this.riverRamp = ramp([[0, mx(PAL.shallow, PAL.river, 0.4)], [0.12, PAL.river], [0.45, mx(PAL.river, PAL.sea, 0.7)], [1, mx(PAL.sea, PAL.seaDeep, 0.35)]]);
  }

  /** 높이장 → 음영(북서 빛). 8m 거친 격자 */
  _shadeField() {
    const tr = this.tr, W = tr.hcols, H = tr.hrows, hg = tr.height, hc = tr.hc;
    const sh = new Float32Array(W * H);
    const L = [-0.55, -0.68, 0.48];
    const ll = Math.hypot(L[0], L[1], L[2]);
    const Lx = L[0] / ll, Ly = L[1] / ll, Lz = L[2] / ll;
    const S = 70;
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const i0 = i > 0 ? k - 1 : k, i1 = i < W - 1 ? k + 1 : k;
        const j0 = j > 0 ? k - W : k, j1 = j < H - 1 ? k + W : k;
        const gx = ((hg[i1] - hg[i0]) / (hc * (i1 - i0 || 1))) * S;
        const gy = ((hg[j1] - hg[j0]) / (hc * ((j1 - j0) / W || 1))) * S;
        const nl = Math.hypot(gx, gy, 1);
        sh[k] = (-gx * Lx - gy * Ly + Lz) / nl - Lz;
      }
    this.shade = sh;
  }

  /** 벡터 자료(길·철로·논밭·성벽) 경계 상자 미리 계산 */
  _prepVectors() {
    const tr = this.tr, M = this.map;
    const bb = (pts, pad) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) {
        if (p[0] < x0) x0 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[0] > x1) x1 = p[0];
        if (p[1] > y1) y1 = p[1];
      }
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    };
    this.roads = tr.roads.map((r, n) => ({ ...r, n, bb: bb(r.points, r.width + 2) }));
    this.rails = (M.lines || [])
      .filter((l) => l.kind === 'rail')
      .map((l) => ({ id: l.id, points: l.points, embedded: l.embedded ?? l.id === 'tram', bb: bb(l.points, 4) }));
    this.fields = (M.fields || []).map((f, n) => {
      const poly = f.poly;
      let best = 0, ang = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L > best) {
          best = L;
          ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        }
      }
      const paddy = f.kind === 'paddy';
      return { kind: f.kind, poly, ang, ox: poly[0][0], oy: poly[0][1], bb: bb(poly, 30), su: paddy ? 19 : 14, sv: paddy ? 12 : 30, seed: 300 + n * 7 };
    });
    this.wallC = new Map();
    for (const w of tr.walls) {
      let sx = 0, sy = 0;
      for (const p of w.points) {
        sx += p[0];
        sy += p[1];
      }
      this.wallC.set(w.id, { x: sx / w.points.length, y: sy / w.points.length });
    }
    this.bridges = tr.bridges.map((b) => ({ ...b, bb: bb(b.points, b.width + 2) }));
  }

  // ---------------------------------------------------------------- 바탕 물감층

  /** 경계 번짐용 주기 왜곡표·물결표 (256×256 화소). 화소 격자에 붙어 있어 청크 사이가 이어진다 */
  _tables() {
    const tr = this.tr, N = 256;
    this.JX = new Float32Array(N * N);
    this.JY = new Float32Array(N * N);
    this.WV = new Float32Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        this.JX[k] = texAt(tr.tex2, i, j) - 0.5 + (texAt(tr.tex, i * 3, j * 3 + 31) - 0.5) * 0.45;
        this.JY[k] = texAt(tr.tex2, i + 101, j + 57) - 0.5 + (texAt(tr.tex, i * 3 + 71, j * 3 + 19) - 0.5) * 0.45;
        this.WV[k] = texAt(tr.tex, i + 7, j * 3 + 3) - 0.5;
      }
  }

  /**
   * data(pw×ph RGBA) 에 (ox,oy) 부터 step(m) 간격 화소로 바탕을 칠한다 (j0..j1 행만).
   * jit: 경계 번짐 왜곡(m). 화소마다 무리 번호를 this._tb 에 남긴다 (edgePass 용).
   */
  paintBase(data, pw, ph, ox, oy, step, jit, j0 = 0, j1 = ph) {
    const tr = this.tr, g = tr.grid, C = tr.cols, R = tr.rows, cell = tr.cell, inv = 1 / cell, W = tr.w, H = tr.h;
    const cn = tr.cn, cl = tr.cl;
    const CB = this.CB, CA = this.CA, AMT = this.AMT, GRN = this.GRN, GRP = this.GRP, SHK = this.SHK;
    const PR = this.paper[0], PG = this.paper[1], PB = this.paper[2];
    const sea = this.seaRamp, riv = this.riverRamp;
    const bu = tr.bridgeUnder;
    const istep = 1 / step;
    const pxo = Math.round(ox * istep), pyo = Math.round(oy * istep);
    const smooth = step < cell * 0.75;
    // 칸 단위 지역 캐시: 음영·물 거리·높이 (필요한 칸만)
    const pad = jit + cell;
    const lc0 = Math.max(0, Math.floor((ox - pad) * inv)), lc1 = Math.min(C - 1, Math.floor((ox + pw * step + pad) * inv));
    const lr0 = Math.max(0, Math.floor((oy + j0 * step - pad) * inv)), lr1 = Math.min(R - 1, Math.floor((oy + j1 * step + pad) * inv));
    const lw = Math.max(1, lc1 - lc0 + 1), lh = Math.max(1, lr1 - lr0 + 1);
    const need = lw * lh;
    if (!this._lsh || this._lsh.length < need) {
      this._lsh = new Float32Array(need);
      this._lwd = new Float32Array(need);
      this._lht = new Float32Array(need);
    }
    const LS = this._lsh, LW = this._lwd, LH = this._lht;
    if (lc1 >= lc0 && lr1 >= lr0) {
      for (let r = 0; r < lh; r++) {
        const y = (lr0 + r + 0.5) * cell, row = (lr0 + r) * C;
        for (let c = 0; c < lw; c++) {
          const x = (lc0 + c + 0.5) * cell, k = r * lw + c;
          let t = g[row + lc0 + c];
          if (t === T.BRIDGE) t = T.RIVER;
          if (t === T.SEA || t === T.RIVER) LW[k] = tr.bil(tr.waterDist, x, y);
          else if (SHK[t] > 0) {
            LS[k] = tr.bil(this.shade, x, y);
            if (t === T.MOUNTAIN || t === T.ROCK) LH[k] = tr.bil(tr.height, x, y);
          }
        }
      }
    }
    if (!this._tb || this._tb.length < pw * ph) this._tb = new Uint8Array(pw * ph);
    const TB = this._tb, JX = this.JX, JY = this.JY, WV = this.WV;
    for (let j = j0; j < j1; j++) {
      const y = oy + (j + 0.5) * step;
      const jr = ((j + pyo) & 255) << 8;
      const hy = Math.imul(j + pyo, 0x165667b1);
      let o = j * pw * 4, q = j * pw;
      for (let i = 0; i < pw; i++, o += 4, q++) {
        const x = ox + (i + 0.5) * step;
        const ji = jr | ((i + pxo) & 255);
        let sx = x, sy = y;
        if (jit) {
          sx += JX[ji] * jit;
          sy += JY[ji] * jit;
        }
        let t = 0, ci = -1, li = 0;
        if (sx >= 0 && sy >= 0 && sx < W && sy < H) {
          const cx = (sx * inv) | 0, cy = (sy * inv) | 0;
          ci = cy * C + cx;
          t = g[ci];
          if (smooth) {
            // 둘레 네 칸의 쌍선형 다수결: 칸 계단 대신 매끈한 경계
            const fx = sx * inv - 0.5, fy = sy * inv - 0.5;
            let bx = fx < 0 ? 0 : fx | 0, by = fy < 0 ? 0 : fy | 0;
            if (bx > C - 2) bx = C - 2;
            if (by > R - 2) by = R - 2;
            const i00 = by * C + bx;
            const a = g[i00], b = g[i00 + 1], c = g[i00 + C], d = g[i00 + C + 1];
            if (a !== b || a !== c || a !== d) {
              let tx = fx - bx, ty = fy - by;
              tx = tx < 0 ? 0 : tx > 1 ? 1 : tx;
              ty = ty < 0 ? 0 : ty > 1 ? 1 : ty;
              const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty;
              let best = wa + (b === a ? wb : 0) + (c === a ? wc : 0) + (d === a ? wd : 0), bi = i00;
              t = a;
              if (b !== a) {
                const v = wb + (c === b ? wc : 0) + (d === b ? wd : 0);
                if (v > best) (best = v), (t = b), (bi = i00 + 1);
              }
              if (c !== a && c !== b) {
                const v = wc + (d === c ? wd : 0);
                if (v > best) (best = v), (t = c), (bi = i00 + C);
              }
              if (d !== a && d !== b && d !== c && wd > best) (t = d), (bi = i00 + C + 1);
              ci = bi;
            }
          }
          if (t === T.BRIDGE) t = bu.has(ci) ? bu.get(ci) : T.ROAD;
          li = (cy - lr0) * lw + (cx - lc0);
          if (li < 0 || li >= need) li = 0;
        }
        const k3 = t * 3;
        let r = CB[k3], gg = CB[k3 + 1], b = CB[k3 + 2];
        // 얼룩: 칸 단위 잔 노이즈(10m)·저주파(160m)
        const nM = ci >= 0 ? cn[ci] * 0.00392 : 0.5;
        const nL = ci >= 0 ? cl[ci] * 0.00392 : 0.5;
        let m = AMT[t] * (nM * 0.85 + nL * 0.75 - 0.55);
        if (m > 0) {
          if (m > 1) m = 1;
          r += (CA[k3] - r) * m;
          gg += (CA[k3 + 1] - gg) * m;
          b += (CA[k3 + 2] - b) * m;
        }
        if (t === T.SEA || t === T.RIVER) {
          // 물 깊이
          const d = LW[li];
          let qq;
          if (t === T.SEA) {
            qq = (d * 0.39) | 0;
            qq = (qq > 63 ? 63 : qq < 0 ? 0 : qq) * 3;
            r = sea[qq] * 0.82 + r * 0.18;
            gg = sea[qq + 1] * 0.82 + gg * 0.18;
            b = sea[qq + 2] * 0.82 + b * 0.18;
          } else {
            qq = (d * 1.05) | 0;
            qq = (qq > 63 ? 63 : qq < 0 ? 0 : qq) * 3;
            r = riv[qq] * 0.85 + r * 0.15;
            gg = riv[qq + 1] * 0.85 + gg * 0.15;
            b = riv[qq + 2] * 0.85 + b * 0.15;
          }
          // 물결 얼룩
          const wv = WV[ji] * 0.09;
          r *= 1 + wv;
          gg *= 1 + wv;
          b *= 1 + wv * 0.6;
        } else if (SHK[t] > 0) {
          // 산 음영 + 높이에 따른 색
          const s = LS[li] * SHK[t];
          let f = 1 + (s > 0 ? s * 0.5 : s * 0.7);
          f = f < 0.8 ? 0.8 : f > 1.13 ? 1.13 : f;
          r *= f;
          gg *= f;
          b *= f;
          if (t === T.MOUNTAIN || t === T.ROCK) {
            const h = LH[li];
            if (t === T.MOUNTAIN && h < 0.5) {
              const mm = (1 - ss(0.24, 0.5, h)) * 0.55;
              r += (CA[k3] - r) * mm;
              gg += (CA[k3 + 1] - gg) * mm;
              b += (CA[k3 + 2] - b) * mm;
            }
            if (h > 0.55) {
              const hi = ss(0.55, 1, h) * 0.09;
              r -= r * hi;
              gg -= gg * hi;
              b -= b * hi * 0.7;
            }
          }
        }
        TB[q] = GRP[t];
        // 종이 비침: 물감 농도
        const dens = 0.8 + (nL - 0.5) * 0.28 + (nM - 0.5) * 0.16;
        r = PR + (r - PR) * dens;
        gg = PG + (gg - PG) * dens;
        b = PB + (b - PB) * dens;
        // 안료 알갱이
        let hh = Math.imul(i + pxo, 0x27d4eb2d) ^ hy;
        hh = Math.imul(hh ^ (hh >>> 15), 0x2c1b3c6d);
        const gr = (((hh >>> 24) & 255) - 128) * (GRN[t] * 0.0078125);
        data[o] = r + gr;
        data[o + 1] = gg + gr;
        data[o + 2] = b + gr * 0.85;
        data[o + 3] = 255;
      }
    }
  }

  /** 물감 가장자리 진해짐: 화소 무리 번호가 e 화소 안에서 바뀌면 어둡게 (paintBase 뒤에) */
  edgePass(data, pw, ph, e, j0 = 0, j1 = ph) {
    const TB = this._tb;
    if (!TB || e < 1) return;
    for (let j = j0; j < j1; j++) {
      const rU = (j - e < 0 ? 0 : j - e) * pw, rD = (j + e >= ph ? ph - 1 : j + e) * pw, r0 = j * pw;
      for (let i = 0; i < pw; i++) {
        const gp = TB[r0 + i];
        let n = 0;
        if (TB[r0 + (i - e < 0 ? 0 : i - e)] !== gp) n++;
        if (TB[r0 + (i + e >= pw ? pw - 1 : i + e)] !== gp) n++;
        if (TB[rU + i] !== gp) n++;
        if (TB[rD + i] !== gp) n++;
        if (n) {
          const o = (r0 + i) * 4, f = 1 - 0.04 * n;
          data[o] *= f;
          data[o + 1] *= f;
          data[o + 2] *= f;
        }
      }
    }
  }

  // ---------------------------------------------------------------- 공용 도구

  /** 칸 플래그 마스크의 경계선 (부드럽게 한 점유율의 0.5 등치선). 마스크가 하나도 없으면 null */
  maskContour(F, x0, y0, x1, y1, bridgeWet = false, out = []) {
    const tr = this.tr, c = tr.cell, g = tr.grid, C = tr.cols, R = tr.rows, bu = tr.bridgeUnder;
    const ca = Math.floor(x0 / c) - 2, cb = Math.ceil(x1 / c) + 2;
    const ra = Math.floor(y0 / c) - 2, rb = Math.ceil(y1 / c) + 2;
    const n = cb - ca, m = rb - ra;
    const need = n * m;
    if (!this._mc || this._mc.length < need * 3) this._mc = new Float32Array(need * 3);
    const cells = this._mc, blur = this._mc.subarray(need, need * 2), f = this._mc.subarray(need * 2, need * 3);
    let cnt = 0;
    for (let j = 0; j < m; j++) {
      let cy = ra + j;
      cy = cy < 0 ? 0 : cy >= R ? R - 1 : cy;
      for (let i = 0; i < n; i++) {
        let cx = ca + i;
        cx = cx < 0 ? 0 : cx >= C ? C - 1 : cx;
        const idx = cy * C + cx;
        const t = g[idx];
        let v = F[t];
        if (!v && bridgeWet && t === T.BRIDGE && bu.has(idx)) v = 1;
        cells[j * n + i] = v;
        cnt += v;
      }
    }
    if (!cnt) return null;
    if (cnt === need) return { segs: out, all: true };
    // 3×3 흐림 → 꼭짓점 평균
    for (let j = 1; j < m - 1; j++)
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        blur[k] = cells[k] * 0.5 + (cells[k - 1] + cells[k + 1] + cells[k - n] + cells[k + n]) * 0.125;
      }
    // 흐림은 안쪽 칸(1..n-2)에만 있다 → 꼭짓점은 그 사이 (칸 ca+2+i 의 왼쪽 위 모서리)
    const fw = n - 4, fh = m - 4;
    for (let j = 0; j <= fh; j++)
      for (let i = 0; i <= fw; i++) {
        const k = (j + 1) * n + (i + 1);
        f[j * (fw + 1) + i] = (blur[k] + blur[k + 1] + blur[k + n] + blur[k + n + 1]) * 0.25;
      }
    contour(f, fw, fh, (ca + 2) * c, (ra + 2) * c, c, 0.5, out);
    return { segs: out, all: false };
  }

  /** 선분 묶음을 굵기 변화가 있는 붓선으로 */
  strokeVar(ctx, segs, w0, w1, color, alpha, nscale = 0.35, skip = 0) {
    if (!segs.length) return;
    const tex = this.tr.tex, tex2 = this.tr.tex2;
    const B = 4;
    const paths = [[], [], [], []];
    for (let k = 0; k < segs.length; k += 4) {
      const mx = (segs[k] + segs[k + 2]) * 0.5, my = (segs[k + 1] + segs[k + 3]) * 0.5;
      const n = texAt(tex, mx * nscale, my * nscale) * 0.75 + texAt(tex2, mx * 1.3, my * 1.3) * 0.25;
      if (skip && texAt(tex2, mx * 0.7 + 19, my * 0.7 + 3) < skip) continue;
      let b = Math.floor((n - 0.22) * 7);
      b = b < 0 ? 0 : b >= B ? B - 1 : b;
      paths[b].push(k);
    }
    ctx.strokeStyle = rgba(color, alpha);
    for (let b = 0; b < B; b++) {
      const list = paths[b];
      if (!list.length) continue;
      ctx.lineWidth = w0 + ((w1 - w0) * b) / (B - 1);
      ctx.beginPath();
      for (const k of list) {
        ctx.moveTo(segs[k], segs[k + 1]);
        ctx.lineTo(segs[k + 2], segs[k + 3]);
      }
      ctx.stroke();
    }
  }

  /** 지터 격자: step 간격 칸마다 fn(x, y, h, gx, gy). seed 로 칸 난수 */
  grid(x0, y0, x1, y1, step, seed, fn) {
    const gx0 = Math.floor(x0 / step), gx1 = Math.floor(x1 / step);
    const gy0 = Math.floor(y0 / step), gy1 = Math.floor(y1 / step);
    for (let gy = gy0; gy <= gy1; gy++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const x = (gx + 0.1 + 0.8 * hash2(gx, gy, seed)) * step;
        const y = (gy + 0.1 + 0.8 * hash2(gx, gy, seed + 1)) * step;
        fn(x, y, hash2(gx, gy, seed + 2), gx, gy);
      }
  }

  // ---------------------------------------------------------------- 먹 디테일 (청크 작업 _stepJob 이 단계별로 부른다)

  // 물: 해안 먹선, 깊은 물 경계, 물가 겹선, 물결 무늬, 강 흐름 붓선
  drawWater(ctx, x0, y0, x1, y1, lod) {
    const tr = this.tr;
    const seg = (this._seg.length = 0, this._seg);
    const wet = this.maskContour(F_WET, x0 - 2, y0 - 2, x1 + 2, y1 + 2, true, seg);
    if (!wet) return;
    const inkW = mixHex(PAL.seaDeep, PAL.ink, 0.55);
    // 물가 겹선 (물 거리 등치선) — 물 속 쪽으로 몇 겹
    const isos = lod === 0 ? [3.5, 8, 14, 23] : [5, 13];
    const sp = 2, gx0 = Math.floor((x0 - 2) / sp), gy0 = Math.floor((y0 - 2) / sp);
    const nx = Math.ceil((x1 + 2) / sp) - gx0, ny = Math.ceil((y1 + 2) / sp) - gy0;
    const need = (nx + 1) * (ny + 1);
    if (!this._wf || this._wf.length < need) this._wf = new Float32Array(need);
    const wf = this._wf;
    let mx = -Infinity;
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const v = tr.bil(tr.waterDist, (gx0 + i) * sp, (gy0 + j) * sp);
        wf[j * (nx + 1) + i] = v;
        if (v > mx) mx = v;
      }
    const deepAt = (x, y) => {
      const t = tr.at(x, y);
      return t === T.SEA || t === T.RIVER;
    };
    isos.forEach((iso, n) => {
      if (mx < iso) return;
      const out = [];
      contour(wf, nx, ny, gx0 * sp, gy0 * sp, sp, iso, out);
      const keep = [];
      for (let k = 0; k < out.length; k += 4) {
        const ax = (out[k] + out[k + 2]) * 0.5, ay = (out[k + 1] + out[k + 3]) * 0.5;
        if (deepAt(ax, ay)) keep.push(out[k], out[k + 1], out[k + 2], out[k + 3]);
      }
      const a = [0.34, 0.26, 0.18, 0.12][n] ?? 0.12;
      this.strokeVar(ctx, keep, lod ? 0.18 : 0.05, lod ? 0.4 : 0.13, inkW, a, 0.5, 0.3 + n * 0.08);
    });
    if (!wet.all) {
      // 깊은 물 / 얕은 물 경계 (옅게)
      if (lod === 0) {
        const s2 = [];
        const deep = this.maskContour(F_DEEP, x0 - 2, y0 - 2, x1 + 2, y1 + 2, false, s2);
        if (deep && !deep.all) this.strokeVar(ctx, s2, 0.05, 0.12, inkW, 0.28, 0.6, 0.25);
      }
      // 해안 먹선: 굵기 변화, 두 번
      this.strokeVar(ctx, seg, lod ? 0.35 : 0.1, lod ? 0.75 : 0.32, PAL.ink, 0.78, 0.33);
      if (lod === 0) {
        ctx.save();
        ctx.translate(0.12, 0.16);
        this.strokeVar(ctx, seg, 0.04, 0.14, PAL.ink2, 0.3, 0.9, 0.45);
        ctx.restore();
      }
    }
    if (lod !== 0) return;
    // 물결 무늬 (바다: 비늘 같은 호, 무리지어)
    ctx.strokeStyle = rgba(inkW, 0.3);
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    const tex = tr.tex;
    const R = 4.2;
    for (let gy = Math.floor((y0 - 2) / 2.6); gy <= Math.ceil((y1 + 2) / 2.6); gy++) {
      const yy = gy * 2.6;
      const off = (gy & 1) * 2.1;
      for (let gx = Math.floor((x0 - R) / R); gx <= Math.ceil((x1 + R) / R); gx++) {
        const xx = gx * R + off + (hash2(gx, gy, 51) - 0.5) * 0.8;
        if (fbmAtCheap(tex, xx, yy) < 0.56) continue;
        const t = tr.at(xx, yy);
        if (t !== T.SEA) continue;
        if (tr.bil(tr.waterDist, xx, yy) < 12) continue;
        const rr = 1.0 + hash2(gx, gy, 52) * 0.5;
        ctx.moveTo(xx - rr, yy);
        ctx.arc(xx, yy - rr * 0.55, rr * 1.12, Math.PI * 0.82, Math.PI * 0.18, true);
      }
    }
    ctx.stroke();
    // 강: 흐름 방향 붓선
    ctx.strokeStyle = rgba(inkW, 0.2);
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    this.grid(x0 - 3, y0 - 3, x1 + 3, y1 + 3, 4.5, 61, (x, y, h) => {
      if (h > 0.42) return;
      if (tr.at(x, y) !== T.RIVER) return;
      const near = tr.riverIndex.nearest(x, y, 140);
      if (!near) return;
      const sg = near.seg;
      const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
      const ux = (sg.bx - sg.ax) / L, uy = (sg.by - sg.ay) / L;
      const len = 1.6 + h * 4;
      const bend = (hash2(Math.round(x), Math.round(y), 62) - 0.5) * 0.8;
      ctx.moveTo(x - ux * len * 0.5, y - uy * len * 0.5);
      ctx.quadraticCurveTo(x - uy * bend, y + ux * bend, x + ux * len * 0.5, y + uy * len * 0.5);
    });
    ctx.stroke();
  }

  // 갯벌 갯골·게 구멍, 모래 점묘
  drawShore(ctx, x0, y0, x1, y1, lod) {
    const tr = this.tr;
    // 빨리 거르기: 이 청크에 갯벌·모래가 있나
    let has = false;
    for (let y = y0; y < y1 && !has; y += 6)
      for (let x = x0; x < x1; x += 6) {
        const t = tr.at(x, y);
        if (t === T.MUD || t === T.SAND) {
          has = true;
          break;
        }
      }
    if (!has) return;
    if (lod === 0) {
      // 갯골: 노이즈 등치선을 갯벌 안에서만
      const sp = 2, gx0 = Math.floor((x0 - 2) / sp), gy0 = Math.floor((y0 - 2) / sp);
      const nx = Math.ceil((x1 + 2) / sp) - gx0, ny = Math.ceil((y1 + 2) / sp) - gy0;
      const f = new Float32Array((nx + 1) * (ny + 1));
      for (let j = 0; j <= ny; j++)
        for (let i = 0; i <= nx; i++) f[j * (nx + 1) + i] = fbmAtCheap(tr.tex2, (gx0 + i) * sp * 0.55, (gy0 + j) * sp * 0.55);
      const out = [];
      contour(f, nx, ny, gx0 * sp, gy0 * sp, sp, 0.5, out);
      const keep = [];
      for (let k = 0; k < out.length; k += 4) {
        const mx = (out[k] + out[k + 2]) * 0.5, my = (out[k + 1] + out[k + 3]) * 0.5;
        if (tr.at(mx, my) === T.MUD) keep.push(out[k], out[k + 1], out[k + 2], out[k + 3]);
      }
      this.strokeVar(ctx, keep, 0.05, 0.2, mixHex(PAL.seaDeep, PAL.ink2, 0.5), 0.45, 0.8);
    }
    // 점묘
    const dot = lod ? 2.2 : 0.95;
    ctx.fillStyle = rgba(PAL.ink2, lod ? 0.18 : 0.22);
    ctx.beginPath();
    this.grid(x0 - 1, y0 - 1, x1 + 1, y1 + 1, dot, 71, (x, y, h) => {
      const t = tr.at(x, y);
      if (t === T.MUD) {
        if (h > 0.4) return;
        const r = (lod ? 0.25 : 0.07) + h * 0.12;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      } else if (t === T.SAND) {
        if (h > 0.3) return;
        const r = (lod ? 0.18 : 0.045) + h * 0.06;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
    });
    ctx.fill();
  }

  // 논둑 격자·모줄, 밭고랑
  drawFields(ctx, x0, y0, x1, y1, lod) {
    const tr = this.tr;
    for (const f of this.fields) {
      if (f.bb.x1 < x0 || f.bb.x0 > x1 || f.bb.y1 < y0 || f.bb.y0 > y1) continue;
      const tt = f.kind === 'paddy' ? T.PADDY : T.FIELD;
      const ca = Math.cos(f.ang), sa = Math.sin(f.ang);
      // 청크 네 귀를 (u,v) 로
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [px, py] of [[x0 - 2, y0 - 2], [x1 + 2, y0 - 2], [x1 + 2, y1 + 2], [x0 - 2, y1 + 2]]) {
        const dx = px - f.ox, dy = py - f.oy;
        const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
        if (u < u0) u0 = u;
        if (u > u1) u1 = u;
        if (v < v0) v0 = v;
        if (v > v1) v1 = v;
      }
      const inChunk = (x, y) => x >= x0 - 2 && x <= x1 + 2 && y >= y0 - 2 && y <= y1 + 2;
      const tex = tr.tex;
      // 둑의 물결 (선을 따라 천천히 휘어진다)
      const wob = (s, k, amp) => (amp ? (texAt(tex, s * 0.32 + k * 13.7, k * 5.1 + f.seed) - 0.5) * amp : 0);
      // along: 'v' 면 v 방향으로 걷는 선(u 고정), 'u' 면 반대. gapFn(s) 가 참이면 그 자리는 끊는다
      const walk = (fixed, along, a0, a1, stepW, amp = 0, k = 0, gapFn = null) => {
        let open = false;
        for (let s = a0; s <= a1; s += stepW) {
          const w = wob(s, k, amp);
          const u = along === 'v' ? fixed + w : s, v = along === 'v' ? s : fixed + w;
          const x = f.ox + u * ca - v * sa, y = f.oy + u * sa + v * ca;
          const ok = inChunk(x, y) && tr.at(x, y) === tt && !(gapFn && gapFn(s));
          if (ok) {
            if (!open) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            open = true;
          } else open = false;
        }
      };
      if (tt === T.PADDY) {
        const ku0 = Math.floor(u0 / f.su) - 1, ku1 = Math.ceil(u1 / f.su) + 1;
        const kv0 = Math.floor(v0 / f.sv) - 1, kv1 = Math.ceil(v1 / f.sv) + 1;
        const uL = (k) => k * f.su + (hash2(k, 0, f.seed) - 0.5) * f.su * 0.35;
        const vL = (k) => k * f.sv + (hash2(0, k, f.seed + 1) - 0.5) * f.sv * 0.3;
        const amp = lod ? 0 : 1.5;
        // 배미마다 물빛이 조금씩 다르다 (물 댄 논·자란 논)
        if (lod === 0) {
          const tints = [[PAL.paddyWater, 0.22], [mixHex(PAL.paddy, PAL.field, 0.45), 0.2], [PAL.treeLight, 0.14], [mixHex(PAL.paddyWater, PAL.sea, 0.3), 0.16]];
          for (let ti = 0; ti < tints.length; ti++) {
            ctx.fillStyle = rgba(tints[ti][0], tints[ti][1]);
            ctx.beginPath();
            for (let ku = ku0; ku < ku1; ku++)
              for (let kv = kv0; kv < kv1; kv++) {
                const h = hash2(ku, kv, f.seed + 9);
                if (Math.floor(h * 6) !== ti) continue;
                const ua = uL(ku) + 0.3, ub = uL(ku + 1) - 0.3, va = vL(kv) + 0.3, vb = vL(kv + 1) - 0.3;
                const P = [[ua, va], [ub, va], [ub, vb], [ua, vb]].map(([u, v]) => [f.ox + u * ca - v * sa, f.oy + u * sa + v * ca]);
                if (!P.every(([x, y]) => tr.at(x, y) === T.PADDY)) continue;
                if (P.every(([x, y]) => x < x0 - 2 || x > x1 + 2) || P.every(([x, y]) => y < y0 - 2 || y > y1 + 2)) continue;
                ctx.moveTo(P[0][0], P[0][1]);
                for (let q = 1; q < 4; q++) ctx.lineTo(P[q][0], P[q][1]);
                ctx.closePath();
              }
            ctx.fill();
          }
          // 모줄 (옅은 점선)
          ctx.save();
          ctx.setLineDash([0.14, 0.32]);
          ctx.strokeStyle = rgba(PAL.treeDark, 0.2);
          ctx.lineWidth = 0.09;
          ctx.beginPath();
          for (let v = Math.floor(v0 / 0.85) * 0.85; v <= v1; v += 0.85) walk(v, 'u', u0, u1, 1);
          ctx.stroke();
          ctx.restore();
        }
        // 논둑: 휘어지고, 군데군데 끊겨 배미가 합쳐진다
        ctx.beginPath();
        for (let k = ku0; k <= ku1; k++) walk(uL(k), 'v', v0, v1, 0.8, amp, k, (s) => hash2(k, Math.floor(s / f.sv), f.seed + 3) < 0.16);
        for (let k = kv0; k <= kv1; k++) walk(vL(k), 'u', u0, u1, 0.8, amp, k + 500, (s) => hash2(Math.floor(s / f.su), k, f.seed + 4) < 0.12);
        ctx.strokeStyle = rgba(PAL.dike, 0.85);
        ctx.lineWidth = lod ? 0.9 : 0.6;
        ctx.stroke();
        ctx.strokeStyle = rgba(PAL.ink2, lod ? 0.3 : 0.24);
        ctx.lineWidth = lod ? 0.22 : 0.08;
        ctx.stroke();
      } else {
        // 밭: 띠마다 고랑 방향이 다르다
        for (let k = Math.floor(u0 / f.su) - 1; k <= Math.ceil(u1 / f.su) + 1; k++) {
          const ua = k * f.su, ub = ua + f.su;
          const h = hash2(k, 7, f.seed);
          const gap = lod ? 1.6 : 0.75;
          ctx.beginPath();
          if (h < 0.45) {
            for (let u = ua + gap * 0.5; u < ub; u += gap) walk(u, 'v', v0, v1, 1);
          } else if (h < 0.85) {
            for (let v = Math.floor(v0 / gap) * gap; v <= v1; v += gap) walk(v, 'u', Math.max(u0, ua + 0.6), Math.min(u1, ub - 0.6), 1);
          }
          ctx.strokeStyle = rgba(h < 0.45 ? PAL.furrow : mixHex(PAL.furrow, PAL.treeDark, 0.35), lod ? 0.3 : 0.42);
          ctx.lineWidth = lod ? 0.3 : 0.11;
          ctx.stroke();
        }
        // 밭 경계 둑
        ctx.beginPath();
        for (let k = Math.floor(u0 / f.su) - 1; k <= Math.ceil(u1 / f.su) + 1; k++) walk(k * f.su, 'v', v0, v1, 1);
        ctx.strokeStyle = rgba(PAL.ink3, 0.35);
        ctx.lineWidth = lod ? 0.3 : 0.12;
        ctx.stroke();
      }
    }
  }

  // 풀포기·들꽃
  drawGrass(ctx, x0, y0, x1, y1) {
    const tr = this.tr;
    ctx.strokeStyle = rgba(mixHex(PAL.ink2, PAL.treeDark, 0.5), 0.36);
    ctx.lineWidth = 0.055;
    ctx.beginPath();
    const flowers = [];
    this.grid(x0 - 1, y0 - 1, x1 + 1, y1 + 1, 2.7, 81, (x, y, h, gx, gy) => {
      if (h > 0.27) return;
      const t = tr.at(x, y);
      if (t !== T.GRASS && !(t === T.MOUNTAIN && h < 0.12)) return;
      const n = 3 + ((h * 30) | 0) % 3;
      const lean = (hash2(gx, gy, 82) - 0.5) * 0.3;
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + (k - (n - 1) / 2) * 0.38 + lean;
        const L = 0.32 + hash2(gx + k, gy, 83) * 0.25;
        ctx.moveTo(x + (k - 1) * 0.06, y);
        ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      }
      if (h < 0.018) flowers.push(x + 0.3, y - 0.2, h);
    });
    ctx.stroke();
    for (let k = 0; k < flowers.length; k += 3) {
      ctx.fillStyle = flowers[k + 2] < 0.009 ? rgba(PAL.seal, 0.45) : rgba(PAL.white, 0.75);
      ctx.beginPath();
      ctx.arc(flowers[k], flowers[k + 1], 0.13, 0, TAU);
      ctx.fill();
    }
  }

  // 산: 준법 먹 획(기울기 방향), 태점, 바위 덩어리와 벼랑 먹선
  drawMountains(ctx, x0, y0, x1, y1, lod) {
    const tr = this.tr;
    // 빨리 거르기
    let any = false;
    for (let y = y0; y <= y1 && !any; y += 8)
      for (let x = x0; x <= x1; x += 8)
        if (tr.heightAt(x, y) > 0.17) {
          any = true;
          break;
        }
    if (!any) return;
    const step = lod ? 4.4 : 2.4;
    const P = [[], [], []];
    const dots = [];
    const sl = this._tmpSlope;
    this.grid(x0 - 4, y0 - 4, x1 + 4, y1 + 4, step, 91, (x, y, h, gx, gy) => {
      const t = tr.at(x, y);
      if (!F_HILL[t]) return;
      const hh = tr.heightAt(x, y);
      if (hh < 0.2) return;
      tr.slopeAt(x, y, sl);
      const s = Math.hypot(sl.x, sl.y) * 260;
      if (s < 0.12) return;
      const strong = t === T.MOUNTAIN || t === T.ROCK;
      const p = (0.22 + Math.min(1, s) * 0.55) * (strong ? 1 : t === T.FOREST ? 0.25 : 0.5);
      if (h > p) {
        if (lod === 0 && strong && hh > 0.42 && h > 0.93 && hash2(gx, gy, 95) < hh - 0.3) dots.push(x, y);
        return;
      }
      let dx = -sl.x, dy = -sl.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const rot = (hash2(gx, gy, 92) - 0.5) * 0.6;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const ux = dx * c - dy * sn, uy = dx * sn + dy * c;
      const facing = ux * 0.62 + uy * 0.78;
      const b = facing > 0.3 ? 2 : facing > -0.35 ? 1 : 0;
      const L = (1.1 + Math.min(1.6, s) * 1.6 + hash2(gx, gy, 93) * 1.2) * (lod ? 1.7 : 1);
      const bend = (hash2(gx, gy, 94) - 0.5) * L * 0.35;
      P[b].push(x - ux * L * 0.35, y - uy * L * 0.35, x - uy * bend, y + ux * bend, x + ux * L * 0.65, y + uy * L * 0.65);
    });
    const col = mixHex(PAL.ink, PAL.mountain, 0.25);
    const A = [0.12, 0.22, 0.36];
    for (let b = 0; b < 3; b++) {
      const L = P[b];
      if (!L.length) continue;
      ctx.strokeStyle = rgba(col, A[b]);
      ctx.lineWidth = (lod ? 0.22 : 0.07) + b * (lod ? 0.06 : 0.025);
      ctx.beginPath();
      for (let k = 0; k < L.length; k += 6) {
        ctx.moveTo(L[k], L[k + 1]);
        ctx.quadraticCurveTo(L[k + 2], L[k + 3], L[k + 4], L[k + 5]);
      }
      ctx.stroke();
    }
    // 태점 (산꼭대기 이끼점)
    if (dots.length) {
      ctx.fillStyle = rgba(PAL.ink, 0.55);
      ctx.beginPath();
      for (let k = 0; k < dots.length; k += 2) {
        for (let q = 0; q < 3; q++) {
          const a = q * 2.1 + dots[k] * 0.7, d = 0.35 + q * 0.12;
          const px = dots[k] + Math.cos(a) * d, py = dots[k + 1] + Math.sin(a) * d, r = 0.12 + q * 0.03;
          ctx.moveTo(px + r * 1.4, py);
          ctx.ellipse(px, py, r * 1.4, r, a, 0, TAU);
        }
      }
      ctx.fill();
    }
    // 바위
    const seg = [];
    const rk = this.maskContour(F_ROCK, x0 - 2, y0 - 2, x1 + 2, y1 + 2, false, seg);
    if (!rk) return;
    if (lod === 0) {
      // 부벽준: 바위 면에 도끼로 찍은 듯한 굵은 먹 획 (그늘 쪽에 많이)
      const ax = [];
      this.grid(x0 - 3, y0 - 3, x1 + 3, y1 + 3, 1.5, 105, (x, y, h, gx, gy) => {
        if (h > 0.42 || tr.at(x, y) !== T.ROCK) return;
        tr.slopeAt(x, y, sl);
        const a = Math.atan2(sl.y, sl.x) + Math.PI + (hash2(gx, gy, 106) - 0.5) * 0.7;
        const L = 0.7 + hash2(gx, gy, 107) * 1.3;
        ax.push(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, h);
      });
      for (const [lo, hi, w, al] of [[0, 0.2, 0.26, 0.3], [0.2, 0.43, 0.14, 0.42]]) {
        ctx.strokeStyle = rgba(PAL.ink2, al);
        ctx.lineWidth = w;
        ctx.beginPath();
        for (let k = 0; k < ax.length; k += 5) {
          if (ax[k + 4] < lo || ax[k + 4] >= hi) continue;
          ctx.moveTo(ax[k], ax[k + 1]);
          ctx.lineTo(ax[k + 2], ax[k + 3]);
        }
        ctx.stroke();
      }
      const boulders = [];
      this.grid(x0 - 4, y0 - 4, x1 + 4, y1 + 4, 4.2, 101, (x, y, h, gx, gy) => {
        if (h > 0.22 || tr.at(x, y) !== T.ROCK) return;
        boulders.push(x, y, 1.1 + h * 6, gx, gy);
      });
      const light = mixHex(PAL.rock, PAL.paper, 0.35), dark = mixHex(PAL.rock, PAL.ink, 0.35);
      const poly = (x, y, r, gx, gy, sc, ox, oy) => {
        ctx.beginPath();
        for (let q = 0; q < 6; q++) {
          const a = (q / 6) * TAU + hash2(gx, gy, 110 + q) * 0.5;
          const rr = r * sc * (0.7 + 0.45 * hash2(gx, gy, 120 + q));
          const px = x + ox + Math.cos(a) * rr, py = y + oy + Math.sin(a) * rr * 0.8;
          if (q === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      for (let k = 0; k < boulders.length; k += 5) {
        const [x, y, r, gx, gy] = [boulders[k], boulders[k + 1], boulders[k + 2], boulders[k + 3], boulders[k + 4]];
        poly(x, y, r, gx, gy, 1, 0.18, 0.22);
        ctx.fillStyle = rgba(dark, 0.55);
        ctx.fill();
        poly(x, y, r, gx, gy, 1, 0, 0);
        ctx.fillStyle = rgba(light, 0.9);
        ctx.fill();
        ctx.strokeStyle = rgba(PAL.ink, 0.6);
        ctx.lineWidth = 0.06 + hash2(gx, gy, 130) * 0.06;
        ctx.stroke();
        // 갈라진 금 (준법 꺾임)
        ctx.beginPath();
        ctx.moveTo(x - r * 0.3, y - r * 0.4);
        ctx.lineTo(x + r * 0.05, y + r * 0.05);
        ctx.lineTo(x + r * 0.15, y + r * 0.5);
        ctx.strokeStyle = rgba(PAL.ink, 0.45);
        ctx.lineWidth = 0.05;
        ctx.stroke();
      }
    }
    if (!rk.all) {
      this.strokeVar(ctx, seg, lod ? 0.3 : 0.08, lod ? 0.65 : 0.4, PAL.ink, 0.75, 0.9, 0.18);
      if (lod === 0) this.strokeVar(ctx, seg, 0.05, 0.16, PAL.ink2, 0.35, 1.7, 0.5);
    }
  }

  // 길: 가장자리 점선(바깥이 길이 아닐 때만), 바퀴자국
  drawRoads(ctx, x0, y0, x1, y1, lod) {
    const tr = this.tr;
    const STY = {
      main: { col: PAL.ink2, a: 0.55, w: 0.11, rut: [-1.6, -0.8, 0.8, 1.6] },
      road: { col: PAL.ink2, a: 0.48, w: 0.1, rut: [-0.8, 0.8] },
      street: { col: PAL.ink2, a: 0.5, w: 0.1, rut: null },
      path: { col: PAL.ink3, a: 0.5, w: 0.08, rut: null },
    };
    const step = lod ? 2 : 0.85;
    for (const rd of this.roads) {
      if (rd.bb.x1 < x0 || rd.bb.x0 > x1 || rd.bb.y1 < y0 || rd.bb.y0 > y1) continue;
      const sty = STY[rd.kind] || STY.road;
      const w = rd.width;
      const pts = rd.points;
      const edges = [];
      const ruts = [];
      for (let s = 0; s + 1 < pts.length; s++) {
        const ax = pts[s][0], ay = pts[s][1], bx = pts[s + 1][0], by = pts[s + 1][1];
        const pad = w + 2;
        const cl = clipSeg(ax, ay, bx, by, x0 - pad, y0 - pad, x1 + pad, y1 + pad);
        if (!cl) continue;
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 0.01) continue;
        const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
        const kA = Math.max(0, Math.floor((cl[0] * L) / step)), kB = Math.ceil((cl[1] * L) / step);
        for (let k = kA; k <= kB && k * step < L; k++) {
          const d = k * step;
          const px = ax + ux * d, py = ay + uy * d;
          if (!F_ROADCORE[tr.at(px, py)]) continue;
          for (const side of [-1, 1]) {
            const hk = hash2(Math.round(px * 2), Math.round(py * 2), 140 + side);
            if (hk < (rd.kind === 'path' ? 0.45 : 0.22)) continue;
            const off = w / 2 - 0.15 + (texAt(tr.tex2, px * 0.8 + side * 9, py * 0.8) - 0.5) * 0.5;
            const qx = px + nx * side * off, qy = py + ny * side * off;
            const ox = qx + nx * side * 0.7, oy = qy + ny * side * 0.7;
            if (F_ROADISH[tr.at(ox, oy)] || isWaterT(tr.at(ox, oy))) continue;
            const dl = step * (0.45 + hk * 0.5);
            edges.push(qx, qy, qx + ux * dl, qy + uy * dl);
          }
          if (lod === 0 && sty.rut) {
            for (let q = 0; q < sty.rut.length; q++) {
              const o = sty.rut[q] + (texAt(tr.tex, px * 0.5, py * 0.5 + q * 13) - 0.5) * 0.35;
              ruts.push(px + nx * o, py + ny * o, px + nx * o + ux * step * 1.02, py + ny * o + uy * step * 1.02);
            }
          }
        }
      }
      if (ruts.length) {
        ctx.strokeStyle = rgba(PAL.furrow, 0.32);
        ctx.lineWidth = 0.09;
        ctx.beginPath();
        for (let k = 0; k < ruts.length; k += 4) {
          ctx.moveTo(ruts[k], ruts[k + 1]);
          ctx.lineTo(ruts[k + 2], ruts[k + 3]);
        }
        ctx.stroke();
      }
      if (edges.length) {
        ctx.strokeStyle = rgba(sty.col, sty.a);
        ctx.lineWidth = lod ? sty.w * 2.6 : sty.w;
        ctx.beginPath();
        for (let k = 0; k < edges.length; k += 4) {
          ctx.moveTo(edges[k], edges[k + 1]);
          ctx.lineTo(edges[k + 2], edges[k + 3]);
        }
        ctx.stroke();
      }
    }
  }

  // 다리: 널·난간 (작은 내의 돌다리는 돌빛)
  drawBridges(ctx, x0, y0, x1, y1, lod) {
    for (const br of this.bridges) {
      if (br.bb.x1 < x0 || br.bb.x0 > x1 || br.bb.y1 < y0 || br.bb.y0 > y1) continue;
      const pts = br.points, w = br.width;
      const stone = !br.rail && hash2(Math.round(pts[0][0]), Math.round(pts[0][1]), 150) < 0.65;
      const deck = br.rail ? mixHex(PAL.timber, PAL.ink2, 0.35) : stone ? mixHex(PAL.wallStone, PAL.paper, 0.25) : mixHex(PAL.timber, PAL.paper, 0.4);
      for (let s = 0; s + 1 < pts.length; s++) {
        const ax = pts[s][0], ay = pts[s][1], bx = pts[s + 1][0], by = pts[s + 1][1];
        const L = Math.hypot(bx - ax, by - ay);
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        // 그림자
        ctx.fillStyle = 'rgba(30,34,36,0.22)';
        ctx.fillRect(-0.3, -w / 2 + 0.5, L + 0.6, w + 0.4);
        ctx.fillStyle = deck;
        ctx.fillRect(-0.3, -w / 2, L + 0.6, w);
        if (lod === 0) {
          ctx.strokeStyle = rgba(PAL.ink, stone ? 0.18 : 0.28);
          ctx.lineWidth = 0.04;
          ctx.beginPath();
          const gap = stone ? 0.9 : 0.36;
          for (let x = 0; x < L; x += gap) {
            ctx.moveTo(x, -w / 2 + 0.2);
            ctx.lineTo(x, w / 2 - 0.2);
          }
          if (stone) {
            ctx.moveTo(0, 0);
            ctx.lineTo(L, 0);
          }
          ctx.stroke();
        }
        // 난간
        ctx.strokeStyle = rgba(PAL.ink, 0.85);
        ctx.lineWidth = lod ? 0.3 : 0.14;
        ctx.beginPath();
        ctx.moveTo(-0.3, -w / 2 + 0.15);
        ctx.lineTo(L + 0.3, -w / 2 + 0.15);
        ctx.moveTo(-0.3, w / 2 - 0.15);
        ctx.lineTo(L + 0.3, w / 2 - 0.15);
        ctx.stroke();
        if (lod === 0) {
          ctx.fillStyle = rgba(PAL.ink, 0.85);
          for (let x = 0; x <= L + 0.01; x += br.rail ? 1.6 : 2.2) {
            ctx.fillRect(x - 0.12, -w / 2, 0.24, 0.3);
            ctx.fillRect(x - 0.12, w / 2 - 0.3, 0.24, 0.3);
          }
          if (br.rail) {
            // 철교 트러스
            ctx.strokeStyle = rgba(PAL.ink2, 0.5);
            ctx.lineWidth = 0.08;
            ctx.beginPath();
            for (let x = 0; x < L; x += 1.6) {
              ctx.moveTo(x, -w / 2 + 0.15);
              ctx.lineTo(x + 1.6, -w / 2 + 0.6);
              ctx.moveTo(x, w / 2 - 0.15);
              ctx.lineTo(x + 1.6, w / 2 - 0.6);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
  }

  // 부두·나루: 널빤지와 말뚝
  drawPiers(ctx, x0, y0, x1, y1, lod) {
    for (const b of this.tr.piers) {
      const R = Math.hypot(b.w, b.h) / 2 + 1;
      if (b.x + R < x0 || b.x - R > x1 || b.y + R < y0 || b.y - R > y1) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle || 0);
      const hw = b.w / 2, hh = b.h / 2;
      ctx.fillStyle = 'rgba(30,34,36,0.25)';
      ctx.fillRect(-hw + 0.4, -hh + 0.5, b.w, b.h);
      ctx.fillStyle = mixHex(PAL.timber, PAL.paper, 0.56);
      ctx.fillRect(-hw, -hh, b.w, b.h);
      const long = b.w >= b.h;
      if (lod === 0) {
        ctx.strokeStyle = rgba(PAL.ink2, 0.26);
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        if (long)
          for (let x = -hw + 0.4; x < hw; x += 0.4) {
            ctx.moveTo(x, -hh);
            ctx.lineTo(x, hh);
          }
        else
          for (let y = -hh + 0.4; y < hh; y += 0.4) {
            ctx.moveTo(-hw, y);
            ctx.lineTo(hw, y);
          }
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(PAL.ink, 0.8);
      ctx.lineWidth = lod ? 0.3 : 0.1;
      ctx.strokeRect(-hw, -hh, b.w, b.h);
      // 말뚝
      ctx.fillStyle = rgba(PAL.ink, 0.85);
      const n = Math.max(2, Math.round((long ? b.w : b.h) / 3));
      for (let q = 0; q <= n; q++) {
        const t = -0.5 + q / n;
        const px = long ? t * (b.w - 0.4) : 0, py = long ? 0 : t * (b.h - 0.4);
        for (const sd of [-1, 1]) {
          const qx = long ? px : sd * (hw - 0.2), qy = long ? sd * (hh - 0.2) : py;
          ctx.beginPath();
          ctx.arc(qx, qy, lod ? 0.35 : 0.2, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // 철로: 침목 + 레일 (전차는 길에 묻힌 레일만)
  drawRails(ctx, x0, y0, x1, y1, lod) {
    for (const ln of this.rails) {
      if (ln.bb.x1 < x0 || ln.bb.x0 > x1 || ln.bb.y1 < y0 || ln.bb.y0 > y1) continue;
      const pts = ln.points;
      const sl = [];
      const rails = [];
      const g = ln.embedded ? 0.7 : 0.72;
      for (let s = 0; s + 1 < pts.length; s++) {
        const ax = pts[s][0], ay = pts[s][1], bx = pts[s + 1][0], by = pts[s + 1][1];
        const cl = clipSeg(ax, ay, bx, by, x0 - 3, y0 - 3, x1 + 3, y1 + 3);
        if (!cl) continue;
        const L = Math.hypot(bx - ax, by - ay);
        if (L < 0.01) continue;
        const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy, ny = ux;
        const ra = cl[0] * L, rb = cl[1] * L;
        for (const sd of [-1, 1]) rails.push(ax + ux * ra + nx * g * sd, ay + uy * ra + ny * g * sd, ax + ux * rb + nx * g * sd, ay + uy * rb + ny * g * sd);
        if (ln.embedded) continue;
        const gap = lod ? 1.3 : 0.62;
        for (let k = Math.max(0, Math.floor(ra / gap)); k * gap + gap * 0.5 <= rb; k++) {
          const d = k * gap + gap * 0.5;
          const px = ax + ux * d, py = ay + uy * d;
          sl.push(px - nx * 1.2, py - ny * 1.2, px + nx * 1.2, py + ny * 1.2);
        }
      }
      if (sl.length) {
        ctx.strokeStyle = rgba(PAL.sleeper, 0.9);
        ctx.lineWidth = lod ? 0.4 : 0.24;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        for (let k = 0; k < sl.length; k += 4) {
          ctx.moveTo(sl[k], sl[k + 1]);
          ctx.lineTo(sl[k + 2], sl[k + 3]);
        }
        ctx.stroke();
        ctx.lineCap = 'round';
      }
      if (rails.length) {
        ctx.strokeStyle = rgba(ln.embedded ? PAL.ink2 : PAL.rail, ln.embedded ? 0.6 : 0.95);
        ctx.lineWidth = lod ? 0.2 : ln.embedded ? 0.07 : 0.1;
        ctx.beginPath();
        for (let k = 0; k < rails.length; k += 4) {
          ctx.moveTo(rails[k], rails[k + 1]);
          ctx.lineTo(rails[k + 2], rails[k + 3]);
        }
        ctx.stroke();
      }
    }
  }

  // 성벽: 그림자 + 돌 몸체 + 바깥쪽 여장(총안) + 먹선
  drawWalls(ctx, x0, y0, x1, y1, lod) {
    const segs = this.tr.wallSegs;
    const vis = [];
    for (const sg of segs) {
      const pad = sg.thickness + 3;
      if (Math.max(sg.ax, sg.bx) + pad < x0 || Math.min(sg.ax, sg.bx) - pad > x1 || Math.max(sg.ay, sg.by) + pad < y0 || Math.min(sg.ay, sg.by) - pad > y1) continue;
      vis.push(sg);
    }
    if (!vis.length) return;
    const rect = (sg, grow, ox, oy) => {
      const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
      const ux = (sg.bx - sg.ax) / L, uy = (sg.by - sg.ay) / L, nx = -uy, ny = ux;
      const ea = (sg.cutA ? 0 : sg.thickness / 2) + grow, eb = (sg.cutB ? 0 : sg.thickness / 2) + grow;
      const hw = sg.thickness / 2 + grow;
      const ax = sg.ax - ux * ea + ox, ay = sg.ay - uy * ea + oy, bx = sg.bx + ux * eb + ox, by = sg.by + uy * eb + oy;
      ctx.moveTo(ax + nx * hw, ay + ny * hw);
      ctx.lineTo(bx + nx * hw, by + ny * hw);
      ctx.lineTo(bx - nx * hw, by - ny * hw);
      ctx.lineTo(ax - nx * hw, ay - ny * hw);
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(38,34,28,0.2)';
    ctx.beginPath();
    for (const sg of vis) rect(sg, 0.5, 0.9, 1.2);
    ctx.fill();
    ctx.fillStyle = PAL.wallStone;
    ctx.beginPath();
    for (const sg of vis) rect(sg, 0, 0, 0);
    ctx.fill();
    // 돌 쌓은 줄
    if (lod === 0) {
      ctx.strokeStyle = rgba(PAL.ink2, 0.22);
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      for (const sg of vis) {
        const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
        const ux = (sg.bx - sg.ax) / L, uy = (sg.by - sg.ay) / L, nx = -uy, ny = ux;
        const hw = sg.thickness / 2;
        for (const f of [-0.33, 0.33]) {
          ctx.moveTo(sg.ax + nx * hw * f, sg.ay + ny * hw * f);
          ctx.lineTo(sg.bx + nx * hw * f, sg.by + ny * hw * f);
        }
        let row = 0;
        for (const [fa, fb] of [[-1, -0.33], [-0.33, 0.33], [0.33, 1]]) {
          for (let d = row * 0.45; d < L; d += 0.9) {
            const px = sg.ax + ux * d, py = sg.ay + uy * d;
            ctx.moveTo(px + nx * hw * fa, py + ny * hw * fa);
            ctx.lineTo(px + nx * hw * fb, py + ny * hw * fb);
          }
          row++;
        }
      }
      ctx.stroke();
    }
    // 여장: 바깥쪽 띠 + 총안 틈
    const outer = (sg) => {
      const c = this.wallC.get(sg.wall) || { x: 0, y: 0 };
      const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
      const nx = -(sg.by - sg.ay) / L, ny = (sg.bx - sg.ax) / L;
      const mx = (sg.ax + sg.bx) / 2 - c.x, my = (sg.ay + sg.by) / 2 - c.y;
      return mx * nx + my * ny > 0 ? 1 : -1;
    };
    ctx.strokeStyle = rgba(PAL.wallTop, 0.95);
    ctx.lineWidth = lod ? 1 : 0.7;
    ctx.lineCap = 'butt';
    if (lod === 0) ctx.setLineDash([1.25, 0.32]);
    ctx.beginPath();
    for (const sg of vis) {
      const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
      const ux = (sg.bx - sg.ax) / L, uy = (sg.by - sg.ay) / L, nx = -uy, ny = ux;
      const o = (sg.thickness / 2 - 0.35) * outer(sg);
      const ea = sg.cutA ? 0 : sg.thickness / 2, eb = sg.cutB ? 0 : sg.thickness / 2;
      ctx.moveTo(sg.ax - ux * ea + nx * o, sg.ay - uy * ea + ny * o);
      ctx.lineTo(sg.bx + ux * eb + nx * o, sg.by + uy * eb + ny * o);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    // 먹선: 바깥 굵게, 안쪽 가늘게
    for (const pass of [1, -1]) {
      ctx.strokeStyle = rgba(PAL.ink, pass > 0 ? 0.9 : 0.6);
      ctx.lineWidth = (lod ? 2.2 : 1) * (pass > 0 ? 0.16 : 0.08);
      ctx.beginPath();
      for (const sg of vis) {
        const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
        const ux = (sg.bx - sg.ax) / L, uy = (sg.by - sg.ay) / L, nx = -uy, ny = ux;
        const o = (sg.thickness / 2) * outer(sg) * pass;
        const ea = sg.cutA ? 0 : sg.thickness / 2, eb = sg.cutB ? 0 : sg.thickness / 2;
        ctx.moveTo(sg.ax - ux * ea + nx * o, sg.ay - uy * ea + ny * o);
        ctx.lineTo(sg.bx + ux * eb + nx * o, sg.by + uy * eb + ny * o);
        if (sg.cutA) {
          ctx.moveTo(sg.ax + nx * sg.thickness / 2, sg.ay + ny * sg.thickness / 2);
          ctx.lineTo(sg.ax - nx * sg.thickness / 2, sg.ay - ny * sg.thickness / 2);
        }
        if (sg.cutB) {
          ctx.moveTo(sg.bx + nx * sg.thickness / 2, sg.by + ny * sg.thickness / 2);
          ctx.lineTo(sg.bx - nx * sg.thickness / 2, sg.by - ny * sg.thickness / 2);
        }
      }
      ctx.stroke();
    }
  }

  /** 거친 청크·대체 그림용: 나무를 단순한 먹 덩이로 */
  drawTreesSimple(ctx, x0, y0, x1, y1, withInk) {
    const st = this.st;
    if (!st.trees) return;
    if (!this._treeStamp || this._treeStamp.length < st.treeCount) this._treeStamp = new Uint32Array(st.treeCount);
    const stamp = ++this._stampN;
    const TC = st.tcell, tt = st.trees;
    const idx = [];
    for (let cj = Math.floor((y0 - 4) / TC); cj <= Math.floor((y1 + 4) / TC); cj++)
      for (let ci = Math.floor((x0 - 4) / TC); ci <= Math.floor((x1 + 4) / TC); ci++) {
        const list = st.treesInChunk(ci, cj);
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const n = list[k];
          if (this._treeStamp[n] === stamp) continue;
          this._treeStamp[n] = stamp;
          const x = tt[n * 5], y = tt[n * 5 + 1], r = tt[n * 5 + 2];
          if (x + r < x0 || x - r > x1 || y + r < y0 || y - r > y1) continue;
          idx.push(n * 5);
        }
      }
    if (!idx.length) return;
    const pass = (col, a, rs, ox, oy, pine) => {
      ctx.fillStyle = rgba(col, a);
      ctx.beginPath();
      for (const n of idx) {
        if (pine !== undefined && (tt[n + 3] === 0) !== pine) continue;
        const r = tt[n + 2] * rs;
        ctx.moveTo(tt[n] + ox + r, tt[n + 1] + oy);
        ctx.arc(tt[n] + ox, tt[n + 1] + oy, r, 0, TAU);
      }
      ctx.fill();
    };
    pass('#3a4030', 0.16, 0.95, 0.5, 0.6);
    pass(mixHex(PAL.forest, PAL.treeDark, 0.3), 0.8, 0.82, 0, 0, false);
    pass(PAL.pine, 0.82, 0.74, 0, 0, true);
    pass(PAL.treeLight, 0.45, 0.4, -0.5, -0.6);
    if (withInk) {
      ctx.fillStyle = rgba(PAL.ink, 0.4);
      ctx.beginPath();
      for (const n of idx) {
        const r = tt[n + 2];
        for (let q = 0; q < 3; q++) {
          const a = 0.3 + q * 0.9, px = tt[n] + Math.cos(a) * r * 0.5, py = tt[n + 1] + Math.sin(a) * r * 0.5;
          ctx.moveTo(px + r * 0.16, py);
          ctx.arc(px, py, r * 0.16, 0, TAU);
        }
      }
      ctx.fill();
    }
  }

  /** 한지 섬유 덧입힘 (화소 좌표) */
  overlayPaper(ctx, x0, y0, res, px) {
    const P = this.paperTex;
    if (!P) return;
    const S = P.width || 256;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ox = -((((x0 * res) % S) + S) % S), oy = -((((y0 * res) % S) + S) % S);
    for (let y = oy; y < px; y += S) for (let x = ox; x < px; x += S) ctx.drawImage(P, x, y);
    ctx.restore();
  }

  // ---------------------------------------------------------------- 청크

  /** 청크 만들기 작업 (여러 프레임에 나눠 단계별로 그린다) */
  _newJob(tier, ci, cj) {
    return { tier, ci, cj, stage: 0, canvas: null, ms: 0 };
  }

  /** 작업 한 단계. 끝나면 true */
  _stepJob(job) {
    const t0 = now();
    const tier = job.tier, cs = tier.cs, res = tier.res, ci = job.ci, cj = job.cj;
    const x0 = ci * cs, y0 = cj * cs, x1 = x0 + cs, y1 = y0 + cs;
    const px = Math.round(cs * res);
    if (job.stage === 0) {
      const cv = this.pool[tier.id].pop() || makeCanvas(px, px);
      if (!cv) {
        job.failed = true;
        return true;
      }
      job.canvas = cv;
      const ctx = cv.getContext('2d');
      const sc = this.scratch[tier.id];
      const m = tier.marg, step = tier.step;
      this.paintBase(sc.img.data, sc.n, sc.n, x0 - m * step, y0 - m * step, step, tier.jit);
      this.edgePass(sc.img.data, sc.n, sc.n, Math.max(1, Math.round(tier.edge / step)));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (sc.ctx && sc.cv) {
        sc.ctx.putImageData(sc.img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        const k = res * step;
        ctx.drawImage(sc.cv, -m * k, -m * k, sc.n * k, sc.n * k);
      } else {
        ctx.fillStyle = PAL.grass;
        ctx.fillRect(0, 0, px, px);
      }
    } else {
      const ctx = job.canvas.getContext('2d');
      ctx.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const lod = tier.lod;
      try {
        if (job.stage === 1) {
          this.drawWater(ctx, x0, y0, x1, y1, lod);
          this.drawShore(ctx, x0, y0, x1, y1, lod);
          this.drawFields(ctx, x0, y0, x1, y1, lod);
          if (lod === 0) this.drawGrass(ctx, x0, y0, x1, y1);
        } else if (job.stage === 2) {
          this.drawMountains(ctx, x0, y0, x1, y1, lod);
          this.drawRoads(ctx, x0, y0, x1, y1, lod);
          this.drawBridges(ctx, x0, y0, x1, y1, lod);
          this.drawPiers(ctx, x0, y0, x1, y1, lod);
          this.drawRails(ctx, x0, y0, x1, y1, lod);
          this.drawWalls(ctx, x0, y0, x1, y1, lod);
        } else {
          drawBuildingGround(ctx, this.st, x0, y0, x1, y1);
          if (lod === 0) drawTreeShadows(ctx, this.st, ci, cj, x0, y0, x1, y1);
          else this.drawTreesSimple(ctx, x0, y0, x1, y1, true);
          ctx.setLineDash?.([]);
          this.overlayPaper(ctx, x0, y0, res, px);
        }
      } catch (err) {
        console.error('[world render chunk]', err);
      }
      ctx.setLineDash?.([]);
    }
    job.stage++;
    job.ms += now() - t0;
    if (job.stage >= 4) {
      this.buildMs = this.buildMs * 0.7 + job.ms * 0.3;
      this.stats.built++;
      return true;
    }
    return false;
  }

  /** 한 번에 끝까지 (미리 만들기·시험용) */
  buildChunk(tier, ci, cj) {
    const job = this._newJob(tier, ci, cj);
    while (!this._stepJob(job));
    return job.failed ? null : { canvas: job.canvas, tier: tier.id, ci, cj };
  }

  _key(tid, ci, cj) {
    return (tid * 4096 + ci) * 4096 + cj;
  }

  _evict(map, max, pools) {
    while (map.size > max) {
      const k = map.keys().next().value;
      const e = map.get(k);
      map.delete(k);
      if (e?.canvas && pools) pools[e.tier ?? 0]?.push(e.canvas);
    }
  }

  /** GROUND 층 */
  drawGround(ctx, game, view) {
    const fr0 = now();
    const cam = game.camera;
    const zpx = (cam.zoom || 14) * (cam.dpr || 1);
    const tier = zpx >= this.tierSwitch ? this.tiers[0] : this.tiers[1];
    this.curTier = tier.id;
    const cs = tier.cs, W = this.tr.w, H = this.tr.h;
    const ci0 = Math.max(0, Math.floor(view.x0 / cs)), ci1 = Math.min(Math.ceil(W / cs) - 1, Math.floor(view.x1 / cs));
    const cj0 = Math.max(0, Math.floor(view.y0 / cs)), cj1 = Math.min(Math.ceil(H / cs) - 1, Math.floor(view.y1 / cs));
    const eps = 0.8 / zpx;
    const missing = [];
    ctx.imageSmoothingEnabled = true;
    for (let cj = cj0; cj <= cj1; cj++)
      for (let ci = ci0; ci <= ci1; ci++) {
        const k = this._key(tier.id, ci, cj);
        const e = this.cache.get(k);
        if (e) {
          this.cache.delete(k);
          this.cache.set(k, e);
          ctx.drawImage(e.canvas, ci * cs, cj * cs, cs + eps, cs + eps);
        } else missing.push(k);
      }
    const budget = this.frameBudget;
    if (missing.length) {
      const cx = cam.x, cy = cam.y;
      const cen = (k) => [((Math.floor(k / 4096) % 4096) + 0.5) * cs - cx, ((k % 4096) + 0.5) * cs - cy];
      missing.sort((a, b) => Math.hypot(...cen(a)) - Math.hypot(...cen(b)));
      // 가까운 것부터 단계를 진행 (적어도 한 단계는)
      let steps = 0;
      for (const k of missing) {
        let job = this.jobs.get(k);
        if (!job) {
          job = this._newJob(tier, Math.floor(k / 4096) % 4096, k % 4096);
          this.jobs.set(k, job);
        }
        while (steps === 0 || now() - fr0 < budget) {
          steps++;
          if (this._stepJob(job)) {
            this.jobs.delete(k);
            if (!job.failed) this.cache.set(k, { canvas: job.canvas, tier: tier.id, ci: job.ci, cj: job.cj });
            break;
          }
        }
        if (now() - fr0 >= budget) break;
      }
      for (const k of missing) {
        const ci = Math.floor(k / 4096) % 4096, cj = k % 4096;
        const e = this.cache.get(k);
        if (e) ctx.drawImage(e.canvas, ci * cs, cj * cs, cs + eps, cs + eps);
        else this.drawFallback(ctx, tier, ci, cj, eps);
      }
    } else if (now() - fr0 < budget * 0.5) {
      // 여유가 있으면 이동 방향 앞쪽 청크를 한 단계씩 미리
      this.prefetch(tier, view, game, fr0 + budget * 0.6);
    }
    // 오래 버려진 작업 정리
    if (this.jobs.size > 12) {
      for (const [k, j] of this.jobs) {
        if (this.jobs.size <= 8) break;
        if (j.canvas) this.pool[j.tier.id].push(j.canvas);
        this.jobs.delete(k);
      }
    }
    this._evict(this.cache, tier.max + this.tiers[1 - tier.id].max * 0.25, this.pool);
    this.stats.frameMs = now() - fr0;
  }

  prefetch(tier, view, game, until) {
    const cs = tier.cs, W = this.tr.w, H = this.tr.h;
    if (this.cache.size >= tier.max) return;
    const tgt = game.player?.vehicle || game.player;
    const vx = tgt?.vx || 0, vy = tgt?.vy || 0;
    const ax = view.x0 + Math.min(0, vx * 4) - cs * 0.5, bx = view.x1 + Math.max(0, vx * 4) + cs * 0.5;
    const ay = view.y0 + Math.min(0, vy * 4) - cs * 0.5, by = view.y1 + Math.max(0, vy * 4) + cs * 0.5;
    let best = -1, bd = Infinity;
    const cx = (view.x0 + view.x1) / 2 + vx * 3, cy = (view.y0 + view.y1) / 2 + vy * 3;
    for (let cj = Math.max(0, Math.floor(ay / cs)); cj <= Math.min(Math.ceil(H / cs) - 1, Math.floor(by / cs)); cj++)
      for (let ci = Math.max(0, Math.floor(ax / cs)); ci <= Math.min(Math.ceil(W / cs) - 1, Math.floor(bx / cs)); ci++) {
        const k = this._key(tier.id, ci, cj);
        if (this.cache.has(k)) continue;
        const d = Math.hypot((ci + 0.5) * cs - cx, (cj + 0.5) * cs - cy);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
    if (best < 0) return;
    let job = this.jobs.get(best);
    if (!job) {
      job = this._newJob(tier, Math.floor(best / 4096) % 4096, best % 4096);
      this.jobs.set(best, job);
    }
    do {
      if (this._stepJob(job)) {
        this.jobs.delete(best);
        if (!job.failed) this.cache.set(best, { canvas: job.canvas, tier: tier.id, ci: job.ci, cj: job.cj });
        break;
      }
    } while (now() < until);
  }

  /** 아직 없는 청크: 전체 지도 확대 위에, 다른 단계 청크가 있으면 그 조각을 */
  drawFallback(ctx, tier, ci, cj, eps) {
    const cs = tier.cs, x0 = ci * cs, y0 = cj * cs;
    const other = this.tiers[1 - tier.id];
    const ocs = other.cs;
    const parts = [];
    let all = true;
    for (let oj = Math.floor(y0 / ocs); oj <= Math.floor((y0 + cs - 0.01) / ocs); oj++)
      for (let oi = Math.floor(x0 / ocs); oi <= Math.floor((x0 + cs - 0.01) / ocs); oi++) {
        const e = this.cache.get(this._key(other.id, oi, oj));
        if (e) parts.push([oi, oj, e]);
        else all = false;
      }
    if (!all) {
      const mc = this.mapCanvas;
      if (mc) {
        const s = this.mapScale;
        ctx.drawImage(mc, x0 * s, y0 * s, cs * s, cs * s, x0, y0, cs + eps, cs + eps);
      } else {
        ctx.fillStyle = PAL.grass;
        ctx.fillRect(x0, y0, cs + eps, cs + eps);
      }
    }
    const r = other.res;
    for (const [oi, oj, e] of parts) {
      const ax = Math.max(x0, oi * ocs), ay = Math.max(y0, oj * ocs);
      const bx = Math.min(x0 + cs, (oi + 1) * ocs), by = Math.min(y0 + cs, (oj + 1) * ocs);
      ctx.drawImage(e.canvas, (ax - oi * ocs) * r, (ay - oj * ocs) * r, (bx - ax) * r, (by - ay) * r, ax, ay, bx - ax + eps, by - ay + eps);
    }
  }

  // ---------------------------------------------------------------- 물 움직임 (DECAL)

  drawWaterAnim(ctx, game, view) {
    const cam = game.camera;
    const zpx = (cam.zoom || 14) * (cam.dpr || 1);
    if (zpx < 3.5) return;
    const tr = this.tr;
    const vw = view.x1 - view.x0;
    const step = Math.max(5, Math.round(vw / 26));
    if (step !== this._flowStep) {
      this._flowStep = step;
      this._flowCache.clear();
    }
    if (this._flowCache.size > 6000) this._flowCache.clear();
    const t = game.time || 0;
    const P = [[], [], []];
    for (let gy = Math.floor(view.y0 / step); gy <= Math.floor(view.y1 / step); gy++)
      for (let gx = Math.floor(view.x0 / step); gx <= Math.floor(view.x1 / step); gx++) {
        const h = hash2(gx, gy, 913);
        if (h > 0.5) continue;
        const x = (gx + 0.15 + 0.7 * hash2(gx, gy, 914)) * step, y = (gy + 0.15 + 0.7 * hash2(gx, gy, 915)) * step;
        const tt = tr.at(x, y);
        if (tt !== T.SEA && tt !== T.RIVER) continue;
        const ph = (t * (0.16 + h * 0.12) + h * 9.7) % 1;
        const a = Math.sin(ph * Math.PI);
        const b = a > 0.7 ? 2 : a > 0.35 ? 1 : 0;
        if (tt === T.RIVER) {
          const key = gx * 100003 + gy;
          let dir = this._flowCache.get(key);
          if (dir === undefined) {
            const n = tr.riverIndex.nearest(x, y, 160);
            if (n) {
              const sg = n.seg, L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
              dir = [(sg.bx - sg.ax) / L, (sg.by - sg.ay) / L];
            } else dir = null;
            this._flowCache.set(key, dir);
          }
          if (!dir) continue;
          const len = 2 + h * 3, d = (ph - 0.5) * 5;
          const px = x + dir[0] * d, py = y + dir[1] * d;
          P[b].push(0, px - dir[0] * len * 0.5, py - dir[1] * len * 0.5, px - dir[1] * 0.35, py + dir[0] * 0.35, px + dir[0] * len * 0.5, py + dir[1] * len * 0.5);
        } else {
          const rr = 0.8 + h * 1.2, px = x + (ph - 0.5) * 1.5;
          P[b].push(1, px, y, rr, 0, 0, 0);
        }
      }
    const col = mixHex(PAL.seaDeep, PAL.ink, 0.4);
    const A = [0.08, 0.16, 0.26];
    const lw = Math.max(0.06, 1.1 / (cam.zoom || 14));
    for (let b = 0; b < 3; b++) {
      const L = P[b];
      if (!L.length) continue;
      ctx.strokeStyle = rgba(col, A[b]);
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < L.length; k += 7) {
        if (L[k] === 0) {
          ctx.moveTo(L[k + 1], L[k + 2]);
          ctx.quadraticCurveTo(L[k + 3], L[k + 4], L[k + 5], L[k + 6]);
        } else {
          const x = L[k + 1], y = L[k + 2], r = L[k + 3];
          ctx.moveTo(x - r, y);
          ctx.quadraticCurveTo(x, y + r * 0.7, x + r, y);
        }
      }
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- 수관 (HIGH)

  buildCanopy(ci, cj) {
    const st = this.st;
    const list = st.treesInChunk(ci, cj);
    if (!list || !list.length) return { canvas: null, tier: 0 };
    const res = this.CRES, cs = st.tcell, px = Math.round(cs * res);
    const cv = this.canopyPool.pop() || makeCanvas(px, px);
    if (!cv) return { canvas: null, tier: 0 };
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.setTransform(res, 0, 0, res, -ci * cs * res, -cj * cs * res);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    try {
      drawCanopy(ctx, st, ci, cj, ci * cs, cj * cs, (ci + 1) * cs, (cj + 1) * cs);
    } catch (err) {
      console.error('[world canopy]', err);
    }
    this.stats.canopyBuilt++;
    return { canvas: cv, tier: 0 };
  }

  drawCanopyLayer(ctx, game, view) {
    const st = this.st;
    if (!st.trees || this.curTier !== 0) return; // 거친 단계는 땅 청크에 나무를 그렸다
    const t0 = now();
    const cs = st.tcell;
    const ci0 = Math.max(0, Math.floor((view.x0 - 4) / cs)), ci1 = Math.min(st.tccols - 1, Math.floor((view.x1 + 4) / cs));
    const cj0 = Math.max(0, Math.floor((view.y0 - 4) / cs)), cj1 = Math.min(st.tcrows - 1, Math.floor((view.y1 + 4) / cs));
    const cam = game.camera;
    const eps = 0.8 / ((cam.zoom || 14) * (cam.dpr || 1));
    const items = [];
    let built = 0;
    for (let cj = cj0; cj <= cj1; cj++)
      for (let ci = ci0; ci <= ci1; ci++) {
        const k = cj * 4096 + ci;
        let e = this.canopy.get(k);
        if (e) {
          this.canopy.delete(k);
          this.canopy.set(k, e);
        } else if (built < 2 && (built === 0 ? this.stats.frameMs < this.frameBudget : now() - t0 < 2)) {
          e = this.buildCanopy(ci, cj);
          built++;
          this.canopy.set(k, e);
        }
        items.push([ci, cj, e]);
      }
    const drawAll = (filter) => {
      for (const [ci, cj, e] of items) {
        if (filter && !filter(ci, cj)) continue;
        if (e) {
          if (e.canvas) ctx.drawImage(e.canvas, ci * cs, cj * cs, cs + eps, cs + eps);
        } else this.drawTreesSimple(ctx, ci * cs, cj * cs, (ci + 1) * cs, (cj + 1) * cs, false);
      }
    };
    // 플레이어가 수관 아래면 둘레에 구멍
    const tgt = game.player?.vehicle || game.player;
    const under = tgt ? st.underCanopy(tgt.x, tgt.y) || st.underCanopy(tgt.x + 1.2, tgt.y) || st.underCanopy(tgt.x - 1.2, tgt.y) : false;
    const dt = Math.min(0.1, Math.max(0.001, (game.realTime || 0) - (this._lastRT ?? game.realTime ?? 0)));
    this._lastRT = game.realTime || 0;
    this._holeA += ((under ? 1 : 0) - this._holeA) * Math.min(1, dt * 6);
    if (this._holeA < 0.02 || !tgt) drawAll(null);
    else {
      const px = tgt.x, py = tgt.y, R1 = 2.8, R2 = 4.4;
      const near = (ci, cj) => px + R2 > ci * cs && px - R2 < (ci + 1) * cs && py + R2 > cj * cs && py - R2 < (cj + 1) * cs;
      ctx.save();
      ctx.beginPath();
      ctx.rect(view.x0 - 10, view.y0 - 10, view.x1 - view.x0 + 20, view.y1 - view.y0 + 20);
      ctx.arc(px, py, R2, 0, TAU, true);
      ctx.clip();
      drawAll(null);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, R2, 0, TAU);
      ctx.arc(px, py, R1, 0, TAU, true);
      ctx.clip();
      ctx.globalAlpha = 1 - this._holeA * 0.45;
      drawAll(near);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, R1, 0, TAU);
      ctx.clip();
      ctx.globalAlpha = 1 - this._holeA * 0.8;
      drawAll(near);
      ctx.restore();
    }
    // 정리
    while (this.canopy.size > this.canopyMax) {
      const k = this.canopy.keys().next().value;
      const e = this.canopy.get(k);
      this.canopy.delete(k);
      if (e?.canvas) this.canopyPool.push(e.canvas);
    }
  }

  drawRoofs(ctx, game, view) {
    this.roofs.draw(ctx, game, view);
  }

  // ---------------------------------------------------------------- 전체 지도

  /** 전체 지도 캔버스 (scale px/m). 지명 없이 */
  async buildMapCanvas(scale = 0.5, onProgress = () => {}, yieldFn = null) {
    const tr = this.tr;
    const W = Math.ceil(tr.w * scale), H = Math.ceil(tr.h * scale);
    const cv = makeCanvas(W, H);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData?.(W, H) || { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    const step = 1 / scale;
    const band = 120;
    for (let j = 0; j < H; j += band) {
      this.paintBase(img.data, W, H, 0, 0, step, 0, j, Math.min(H, j + band));
      onProgress((j / H) * 0.7);
      if (yieldFn) await yieldFn();
    }
    this.edgePass(img.data, W, H, 1);
    this._tb = null;
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 물가 먹선 (256m 조각씩)
    const T2 = 256;
    for (let y = 0; y < tr.h; y += T2) {
      for (let x = 0; x < tr.w; x += T2) {
        const seg = [];
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, T2, T2);
        ctx.clip();
        const r = this.maskContour(F_WET, x, y, x + T2, y + T2, true, seg);
        if (r && !r.all) this.strokeVar(ctx, seg, 1.6, 3.4, PAL.ink, 0.7, 0.2);
        const s2 = [];
        const rk = this.maskContour(F_ROCK, x, y, x + T2, y + T2, false, s2);
        if (rk && !rk.all) this.strokeVar(ctx, s2, 1.2, 2.4, PAL.ink2, 0.5, 0.3);
        ctx.restore();
      }
      onProgress(0.7 + (y / tr.h) * 0.15);
      if (yieldFn) await yieldFn();
    }
    // 나무: 먹점
    const st = this.st, tt = st.trees;
    if (tt) {
      ctx.fillStyle = rgba(PAL.treeDark, 0.28);
      ctx.beginPath();
      for (let n = 0; n < st.treeCount; n += 2) {
        const x = tt[n * 5], y = tt[n * 5 + 1], r = Math.max(1.6, tt[n * 5 + 2] * 0.8);
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
    }
    // 길
    const RW = { main: [4.2, 0.62], road: [3.2, 0.5], street: [2.6, 0.45], path: [2, 0.32] };
    for (const rd of tr.roads) {
      const [w, a] = RW[rd.kind] || RW.road;
      ctx.strokeStyle = rgba(PAL.ink2, a);
      ctx.lineWidth = w;
      ctx.beginPath();
      rd.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
      ctx.strokeStyle = rgba(PAL.road, 0.85);
      ctx.lineWidth = w * 0.45;
      ctx.stroke();
    }
    // 다리·부두
    ctx.strokeStyle = rgba(PAL.timber, 0.95);
    for (const br of tr.bridges) {
      ctx.lineWidth = Math.max(3, br.width);
      ctx.beginPath();
      br.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();
    }
    for (const b of tr.piers) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle || 0);
      ctx.fillStyle = rgba(PAL.timber, 0.95);
      ctx.fillRect(-b.w / 2, -b.h / 2, Math.max(3, b.w), Math.max(3, b.h));
      ctx.restore();
    }
    // 성벽
    ctx.strokeStyle = rgba(PAL.ink, 0.85);
    ctx.lineWidth = 5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const sg of tr.wallSegs) {
      ctx.moveTo(sg.ax, sg.ay);
      ctx.lineTo(sg.bx, sg.by);
    }
    ctx.stroke();
    // 건물
    for (const b of st.buildings) {
      if (b.roof === 'none') continue;
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      ctx.fillStyle = b.named ? rgba(PAL.ink, 0.85) : rgba(PAL.ink2, 0.62);
      for (const p of b.parts) {
        ctx.save();
        ctx.translate(b.x + p.x * c - p.y * s, b.y + p.x * s + p.y * c);
        ctx.rotate(b.angle);
        ctx.fillRect(-p.w / 2, -p.h / 2, Math.max(2.2, p.w), Math.max(2.2, p.h));
        ctx.restore();
      }
    }
    // 대문 문루 (붉은 점)
    ctx.fillStyle = rgba(PAL.seal, 0.85);
    for (const g of tr.gates) {
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.thickness >= 4 ? 7 : 4.5, 0, TAU);
      ctx.fill();
    }
    // 한지 결
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.paperTex) {
      const S = this.paperTex.width || 256;
      ctx.globalAlpha = 0.6;
      for (let y = 0; y < H; y += S) for (let x = 0; x < W; x += S) ctx.drawImage(this.paperTex, x, y);
      ctx.globalAlpha = 1;
    }
    onProgress(1);
    this.mapCanvas = cv;
    this.mapScale = scale;
    return cv;
  }
}

/** 값싼 2옥타브 노이즈 (텍스처 표본) */
function fbmAtCheap(tex, x, y) {
  return texAt(tex, x * 0.3, y * 0.3) * 0.65 + texAt(tex, x * 0.71 + 13.1, y * 0.71 + 7.3) * 0.35;
}
