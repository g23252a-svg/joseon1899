// 월드 조립: 지도 데이터(mapdata) → 지형 격자(terrain) → 건물·나무(structures) → 길찾기(nav) → 렌더러(render).
// ARCHITECTURE.md §4 World API 를 game.world 에 설정하고 GROUND·DECAL·HIGH 렌더러를 등록한다.
// §10 추가분: regions[].wanted, zones[].ref, world.setMapState(flag, on) (스펙 A.6).

import { LAYER } from '../engine/entity.js';
import { MAP } from './mapdata.js';
import { T, TERRAIN, PASS, SPEED, EDGE_BAND, inEdgeBand, buildTerrain } from './terrain.js';
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
  [T.BRIDGE]: mixHex(PAL.timber, PAL.paper, 0.4), [T.RAIL]: PAL.rail, [T.PIER]: mixHex(PAL.timber, PAL.paper, 0.3), [T.REED]: PAL.reed,
};

// ---------------------------------------------------------------- 지도 데이터 정리 (ref·rect → poly)

const shapeOf = (v) => (v.poly ? { poly: v.poly } : v.points ? { poly: v.points } : v.r ? { x: v.x, y: v.y, r: v.r } : null);
/** 'sands[0]', 'walls.gyeongbok_wall', 'forests.f_goyang' → {poly}|{x,y,r}|null */
export function resolveRef(M, ref) {
  let m = /^(\w+)\[(\d+)\]$/.exec(ref || '');
  if (m) {
    const v = M[m[1]]?.[+m[2]];
    return Array.isArray(v) ? { poly: v } : v ? shapeOf(v) : null;
  }
  m = /^(\w+)\.(.+)$/.exec(ref || '');
  const v = m && (M[m[1]] || []).find((o) => o.id === m[2]);
  return v ? shapeOf(v) : null;
}
function normalizeArea(M, a) {
  if (a.poly || a.r) return a;
  if (a.rect) {
    const [x0, y0, x1, y1] = a.rect;
    return { ...a, poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] };
  }
  const s = a.ref ? resolveRef(M, a.ref) : null;
  if (a.ref && !s) console.warn('[world] 찾을 수 없는 ref:', a.id, a.ref);
  return s ? { ...a, ...s } : a;
}
/** zones·regions 의 ref(다른 필드 다각형)·rect 를 풀어 둔 지도 사본 */
export function normalizeMap(M) {
  return { ...M, zones: (M.zones || []).map((z) => normalizeArea(M, z)), regions: (M.regions || []).map((r) => normalizeArea(M, r)) };
}

// 스펙 A.6 지도 상태 플래그 (새 게임 = 철로 공사 중)
const MAP_FLAGS = ['rail_construction', 'rail_trial', 'rail_open', 'tram_suspended', 'tram_resumed'];
const DEFAULT_STATE = { rail_construction: true, rail_trial: false, rail_open: false, tram_suspended: false, tram_resumed: false };

/**
 * 월드를 만들어 game.world 에 넣는다.
 * onProgress(p 0..1, 문구)
 */
