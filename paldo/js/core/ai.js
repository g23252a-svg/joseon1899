// 컴퓨터 세력의 두뇌: 연구·법령·인사·건설·외교·출진
import { clamp, R } from './util.js';
import { TECHS, TECH_BY_ID } from '../data/techs.js';
import { BUILDINGS, WONDERS } from '../data/buildings.js';
import { REGION_BY_ID } from '../data/regions.js';
import {
  regionsOf, officersOf, officersIn, freeIn, eff, statSum, adjOf, canAttack, threatTo, hostileNeighbors, treaty, relation, factionPower,
  DIFFICULTY, hasTrait, isRuler,
} from './state.js';
import { availableTechs, setResearch, techCost, canChangeLaw, changeLaw, factionIncome, mod, caps, regionSlots, buildCost } from './rules.js';
import { doAction, canAct, delegateRegion, reward, startAttack, hireChance, movable, actionCost } from './actions.js';
import { propose, diploChance, acceptDiplo, borders } from './diplomacy.js';
import { fightBattle } from './war.js';
import { simulateAttack } from './battle.js';

const MIL = new Set(['singi', 'panok', 'bigyeok', 'geobuk', 'jochong', 'hullyeon', 'sinsik', 'sagun', 'daedongyeojido', 'jeunggi']);
const ECO = new Set(['nongsa', 'cheugu', 'daedong', 'sangpyeong', 'gyunyeok', 'euibang', 'donguibogam', 'cheoldo', 'gaehang', 'gabo', 'tangpyeong', 'gyeongguk']);

export function pickResearch(S, fid) {
  const f = S.factions[fid];
  const av = availableTechs(S, fid);
  if (!av.length) return;
  const p = f.personality || { aggr: 0.5, sci: 0.5, eco: 0.5 };
  const t = R.weighted(av, (t) => {
    let w = 1;
    if (MIL.has(t.id)) w += p.aggr * 1.5;
    if (ECO.has(t.id)) w += p.eco * 1.2;
    if (!MIL.has(t.id) && !ECO.has(t.id)) w += p.sci * 1.2;
    if (t.final) w += 3;
    return w * (300 / (techCost(S, fid, t) + 100));
  });
  if (t) setResearch(S, fid, t.id);
}

const LAW_PREF = {
  tax: ['jise', 'daedong'], army: ['gyunyeok'], status: ['seoeol'], learning: ['silhak', 'west'],
  commerce: ['free', 'tonggong'], foreign: ['open'], crown: ['tangpyeong'],
};
function aiLaws(S, fid) {
  const f = S.factions[fid];
  if (f.foreign || S.turn % 5 !== (fid.length % 5)) return;
  for (const cat in LAW_PREF) {
    for (const opt of LAW_PREF[cat]) {
      if (f.laws[cat] === opt) break;
      if (!canChangeLaw(S, fid, cat, opt) && f.prestige > 140) { changeLaw(S, fid, cat, opt); return; }
    }
  }
}
function aiTax(S, fid) {
  const f = S.factions[fid];
  if (f.foreign) return;
  const regs = regionsOf(S, fid);
  const avgLoy = regs.reduce((s, r) => s + r.loyalty, 0) / Math.max(1, regs.length);
  const inc = factionIncome(S, fid);
  if (avgLoy < 42) f.taxLevel = 0;
  else if ((f.gold < 300 && inc.netGold < 0) || (f.rice < 1000 && inc.netRice < 0)) f.taxLevel = 2;
  else f.taxLevel = 1;
}

function sideQ(S, fid, offs, training) {
  const es = offs.map(eff);
  const lea = es.length ? Math.max(...es.map((e) => e.lea)) : 40;
  const str = es.length ? es.reduce((s, e) => s + e.str, 0) / es.length : 40;
  return (0.55 + lea / 200 + str / 400) * (0.6 + training / 250) * (1 + (fid ? mod(S, fid, 'all') + mod(S, fid, 'power') : 0));
}
export function defenseEstimate(S, rid) {
  const r = S.regions[rid];
  const offs = r.owner ? officersIn(S, rid, r.owner) : [];
  const q = sideQ(S, r.owner, offs.slice(0, 5), r.training);
  return r.troops * q * (1 + r.def / 700) * (offs.length ? 1 : 0.85);
}

