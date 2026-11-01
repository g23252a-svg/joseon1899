// 장수 명령. 각 장수는 한 철에 한 번 움직인다(Koei식).
import { clamp, R, josa, pp } from './util.js';
import { REGION_BY_ID } from '../data/regions.js';
import { BUILDINGS, WONDERS, ITEMS } from '../data/buildings.js';
import { TECH_BY_ID } from '../data/techs.js';
import {
  eff, hasTrait, isRuler, officersIn, freeIn, log, regionBase, regionsOf, adjOf, canAttack, threatTo, hostileNeighbors, genOfficer,
  changeOwner, evacuateOfficers, statSum, addRelation, rulerOf, officersOf,
} from './state.js';
import { caps, mod, buildingEff, regionSlots, buildCost, factionIncome } from './rules.js';
import { createBattle } from './battle.js';

export const ACTIONS = {
  agri: { name: '개간', hanja: '開墾', group: '내정', stat: 'pol', desc: '논밭을 일구어 농업을 올린다. 정치가 높을수록 좋다.' },
  comm: { name: '상업', hanja: '商業', group: '내정', stat: 'pol', desc: '장을 키워 상업을 올린다. 정치가 높을수록 좋다.' },
  fort: { name: '축성', hanja: '築城', group: '내정', stat: 'lea', desc: '성곽을 보수하고 높인다. 통솔이 높을수록 좋다.' },
  relief: { name: '선정', hanja: '善政', group: '내정', stat: 'cha', desc: '곡식을 풀어 백성을 돌본다. 민심이 오른다.' },
  study: { name: '연구', hanja: '硏究', group: '내정', stat: 'int', desc: '문물 연구에 힘을 보탠다. 지력이 높을수록 좋다.' },
  recruit: { name: '징병', hanja: '徵兵', group: '군사', stat: 'cha', desc: '병사를 모은다. 매력이 높을수록 많이 모이나 민심이 떨어진다.' },
  train: { name: '훈련', hanja: '訓鍊', group: '군사', stat: 'lea', desc: '고을 병사의 훈련도를 올린다.' },
  move: { name: '이동', hanja: '移動', group: '군사', stat: 'lea', desc: '이웃한 자기 고을로 옮긴다. 병력을 데려갈 수 있다.' },
  transport: { name: '수송', hanja: '輸送', group: '군사', stat: 'lea', desc: '병력만 이웃한 자기 고을로 보낸다.' },
  search: { name: '탐색', hanja: '探索', group: '인사', stat: 'int', desc: '고을에 숨은 인재와 보물을 찾는다.' },
  hire: { name: '등용', hanja: '登用', group: '인사', stat: 'cha', desc: '찾아낸 재야 인물이나 적 장수를 데려온다.' },
  scheme: { name: '계략', hanja: '計略', group: '계략', stat: 'int', desc: '유언비어·이간·선동으로 적을 흔든다.' },
  envoy: { name: '외교', hanja: '外交', group: '외교', stat: 'cha', desc: '사신이 되어 다른 세력을 찾아간다.' },
  build: { name: '건설', hanja: '建設', group: '내정', stat: 'pol', desc: '고을에 건물을 짓는다.' },
  wonder: { name: '위업', hanja: '偉業', group: '내정', stat: 'pol', desc: '천하에 하나뿐인 위업을 일으킨다.' },
  naval: { name: '해전', hanja: '海戰', group: '군사', stat: 'lea', desc: '수군을 이끌고 왜 수군을 친다. 이기면 제해권이 오른다.' },
};
export const ALLY_OK = new Set(['train', 'move', 'transport', 'naval']);