export async function createWorld(game, onProgress = () => {}, mapData = MAP) {
  const M = normalizeMap(mapData);
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
    const fr = { id: f.id, name: f.name, kind: f.kind, period: f.period, a: { ...f.a }, b: { ...f.b }, from: f.from, to: f.to, fare: f.fare ?? 0, length: L, modes: f.modes || ['foot', 'horse', 'wheel'] };
    nav.addLink(f.a.x, f.a.y, f.b.x, f.b.y, { cost: f.cost ?? L * 3 + 80, modes: fr.modes, data: fr });
    return fr;
  });
  await nav.build(prog(0.68, 0.78), yieldFrame);

  // ---------------------------------------------------------------- 조회 함수
  const W = tr.w, H = tr.h, C = tr.cols, g = tr.grid, inv = 1 / tr.cell, bu = tr.bridgeUnder, cn = tr.cn;
  const idxAt = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? ((y * inv) | 0) * C + ((x * inv) | 0) : -1);
  // 가장자리 띠(A.1): 그림은 종이로 번지고 지나갈 수 없다
  const band = (x, y, i) => (x < EDGE_BAND || y < EDGE_BAND || x > W - EDGE_BAND || y > H - EDGE_BAND) && inEdgeBand(x, y, W, H, cn[i]);
  const terrainAt = (x, y) => {
    const i = idxAt(x, y);
    return i < 0 || band(x, y, i) ? T.VOID : g[i];
  };

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
    if (i < 0 || band(x, y, i)) return false;
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

  // 노선: 정차점은 선 위로 붙이고 d 를 다시 잰다. A.4 부가 데이터(slow, marks, sidings…)는 그대로 넘긴다
  const lines = {};
  for (const ln of M.lines || []) {
    const pts = ln.points;
    const cum = polylineCumulative(pts);
    const stops = (ln.stops || []).map((s) => {
      const c = closestOnPolyline(pts, s.x, s.y, cum);
      return { ...s, d: c.d, x: c.x, y: c.y, sx: s.x, sy: s.y };
    });
    stops.sort((a, b) => a.d - b.d);
    lines[ln.id] = { ...ln, id: ln.id, name: ln.name, kind: ln.kind, points: pts, cum, length: cum[cum.length - 1], stops };
  }

  // ---------------------------------------------------------------- 지역 이름(+수배 지역)·강물
  const regions = M.regions || [];
  const settlements = (M.settlements || []).slice().sort((a, b) => a.r - b.r);
  const regionObj = new Map();
  const reg = (id, name, wanted) => {
    let o = regionObj.get(id);
    if (!o) regionObj.set(id, (o = Object.freeze({ id, name, wanted: wanted || 'gyeongin' })));
    return o;
  };
  // 어디에도 안 들면 「경기 들판」(gyeongin), 강 칸 gyeonggang, 바다 칸 「서해」(jemulpo)
  const REGION_DEFAULT = reg('gyeonggi', '경기 들판', 'gyeongin');
  function regionAt(x, y) {
    for (const r of regions) {
      if (r.poly ? pointInPolygon(x, y, r.poly) : (x - r.x) ** 2 + (y - r.y) ** 2 <= (r.r || 0) ** 2) return reg(r.id, r.name, r.wanted);
    }
    for (const s of settlements) if ((x - s.x) ** 2 + (y - s.y) ** 2 <= s.r * s.r) return reg(s.id, s.name, s.wanted);
    const t = terrainAt(x, y);
    if (t === T.SEA) return reg('sea', '서해', 'jemulpo');
    if (t === T.RIVER || t === T.SHALLOW || t === T.REED) {
      const n = tr.riverIndex.nearest(x, y, 160);
      if (n?.seg?.river?.name) return reg('river_' + n.seg.river.id, n.seg.river.name, 'gyeonggang');
    }
    if (t === T.MUD) return reg('mudflat', '갯벌', 'jemulpo');
    let best = null, bd = Infinity;
    for (const m of M.mountains || []) {
      const d = Math.hypot(x - m.x, y - m.y) / m.r;
      if (d < 0.9 && d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) return reg('mt_' + best.id, best.name, 'gyeongin');
    return REGION_DEFAULT;
  }

  // 물살 (A.4): 한강 깊은 물 0.5, 얕은 물 0.2, 지류 0.3 m/s, 하류 방향
  const FLOW = { main: 'han', deep: 0.5, shallow: 0.2, tributary: 0.3, ...(M.flow || {}) };
  const ZERO = Object.freeze({ x: 0, y: 0 });
  function flowAt(x, y) {
    const i = idxAt(x, y);
    if (i < 0) return { x: 0, y: 0 };
    let t = g[i];
    if (t === T.BRIDGE) t = bu.get(i) ?? T.VOID;
    if (t !== T.RIVER && t !== T.SHALLOW) return { ...ZERO };
    const n = tr.riverIndex.nearest(x, y, 200);
    if (!n) return { ...ZERO };
    const sg = n.seg;
    if (n.dist > (sg.wa + (sg.wb - sg.wa) * n.t) * 0.58 + sg.shallow * 1.3 + 3) return { ...ZERO }; // 못·바닷가 얕은 물
    const v = sg.river.id === FLOW.main ? (t === T.SHALLOW ? FLOW.shallow : FLOW.deep) : FLOW.tributary;
    const L = Math.hypot(sg.bx - sg.ax, sg.by - sg.ay) || 1;
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
    findPath: (x0, y0, x1, y1, mode = 'foot', maxNodes = 6000) => nav.findPath(x0, y0, x1, y1, mode || 'foot', maxNodes > 0 ? maxNodes : 6000),
    randomPassableNear,
    nearestRoadPoint,
    mapCanvas: null,
    mapScale: 0.5,
    wind: { angle: Math.PI * 0.2, strength: 0.4 },
    // ---- §10 추가
    /** 수배 지역 id: hanseong | gyeonggang | gyeongin | jemulpo */
    wantedRegionAt: (x, y) => regionAt(x, y).wanted,
    setMapState: (flag, on = true) => setMapState(flag, on),
    get mapState() {
      return { ...mapState };
    },
    // 덤 (계약 밖, 있으면 쓰는 것)
    heightAt: (x, y) => tr.heightAt(x, y),
    underCanopy: (x, y) => st.underCanopy(x, y),
    buildingAt(x, y, r = 0) {
      for (const b of st.queryBuildings(x - r - 1, y - r - 1, x + r + 1, y + r + 1, [])) if (st.underRoof(b, x, y, r)) return b;
      return null;
    },
    zoneAt(x, y, kind = null) {
      for (const z of zones) if ((!kind || z.kind === kind) && inZone(z, x, y)) return z;
      return null;
    },
    ferries,
    platforms: tr.platforms,
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

  // ---------------------------------------------------------------- 지도 상태 변화 (A.6)
  const fx = M.mapStates || {};
  const mapState = { ...DEFAULT_STATE };
  const applied = { noRail: false, camp: true, wreck: false };
  const campBuildings = st.buildings.filter((b) => fx.camp && b.settlement === fx.camp);
  let wreck = null;
  const refreshBuildings = () => {
    st.buildings = st.buildings.slice(); // 새 배열: 목록을 캐시하는 쪽이 바뀐 줄 알게
    world.buildings = st.buildings;
  };
  const touch = (x0, y0, x1, y1) => {
    rnd.invalidateRect(x0, y0, x1, y1);
    nav.updateRect(x0, y0, x1, y1);
  };
  function applyState(quiet = false) {
    const s = mapState;
    const want = {
      noRail: !!(s.rail_construction && !s.rail_trial && !s.rail_open),
      camp: !s.rail_open,
      wreck: !!(s.tram_suspended && !s.tram_resumed),
    };
    const changed = [];
    if (want.noRail !== applied.noRail && fx.construction) {
      const c = fx.construction;
      rnd.setRailGaps(c.line, want.noRail ? [[c.d0, c.d1]] : null);
      const b = st.buildings.find((o) => o.id === c.frame);
      if (b) {
        b.frame = want.noRail;
        rnd.roofs.invalidate(b.id);
      }
      changed.push('rail');
    }
    if (want.camp !== applied.camp && campBuildings.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const b of campBuildings) {
        if (want.camp) st.addBuilding(b);
        else st.removeBuilding(b);
        rnd.roofs.invalidate(b.id);
        x0 = Math.min(x0, b.x - b._R);
        y0 = Math.min(y0, b.y - b._R);
        x1 = Math.max(x1, b.x + b._R);
        y1 = Math.max(y1, b.y + b._R);
      }
      refreshBuildings();
      touch(x0 - 3, y0 - 3, x1 + 3, y1 + 3);
      changed.push('camp');
    }
    if (want.wreck !== applied.wreck && fx.wreck) {
      if (want.wreck) {
        const w = fx.wreck, p = M.places?.find((q) => q.id === w.place) || w, ln = lines[w.line];
        const c = ln ? closestOnPolyline(ln.points, p.x, p.y, ln.cum) : { x: p.x, y: p.y, angle: 0 };
        wreck = wreck || { id: 'wreck_tram', kind: 'wreck', name: '불탄 전차', x: c.x, y: c.y, w: w.w ?? 9, h: w.h ?? 2.1, angle: c.angle || 0, tags: ['wreck', 'tram'] };
        st.addBuilding(wreck);
      } else if (wreck) st.removeBuilding(wreck);
      if (wreck) {
        refreshBuildings();
        touch(wreck.x - 8, wreck.y - 8, wreck.x + 8, wreck.y + 8);
      }
      changed.push('wreck');
    }
    Object.assign(applied, want);
    if (changed.length && !quiet) game.emit?.('map:state', { state: { ...mapState }, changed });
    return changed;
  }
  function setMapState(flag, on = true) {
    mapState[flag] = !!on;
    applyState();
    return { ...mapState };
  }
  // game.flags 에 적힌 것으로 맞춘다 (불러오기면 기본값부터)
  const readFlags = () => {
    const f = game.flags || {};
    let diff = false;
    for (const k of MAP_FLAGS) {
      if (!(k in f) || !!f[k] === mapState[k]) continue;
      mapState[k] = !!f[k];
      diff = true;
    }
    return diff;
  };
  function syncFlags(reset = false) {
    if (game.world !== world) return;
    if (reset) Object.assign(mapState, DEFAULT_STATE);
    if (readFlags() || reset) applyState();
  }
  readFlags();
  applyState(true);
  if (game.events?.on) {
    game.events.on('calendar:date', () => syncFlags());
    game.events.on('game:start', () => syncFlags());
    game.events.on('mission:complete', () => syncFlags());
    game.events.on('save:load', () => syncFlags(true));
  }

  await rnd.buildMapCanvas(0.5, (p) => prog(0.78, 0.98)(p, '지도를 그리는 중'), yieldFrame);
  world.mapCanvas = rnd.mapCanvas;
  world.mapScale = rnd.mapScale;

  // 월드를 다시 만들면(새 지도 등) 앞 월드의 렌더러는 뺀다
  if (Array.isArray(game.renderers)) game.renderers = game.renderers.filter((r) => !r.fn?._worldRenderer);
  const addR = (layer, fn, order) => {
    fn._worldRenderer = true;
    game.addRenderer(layer, fn, order);
  };
  let frameN = 0;
  addR(LAYER.GROUND, (ctx, gm, view) => {
    if ((++frameN & 63) === 0) syncFlags(); // 플래그를 직접 바꾼 경우도 따라잡는다
    rnd.drawGround(ctx, gm, view);
  }, 0);
  addR(LAYER.DECAL, (ctx, gm, view) => rnd.drawWaterAnim(ctx, gm, view), -100);
  addR(LAYER.HIGH, (ctx, gm, view) => rnd.drawRoofs(ctx, gm, view), 0);
  addR(LAYER.HIGH, (ctx, gm, view) => rnd.drawCanopyLayer(ctx, gm, view), 10);

  prog(0, 1)(1, '');
  return world;
}
