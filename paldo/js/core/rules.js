// 경제·내정·정치 규칙. 수식은 한곳에 모아 둔다(UI 의 예상치도 이 함수를 그대로 쓴다).
import { clamp, R, josa, pp } from './util.js';
import { TECH_BY_ID, TECHS } from '../data/techs.js';
import { LAWS, IGS, TAX_LEVELS, BASE_CLOUT } from '../data/politics.js';
import { BUILDINGS, WONDERS, RESOURCES } from '../data/buildings.js';
import { REGION_BY_ID } from '../data/regions.js';
import { regionsOf, officersOf, officersIn, log, hasTrait, eff, regionBase, rulerOf, DIFFICULTY, hasTech } from './state.js';

export const SEASON_RICE = [0.6, 0.8, 2.0, 0.6];
export const lawOpt = (cat, id) => LAWS[cat]?.options.find((o) => o.id === id);

// 세력 보정치 합계(기술+법령+위업+세력 집단+특산물)
export function mod(S, fid, key) {
  const f = S.factions[fid];
  if (!f) return 0;
  let v = 0;
  for (const t in f.techs) v += TECH_BY_ID[t]?.eff?.[key] || 0;
  if (!f.foreign) {
    for (const cat in f.laws) v += lawOpt(cat, f.laws[cat])?.eff?.[key] || 0;
    v += igBonus(S, fid, key);
  }
  for (const w in S.wonders) if (S.wonders[w].owner === fid) v += WONDERS[w].eff[key] || 0;
  v += resMod(S, fid)[key] || 0;
  return v;
}

// 특산물 효과(몇몇은 3곳까지만 쌓임)
const CAP3 = new Set(['power', 'charge', 'buildCost']);
export function resMod(S, fid) {
  const out = {};
  const counts = {};
  for (const r of regionsOf(S, fid)) {
    for (const res of regionBase(r.id).res) {
      counts[res] = (counts[res] || 0) + 1;
      const e = RESOURCES[res]?.eff || {};
      for (const k in e) {
        if (k === 'loyal') continue; // 고을 단위
        if (CAP3.has(k) && counts[res] > 3) continue;
        out[k] = (out[k] || 0) + e[k];
      }
    }
  }
  return out;
}

export function igBonus(S, fid, key) {
  const f = S.factions[fid];
  const g = f.igs;
  let v = 0;
  const good = (id) => g[id] && g[id].clout >= 5 && g[id].appr >= 30;
  const bad = (id) => g[id] && g[id].clout >= 5 && g[id].appr <= -30;
  if (key === 'sciMul') { if (good('sarim')) v += 0.1; if (good('gaehwa')) v += 0.1; }
  if (key === 'goldMul') { if (good('sangin')) v += 0.1; if (bad('sangin')) v -= 0.2; if (good('gaehwa')) v += 0.05; }
  if (key === 'riceMul') { if (good('nongmin')) v += 0.1; }
  if (key === 'loyalAll') { if (good('nongmin')) v += 3; if (bad('nongmin')) v -= 8; }
  if (key === 'trainAll') { if (good('muban')) v += 2; if (bad('muban')) v -= 2; }
  return v;
}

export function buildingEff(r) {
  const out = {};
  for (const b of r.buildings) {
    const e = BUILDINGS[b]?.eff || {};
    for (const k in e) out[k] = (out[k] || 0) + e[k];
  }
  return out;
}

export function caps(S, r) {
  const base = REGION_BY_ID[r.id];
  const b = buildingEff(r);
  let defMax = base.defMax + (b.defMax || 0);
  if (r.owner && (base.prov === 'hamgyeong' || base.prov === 'pyeongan')) defMax += mod(S, r.owner, 'northDef');
  if (S.wonders.hwaseong?.region === r.id) defMax = Math.max(defMax, 999);
  return { agri: base.agriMax + (b.agriMax || 0), comm: base.commMax + (b.commMax || 0), def: Math.min(1200, defMax) };
}