const COST = {
  agri: { gold: 30 }, comm: { gold: 30 }, fort: { gold: 40 }, relief: { rice: 150 }, study: { gold: 20 }, train: { rice: 60 }, search: { gold: 10 },
  hire: { gold: 20 }, scheme: { gold: 60 }, envoy: {}, move: {}, transport: {}, build: {}, wonder: {}, recruit: {}, naval: { rice: 200 },
};
export function actionCost(S, o, act, p = {}) {
  if (act === 'recruit') { const n = recruitAmount(S, o); return { gold: Math.round(n * 0.06 * (1 + mod(S, o.faction, 'recruitCost'))), rice: Math.round(n * 0.15) }; }
  if (act === 'envoy' && p.type === 'gift') return { gold: 300 };
  if (act === 'build' && p.id) return { gold: buildCost(S, o.faction, BUILDINGS[p.id].cost) };
  if (act === 'wonder' && p.id) return { gold: buildCost(S, o.faction, WONDERS[p.id].cost) };
  return COST[act] || {};
}
export function afford(S, fid, cost) {
  const f = S.factions[fid];
  return (cost.gold || 0) <= f.gold && (cost.rice || 0) <= f.rice;
}
function pay(S, fid, cost) {
  const f = S.factions[fid];
  f.gold -= cost.gold || 0;
  f.rice -= cost.rice || 0;
}

export function recruitAmount(S, o) {
  const r = S.regions[o.loc];
  const e = eff(o);
  let n = (300 + e.cha * 10) * (1 + mod(S, o.faction, 'recruitMul') + (buildingEff(r).recruitMul || 0));
  if (hasTrait(o, '승병')) n *= 1.15;
  if (hasTrait(o, '선동') && r.loyalty < 40) n *= 1.2;
  n = Math.min(n, r.pop * 15);
  return Math.max(0, Math.round(n / 10) * 10);
}

