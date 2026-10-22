// 월드 조립: 지도 데이터(mapdata) → 지형 격자(terrain) → 건물·나무(structures) → 길찾기(nav) → 렌더러(render).
// ARCHITECTURE.md §4 World API 를 game.world 에 설정하고 GROUND·DECAL·HIGH 렌더러를 등록한다.

import { LAYER } from '../engine/entity.js';
import { MAP } from './mapdata.js';
import { T, TERRAIN, PASS, SPEED, buildTerrain } from './terrain.js';
import { buildStructures } from './structures.js';
import { Nav } from './nav.js';
import { WorldRenderer } from './render.js';
import { PAL } from '../engine/palette.js';
import { closestOnPolyline, polylineCumulative, pointInPolygon, mixHex } from '../engine/util.js';

export { T };

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

// 지형별 지도 색 (UI 지도 대체 그림용)
const T_MAPCOLOR = {
  [T.VOID]: PAL.paperShade, [T.SEA]: PAL.sea, [T.RIVER]: PAL.river, [T.SHALLOW]: PAL.shallow, [T.MUD]: PAL.mud, [T.SAND]: PAL.sand,
  [T.GRASS]: PAL.grass, [T.FIELD]: PAL.field, [T.PADDY]: PAL.paddy, [T.FOREST]: PAL.forest, [T.MOUNTAIN]: PAL.mountain, [T.ROCK]: PAL.rock,
  [T.ROAD]: PAL.road, [T.MAIN_ROAD]: PAL.mainRoad, [T.STREET]: PAL.street, [T.YARD]: PAL.yard, [T.WALL]: PAL.wallStone,
  [T.BRIDGE]: mixHex(PAL.timber, PAL.paper, 0.4), [T.RAIL]: PAL.rail, [T.PIER]: mixHex(PAL.timber, PAL.paper, 0.3),
};

/**
 * 월드를 만들어 game.world 에 넣는다.
 * onProgress(p 0..1, 문구)
 */