const diffMul = (S, fid) => {
  const D = DIFFICULTY[S.difficulty] || DIFFICULTY.normal;
  return fid === S.player ? D.playerIncome : D.aiIncome;
};

// 고을 한 곳의 한 턴 산출
export function regionYield(S, r, season = S.season) {
  const fid = r.owner;
  if (!fid) return { gold: 0, rice: 0, sci: 0, pres: 0 };
  const f = S.factions[fid];
  const tax = f.foreign ? 1 : TAX_LEVELS[f.taxLevel].mul;
  const loyF = 0.45 + r.loyalty / 180;
  const b = buildingEff(r);
  const dm = diffMul(S, fid) * (S.scn?.econ?.[fid] ?? 1);
  const gold = (r.comm * 0.45 + r.pop * 0.5) * tax * loyF * (1 + mod(S, fid, 'goldMul') + (b.goldMul || 0)) * dm + (b.gold || 0);
  const rice = (r.agri * 2.0 + r.pop * 1.0) * tax * loyF * (1 + mod(S, fid, 'riceMul') + (b.riceMul || 0)) * SEASON_RICE[season] * dm + (b.rice || 0);
  const sci = 0.5 + r.pop * 0.012 + (b.sci || 0);
  const pres = b.pres || 0;
  return { gold, rice, sci, pres };
}

export function tradeIncome(S, fid) {
  const f = S.factions[fid];
  let nodes = 0;
  for (const r of regionsOf(S, fid)) {
    const t = REGION_BY_ID[r.id].trade;
    if (!t) continue;
    if (t === 'port' || t === 'port2') { if (f.laws.foreign === 'open') nodes += 1.5; else nodes += 0.3; }
    else nodes += 1;
  }
  if (!nodes) return 0;
  const m = 1 + mod(S, fid, 'trade') + officersOf(S, fid).filter((o) => hasTrait(o, '상재')).length * 0.05;
  return Math.max(0, 90 * nodes * m);
}

export function upkeep(S, fid) {
  const offs = officersOf(S, fid);
  const troops = regionsOf(S, fid).reduce((s, r) => s + r.troops, 0);
  const salary = offs.reduce((s, o) => s + (o.ally ? 0 : 6 + (o.lea + o.str + o.int + o.pol + o.cha) / 60), 0);
  return { gold: salary + troops * 0.012, rice: troops * 0.06, troops };
}

export function officerSci(S, fid) {
  let s = 0;
  for (const o of officersOf(S, fid)) {
    const i = eff(o).int;
    if (i > 62) s += ((i - 62) / 20) * (hasTrait(o, '학문') ? 1.5 : 1) * (hasTrait(o, '발명') ? 1.3 : 1);
  }
  return s;
}

export function sciMul(S, fid) { return 1 + mod(S, fid, 'sciMul') + (officersOf(S, fid).some((o) => hasTrait(o, '개혁')) ? 0.1 : 0); }

// 세력 전체 예상 수지(UI 표시와 실제 처리에 같이 쓴다)
export function factionIncome(S, fid, season = S.season) {
  const f = S.factions[fid];
  const regs = regionsOf(S, fid);
  let gold = 0, rice = 0, sci = 0, pres = 0;
  for (const r of regs) {
    const y = regionYield(S, r, season);
    gold += y.gold; rice += y.rice; sci += y.sci; pres += y.pres;
  }
  const rm = resMod(S, fid);
  gold += rm.gold || 0;
  rice += (rm.rice || 0) * SEASON_RICE[season];
  sci += rm.sci || 0;
  const trade = tradeIncome(S, fid);
  gold += trade;
  sci += officerSci(S, fid);
  for (const w in S.wonders) if (S.wonders[w].owner === fid) sci += WONDERS[w].eff.sci || 0;
  sci *= sciMul(S, fid);
  // 명망: 고을 수, 예술가, 기술, 위업
  pres += regs.length / 4;
  for (const t in f.techs) pres += TECH_BY_ID[t]?.eff?.pres || 0;
  for (const w in S.wonders) if (S.wonders[w].owner === fid) pres += WONDERS[w].eff.pres || 0;
  pres += rm.pres || 0;
  pres += officersOf(S, fid).filter((o) => hasTrait(o, '예술')).length * 2;
  pres *= 1 + mod(S, fid, 'presMul');
  const up = upkeep(S, fid);
  return { gold, rice, sci, pres, trade, upGold: up.gold, upRice: up.rice, netGold: gold - up.gold, netRice: rice - up.rice, troops: up.troops };
}

