// 전투: 매 라운드(하루) 양쪽이 작전을 고른다. 돌격·사격·수비·계략·일기토·퇴각.
//   돌격 > 계략,  수비 > 돌격,  계략 > 수비,  사격은 고른 무난한 선택.
// 공성: 성곽이 수비측 피해를 줄이고, 공격측은 성벽을 깎아 내야 한다.
import { clamp, R, josa } from './util.js';
import { REGION_BY_ID } from '../data/regions.js';
import { mod, buildingEff } from './rules.js';
import {
  eff, hasTrait, isRuler, officersIn, changeOwner, nearestOwned, log, regionBase, addRelation, succession, statSum, regionsOf,
  checkFactionAlive, adjOf, treaty, clearTreaty,
} from './state.js';

export const TACTICS = {
  charge: { name: '돌격', hanja: '突擊', desc: '정면으로 들이친다. 피해를 크게 주고받는다. 계략을 깨뜨리지만 수비에 막힌다.' },
  volley: { name: '사격', hanja: '射擊', desc: '활·총통으로 일제히 쏜다. 무난하고 기술의 덕을 본다.' },
  hold: { name: '수비', hanja: '守備', desc: '진을 굳힌다. 받는 피해가 크게 줄고 돌격을 되받아친다. 계략에 약하다.' },
  scheme: { name: '계략', hanja: '計略', desc: '매복·화공·기습. 지력으로 성패가 갈린다. 성공하면 큰 피해와 사기 하락.' },
  duel: { name: '일기토', hanja: '一騎討', desc: '장수끼리 맞붙는다. 이긴 쪽 사기가 치솟는다. 상대가 거절할 수도 있다.' },
  retreat: { name: '퇴각', hanja: '退却', desc: '싸움을 접고 물러난다.' },
};

const GARRISON = (r, n) => ({ id: '_g' + n, name: r.rebels ? '민란 장두' : '토호 수비대장', hanja: '', look: r.rebels ? 'rebel' : 'military', lea: 42 + n * 4, str: 44 + n * 3, int: 38, pol: 30, cha: 40, traits: r.rebels ? ['의병'] : ['수성'], temp: true, seed: 77 + n });

export function getOff(S, B, id) { return S.officers[id] || B.temp[id]; }
export const activeOffs = (S, B, side) => B[side].officers.filter((id) => !B[side].out.includes(id)).map((id) => getOff(S, B, id)).filter(Boolean);
const otherSide = (s) => (s === 'atk' ? 'def' : 'atk');

// 전투 만들기. 병력은 출발 고을에서 바로 빠진다.
export function createBattle(S, { fid, from, to, officers, troops, naval = false, dry = false }) {
  const tr = S.regions[to];
  const fr = S.regions[from];
  const defFid = naval ? 'wae' : tr.owner;
  const B = {
    id: dry ? 'sim' : 'b' + (S.stats.battles = (S.stats.battles || 0) + 1), sim: dry,
    naval, from, to, round: 0, maxRounds: naval ? 6 : 8, temp: {}, log: [], over: false, winner: null, reason: '', duels: 0,
    terrain: naval ? 'sea' : REGION_BY_ID[to].terrain, season: S.season,
    siege: !naval && tr.def > 0,
    atk: { fid, officers: [...officers], troops, troops0: troops, morale: 0, training: fr.training, out: [], tactic: null },
    def: { fid: defFid, officers: [], troops: 0, troops0: 0, morale: 0, training: naval ? 55 : tr.training, out: [], tactic: null },
  };
  if (!dry) {
    fr.troops = Math.max(0, fr.troops - troops);
    for (const id of officers) if (S.officers[id]) S.officers[id].acted = true;
  }
  if (naval) {
    const navy = Object.values(S.officers).filter((o) => o.faction === 'wae' && o.status === 'active' && hasTrait(o, '수군')).sort((a, b) => b.lea - a.lea).slice(0, 3);
    B.def.officers = navy.map((o) => o.id);
    if (!navy.length) { const g = { ...GARRISON(tr, 1), name: '왜 수군 장수', look: 'wae', traits: ['수군'] }; B.temp[g.id] = g; B.def.officers = [g.id]; }
    B.def.troops = B.def.troops0 = Math.round(S.scn.waeNavy || 8000);
    B.wall = B.wall0 = 0;
  } else {
    const defOffs = tr.owner ? officersIn(S, to, tr.owner).filter((o) => o.injured <= 0).sort((a, b) => eff(b).lea + eff(b).str - (eff(a).lea + eff(a).str)).slice(0, 5) : [];
    if (defOffs.length) B.def.officers = defOffs.map((o) => o.id);
    else {
      const n = tr.troops > 5000 ? 2 : 1;
      for (let i = 0; i < n; i++) { const g = GARRISON(tr, i); B.temp[g.id] = g; B.def.officers.push(g.id); }
    }
    B.def.troops = B.def.troops0 = tr.troops;
    B.wall = B.wall0 = tr.def;
  }
  B.atk.morale = startMorale(S, B, 'atk');
  B.def.morale = startMorale(S, B, 'def');
  B.log.push({ r: 0, text: naval ? `${regionBase(from).name} 앞바다에서 왜 수군과 마주쳤다.` : `${regionBase(to).name}에 진을 쳤다. ${B.siege ? `성곽 ${Math.round(B.wall)}.` : ''}`, kind: 'start' });
  return B;
}

