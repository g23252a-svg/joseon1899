// 인구 배치 [사람] (I.2·I.3·E.1 출현). game.sys.spawner
//   이름 있는 인물(js/data/npcs.js NPCS, 없으면 건너뜀) + 기능 인물(I.2, data 의 EXTRAS 가 있으면 그 정의), 상점 주인, 순검·병정·경비 초소,
//   마을·성안 주민과 큰길 나그네(플레이어 120 m 안 생성 / 180 m 밖 정리, 밤 ×0.3, 활성 NPC 60 상한), 사냥터 동물(250 m 유지 / 300 m 밖 정리).
//   (추가) density(배수)  stats()  eventSpot({min, max, road}) → {x,y}|null (무작위 사건 자리)  FUNC_NPCS  HUNT

import { pointInPolygon, rand } from '../engine/util.js';
import { activeNow, SPECIES } from '../entities/animals.js';

const MAX_NPC = 60; // 플레이어 주변 활성 NPC 상한
const NEAR = 120, CULL = 180, POST_R = 170, POST_OFF = 230;

// I.2 기능 인물 (data/npcs.js 의 EXTRAS 에 같은 id 가 있으면 그 정의를 덮어쓴다)
export const FUNC_NPCS = [
  { id: 'sagong_noryang', name: '노량진 사공', role: 'porter', x: 2730, y: 1574, brain: 'idle', look: { jige: false }, dialog: ['관선이라 삯은 없소.'] },
  { id: 'mabang_ju', name: '마방 주인', role: 'merchant', x: 3160, y: 800, brain: 'merchant', shop: 'stable_dongdaemun', dialog: ['수놈끼리 붙이면 물어뜯소.'] },
  { id: 'sosa_gaekju', name: '소사 객주 사람', role: 'merchant', x: 1265, y: 1722, brain: 'idle' },
  { id: 'gama_bearers', name: '가마꾼 우두머리', role: 'porter', x: 1300, y: 1723, brain: 'idle', look: { jige: false }, dialog: ['나리, 주막마다 목을 축여야 다리가 갑니다요.'] },
  { id: 'gama_bearer2', name: '가마꾼', role: 'porter', x: 1303, y: 1725, brain: 'idle', look: { jige: false } },
  { id: 'bupyeong_saryeong', name: '부평 관아 사령', role: 'militia', x: 945, y: 1678, brain: 'guard', dialog: ['어디 가는 길이오?'] },
  { id: 'gyeongmu_clerk', name: '경무청 서리', role: 'clerk', x: 2706, y: 722, brain: 'idle', dialog: ['현상금 일이면 여기서 보시오.'] },
  { id: 'noryang_clerk', name: '노량진 진 이속', role: 'clerk', x: 2760, y: 1652, brain: 'idle' },
  { id: 'bupyeong_clerk', name: '부평 관아 이속', role: 'clerk', x: 930, y: 1700, brain: 'idle' },
  { id: 'gamniseo_clerk', name: '인천감리서 서리', role: 'clerk', x: 670, y: 1575, brain: 'idle' },
  { id: 'fence_mapo', name: '마포 장물아비', role: 'merchant', x: 2300, y: 1378, brain: 'merchant', shop: 'fence_mapo', hours: [20, 4] },
  ...[['jongno', 2900, 797], ['mapo', 2330, 1390], ['jemulpo', 620, 1620]].map(([k, x, y]) => ({
    id: 'newsboy_' + k, name: '신문팔이 아이', role: 'child', x, y, brain: 'wander', radius: 10,
    dialog: ['신문 사요! 이 전짜리!', { text: '호외요, 호외! 대한국국제가 반포됐소!', flag: 'news_constitution' }],
  })),
  { id: 'widow_hong', name: '나무꾼 과부 홍씨', role: 'woman', x: 2185, y: 815, brain: 'idle' },
];

