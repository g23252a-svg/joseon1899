// 게임 상태 만들기와 공용 조회 도구. 상태 S 는 JSON 으로 그대로 저장된다.
import { R, clamp, strHash, josa } from './util.js';
import { REGIONS, REGION_BY_ID } from '../data/regions.js';
import { OFFICERS, OFFICER_BY_ID, SURNAMES, GIVEN_A, GIVEN_B } from '../data/officers.js';
import { SCENARIOS } from '../data/scenarios.js';
import { IGS, DEFAULT_LAWS, BASE_CLOUT } from '../data/politics.js';
import { ITEMS } from '../data/buildings.js';
import { adjOf, buildGeo } from './geo.js';
export { adjOf };

export const VERSION = 1;
export const SEASONS = ['봄', '여름', '가을', '겨울'];
export const DIFFICULTY = {
  easy: { name: '쉬움', aiIncome: 0.85, playerIncome: 1.15, aiAggrVsPlayer: -0.25, start: 1.4 },
  normal: { name: '보통', aiIncome: 1.0, playerIncome: 1.0, aiAggrVsPlayer: 0, start: 1.0 },
  hard: { name: '어려움', aiIncome: 1.2, playerIncome: 0.95, aiAggrVsPlayer: 0.12, start: 0.9 },
  legend: { name: '전설', aiIncome: 1.45, playerIncome: 0.9, aiAggrVsPlayer: 0.25, start: 0.8 },
};

export function newGame({ scenario = 'allstar', player, difficulty = 'normal', seed } = {}) {
  buildGeo();
  const sc = SCENARIOS[scenario];
  if (!sc) throw new Error('시나리오 없음: ' + scenario);
  R.seed(seed ?? ((Date.now() % 1e9) ^ 0x5bd1e995));
  const S = {
    version: VERSION,
    scenario: sc.id,
    year: sc.startYear,
    season: 0,
    turn: 0,
    player: player || sc.factions[0].id,
    difficulty,
    regions: {},
    factions: {},
    officers: {},
    wonders: {},
    log: [],
    scn: {},
    nextId: 1,
    over: null,
    settings: { autoBattle: false, battleSpeed: 1 },
    stats: { battles: 0 },
    rng: 0,
  };
  // 고을
  for (const base of REGIONS) {
    S.regions[base.id] = {
      id: base.id, owner: null, pop: base.pop, agri: base.agri, comm: base.comm, def: base.def,
      loyalty: 55, troops: Math.round(base.pop * 14 + R.int(0, 6) * 100), training: 30,
      buildings: [], build: null, delegate: true, policy: 'balance', garrisonMax: 0, rebels: false, unrest: 0,
    };
    S.regions[base.id].garrisonMax = S.regions[base.id].troops;
  }
  // 세력
  const allIds = REGIONS.map((r) => r.id);
  for (const fd of sc.factions) {
    let regs = fd.regions;
    if (typeof regs === 'string' && regs.startsWith('*except:')) {
      const ex = regs.slice(8).split(',');
      regs = allIds.filter((id) => !ex.includes(id));
    }
    const f = {
      id: fd.id, name: fd.name, crest: fd.crest, color: fd.color, ruler: fd.ruler, capital: fd.capital,
      gold: fd.gold, rice: fd.rice, legit: fd.legit, prestige: 50, prestigeTotal: 0, foreign: !!fd.foreign,
      techs: {}, research: { cur: null, prog: 0, bank: 0 }, laws: { ...DEFAULT_LAWS }, taxLevel: 1,
      igs: {}, relations: {}, treaties: {}, alive: true, ai: fd.ai, personality: fd.ai,
      treasury: [], wonder: null, recent: { wins: 0, losses: 0, recruits: 0, battles: 0 },
      stats: { won: 0, lost: 0, captured: 0, maxRegions: 0 }, desc: fd.desc,
    };
    for (const t of fd.techs || []) f.techs[t] = true;
    for (const ig in IGS) f.igs[ig] = { appr: 0, clout: BASE_CLOUT[ig] };
    S.factions[f.id] = f;
    for (const rid of regs) {
      const r = S.regions[rid];
      r.owner = f.id;
      r.loyalty = 65;
      r.training = 45;
      const tr = fd.troops?.[rid] ?? fd.troops?.['*'];
      r.troops = tr != null ? tr : Math.round(r.pop * 18);
      r.delegate = rid !== f.capital;
    }
  }
  for (const a in S.factions) for (const b in S.factions) if (a !== b) S.factions[a].relations[b] = 0;
  if (sc.special === 'imjin') {
    S.factions.joseon.relations.wae = -100;
    S.factions.wae.relations.joseon = -100;
  }
  // 인물
  const place = (id, fields) => {
    const base = OFFICER_BY_ID[id];
    if (!base) throw new Error('인물 없음: ' + id);
    S.officers[id] = {
      id, name: base.name, hanja: base.hanja, look: base.look, lea: base.lea, str: base.str, int: base.int, pol: base.pol, cha: base.cha,
      traits: [...base.traits], bio: base.bio, faction: null, loc: null, loyalty: 70, status: 'free', acted: false, item: null,
      found: false, injured: 0, seed: strHash(id), ...fields,
    };
  };
  for (const [id, fid, loc, loy] of sc.officers) place(id, { faction: fid, loc, loyalty: loy, status: 'active', found: true });
  for (const [id, loc] of sc.free || []) place(id, { loc, status: 'free', found: false });
  for (const [id, loc, cond] of sc.hidden || []) place(id, { loc, status: 'hidden', appear: cond });
  for (const fd of sc.factions) {
    for (let i = 0; i < (fd.genBandits || 0); i++) {
      genOfficer(S, { kind: 'bandit', faction: fd.id, loc: fd.regions[i % fd.regions.length], loyalty: 85 });
    }
  }
  // 난이도: 시작 자원
  const D = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const pf = S.factions[S.player];
  pf.gold = Math.round(pf.gold * D.start);
  pf.rice = Math.round(pf.rice * D.start);
  for (const r of Object.values(S.regions)) if (r.owner === S.player) r.delegate = r.id !== pf.capital;
  // 시나리오 상태
  if (sc.special === 'imjin') {
    // 전란으로 무너진 살림: 조선의 세수는 처음에 크게 줄었다가 해마다 회복된다
    S.scn = { sea: 20, waeNavy: 14000, truce: false, hideyoshi: true, econ: { joseon: 0.6, wae: 0.7 } };
    for (const r of Object.values(S.regions)) {
      if (r.owner !== 'joseon') continue;
      r.def = Math.round(r.def * 0.6);
      r.training = 25;
      r.loyalty = 50;
    }
  }
  // 보물 몇 개를 세상에 흩어 둔다(탐색으로 찾음)
  S.hiddenItems = {};
  const itemIds = R.shuffle(Object.keys(ITEMS));
  const regs = R.shuffle([...allIds]);
  itemIds.forEach((it, i) => { S.hiddenItems[regs[i % regs.length]] = (S.hiddenItems[regs[i % regs.length]] || []).concat(it); });
  for (const f of Object.values(S.factions)) f.stats.maxRegions = regionsOf(S, f.id).length;
  S.rng = R.getState();
  log(S, `${sc.name} — ${dateStr(S)}. ${S.factions[S.player].name} 세력으로 천하를 다툰다.`, 'system');
  return S;
}