// 장수가 이 명령을 할 수 있나 — 안 되면 이유 문자열
export function canAct(S, o, act, p = {}) {
  if (!o || o.status !== 'active') return '움직일 수 없는 인물';
  if (o.acted) return '이미 이번 철에 움직였다';
  if (o.injured > 0 && act !== 'study' && act !== 'search') return '부상 중';
  if (o.ally && !ALLY_OK.has(act)) return '원군 장수는 군사 명령만 따른다';
  const r = S.regions[o.loc];
  const f = S.factions[o.faction];
  if (r.owner !== o.faction) return '자기 고을이 아니다';
  const cost = actionCost(S, o, act, p);
  if (!afford(S, o.faction, cost)) return cost.gold ? `錢 ${cost.gold} 필요` : `米 ${cost.rice} 필요`;
  const c = caps(S, r);
  switch (act) {
    case 'agri': if (r.agri >= c.agri) return '농업이 상한에 닿았다'; break;
    case 'comm': if (r.comm >= c.comm) return '상업이 상한에 닿았다'; break;
    case 'fort': if (r.def >= c.def) return '성곽이 상한에 닿았다'; break;
    case 'relief': if (r.loyalty >= 100) return '민심이 이미 가득하다'; break;
    case 'train': if (r.training >= 100) return '훈련이 이미 최고다'; if (r.troops <= 0) return '병사가 없다'; break;
    case 'recruit': if (recruitAmount(S, o) < 100) return '모을 장정이 없다'; break;
    case 'move': {
      if (!p.to) return null;
      if (!movable(S, o.loc, p.to, o.faction)) return '이웃한 자기 고을(또는 철도역)로만 갈 수 있다';
      if ((p.troops || 0) > r.troops) return '병력이 모자라다';
      break;
    }
    case 'transport': {
      if (!p.to) return null;
      if (!movable(S, o.loc, p.to, o.faction)) return '이웃한 자기 고을(또는 철도역)로만 보낼 수 있다';
      if (!(p.troops > 0) || p.troops > r.troops) return '보낼 병력을 정하라';
      break;
    }
    case 'build': {
      if (!p.id) return r.build ? '이미 공사 중' : null;
      const B = BUILDINGS[p.id];
      if (r.build) return '이미 공사 중';
      if (r.buildings.includes(p.id)) return '이미 있다';
      if (r.buildings.length >= regionSlots(r)) return '빈 터가 없다(인구가 늘면 터가 생긴다)';
      if (B.req && !f.techs[B.req]) return `「${TECH_BY_ID[B.req].name}」 필요`;
      if (B.coastal && !REGION_BY_ID[r.id].coastal) return '바닷가 고을에만';
      if (B.resReq && !REGION_BY_ID[r.id].res.some((x) => B.resReq.includes(x))) return `${B.resReq.join('·')}이 나는 고을에만`;
      break;
    }
    case 'wonder': {
      if (f.wonder) return '이미 위업을 짓는 중';
      if (!p.id) return null;
      const W = WONDERS[p.id];
      if (S.wonders[p.id]) return '이미 세워졌다';
      if (W.req && !f.techs[W.req]) return `「${TECH_BY_ID[W.req].name}」 필요`;
      if (W.capital && f.capital !== r.id) return '도읍에서만';
      if (W.region && W.region !== r.id) return `${regionBase(W.region).name}에서만`;
      break;
    }
    case 'hire': {
      if (!p.target) return null;
      const t = S.officers[p.target];
      if (!t) return '대상 없음';
      if (t.status === 'free') { if (!t.found) return '아직 찾지 못했다'; if (S.regions[t.loc].owner !== o.faction) return '자기 고을에 있는 재야 인물만'; }
      else if (t.status === 'active') { if (t.faction === o.faction) return '같은 편'; if (isRuler(S, t)) return '군주는 데려올 수 없다'; if (t.ally) return '원군 장수'; }
      else return '등용할 수 없는 상태';
      break;
    }
    case 'scheme': {
      if (!p.type) return null;
      if (p.type === 'discord') { const t = S.officers[p.target]; if (!t || t.status !== 'active' || t.faction === o.faction || isRuler(S, t)) return '대상을 고르라'; }
      else { const tr = S.regions[p.target]; if (!tr || !tr.owner || tr.owner === o.faction) return '적 고을을 고르라'; if (!nearOwn(S, p.target, o.faction)) return '우리 땅과 맞닿은 고을만'; if (p.type === 'incite' && tr.loyalty >= 40) return '민심이 40 미만인 고을만'; }
      break;
    }
    case 'envoy': if (!p.target) return null; if (!S.factions[p.target]?.alive || p.target === o.faction) return '대상 세력을 고르라'; break;
    case 'naval': {
      if (S.scenario !== 'imjin' || o.faction !== 'joseon') return '임진년 조선 수군만';
      const base = REGION_BY_ID[r.id];
      if (!base.coastal || !['jeolla', 'gyeongsang'].includes(base.prov)) return '남해·서해 바닷가 고을에서만';
      if (r.troops < 2000) return '수군(병력) 2,000 이상 필요';
      break;
    }
  }
  return null;
}
const nearOwn = (S, rid, fid) => adjOf(rid).some((n) => S.regions[n].owner === fid);
export function movable(S, from, to, fid) {
  if (from === to || S.regions[to]?.owner !== fid) return false;
  if (adjOf(from).includes(to)) return true;
  return S.regions[from].buildings.includes('station') && S.regions[to].buildings.includes('station');
}

