// 외교: 친선(선물)·동맹·휴전·항복 권고·맹약 파기
import { clamp, R } from './util.js';
import { eff, hasTrait, relation, addRelation, treaty, setTreaty, clearTreaty, factionPower, regionsOf, officersOf, log, adjOf, changeOwner } from './state.js';

export const DIPLO = {
  gift: { name: '친선', desc: '錢 300을 보내 사이를 좋게 한다.' },
  alliance: { name: '동맹', desc: '서로 치지 않는다. 사이가 좋아야(40+) 받아들인다.' },
  truce: { name: '휴전', desc: '두 해(8철) 동안 싸움을 멈춘다.' },
  surrender: { name: '항복 권고', desc: '힘이 압도적이면 세력째 받아들인다.' },
};

export function borders(S, a, b) {
  return regionsOf(S, a).some((r) => adjOf(r.id).some((n) => S.regions[n].owner === b));
}

export function diploChance(S, from, to, type, envoy) {
  const rel = relation(S, from, to);
  const pa = factionPower(S, from), pb = factionPower(S, to);
  const ratio = pa / Math.max(1, pb);
  const ch = envoy ? eff(envoy).cha : 60;
  const dip = envoy && hasTrait(envoy, '외교') ? 0.2 : 0;
  const tf = S.factions[to];
  const per = tf.personality || { aggr: 0.5, dip: 0.5 };
  if (tf.foreign && type !== 'gift' && type !== 'truce') return 0;
  switch (type) {
    case 'gift': return 1;
    case 'alliance': {
      if (rel < 30) return 0;
      // 공동의 강적이 있으면 쉽다
      const threat = Object.values(S.factions).some((f) => f.alive && f.id !== from && f.id !== to && factionPower(S, f.id) > Math.max(pa, pb) * 1.3 && borders(S, to, f.id));
      return clamp((rel - 30) / 60 + (ch - 60) / 150 + dip + (threat ? 0.2 : 0) + (per.dip - 0.5) * 0.3 - (ratio < 0.5 ? 0.15 : 0), 0, 0.95);
    }
    case 'truce': return clamp(0.25 + (rel + 30) / 160 + (ratio > 1 ? 0.25 : -0.1) + (ch - 60) / 150 + dip - per.aggr * 0.2, 0, 0.9);
    case 'surrender': {
      const nb = regionsOf(S, to).length;
      if (ratio < 3.5 || nb > 4) return 0.01;
      return clamp(0.15 + (ratio - 3.5) * 0.06 + (rel + 50) / 250 + (ch - 60) / 200 + dip - per.aggr * 0.15, 0, 0.75);
    }
  }
  return 0;
}

// 제안 실행(받는 쪽이 AI일 때). 결과 문장을 돌려준다.
export function propose(S, from, to, type, envoy) {
  const F = S.factions[from], T = S.factions[to];
  if (type === 'gift') {
    const d = 8 + Math.round((envoy ? eff(envoy).cha : 60) / 10) + (envoy && hasTrait(envoy, '외교') ? 5 : 0);
    addRelation(S, from, to, d);
    return { ok: true, text: `${T.name} 세력이 선물을 받았다. 우호 +${d}` };
  }
  const p = diploChance(S, from, to, type, envoy);
  const ok = R.chance(p);
  if (!ok) {
    addRelation(S, from, to, -3);
    return { ok: false, text: `${T.name} 세력이 거절했다(${Math.round(p * 100)}%).` };
  }
  return { ok: true, text: acceptDiplo(S, from, to, type) };
}
export function acceptDiplo(S, from, to, type) {
  const F = S.factions[from], T = S.factions[to];
  if (type === 'alliance') {
    setTreaty(S, from, to, 'alliance', null);
    addRelation(S, from, to, 15);
    log(S, `${F.name} 세력과 ${T.name} 세력이 동맹을 맺었다.`, 'major', from);
    return `${T.name} 세력과 동맹을 맺었다!`;
  }
  if (type === 'truce') {
    setTreaty(S, from, to, 'truce', 8);
    addRelation(S, from, to, 10);
    log(S, `${F.name} 세력과 ${T.name} 세력이 휴전했다.`, 'info', from);
    return `${T.name} 세력과 두 해 동안 휴전한다.`;
  }
  if (type === 'surrender') {
    annex(S, from, to);
    return `${T.name} 세력이 항복했다! 땅과 장수가 모두 우리 것이 되었다.`;
  }
  return '';
}

// 세력 병합
export function annex(S, winner, loser) {
  const W = S.factions[winner], L = S.factions[loser];
  for (const r of regionsOf(S, loser)) {
    const tr = r.troops;
    changeOwner(S, r.id, winner, { moveOfficers: false, keepTroops: true });
    r.troops = tr;
  }
  for (const o of officersOf(S, loser)) {
    o.faction = winner;
    o.loyalty = R.int(50, 68);
  }
  // 옛 군주도 장수로
  const ruler = S.officers[L.ruler];
  if (ruler && ruler.status === 'active') { ruler.faction = winner; ruler.loyalty = 60; }
  W.gold += Math.max(0, L.gold);
  W.rice += Math.max(0, L.rice);
  W.treasury.push(...L.treasury);
  L.treasury = [];
  L.alive = false;
  for (const f of Object.values(S.factions)) delete f.treaties[loser];
  W.prestige += 60; W.prestigeTotal += 60;
  log(S, `${L.name} 세력이 ${W.name} 세력에 항복했다.`, 'major', winner);
}

export function breakTreaty(S, from, to) {
  const t = treaty(S, from, to);
  if (!t) return '맺은 약조가 없다';
  clearTreaty(S, from, to);
  const F = S.factions[from];
  F.prestige = Math.max(0, F.prestige - (t.type === 'alliance' ? 30 : 15));
  F.legit = clamp(F.legit - (t.type === 'alliance' ? 6 : 3), 0, 100);
  addRelation(S, from, to, -40);
  for (const f of Object.values(S.factions)) if (f.alive && f.id !== from && f.id !== to) addRelation(S, from, f.id, -5);
  log(S, `${F.name} 세력이 ${S.factions[to].name} 세력과의 ${t.type === 'alliance' ? '동맹' : '휴전'}을 깼다.`, 'war', from);
  return null;
}

// 관계 자연 변화(턴마다)
export function relationsTick(S) {
  const fs = Object.values(S.factions).filter((f) => f.alive);
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    const a = fs[i].id, b = fs[j].id;
    const t = treaty(S, a, b);
    const r = relation(S, a, b);
    let d = 0;
    if (t?.type === 'alliance') d += 1;
    else if (borders(S, a, b)) d -= 1;
    else d += r < 0 ? 1 : r > 20 ? -0.5 : 0;
    addRelation(S, a, b, d);
    // 만료된 휴전 정리
    if (S.factions[a].treaties[b] && !t) clearTreaty(S, a, b);
  }
}