// A.3 zones 주석: 종 가중치 / 최대 마릿수 (밤 가중치는 night)
export const HUNT = {
  hunt_gyeyang: { w: { roe_deer: 0.45, pheasant: 0.35, fox: 0.2 }, max: 6 },
  hunt_suri: { w: { roe_deer: 0.4, pheasant: 0.3, fox: 0.15, boar: 0.15 }, max: 6 },
  hunt_reedbank: { w: { water_deer: 0.65, pheasant: 0.35 }, max: 6 },
  hunt_yeouido: { w: { water_deer: 1 }, max: 3 },
  hunt_goyang: { w: { roe_deer: 0.35, boar: 0.2, fox: 0.15, pheasant: 0.2, wolf: 0.1 }, night: { wolf: 0.3 }, max: 8 },
  hunt_gwanak: { w: { roe_deer: 0.3, boar: 0.25, fox: 0.15, wolf: 0.3 }, max: 8 },
  hunt_bukhan: { w: { boar: 0.35, roe_deer: 0.35, wolf: 0.25, tiger: 0.05 }, max: 7 },
  hunt_inwang: { w: { roe_deer: 0.4, boar: 0.3, pheasant: 0.25, tiger: 0.05 }, max: 5 },
};
const HUNT_LEVEL = { 1: HUNT.hunt_gyeyang, 2: HUNT.hunt_gwanak, 3: HUNT.hunt_bukhan };

// 주민 구성 (정착지 종류 별)
const MIX = {
  village: [['villager', 0.5], ['woman', 0.27], ['child', 0.08], ['porter', 0.1], ['yangban', 0.05]],
  town: [['villager', 0.38], ['woman', 0.22], ['yangban', 0.12], ['merchant', 0.1], ['porter', 0.1], ['child', 0.05], ['peddler', 0.03]],
  port: [['villager', 0.4], ['porter', 0.3], ['woman', 0.2], ['child', 0.1]],
  foreign: [['foreigner', 0.6], ['villager', 0.2], ['porter', 0.12], ['woman', 0.08]],
  road: [['villager', 0.5], ['porter', 0.2], ['woman', 0.12], ['peddler', 0.1], ['yangban', 0.08]],
};
const STYLE_MARK = { western: 'western', jp_wood: 'jp', cn_brick: 'cn' };
const SHOP_ROLE = { jumak: ['woman', '주모'], stable: ['villager', '마방 주인'], smithy: ['villager', '대장장이'], herbalist: ['merchant', '약방 주인'], gunshop: ['merchant', '총포상'], market: ['merchant', '상인'], pawnshop: ['merchant', '전당포 주인'], hotel: ['merchant', '호텔 지배인'], office: ['clerk', '서리'], police: ['clerk', '서리'] };
// 금지 구역 경비 (A.3 zones 주석): [role, 수, brain, 외국인 표지]
const ZONE_GUARD = { restricted_gyeongbok: ['soldier', 2, 'patrol'], restricted_gyeongun: ['soldier', 4, 'guard'], restricted_changdeok: ['soldier', 2, 'guard'], restricted_gyeonghui: ['soldier', 2, 'guard'], restricted_hongneung: ['soldier', 2, 'guard'], restricted_customs: ['foreigner', 2, 'guard', 'western'], restricted_coal_jp: ['foreigner', 2, 'guard', 'jp'], restricted_coal_ru: ['foreigner', 2, 'guard', 'western'], restricted_power: ['rail_guard', 2, 'guard', 'kr'] };
const STATION_GUARD = { st_noryangjin: 4, st_jemulpo: 4, st_oryu: 2, st_sosa: 2, st_chukhyeon: 2 };

const pickW = (list) => {
  let r = Math.random() * list.reduce((s, e) => s + e[1], 0);
  for (const e of list) if ((r -= e[1]) <= 0) return e[0];
  return list[0][0];
};
const times = (n, f) => Array.from({ length: n }, f);
/** 원 두 개가 겹치는 넓이 */
function overlapArea(d, r1, r2) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return a + b - 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
}

