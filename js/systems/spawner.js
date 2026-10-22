// 인구 배치 [사람] (I.2·I.3·E.1 출현). game.sys.spawner
//   이름 있는 인물(js/data/npcs.js, 없으면 건너뜀) + 기능 인물(I.2), 상점 주인, 순검·병정·경비 초소,
//   마을·성안 주민과 큰길 나그네(플레이어 120 m 안 생성 / 180 m 밖 정리, 밤 ×0.3), 사냥터 동물(250 m 유지 / 300 m 밖 정리).
//   (추가) density(배수)  stats()  FUNC_NPCS  HUNT

import { pointInPolygon, rand } from '../engine/util.js';
import { activeNow, SPECIES } from '../entities/animals.js';

const MAX_NPC = 60; // 플레이어 주변 활성 NPC 상한
const NEAR = 120, CULL = 180, POST_R = 170, POST_OFF = 230;

// I.2 기능 인물 (data/npcs.js 에 같은 id 가 있으면 그쪽이 우선)
export const FUNC_NPCS = [
  { id: 'sagong_noryang', name: '노량진 사공', role: 'villager', x: 2730, y: 1574, brain: 'idle', dialog: ['관선이라 삯은 없소.'] },
  { id: 'mabang_ju', name: '마방 주인', role: 'villager', x: 3160, y: 800, brain: 'merchant', shop: 'stable_dongdaemun', dialog: ['수놈끼리 붙이면 물어뜯소.'] },
  { id: 'sosa_gaekju', name: '소사 객주 사람', role: 'merchant', x: 1265, y: 1722, brain: 'idle' },
  { id: 'gama_bearers', name: '가마꾼 우두머리', role: 'porter', x: 1300, y: 1723, brain: 'idle', look: { jige: false }, dialog: ['나리, 주막마다 목을 축여야 다리가 갑니다요.'] },
  { id: 'gama_bearer2', name: '가마꾼', role: 'porter', x: 1303, y: 1725, brain: 'idle', look: { jige: false } },
  { id: 'bupyeong_saryeong', name: '부평 관아 사령', role: 'militia', x: 945, y: 1678, brain: 'guard', dialog: ['어디 가는 길이오?'] },
  { id: 'gyeongmu_clerk', name: '경무청 서리', role: 'clerk', x: 2706, y: 722, brain: 'idle', shop: 'office_gyeongmu' },
  { id: 'noryang_clerk', name: '노량진 진 이속', role: 'clerk', x: 2760, y: 1652, brain: 'idle', shop: 'office_noryangjin' },
  { id: 'bupyeong_clerk', name: '부평 관아 이속', role: 'clerk', x: 930, y: 1700, brain: 'idle', shop: 'office_bupyeong' },
  { id: 'gamniseo_clerk', name: '인천감리서 서리', role: 'clerk', x: 670, y: 1575, brain: 'idle', shop: 'office_gamniseo' },
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

// 주민 구성 (정착지 style 별)
const MIX = {
  village: [['villager', 0.5], ['woman', 0.27], ['child', 0.08], ['porter', 0.1], ['yangban', 0.05]],
  town: [['villager', 0.38], ['woman', 0.22], ['yangban', 0.12], ['merchant', 0.1], ['porter', 0.1], ['child', 0.05], ['peddler', 0.03]],
  port: [['villager', 0.4], ['porter', 0.3], ['woman', 0.2], ['child', 0.1]],
  foreign: [['foreigner', 0.6], ['villager', 0.2], ['porter', 0.12], ['woman', 0.08]],
  road: [['villager', 0.5], ['porter', 0.2], ['woman', 0.12], ['peddler', 0.1], ['yangban', 0.08]],
};
const STYLE_MARK = { western: 'western', jp_wood: 'jp', cn_brick: 'cn' };
const SHOP_ROLE = { jumak: ['woman', '주모'], stable: ['villager', '마방 주인'], smithy: ['villager', '대장장이'], herbalist: ['merchant', '약방 주인'], gunshop: ['merchant', '총포상'], market: ['merchant', '상인'], pawnshop: ['merchant', '전당포 주인'], hotel: ['merchant', '호텔 지배인'], office: ['clerk', '서리'], police: ['clerk', '서리'] };

const pickW = (list) => {
  let r = Math.random() * list.reduce((s, e) => s + e[1], 0);
  for (const e of list) if ((r -= e[1]) <= 0) return e[0];
  return list[0][0];
};
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
  const persist = []; // 기능 인물·이름 있는 인물 중 시간대가 있는 것
  let density = 1, tick = 0, ticks = 0, animT = 3, tigerDay = -1;
  let built = false;

  const W = () => game.world;
  const hour = () => game.hour;
  const night = () => game.sys.time?.isNight?.() ?? (hour() < 5 || hour() >= 20);
  const offScreen = (x, y, pad = 2) => {
    const b = game.camera?.bounds?.(pad);
    return !b || x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1;
  };
  const npcSys = () => game.sys.npcs;

  function activeCount(p) {
    let n = 0;
    for (const e of npcSys()?.list?.() || []) if (e.state !== 'dead' && !e.hidden && Math.abs(e.x - p.x) < CULL && Math.abs(e.y - p.y) < CULL) n++;
    return n;
  }
  /** 플레이어 주변, 화면 밖, 조건을 만족하는 걸을 수 있는 점 */
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
    const N = npcSys();
    if (!N) return;
    let defs = [];
    try {
      const m = await import('../data/npcs.js');
      defs = m.NPCS || m.default || [];
    } catch (err) {
      if (!/Cannot find|Failed to fetch|404|not found/i.test(String(err?.message))) console.error('[spawner] data/npcs.js', err);
    }
    const ids = new Set(defs.map((d) => d.id));
    const shops = new Set(defs.map((d) => d.shop).filter(Boolean));
    for (const d of [...defs, ...FUNC_NPCS.filter((d) => !ids.has(d.id))]) {
      if (!d || !d.id || N.named(d.id)) continue;
      try {
        const brain = !d.brain || d.brain === '–' || d.brain === '-' ? 'idle' : d.brain;
        const n = N.spawn({ ...d, brain, tags: [...(d.tags || []), 'named'] });
        if (d.shop) shops.add(d.shop);
        if (d.hours || d.moves) persist.push({ n, d });
      } catch (err) {
        console.error('[spawner] named', d.id, err);
      }
    }
    N.applyPending?.();
    return shops;
  }

  // ---------------------------------------------------------------- 초소·상점 주인 (I.3)
  function addPost(id, x, y, defs, when = null) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    posts.push({ id, x, y, defs, when, members: [] });
  }
  const bld = (id) => W()?.buildings?.find((b) => b.id === id);
  const place = (id) => W()?.places?.[id];
  const settle = (id) => (W()?.map?.settlements || []).find((s) => s.id === id);
  function zoneCenter(z) {
    if (Number.isFinite(z.x)) return { x: z.x, y: z.y };
    let pts = z.poly;
    if (!pts && typeof z.ref === 'string' && z.ref.startsWith('walls.')) pts = W()?.walls?.find((w) => w.id === z.ref.slice(6))?.points;
    if (!pts?.length) return null;
    let x = 0, y = 0;
    for (const p of pts) {
      x += p[0];
      y += p[1];
    }
    return { x: x / pts.length, y: y / pts.length };
  }
  function buildPosts(shopsTaken) {
    const w = W();
    if (!w) return;
    const g = (role, brain, extra = {}) => ({ role, brain, ...extra });
    // 경무서마다 순검 2 (반경 150 m 순찰)
    for (const b of w.buildings || []) if (b.kind === 'police') addPost('ps_' + b.id, b.door?.x ?? b.x, b.door?.y ?? b.y, [g('sungeom', 'police', { radius: 150 }), g('sungeom', 'police', { radius: 150 })]);
    // 육조거리 순검 2
    if (bld('gov_gyeongmu')) addPost('yukjo', 2715, 690, [0, 1].map(() => g('sungeom', 'patrol', { points: [[2715, 600], [2715, 780]] })));
    // 성문마다 밤 순검 2 (잠긴 문 제외)
    for (const gt of w.gates || []) {
      if (gt.locked || !/hanseong|city|doseong/.test(String(gt.wall))) continue;
      addPost('gate_' + gt.id, gt.x, gt.y, [g('sungeom', 'guard'), g('sungeom', 'guard')], () => night());
    }
    // 금지 구역 경비 (A.3 zones 주석)
    const ZG = { restricted_gyeongbok: ['soldier', 2, 'patrol'], restricted_gyeongun: ['soldier', 4, 'guard'], restricted_changdeok: ['soldier', 2, 'guard'], restricted_gyeonghui: ['soldier', 2, 'guard'], restricted_hongneung: ['soldier', 2, 'guard'], restricted_customs: ['foreigner', 2, 'guard'], restricted_coal_jp: ['foreigner', 2, 'guard', 'jp'], restricted_coal_ru: ['foreigner', 2, 'guard', 'western'], restricted_power: ['rail_guard', 2, 'guard'] };
    for (const z of w.zones || []) {
      const c = ZG[z.id];
      if (!c || z.kind !== 'restricted') continue;
      let at = zoneCenter(z);
      const wall = typeof z.ref === 'string' && z.ref.startsWith('walls.') ? w.walls?.find((v) => v.id === z.ref.slice(6)) : null;
      const gate = wall?.gates?.find((q) => !q.locked) || (wall && w.gates?.find((q) => q.wall === wall.id && !q.locked));
      if (gate) at = { x: gate.x, y: gate.y };
      if (!at) continue;
      const zone = z.poly || Number.isFinite(z.r) ? z : wall ? { poly: wall.points } : null;
      addPost(z.id, at.x, at.y, Array.from({ length: c[1] }, () => g(c[0], c[2], { radius: c[2] === 'patrol' ? 60 : 1.5, mark: c[3], brainOpts: { zone } })));
    }
    // 경강·제물포
    const pl = place('naru_noryang') || place('ferry_noryang');
    if (pl) addPost('gw_noryang', pl.x, pl.y, [g('gwanbyeong', 'guard'), g('gwanbyeong', 'guard')]);
    const yj = bld('yanghwa_jin');
    if (yj) addPost('gw_yanghwa', yj.x, yj.y + yj.h / 2 + 3, [0, 1, 2].map(() => g('gwanbyeong', 'guard', { radius: 4 })));
    for (const id of ['jm_jp', 'jm_intl']) {
      const s = settle(id);
      if (s) addPost('jogye_' + id, s.x, s.y, [g('jogye_police', 'patrol', { radius: s.r }), g('jogye_police', 'patrol', { radius: s.r })]);
    }
    const gm = bld('gamniseo');
    if (gm) addPost('gamniseo', gm.door?.x ?? gm.x, gm.door?.y ?? gm.y, [g('sungeom', 'guard', { radius: 3 }), g('sungeom', 'guard', { radius: 3 })]);
    const cu = bld('customs');
    if (cu) addPost('customs_watch', cu.door?.x ?? cu.x, cu.door?.y ?? cu.y, [g('foreigner', 'guard', { mark: 'western', name: '해관 감시원' })]);
    // 회사 경비: rail_open 뒤 정거장, 발전소는 늘
    const ST = { st_noryangjin: 4, st_jemulpo: 4, st_oryu: 2, st_sosa: 2, st_chukhyeon: 2 };
    for (const id in ST) {
      const b = bld(id);
      if (b) addPost('guard_' + id, b.door?.x ?? b.x, b.door?.y ?? b.y, Array.from({ length: ST[id] }, () => g('rail_guard', 'guard', { radius: 6 })), () => !!game.flags.rail_open);
    }
    const pp = bld('power_plant');
    if (pp) addPost('guard_power', pp.door?.x ?? pp.x, pp.door?.y ?? pp.y, [g('rail_guard', 'guard', { mark: 'kr' }), g('rail_guard', 'guard', { mark: 'kr' })]);
    // 공사 인부 (rail_construction 동안), 화적 소굴·수적 굴
    const rc = settle('railcamp');
    if (rc) addPost('railcamp', rc.x, rc.y, Array.from({ length: 6 }, () => g('worker', 'wander', { radius: 35 })), () => !!game.flags.rail_construction && !game.flags.rail_open);
    const hw = settle('hideout_hwajeok') || place('hideout_hwajeok');
    if (hw) addPost('hwajeok', hw.x, hw.y, Array.from({ length: 5 }, () => g('bandit', 'bandit', { radius: 25 })));
    const pd = settle('pirate_den');
    if (pd) addPost('pirates', pd.x, pd.y, Array.from({ length: 4 }, () => g('pirate', 'bandit', { radius: 20 })));
    // 상점 주인: 건물마다 1명, 문 앞 2 m (D.5)
    for (const b of w.buildings || []) {
      if (!b.shop || shopsTaken.has(b.shop) || !b.door) continue;
      const dx = b.door.x - b.x, dy = b.door.y - b.y, d = Math.hypot(dx, dy) || 1;
      const x = b.door.x + (dx / d) * 2, y = b.door.y + (dy / d) * 2;
      const mark = STYLE_MARK[b.style];
      let [role, name] = SHOP_ROLE[b.kind] || ['merchant', '상인'];
      let when = null;
      if (b.kind === 'station') {
        [role, name] = ['foreigner', '역무원'];
        when = () => !!game.flags.rail_open;
      } else if (mark && (b.kind === 'gunshop' || b.kind === 'herbalist' || b.kind === 'hotel' || b.kind === 'pawnshop')) role = 'foreigner';
      addPost('shop_' + b.id, x, y, [g(role, 'merchant', { name, shop: b.shop, mark: role === 'foreigner' ? (b.kind === 'station' ? 'jp' : mark) : undefined, angle: Math.atan2(dy, dx), brainOpts: { facing: Math.atan2(dy, dx) } })], when);
    }
  }
  function tickPosts(p) {
    const N = npcSys();
    let room = MAX_NPC - activeCount(p);
    for (const po of posts) {
      const d = Math.hypot(po.x - p.x, po.y - p.y);
      const on = d < POST_R && (!po.when || po.when());
      if (on) {
        for (let i = 0; i < po.defs.length; i++) {
          const m = po.members[i];
          if (m && !m._removed) continue;
          if (room <= 0 || (ticks > 6 && d > 30 && !offScreen(po.x, po.y, 8))) continue;
          const q = W()?.randomPassableNear?.(po.x, po.y, i ? 4 : 1.5, 'foot') || { x: po.x, y: po.y };
          const def = po.defs[i];
          const n = N.spawn({ ...def, x: q.x, y: q.y, home: { x: q.x, y: q.y }, look: def.mark ? { mark: def.mark } : undefined });
          n.data.post = po.id;
          po.members[i] = n;
          room--;
        }
      } else if (d > POST_OFF || (po.when && !po.when())) {
        for (let i = 0; i < po.members.length; i++) {
          const m = po.members[i];
          if (!m) continue;
          if (m._removed) po.members[i] = null;
          else if (m.brain?.mode !== 'fight' && offScreen(m.x, m.y)) {
            game.remove(m);
            po.members[i] = null;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- 주민·나그네 (I.3 행인)
  function tickResidents(p) {
    const N = npcSys(), w = W();
    if (!N || !w) return;
    let room = MAX_NPC - activeCount(p);
    const nightMul = night() ? 0.3 : 1;
    const jumak = (w.buildings || []).some((b) => b.kind === 'jumak' && Math.abs(b.x - p.x) < 60 && Math.abs(b.y - p.y) < 60) ? 1.5 : 1;
    const count = new Map();
    for (const n of residents) {
      if (n._removed) {
        residents.delete(n);
        continue;
      }
      const far = Math.hypot(n.x - p.x, n.y - p.y) > CULL;
      if (far && offScreen(n.x, n.y) && n.brain?.mode !== 'report') {
        game.remove(n);
        residents.delete(n);
        continue;
      }
      if (n.state !== 'dead' && !far) count.set(n.data.ambient, (count.get(n.data.ambient) || 0) + 1);
    }
    let spawned = 0;
    const list = (w.map?.settlements || []).filter((s) => s.kind !== 'camp' && Math.hypot(s.x - p.x, s.y - p.y) < s.r + NEAR);
    list.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    for (const s of list) {
      if (room <= 0 || spawned >= 2) break;
      const foreign = STYLE_MARK[s.style];
      const per = s.kind === 'city' || (s.kind === 'town' && !foreign) ? 2 : 3;
      const cap = s.kind === 'city' || s.kind === 'town' ? (foreign ? 10 : 40) : 15;
      const frac = overlapArea(Math.hypot(s.x - p.x, s.y - p.y), NEAR, s.r) / (Math.PI * s.r * s.r);
      const want = Math.round(Math.min(cap, ((s.houses || 10) / per) * Math.min(1, frac)) * nightMul * jumak * density);
      if ((count.get(s.id) || 0) >= want) continue;
      const q = spotNear(p, (x, y) => (x - s.x) ** 2 + (y - s.y) ** 2 < s.r * s.r, 25, NEAR);
      if (!q) continue;
      const mix = foreign ? MIX.foreign : s.kind === 'port' ? MIX.port : s.kind === 'village' ? MIX.village : MIX.town;
      const role = pickW(mix);
      const n = N.spawn({ role, x: q.x, y: q.y, brain: role === 'porter' ? 'porter' : 'villager', mark: role === 'foreigner' ? foreign || 'western' : undefined, look: role === 'foreigner' ? { mark: foreign || 'western' } : undefined, radius: Math.min(45, s.r) });
      n.data.ambient = s.id;
      residents.add(n);
      room--;
      spawned++;
    }
    // 큰길 나그네: 100 m마다 1명
    if (room > 0 && spawned < 2) {
      let len = 0;
      const segs = [];
      for (const r of w.roads || []) {
        if (r.kind !== 'main' && r.id !== 'gyeongin_old') continue;
        for (let i = 1; i < r.points.length; i++) {
          const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i];
          const L = Math.hypot(bx - ax, by - ay);
          if (Math.min(Math.hypot(ax - p.x, ay - p.y), Math.hypot(bx - p.x, by - p.y)) > NEAR + L / 2) continue;
          len += Math.min(L, NEAR * 2);
          segs.push([r, i]);
        }
      }
      const want = Math.round((len / 100) * nightMul * density);
      if (segs.length && (count.get('road') || 0) < want) {
        const [r, i] = segs[(Math.random() * segs.length) | 0];
        const [ax, ay] = r.points[i - 1], [bx, by] = r.points[i];
        const t = Math.random(), x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        const d = Math.hypot(x - p.x, y - p.y);
        if (d > 30 && d < NEAR && offScreen(x, y)) {
          const role = r.id === 'gyeongin_old' && !night() && Math.random() < 0.4 ? 'peddler' : pickW(MIX.road);
          const fwd = Math.random() < 0.5;
          const route = fwd ? r.points : r.points.slice().reverse();
          const n = N.spawn({ role, x, y, brain: 'villager', brainOpts: { route } });
          n.brain.ptIndex = fwd ? i : r.points.length - i;
          n.data.ambient = 'road';
          residents.add(n);
          if (role === 'peddler') {
            // 보부상은 2인 1조
            const m = N.spawn({ role, x: x + 1.2, y: y + 0.8, brain: 'follower', brainOpts: { target: n, dist: 1.8, board: false } });
            m.data.ambient = 'road';
            residents.add(m);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- 동물 (E.1 출현 규칙)
  const zoneGeo = new Map();
  function geo(z) {
    if (zoneGeo.has(z)) return zoneGeo.get(z);
    const w = W(), M = w?.map || {};
    let g = null;
    if (z.poly) g = { poly: z.poly };
    else if (Number.isFinite(z.r)) g = { x: z.x, y: z.y, r: z.r };
    else if (z.rect) g = { poly: [[z.rect[0], z.rect[1]], [z.rect[2], z.rect[1]], [z.rect[2], z.rect[3]], [z.rect[0], z.rect[3]]] };
    else if (typeof z.ref === 'string') {
      const m = z.ref.match(/^(\w+)(?:\[(\d+)\]|\.(\w+))$/);
      const arr = m && M[m[1]];
      const src = Array.isArray(arr) ? (m[2] != null ? arr[+m[2]] : arr.find((o) => o.id === m[3])) : null;
      if (src?.poly) g = { poly: src.poly };
      else if (Array.isArray(src) && Array.isArray(src[0])) g = { poly: src };
      else if (src && Number.isFinite(src.r)) g = { x: src.x, y: src.y, r: src.r };
      else if (src?.points) g = { poly: src.points };
    }
    if (g?.poly) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of g.poly) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      Object.assign(g, { x0, y0, x1, y1 });
    } else if (g) Object.assign(g, { x0: g.x - g.r, y0: g.y - g.r, x1: g.x + g.r, y1: g.y + g.r });
    zoneGeo.set(z, g);
    return g;
  }
  const inGeo = (g, x, y) => (g.poly ? pointInPolygon(x, y, g.poly) : (x - g.x) ** 2 + (y - g.y) ** 2 <= g.r * g.r);
  const nearGeo = (g, p, R) => p.x > g.x0 - R && p.x < g.x1 + R && p.y > g.y0 - R && p.y < g.y1 + R;

  function pickSpecies(cfg) {
    const h = hour(), nt = night();
    const list = [];
    const day = game.sys.time?.day ?? 0;
    for (const id in cfg.w) {
      const sp = SPECIES[id];
      if (!sp || !activeNow(sp, h)) continue;
      if (id === 'tiger' && (!nt || tigerDay === day)) continue;
      list.push([id, (nt && cfg.night?.[id]) || cfg.w[id]]);
    }
    return list.length ? pickW(list) : null;
  }
  function tickAnimals(p) {
    const A = game.sys.animals, w = W();
    if (!A || !w) return;
    const all = A.list();
    const count = new Map();
    for (const a of all) {
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d > 300 && !a.tags.has('mission') && !a.data.keep) {
        game.remove(a);
        continue;
      }
      if (!a.dead && d < 250) count.set(a.data.zone, (count.get(a.data.zone) || 0) + 1);
    }
    const rain = game.sys.time?.weather === 'rain' ? 0.8 : 1;
    let made = 0;
    const tryZone = (key, g, cfg, max) => {
      if (made >= 2 || (count.get(key) || 0) >= max) return;
      const id = pickSpecies(cfg);
      if (!id) return;
      for (let k = 0; k < 10; k++) {
        const x = g.x0 + Math.random() * (g.x1 - g.x0), y = g.y0 + Math.random() * (g.y1 - g.y0);
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < 60 || d > 250 || !inGeo(g, x, y) || !offScreen(x, y, 6) || !w.passable(x, y, 'foot') || w.isWater?.(x, y)) continue;
        const sp = SPECIES[id];
        const n = Math.min(rand.int(sp.group[0], sp.group[1]), Math.max(1, max - (count.get(key) || 0)));
        A.spawnPack(id, x, y, id === 'wolf' ? Math.max(3, n) : n, { zone: key });
        if (id === 'tiger') tigerDay = game.sys.time?.day ?? 0;
        count.set(key, (count.get(key) || 0) + n);
        made++;
        return;
      }
    };
    for (const z of w.zones || []) {
      if (z.kind !== 'hunting') continue;
      const g = geo(z);
      if (!g || !nearGeo(g, p, 250)) continue;
      const cfg = z.data?.weights ? { w: z.data.weights, max: z.data.max ?? 6 } : HUNT[z.id] || HUNT_LEVEL[z.data?.level] || HUNT.hunt_gyeyang;
      tryZone(z.id, g, cfg, Math.round(cfg.max * rain));
    }
    // 사냥 구역 밖 숲·풀밭: 꿩·노루만 낮게 (최대 2)
    for (const z of w.zones || []) {
      if (z.kind !== 'forest' && z.kind !== 'field') continue;
      const g = geo(z);
      if (g && nearGeo(g, p, 200)) tryZone('wild', g, { w: { pheasant: 0.6, roe_deer: 0.4 } }, 2);
    }
  }

  // ---------------------------------------------------------------- 시간대 있는 인물 (I.2 장물아비 20~04시 등)
  function tickPersist() {
    const h = hour();
    for (const { n, d } of persist) {
      if (n._removed || n.state === 'dead') continue;
      if (d.hours) {
        const [a, b] = d.hours;
        const on = a > b ? h >= a || h < b : h >= a && h < b;
        if (n.hidden === on && offScreen(n.x, n.y)) n.hidden = !on;
      }
      for (const mv of d.moves || []) {
        if (!game.flags[mv.flag] || n._moved?.[mv.flag] || !offScreen(n.x, n.y) || !offScreen(mv.x, mv.y)) continue;
        (n._moved ||= {})[mv.flag] = true;
        n.x = mv.x;
        n.y = mv.y;
        n.home = { x: mv.x, y: mv.y };
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
        const shops = (await spawnNamed()) || new Set();
        buildPosts(shops);
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
    update(dt) {
      const p = game.player;
      if (!p || game.state !== 'play') return;
      tick += dt;
      if (tick < 0.5) return;
      tick = 0;
      ticks++;
      tickPosts(p);
      tickResidents(p);
      tickPersist();
      if ((animT -= 0.5) <= 0) {
        animT = 10;
        tickAnimals(p);
      }
    },
  };
  game.registerSystem(sys);
  return sys;
}
