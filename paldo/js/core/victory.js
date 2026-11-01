// 승패 판정
import { regionsOf, aliveFactions, scenarioOf, dateStr } from './state.js';
import { score } from './rules.js';
import { REGIONS } from '../data/regions.js';

export function victoryProgress(S, fid) {
  const sc = scenarioOf(S);
  const V = sc.victory || {};
  const f = S.factions[fid];
  const regs = regionsOf(S, fid).length;
  const wonders = Object.values(S.wonders).filter((w) => w.owner === fid).length;
  const rivals = aliveFactions(S).filter((x) => x.id !== fid).length;
  return {
    unify: V.unify ? { regs, need: V.unify, rivals } : null,
    culture: V.culture ? { pres: Math.round(f.prestigeTotal), need: V.culture, wonders, needW: V.cultureWonders } : null,
    modern: V.modernRegions ? { done: !!f.techs.gwangmu, regs, need: V.modernRegions } : null,
  };
}

export function checkVictory(S, endOfTurn = false) {
  const sc = scenarioOf(S);
  const V = sc.victory || {};
  const P = S.player;
  const pf = S.factions[P];
  if (!pf.alive || regionsOf(S, P).length === 0) return { result: 'lose', type: 'destroyed', text: `${pf.name} 세력이 멸망했다. 천하의 꿈이 스러졌다.` };
  if (sc.special === 'imjin') {
    const wae = S.factions.wae, jos = S.factions.joseon;
    if (!wae.alive || regionsOf(S, 'wae').length === 0) return { result: P === 'joseon' ? 'win' : 'lose', type: 'expel', text: '왜군이 이 땅에서 모두 물러갔다. 칠 년 전쟁이 끝났다.' };
    if (!jos.alive) return { result: P === 'wae' ? 'win' : 'lose', type: 'conquest', text: '조선 조정이 무너졌다.' };
    if (S.year > sc.endYear || (S.year === sc.endYear && S.season === 3 && endOfTurn)) {
      const jr = regionsOf(S, 'joseon').length, wr = regionsOf(S, 'wae').length;
      const jWin = S.regions.hanseong.owner === 'joseon' && wr <= 4;
      if (jWin) return { result: P === 'joseon' ? 'win' : 'lose', type: 'endwar', text: `무술년 겨울, 왜군이 남해안 몇 곳(${wr}곳)만 남긴 채 바다를 건너갔다. 조선은 나라를 지켰다.` };
      return { result: P === 'wae' ? 'win' : 'lose', type: 'endwar', text: `전쟁이 끝났으나 왜군이 ${wr}곳을 쥐고 있다. 상처뿐인 강화.` };
    }
    return null;
  }
  for (const f of aliveFactions(S)) {
    const regs = regionsOf(S, f.id).length;
    const rivals = aliveFactions(S).filter((x) => x.id !== f.id).length;
    const res = f.id === P ? 'win' : 'lose';
    if (V.unify && (regs >= V.unify && rivals === 0 || regs >= REGIONS.length)) return { result: res, type: 'unify', fid: f.id, text: `${f.name} 세력이 팔도를 하나로 묶었다! 천하통일.` };
    if (V.culture && f.prestigeTotal >= V.culture && Object.values(S.wonders).filter((w) => w.owner === f.id).length >= V.cultureWonders) return { result: res, type: 'culture', fid: f.id, text: `${f.name} 세력의 문화가 천하를 덮었다. 태평성대!` };
    if (V.modernRegions && f.techs.gwangmu && regs >= V.modernRegions) return { result: res, type: 'modern', fid: f.id, text: `${f.name} 세력이 광무개혁으로 자주 근대국가를 세웠다. 근대화 승리!` };
  }
  if (sc.endYear && S.year > sc.endYear) {
    const ranks = aliveFactions(S).map((f) => ({ f, s: score(S, f.id) })).sort((a, b) => b.s - a.s);
    const top = ranks[0];
    return { result: top.f.id === P ? 'win' : 'lose', type: 'score', fid: top.f.id, text: `${dateStr(S)}, 시간이 다했다. 가장 큰 공을 이룬 세력은 ${top.f.name}(${top.s.toLocaleString()}점).` };
  }
  return null;
}