async function aiMilitary(S, fid, hooks) {
  const f = S.factions[fid];
  const p = f.personality || { aggr: 0.5 };
  const D = DIFFICULTY[S.difficulty] || DIFFICULTY.normal;
  const regs = regionsOf(S, fid).sort((a, b) => b.troops - a.troops);
  let attacks = 0;
  const maxAttacks = 1 + Math.floor(p.aggr * 2.5) + (S.scenario === 'imjin' && fid === 'wae' ? 2 : 0);
  for (const src of regs) {
    if (attacks >= maxAttacks) break;
    if (S.regions[src.id].owner !== fid) continue;
    if (src.troops < 2500) continue;
    const idle = officersIn(S, src.id, fid).filter((o) => !o.acted && o.injured <= 0).sort((a, b) => eff(b).lea + eff(b).str - (eff(a).lea + eff(a).str));
    if (!idle.length) continue;
    const targets = adjOf(src.id).filter((t) => canAttack(S, fid, t));
    if (!targets.length) continue;
    // 1차 거르기: 대략의 힘 비교
    const cands = [];
    for (const t of targets) {
      const tr = S.regions[t];
      const others = adjOf(src.id).filter((n) => n !== t && S.regions[n].owner && S.regions[n].owner !== fid && !treaty(S, fid, S.regions[n].owner));
      const reserveNeed = others.length ? Math.max(...others.map((n) => S.regions[n].troops)) * 0.45 : 0;
      const avail = Math.round(Math.max(0, src.troops - reserveNeed - 500) / 100) * 100;
      if (avail < 2000) continue;
      const team = idle.slice(0, avail > 15000 ? 5 : avail > 7000 ? 4 : 3);
      const ratio = (avail * sideQ(S, fid, team, src.training)) / Math.max(200, defenseEstimate(S, t));
      if (ratio < 0.7) continue;
      const base = REGION_BY_ID[t];
      let value = 1 + base.pop / 120 + (tr.owner && S.factions[tr.owner].capital === t ? 1.2 : 0) + (base.res.length ? 0.3 : 0);
      if (!tr.owner) value += 0.4;
      if (tr.owner && relation(S, fid, tr.owner) > 30) value *= 0.5;
      if (S.scenario === 'imjin' && fid === 'wae' && (t === 'hanseong' || t === 'pyongyang')) value += 2;
      cands.push({ t, avail, team, value: value * Math.min(ratio, 2.5) });
    }
    cands.sort((a, b) => b.value - a.value);
    let chosen = null;
    for (const c of cands.slice(0, 2)) {
      const tr = S.regions[c.t];
      let need = 0.72 - p.aggr * 0.32 - (f.gold > 5000 ? 0.05 : 0);
      if (tr.owner === S.player) {
        need += D.aiAggrVsPlayer * -0.5;
        if (S.scenario !== 'imjin') {
          if (S.turn < 4) continue; // 처음 한 해는 숨 돌릴 틈
          if (S.turn < 8) need += 0.15;
        }
      }
      const sim = simulateAttack(S, { fid, from: src.id, to: c.t, officers: c.team.map((o) => o.id), troops: c.avail }, 6);
      if (sim.win >= need) { chosen = c; break; }
    }
    if (!chosen) continue;
    const res = startAttack(S, fid, src.id, chosen.t, chosen.team.map((o) => o.id), chosen.avail);
    if (!res.ok) continue;
    attacks++;
    hooks?.progress?.(`${f.name} 군이 움직인다…`, fid);
    await fightBattle(S, res.battle, hooks);
  }
}