const pct = (x) => Math.round(x);
// 명령 실행 → { ok, msg, battle? }
export function doAction(S, o, act, p = {}) {
  const why = canAct(S, o, act, p);
  if (why) return { ok: false, msg: why };
  const r = S.regions[o.loc];
  const f = S.factions[o.faction];
  const e = eff(o);
  const c = caps(S, r);
  const cost = actionCost(S, o, act, p);
  const rname = regionBase(r.id).name;
  let msg = '';
  const jitter = () => R.range(0.9, 1.12);
  switch (act) {
    case 'agri': {
      const g = (6 + e.pol * 0.22) * (hasTrait(o, '내정') ? 1.3 : 1) * jitter();
      const before = r.agri;
      r.agri = Math.min(c.agri, r.agri + g);
      msg = `${rname} 농업 ${pct(before)} → ${pct(r.agri)}`;
      break;
    }
    case 'comm': {
      const g = (6 + e.pol * 0.22) * (hasTrait(o, '상재') ? 1.4 : hasTrait(o, '내정') ? 1.3 : 1) * jitter();
      const before = r.comm;
      r.comm = Math.min(c.comm, r.comm + g);
      msg = `${rname} 상업 ${pct(before)} → ${pct(r.comm)}`;
      break;
    }
    case 'fort': {
      const g = (6 + e.lea * 0.18) * (hasTrait(o, '축성') ? 1.5 : 1) * (1 + mod(S, o.faction, 'fort')) * jitter();
      const before = r.def;
      r.def = Math.min(c.def, r.def + g);
      msg = `${rname} 성곽 ${pct(before)} → ${pct(r.def)}`;
      break;
    }
    case 'relief': {
      const g = (3 + e.cha * 0.07) * (hasTrait(o, '인덕') ? 1.5 : 1) * jitter();
      const before = r.loyalty;
      r.loyalty = clamp(r.loyalty + g, 0, 100);
      msg = `${rname} 민심 ${pct(before)} → ${pct(r.loyalty)}`;
      break;
    }
    case 'study': {
      const g = e.int * 0.22 * (hasTrait(o, '학문') ? 1.5 : 1) * (hasTrait(o, '발명') ? 1.3 : 1) * jitter();
      if (f.research.cur) f.research.prog += g; else f.research.bank += g;
      msg = `연구 +${Math.round(g)}`;
      break;
    }
    case 'recruit': {
      const n = recruitAmount(S, o);
      const nt = 20 + mod(S, o.faction, 'recruitTrain');
      r.training = Math.round((r.troops * r.training + n * nt) / Math.max(1, r.troops + n));
      r.troops += n;
      const rl = mod(S, o.faction, 'recruitLoyal');
      const law = f.laws.army === 'mobyeong' ? 0 : f.laws.army === 'gyunyeok' ? 0.7 : 1.3;
      const drop = (n / 300) * (f.foreign ? 1.5 : law) * (hasTrait(o, '승병') ? 0.5 : 1) * (rl < 0 ? 1 : 1);
      r.loyalty = clamp(r.loyalty - drop, 0, 100);
      r.pop = Math.max(5, r.pop - n / 2000);
      f.recent.recruits += 1;
      msg = `${rname}에서 장정 ${n.toLocaleString()}명을 모았다(민심 -${Math.round(drop)})`;
      break;
    }
    case 'train': {
      const g = (3 + e.lea * 0.07) * jitter();
      const before = r.training;
      r.training = clamp(r.training + g, 0, 100);
      msg = `${rname} 훈련 ${pct(before)} → ${pct(r.training)}`;
      break;
    }
    case 'move': {
      const to = S.regions[p.to];
      const n = Math.min(r.troops, Math.max(0, Math.round(p.troops || 0)));
      if (n > 0) {
        to.training = Math.round((to.troops * to.training + n * r.training) / Math.max(1, to.troops + n));
        to.troops += n; r.troops -= n;
      }
      o.loc = p.to;
      msg = `${josa(o.name, '이/가')} ${josa(regionBase(p.to).name, '으로/로')} 옮겼다${n ? `(병력 ${n.toLocaleString()})` : ''}`;
      break;
    }
    case 'transport': {
      const to = S.regions[p.to];
      const n = Math.min(r.troops, Math.round(p.troops));
      to.training = Math.round((to.troops * to.training + n * r.training) / Math.max(1, to.troops + n));
      to.troops += n; r.troops -= n;
      msg = `병력 ${josa(n.toLocaleString(), '을/를')} ${josa(regionBase(p.to).name, '으로/로')} 보냈다`;
      break;
    }
    case 'search': msg = doSearch(S, o, r); break;
    case 'hire': msg = doHire(S, o, S.officers[p.target]); break;
    case 'scheme': msg = doScheme(S, o, p); break;
    case 'envoy': {
      pay(S, o.faction, cost);
      o.acted = true;
      return { ok: true, msg: '', envoy: true };
    }
    case 'build': {
      const B = BUILDINGS[p.id];
      let turns = B.turns - (e.pol >= 85 ? 1 : 0) - (p.id === 'navalbase' && hasTrait(o, '선박') ? 1 : 0);
      r.build = { id: p.id, left: Math.max(1, turns) };
      msg = `${rname}에 ${B.name} 공사를 시작했다(${r.build.left}철)`;
      break;
    }
    case 'wonder': {
      const W = WONDERS[p.id];
      f.wonder = { id: p.id, region: r.id, left: Math.max(3, W.turns - (e.pol >= 90 ? 1 : 0)) };
      msg = `위업 「${W.name}」 공사를 시작했다(${f.wonder.left}철)`;
      log(S, `${f.name} 세력이 ${rname}에서 「${W.name}」${pp(W.name, '을/를')} 짓기 시작했다.`, 'info', o.faction);
      break;
    }
    case 'naval': {
      pay(S, o.faction, cost);
      const navy = officersIn(S, r.id, o.faction).filter((x) => !x.acted && x.injured <= 0 && x !== o && hasTrait(x, '수군')).slice(0, 2);
      const troops = Math.min(r.troops, Math.max(2000, Math.round(p.troops || r.troops * 0.6)));
      const B = createBattle(S, { fid: o.faction, from: r.id, to: r.id, officers: [o.id, ...navy.map((x) => x.id)], troops, naval: true });
      return { ok: true, msg: '', battle: B };
    }
  }
  pay(S, o.faction, cost);
  o.acted = true;
  return { ok: true, msg };
}

