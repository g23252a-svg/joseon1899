// 지도·미니맵 공용: 지도 그림(world.mapCanvas, 없으면 지형을 표본 떠서 조금씩 직접 만든다),
// 미니맵용 '가까운 곳' 고해상도 그림, 노선, 표식 모으기.

import { PAL } from '../engine/palette.js';
import { hexToRgb, mixHex, rgba } from '../engine/util.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// 지형 enum 이름 → 팔레트 색
const T_COLOR = {
  VOID: 'paperShade', SEA: 'sea', RIVER: 'river', WATER: 'sea', SHALLOW: 'shallow', MUD: 'mud', SAND: 'sand', GRASS: 'grass',
  FIELD: 'field', PADDY: 'paddy', FOREST: 'forest', MOUNTAIN: 'mountain', ROCK: 'rock', ROAD: 'road', MAIN_ROAD: 'mainRoad',
  STREET: 'street', YARD: 'yard', WALL: 'wallStone', BRIDGE: 'timber', RAIL: 'rail', PIER: 'timber',
};
const NAME_COLOR = {
  바다: 'sea', 강: 'river', '얕은 물': 'shallow', 갯벌: 'mud', 모래: 'sand', 풀밭: 'grass', 밭: 'field', 논: 'paddy', 숲: 'forest',
  산비탈: 'mountain', '바위·벼랑': 'rock', 길: 'road', 큰길: 'mainRoad', 거리: 'street', 마당: 'yard', 성벽: 'wallStone',
  다리: 'timber', 철로: 'rail', '부두·나루': 'timber', '지도 밖': 'paperShade',
};
// 길은 지도에서 조금 더 또렷하게
const ROADISH = new Set(['road', 'mainRoad', 'street', 'timber']);

function terrainColor(world, t, x, y, tNames) {
  let info = null;
  try {
    info = world.terrainInfo?.(t) || null;
  } catch (err) {
    info = null;
  }
  // mixHex/hexToRgb 는 #rgb·#rrggbb 만 읽는다 (rgba() 등이면 검게 나오므로 이름으로 고른다)
  if (typeof info?.color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(info.color)) return info.color;
  const key = (info?.key && T_COLOR[info.key]) || (info?.name && NAME_COLOR[info.name]) || T_COLOR[tNames?.get(t)];
  if (key) return ROADISH.has(key) ? mixHex(PAL[key], PAL.ink2, 0.18) : PAL[key];
  try {
    if (world.isDeepWater?.(x, y)) return PAL.sea;
    if (world.isWater?.(x, y)) return PAL.shallow;
    if (world.isRoad?.(x, y)) return PAL.road;
    if (world.passable && !world.passable(x, y, 'foot')) return PAL.rock;
  } catch (err) {
    /* 무시 */
  }
  return PAL.grass;
}

/** 지형 id → [r,g,b] (한지에 스민 색). 월드마다 캐시 */
function makeColorFn(w) {
  const tNames = new Map();
  if (w.T) for (const k of Object.keys(w.T)) tNames.set(w.T[k], k);
  const lut = []; // 정수 지형 id → [r,g,b] (빠른 길)
  const cache = new Map(); // 그 밖의 값
  return (t, x, y) => {
    // 지형 id 가 같으면 물·길 판정도 같으므로 id 로 캐시한다
    const small = t >= 0 && t < 256 && (t | 0) === t;
    let rgb = small ? lut[t] : cache.get(t);
    if (!rgb) {
      rgb = hexToRgb(mixHex(terrainColor(w, t, x, y, tNames), PAL.paper, 0.16));
      if (small) lut[t] = rgb;
      else cache.set(t, rgb);
    }
    return rgb;
  };
}

function sampleT(w, x, y) {
  try {
    return w.terrainAt(x, y);
  } catch (err) {
    return -1;
  }
}

function drawSolids(ctx, w, x0, y0, x1, y1, ox, oy, sc, max = 6000) {
  try {
    const solids = w.querySolids?.(x0, y0, x1, y1, []) || [];
    let n = 0;
    for (const s of solids) {
      if (!s || ++n > max) break;
      ctx.save();
      ctx.translate((s.x - ox) * sc, (s.y - oy) * sc);
      ctx.rotate(s.angle || 0);
      const isWall = s.kind === 'wall' || s.kind === 'gate';
      ctx.fillStyle = isWall ? rgba(PAL.ink, 0.8) : rgba(PAL.ink2, 0.72);
      ctx.fillRect((-s.w / 2) * sc, (-s.h / 2) * sc, Math.max(1, s.w * sc), Math.max(1, s.h * sc));
      ctx.restore();
    }
  } catch (err) {
    /* 무시 */
  }
}

// ---------------------------------------------------------------- 전체 지도 (대체 그림, 조금씩 만든다)

let fallback = null; // {world, canvas, scale, ctx, img, row, done, color}