function startMorale(S, B, side) {
  const s = B[side];
  const offs = activeOffs(S, B, side);
  let m = 50 + s.training * 0.3;
  if (s.fid && offs.some((o) => isRuler(S, o))) m += 10;
  const home = side === 'def' || adjOf(B.to).includes(B.from);
  if (offs.some((o) => hasTrait(o, '의병')) && home) m += 10;
  if (offs.some((o) => hasTrait(o, '승병'))) m += 5;
  if (s.fid && S.factions[s.fid].rice <= 0) m -= 15;
  if (offs.length) m += (Math.max(...offs.map((o) => eff(o).cha)) - 60) / 6;
  return clamp(Math.round(m), 20, 100);
}

function sideStats(S, B, side) {
  const offs = activeOffs(S, B, side);
  const es = offs.map(eff);
  const leas = es.map((e) => e.lea);
  const maxL = leas.length ? Math.max(...leas) : 35;
  const lea = maxL + Math.min(15, (leas.reduce((a, b) => a + b, 0) - maxL) * 0.1);
  const str = es.length ? es.reduce((s, e) => s + e.str, 0) / es.length : 35;
  const int = es.length ? Math.max(...es.map((e) => e.int)) : 35;
  const traits = new Set(offs.flatMap((o) => o.traits));
  return { offs, lea, str, int, traits };
}

function quality(S, B, side, st) {
  const s = B[side];
  let q = (0.55 + st.lea / 200 + st.str / 400) * (0.6 + s.training / 250);
  if (s.fid) {
    q *= 1 + mod(S, s.fid, 'all') + mod(S, s.fid, 'power');
    const reg = side === 'atk' ? S.regions[B.from] : S.regions[B.to];
    if (reg && reg.owner === s.fid) q *= 1 + (buildingEff(reg).power || 0);
    const prov = REGION_BY_ID[B.to].prov;
    if (st.traits.has('북방') && (prov === 'hamgyeong' || prov === 'pyeongan')) q *= 1.15;
  }
  q *= 0.6 + s.morale / 250;
  return q;
}

function navalMul(S, B, side, st) {
  if (!B.naval) return 1;
  const s = B[side];
  let m = 1;
  if (s.fid) m += mod(S, s.fid, 'naval');
  if (st.traits.has('수군')) m += 0.4;
  if (st.traits.has('선박')) m += 0.2;
  const reg = S.regions[B.from];
  if (side === 'atk' && reg?.buildings.includes('navalbase')) m += 0.3;
  if (!st.traits.has('수군')) m *= 0.75;
  return m;
}

export function schemeName(B, side) {
  if (B.naval) return '화공';
  if (B.terrain === 'mountain') return '매복';
  if (B.terrain === 'river') return side === 'def' ? '수공' : '도하 기습';
  if (B.siege && side === 'atk') return '화공';
  if (B.siege && side === 'def') return '야습';
  return '기습';
}

export function schemeChance(S, B, side, vsTactic) {
  const me = sideStats(S, B, side), op = sideStats(S, B, otherSide(side));
  let p = 0.42 + (me.int - op.int) / 110;
  if (B[side].fid) p += mod(S, B[side].fid, 'scheme');
  if (me.traits.has('계략')) p += 0.15;
  if (me.traits.has('매복') && !B.naval) p += 0.2;
  if (me.traits.has('지리')) p += 0.15;
  if (me.traits.has('의병') && side === 'def') p += 0.2;
  if (B.terrain === 'mountain') p += 0.12;
  if (B.season === 2 && (B.naval || B.siege)) p += 0.08; // 가을 화공
  if (vsTactic === 'hold') p += 0.25;
  if (vsTactic === 'charge') p = 0;
  return clamp(p, 0, 0.85);
}

// 쓸 수 있는 작전
export function tacticsFor(S, B, side) {
  const s = B[side];
  const mine = activeOffs(S, B, side), theirs = activeOffs(S, B, otherSide(side));
  const out = [];
  for (const id of Object.keys(TACTICS)) {
    let ok = true, why = '';
    if (id === 'duel') {
      if (!mine.length || !theirs.length || mine.every((o) => o.temp) || B.duels >= 2) { ok = false; why = B.duels >= 2 ? '이번 싸움에서는 더 못 한다' : '맞붙을 장수가 없다'; }
    }
    if (id === 'retreat' && side === 'def' && !B.naval) {
      if (!s.fid || !nearestAdjOwned(S, B.to, s.fid)) { ok = false; why = '물러날 곳이 없다'; }
    }
    if (id === 'scheme' && !mine.length) { ok = false; why = '장수가 없다'; }
    out.push({ id, ...TACTICS[id], name: id === 'scheme' ? `계략: ${schemeName(B, side)}` : TACTICS[id].name, ok, why });
  }
  return out;
}
const nearestAdjOwned = (S, rid, fid) => adjOf(rid).find((n) => S.regions[n].owner === fid) || null;

