// 한 철(턴)을 넘기는 순서:
//  1) 플레이어의 위임 고을 자동 내정  2) 컴퓨터 세력 차례  3) 수입·인구·연구·정치
//  4) 사건  5) 민란·이탈  6) 시나리오 규칙  7) 인물 등장  8) 승패 판정  9) 다음 철
import { R, clamp, josa } from './util.js';
import { EVENTS } from '../data/events.js';
import { TECH_BY_ID } from '../data/techs.js';
import {
  regionsOf, officersOf, officersIn, log, regionBase, aliveFactions, eff, isRuler, syncRng, scenarioOf, nearestOwned, genOfficer, dateStr,
  hasTrait, adjOf, totalTroops,
} from './state.js';
import { processSeason, buildingEff, mod, score, availableTechs } from './rules.js';
import { delegateRegion, revolt } from './actions.js';
import { aiTurn } from './ai.js';
import { relationsTick } from './diplomacy.js';
import { createDuel, autoDuel } from './battle.js';
import { checkVictory } from './victory.js';

export async function endTurn(S, hooks = {}) {
  if (S.over) return;
  const P = S.player;
  // 1. 플레이어 위임
  for (const r of regionsOf(S, P)) if (r.delegate) delegateRegion(S, r.id, { reserve: 200 });
  // 2. 컴퓨터 세력
  const order = R.shuffle(aliveFactions(S).map((f) => f.id).filter((id) => id !== P));
  for (const fid of order) {
    if (!S.factions[fid].alive) continue;
    hooks.progress?.(`${S.factions[fid].name} 세력의 차례…`, fid);
    await aiTurn(S, fid, hooks);
    if (!S.factions[P].alive) break;
  }
  // 3. 철 처리
  processSeason(S);
  relationsTick(S);
  debtTick(S);
  // 4. 사건
  if (S.factions[P].alive) await runEvents(S, hooks);
  aiEvents(S);
  // 5. 민란·이탈
  unrestTick(S, hooks);
  defectionTick(S, hooks);
  // 6. 시나리오
  if (scenarioOf(S).special === 'imjin') await imjinTick(S, hooks);
  // 7. 인물 등장
  appearTick(S, hooks);
  // 8. 승패
  const v = checkVictory(S);
  if (v) { S.over = v; log(S, v.text, 'major'); }
  // 9. 다음 철
  S.turn++;
  S.season = (S.season + 1) % 4;
  if (S.season === 0) S.year++;
  for (const o of Object.values(S.officers)) o.acted = false;
  for (const f of Object.values(S.factions)) if (f.alive && !f.research.cur && f.id !== P) { /* AI 는 다음 차례에 고른다 */ }
  if (!S.over) {
    const v2 = checkVictory(S, true);
    if (v2) { S.over = v2; log(S, v2.text, 'major'); }
  }
  syncRng(S);
}

function debtTick(S) {
  for (const f of Object.values(S.factions)) {
    if (!f.debt) continue;
    f.gold -= f.debt.per;
    f.debt.left--;
    if (f.debt.left <= 0) delete f.debt;
  }
}

