// 길찾기: 4m 거친 격자(모드별 통행·비용) + 이진 힙 A* + 시야 기반 경로 다듬기.
// 비용은 지형 속도 배율의 역수(길을 좋아한다). 건물·성벽 solids 도 막는다.

import { T, SPEED } from './terrain.js';

const NAV_MODES = ['foot', 'horse', 'wheel', 'boat'];
const SQ2 = Math.SQRT2;
// 8방향 (dx, dy)
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** 최소 이진 힙 (노드 번호 + 우선순위) */
class Heap {
  constructor(cap = 4096) {
    this.n = new Int32Array(cap);
    this.k = new Float32Array(cap);
    this.size = 0;
  }
  clear() {
    this.size = 0;
  }
  push(node, key) {
    if (this.size >= this.n.length) {
      const n2 = new Int32Array(this.n.length * 2), k2 = new Float32Array(this.k.length * 2);
      n2.set(this.n);
      k2.set(this.k);
      this.n = n2;
      this.k = k2;
    }
    let i = this.size++;
    const N = this.n, K = this.k;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      N[i] = N[p];
      K[i] = K[p];
      i = p;
    }
    N[i] = node;
    K[i] = key;
  }
  pop() {
    const N = this.n, K = this.k;
    const top = N[0];
    const last = --this.size;
    if (last > 0) {
      const node = N[last], key = K[last];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= last) break;
        if (c + 1 < last && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        N[i] = N[c];
        K[i] = K[c];
        i = c;
      }
      N[i] = node;
      K[i] = key;
    }
    return top;
  }
}

export class Nav {
  /** tr: Terrain, st: Structures, cs: 거친 칸 크기(m) */
  constructor(tr, st, cs = 4) {
    this.tr = tr;
    this.st = st;
    this.cs = cs;
    this.k = Math.max(1, Math.round(cs / tr.cell)); // 거친 칸 하나에 지형 칸 k×k
    this.nx = Math.ceil(tr.cols / this.k);
    this.ny = Math.ceil(tr.rows / this.k);
    const N = this.nx * this.ny;
    this.grids = {}; // mode → Uint8Array 비용(0 = 막힘, 10 ≈ 풀밭 1m 당)
    this.comps = {}; // mode → Int32Array 연결 성분 번호
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.mark = new Uint32Array(N); // 탐색 번호*2 (열림) / *2+1 (닫힘)
    this.searchId = 1;
    this.heap = new Heap(8192);
    this.lastFail = '';
    this.stats = { searches: 0, expanded: 0, ms: 0 };
  }