// 후방 병력을 전방으로, 장수 없는 고을에 장수를
function aiLogistics(S, fid) {
  const regs = regionsOf(S, fid);
  const frontierScore = (r) => threatTo(S, r.id, fid) + (adjOf(r.id).some((n) => !S.regions[n].owner) ? 2000 : 0);
  const dist = {};
  let q = regs.filter((r) => frontierScore(r) > 0).map((r) => r.id);
  for (const id of q) dist[id] = 0;
  while (q.length) {
    const nq = [];
    for (const id of q) for (const n of adjOf(id)) if (S.regions[n].owner === fid && dist[n] == null) { dist[n] = dist[id] + 1; nq.push(n); }
    q = nq;
  }
  for (const r of regs) {
    if (!(dist[r.id] > 0) || r.troops < 2500) continue;
    const next = adjOf(r.id).filter((n) => S.regions[n].owner === fid && dist[n] === dist[r.id] - 1).sort((a, b) => frontierScore(S.regions[b]) - frontierScore(S.regions[a]))[0];
    if (!next) continue;
    const mover = officersIn(S, r.id, fid).filter((o) => !o.acted && o.injured <= 0).sort((a, b) => eff(a).pol - eff(b).pol)[0];
    if (!mover) continue;
    doAction(S, mover, 'transport', { to: next, troops: Math.round(r.troops * 0.75) });
  }
  // 장수 고르게
  for (const r of regs) {
    const here = officersIn(S, r.id, fid).filter((o) => !o.acted && o.injured <= 0);
    if (here.length < 3) continue;
    const empty = adjOf(r.id).filter((n) => S.regions[n].owner === fid && officersIn(S, n, fid).length === 0).sort((a, b) => frontierScore(S.regions[b]) - frontierScore(S.regions[a]))[0];
    if (!empty) continue;
    const o = here.filter((x) => !isRuler(S, x)).sort((a, b) => statSum(a) - statSum(b))[0];
    if (o) doAction(S, o, 'move', { to: empty, troops: 0 });
  }
}

function aiPeople(S, fid) {
  const f = S.factions[fid];
  // 보물 하사
  while (f.treasury.length) {
    const o = officersOf(S, fid).filter((x) => !x.item && !x.ally).sort((a, b) => statSum(b) - statSum(a))[0];
    if (!o) break;
    reward(S, fid, o.id, 'item', f.treasury[0]);
  }
  // 충성 낮은 장수 포상
  for (const o of officersOf(S, fid)) if (o.loyalty < 55 && f.gold > 600 && !o.ally && !isRuler(S, o)) reward(S, fid, o.id, 'gold');
  // 찾아 둔 재야 등용
  for (const r of regionsOf(S, fid)) {
    for (const t of freeIn(S, r.id, true)) {
      const o = officersIn(S, r.id, fid).filter((x) => !x.acted && !x.ally && x.injured <= 0).sort((a, b) => eff(b).cha - eff(a).cha)[0];
      if (o && !canAct(S, o, 'hire', { target: t.id })) doAction(S, o, 'hire', { target: t.id });
    }
  }
}

const BUILD_PRI = ['market', 'reservoir', 'hyanggyo', 'barracks', 'beacon', 'seowon', 'clinic', 'mine', 'navalbase', 'workshop', 'telegraph', 'school', 'station', 'arsenal'];
function aiBuild(S, fid) {
  const f = S.factions[fid];
  let built = 0;
  for (const r of regionsOf(S, fid).sort((a, b) => b.pop - a.pop)) {
    if (built >= (f.gold > 5000 ? 3 : 2) || r.build) continue;
    if (r.buildings.length >= regionSlots(r)) continue;
    const front = threatTo(S, r.id, fid) > 0;
    const cands = BUILD_PRI.filter((b) => {
      if ((b === 'barracks' || b === 'beacon') && !front) return false;
      const o = { faction: fid, loc: r.id };
      return !r.buildings.includes(b);
    });
    const builder = officersIn(S, r.id, fid).filter((o) => !o.acted && !o.ally && o.injured <= 0).sort((a, b) => eff(b).pol - eff(a).pol)[0];
    if (!builder) continue;
    for (const b of cands) {
      const cost = buildCost(S, fid, BUILDINGS[b].cost);
      if (f.gold < cost + 700) continue;
      if (canAct(S, builder, 'build', { id: b })) continue;
      doAction(S, builder, 'build', { id: b });
      built++;
      break;
    }
  }
  // 위업
  if (!f.wonder && regionsOf(S, fid).length >= 3 && R.chance(0.25 + (f.personality?.sci || 0.5) * 0.3)) {
    const ws = Object.keys(WONDERS).filter((w) => !S.wonders[w]).sort(() => R.next() - 0.5);
    for (const w of ws) {
      const W = WONDERS[w];
      const cost = buildCost(S, fid, W.cost);
      if (f.gold < cost * 1.25 + 500) continue;
      const rid = W.region || f.capital;
      if (S.regions[rid]?.owner !== fid) continue;
      const builder = officersIn(S, rid, fid).filter((o) => !o.acted && !o.ally && o.injured <= 0)[0];
      if (!builder || canAct(S, builder, 'wonder', { id: w })) continue;
      doAction(S, builder, 'wonder', { id: w });
      break;
    }
  }
}