// ── 사건 ──
export async function runEvents(S, hooks) {
  const P = S.player;
  const used = new Set();
  // 꼭 일어나는 사건(식년시·양요)
  for (const ev of EVENTS.filter((e) => e.forced)) {
    if (ev.scope === 'player' || ev.scope === 'all') {
      if (ev.weight(S, P) >= 100) { await present(S, P, ev, hooks); used.add(ev.id); }
    }
  }
  const n = R.chance(0.55) ? (R.chance(0.22) ? 2 : 1) : 0;
  for (let i = 0; i < n; i++) {
    const pool = EVENTS.filter((e) => !e.forced && !used.has(e.id) && (e.scope === 'player' || e.scope === 'all'));
    const ev = R.weighted(pool, (e) => e.weight(S, P));
    if (!ev) break;
    used.add(ev.id);
    await present(S, P, ev, hooks);
  }
}
async function present(S, fid, ev, hooks) {
  const ctx = ev.setup(S, fid);
  if (!ctx) return;
  const choices = ev.choices(S, fid, ctx).map((c) => ({ ...c, ok: c.ok === undefined ? true : !!c.ok }));
  const inst = { id: ev.id, title: ev.title, art: ev.art, text: ev.text(S, fid, ctx), choices };
  let idx = hooks.event ? await hooks.event(inst) : choices.findIndex((c) => c.ok);
  if (!(idx >= 0 && idx < choices.length) || !choices[idx].ok) idx = choices.findIndex((c) => c.ok);
  if (idx < 0) return;
  let out = choices[idx].apply();
  if (out && typeof out === 'object' && out.duel) {
    const d = out.duel;
    const me = S.officers[d.officer];
    const foe = { id: '_e', name: d.enemy.name, look: d.enemy.look || 'rebel', seed: d.enemy.seed || 1, lea: 50, str: d.enemy.str, int: d.enemy.int || 45, pol: 30, cha: 40, traits: [], item: null };
    const D = createDuel(S, me, foe);
    if (hooks.duel) await hooks.duel(D, { title: inst.title });
    if (!D.over) autoDuel(D);
    out = D.winner === 'a' ? d.win() : d.lose();
  }
  const text = typeof out === 'string' ? out : out?.text || '';
  if (text) log(S, `[${ev.title}] ${text}`, 'event', fid);
  await hooks.eventResult?.(inst, text);
}
function aiEvents(S) {
  for (const f of aliveFactions(S)) {
    if (f.id === S.player) continue;
    for (const ev of EVENTS.filter((e) => e.scope === 'all')) {
      const w = ev.weight(S, f.id);
      if (!(w > 0)) continue;
      if (!(ev.forced ? w >= 100 : R.chance(0.045 * w))) continue;
      const ctx = ev.setup(S, f.id);
      if (!ctx) continue;
      const ch = ev.choices(S, f.id, ctx).map((c) => ({ ...c, ok: c.ok === undefined ? true : !!c.ok }));
      let i = typeof ev.ai === 'function' ? ev.ai(S, f.id, ctx) : 0;
      if (!ch[i]?.ok) i = ch.findIndex((c) => c.ok);
      if (i < 0) continue;
      const out = ch[i].apply();
      if (out && typeof out === 'object' && out.duel) { /* AI 일기토 사건은 없다 */ }
    }
  }
}

// ── 민란 ──
function unrestTick(S, hooks) {
  for (const r of Object.values(S.regions)) {
    if (!r.owner) continue;
    const f = S.factions[r.owner];
    if (r.loyalty >= 22) continue;
    if (regionsOf(S, r.owner).length <= 1) continue;
    let p = (22 - r.loyalty) / 60;
    p *= 1 - Math.min(0.8, mod(S, r.owner, 'rebel') + (buildingEff(r).rebel || 0));
    if (!f.foreign && f.igs.nongmin.appr <= -30) p *= 1.5;
    if (r.troops > r.pop * 40) p *= 0.5; // 군사가 많으면 눌린다
    if (!R.chance(p)) continue;
    const name = regionBase(r.id).name;
    const old = f.name;
    if (S.scenario === 'imjin' && r.owner === 'wae' && S.factions.joseon?.alive) {
      // 왜군 점령지의 의병 봉기 → 조선 땅으로
      const hero = genOfficer(S, { kind: 'militia', faction: 'joseon', loc: r.id, loyalty: 90 });
      const tr = r.troops;
      revolt(S, r.id);
      r.owner = 'joseon'; r.rebels = false; r.troops = Math.round(r.pop * 15); r.loyalty = 60;
      hero.loc = r.id;
      log(S, `${name}에서 ${josa(hero.name, '이/가')} 의병을 일으켜 왜군을 몰아냈다!`, 'major', 'joseon');
      continue;
    }
    revolt(S, r.id);
    log(S, `${old}의 ${name}에서 민란이 일어났다! 관아가 불탔다.`, 'major', r.owner);
    if (f.id === S.player) hooks.notify?.(`${name}에서 민란이 일어나 고을을 잃었다!`, 'bad');
  }
}
// 충성 낮은 장수의 이탈
function defectionTick(S, hooks) {
  for (const o of Object.values(S.officers)) {
    if (o.status !== 'active' || o.ally || isRuler(S, o) || o.loyalty >= 30) continue;
    if (!R.chance((30 - o.loyalty) / 120)) continue;
    const f = S.factions[o.faction];
    // 이웃 강한 세력으로 넘어가거나 재야로
    const nb = adjOf(o.loc).map((n) => S.regions[n].owner).filter((x) => x && x !== o.faction && !S.factions[x].foreign);
    const to = R.pick(nb);
    if (to && R.chance(0.5)) {
      const dest = adjOf(o.loc).find((n) => S.regions[n].owner === to);
      o.faction = to; o.loc = dest; o.loyalty = 60;
      log(S, `${f.name}의 ${josa(o.name, '이/가')} ${S.factions[to].name} 세력으로 넘어갔다.`, 'war', f.id);
    } else {
      o.faction = null; o.status = 'free'; o.found = true;
      log(S, `${f.name}의 ${josa(o.name, '이/가')} 벼슬을 버리고 떠났다.`, 'war', f.id);
    }
    if (f.id === S.player) hooks.notify?.(`${josa(o.name, '이/가')} 우리를 떠났다…`, 'bad');
  }
}