// AI 작전 선택: 상대의 지난 작전과 형세를 본다
export function aiTactic(S, B, side) {
  const s = B[side], o = B[otherSide(side)];
  const me = sideStats(S, B, side), op = sideStats(S, B, otherSide(side));
  const ratio = (s.troops * quality(S, B, side, me)) / Math.max(1, o.troops * quality(S, B, otherSide(side), op));
  const opts = tacticsFor(S, B, side).filter((t) => t.ok);
  const has = (id) => opts.some((t) => t.id === id);
  // 크게 밀리면 물러난다
  if (side === 'atk' && (s.morale < 18 || ratio < 0.25) && B.round >= 2) return 'retreat';
  if (side === 'def' && has('retreat') && ratio < 0.18 && s.morale < 25) return 'retreat';
  // 일기토: 내 최강 무력이 상대보다 훨씬 셀 때
  if (has('duel')) {
    const myBest = Math.max(...me.offs.map((x) => eff(x).str + (hasTrait(x, '무예') ? 8 : 0)));
    const theirBest = Math.max(...op.offs.map((x) => eff(x).str + (hasTrait(x, '무예') ? 8 : 0)));
    if (myBest - theirBest > 10 && R.chance(0.45)) return 'duel';
  }
  const last = o.lastTactic;
  const w = { charge: 1, volley: 1.2, hold: 0.8, scheme: 0.7 };
  if (B.siege && side === 'def') { w.hold = 2.0; w.volley = 1.4; w.charge = 0.4; }
  if (B.siege && side === 'atk') { w.charge = 0.9; w.volley = 1.3; w.hold = 0.3; }
  if (me.int - op.int > 12) w.scheme += 0.8;
  if (me.int - op.int < -10) w.scheme *= 0.4;
  if (ratio > 1.4) w.charge += 0.8;
  if (ratio < 0.8) w.hold += 0.6;
  if (me.traits.has('기병') && !B.siege) w.charge += 0.5;
  if (me.traits.has('궁술') || me.traits.has('화포')) w.volley += 0.5;
  // 지력이 높을수록 상대의 버릇을 읽는다
  const smart = me.int / 100;
  if (last && R.chance(smart * 0.7)) {
    if (last === 'charge') w.hold += 1.5;
    if (last === 'hold') w.scheme += 1.5;
    if (last === 'scheme') w.charge += 1.5;
    if (last === 'volley') w.charge += 0.6;
  }
  const cands = opts.filter((t) => w[t.id] != null);
  return R.weighted(cands, (t) => w[t.id]).id;
}

// 상대가 일기토를 받을까
export function champion(S, B, side) {
  const offs = activeOffs(S, B, side).filter((o) => !o.temp || true);
  return offs.sort((a, b) => duelPower(b) - duelPower(a))[0] || null;
}
export const duelPower = (o) => eff(o).str + (hasTrait(o, '무예') ? 8 : 0);
export function aiAcceptDuel(S, B, side, challenger) {
  const ch = champion(S, B, side);
  if (!ch) return false;
  const d = duelPower(ch) - duelPower(challenger);
  if (d >= -4) return true;
  if (duelPower(ch) >= 88) return R.chance(0.7); // 자존심
  return R.chance(clamp(0.5 + d / 25, 0.05, 0.6));
}

// 일기토 거절
export function refuseDuel(S, B, challengerSide) {
  const ref = otherSide(challengerSide);
  B[ref].morale = clamp(B[ref].morale - 12, 0, 100);
  B[challengerSide].morale = clamp(B[challengerSide].morale + 8, 0, 100);
  B.duels++;
  B.round++;
  const ch = champion(S, B, challengerSide);
  B.log.push({ r: B.round, text: `${ch?.name || '장수'}의 도전을 ${josa(sideName(S, B, ref), '이/가')} 피했다. 진중이 술렁인다.`, kind: 'duel' });
  endCheck(S, B);
}
// 일기토 결과 반영
export function applyDuel(S, B, challengerSide, duel) {
  B.duels++;
  B.round++;
  const aSide = challengerSide, bSide = otherSide(challengerSide);
  if (!duel.winner) {
    B.log.push({ r: B.round, text: `${josa(duel.a.name, '과/와')} ${duel.b.name}의 일기토는 승부를 내지 못했다.`, kind: 'duel' });
  } else {
    const winSide = duel.winner === 'a' ? aSide : bSide;
    const loseSide = otherSide(winSide);
    const loser = duel.winner === 'a' ? duel.b : duel.a;
    const winner = duel.winner === 'a' ? duel.a : duel.b;
    B[winSide].morale = clamp(B[winSide].morale + 20, 0, 100);
    B[loseSide].morale = clamp(B[loseSide].morale - 30, 0, 100);
    B[loseSide].out.push(loser.id);
    const lo = getOff(S, B, loser.id);
    let fate = '말에서 떨어져 물러났다';
    if (lo && !lo.temp && !B.sim) {
      lo.injured = 3;
      if (duel.fatal) {
        lo.status = 'dead';
        fate = '목숨을 잃었다';
        log(S, `${josa(winner.name, '이/가')} 일기토에서 ${josa(lo.name, '을/를')} 베었다.`, 'major');
        if (lo.faction && S.factions[lo.faction]?.ruler === lo.id) succession(S, lo.faction);
      }
    } else if (lo?.temp) fate = '쓰러졌다';
    B.log.push({ r: B.round, text: `일기토! ${josa(winner.name, '이/가')} ${josa(loser.name, '을/를')} 이겼다. ${josa(loser.name, '은/는')} ${fate}.`, kind: 'duel' });
  }
  endCheck(S, B);
}