export function install(game) {
  const residents = new Set(); // 주민·나그네
  const posts = []; // {id, x, y, when, defs[], members[]}
  const persist = []; // 시간대(hours)·자리 옮김(moves)이 있는 인물
  let density = 1, tick = 0, ticks = 0, animT = 3, tigerDay = -1, built = false;

  const W = () => game.world;
  const night = () => game.sys.time?.isNight?.() ?? (game.hour < 5 || game.hour >= 20);
  const offScreen = (x, y, pad = 2) => {
    const b = game.camera?.bounds?.(pad);
    return !b || x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1;
  };
  const N = () => game.sys.npcs;
  const door = (b) => ({ x: b.door?.x ?? b.x, y: b.door?.y ?? b.y });

  function activeCount(p) {
    let n = 0;
    for (const e of N()?.list?.() || []) if (e.state !== 'dead' && !e.hidden && Math.abs(e.x - p.x) < CULL && Math.abs(e.y - p.y) < CULL) n++;
    return n;
  }
  /** 플레이어 주변 minD~maxD, 화면 밖, test 를 만족하는 걸을 수 있는 점 */
  function spotNear(p, test, minD = 30, maxD = NEAR) {
    const w = W();
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (!test(x, y)) continue;
      const q = w?.randomPassableNear?.(x, y, 4, 'foot');
      if (q && offScreen(q.x, q.y) && !w.isWater?.(q.x, q.y)) return q;
    }
    return null;
  }

  // ---------------------------------------------------------------- 이름 있는 인물·기능 인물
  async function spawnNamed() {
    const npcs = N(), shops = new Set();
    if (!npcs) return shops;
    let defs = [], extras = {};
    try {
      const m = await import('../data/npcs.js');
      defs = m.NPCS || m.default || [];
      for (const e of m.EXTRAS || []) extras[e.id] = e;
    } catch (err) {
      if (!/Cannot find|Failed to fetch|404|not found/i.test(String(err?.message))) console.error('[spawner] data/npcs.js', err);
    }
    const ids = new Set(defs.map((d) => d.id));
    const func = FUNC_NPCS.filter((d) => !ids.has(d.id)).map((d) => ({ ...d, ...(extras[d.id] || {}), hours: d.hours }));
    for (const d of [...defs, ...func]) {
      if (!d?.id || npcs.named(d.id)) continue;
      try {
        const brain = !d.brain || d.brain === '–' || d.brain === '-' ? 'idle' : d.brain;
        const n = npcs.spawn({ ...d, brain, tags: [...(d.tags || []), 'named'] });
        if (d.shop) shops.add(d.shop);
        if (d.hours || d.moves) persist.push({ n, d });
      } catch (err) {
        console.error('[spawner] named', d.id, err);
      }
    }
    npcs.applyPending?.();
    return shops;
  }

  // ---------------------------------------------------------------- 초소·상점 주인 (I.3)
  function addPost(id, at, defs, when = null) {
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) posts.push({ id, x: at.x, y: at.y, defs, when, members: [] });
  }
  const bld = (id) => W()?.buildings?.find((b) => b.id === id);
  const place = (id) => W()?.places?.[id];
  const settle = (id) => (W()?.map?.settlements || []).find((s) => s.id === id);
  const g = (role, brain, extra = {}) => ({ role, brain, ...extra });
  function zoneCenter(z) {
    if (Number.isFinite(z.x)) return { x: z.x, y: z.y };
    let pts = z.poly;
    if (!pts && typeof z.ref === 'string' && z.ref.startsWith('walls.')) pts = W()?.walls?.find((w) => w.id === z.ref.slice(6))?.points;
    if (!pts?.length) return null;
    return { x: pts.reduce((s, p) => s + p[0], 0) / pts.length, y: pts.reduce((s, p) => s + p[1], 0) / pts.length };
  }
  function buildPosts(shopsTaken) {
    const w = W(), S = game.sys.shops?.SHOPS || {}, byB = {};
    if (!w) return;
    for (const s of Object.values(S)) if (s.building) byB[s.building] = s.id;
    // 건물 → shops.js 상점 id (건물 shop 필드가 상점 id 가 아니면 SHOPS[].building 으로 찾는다)
    const shopOf = (b) => (S[b.shop] ? b.shop : byB[b.id] || b.shop);
    const rail = () => !!game.flags.rail_open;
    // 경무서마다 순검 2 (반경 150 m 순찰), 육조거리 2, 성문마다 밤 2 (잠긴 문 제외)
    for (const b of w.buildings || []) if (b.kind === 'police') addPost('ps_' + b.id, door(b), times(2, () => g('sungeom', 'police', { radius: 150 })));
    if (bld('gov_gyeongmu')) addPost('yukjo', { x: 2715, y: 690 }, times(2, () => g('sungeom', 'patrol', { points: [[2715, 600], [2715, 780]] })));
    for (const gt of w.gates || []) if (!gt.locked && /hanseong|city|doseong/.test(String(gt.wall))) addPost('gate_' + gt.id, gt, times(2, () => g('sungeom', 'guard')), night);
    // 궁궐·해관·석탄고·발전소 경비 (구역 안에 들어오면 경고 뒤 trespass)
    for (const z of w.zones || []) {
      const c = ZONE_GUARD[z.id];
      if (!c || z.kind !== 'restricted') continue;
      const wall = typeof z.ref === 'string' && z.ref.startsWith('walls.') ? w.walls?.find((v) => v.id === z.ref.slice(6)) : null;
      const gate = wall?.gates?.find((q) => !q.locked) || (wall && w.gates?.find((q) => q.wall === wall.id && !q.locked));
      const zone = z.poly || Number.isFinite(z.r) ? z : wall ? { poly: wall.points } : null;
      addPost(z.id, gate || zoneCenter(z), times(c[1], () => g(c[0], c[2], { radius: c[2] === 'patrol' ? 60 : 1.5, mark: c[3], brainOpts: { zone } })));
    }
    // 경강: 노량진나루 관병 2, 양화진 진영 관병 3
    addPost('gw_noryang', place('naru_noryang') || place('ferry_noryang'), times(2, () => g('gwanbyeong', 'guard')));
    const yj = bld('yanghwa_jin');
    if (yj) addPost('gw_yanghwa', { x: yj.x, y: yj.y + yj.h / 2 + 3 }, times(3, () => g('gwanbyeong', 'guard', { radius: 4 })));
    // 제물포: 조계 순경 4, 감리서 순검 2, 해관 서양인 감시원 1
    for (const id of ['jm_jp', 'jm_intl']) {
      const s = settle(id);
      if (s) addPost('jogye_' + id, s, times(2, () => g('jogye_police', 'patrol', { radius: s.r })));
    }
    const gm = bld('gamniseo'), cu = bld('customs');
    if (gm) addPost('gamniseo', door(gm), times(2, () => g('sungeom', 'guard', { radius: 3 })));
    if (cu) addPost('customs_watch', door(cu), [g('foreigner', 'guard', { mark: 'western', name: '해관 감시원' })]);
    // 회사 경비: rail_open 뒤 정거장
    for (const id in STATION_GUARD) {
      const b = bld(id);
      if (b) addPost('guard_' + id, door(b), times(STATION_GUARD[id], () => g('rail_guard', 'guard', { radius: 6 })), rail);
    }
    // 공사 인부(rail_construction 동안), 화적 소굴·수적 굴
    const rc = settle('railcamp');
    if (rc) addPost('railcamp', rc, times(6, () => g('worker', 'wander', { radius: 35 })), () => !!game.flags.rail_construction && !game.flags.rail_open);
    addPost('hwajeok', settle('hideout_hwajeok') || place('hideout_hwajeok'), times(5, () => g('bandit', 'bandit', { radius: 25 })));
    addPost('pirates', settle('pirate_den'), times(4, () => g('pirate', 'bandit', { radius: 20 })));
    // 상점 주인: 건물마다 1명, 문 앞 2 m (D.5). 역무원은 rail_open 뒤 일본인
    for (const b of w.buildings || []) {
      const shop = shopOf(b);
      if (!shop || shopsTaken.has(shop) || shopsTaken.has(b.shop) || !b.door || String(shop).startsWith('office_')) continue;
      const dx = b.door.x - b.x, dy = b.door.y - b.y, d = Math.hypot(dx, dy) || 1, mark = STYLE_MARK[b.style], facing = Math.atan2(dy, dx);
      let [role, name] = SHOP_ROLE[b.kind] || ['merchant', '상인'];
      if (b.kind === 'station') [role, name] = ['foreigner', '역무원'];
      else if (mark && ['gunshop', 'herbalist', 'hotel', 'pawnshop'].includes(b.kind)) role = 'foreigner';
      const def = g(role, 'merchant', { name, shop, mark: role === 'foreigner' ? (b.kind === 'station' ? 'jp' : mark) : undefined, angle: facing, brainOpts: { facing } });
      addPost('shop_' + b.id, { x: b.door.x + (dx / d) * 2, y: b.door.y + (dy / d) * 2 }, [def], b.kind === 'station' ? rail : null);
    }
  }
  function tickPosts(p) {
    let room = MAX_NPC - activeCount(p);
    for (const po of posts) {
      const d = Math.hypot(po.x - p.x, po.y - p.y), open = !po.when || po.when();
      if (d < POST_R && open) {
        for (let i = 0; i < po.defs.length; i++) {
          if (po.members[i] && !po.members[i]._removed) continue;
          if (room <= 0 || (ticks > 6 && d > 30 && !offScreen(po.x, po.y, 8))) continue; // 보는 앞에서 생기지 않게
          const q = W()?.randomPassableNear?.(po.x, po.y, i ? 4 : 1.5, 'foot') || po, def = po.defs[i];
          const n = N().spawn({ ...def, x: q.x, y: q.y, home: { x: q.x, y: q.y }, look: def.mark ? { mark: def.mark } : undefined });
          n.data.post = po.id;
          po.members[i] = n;
          room--;
        }
      } else if (d > POST_OFF || !open) {
        po.members.forEach((m, i) => {
          if (!m) return;
          if (m._removed) po.members[i] = null;
          else if (m.brain?.mode !== 'fight' && offScreen(m.x, m.y)) game.remove(m), (po.members[i] = null);
        });
      }
    }
  }

  // ---------------------------------------------------------------- 주민·나그네 (I.3 행인)
  function tickResidents(p) {
    const npcs = N(), w = W();
    if (!npcs || !w) return;
    let room = MAX_NPC - activeCount(p), spawned = 0;
    const nightMul = night() ? 0.3 : 1, count = new Map();
    const jumak = (w.buildings || []).some((b) => b.kind === 'jumak' && Math.abs(b.x - p.x) < 60 && Math.abs(b.y - p.y) < 60) ? 1.5 : 1;
    for (const n of residents) {
      const far = Math.hypot(n.x - p.x, n.y - p.y) > CULL;
      if (n._removed || (far && offScreen(n.x, n.y) && n.brain?.mode !== 'report')) {
        if (!n._removed) game.remove(n);
        residents.delete(n);
      } else if (n.state !== 'dead' && !far) count.set(n.data.ambient, (count.get(n.data.ambient) || 0) + 1);
    }
    const near = (w.map?.settlements || []).filter((s) => s.kind !== 'camp' && Math.hypot(s.x - p.x, s.y - p.y) < s.r + NEAR);
    near.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    for (const s of near) {
      if (room <= 0 || spawned >= 2) break;
      // town: 집 2채당 1명(최대 40), village: 3채당 1명(최대 15). 플레이어 120 m 원과 겹친 넓이만큼
      const foreign = STYLE_MARK[s.style], big = s.kind === 'city' || s.kind === 'town';
      const per = big && !foreign ? 2 : 3, cap = big ? (foreign ? 10 : 40) : 15;
      const frac = overlapArea(Math.hypot(s.x - p.x, s.y - p.y), NEAR, s.r) / (Math.PI * s.r * s.r);
      const want = Math.round(Math.min(cap, ((s.houses || 10) / per) * Math.min(1, frac)) * nightMul * jumak * density);
      if ((count.get(s.id) || 0) >= want) continue;
      const q = spotNear(p, (x, y) => (x - s.x) ** 2 + (y - s.y) ** 2 < s.r * s.r, 25, NEAR);
      if (!q) continue;
      const role = pickW(foreign ? MIX.foreign : s.kind === 'port' ? MIX.port : s.kind === 'village' ? MIX.village : MIX.town);
      const mark = role === 'foreigner' ? foreign || 'western' : undefined;
      const n = npcs.spawn({ role, x: q.x, y: q.y, brain: role === 'porter' ? 'porter' : 'villager', mark, look: mark ? { mark } : undefined, radius: Math.min(45, s.r) });
      n.data.ambient = s.id;
      residents.add(n);
      room--;
      spawned++;
    }
    if (room > 0 && spawned < 2) roadWalker(p, count, nightMul);
  }
  /** 큰길 나그네: 100 m마다 1명, 길을 따라 오간다. 경인 옛길 낮엔 보부상 2인 1조 */
  function roadWalker(p, count, nightMul) {
    const w = W(), segs = [];
    let len = 0;
    for (const r of w.roads || []) {
      if (r.kind !== 'main' && r.id !== 'gyeongin_old') continue;
      for (let i = 1; i < r.points.length; i++) {
        const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i], L = Math.hypot(bx - ax, by - ay);
        if (Math.min(Math.hypot(ax - p.x, ay - p.y), Math.hypot(bx - p.x, by - p.y)) > NEAR + L / 2) continue;
        len += Math.min(L, NEAR * 2);
        segs.push([r, i]);
      }
    }
    if (!segs.length || (count.get('road') || 0) >= Math.round((len / 100) * nightMul * density)) return;
    const [r, i] = segs[(Math.random() * segs.length) | 0], [ax, ay] = r.points[i - 1], [bx, by] = r.points[i];
    const t = Math.random(), x = ax + (bx - ax) * t, y = ay + (by - ay) * t, d = Math.hypot(x - p.x, y - p.y);
    if (d < 30 || d > NEAR || !offScreen(x, y) || !w.passable(x, y, 'foot')) return;
    const role = r.id === 'gyeongin_old' && !night() && Math.random() < 0.4 ? 'peddler' : pickW(MIX.road);
    const fwd = Math.random() < 0.5;
    const n = N().spawn({ role, x, y, brain: 'villager', brainOpts: { route: fwd ? r.points : r.points.slice().reverse() } });
    n.brain.ptIndex = fwd ? i : r.points.length - i;
    n.data.ambient = 'road';
    residents.add(n);
    if (role !== 'peddler') return;
    const m = N().spawn({ role, x: x + 1.2, y: y + 0.8, brain: 'follower', brainOpts: { target: n, dist: 1.8, board: false } });
    m.data.ambient = 'road';
    residents.add(m);
  }

  // ---------------------------------------------------------------- 동물 (E.1 출현 규칙)
  const zoneGeo = new Map();
  function geo(z) {
    if (zoneGeo.has(z)) return zoneGeo.get(z);
    const M = W()?.map || {};
    let g = null;
    if (z.poly) g = { poly: z.poly };
    else if (Number.isFinite(z.r)) g = { x: z.x, y: z.y, r: z.r };
    else if (z.rect) g = { poly: [[z.rect[0], z.rect[1]], [z.rect[2], z.rect[1]], [z.rect[2], z.rect[3]], [z.rect[0], z.rect[3]]] };
    else if (typeof z.ref === 'string') {
      // ref: 'sands[0]' | 'forests.f_goyang' | 'walls.id'
      const m = z.ref.match(/^(\w+)(?:\[(\d+)\]|\.(\w+))$/), arr = m && M[m[1]];
      const src = Array.isArray(arr) ? (m[2] != null ? arr[+m[2]] : arr.find((o) => o.id === m[3])) : null;
      if (src?.poly) g = { poly: src.poly };
      else if (Array.isArray(src) && Array.isArray(src[0])) g = { poly: src };
      else if (src && Number.isFinite(src.r)) g = { x: src.x, y: src.y, r: src.r };
      else if (src?.points) g = { poly: src.points };
    }
    if (g?.poly) {
      const xs = g.poly.map((q) => q[0]), ys = g.poly.map((q) => q[1]);
      Object.assign(g, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    } else if (g) Object.assign(g, { x0: g.x - g.r, y0: g.y - g.r, x1: g.x + g.r, y1: g.y + g.r });
    zoneGeo.set(z, g);
    return g;
  }
  const inGeo = (g, x, y) => (g.poly ? pointInPolygon(x, y, g.poly) : (x - g.x) ** 2 + (y - g.y) ** 2 <= g.r * g.r);
  const nearGeo = (g, p, R) => p.x > g.x0 - R && p.x < g.x1 + R && p.y > g.y0 - R && p.y < g.y1 + R;

  /** 시각에 맞는 종 하나. 범은 밤에만, 지도 전체 하루 1마리 */
  function pickSpecies(cfg) {
    const nt = night(), day = game.sys.time?.day ?? 0, list = [];
    for (const id in cfg.w) {
      if (!SPECIES[id] || !activeNow(SPECIES[id], game.hour) || (id === 'tiger' && (!nt || tigerDay === day))) continue;
      list.push([id, (nt && cfg.night?.[id]) || cfg.w[id]]);
    }
    return list.length ? pickW(list) : null;
  }
  function tickAnimals(p) {
    const A = game.sys.animals, w = W();
    if (!A || !w) return;
    const count = new Map();
    for (const a of A.list()) {
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d > 300 && !a.tags.has('mission') && !a.data.keep && !a.hidden) game.remove(a);
      else if (!a.dead && d < 250) count.set(a.data.zone, (count.get(a.data.zone) || 0) + 1);
    }
    const rain = game.sys.time?.weather === 'rain' ? 0.8 : 1; // 비 오면 출현 ×0.8
    let made = 0;
    const tryZone = (key, g, cfg, max) => {
      const have = count.get(key) || 0, id = made < 2 && have < max ? pickSpecies(cfg) : null;
      if (!id) return;
      // 플레이어 60~250 m, 화면 밖, 구역 안의 걸을 수 있는 칸
      for (let k = 0; k < 10; k++) {
        const x = g.x0 + Math.random() * (g.x1 - g.x0), y = g.y0 + Math.random() * (g.y1 - g.y0), d = Math.hypot(x - p.x, y - p.y);
        if (d < 60 || d > 250 || !inGeo(g, x, y) || !offScreen(x, y, 6) || !w.passable(x, y, 'foot') || w.isWater?.(x, y)) continue;
        const sp = SPECIES[id], n = Math.min(rand.int(sp.group[0], sp.group[1]), Math.max(1, max - have));
        A.spawnPack(id, x, y, id === 'wolf' ? Math.max(3, n) : n, { zone: key });
        if (id === 'tiger') tigerDay = game.sys.time?.day ?? 0;
        count.set(key, have + n);
        made++;
        return;
      }
    };
    for (const z of w.zones || []) {
      if (z.kind !== 'hunting') continue;
      const gz = geo(z);
      if (!gz || !nearGeo(gz, p, 250)) continue;
      const cfg = z.data?.weights ? { w: z.data.weights, max: z.data.max ?? 6 } : HUNT[z.id] || HUNT_LEVEL[z.data?.level] || HUNT.hunt_gyeyang;
      tryZone(z.id, gz, cfg, Math.round(cfg.max * rain));
    }
    // 사냥 구역 밖 숲·풀밭: 꿩·노루만 낮게 (최대 2)
    for (const z of w.zones || []) {
      const gz = (z.kind === 'forest' || z.kind === 'field') && geo(z);
      if (gz && nearGeo(gz, p, 200)) tryZone('wild', gz, { w: { pheasant: 0.6, roe_deer: 0.4 } }, 2);
    }
  }

  // ---------------------------------------------------------------- 시간대 있는 인물 (I.2 장물아비 20~04시) · 자리 옮김
  function tickPersist() {
    const h = game.hour;
    for (const { n, d } of persist) {
      if (n._removed || n.state === 'dead') continue;
      if (d.hours) {
        const [a, b] = d.hours, on = a > b ? h >= a || h < b : h >= a && h < b;
        if (n.hidden === on && offScreen(n.x, n.y)) n.hidden = !on;
      }
      for (const mv of d.moves || []) {
        if (!game.flags[mv.flag] || n._moved?.[mv.flag] || !offScreen(n.x, n.y) || !offScreen(mv.x, mv.y)) continue;
        (n._moved ||= {})[mv.flag] = true;
        Object.assign(n, { x: mv.x, y: mv.y, home: { x: mv.x, y: mv.y } });
      }
    }
  }

  const sys = {
    name: 'spawner',
    order: 30,
    FUNC_NPCS,
    HUNT,
    posts,
    async init() {
      if (built) return;
      built = true;
      try {
        buildPosts(await spawnNamed());
      } catch (err) {
        console.error('[spawner] init', err);
      }
    },
    density(mul) {
      if (Number.isFinite(mul)) density = Math.max(0, mul);
      return density;
    },
    stats() {
      return { residents: residents.size, posts: posts.length, active: game.player ? activeCount(game.player) : 0, animals: game.sys.animals?.list?.().length || 0 };
    },
    /** 무작위 사건 자리: 플레이어에서 min~max m, 화면 밖 (road 면 길 위) */
    eventSpot({ min = 80, max = 150, road = true } = {}) {
      const p = game.player, w = W();
      for (let k = 0; p && w && k < 12; k++) {
        const a = Math.random() * Math.PI * 2, d = min + Math.random() * (max - min);
        let q = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
        if (road) q = w.nearestRoadPoint?.(q.x, q.y, 60) || null;
        const dd = q && Math.hypot(q.x - p.x, q.y - p.y);
        if (q && dd >= min * 0.8 && dd <= max * 1.2 && offScreen(q.x, q.y, 4) && w.passable(q.x, q.y, 'foot')) return { x: q.x, y: q.y };
      }
      return null;
    },
    update(dt, realDt = dt) {
      const p = game.player;
      if (!p || game.state !== 'play' || !N()) return;
      if ((tick += realDt) < 0.5) return;
      tick = 0;
      ticks++;
      tickPosts(p);
      tickResidents(p);
      tickPersist();
      if ((animT -= 0.5) <= 0) (animT = 10), tickAnimals(p); // 10실초마다
    },
  };
  game.registerSystem(sys);
  return sys;
}