// ── 조회 도구 ──
export const scenarioOf = (S) => SCENARIOS[S.scenario];
export const regionBase = (id) => REGION_BY_ID[id];
export const regionsOf = (S, fid) => Object.values(S.regions).filter((r) => r.owner === fid);
export const officersOf = (S, fid) => Object.values(S.officers).filter((o) => o.faction === fid && o.status === 'active');
export const officersIn = (S, rid, fid) =>
  Object.values(S.officers).filter((o) => o.status === 'active' && o.loc === rid && (fid === undefined || o.faction === fid));
export const freeIn = (S, rid, onlyFound) => Object.values(S.officers).filter((o) => o.status === 'free' && o.loc === rid && (!onlyFound || o.found));
export const isRuler = (S, o) => !!o.faction && S.factions[o.faction]?.ruler === o.id;
export const rulerOf = (S, fid) => S.officers[S.factions[fid]?.ruler];
export const hasTech = (S, fid, t) => !!S.factions[fid]?.techs[t];
export const hasTrait = (o, t) => !!o && o.traits.includes(t);
export const anyTrait = (offs, t) => offs.some((o) => hasTrait(o, t));
export const dateStr = (S) => {
  const sc = SCENARIOS[S.scenario];
  return sc.era ? `${sc.era} ${S.year}년 ${SEASONS[S.season]}` : `${S.year}년 ${SEASONS[S.season]}`;
};
export const totalTroops = (S, fid) => regionsOf(S, fid).reduce((s, r) => s + r.troops, 0);
export const aliveFactions = (S) => Object.values(S.factions).filter((f) => f.alive);

export function eff(o) {
  const it = o.item ? ITEMS[o.item] : null;
  const s = it?.stat || {};
  return {
    lea: clamp(o.lea + (s.lea || 0), 1, 120), str: clamp(o.str + (s.str || 0), 1, 120), int: clamp(o.int + (s.int || 0), 1, 120),
    pol: clamp(o.pol + (s.pol || 0), 1, 120), cha: clamp(o.cha + (s.cha || 0), 1, 120),
  };
}
export const statSum = (o) => { const e = eff(o); return e.lea + e.str + e.int + e.pol + e.cha; };