const sideName = (S, B, side) => (B[side].fid ? S.factions[B[side].fid].name + ' 군' : '수비대');

// 한 라운드 처리(일기토·퇴각 제외)
export function resolveRound(S, B, tA, tD) {
  if (B.over) return;
  B.round++;
  B.atk.tactic = tA; B.def.tactic = tD;
  const lines = [];
  if (tA === 'retreat' || tD === 'retreat') {
    const side = tA === 'retreat' ? 'atk' : 'def';
    B[side].retreated = true;
    // 물러나며 피해
    const st = sideStats(S, B, side);
    const lossRate = st.traits.has('지리') || (B[side].fid && mod(S, B[side].fid, 'scheme') > 0) ? 0.05 : 0.1;
    B[side].troops = Math.round(B[side].troops * (1 - lossRate));
    B.log.push({ r: B.round, text: `${josa(sideName(S, B, side), '이/가')} 물러난다.`, kind: 'retreat' });
    finish(S, B, otherSide(side), 'retreat');
    return;
  }
  const A = sideStats(S, B, 'atk'), D = sideStats(S, B, 'def');
  const qa = quality(S, B, 'atk', A), qd = quality(S, B, 'def', D);
  let ma = 0.05 * navalMul(S, B, 'atk', A), md = 0.05 * navalMul(S, B, 'def', D);
  let ta = 1, td = 1; // 받는 피해 배수
  const tm = (t, st, side) => {
    if (t === 'charge') {
      let m = 1.3 + (st.traits.has('돌격') ? 0.2 : 0) + (B[side].fid ? mod(S, B[side].fid, 'charge') : 0);
      if (st.traits.has('기병') && !B.siege && !B.naval) m += 0.25;
      if (B.terrain === 'plain') m += 0.1;
      if (B.terrain === 'mountain') m -= 0.15;
      if (B.siege && side === 'atk') m -= 0.25;
      return m;
    }
    if (t === 'volley') {
      let m = 1.0 + (B[side].fid ? mod(S, B[side].fid, 'volley') : 0) + (st.traits.has('궁술') ? 0.2 : 0) + (st.traits.has('화포') ? 0.15 : 0);
      if (B.terrain === 'river') m += 0.1;
      return m;
    }
    if (t === 'hold') return 0.7;
    return 1;
  };
  ma *= tm(tA, A, 'atk'); md *= tm(tD, D, 'def');
  if (tA === 'charge') ta *= 1.15; if (tD === 'charge') td *= 1.15;
  if (tA === 'hold') ta *= 0.6; if (tD === 'hold') td *= 0.6;
  if (tA === 'volley') ta *= 0.9; if (tD === 'volley') td *= 0.9;
  // 상성
  if (tA === 'charge' && tD === 'hold') { ma *= 0.55; md *= 1.6; lines.push('수비진이 돌격을 받아쳤다!'); }
  if (tD === 'charge' && tA === 'hold') { md *= 0.55; ma *= 1.6; lines.push('굳힌 진이 역습을 꺾었다!'); }
  if (tA === 'charge' && tD === 'volley') { ma *= 1.15; md *= 0.85; }
  if (tD === 'charge' && tA === 'volley') { md *= 1.15; ma *= 0.85; }
  if (tA === 'hold' && tD === 'hold') { ma *= 0.5; md *= 0.5; B.atk.morale -= 3; lines.push('양군이 서로 노려볼 뿐이다.'); }
  // 계략
  const doScheme = (side, tOwn, tOpp) => {
    if (tOwn !== 'scheme') return 1;
    const p = schemeChance(S, B, side, tOpp);
    const nm = schemeName(B, side);
    if (tOpp === 'charge') { lines.push(`${sideName(S, B, side)}의 ${josa(nm, '은/는')} 돌격에 흩어졌다.`); B[side].morale -= 5; return 0.3; }
    if (R.chance(p)) {
      B[otherSide(side)].morale -= 12;
      lines.push(`${sideName(S, B, side)}의 ${josa(nm, '이/가')} 적중했다!`);
      return 2.1;
    }
    B[side].morale -= 5;
    lines.push(`${sideName(S, B, side)}의 ${josa(nm, '이/가')} 간파당했다.`);
    return 0.35;
  };
  const sa = doScheme('atk', tA, tD), sd = doScheme('def', tD, tA);
  ma *= sa; md *= sd;
  if (tA === 'charge' && tD === 'scheme') ma *= 1.2;
  if (tD === 'charge' && tA === 'scheme') md *= 1.2;
  // 성곽
  let wallF = 1;
  if (B.siege && B.wall > 0) {
    wallF = 1 + B.wall / 600;
    const capBonus = S.wonders.namhan?.owner === B.def.fid && S.factions[B.def.fid]?.capital === B.to ? 1.4 : 1;
    wallF *= capBonus;
  }
  const reg = S.regions[B.to];
  let defTake = td / wallF;
  if (D.traits.has('수성')) defTake *= 0.8;
  if (!B.naval && reg.owner === B.def.fid) defTake /= 1 + (buildingEff(reg).defBonus || 0);
  if (A.traits.has('수성') && B.naval) ta *= 0.9;
  // 계절
  let seasonF = 1;
  if (B.season === 3) { seasonF = 0.9; B.atk.morale -= 3; }
  if (B.atk.fid && S.factions[B.atk.fid].rice <= 0) B.atk.morale -= 5;
  const dmgToDef = Math.round(B.atk.troops * qa * ma * defTake * seasonF * R.range(0.85, 1.15));
  const dmgToAtk = Math.round(B.def.troops * qd * md * ta * seasonF * R.range(0.85, 1.15));
  const dB = Math.min(B.def.troops, dmgToDef), aB = Math.min(B.atk.troops, dmgToAtk);
  const defBefore = Math.max(1, B.def.troops), atkBefore = Math.max(1, B.atk.troops);
  B.def.troops -= dB;
  B.atk.troops -= aB;
  B.def.morale -= (dB / defBefore) * 110;
  B.atk.morale -= (aB / atkBefore) * 110;
  if (dB > aB * 1.5) B.atk.morale += 3;
  if (aB > dB * 1.5) B.def.morale += 3;
  // 성벽 깎기
  if (B.siege && B.wall > 0) {
    let w = B.atk.troops * 0.008 * (1 + mod(S, B.atk.fid, 'siege') + (A.traits.has('화포') ? 0.3 : 0));
    w *= { charge: 1.4, volley: 1.0, hold: 0.2, scheme: sa > 1 ? 2.2 : 0.4 }[tA] || 1;
    B.wall = Math.max(0, B.wall - w);
    if (B.wall <= 0) lines.push('성벽이 무너졌다!');
  }
  B.atk.morale = clamp(B.atk.morale, 0, 100);
  B.def.morale = clamp(B.def.morale, 0, 100);
  B.atk.lastTactic = tA; B.def.lastTactic = tD;
  B.log.push({ r: B.round, text: `${TACTICS[tA].name} 대 ${TACTICS[tD].name}. 적 ${dB.toLocaleString()} / 아군 ${aB.toLocaleString()} 손실.${lines.length ? ' ' + lines.join(' ') : ''}`, kind: 'round', dA: aB, dD: dB, tA, tD });
  endCheck(S, B);
}