function doSearch(S, o, r) {
  const e = eff(o);
  const f = S.factions[o.faction];
  const hidden = freeIn(S, r.id).filter((x) => !x.found);
  const p = 0.35 + e.int / 250 + e.cha / 300 + mod(S, o.faction, 'search');
  if (hidden.length && R.chance(p)) {
    const t = R.pick(hidden);
    t.found = true;
    // 바로 설득해 본다
    const hp = hireChance(S, o, t);
    if (R.chance(hp)) {
      joinFaction(S, t, o.faction, r.id);
      log(S, `${josa(o.name, '이/가')} 재야의 ${josa(t.name, '을/를')} 찾아 맞아들였다.`, 'good', o.faction);
      return `재야의 인재 ${josa(t.name, '을/를')} 찾아 등용했다!`;
    }
    return `${josa(t.name, '을/를')} 찾았으나 아직 마음을 열지 않았다(등용으로 다시 설득)`;
  }
  const items = S.hiddenItems?.[r.id] || [];
  if (items.length && R.chance(0.28 + e.int / 400)) {
    const it = items.shift();
    f.treasury.push(it);
    log(S, `${josa(o.name, '이/가')} ${regionBase(r.id).name}에서 보물 「${ITEMS[it].name}」${pp(ITEMS[it].name, '을/를')} 찾았다.`, 'good', o.faction);
    return `보물 「${ITEMS[it].name}」${pp(ITEMS[it].name, '을/를')} 찾았다!`;
  }
  if (roomForMore(S, o.faction) && R.chance(0.1 + (f.laws.status === 'abolish' ? 0.1 : 0))) {
    const kind = R.pick(['civil', 'military', 'specialist']);
    const t = genOfficer(S, { kind, faction: o.faction, loc: r.id, loyalty: 75 });
    log(S, `${josa(o.name, '이/가')} 숨은 인재 ${josa(t.name, '을/를')} 천거했다.`, 'good', o.faction);
    return `숨은 인재 ${josa(t.name, '을/를')} 찾아 등용했다!`;
  }
  if (R.chance(hasTrait(o, '의적') ? 0.6 : 0.25)) {
    const g = R.int(5, 20) * 10;
    f.gold += g;
    return `숨겨진 재물 錢 ${josa(g, '을/를')} 찾았다`;
  }
  return '아무것도 찾지 못했다';
}