// ── 인물 등장 ──
function appearTick(S, hooks) {
  for (const o of Object.values(S.officers)) {
    if (o.status !== 'hidden' || !o.appear) continue;
    const a = o.appear;
    let ready = false;
    if (a.year != null) ready = S.year >= a.year + scenarioOf(S).startYear - 1 || (scenarioOf(S).startYear === 1 && S.year >= a.year);
    if (a.tech) ready = Object.values(S.factions).some((f) => f.alive && f.techs[a.tech]);
    if (a.turn != null) ready = S.turn + 1 >= a.turn;
    if (!ready) continue;
    if (a.join) {
      const f = S.factions[a.join];
      if (!f?.alive) { o.status = 'free'; o.found = true; continue; }
      let loc = o.loc;
      if (S.regions[loc].owner !== a.join) loc = nearestOwned(S, loc, a.join) || f.capital;
      o.status = 'active'; o.faction = a.join; o.loc = loc; o.loyalty = a.ally ? 100 : 90; o.found = true;
      if (a.ally) o.ally = a.ally;
      if (a.militia) S.regions[loc].troops += a.militia;
      const txt = a.ally === 'ming' ? `명의 ${josa(o.name, '이/가')} 원군을 이끌고 ${regionBase(loc).name}에 이르렀다.` : `${josa(o.name, '이/가')} ${regionBase(loc).name}에서 의병을 일으켰다${a.militia ? `(병력 +${a.militia.toLocaleString()})` : ''}!`;
      log(S, txt, 'major', a.join);
      if (a.join === S.player) hooks.notify?.(txt, 'good');
    } else {
      o.status = 'free';
      o.found = false;
      const own = S.regions[o.loc].owner;
      log(S, `${regionBase(o.loc).name}에 ${o.name}(이)라는 인물이 있다는 소문이 돈다.`, 'info', own);
      if (own === S.player) hooks.notify?.(`${regionBase(o.loc).name}에 ${josa(o.name, '이/가')} 나타났다는 소문. 탐색해 보자!`, 'good');
    }
  }
}