function endCheck(S, B) {
  if (B.over) return;
  const dead = (s) => B[s].troops <= Math.max(50, B[s].troops0 * 0.04) || B[s].morale <= 0;
  if (dead('def')) return finish(S, B, 'atk', B.def.morale <= 0 ? 'rout' : 'destroyed');
  if (dead('atk')) return finish(S, B, 'def', B.atk.morale <= 0 ? 'rout' : 'destroyed');
  if (B.round >= B.maxRounds) return finish(S, B, 'def', 'timeout');
}
function finish(S, B, winner, reason) {
  B.over = true;
  B.winner = winner;
  B.reason = reason;
}

// 자동 전투(AI끼리, 또는 맡겨 두기)
export function autoBattle(S, B) {
  let guard = 0;
  while (!B.over && guard++ < 40) {
    const tA = aiTactic(S, B, 'atk');
    const tD = aiTactic(S, B, 'def');
    if (tA === 'duel' || tD === 'duel') {
      const chSide = tA === 'duel' ? 'atk' : 'def';
      const ch = champion(S, B, chSide);
      if (aiAcceptDuel(S, B, otherSide(chSide), ch)) {
        const d = createDuel(S, ch, champion(S, B, otherSide(chSide)));
        autoDuel(d);
        applyDuel(S, B, chSide, d);
      } else refuseDuel(S, B, chSide);
      continue;
    }
    resolveRound(S, B, tA, tD);
  }
  if (!B.over) finish(S, B, 'def', 'timeout');
  return B;
}

// 모의 전투: 실제 상태를 건드리지 않고 n번 싸워 본다 → { win, atkLoss, defLoss }
export function simulateAttack(S, { fid, from, to, officers, troops, naval = false }, n = 8) {
  const saved = R.getState();
  let win = 0, aL = 0, dL = 0;
  for (let i = 0; i < n; i++) {
    const B = createBattle(S, { fid, from, to, officers, troops, naval, dry: true });
    autoBattle(S, B);
    if (B.winner === 'atk') win++;
    aL += B.atk.troops0 - B.atk.troops;
    dL += B.def.troops0 - B.def.troops;
  }
  R.setState(saved);
  return { win: win / n, atkLoss: aL / n, defLoss: dL / n };
}