export function loyaltyTarget(S, r) {
  if (!r.owner) return 50;
  const f = S.factions[r.owner];
  const b = buildingEff(r);
  let t = 52 + (f.foreign ? -20 : TAX_LEVELS[f.taxLevel].loyal) + mod(S, r.owner, 'loyalAll') + (b.loyal || 0) + (f.legit - 50) / 6;
  for (const res of REGION_BY_ID[r.id].res) t += RESOURCES[res]?.eff?.loyal || 0;
  t -= r.unrest || 0;
  if (officersIn(S, r.id, r.owner).some((o) => hasTrait(o, '인덕'))) t += 4;
  if (officersIn(S, r.id, r.owner).some((o) => hasTrait(o, '의적'))) t += 3;
  return clamp(t, 5, 95);
}

export function officerLoyaltyTarget(S, o) {
  const f = S.factions[o.faction];
  if (!f) return 50;
  const ruler = rulerOf(S, o.faction);
  let t = 38 + f.legit * 0.3 + (ruler ? eff(ruler).cha * 0.22 : 10) + mod(S, o.faction, 'loyaltyAll');
  if (ruler && hasTrait(ruler, '인덕')) t += 5;
  if (o.item) t += 8;
  return clamp(t, 10, 100);
}

// 인구 증가
function growRegion(S, r, riceShort) {
  const c = caps(S, r);
  const cap = 60 + r.agri * 0.35 + r.comm * 0.15;
  const fid = r.owner;
  const b = buildingEff(r);
  const gm = 1 + (fid ? mod(S, fid, 'growth') : 0) + (b.growth || 0);
  let g = r.pop * 0.006 * gm * (r.loyalty / 65) * (1 - r.pop / cap);
  if (riceShort) g = -r.pop * 0.01;
  r.pop = clamp(r.pop + g, 5, 999);
  r.agri = Math.min(r.agri, c.agri);
  r.comm = Math.min(r.comm, c.comm);
  r.def = Math.min(r.def, c.def);
}

