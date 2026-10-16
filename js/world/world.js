// 임시 시험용 월드 (world 담당 에이전트가 실제 지도로 교체한다).
// 계약(API)은 docs/ARCHITECTURE.md 의 'World API' 참고.

import { LAYER } from '../engine/entity.js';

export const T = { GRASS: 1, ROAD: 2, SHALLOW: 3, WATER: 4, FOREST: 5 };

export async function createWorld(game, onProgress = () => {}) {
  const W = 600, H = 400, CELL = 2;
  const cols = W / CELL, rows = H / CELL;
  const grid = new Uint8Array(cols * rows).fill(T.GRASS);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const y = cy * CELL, x = cx * CELL;
      const ry = 260 + Math.sin(x / 40) * 12;
      if (Math.abs(y - ry) < 14) grid[cy * cols + cx] = T.WATER;
      else if (Math.abs(y - ry) < 18) grid[cy * cols + cx] = T.SHALLOW;
      else if (Math.abs(y - 200) < 3) grid[cy * cols + cx] = T.ROAD;
      else if (y < 120 && x > 380) grid[cy * cols + cx] = T.FOREST;
    }
  onProgress(1);
  const solids = [
    { x: 220, y: 180, w: 10, h: 8, angle: 0, kind: 'house' },
    { x: 250, y: 178, w: 12, h: 9, angle: 0.1, kind: 'house' },
  ];
  const terrainAt = (x, y) => {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return 0;
    return grid[cy * cols + cx];
  };
  const world = {
    size: { w: W, h: H },
    spawn: { x: 200, y: 200 },
    places: { start: { x: 200, y: 200, name: '시험 마을' } },
    terrainAt,
    isWater: (x, y) => {
      const t = terrainAt(x, y);
      return t === T.WATER || t === T.SHALLOW;
    },
    isDeepWater: (x, y) => terrainAt(x, y) === T.WATER,
    passable(x, y, mode) {
      const t = terrainAt(x, y);
      if (t === 0) return false;
      switch (mode) {
        case 'boat':
          return t === T.WATER || t === T.SHALLOW;
        case 'swim':
          return true;
        case 'rail':
          return true;
        case 'wheel':
          return t !== T.WATER && t !== T.SHALLOW;
        default:
          return t !== T.WATER;
      }
    },
    speedMul(x, y, mode) {
      const t = terrainAt(x, y);
      if (mode === 'boat' || mode === 'swim' || mode === 'rail') return 1;
      if (t === T.ROAD) return mode === 'wheel' ? 1.15 : 1.05;
      if (t === T.FOREST) return 0.7;
      if (t === T.SHALLOW) return 0.6;
      return mode === 'wheel' ? 0.75 : 1;
    },
    querySolids(x0, y0, x1, y1, out = []) {
      for (const s of solids) if (s.x + 8 > x0 && s.x - 8 < x1 && s.y + 8 > y0 && s.y - 8 < y1) out.push(s);
      return out;
    },
    regionAt: () => ({ id: 'test', name: '시험 마을' }),
    flowAt: (x, y) => (terrainAt(x, y) === T.WATER ? { x: -0.6, y: 0 } : { x: 0, y: 0 }),
    wind: { angle: 0, strength: 0.5 },
  };
  game.world = world;

  const COLORS = { 1: '#cfd3a8', 2: '#d8c9a2', 3: '#a9c3c0', 4: '#6f97a3', 5: '#93a37c' };
  game.addRenderer(LAYER.GROUND, (ctx, g, b) => {
    const x0 = Math.max(0, Math.floor(b.x0 / CELL)), x1 = Math.min(cols - 1, Math.ceil(b.x1 / CELL));
    const y0 = Math.max(0, Math.floor(b.y0 / CELL)), y1 = Math.min(rows - 1, Math.ceil(b.y1 / CELL));
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        ctx.fillStyle = COLORS[grid[cy * cols + cx]] || '#000';
        ctx.fillRect(cx * CELL, cy * CELL, CELL + 0.05, CELL + 0.05);
      }
  });
  game.addRenderer(LAYER.HIGH, (ctx) => {
    for (const s of solids) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.fillStyle = '#5d6670';
      ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
      ctx.restore();
    }
  });
  return world;
}