export const roomForMore = (S, fid) => officersOf(S, fid).length < regionsOf(S, fid).length * 6 + 6;
export function hireChance(S, o, t) {
  const e = eff(o);
  const ruler = rulerOf(S, o.faction);
  const rc = ruler ? eff(ruler).cha : 50;
  if (t.status === 'free') {
    let p = 0.42 + (e.cha - 50) / 100 + (rc - 50) / 220 + (t.gen ? 0.12 : 0) - (statSum(t) > 380 ? 0.12 : 0) + Math.min(0.08, S.factions[o.faction].prestige / 4000);
    if (hasTrait(o, '외교')) p += 0.05;
    return clamp(p, 0.05, 0.92);
  }
  const foreign = S.factions[o.faction].foreign || S.factions[t.faction]?.foreign ? 0.3 : 1;
  return clamp(((75 - t.loyalty) / 100 + (e.cha - eff(t).cha * 0.5 - 25) / 150) * foreign, 0, 0.6);
}
export function joinFaction(S, t, fid, loc) {
  t.faction = fid;
  t.status = 'active';
  t.found = true;
  t.loyalty = R.int(62, 80);
  t.loc = loc;
  t.acted = true;
}
function doHire(S, o, t) {
  const p = hireChance(S, o, t);
  if (t.status === 'free') {
    if (R.chance(p)) { joinFaction(S, t, o.faction, t.loc); log(S, `${josa(t.name, '이/가')} ${S.factions[o.faction].name} 세력에 들어왔다.`, 'good', o.faction); return `${josa(t.name, '이/가')} 뜻을 함께하기로 했다!`; }
    return `${josa(t.name, '이/가')} 아직 때가 아니라며 사양했다(${Math.round(p * 100)}%)`;
  }
  if (R.chance(p)) {
    const old = t.faction;
    joinFaction(S, t, o.faction, o.loc);
    t.loyalty = R.int(50, 65);
    addRelation(S, o.faction, old, -10);
    log(S, `${S.factions[old].name}의 ${josa(t.name, '이/가')} ${S.factions[o.faction].name} 세력으로 넘어왔다.`, 'major', o.faction);
    return `${josa(t.name, '이/가')} 몰래 넘어왔다!`;
  }
  t.loyalty = clamp(t.loyalty + 3, 0, 100);
  addRelation(S, o.faction, t.faction, -4);
  return `${josa(t.name, '을/를')} 꾀었으나 실패했다(${Math.round(p * 100)}%)`;
}

export function schemeChance(S, o, p) {
  const e = eff(o);
  let base = 0;
  if (p.type === 'discord') {
    const t = S.officers[p.target];
    base = 0.35 + (e.int - eff(t).int) / 120;
  } else {
    const tr = S.regions[p.target];
    const defs = officersIn(S, tr.id, tr.owner);
    const di = defs.length ? Math.max(...defs.map((x) => eff(x).int)) : 40;
    base = (p.type === 'incite' ? 0.3 : 0.42) + (e.int - di) / 150;
    if (hasTrait(o, '선동')) base += 0.25;
  }
  if (hasTrait(o, '계략')) base += 0.15;
  base += mod(S, o.faction, 'scheme');
  return clamp(base, 0.05, 0.9);
}
function doScheme(S, o, p) {
  const ch = schemeChance(S, o, p);
  const ok = R.chance(ch);
  if (p.type === 'discord') {
    const t = S.officers[p.target];
    if (ok) { const d = R.int(10, 20); t.loyalty = clamp(t.loyalty - d, 0, 100); return `이간 성공! ${t.name}의 충성 -${d}`; }
    addRelation(S, o.faction, t.faction, -5);
    return `이간이 들통났다(${Math.round(ch * 100)}%)`;
  }
  const tr = S.regions[p.target];
  const tname = regionBase(tr.id).name;
  if (!ok) { addRelation(S, o.faction, tr.owner, -5); return `${tname}에서 계략이 실패했다(${Math.round(ch * 100)}%)`; }
  if (p.type === 'rumor') {
    const d = R.int(8, 15);
    tr.loyalty = clamp(tr.loyalty - d, 0, 100);
    tr.unrest = (tr.unrest || 0) + 6;
    tr.troops = Math.round(tr.troops * 0.97);
    return `${tname}에 유언비어가 퍼졌다. 민심 -${d}`;
  }
  // 선동 → 민란
  const old = tr.owner;
  revolt(S, tr.id);
  log(S, `${o.name}의 선동으로 ${S.factions[old]?.name || ''}의 ${tname}에서 민란이 일어났다!`, 'major', o.faction);
  return `${tname}에서 민란이 일어났다!`;
}