// 한 철 처리(모든 세력·고을)
export function processSeason(S) {
  // 세력 수지
  for (const f of Object.values(S.factions)) {
    if (!f.alive) continue;
    const inc = factionIncome(S, f.id);
    f.gold += inc.netGold;
    f.rice += inc.netRice;
    f.prestige += inc.pres;
    f.prestigeTotal += inc.pres;
    f.lastIncome = { gold: Math.round(inc.netGold), rice: Math.round(inc.netRice), sci: Math.round(inc.sci), pres: Math.round(inc.pres) };
    // 빚·굶주림
    let riceShort = false;
    if (f.rice < 0) {
      riceShort = true;
      for (const r of regionsOf(S, f.id)) { r.troops = Math.floor(r.troops * 0.9); r.loyalty = clamp(r.loyalty - 5, 0, 100); }
      if (f.id === S.player) log(S, '군량이 바닥나 병사들이 흩어지고 있다!', 'warn', f.id);
      f.rice = 0;
    }
    if (f.gold < 0) {
      for (const o of officersOf(S, f.id)) o.loyalty = clamp(o.loyalty - 3, 0, 100);
      if (f.id === S.player) log(S, '국고가 비어 녹봉을 주지 못했다. 장수들의 충성이 떨어진다.', 'warn', f.id);
      f.gold = 0;
    }
    researchTick(S, f, inc.sci);
    f._riceShort = riceShort;
  }
  // 고을
  for (const r of Object.values(S.regions)) {
    const fid = r.owner;
    if (!fid) {
      // 중립: 수비대 회복
      if (r.troops < r.garrisonMax) r.troops = Math.min(r.garrisonMax, Math.round(r.troops * 1.04 + 50));
      r.loyalty = clamp(r.loyalty + (50 - r.loyalty) * 0.1, 0, 100);
      continue;
    }
    const f = S.factions[fid];
    growRegion(S, r, f._riceShort);
    const tgt = loyaltyTarget(S, r);
    r.loyalty = clamp(r.loyalty + clamp((tgt - r.loyalty) * 0.25, -4, 3), 0, 100);
    if (r.unrest > 0) r.unrest = Math.max(0, r.unrest - 2);
    // 고을이 먹여 살릴 수 있는 것보다 군사가 많으면 흩어진다
    const troopCap = r.pop * 300;
    if (r.troops > troopCap) r.troops = Math.round(r.troops - (r.troops - troopCap) * 0.1);
    // 훈련: 병영·무반
    const b = buildingEff(r);
    const tb = (b.trainBonus || 0) + mod(S, fid, 'trainAll');
    r.training = clamp(r.training + tb - (r.training > 60 ? 0.5 : 0), 10, 100);
    // 공사
    if (r.build) {
      r.build.left -= 1;
      if (r.build.left <= 0) {
        if (!r.buildings.includes(r.build.id)) r.buildings.push(r.build.id);
        if (fid === S.player) log(S, `${regionBase(r.id).name}에 ${josa(BUILDINGS[r.build.id].name, '이/가')} 완공되었다.`, 'good', fid);
        r.build = null;
      }
    }
  }
  // 위업
  for (const f of Object.values(S.factions)) {
    if (!f.alive || !f.wonder) continue;
    const w = f.wonder;
    if (S.wonders[w.id]) {
      f.gold += Math.round(WONDERS[w.id].cost * 0.5);
      if (f.id === S.player) log(S, `${josa(WONDERS[w.id].name, '은/는')} 이미 다른 세력이 완성했다. 공사비 절반을 돌려받았다.`, 'warn', f.id);
      f.wonder = null;
      continue;
    }
    if (S.regions[w.region].owner !== f.id) { f.wonder = null; continue; }
    w.left -= 1;
    if (w.left <= 0) {
      S.wonders[w.id] = { owner: f.id, region: w.region };
      const W = WONDERS[w.id];
      if (W.eff.legit) f.legit = clamp(f.legit + W.eff.legit, 0, 100);
      if (W.eff.fort) S.regions[w.region].def = W.eff.fort;
      f.prestige += 100;
      f.prestigeTotal += 100;
      log(S, `${f.name} 세력이 위업 「${W.name}」${pp(W.name, '을/를')} 완성했다!`, 'major', f.id);
      f.wonder = null;
    }
  }
  // 장수 충성 변화·부상 회복
  for (const o of Object.values(S.officers)) {
    if (o.status !== 'active') continue;
    if (o.injured > 0) o.injured--;
    if (o.ally) { o.loyalty = 100; continue; }
    const f = S.factions[o.faction];
    if (f.ruler === o.id) { o.loyalty = 100; continue; }
    const t = officerLoyaltyTarget(S, o);
    if (o.loyalty < t) o.loyalty = Math.min(t, o.loyalty + 1);
    else if (o.loyalty > t) o.loyalty = Math.max(t, o.loyalty - 0.5);
  }
  // 정치·정통성
  for (const f of Object.values(S.factions)) {
    if (!f.alive) continue;
    politicsTick(S, f);
  }
}