function aiPolicies(S, fid) {
  const f = S.factions[fid];
  const p = f.personality || {};
  for (const r of regionsOf(S, fid)) {
    const threat = threatTo(S, r.id, fid);
    if (threat > r.troops * 0.8) r.policy = R.chance(0.5) ? 'mil' : 'def';
    else if (threat > 0 || adjOf(r.id).some((n) => !S.regions[n].owner)) r.policy = p.aggr > 0.6 ? 'mil' : 'balance';
    else r.policy = p.sci > 0.75 && R.chance(0.4) ? 'sci' : 'balance';
  }
}

async function aiDiplomacy(S, fid, hooks) {
  const f = S.factions[fid];
  if (f.foreign || !R.chance(0.12)) return;
  const others = Object.values(S.factions).filter((x) => x.alive && x.id !== fid);
  const myP = factionPower(S, fid);
  for (const o of R.shuffle(others)) {
    if (o.foreign) continue;
    const t = treaty(S, fid, o.id);
    const rel = relation(S, fid, o.id);
    let type = null;
    const oP = factionPower(S, o.id);
    if (!t && borders(S, fid, o.id) && oP > myP * 1.4 && rel > -40) type = 'truce';
    else if (!t && rel >= 45) type = 'alliance';
    else if (o.id === S.player && regionsOf(S, fid).length <= 2 && oP > myP * 4 && borders(S, fid, o.id) && rel > 0) type = 'submit';
    if (!type) continue;
    if (o.id === S.player) {
      if (hooks?.proposal) {
        const yes = await hooks.proposal({ from: fid, type });
        if (yes) {
          if (type === 'submit') acceptDiplo(S, S.player, fid, 'surrender');
          else acceptDiplo(S, fid, S.player, type);
        }
      }
    } else if (type !== 'submit') {
      const pr = diploChance(S, fid, o.id, type, null);
      if (R.chance(pr)) acceptDiplo(S, fid, o.id, type);
    }
    break;
  }
}

// 임진년 조선 수군: 제해권을 되찾으러 나간다
async function aiNaval(S, fid, hooks) {
  if (S.scenario !== 'imjin' || fid !== 'joseon' || (S.scn.sea || 0) > 75 || !R.chance(0.6)) return;
  for (const r of regionsOf(S, fid)) {
    const base = REGION_BY_ID[r.id];
    if (!base.coastal || !['jeolla', 'gyeongsang'].includes(base.prov) || r.troops < 4000) continue;
    const adm = officersIn(S, r.id, fid).filter((o) => !o.acted && o.injured <= 0 && hasTrait(o, '수군')).sort((a, b) => eff(b).lea - eff(a).lea)[0];
    if (!adm || canAct(S, adm, 'naval')) continue;
    const res = doAction(S, adm, 'naval', { troops: Math.round(r.troops * 0.6) });
    if (res.battle) await fightBattle(S, res.battle, hooks);
    return;
  }
}

export async function aiTurn(S, fid, hooks) {
  const f = S.factions[fid];
  if (!f.alive) return;
  if (!f.research.cur) pickResearch(S, fid);
  aiTax(S, fid);
  aiLaws(S, fid);
  aiPolicies(S, fid);
  aiPeople(S, fid);
  await aiDiplomacy(S, fid, hooks);
  await aiNaval(S, fid, hooks);
  await aiMilitary(S, fid, hooks);
  if (!f.alive) return;
  aiLogistics(S, fid);
  aiBuild(S, fid);
  for (const r of regionsOf(S, fid)) delegateRegion(S, r.id, { reserve: 250 });
}