export function log(S, text, kind = 'info', fid = null) {
  S.log.push({ t: S.turn, d: dateStr(S), text, kind, fid });
  if (S.log.length > 600) S.log.splice(0, S.log.length - 600);
}

export function relation(S, a, b) { return a && b ? S.factions[a]?.relations[b] ?? 0 : 0; }
export function addRelation(S, a, b, d) {
  if (!a || !b || a === b) return;
  const fa = S.factions[a], fb = S.factions[b];
  if (!fa || !fb) return;
  fa.relations[b] = clamp((fa.relations[b] ?? 0) + d, -100, 100);
  fb.relations[a] = clamp((fb.relations[a] ?? 0) + d, -100, 100);
}
export function treaty(S, a, b) {
  const t = S.factions[a]?.treaties[b];
  if (!t) return null;
  if (t.until != null && t.until < S.turn) return null;
  return t;
}
export function setTreaty(S, a, b, type, turns) {
  const until = turns ? S.turn + turns : null;
  S.factions[a].treaties[b] = { type, until };
  S.factions[b].treaties[a] = { type, until };
}
export function clearTreaty(S, a, b) {
  delete S.factions[a]?.treaties[b];
  delete S.factions[b]?.treaties[a];
}
// 공격할 수 있는 상대인가(동맹·휴전은 불가, 중립은 가능)
export function canAttack(S, fid, rid) {
  const r = S.regions[rid];
  if (!r || r.owner === fid) return false;
  if (!r.owner) return true;
  const t = treaty(S, fid, r.owner);
  return !t;
}
export function hostileNeighbors(S, rid, fid) {
  return adjOf(rid).filter((n) => {
    const r = S.regions[n];
    return r.owner && r.owner !== fid && !treaty(S, fid, r.owner);
  });
}
export function threatTo(S, rid, fid) {
  let t = 0;
  for (const n of adjOf(rid)) {
    const r = S.regions[n];
    if (r.owner && r.owner !== fid && !treaty(S, fid, r.owner)) t = Math.max(t, r.troops);
  }
  return t;
}

// ── 무명 인물 만들기 ──
export function genName(S) {
  const used = new Set(Object.values(S.officers).map((o) => o.name));
  for (let i = 0; i < 40; i++) {
    const n = R.pick(SURNAMES) + R.pick(GIVEN_A) + R.pick(GIVEN_B);
    if (!used.has(n)) return n;
  }
  return R.pick(SURNAMES) + R.pick(GIVEN_A) + R.pick(GIVEN_B) + R.int(2, 9);
}
const KINDS = {
  civil: { look: 'civil', base: [35, 25, 65, 65, 55], spread: 22, traits: ['내정', '학문', '외교', '상재'] },
  military: { look: 'military', base: [65, 65, 45, 35, 50], spread: 22, traits: ['기병', '궁술', '돌격', '수성', '화포'] },
  specialist: { look: 'scholar', base: [25, 25, 70, 50, 50], spread: 20, traits: ['의술', '발명', '지리', '축성', '선박'] },
  bandit: { look: 'rebel', base: [55, 68, 40, 25, 55], spread: 18, traits: ['돌격', '매복', '의적'] },
  militia: { look: 'military', base: [58, 60, 52, 40, 62], spread: 18, traits: ['의병', '매복', '수성'] },
  rebel: { look: 'rebel', base: [55, 58, 48, 35, 60], spread: 18, traits: ['선동', '돌격'] },
  garrison: { look: 'military', base: [45, 45, 40, 35, 40], spread: 12, traits: [] },
};
export function genOfficer(S, { kind = 'civil', faction = null, loc, loyalty = 70, bonus = 0, status, name } = {}) {
  const K = KINDS[kind] || KINDS.civil;
  const id = 'g' + S.nextId++;
  const st = K.base.map((b) => clamp(Math.round(b + bonus + R.range(-K.spread, K.spread) * (0.5 + R.next() * 0.5)), 8, 96));
  const traits = [];
  if (R.chance(0.75)) traits.push(R.pick(K.traits));
  if (R.chance(0.2)) {
    const t = R.pick(K.traits);
    if (!traits.includes(t)) traits.push(t);
  }
  const o = {
    id, name: name || genName(S), hanja: '', look: K.look, lea: st[0], str: st[1], int: st[2], pol: st[3], cha: st[4],
    traits, bio: { civil: '과거에 급제한 문신.', military: '무과에 급제한 무관.', specialist: '잡과 출신의 기술 관료.', bandit: '산채에서 이름을 얻은 두령.', militia: '고을을 지키려 일어선 의병장.', rebel: '민란을 이끈 장두.', garrison: '고을의 토호.' }[kind],
    faction, loc, loyalty, status: status || (faction ? 'active' : 'free'), acted: false, item: null, found: !!faction, injured: 0, gen: true, seed: strHash(id + S.nextId),
  };
  S.officers[id] = o;
  return o;
}