// 민란: 고을이 주인을 잃고 민란군이 차지
export function revolt(S, rid) {
  const r = S.regions[rid];
  const old = r.owner;
  if (!old) return;
  evacuateOfficers(S, rid, old);
  const rebels = Math.round(r.pop * 12 + r.troops * 0.5);
  changeOwner(S, rid, null, { moveOfficers: false });
  r.troops = rebels;
  r.garrisonMax = rebels;
  r.rebels = true;
  r.loyalty = 40;
  r.unrest = 0;
}

// ── 출진 ──
export function canStartAttack(S, fid, from, to, officerIds, troops) {
  const fr = S.regions[from];
  if (fr.owner !== fid) return '자기 고을에서만 출진한다';
  if (!adjOf(from).includes(to)) return '이웃한 고을만 칠 수 있다';
  if (!canAttack(S, fid, to)) return S.regions[to].owner === fid ? '자기 고을' : '맹약을 맺은 세력이다(외교에서 파기)';
  if (!officerIds.length) return '장수를 한 명 이상 고르라';
  if (officerIds.length > 5) return '장수는 다섯까지';
  for (const id of officerIds) {
    const o = S.officers[id];
    if (!o || o.faction !== fid || o.loc !== from || o.acted || o.injured > 0 || o.status !== 'active') return `${josa(o?.name || '장수', '은/는')} 나설 수 없다`;
  }
  if (!(troops >= 500)) return '병력 500 이상';
  if (troops > fr.troops) return '병력이 모자라다';
  const rice = Math.round(troops * 0.1);
  if (S.factions[fid].rice < rice) return `군량 米 ${rice} 필요`;
  return null;
}
export function startAttack(S, fid, from, to, officerIds, troops) {
  const why = canStartAttack(S, fid, from, to, officerIds, troops);
  if (why) return { ok: false, msg: why };
  S.factions[fid].rice -= Math.round(troops * 0.1);
  const B = createBattle(S, { fid, from, to, officers: officerIds, troops });
  return { ok: true, battle: B };
}

// ── 포상 ──
export function reward(S, fid, oid, kind, itemId) {
  const f = S.factions[fid];
  const o = S.officers[oid];
  if (!o || o.faction !== fid || o.status !== 'active') return '대상이 아니다';
  if (kind === 'gold') {
    if (f.gold < 100) return '錢 100 필요';
    if (o.loyalty >= 100) return '충성이 이미 가득하다';
    f.gold -= 100;
    o.loyalty = clamp(o.loyalty + R.int(6, 12), 0, 100);
    return null;
  }
  const idx = f.treasury.indexOf(itemId);
  if (idx < 0) return '보물이 없다';
  f.treasury.splice(idx, 1);
  if (o.item) f.treasury.push(o.item);
  o.item = itemId;
  o.loyalty = clamp(o.loyalty + 15, 0, 100);
  log(S, `${o.name}에게 「${ITEMS[itemId].name}」${pp(ITEMS[itemId].name, '을/를')} 하사했다.`, 'good', fid);
  return null;
}