// ── 일기토 ──
export const DUEL_ACTS = {
  attack: { name: '베기', desc: '빠른 공격. 내려치기를 끊지만 막기에 걸린다.' },
  heavy: { name: '내려치기', desc: '큰 공격. 막기를 부수지만 베기에 끊긴다.' },
  guard: { name: '막기', desc: '받아넘기고 되친다. 베기에 강하다.' },
  focus: { name: '기합', desc: '기(氣)를 모은다. 그 사이엔 무방비.' },
  special: { name: '필살', desc: '기가 가득 찼을 때. 막기로도 절반밖에 못 막는다.' },
};
export function createDuel(S, oa, ob) {
  const mk = (o) => ({ id: o.id, name: o.name, look: o.look, seed: o.seed, str: duelPower(o), int: eff(o).int, hp: 100, ki: 0, hist: [] });
  return { a: mk(oa), b: mk(ob), round: 0, max: 12, log: [], over: false, winner: null, fatal: false };
}
const DUEL_LINES = {
  attack: ['칼끝이 번뜩였다', '재빠르게 베어 들었다', '창이 옆구리를 노렸다'],
  heavy: ['힘껏 내려쳤다', '온 힘을 실어 후려쳤다', '말 위에서 크게 휘둘렀다'],
  guard: ['받아넘겼다', '자루로 막아 냈다'],
  focus: ['숨을 고르며 기를 모은다', '눈을 부릅떴다'],
  special: ['필살의 일격!', '천둥 같은 한 칼!'],
};
export function duelStep(D, actA, actB) {
  if (D.over) return;
  D.round++;
  const dmg = (me, op, mult) => Math.max(2, Math.round((6 + me.str * 0.12 + (me.str - op.str) * 0.15) * mult * R.range(0.85, 1.15)));
  const res = { a: 0, b: 0 }; // 받은 피해
  const P = { a: D.a, b: D.b };
  const acts = { a: actA, b: actB };
  if (actA === 'special' && D.a.ki < 100) acts.a = 'attack';
  if (actB === 'special' && D.b.ki < 100) acts.b = 'attack';
  const hit = (from, to, mult) => { res[to] += dmg(P[from], P[to], mult); };
  const pair = (x, y) => {
    const ax = acts[x], ay = acts[y];
    if (ax === 'attack') {
      if (ay === 'guard') { /* 막힘 */ }
      else if (ay === 'heavy') hit(x, y, 1.0);
      else hit(x, y, ay === 'focus' ? 1.2 : 1.0);
    }
    if (ax === 'heavy') {
      if (ay === 'attack') hit(x, y, 0.4);
      else if (ay === 'guard') hit(x, y, 1.4);
      else hit(x, y, ay === 'focus' ? 2.0 : 1.7);
    }
    if (ax === 'guard' && ay === 'attack') hit(x, y, 0.6);
    if (ax === 'special') { hit(x, y, ay === 'guard' ? 1.5 : 3.0); P[x].ki = 0; }
  };
  pair('a', 'b');
  pair('b', 'a');
  for (const k of ['a', 'b']) {
    const o = k === 'a' ? 'b' : 'a';
    P[k].hp = Math.max(0, P[k].hp - res[k]);
    if (acts[k] === 'focus') P[k].ki = Math.min(100, P[k].ki + 45);
    if (acts[k] === 'guard' && acts[o] === 'guard') P[k].ki = Math.min(100, P[k].ki + 20);
    if (res[o] > 0 && acts[k] !== 'special') P[k].ki = Math.min(100, P[k].ki + 12);
    if (res[k] > 0) P[k].ki = Math.min(100, P[k].ki + 18);
    P[k].hist.push(acts[k]);
  }
  const say = (k) => `${P[k].name}: ${R.pick(DUEL_LINES[acts[k]])}`;
  D.log.push({ r: D.round, text: `${say('a')} / ${say('b')}`, da: res.a, db: res.b, acts: { ...acts } });
  if (D.a.hp <= 0 || D.b.hp <= 0) {
    D.over = true;
    if (D.a.hp <= 0 && D.b.hp <= 0) D.winner = D.a.hp >= D.b.hp ? 'a' : 'b';
    else D.winner = D.a.hp <= 0 ? 'b' : 'a';
    const w = P[D.winner], l = P[D.winner === 'a' ? 'b' : 'a'];
    D.fatal = R.chance(w.str - l.str > 15 ? 0.25 : 0.1);
  } else if (D.round >= D.max) {
    D.over = true;
    D.winner = null;
  }
}
export function aiDuelAction(D, side) {
  const me = D[side], op = D[side === 'a' ? 'b' : 'a'];
  if (me.ki >= 100 && R.chance(0.75)) return 'special';
  // 상대 버릇 읽기
  const recent = op.hist.slice(-3);
  const freq = { attack: 0, heavy: 0, guard: 0, focus: 0, special: 0 };
  for (const h of recent) freq[h]++;
  const smart = clamp(me.int / 110, 0.2, 0.9);
  const w = { attack: 1.2, heavy: 1.0, guard: 0.9, focus: me.ki >= 55 ? 0.6 : 0.35 };
  if (op.ki >= 100) w.guard += 1.5;
  if (R.chance(smart)) {
    if (freq.attack >= 2) w.guard += 1.6;
    if (freq.guard >= 2) w.heavy += 1.6;
    if (freq.heavy >= 2) w.attack += 1.6;
    if (freq.focus >= 1) w.heavy += 1.0;
  }
  return R.weighted(Object.keys(w), (k) => w[k]);
}
export function autoDuel(D) {
  let g = 0;
  while (!D.over && g++ < 20) duelStep(D, aiDuelAction(D, 'a'), aiDuelAction(D, 'b'));
  return D;
}

