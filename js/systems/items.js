// 아이템 정의 [파밍] — 스펙 D.1 (35종) + 퀘스트·차표. itemDef(id) 는 가죽 품질(pelt_<종>_q1~3)과 차표 구간 id 도 만든다.
// use 효과 형식(설명·stats 가 없을 때 쓰는 값): {hp, stamina, hoan, full:['stamina'|'hoan'], buff:{stat, mul, hours}, drunk:시간, horse:{stamina, hp, bond}}
// 아래 smod·nowHours 는 파밍 모듈들이 같이 쓰는 작은 도우미다.

import { PAL } from '../engine/palette.js';

const I = (id, name, cat, stack, price, shape, color, desc, use) => ({ id, name, cat, stack, price, desc, ...(use ? { use } : {}), icon: { shape, color } });

const LIST = [
  I('w_knife', '장도', 'weapon', 1, 30, 'blade', PAL.wallStone, '허리에 차는 짧은 칼. 가볍고 소리가 작다.'),
  I('w_club', '몽둥이', 'weapon', 1, 8, 'blade', PAL.timber, '박달나무 몽둥이. 죽이지 않고 쓰러뜨리기 좋다.'),
  I('w_hwando', '환도', 'weapon', 1, 120, 'blade', PAL.ink3, '군인·순검이 차는 긴 칼.'),
  I('w_bow', '각궁', 'weapon', 1, 60, 'bow', PAL.timber, '물소뿔 활. 소리 없이 쏜다. 화살을 쓴다.'),
  I('w_matchlock', '화승총', 'weapon', 1, 150, 'gun', PAL.timber, '화승에 불을 붙여 쏘는 조총. 연환과 화승을 쓴다.'),
  I('w_rifle', '양총', 'weapon', 1, 900, 'gun', PAL.ink2, '단발 후장식 서양 소총. 양총 탄을 쓴다.'),
  I('w_revolver', '육혈포', 'weapon', 1, 700, 'pistol', PAL.ink2, '여섯 발 회전식 권총. 드문 물건이다.'),
  I('a_arrow', '화살', 'ammo', 40, 2, 'arrow', PAL.timber, '각궁에 메기는 화살.'),
  I('a_ball', '연환', 'ammo', 30, 1, 'bullet', PAL.rock, '화승총에 재는 납 탄환.'),
  I('a_matchcord', '화승', 'ammo', 10, 2, 'bundle', PAL.roofThatch, '화승총 불씨 끈. 한 가닥이 300초 탄다.'),
  I('a_rifle', '양총 탄', 'ammo', 40, 4, 'bullet', PAL.gold, '양총 탄약.'),
  I('a_revolver', '육혈포 탄', 'ammo', 36, 3, 'bullet', PAL.gold, '육혈포 탄약.'),
  I('c_roast', '구운 고기', 'consumable', 10, 4, 'meat', PAL.timber, '체력 +25.', { hp: 25 }),
  I('c_gukbap', '국밥', 'consumable', 5, 5, 'rice', PAL.white, '체력 +40, 기력 +20. 주막에서 사 먹으면 그날 잠이 공짜다.', { hp: 40, stamina: 20 }),
  I('c_makgeolli', '탁주', 'consumable', 5, 2, 'bottle', PAL.white, '호안 +15, 기력 +10. 한 시진 동안 취해 총이 흔들린다.', { hoan: 15, stamina: 10, drunk: 1 }),
  I('c_salve', '고약', 'consumable', 10, 15, 'pouch', PAL.ink2, '체력 +50. 바르는 데 1.5초.', { hp: 50, time: 1.5 }),
  I('c_galgeun', '갈근탕', 'consumable', 5, 12, 'bottle', PAL.timber, '기력 가득. 한 시진 동안 기력이 덜 준다.', { full: ['stamina'], buff: { stat: 'staminaDrain', mul: 0.7, hours: 1 } }),
  I('c_cheongsim', '청심환', 'consumable', 5, 40, 'gem', PAL.gold, '호안 가득. 두 시진 동안 호안이 덜 준다.', { full: ['hoan'], buff: { stat: 'hoanDrain', mul: 0.8, hours: 2 } }),
  I('m_meat', '날고기', 'meat', 20, 2, 'meat', null, '체력 +5. 불에 구우면 구운 고기.', { hp: 5 }),
  I('pelt_roe_deer', '노루 가죽', 'pelt', 10, 40, 'pelt', PAL.timber, '팔 물건.'),
  I('pelt_water_deer', '고라니 가죽', 'pelt', 10, 25, 'pelt', PAL.mud, '팔 물건.'),
  I('pelt_boar', '멧돼지 가죽', 'pelt', 10, 50, 'pelt', PAL.ink2, '팔 물건.'),
  I('pelt_wolf', '늑대 가죽', 'pelt', 10, 60, 'pelt', PAL.ink3, '팔 물건.'),
  I('pelt_fox', '여우 가죽', 'pelt', 10, 45, 'pelt', PAL.dusk, '팔 물건.'),
  I('pelt_tiger', '범 가죽', 'pelt', 3, 600, 'pelt', PAL.tiger, '팔 물건. 범 가죽 한 장 값이 표범의 다섯 배다.'),
  I('mat_feather', '꿩 깃', 'material', 40, 1, 'feather', PAL.white, '화살 재료.'),
  I('h_galgeun', '칡뿌리', 'herb', 30, 2, 'root', PAL.roofThatch, '기력 +5. 갈근탕·화승 재료.', { stamina: 5 }),
  I('h_ssuk', '쑥', 'herb', 30, 1, 'leaf', PAL.treeLight, '체력 +3. 고약 재료.', { hp: 3 }),
  I('h_dangwi', '참당귀', 'herb', 30, 5, 'root', PAL.brick, '체력 +5. 고약 재료.', { hp: 5 }),
  I('h_doraji', '도라지', 'herb', 30, 3, 'root', PAL.white, '체력 +3, 기력 +5. 고깃국 재료.', { hp: 3, stamina: 5 }),
  I('h_omija', '오미자', 'herb', 30, 4, 'leaf', PAL.seal, '기력 +10. 갈근탕 재료.', { stamina: 10 }),
  I('mat_ssari', '싸리', 'material', 30, 1, 'bundle', PAL.treeLight, '화살대·몽둥이 재료.'),
  I('mat_powder', '화약·납알 한 봉', 'material', 20, 8, 'pouch', PAL.ink3, '연환·화승 재료.'),
  I('f_maljuk', '말죽', 'consumable', 10, 2, 'rice', PAL.paddyRipe, '말 기력 +40, 체력 +20. 말 곁(3 m)에서 먹인다.', { horse: { stamina: 40, hp: 20, bond: 6 } }),
  I('v_watch', '회중시계', 'valuable', 5, 300, 'coin', PAL.gold, '장물아비만 산다.'),
];