// ── 위임(자동 내정) ──
export const POLICIES = {
  balance: { name: '균형', desc: '부족한 것부터 고루' },
  agri: { name: '농업', desc: '개간 위주' },
  comm: { name: '상업', desc: '상업 위주' },
  mil: { name: '군사', desc: '징병·훈련·축성' },
  sci: { name: '학문', desc: '연구 위주' },
  def: { name: '방어', desc: '축성·훈련' },
};
export function autoOfficer(S, o, policy = 'balance', opts = {}) {
  if (o.acted || o.status !== 'active' || o.injured > 0) return null;
  const r = S.regions[o.loc];
  const f = S.factions[o.faction];
  if (r.owner !== o.faction) return null;
  const e = eff(o);
  const c = caps(S, r);
  const threat = threatTo(S, r.id, o.faction);
  const frontier = threat > 0 || adjOf(r.id).some((n) => !S.regions[n].owner);
  const inc = opts.income || factionIncome(S, o.faction);
  const riceOk = inc.netRice - recruitAmount(S, o) * 0.06 > -150 || f.rice > inc.troops * 0.6 + 1500;
  const rich = f.rice > 30000 && inc.netRice > 0 && f.gold > 2000;
  const desired = Math.min(Math.max(2500, threat * 1.05, rich ? r.pop * 80 : 0), r.pop * 110);
  const W = {
    balance: { agri: 1, comm: 1, fort: 0.5, relief: 1, recruit: 0.7, train: 0.5, study: 0.6, search: 0.4 },
    agri: { agri: 3, comm: 0.5, fort: 0.3, relief: 1, recruit: 0.3, train: 0.3, study: 0.3, search: 0.3 },
    comm: { agri: 0.5, comm: 3, fort: 0.3, relief: 1, recruit: 0.3, train: 0.3, study: 0.3, search: 0.3 },
    mil: { agri: 0.3, comm: 0.3, fort: 1.2, relief: 0.8, recruit: 2.5, train: 2, study: 0.2, search: 0.2 },
    sci: { agri: 0.5, comm: 0.5, fort: 0.3, relief: 0.8, recruit: 0.3, train: 0.3, study: 3, search: 0.5 },
    def: { agri: 0.4, comm: 0.4, fort: 2.5, relief: 0.8, recruit: 1.2, train: 1.8, study: 0.2, search: 0.2 },
  }[policy] || {};
  if (o.ally) { for (const k in W) if (k !== 'train') W[k] = 0; W.train = 1; }
  const need = {
    agri: (c.agri - r.agri) / c.agri,
    comm: (c.comm - r.comm) / c.comm,
    fort: ((c.def - r.def) / c.def) * (frontier ? 1.4 : 0.4),
    relief: clamp((72 - r.loyalty) / 30, 0, 2),
    recruit: riceOk && r.loyalty > 35 && r.troops < desired ? clamp((desired - r.troops) / 5000, 0, 1.5) + (frontier ? 0.2 : 0) : 0,
    train: r.troops > 1000 ? (85 - r.training) / 85 : 0,
    study: f.research.cur ? 0.6 : 0.3,
    search: freeIn(S, r.id).some((x) => !x.found) ? 0.9 : 0.12,
  };
  const apt = { agri: e.pol, comm: e.pol, fort: e.lea, relief: e.cha, recruit: e.cha, train: e.lea, study: e.int, search: (e.int + e.cha) / 2 };
  const reserve = opts.reserve ?? 150;
  const cands = Object.keys(W).filter((a) => W[a] > 0 && need[a] > 0.02 && !canAct(S, o, a)).filter((a) => {
    const cost = actionCost(S, o, a);
    return (cost.gold || 0) + reserve <= f.gold && (cost.rice || 0) + 300 <= f.rice;
  });
  if (!cands.length) return null;
  let best = null, bs = -1;
  for (const a of cands) {
    const s = W[a] * need[a] * (apt[a] / 100) * R.range(0.85, 1.15);
    if (s > bs) { bs = s; best = a; }
  }
  return best ? doAction(S, o, best) : null;
}
export function delegateRegion(S, rid, opts = {}) {
  const r = S.regions[rid];
  if (!r.owner) return;
  const offs = officersIn(S, rid, r.owner).filter((o) => !o.acted).sort((a, b) => statSum(b) - statSum(a));
  const income = factionIncome(S, r.owner);
  for (const o of offs) autoOfficer(S, o, r.policy, { ...opts, income });
}
export { officersOf, regionsOf, hostileNeighbors };