// ── 전투 결과를 세계에 반영 ──
// 돌려주는 값: { captives: [officerId], taken, text }
export function applyBattle(S, B) {
  const fr = S.regions[B.from], tr = S.regions[B.to];
  const A = B.atk, D = B.def;
  const af = S.factions[A.fid], df = D.fid ? S.factions[D.fid] : null;
  const out = { captives: [], taken: false, text: '' };
  const atkName = af.name, defName = df ? df.name : tr.rebels ? '민란군' : '수비대';
  const tname = regionBase(B.to).name;
  for (const s of ['atk', 'def']) for (const id of B[s].out) { const o = S.officers[id]; if (o && o.status === 'active') o.injured = Math.max(o.injured, 2); }
  af.recent.battles += 1;
  if (df) df.recent.battles += 1;
  if (df) addRelation(S, A.fid, D.fid, -15);
  if (df && treaty(S, A.fid, D.fid)) clearTreaty(S, A.fid, D.fid);
  const heal = (side) => (activeOffs(S, B, side).some((o) => hasTrait(o, '의술')) ? 1.12 : 1);

  if (B.naval) {
    const won = B.winner === 'atk';
    if (fr.owner === A.fid) fr.troops += Math.round(A.troops * heal('atk'));
    S.scn.waeNavy = Math.max(1500, Math.round(D.troops));
    S.scn.sea = clamp((S.scn.sea || 0) + (won ? 18 + Math.round((D.troops0 - D.troops) / 1000) : -10), 0, 100);
    if (won) { af.recent.wins++; af.prestige += 15; af.prestigeTotal += 15; af.stats.won++; }
    else { af.recent.losses++; af.stats.lost++; }
    out.text = won ? `해전 승리! 왜 수군 ${josa((D.troops0 - D.troops).toLocaleString(), '을/를')} 수장시켰다. 제해권 ${S.scn.sea}.` : `해전에서 밀려났다. 제해권 ${S.scn.sea}.`;
    log(S, `${regionBase(B.from).name} 앞바다 해전: ${out.text}`, won ? 'major' : 'war', A.fid);
    return out;
  }

  if (B.siege) tr.def = Math.max(0, Math.round(B.wall));
  if (B.winner === 'atk') {
    out.taken = true;
    // 수비측 장수: 피하거나 사로잡힘
    if (df) {
      const offs = officersIn(S, B.to, D.fid);
      const dest = nearestAdjOwned(S, B.to, D.fid) || nearestOwned(S, B.to, D.fid);
      for (const o of offs) {
        const esc = isRuler(S, o) ? 0.85 : 0.42 + eff(o).str / 250 + (D.retreated ? 0.3 : 0);
        if (dest && R.chance(esc)) o.loc = dest;
        else { o.status = 'captive'; o.captor = A.fid; out.captives.push(o.id); }
      }
      // 물러난 병력
      if (D.retreated && dest) S.regions[dest].troops += Math.round(D.troops * 0.8);
      df.recent.losses++;
      df.stats.lost++;
    }
    changeOwner(S, B.to, A.fid, { moveOfficers: false });
    tr.troops = Math.round(A.troops * heal('atk'));
    tr.training = Math.round((tr.training + A.training) / 2);
    tr.loyalty = clamp(tr.loyalty - (activeOffs(S, B, 'atk').some((o) => hasTrait(o, '인덕')) ? 6 : 15), 0, 100);
    tr.unrest = 10;
    tr.rebels = false;
    for (const id of A.officers) { const o = S.officers[id]; if (o && o.status === 'active') o.loc = B.to; }
    af.recent.wins++;
    af.stats.won++;
    const pres = df && S.factions[D.fid] && df.capital === B.to ? 30 : 10;
    af.prestige += pres; af.prestigeTotal += pres;
    // 건물 일부가 불탄다
    if (tr.buildings.length && R.chance(0.3)) tr.buildings.splice(R.int(0, tr.buildings.length - 1), 1);
    out.text = `${atkName} 군이 ${josa(tname, '을/를')} 차지했다.`;
    log(S, `${atkName} 군이 ${defName}의 ${josa(tname, '을/를')} 함락했다.`, 'war', A.fid);
    if (df) checkFactionAlive(S, D.fid);
  } else {
    // 공격 실패: 살아남은 병력은 돌아간다
    if (fr.owner === A.fid) fr.troops += Math.round(A.troops * (B.reason === 'rout' ? 0.85 : 1) * heal('atk'));
    if (B.reason === 'rout') {
      for (const id of A.officers) {
        const o = S.officers[id];
        if (!o || o.status !== 'active' || !D.fid) continue;
        if (R.chance(isRuler(S, o) ? 0.04 : 0.12)) { o.status = 'captive'; o.captor = D.fid; out.captives.push(o.id); }
      }
    }
    tr.troops = Math.round(D.troops * heal('def'));
    af.recent.losses++;
    af.stats.lost++;
    if (df) { df.recent.wins++; df.stats.won++; df.prestige += 8; df.prestigeTotal += 8; }
    out.text = B.reason === 'timeout' ? `${josa(tname, '을/를')} 끝내 함락하지 못하고 물러났다.` : `${atkName} 군이 ${tname}에서 패퇴했다.`;
    log(S, `${atkName} 군의 ${tname} 공격이 실패했다.`, 'war', A.fid);
  }
  // 공격측이 출발지를 잃었는데 실패한 경우 장수 대피
  for (const id of A.officers) {
    const o = S.officers[id];
    if (o && o.status === 'active' && S.regions[o.loc].owner !== o.faction) {
      const d = nearestOwned(S, o.loc, o.faction);
      if (d) o.loc = d; else { o.status = 'captive'; o.captor = S.regions[o.loc].owner; if (o.captor) out.captives.push(o.id); else { o.status = 'free'; o.faction = null; } }
    }
  }
  return out;
}