  /** 모드 하나의 격자 만들기 */
  buildMode(mode) {
    const tr = this.tr, k = this.k, nx = this.nx, ny = this.ny, C = tr.cols, R = tr.rows, g = tr.grid;
    const sp = SPEED[mode] || SPEED.foot;
    const bu = tr.bridgeUnder;
    const grid = new Uint8Array(nx * ny);
    const roadBias = mode !== 'boat';
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        let sum = 0, ok = true, road = 0;
        for (let sy = 0; sy < k && ok; sy++) {
          const cy = j * k + sy;
          if (cy >= R) {
            ok = false;
            break;
          }
          for (let sx = 0; sx < k; sx++) {
            const cx = i * k + sx;
            if (cx >= C) {
              ok = false;
              break;
            }
            const idx = cy * C + cx;
            const t = g[idx];
            let v = sp[t];
            if (mode === 'boat') {
              if (t === T.BRIDGE) v = bu.has(idx) ? 1 : 0;
              else if (t === T.PIER) v = 0; // 배는 잔교를 돌아간다 (대는 것은 마지막에)
            }
            if (!(v > 0)) {
              ok = false;
              break;
            }
            sum += 1 / v;
            if (t === T.ROAD || t === T.MAIN_ROAD || t === T.STREET || t === T.BRIDGE) road++;
          }
        }
        if (!ok) continue;
        let c = (sum / (k * k)) * 10;
        if (roadBias && road < (k * k) / 2) c *= 1.15; // 길을 조금 더 좋아하게
        grid[j * nx + i] = Math.max(1, Math.min(250, Math.round(c)));
      }
    // 건물·성벽
    const cs = this.cs;
    for (const s of this.st.solids) {
      if (s.blocks && !s.blocks.includes(mode)) continue;
      const i0 = Math.max(0, Math.floor(s.x0 / cs)), i1 = Math.min(nx - 1, Math.floor(s.x1 / cs));
      const j0 = Math.max(0, Math.floor(s.y0 / cs)), j1 = Math.min(ny - 1, Math.floor(s.y1 / cs));
      const ca = Math.cos(-(s.angle || 0)), sa = Math.sin(-(s.angle || 0));
      const hw = s.w / 2 + 0.6, hh = s.h / 2 + 0.6;
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * cs - s.x, y = (j + 0.5) * cs - s.y;
          const lx = x * ca - y * sa, ly = x * sa + y * ca;
          if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) grid[j * nx + i] = 0;
        }
    }
    this.grids[mode] = grid;
    this.comps[mode] = this.label(grid);
    return grid;
  }

  /** 4방향 연결 성분 번호 (0 = 막힘). 대각 이동은 모서리 자르기 금지라 4방향과 같다 */
  label(grid) {
    const nx = this.nx, ny = this.ny, N = nx * ny;
    const lab = new Int32Array(N);
    const q = this._queue || (this._queue = new Int32Array(N));
    let id = 0;
    for (let s = 0; s < N; s++) {
      if (!grid[s] || lab[s]) continue;
      id++;
      let head = 0, tail = 0;
      q[tail++] = s;
      lab[s] = id;
      while (head < tail) {
        const n = q[head++];
        const x = n % nx;
        if (x > 0 && grid[n - 1] && !lab[n - 1]) (lab[n - 1] = id), (q[tail++] = n - 1);
        if (x < nx - 1 && grid[n + 1] && !lab[n + 1]) (lab[n + 1] = id), (q[tail++] = n + 1);
        if (n >= nx && grid[n - nx] && !lab[n - nx]) (lab[n - nx] = id), (q[tail++] = n - nx);
        if (n + nx < N && grid[n + nx] && !lab[n + nx]) (lab[n + nx] = id), (q[tail++] = n + nx);
      }
    }
    return lab;
  }

  /** 두 점이 같은 모드로 이어진 땅(물)인가 */
  connected(x0, y0, x1, y1, mode = 'foot') {
    const grid = this.gridFor(mode);
    const lab = this.comps[mode === 'swim' ? 'boat' : NAV_MODES.includes(mode) ? mode : 'foot'];
    const a = this.snap(grid, x0, y0), b = this.snap(grid, x1, y1);
    return a >= 0 && b >= 0 && lab[a] === lab[b];
  }

  async build(onProgress = () => {}, yieldFn = null) {
    for (let m = 0; m < NAV_MODES.length; m++) {
      this.buildMode(NAV_MODES[m]);
      onProgress((m + 1) / NAV_MODES.length);
      if (yieldFn) await yieldFn();
    }
  }

  gridFor(mode) {
    if (mode === 'swim') mode = 'boat';
    if (!NAV_MODES.includes(mode)) mode = 'foot';
    return this.grids[mode] || this.buildMode(mode);
  }

  cellOf(x, y) {
    const i = Math.floor(x / this.cs), j = Math.floor(y / this.cs);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }

  /** 막힌 칸이면 가까운 열린 칸으로 (반경 r 칸) */
  snap(grid, x, y, r = 4) {
    const cs = this.cs, nx = this.nx, ny = this.ny;
    const ci = Math.floor(x / cs), cj = Math.floor(y / cs);
    if (ci >= 0 && cj >= 0 && ci < nx && cj < ny && grid[cj * nx + ci]) return cj * nx + ci;
    let best = -1, bd = Infinity;
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny || !grid[j * nx + i]) continue;
        const d = ((i + 0.5) * cs - x) ** 2 + ((j + 0.5) * cs - y) ** 2;
        if (d < bd) {
          bd = d;
          best = j * nx + i;
        }
      }
    return best;
  }

  /**
   * A*. 반환 [[x,y], ...] (처음 = 출발점, 끝 = 도착점) 또는 null.
   * maxNodes: 펼칠 칸 수 상한 (넘으면 null, this.lastFail='limit')
   */
  findPath(x0, y0, x1, y1, mode = 'foot', maxNodes = 6000) {
    if (mode === 'ghost' || mode === 'rail') return [[x0, y0], [x1, y1]];
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const grid = this.gridFor(mode);
    this.lastFail = '';
    const s = this.snap(grid, x0, y0), goal = this.snap(grid, x1, y1);
    if (s < 0 || goal < 0) {
      this.lastFail = s < 0 ? 'start' : 'goal';
      return null;
    }
    const lab = this.comps[mode === 'swim' ? 'boat' : NAV_MODES.includes(mode) ? mode : 'foot'];
    if (lab && lab[s] !== lab[goal]) {
      this.lastFail = 'unreachable';
      return null;
    }
    const nx = this.nx, cs = this.cs;
    const gx = goal % nx, gy = (goal / nx) | 0;
    const goalExact = this.cellOf(x1, y1) === goal;
    if (s === goal) return [[x0, y0], goalExact ? [x1, y1] : [(gx + 0.5) * cs, (gy + 0.5) * cs]];
    // 탐색 번호 (오버플로 대비)
    if (this.searchId > 2e9) {
      this.mark.fill(0);
      this.searchId = 1;
    }
    const id = ++this.searchId;
    const OPEN = id * 2, CLOSED = id * 2 + 1;
    const G = this.g, P = this.parent, M = this.mark, heap = this.heap;
    heap.clear();
    const H = (n) => {
      const dx = Math.abs((n % nx) - gx), dy = Math.abs(((n / nx) | 0) - gy);
      return (dx > dy ? dx + (SQ2 - 1) * dy : dy + (SQ2 - 1) * dx) * 13; // 가중 A* (조금 덜 최적, 훨씬 빠름)
    };
    G[s] = 0;
    P[s] = -1;
    M[s] = OPEN;
    heap.push(s, H(s));
    let expanded = 0, found = false;
    const ny = this.ny;
    while (heap.size) {
      const cur = heap.pop();
      if (M[cur] === CLOSED) continue;
      M[cur] = CLOSED;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxNodes) {
        this.lastFail = 'limit';
        break;
      }
      const cx = cur % nx, cy = (cur / nx) | 0;
      const gc = G[cur];
      for (let d = 0; d < 8; d++) {
        const ex = cx + DX[d], ey = cy + DY[d];
        if (ex < 0 || ey < 0 || ex >= nx || ey >= ny) continue;
        const nb = ey * nx + ex;
        const c = grid[nb];
        if (!c || M[nb] === CLOSED) continue;
        let step;
        if (d >= 4) {
          // 모서리 자르기 금지
          if (!grid[cy * nx + ex] || !grid[ey * nx + cx]) continue;
          step = ((c + grid[cur]) * 0.5) * SQ2;
        } else step = (c + grid[cur]) * 0.5;
        const ng = gc + step;
        if (M[nb] === OPEN && ng >= G[nb]) continue;
        G[nb] = ng;
        P[nb] = cur;
        M[nb] = OPEN;
        heap.push(nb, ng + H(nb));
      }
    }
    this.stats.searches++;
    this.stats.expanded += expanded;
    if (!found) {
      if (!this.lastFail) this.lastFail = 'none';
      this.stats.ms += (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      return null;
    }
    // 되짚기
    const cells = [];
    for (let n = goal; n !== -1; n = P[n]) cells.push(n);
    cells.reverse();
    const smooth = this.smooth(grid, cells);
    const out = [[x0, y0]];
    for (let q = 1; q < smooth.length - 1; q++) {
      const n = smooth[q];
      out.push([((n % nx) + 0.5) * cs, (((n / nx) | 0) + 0.5) * cs]);
    }
    out.push(goalExact ? [x1, y1] : [(gx + 0.5) * cs, (gy + 0.5) * cs]);
    this.stats.ms += (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return out;
  }

  /** 시야 기반 다듬기: 지나는 칸 비용이 원래 경로의 최댓값을 넘지 않을 때만 지름길 */
  smooth(grid, cells) {
    if (cells.length <= 2) return cells;
    const out = [cells[0]];
    let i = 0;
    while (i < cells.length - 1) {
      let maxC = grid[cells[i]];
      let best = i + 1;
      // 너무 멀리 보지 않는다 (긴 경로에서 비용)
      const lim = Math.min(cells.length - 1, i + 40);
      for (let j = i + 1; j <= lim; j++) {
        if (grid[cells[j]] > maxC) maxC = grid[cells[j]];
        if (j === i + 1 || this.los(grid, cells[i], cells[j], maxC)) best = j;
      }
      out.push(cells[best]);
      i = best;
    }
    return out;
  }

  /** 두 칸 중심을 잇는 선이 지나는 칸이 모두 열려 있고 비용 ≤ maxC 인가 (슈퍼커버) */
  los(grid, a, b, maxC = 255) {
    const nx = this.nx;
    let x = a % nx, y = (a / nx) | 0;
    const x1 = b % nx, y1 = (b / nx) | 0;
    const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y);
    const sx = x1 > x ? 1 : -1, sy = y1 > y ? 1 : -1;
    const ok = (i, j) => {
      const c = grid[j * nx + i];
      return c && c <= maxC;
    };
    let ix = 0, iy = 0;
    while (ix < dx || iy < dy) {
      const dec = (1 + 2 * ix) * dy - (1 + 2 * iy) * dx;
      if (dec === 0) {
        // 꼭짓점을 정확히 지남: 양옆 모두 확인
        if (!ok(x + sx, y) || !ok(x, y + sy)) return false;
        x += sx;
        y += sy;
        ix++;
        iy++;
      } else if (dec < 0) {
        x += sx;
        ix++;
      } else {
        y += sy;
        iy++;
      }
      if (!ok(x, y)) return false;
    }
    return true;
  }

  /** (x,y) 의 모드별 거친 칸 비용 (0 = 막힘) */
  costAt(x, y, mode = 'foot') {
    const n = this.cellOf(x, y);
    return n < 0 ? 0 : this.gridFor(mode)[n];
  }
}