export function availableTechs(S, fid) {
  const f = S.factions[fid];
  return TECHS.filter((t) => !f.techs[t.id] && t.req.every((q) => f.techs[q]));
}
export function techCost(S, fid, t) {
  // 이미 익힌 기술이 많을수록 조금씩 비싸진다(후발 따라잡기 쉬움)
  const f = S.factions[fid];
  const n = Object.keys(f.techs).length;
  return Math.round(t.cost * 3.6 * (1 + n * 0.025));
}
export function setResearch(S, fid, techId) {
  const f = S.factions[fid];
  if (!TECH_BY_ID[techId] || f.techs[techId]) return false;
  if (!TECH_BY_ID[techId].req.every((q) => f.techs[q])) return false;
  if (f.research.cur && f.research.cur !== techId) {
    f.research.bank += Math.floor(f.research.prog * 0.8); // 바꾸면 20% 손실
  }
  f.research.cur = techId;
  f.research.prog = f.research.bank;
  f.research.bank = 0;
  return true;
}
export function researchTick(S, f, points) {
  if (!f.research.cur) {
    f.research.bank = Math.min(f.research.bank + points, 2000);
    return;
  }
  f.research.prog += points;
  const t = TECH_BY_ID[f.research.cur];
  const cost = techCost(S, f.id, t);
  if (f.research.prog >= cost) {
    completeTech(S, f.id, t.id);
    const over = f.research.prog - cost;
    f.research.cur = null;
    f.research.prog = 0;
    f.research.bank = over;
  }
}
export function completeTech(S, fid, tid) {
  const f = S.factions[fid];
  if (f.techs[tid]) return;
  f.techs[tid] = true;
  const t = TECH_BY_ID[tid];
  if (t.eff.legit) f.legit = clamp(f.legit + t.eff.legit, 0, 100);
  if (t.eff.loyalAll) for (const r of regionsOf(S, fid)) r.loyalty = clamp(r.loyalty + t.eff.loyalAll, 0, 100);
  f.prestige += 10;
  f.prestigeTotal += 10;
  log(S, `${f.name} 세력이 「${t.name}」${pp(t.name, '을/를')} 익혔다.`, fid === S.player ? 'good' : 'info', fid);
  if (fid === S.player) {
    const pick = availableTechs(S, fid);
    if (!pick.length) f.research.cur = null;
  }
}

// ── 정치 ──
export function igTarget(S, f, ig) {
  let t = 0;
  for (const cat in f.laws) t += lawOpt(cat, f.laws[cat])?.ig?.[ig] || 0;
  t += TAX_LEVELS[f.taxLevel].ig[ig] || 0;
  const regs = regionsOf(S, f.id);
  if (ig === 'sarim') t += regs.reduce((s, r) => s + (r.buildings.includes('seowon') ? 2 : 0) + (r.buildings.includes('hyanggyo') ? 1 : 0), 0);
  if (ig === 'muban') t += (f.recent.wins - f.recent.losses) * 4 + Math.min(10, regs.reduce((s, r) => s + r.troops, 0) / 5000);
  if (ig === 'nongmin') {
    t -= f.recent.recruits * 2 + f.recent.battles * 1.5;
    const avg = regs.length ? regs.reduce((s, r) => s + r.loyalty, 0) / regs.length : 50;
    t += (avg - 55) / 2;
  }
  if (ig === 'sangin') t += regs.reduce((s, r) => s + (r.buildings.includes('market') ? 2 : 0), 0) + (tradeIncome(S, f.id) > 0 ? 5 : 0);
  if (ig === 'hunchuk') t += (f.legit - 50) / 4;
  if (ig === 'gaehwa') t += Object.keys(f.techs).filter((id) => TECH_BY_ID[id]?.era === 4).length * 3;
  const calm = mod(S, f.id, 'igCalm');
  if (t < 0) t *= 1 - calm;
  return clamp(t, -100, 100);
}
export function igClout(S, f) {
  const raw = {};
  for (const ig in IGS) {
    let c = BASE_CLOUT[ig];
    for (const cat in f.laws) c += lawOpt(cat, f.laws[cat])?.clout?.[ig] || 0;
    if (ig === 'gaehwa') c = f.techs.gaehang ? 10 + Object.keys(f.techs).filter((id) => TECH_BY_ID[id]?.era === 4).length * 2 + (f.laws.foreign === 'open' ? 10 : 0) : 0;
    if (ig === 'sangin') c += Math.min(10, tradeIncome(S, f.id) / 40);
    raw[ig] = Math.max(0, c);
  }
  const tot = Object.values(raw).reduce((s, x) => s + x, 0) || 1;
  for (const ig in raw) raw[ig] = Math.round((raw[ig] / tot) * 100);
  return raw;
}
function politicsTick(S, f) {
  // 최근 기록은 서서히 잊힌다
  for (const k in f.recent) f.recent[k] = Math.max(0, f.recent[k] * 0.7 - 0.1);
  // 정통성
  let lt = 50 + mod(S, f.id, 'legit') * 0.5 + (f.capital === 'hanseong' ? 8 : 0);
  const ruler = rulerOf(S, f.id);
  if (ruler) lt += (eff(ruler).cha - 60) / 4;
  lt += mod(S, f.id, 'legitDrift') * 10;
  if (!f.foreign) {
    const g = f.igs;
    if (g.hunchuk.appr >= 30) lt += 6;
    if (g.hunchuk.appr <= -30) lt -= 8;
  }
  f.legit = clamp(f.legit + clamp((lt - f.legit) * 0.08, -2, 1.5), 0, 100);
  if (f.foreign) return;
  const clout = igClout(S, f);
  for (const ig in IGS) {
    const st = f.igs[ig];
    st.clout = clout[ig];
    const tgt = igTarget(S, f, ig);
    st.appr = clamp(st.appr + (tgt - st.appr) * 0.25, -100, 100);
  }
}