// ── 포로 처리 ──
export function captiveHireChance(S, captorFid, o) {
  if (isRulerAny(S, o)) return 0;
  const ruler = S.officers[S.factions[captorFid].ruler];
  const rc = ruler ? eff(ruler).cha : 50;
  const foreign = S.factions[captorFid].foreign || S.factions[o.faction]?.foreign ? 0.25 : 1;
  return clamp((0.18 + (rc - 50) / 110 + (100 - o.loyalty) / 140 + Math.min(0.1, S.factions[captorFid].prestige / 3000)) * foreign, 0.02, 0.9);
}
const isRulerAny = (S, o) => Object.values(S.factions).some((f) => f.alive && f.ruler === o.id);
export function resolveCaptive(S, captorFid, oid, decision) {
  const o = S.officers[oid];
  if (!o || o.status !== 'captive') return { ok: false, text: '' };
  const cf = S.factions[captorFid];
  const origin = o.faction;
  const wasRuler = isRulerAny(S, o);
  if (decision === 'hire') {
    if (R.chance(captiveHireChance(S, captorFid, o))) {
      o.faction = captorFid; o.status = 'active'; o.loyalty = R.int(55, 72); o.acted = true; delete o.captor;
      o.loc = S.regions[o.loc]?.owner === captorFid ? o.loc : cf.capital;
      log(S, `${josa(o.name, '이/가')} ${cf.name} 세력에 투항했다.`, 'good', captorFid);
      return { ok: true, text: `${josa(o.name, '이/가')} 고개를 숙였다. "이 몸, 견마지로를 다하겠소."` };
    }
    return { ok: false, text: `${josa(o.name, '이/가')} 고개를 돌린다. "두 임금을 섬길 수는 없소."` };
  }
  if (decision === 'execute') {
    o.status = 'dead'; delete o.captor;
    const famous = statSum(o) > 360;
    cf.prestige = Math.max(0, cf.prestige - (famous ? 25 : 10));
    if (origin) addRelation(S, captorFid, origin, -20);
    log(S, `${cf.name} 세력이 ${josa(o.name, '을/를')} 처형했다.`, 'war', captorFid);
    if (wasRuler && origin) succession(S, origin);
    return { ok: true, text: `${josa(o.name, '이/가')} 형장의 이슬로 사라졌다.` };
  }
  // 석방
  delete o.captor;
  if (origin && S.factions[origin]?.alive) {
    const dest = nearestOwned(S, o.loc, origin) || S.factions[origin].capital;
    o.status = 'active'; o.loc = dest;
    addRelation(S, captorFid, origin, 8);
  } else { o.status = 'free'; o.faction = null; o.found = true; }
  cf.prestige += 5; cf.prestigeTotal += 5;
  return { ok: true, text: `${josa(o.name, '을/를')} 풀어 주었다. 너그럽다는 소문이 돈다.` };
}
export function aiCaptiveDecision(S, captorFid, o) {
  const f = S.factions[captorFid];
  if (captiveHireChance(S, captorFid, o) > 0.05) return 'hire';
  if (isRulerAny(S, o) && (f.personality?.aggr || 0.5) > 0.7 && R.chance(0.5)) return 'execute';
  return R.chance((f.personality?.aggr || 0.5) * 0.15) ? 'execute' : 'release';
}
