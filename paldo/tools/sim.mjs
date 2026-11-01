// 헤드리스 시뮬레이션: 플레이어 자리도 자동으로 두고 N턴 돌리며 불변식을 검사한다.
//   node tools/sim.mjs --scenario=allstar --player=sejong --turns=200 --seed=1 [--quiet]
import { newGame, regionsOf, officersOf, dateStr, aliveFactions } from '../js/core/state.js';
import { endTurn } from '../js/core/turn.js';
import { aiTurn } from '../js/core/ai.js';
import { factionIncome, score } from '../js/core/rules.js';
import { R } from '../js/core/util.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const scenario = args.scenario || 'allstar';
const turns = Number(args.turns || 160);
const seed = Number(args.seed || 1);
const S = newGame({ scenario, player: args.player, difficulty: args.diff || 'normal', seed });
const P = S.player;
let errors = 0;
const bad = (msg) => { errors++; if (errors < 30) console.error('✗', msg); };
const stats = { events: 0, battles: 0, duels: 0, proposals: 0, captives: 0 };

const hooks = {
  event: async (inst) => { stats.events++; const ok = inst.choices.map((c, i) => [c, i]).filter(([c]) => c.ok); return R.pick(ok)?.[1] ?? 0; },
  battle: async () => { stats.battles++; },
  duel: async () => { stats.duels++; },
  proposal: async () => { stats.proposals++; return R.chance(0.5); },
  captive: async (o) => { stats.captives++; const { resolveCaptive } = await import('../js/core/battle.js'); resolveCaptive(S, S.player, o.id, R.pick(['hire', 'release', 'execute'])); },
  notify: () => {},
  progress: () => {},
};

function check() {
  const num = (v, what) => { if (!Number.isFinite(v)) bad(`${dateStr(S)} ${what} = ${v}`); };
  for (const f of Object.values(S.factions)) {
    num(f.gold, f.id + '.gold'); num(f.rice, f.id + '.rice'); num(f.prestige, f.id + '.prestige'); num(f.legit, f.id + '.legit');
    num(f.research.prog, f.id + '.prog');
    for (const ig in f.igs) num(f.igs[ig].appr, f.id + '.ig.' + ig);
    if (f.alive && !S.officers[f.ruler]) bad(`${f.id} 군주 없음`);
    if (f.alive && S.officers[f.ruler]?.status !== 'active') bad(`${f.id} 군주 상태 ${S.officers[f.ruler]?.status} ${S.officers[f.ruler]?.name}`);
    if (f.alive && S.officers[f.ruler]?.faction !== f.id) bad(`${f.id} 군주 소속 ${S.officers[f.ruler]?.faction}`);
    if (f.alive && S.regions[f.capital]?.owner !== f.id) bad(`${f.id} 도읍 ${f.capital} 주인 ${S.regions[f.capital]?.owner}`);
  }
  for (const r of Object.values(S.regions)) {
    for (const k of ['pop', 'agri', 'comm', 'def', 'loyalty', 'troops', 'training']) num(r[k], r.id + '.' + k);
    if (r.troops < 0) bad(`${r.id} 병력 음수`);
    if (r.owner && !S.factions[r.owner].alive) bad(`${r.id} 주인 멸망 세력 ${r.owner}`);
  }
  for (const o of Object.values(S.officers)) {
    if (o.status === 'active') {
      if (!o.faction || !S.factions[o.faction]?.alive) bad(`${o.name} 활동 중인데 세력 ${o.faction}`);
      else if (S.regions[o.loc]?.owner !== o.faction) bad(`${dateStr(S)} ${o.name}(${o.faction}) 위치 ${o.loc} 주인 ${S.regions[o.loc]?.owner}`);
    }
    if (o.status === 'captive') bad(`${o.name} 포로로 남음`);
    for (const k of ['lea', 'str', 'int', 'pol', 'cha', 'loyalty']) num(o[k], o.name + '.' + k);
  }
}

const t0 = Date.now();
for (let t = 0; t < turns && !S.over; t++) {
  try {
    // 플레이어 자리도 AI 처럼 둔다(UI 없이 규칙 전체를 돌리기 위해)
    if (S.factions[P].alive) await aiTurn(S, P, hooks);
    await endTurn(S, hooks);
  } catch (e) { bad('예외: ' + (e.stack || e)); break; }
  check();
  if (!args.quiet && (t % Number(args.every || 20) === Number(args.every || 20) - 1 || S.over)) {
    console.log(`── ${dateStr(S)} (턴 ${S.turn}) ──`);
    for (const f of aliveFactions(S)) {
      const inc = factionIncome(S, f.id);
      console.log(`  ${f.name.padEnd(5)} 고을 ${String(regionsOf(S, f.id).length).padStart(2)} 장수 ${String(officersOf(S, f.id).length).padStart(2)} 병력 ${String(regionsOf(S, f.id).reduce((s, r) => s + r.troops, 0)).padStart(7)} 錢 ${String(Math.round(f.gold)).padStart(6)}(${Math.round(inc.netGold)}) 米 ${String(Math.round(f.rice)).padStart(6)}(${Math.round(inc.netRice)}) 學 ${Math.round(inc.sci)} 기술 ${Object.keys(f.techs).length} 名 ${Math.round(f.prestigeTotal)} 정통 ${Math.round(f.legit)} 점수 ${score(S, f.id)}`);
    }
  }
}
const neutral = Object.values(S.regions).filter((r) => !r.owner).length;
console.log(`\n결과: ${S.over ? S.over.text : '진행 중'} | 턴 ${S.turn} | 중립 고을 ${neutral} | 위업 ${Object.keys(S.wonders).join(',') || '-'}`);
console.log(`사건 ${stats.events} · 플레이어 전투 ${stats.battles} · 일기토 ${stats.duels} · 제안 ${stats.proposals} · 포로 ${stats.captives} · ${Date.now() - t0}ms`);
console.log(`최근 기록:\n  ` + S.log.slice(-12).map((l) => `${l.d} ${l.text}`).join('\n  '));
if (errors) { console.error(`\n오류 ${errors}건`); process.exit(1); }
console.log('불변식 통과');