export function lawChangeCost(S, fid) {
  const offs = officersOf(S, fid);
  const ref = offs.some((o) => hasTrait(o, '개혁')) ? 0.7 : 1;
  return Math.round(80 * ref);
}
export function canChangeLaw(S, fid, cat, optId) {
  const f = S.factions[fid];
  if (f.foreign) return '외세 세력은 법령이 없다';
  const opt = lawOpt(cat, optId);
  if (!opt) return '없는 법령';
  if (f.laws[cat] === optId) return '이미 시행 중';
  if (opt.req && !f.techs[opt.req]) return `「${TECH_BY_ID[opt.req].name}」 필요`;
  if (f.prestige < lawChangeCost(S, fid)) return `名 ${lawChangeCost(S, fid)} 필요`;
  return null;
}
export function changeLaw(S, fid, cat, optId) {
  const why = canChangeLaw(S, fid, cat, optId);
  if (why) return why;
  const f = S.factions[fid];
  f.prestige -= lawChangeCost(S, fid);
  f.laws[cat] = optId;
  // 바뀐 법령에 반대하는 쪽은 즉시 조금 화를 낸다
  const opt = lawOpt(cat, optId);
  for (const ig in opt.ig || {}) if (opt.ig[ig] < 0) f.igs[ig].appr = clamp(f.igs[ig].appr + opt.ig[ig] * 0.5, -100, 100);
  log(S, `${f.name} 세력이 ${LAWS[cat].name} 법령을 「${opt.name}」${pp(opt.name, '으로/로')} 바꾸었다.`, fid === S.player ? 'good' : 'info', fid);
  return null;
}

export function techEra(S, fid) {
  const f = S.factions[fid];
  let e = 1;
  for (const t in f.techs) e = Math.max(e, TECH_BY_ID[t]?.era || 1);
  return e;
}

export function regionSlots(r) { return 4 + Math.floor(r.pop / 80); }
export function buildCost(S, fid, cost) { return Math.round(cost * (1 - Math.min(0.24, mod(S, fid, 'buildCost')))); }

export function score(S, fid) {
  const f = S.factions[fid];
  const regs = regionsOf(S, fid);
  return Math.round(regs.length * 120 + regs.reduce((s, r) => s + r.pop, 0) * 0.8 + Object.keys(f.techs).length * 40 + f.prestigeTotal * 0.5 +
    Object.values(S.wonders).filter((w) => w.owner === fid).length * 300 + officersOf(S, fid).length * 10);
}
export { R };