// ── 임진년 특수 규칙 ──
async function imjinTick(S, hooks) {
  const W = S.factions.wae, J = S.factions.joseon;
  const sc = scenarioOf(S);
  if (!W?.alive) return;
  const sea = S.scn.sea || 0;
  const t = S.turn + 1;
  // 명 원군 병력
  if (t === 3 && J?.alive) {
    const loc = S.regions.uiju.owner === 'joseon' ? 'uiju' : J.capital;
    S.regions[loc].troops += 40000;
    log(S, `명나라 원군 4만이 압록강을 건넜다!`, 'major', 'joseon');
    hooks.notify?.('명나라 원군 4만이 압록강을 건넜다!', 'good');
  }
  if (t === 21 && J?.alive) { const loc = S.regions.uiju.owner === 'joseon' ? 'uiju' : J.capital; S.regions[loc].troops += 30000; log(S, '정유년, 명의 2차 원군이 내려왔다.', 'major', 'joseon'); }
  // 왜군 증원(제해권이 높으면 줄어든다)
  const base = sc.reinforce?.[t] || 0;
  const coast = regionsOf(S, 'wae').filter((r) => ['dongnae', 'gyeongju', 'jinju', 'suncheon', 'naju'].includes(r.id)).sort((a, b) => (a.id === 'dongnae' ? -1 : 1));
  if (base && !S.scn.truce) {
    const land = coast[0];
    if (land) {
      const n = Math.round(base * (1 - sea / 110));
      land.troops += n;
      if (n > 0) log(S, `왜군 ${josa(n.toLocaleString(), '이/가')} 바다를 건너 ${regionBase(land.id).name}에 내렸다.`, 'war', 'wae');
    } else if (t >= 20 && J?.alive) {
      // 정유재란: 남해안에 다시 상륙
      const tgt = ['dongnae', 'jinju', 'gyeongju'].map((id) => S.regions[id]).find((r) => r.owner !== 'wae');
      if (tgt) {
        const n = Math.round(base * (1 - sea / 110));
        tgt.owner === 'joseon' && (tgt.troops = Math.max(0, tgt.troops - n * 0.3));
        if (n > tgt.troops) {
          const offs = officersIn(S, tgt.id, tgt.owner);
          for (const o of offs) { const d = nearestOwned(S, tgt.id, o.faction); if (d) o.loc = d; }
          tgt.owner = 'wae'; tgt.troops = n; tgt.def = Math.round(tgt.def * 0.6);
          const g = Object.values(S.officers).find((o) => o.faction === 'wae' && o.status === 'active');
          if (g) g.loc = tgt.id;
          log(S, `정유재란! 왜군 ${josa(n.toLocaleString(), '이/가')} 다시 ${regionBase(tgt.id).name}에 상륙했다.`, 'major', 'wae');
        }
      }
    }
  }
  // 전란의 살림은 해마다 조금씩 회복된다
  if (S.season === 3 && S.scn.econ) S.scn.econ.joseon = Math.min(1, (S.scn.econ.joseon || 1) + 0.12);
  // 바닷길 군량
  W.rice += Math.round(5000 * (1 - sea / 100) * (S.scn.truce ? 0.5 : 1));
  // 왜 수군 회복
  S.scn.waeNavy = Math.min(16000, Math.round((S.scn.waeNavy || 8000) + 700));
  S.scn.sea = clamp(sea - 2, 0, 100);
  // 강화 교섭(1593 여름 무렵)
  if (t === 5 && J?.alive && !S.scn.truceOffered) {
    S.scn.truceOffered = true;
    let yes = false;
    if (S.player === 'joseon') yes = hooks.proposal ? await hooks.proposal({ from: 'wae', type: 'truce', special: '강화 교섭: 왜군이 남해안으로 물러나는 대신 휴전을 청한다. (3년)' }) : false;
    else yes = R.chance(0.5);
    if (yes) {
      S.scn.truce = true;
      S.factions.joseon.treaties.wae = { type: 'truce', until: S.turn + 12 };
      S.factions.wae.treaties.joseon = { type: 'truce', until: S.turn + 12 };
      log(S, '조선과 왜가 강화 교섭에 들어갔다. 전선이 잠잠해진다.', 'major');
    }
  }
  if (t === 19 && S.scn.truce) {
    S.scn.truce = false;
    delete S.factions.joseon.treaties.wae; delete S.factions.wae.treaties.joseon;
    log(S, '강화 교섭이 깨졌다. 정유년, 왜군이 다시 바다를 건넌다.', 'major');
    hooks.notify?.('강화가 깨졌다! 정유재란이 시작된다.', 'bad');
  }
  // 1598 가을: 히데요시 죽음
  if (t === 26 && S.scn.hideyoshi) {
    S.scn.hideyoshi = false;
    for (const r of regionsOf(S, 'wae')) r.troops = Math.round(r.troops * 0.7);
    for (const o of officersOf(S, 'wae')) o.loyalty = clamp(o.loyalty - 20, 0, 100);
    W.personality = { ...W.personality, aggr: 0.3 };
    log(S, '바다 건너에서 도요토미 히데요시가 죽었다는 소식. 왜군이 철군을 서두른다.', 'major');
    hooks.notify?.('히데요시가 죽었다! 왜군이 흔들린다.', 'good');
  }
}
export { score };