/** {canvas, scale(px/m), done} 또는 null. world.mapCanvas 가 있으면 그것 */
export function getMapImage(game, budgetMs = 6) {
  const w = game.world;
  if (!w) return null;
  if (w.mapCanvas) {
    const sc = w.mapScale || (w.mapCanvas.width || 1) / (w.size?.w || 1);
    return { canvas: w.mapCanvas, scale: sc, done: true };
  }
  if (!fallback || fallback.world !== w) fallback = startFallback(w);
  if (!fallback.done) stepFallback(fallback, budgetMs);
  return fallback;
}

/** 지도 그림을 미리 조금씩 만들어 둔다 (HUD 가 매 프레임 부름) */
export function warmMapImage(game, budgetMs = 1.5) {
  const w = game.world;
  if (!w || w.mapCanvas) return;
  if (fallback?.world === w && fallback.done) return;
  getMapImage(game, budgetMs);
}

function startFallback(w) {
  const W = w.size?.w || 600, H = w.size?.h || 400;
  const sc = Math.min(1, 1100 / Math.max(W, H));
  const cw = Math.max(1, Math.round(W * sc)), ch = Math.max(1, Math.round(H * sc));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  const res = { world: w, canvas: c, scale: sc, ctx, img: null, row: 0, done: false, color: makeColorFn(w), cw, ch };
  if (!ctx || typeof w.terrainAt !== 'function') {
    res.done = true;
    return res;
  }
  ctx.fillStyle = PAL.paperDeep;
  ctx.fillRect(0, 0, cw, ch);
  res.img = ctx.createImageData(cw, 1);
  return res;
}

function stepFallback(f, budgetMs) {
  const { world: w, ctx, cw, ch, scale: sc } = f;
  const t0 = now();
  const d = f.img.data;
  while (f.row < ch) {
    const py = f.row;
    for (let px = 0; px < cw; px++) {
      const x = (px + 0.5) / sc, y = (py + 0.5) / sc;
      const rgb = f.color(sampleT(w, x, y), x, y);
      const n = ((px * 7349 + py * 1931) % 13) - 6; // 한지 결
      const i = px * 4;
      d[i] = rgb[0] + n;
      d[i + 1] = rgb[1] + n;
      d[i + 2] = rgb[2] + n * 0.8;
      d[i + 3] = 255;
    }
    ctx.putImageData(f.img, 0, py);
    f.row++;
    if (now() - t0 > budgetMs) return;
  }
  // 다 그렸으면 건물·성벽을 먹으로
  drawSolids(ctx, w, 0, 0, w.size?.w || 600, w.size?.h || 400, 0, 0, sc, 8000);
  f.done = true;
  f.img = null;
}

// ---------------------------------------------------------------- 미니맵용 가까운 곳 그림
// 앞·뒤 두 장을 번갈아 쓴다. 움직이면 뒷장을 몇 프레임에 걸쳐 조금씩 그리고, 다 되면 바꿔 단다(프레임 끊김 없음).

const LOCAL_R = [110, 170, 260, 400, 620];
const LOCAL_N = 144; // 한 변 px
let local = null; // {world, color, front, back, job}

function makeSheet() {
  const c = document.createElement('canvas');
  c.width = c.height = LOCAL_N;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  return { canvas: c, ctx, img: ctx.createImageData(LOCAL_N, LOCAL_N), cx: NaN, cy: NaN, R: 0, x0: 0, y0: 0, scale: 1, ok: false };
}

/**
 * (cx, cy) 둘레 반경 radius(m) 를 덮는 고해상도 지형 그림.
 * 반환: {canvas, x0, y0, scale(px/m)} | null
 */
export function getLocalMap(game, cx, cy, radius, budgetMs = 1.5) {
  const w = game.world;
  if (!w || typeof w.terrainAt !== 'function') return null;
  const need = radius * 1.3;
  const R = LOCAL_R.find((r) => r >= need) ?? LOCAL_R[LOCAL_R.length - 1];
  if (!local || local.world !== w) {
    const front = makeSheet(), back = makeSheet();
    if (!front || !back) return null;
    local = { world: w, color: makeColorFn(w), front, back, job: null };
  }
  const L = local, F = L.front;
  const moved = Math.max(Math.abs(cx - F.cx), Math.abs(cy - F.cy));
  // 앞장이 지금 보이는 범위를 못 덮으면 바로 다 그린다
  const covers = F.ok && F.R >= R && moved + radius <= F.R * 0.98;
  if (!covers) {
    L.job = null;
    beginSheet(F, cx, cy, R);
    renderRows(L, F, w, Infinity);
    return F;
  }
  // 앞장이 괜찮으면 필요할 때만 뒷장을 조금씩
  if (F.R !== R || moved > R * 0.12) {
    if (!L.job || L.job.R !== R) {
      beginSheet(L.back, cx, cy, R);
      L.job = { R };
    }
    if (renderRows(L, L.back, w, budgetMs)) {
      L.front = L.back;
      L.back = F;
      L.job = null;
    }
  }
  return L.front;
}