/** D.1 35종 (id → 정의) */
export const ITEMS = Object.fromEntries(LIST.map((d) => [d.id, d]));

// 퀘스트·차표 (35종 밖. 값 0, 팔 수 없음)
const Q = (id, name, shape, desc, extra = {}) => ({ id, name, cat: 'quest', stack: 1, price: 0, desc, icon: { shape }, noSell: true, ...extra });
export const QUEST_ITEMS = Object.fromEntries(
  [
    Q('q_ssamji', '오장헌의 쌈지', 'pouch', '오장헌이 맡긴 담배쌈지.'),
    Q('q_jail_key', '옥 열쇠', 'key', '경무청 옥사 열쇠.'),
    Q('q_fare_bag', '차장 요금 주머니', 'pouch', '안의 돈은 이미 챙겼다.'),
    Q('q_rival_tag', '불여우 목패', 'scroll', '불여우패의 나무 패.'),
    Q('q_rifle_bales', '소금 가마니', 'bundle', '양총 네 정이 든 가마니. 무거운 짐.', { heavy: true }),
    Q('q_strongbox', '회사 철궤', 'box', '철도 회사의 쇠궤짝. 무거운 짐.', { heavy: true }),
    Q('q_ledger', '토지 매수 장부', 'scroll', '누가 어느 땅을 사들였는지 적힌 장부.'),
    Q('q_plate', '백동화 판형', 'stone', '백동화를 찍는 판.'),
    Q('q_newspaper', '신문', 'scroll', '독립·황성·제국 신문.', { stack: 5 }),
    Q('q_torn_jige', '찢긴 지게', 'bundle', '끈이 끊어진 지게.'),
    ...[1, 2, 3].map((c) => Q(`ticket_train_${c}`, `경인선 ${c}등 표`, 'scroll', '한 번 쓰는 차표. 산 구간만 탈 수 있다.', { cat: 'ticket', stack: 4 })),
  ].map((d) => [d.id, d])
);

export const STATIONS = { noryangjin: '노량진', oryu: '오류동', sosa: '소사', chukhyeon: '축현', jemulpo: '인천' };
export const QUALITY_MUL = [0, 0.5, 1.0, 1.6];
const cache = new Map();

/** id → 정의 | null. pelt_<종>_q1~3, ticket_train_<등>@<출발>-<도착> 은 자동으로 만든다 */
export function itemDef(id) {
  if (typeof id !== 'string') return null;
  const d = ITEMS[id] || QUEST_ITEMS[id] || cache.get(id);
  if (d) return d;
  let m = /^(pelt_[a-z_]+)_q([123])$/.exec(id);
  if (m && ITEMS[m[1]]) {
    const b = ITEMS[m[1]], q = +m[2];
    const v = { ...b, id, base: b.id, quality: q, name: `${b.name} (${q}성)`, price: Math.round(b.price * QUALITY_MUL[q]) };
    cache.set(id, v);
    return v;
  }
  m = /^ticket_train_([123])@([a-z]+)-([a-z]+)$/.exec(id);
  if (m && STATIONS[m[2]] && STATIONS[m[3]]) {
    const b = QUEST_ITEMS[`ticket_train_${m[1]}`];
    const v = { ...b, id, base: b.id, route: { cls: +m[1], from: m[2], to: m[3] }, name: `${b.name} · ${STATIONS[m[2]]}→${STATIONS[m[3]]}` };
    cache.set(id, v);
    return v;
  }
  return null;
}

/** 스킬 보정값 (skills 가 없으면 base) */
export function smod(game, key, base = 1) {
  const v = game.sys.skills?.mod?.(key, base);
  return Number.isFinite(v) ? v : base;
}

/** 자정에 끊기지 않는 누적 게임 시각(시간) */
export function nowHours(game) {
  const t = game.sys.time;
  return t && Number.isFinite(t.hour) ? ((t.day || 1) - 1) * 24 + t.hour : game.time / 120;
}