export async function createWorld(game, onProgress = () => {}, mapData = MAP) {
  const M = mapData;
  const prog = (a, b) => (p, text) => {
    try {
      onProgress(a + (b - a) * Math.max(0, Math.min(1, p)), text);
    } catch (err) {
      /* 진행 표시 오류는 무시 */
    }
  };

  // ---------------------------------------------------------------- 지형·건물·길찾기
  const tr = await buildTerrain(M, prog(0, 0.55));
  prog(0.55, 0.56)(0, '집을 짓는 중');
  await yieldFrame();
  const st = buildStructures(M, tr);
  prog(0.56, 0.68)(1, '길을 익히는 중');
  await yieldFrame();
  const nav = new Nav(tr, st, 4);
  // 나룻배 자리: 물 건너는 길찾기 간선
  const ferries = (M.ferries || []).map((f) => {
    const L = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
    const fr = { id: f.id, name: f.name, a: { ...f.a }, b: { ...f.b }, from: f.from, to: f.to, fare: f.fare ?? 0, length: L, modes: f.modes || ['foot', 'horse', 'wheel'] };
    nav.addLink(f.a.x, f.a.y, f.b.x, f.b.y, { cost: f.cost ?? L * 3 + 80, modes: fr.modes, data: fr });
    return fr;
  });
  await nav.build(prog(0.68, 0.78), yieldFrame);

  // ---------------------------------------------------------------- 조회 함수
  const W = tr.w, H = tr.h, C = tr.cols, g = tr.grid, inv = 1 / tr.cell, bu = tr.bridgeUnder;
  const idxAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? ((y * inv) | 0) * C + ((x * inv) | 0) : -1);
  const terrainAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? g[((y * inv) | 0) * C + ((x * inv) | 0)] : T.VOID);

  const INFO = TERRAIN.map((t) => Object.freeze({ ...t, color: T_MAPCOLOR[t.id] || PAL.grass }));
  const terrainInfo = (id) => INFO[id] || INFO[T.VOID];

  /** 부두 칸이 물가인가 (배가 댈 수 있는 가장자리) */
  const pierEdge = (x, y) => {
    for (const [dx, dy] of [[2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]]) {
      const t = terrainAt(x + dx, y + dy);
      if (t === T.SEA || t === T.RIVER || t === T.SHALLOW) return true;
    }
    return false;
  };

  function passable(x, y, mode = 'foot') {
    const i = idxAt(x, y);
    if (i < 0) return false;
    const t = g[i];
    if (mode === 'ghost' || mode === 'rail') return t !== T.VOID;
    const p = PASS[mode] || PASS.foot;
    if (p[t]) {
      if (t === T.PIER && mode === 'boat') return pierEdge(x, y);
      return true;
    }
    if (t === T.BRIDGE && (mode === 'boat' || mode === 'swim')) return bu.has(i); // 다리 밑으로 배·헤엄이 지나간다
    return false;
  }

  function speedMul(x, y, mode = 'foot') {
    if (mode === 'swim' || mode === 'rail' || mode === 'ghost') return 1;
    const i = idxAt(x, y);
    if (i < 0) return 0.5;
    let t = g[i];
    if (t === T.BRIDGE && mode === 'boat' && bu.has(i)) t = bu.get(i);
    const v = (SPEED[mode] || SPEED.foot)[t];
    return v > 0 ? v : 0.5;
  }

  const isWater = (x, y) => {
    const t = terrainAt(x, y);
    return t === T.SEA || t === T.RIVER || t === T.SHALLOW;
  };
  const isDeepWater = (x, y) => {
    const t = terrainAt(x, y);
    return t === T.SEA || t === T.RIVER;
  };
  const isRoad = (x, y) => {
    const t = terrainAt(x, y);
    return t === T.ROAD || t === T.MAIN_ROAD || t === T.STREET || t === T.BRIDGE;
  };

  // ---------------------------------------------------------------- 장소·구역·노선
  const places = {};
  for (const p of M.places || []) {
    places[p.id] = { id: p.id, name: p.name, hanja: p.hanja, kind: p.kind, x: p.x, y: p.y, radius: p.radius ?? 30, tags: (p.tags || []).slice() };
  }

  const zones = [];
  for (const z of M.zones || []) zones.push({ ...z, data: z.data || {} });
  for (const f of M.forests || []) {
    zones.push(f.poly ? { id: f.id, kind: 'forest', poly: f.poly, data: { density: f.density, pine: f.pine } } : { id: f.id, kind: 'forest', x: f.x, y: f.y, r: f.r, data: { density: f.density, pine: f.pine } });
  }
  for (const f of M.fields || []) zones.push({ id: f.id, kind: f.kind === 'paddy' ? 'paddy' : 'field', poly: f.poly, data: {} });
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  const inZone = (z, x, y) => (z.poly ? pointInPolygon(x, y, z.poly) : (x - z.x) ** 2 + (y - z.y) ** 2 <= (z.r || 0) ** 2);

  const freeSpot = (x, y, mode) => {
    if (!passable(x, y, mode)) return false;
    if (mode === 'ghost' || mode === 'rail') return true;
    for (const [dx, dy] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) if (!passable(x + dx, y + dy, mode)) return false;
    return !st.solidNear(x, y, 0.6);
  };

  function randomPointInZone(zone, mode = 'foot') {
    const z = typeof zone === 'string' ? zoneById.get(zone) : zone;
    if (!z) return null;
    let x0, y0, x1, y1;
    if (z.poly) {
      x0 = Infinity;
      y0 = Infinity;
      x1 = -Infinity;
      y1 = -Infinity;
      for (const p of z.poly) {
        x0 = Math.min(x0, p[0]);
        y0 = Math.min(y0, p[1]);
        x1 = Math.max(x1, p[0]);
        y1 = Math.max(y1, p[1]);
      }
    } else {
      x0 = z.x - z.r;
      y0 = z.y - z.r;
      x1 = z.x + z.r;
      y1 = z.y + z.r;
    }
    for (let k = 0; k < 120; k++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      if (!inZone(z, x, y)) continue;
      if (freeSpot(x, y, mode)) return { x, y };
    }
    return null;
  }

  function randomPassableNear(x, y, r = 10, mode = 'foot') {
    if (freeSpot(x, y, mode) && r <= 0) return { x, y };
    for (let k = 0; k < 60; k++) {
      const a = Math.random() * Math.PI * 2, d = r * Math.sqrt(Math.random()) * (k < 40 ? 1 : 1.5);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (freeSpot(px, py, mode)) return { x: px, y: py };
    }
    return null;
  }

  const lines = {};
  for (const ln of M.lines || []) {
    const pts = ln.points;
    const cum = polylineCumulative(pts);
    const stops = (ln.stops || []).map((s) => {
      const c = closestOnPolyline(pts, s.x, s.y, cum);
      return { id: s.id, name: s.name, d: c.d, x: c.x, y: c.y, sx: s.x, sy: s.y };
    });
    stops.sort((a, b) => a.d - b.d);
    lines[ln.id] = { id: ln.id, name: ln.name, kind: ln.kind, points: pts, cum, length: cum[cum.length - 1], stops };
  }

  // ---------------------------------------------------------------- 지역 이름·강물
  const regions = M.regions || [];
  const settlements = (M.settlements || []).slice().sort((a, b) => a.r - b.r);
  const REGION_DEFAULT = Object.freeze({ id: 'gyeonggi', name: '경기 들판' });
  const regionObj = new Map();
  const reg = (id, name) => {
    let o = regionObj.get(id);
    if (!o) regionObj.set(id, (o = Object.freeze({ id, name })));
    return o;
  };
  function regionAt(x, y) {
    for (const r of regions) {
      if (r.poly ? pointInPolygon(x, y, r.poly) : (x - r.x) ** 2 + (y - r.y) ** 2 <= (r.r || 0) ** 2) return reg(r.id, r.name);
    }
    for (const s of settlements) if ((x - s.x) ** 2 + (y - s.y) ** 2 <= s.r * s.r) return reg(s.id, s.name);
    const t = terrainAt(x, y);
    if (t === T.SEA) return reg('sea', '서해 바다');
    if (t === T.RIVER || t === T.SHALLOW) {
      const n = tr.riverIndex.nearest(x, y, 160);
      if (n?.seg?.river?.name) return reg('river_' + n.seg.river.id, n.seg.river.name);
    }
    if (t === T.MUD) return reg('mudflat', '갯벌');
    let best = null, bd = Infinity;
    for (const m of M.mountains || []) {
      const d = Math.hypot(x - m.x, y - m.y) / m.r;
      if (d < 0.9 && d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) return reg('mt_' + best.id, best.name);
    return REGION_DEFAULT;
  }

  function flowAt(x, y) {
    const t = terrainAt(x, y);
    if (t !== T.RIVER && t !== T.SHALLOW && t !== T.BRIDGE) return { x: 0, y: 0 };
    const n = tr.riverIndex.nearest(x, y, 200);
    if (!n) return { x: 0, y: 0 };
    const sg = n.seg;
    const half = (sg.wa + (sg.wb - sg.wa) * n.t) * 0.5 + sg.shallow;
    if (half <= 0) return { x: 0, y: 0 };
    const k = 1 - (n.dist / half) ** 2;
    if (k <= 0) return { x: 0, y: 0 };
    const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
    const v = 0.7 * k;
    return { x: ((sg.bx - sg.ax) / L) * v, y: ((sg.by - sg.ay) / L) * v };
  }

  function nearestRoadPoint(x, y, maxR = 800) {
    const n = tr.roadIndex.nearest(x, y, maxR);
    return n ? { x: n.x, y: n.y, dist: n.dist, road: n.seg.road?.id } : null;
  }

  // ---------------------------------------------------------------- 시작 위치
  let spawn = { x: M.spawn?.x ?? W / 2, y: M.spawn?.y ?? H / 2 };
  if (!freeSpot(spawn.x, spawn.y, 'foot')) spawn = randomPassableNear(spawn.x, spawn.y, 30, 'foot') || spawn;

  // ---------------------------------------------------------------- 렌더러·전체 지도
  const world = {
    size: { w: W, h: H },
    spawn,
    T,
    terrainAt,
    terrainInfo,
    passable,
    speedMul,
    isWater,
    isDeepWater,
    isRoad,
    querySolids: (x0, y0, x1, y1, out = []) => st.querySolids(x0, y0, x1, y1, out),
    buildings: st.buildings,
    places,
    zones,
    randomPointInZone,
    lines,
    regionAt,
    flowAt,
    findPath: (x0, y0, x1, y1, mode = 'foot', maxNodes = 6000) => nav.findPath(x0, y0, x1, y1, mode, maxNodes),
    randomPassableNear,
    nearestRoadPoint,
    mapCanvas: null,
    mapScale: 0.5,
    wind: { angle: Math.PI * 0.2, strength: 0.4 },
    // 덤 (계약 밖, 있으면 쓰는 것)
    heightAt: (x, y) => tr.heightAt(x, y),
    underCanopy: (x, y) => st.underCanopy(x, y),
    buildingAt(x, y, r = 0) {
      for (const b of st.queryBuildings(x - r - 1, y - r - 1, x + r + 1, y + r + 1, [])) if (st.underRoof(b, x, y, r)) return b;
      return null;
    },
    ferries,
    gates: tr.gates,
    walls: tr.walls,
    rivers: tr.rivers,
    roads: tr.roads,
    terrain: tr,
    structures: st,
    nav,
    map: M,
  };
  game.world = world;

  const rnd = new WorldRenderer(tr, st, M, world);
  world.renderer = rnd;
  await rnd.buildMapCanvas(0.5, (p) => prog(0.78, 0.98)(p, '지도를 그리는 중'), yieldFrame);
  world.mapCanvas = rnd.mapCanvas;
  world.mapScale = rnd.mapScale;

  game.addRenderer(LAYER.GROUND, (ctx, gm, view) => rnd.drawGround(ctx, gm, view), 0);
  game.addRenderer(LAYER.DECAL, (ctx, gm, view) => rnd.drawWaterAnim(ctx, gm, view), -100);
  game.addRenderer(LAYER.HIGH, (ctx, gm, view) => rnd.drawRoofs(ctx, gm, view), 0);
  game.addRenderer(LAYER.HIGH, (ctx, gm, view) => rnd.drawCanopyLayer(ctx, gm, view), 10);

  prog(0, 1)(1, '');
  return world;
}