// ── 소유 변경 ──
// 고을 주인을 바꾼다. 옛 주인의 장수는 이웃 자기 땅으로 피하거나 포로가 된다(battle 이 따로 처리할 때는 moveOfficers=false).
export function changeOwner(S, rid, newOwner, { moveOfficers = true, keepTroops = false } = {}) {
  const r = S.regions[rid];
  const old = r.owner;
  if (old === newOwner) return;
  r.owner = newOwner;
  r.build = null;
  if (!keepTroops) r.troops = 0;
  if (old && moveOfficers) evacuateOfficers(S, rid, old);
  if (old) {
    const f = S.factions[old];
    if (f.wonder && f.wonder.region === rid) f.wonder = null;
    if (f.capital === rid) relocateCapital(S, old);
  }
  if (newOwner) {
    const nf = S.factions[newOwner];
    nf.stats.maxRegions = Math.max(nf.stats.maxRegions, regionsOf(S, newOwner).length);
    r.delegate = newOwner === S.player ? true : true;
    r.rebels = false;
  }
  if (old) checkFactionAlive(S, old);
}
export function evacuateOfficers(S, rid, fid) {
  const offs = officersIn(S, rid, fid);
  if (!offs.length) return;
  const dest = nearestOwned(S, rid, fid);
  for (const o of offs) {
    if (dest) o.loc = dest;
    else {
      o.faction = null;
      o.status = 'free';
      o.found = true;
    }
  }
}
export function nearestOwned(S, rid, fid) {
  const seen = new Set([rid]);
  let frontier = [rid];
  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const n of adjOf(id)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (S.regions[n].owner === fid) return n;
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
export function relocateCapital(S, fid) {
  const f = S.factions[fid];
  const regs = regionsOf(S, fid);
  if (!regs.length) return;
  const best = regs.sort((a, b) => b.pop - a.pop)[0];
  f.capital = best.id;
  f.legit = clamp(f.legit - 15, 0, 100);
  log(S, `${f.name} 세력이 도읍을 ${josa(regionBase(best.id).name, '으로/로')} 옮겼다.`, 'war', fid);
}
export function checkFactionAlive(S, fid) {
  const f = S.factions[fid];
  if (!f || !f.alive) return;
  if (regionsOf(S, fid).length > 0) return;
  f.alive = false;
  for (const o of officersOf(S, fid)) {
    o.faction = null;
    o.status = 'free';
    o.found = true;
  }
  for (const other of Object.values(S.factions)) {
    delete other.treaties[fid];
  }
  log(S, `${f.name} 세력이 멸망했다.`, 'major', fid);
}
// 군주가 없어졌을 때 후계자
export function succession(S, fid) {
  const f = S.factions[fid];
  if (!f?.alive) return;
  const cands = officersOf(S, fid).filter((o) => !o.ally).sort((a, b) => statSum(b) + b.cha - (statSum(a) + a.cha));
  if (!cands.length) {
    const regs = regionsOf(S, fid);
    const cap = S.regions[f.capital] ? f.capital : regs[0]?.id;
    if (!cap) return;
    const o = genOfficer(S, { kind: 'militia', faction: fid, loc: cap, loyalty: 100, bonus: 5 });
    f.ruler = o.id;
    log(S, `${f.name} 세력의 남은 무리가 ${josa(o.name, '을/를')} 새 우두머리로 세웠다.`, 'major', fid);
    return;
  }
  const heir = cands[0];
  f.ruler = heir.id;
  heir.loyalty = 100;
  f.legit = clamp(f.legit - 15, 0, 100);
  for (const o of officersOf(S, fid)) if (o !== heir) o.loyalty = clamp(o.loyalty - 5, 0, 100);
  log(S, `${f.name} 세력은 ${josa(heir.name, '이/가')} 뒤를 이었다.`, 'major', fid);
}
export function factionPower(S, fid) {
  const regs = regionsOf(S, fid);
  const troops = regs.reduce((s, r) => s + r.troops, 0);
  const offs = officersOf(S, fid);
  const q = offs.length ? offs.reduce((s, o) => s + o.lea + o.str, 0) / offs.length / 120 : 0.5;
  return troops * (0.6 + q) + regs.length * 1500;
}
export function syncRng(S) { S.rng = R.getState(); }
export function factionsList(S) { return Object.values(S.factions); }