function beginSheet(S, cx, cy, R) {
  const sc = LOCAL_N / (2 * R), step = 1 / sc;
  // 격자에 맞춰 붙여서 다시 그릴 때 얼룩이 흔들리지 않게
  S.cx = Math.round(cx / step) * step;
  S.cy = Math.round(cy / step) * step;
  S.R = R;
  S.scale = sc;
  S.x0 = S.cx - R;
  S.y0 = S.cy - R;
  S.row = 0;
  S.ok = false;
}

/** 줄 단위로 그린다. 다 그렸으면 true */
function renderRows(L, S, w, budgetMs) {
  const N = LOCAL_N, step = 1 / S.scale, d = S.img.data;
  const t0 = budgetMs === Infinity ? 0 : now();
  while (S.row < N) {
    const py = S.row++;
    const y = S.y0 + (py + 0.5) * step;
    const gy = Math.round(y / step);
    for (let px = 0; px < N; px++) {
      const x = S.x0 + (px + 0.5) * step;
      const rgb = L.color(sampleT(w, x, y), x, y);
      const gx = Math.round(x / step);
      const n = ((((gx * 7349 + gy * 1931) % 11) + 11) % 11) - 5;
      const i = (py * N + px) * 4;
      d[i] = rgb[0] + n;
      d[i + 1] = rgb[1] + n;
      d[i + 2] = rgb[2] + n * 0.8;
      d[i + 3] = 255;
    }
    if (budgetMs !== Infinity && (py & 7) === 7 && now() - t0 > budgetMs) return false;
  }
  S.ctx.putImageData(S.img, 0, 0);
  drawSolids(S.ctx, w, S.x0, S.y0, S.x0 + 2 * S.R, S.y0 + 2 * S.R, S.x0, S.y0, S.scale, 1500);
  S.ok = true;
  return true;
}

/** 원본 사각형이 그림 밖으로 나가도 안전하게 그리기 (브라우저마다 다른 동작 회피) */
export function drawImageClipped(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
  const iw = img.width || 0, ih = img.height || 0;
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
  const x1 = Math.min(iw, sx + sw), y1 = Math.min(ih, sy + sh);
  if (!(x1 > x0 && y1 > y0) || !sw || !sh) return;
  const kx = dw / sw, ky = dh / sh;
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, dx + (x0 - sx) * kx, dy + (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky);
}

/** world.lines 를 배열로 */
export function lineList(world) {
  const L = world?.lines;
  if (!L) return [];
  const arr = Array.isArray(L) ? L : Object.values(L);
  return arr.filter((l) => l && Array.isArray(l.points) && l.points.length > 1);
}

/** 노선 그리기. tf(x,y) → [sx, sy] */
export function drawLines(ctx, world, tf, opts = {}) {
  const lines = lineList(world);
  if (!lines.length) return;
  const { alpha = 0.55, width = 2, stops = false, stopR = 3 } = opts;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const l of lines) {
    const water = l.kind === 'water' || l.id === 'steamer';
    ctx.beginPath();
    for (let i = 0; i < l.points.length; i++) {
      const [sx, sy] = tf(l.points[i][0], l.points[i][1]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    if (water) {
      ctx.setLineDash([width * 2.5, width * 2.5]);
      ctx.strokeStyle = rgba(mixHex(PAL.seaDeep, PAL.night, 0.4), alpha);
      ctx.lineWidth = width;
      ctx.stroke();
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(PAL.ink, alpha);
      ctx.lineWidth = width * 1.6;
      ctx.stroke();
      // 침목 느낌: 종이색 점선
      ctx.setLineDash([width * 1.2, width * 2.2]);
      ctx.strokeStyle = rgba(PAL.paper, alpha * 0.9);
      ctx.lineWidth = width * 0.7;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (stops && Array.isArray(l.stops)) {
      for (const s of l.stops) {
        if (typeof s.x !== 'number') continue;
        const [sx, sy] = tf(s.x, s.y);
        ctx.beginPath();
        ctx.arc(sx, sy, stopR, 0, Math.PI * 2);
        ctx.fillStyle = PAL.paper;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = PAL.ink;
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** 미션 표식 + 시작 가능한 미션 (같은 자리는 하나로) */
export function collectMarkers(game) {
  const out = [];
  const m = game.sys.missions;
  try {
    const mk = m?.markers?.();
    if (Array.isArray(mk)) for (const k of mk) if (k && typeof k.x === 'number' && typeof k.y === 'number') out.push(k);
  } catch (err) {
    /* 상대 모듈 오류 무시 */
  }
  try {
    const av = m?.available?.();
    if (Array.isArray(av)) {
      for (const a of av) {
        if (!a || typeof a.x !== 'number') continue;
        if (out.some((k) => Math.abs(k.x - a.x) < 3 && Math.abs(k.y - a.y) < 3)) continue;
        out.push({ x: a.x, y: a.y, kind: 'mission', label: a.title || '' });
      }
    }
  } catch (err) {
    /* 무시 */
  }
  return out;
}

export function placeList(world) {
  const P = world?.places;
  if (!P) return [];
  const arr = Array.isArray(P) ? P : Object.keys(P).map((k) => ({ id: k, ...P[k] }));
  return arr.filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number' && p.name);
}
