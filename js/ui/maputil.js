// 지도·미니맵 공용: 지도 그림(world.mapCanvas, 없으면 지형을 표본 떠서 직접 만든다), 노선, 표식 모으기.

import { PAL } from '../engine/palette.js';
import { hexToRgb, mixHex, rgba } from '../engine/util.js';

let fallback = null; // {world, canvas, scale}

// 지형 enum 이름 → 팔레트 색
const T_COLOR = {
  SEA: 'sea', RIVER: 'river', WATER: 'sea', SHALLOW: 'shallow', MUD: 'mud', SAND: 'sand', GRASS: 'grass', FIELD: 'field',
  PADDY: 'paddy', FOREST: 'forest', MOUNTAIN: 'mountain', ROCK: 'rock', ROAD: 'road', MAIN_ROAD: 'mainRoad', STREET: 'street',
  YARD: 'yard', WALL: 'wallStone', BRIDGE: 'timber', RAIL: 'rail', PIER: 'timber',
};
const NAME_COLOR = {
  바다: 'sea', 강: 'river', '얕은 물': 'shallow', 갯벌: 'mud', 모래: 'sand', 풀밭: 'grass', 밭: 'field', 논: 'paddy', 숲: 'forest',
  산비탈: 'mountain', '바위·벼랑': 'rock', 길: 'road', 큰길: 'mainRoad', 거리: 'street', 마당: 'yard', 성벽: 'wallStone',
  다리: 'timber', 철로: 'rail', '부두·나루': 'timber',
};

function terrainColor(world, t, x, y, tNames) {
  const info = (() => {
    try {
      return world.terrainInfo?.(t) || null;
    } catch (err) {
      return null;
    }
  })();
  if (info?.color) return info.color;
  const byName = info?.name && NAME_COLOR[info.name];
  if (byName) return PAL[byName];
  const key = tNames?.get(t);
  if (key && T_COLOR[key]) return PAL[T_COLOR[key]];
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

/** {canvas, scale(px/m)} 또는 null */
export function getMapImage(game) {
  const w = game.world;
  if (!w) return null;
  if (w.mapCanvas) {
    const sc = w.mapScale || (w.mapCanvas.width || 1) / (w.size?.w || 1);
    return { canvas: w.mapCanvas, scale: sc };
  }
  if (fallback && fallback.world === w) return fallback;
  fallback = buildFallback(w);
  return fallback;
}

function buildFallback(w) {
  const W = w.size?.w || 600, H = w.size?.h || 400;
  const sc = Math.min(1, 480 / Math.max(W, H));
  const cw = Math.max(1, Math.round(W * sc)), ch = Math.max(1, Math.round(H * sc));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d');
  const res = { world: w, canvas: c, scale: sc };
  if (!ctx || typeof w.terrainAt !== 'function') return res;
  const tNames = new Map();
  if (w.T) for (const k of Object.keys(w.T)) tNames.set(w.T[k], k);
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const cache = new Map();
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const x = (px + 0.5) / sc, y = (py + 0.5) / sc;
      let t;
      try {
        t = w.terrainAt(x, y);
      } catch (err) {
        t = -1;
      }
      let rgb = cache.get(t);
      if (!rgb) {
        rgb = hexToRgb(mixHex(terrainColor(w, t, x, y, tNames), PAL.paper, 0.18));
        cache.set(t, rgb);
      }
      // 한지 결: 아주 옅은 얼룩
      const n = ((px * 7349 + py * 1931) % 13) - 6;
      const i = (py * cw + px) * 4;
      d[i] = rgb[0] + n;
      d[i + 1] = rgb[1] + n;
      d[i + 2] = rgb[2] + n * 0.8;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // 건물·성벽 (있으면)
  try {
    const solids = w.querySolids?.(0, 0, W, H, []) || [];
    ctx.fillStyle = rgba(PAL.ink2, 0.75);
    let n = 0;
    for (const s of solids) {
      if (++n > 6000) break;
      ctx.save();
      ctx.translate(s.x * sc, s.y * sc);
      ctx.rotate(s.angle || 0);
      ctx.fillRect((-s.w / 2) * sc, (-s.h / 2) * sc, Math.max(1, s.w * sc), Math.max(1, s.h * sc));
      ctx.restore();
    }
  } catch (err) {
    /* 무시 */
  }
  return res;
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
