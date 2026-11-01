// 사건. weight(S,fid) 가 0 이면 일어나지 않는다. scope 'all' 은 컴퓨터 세력에도 일어난다(ai 선택지).
// choice.apply 는 결과 문장을 돌려주거나 { text, duel } 을 돌려준다(일기토 사건).
import { R, clamp, fmt, josa, pp } from '../core/util.js';
import { regionsOf, officersOf, officersIn, freeIn, regionBase, eff, hasTrait, genOfficer, isRuler, log, adjOf, relation, treaty, factionPower, statSum } from '../core/state.js';
import { mod, buildingEff, regionYield, igClout, techEra } from '../core/rules.js';
import { ITEMS } from './buildings.js';
import { REGION_BY_ID } from './regions.js';
import { revolt, joinFaction } from '../core/actions.js';
import { acceptDiplo } from '../core/diplomacy.js';

const F = (S, fid) => S.factions[fid];
const pickReg = (S, fid, pred = () => true) => R.pick(regionsOf(S, fid).filter(pred));
const nm = (rid) => regionBase(rid).name;
const loyAll = (S, fid, d) => { for (const r of regionsOf(S, fid)) r.loyalty = clamp(r.loyalty + d, 0, 100); };
const ig = (S, fid, id, d) => { const g = F(S, fid).igs[id]; if (g) g.appr = clamp(g.appr + d, -100, 100); };
const resist = (S, r, key) => clamp(mod(S, r.owner, key) + (buildingEff(r)[key] || 0), 0, 0.9);
const notForeign = (S, fid) => !F(S, fid).foreign;

// 습격(왜구·여진·양선) 계산: 고을 병력·성곽 대 습격대
function raid(S, r, strength, label) {
  const offs = officersIn(S, r.id, r.owner);
  const lea = offs.length ? Math.max(...offs.map((o) => eff(o).lea)) : 40;
  const naval = r.buildings.includes('navalbase') && label !== '여진' ? 1.6 : 1;
  const mine = r.troops * (0.6 + lea / 200) * (1 + r.def / 600) * naval * (1 + mod(S, r.owner, 'all'));
  const won = mine * R.range(0.8, 1.2) > strength;
  if (won) {
    r.troops = Math.max(0, Math.round(r.troops - strength * 0.15));
    F(S, r.owner).prestige += 10; F(S, r.owner).prestigeTotal += 10;
    return { won, text: `${nm(r.id)}의 군사가 ${josa(label, '을/를')} 물리쳤다! 名 +10` };
  }
  r.troops = Math.max(0, Math.round(r.troops - strength * 0.4));
  r.comm = Math.max(0, r.comm * 0.85); r.pop = Math.max(5, r.pop * 0.96); r.loyalty = clamp(r.loyalty - 8, 0, 100);
  return { won, text: `${josa(label, '이/가')} ${josa(nm(r.id), '을/를')} 휩쓸고 갔다. 상업·인구·민심이 줄었다.` };
}

export const EVENTS = [
  {
    id: 'drought', title: '가뭄', art: 'drought', scope: 'all',
    weight: (S) => (S.season === 1 ? 3 : 0),
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => r.agri > 100); return r ? { r: r.id } : null; },
    text: (S, fid, c) => `${nm(c.r)}에 석 달째 비가 오지 않는다. 논바닥이 거북 등처럼 갈라졌다.`,
    choices: (S, fid, c) => [
      { label: '창고를 열어 진휼한다', hint: '米 -600 · 민심 +8 · 농업 -5%', ok: F(S, fid).rice >= 600,
        apply: () => { const r = S.regions[c.r]; F(S, fid).rice -= 600; r.loyalty = clamp(r.loyalty + 8, 0, 100); r.agri *= 0.95; return '굶주린 백성이 관아 앞에 줄을 섰다. 고을이 숨을 돌렸다.'; } },
      { label: '기우제를 지낸다', hint: '名 -20 · 반반의 확률로 비', ok: F(S, fid).prestige >= 20,
        apply: () => { const r = S.regions[c.r]; F(S, fid).prestige -= 20; if (R.chance(0.5)) return '사흘 만에 단비가 내렸다! 하늘이 응답했다.'; const k = 1 - resist(S, r, 'drought'); r.agri *= 1 - 0.1 * k; return '제를 올렸으나 하늘은 말이 없다. 농업이 줄었다.'; } },
      { label: '그냥 버틴다', hint: '농업 -15% · 민심 -10 · 인구 감소', apply: () => { const r = S.regions[c.r]; const k = 1 - resist(S, r, 'drought'); r.agri *= 1 - 0.15 * k; r.loyalty = clamp(r.loyalty - 10 * k, 0, 100); r.pop *= 1 - 0.03 * k; return `흉년이 들었다.${k < 1 ? ' 그래도 저수지·측우기 덕에 피해가 줄었다.' : ''}`; } },
    ],
    ai: (S, fid) => (F(S, fid).rice > 2500 ? 0 : 2),
  },
  {
    id: 'flood', title: '홍수', art: 'flood', scope: 'all',
    weight: (S) => (S.season === 1 ? 2 : 0),
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => ['river', 'coast'].includes(REGION_BY_ID[r.id].terrain)); return r ? { r: r.id } : null; },
    text: (S, fid, c) => `장마가 길어 ${nm(c.r)}의 강둑이 터졌다. 마을이 물에 잠겼다.`,
    choices: (S, fid, c) => [
      { label: '진휼하고 둑을 쌓는다', hint: '米 -400 · 錢 -200 · 피해 절반 · 민심 +5', ok: F(S, fid).rice >= 400 && F(S, fid).gold >= 200,
        apply: () => { const r = S.regions[c.r]; F(S, fid).rice -= 400; F(S, fid).gold -= 200; r.pop *= 0.98; r.agri *= 0.95; r.loyalty = clamp(r.loyalty + 5, 0, 100); return '관민이 함께 둑을 쌓았다.'; } },
      { label: '물이 빠지길 기다린다', hint: '인구 -4% · 농업 -10% · 성곽 -50', apply: () => { const r = S.regions[c.r]; const k = 1 - resist(S, r, 'drought'); r.pop *= 1 - 0.04 * k; r.agri *= 1 - 0.1 * k; r.def = Math.max(0, r.def - 50); return '물이 빠진 자리에 진흙만 남았다.'; } },
    ],
    ai: () => 1,
  },
  {
    id: 'locust', title: '황충', art: 'locust', scope: 'all',
    weight: (S) => (S.season === 2 ? 1.5 : 0),
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => r.agri > 150); return r ? { r: r.id } : null; },
    text: (S, fid, c) => `누런 메뚜기 떼가 하늘을 덮고 ${nm(c.r)}의 벼를 갉아먹는다.`,
    choices: (S, fid, c) => [
      { label: '백성을 풀어 메뚜기를 잡는다', hint: '민심 -3 · 수확 피해 절반', apply: () => { const r = S.regions[c.r]; const y = regionYield(S, r).rice; F(S, fid).rice = Math.max(0, F(S, fid).rice - y * 0.15); r.loyalty = clamp(r.loyalty - 3, 0, 100); return `메뚜기를 쓸어 담았다. 米 ${josa(fmt(y * 0.15), '을/를')} 잃었다.`; } },
      { label: '그대로 둔다', hint: '수확 크게 감소', apply: () => { const r = S.regions[c.r]; const y = regionYield(S, r).rice; F(S, fid).rice = Math.max(0, F(S, fid).rice - y * 0.35); r.agri *= 0.95; return `가을걷이가 반 토막 났다. 米 ${josa(fmt(y * 0.35), '을/를')} 잃었다.`; } },
    ],
    ai: () => 0,
  },
  {
    id: 'harvest', title: '풍년', art: 'harvest', scope: 'all',
    weight: (S) => (S.season === 2 ? 2.5 : 0),
    setup: () => ({}),
    text: () => '팔도에 풍년가가 울린다. 곳간마다 볏섬이 가득하다.',
    choices: (S, fid) => {
      const bonus = Math.round(regionsOf(S, fid).reduce((s, r) => s + regionYield(S, r).rice, 0) * 0.3);
      return [
        { label: '곳간에 쌓아 둔다', hint: `米 +${fmt(bonus)}`, apply: () => { F(S, fid).rice += bonus; return `米 ${josa(fmt(bonus), '을/를')} 더 거두었다.`; } },
        { label: '백성과 잔치를 연다', hint: `米 +${fmt(bonus * 0.5)} · 모든 고을 민심 +6`, apply: () => { F(S, fid).rice += bonus * 0.5; loyAll(S, fid, 6); return '마을마다 농악이 울렸다. 민심이 크게 올랐다.'; } },
      ];
    },
    ai: () => 0,
  },
  {
    id: 'plague', title: '역병', art: 'plague', scope: 'all',
    weight: (S) => (S.season === 1 ? 1.5 : 0.8),
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => r.pop > 40); return r ? { r: r.id } : null; },
    text: (S, fid, c) => `${nm(c.r)}에 돌림병이 돈다. 열에 시달리는 사람이 늘고 상여 소리가 끊이지 않는다.`,
    choices: (S, fid, c) => {
      const doc = officersOf(S, fid).find((o) => hasTrait(o, '의술'));
      const hit = (k) => { const ids = [c.r, ...adjOf(c.r).filter((n) => S.regions[n].owner === fid)]; for (const id of ids) { const r = S.regions[id]; const res = 1 - resist(S, r, 'plague'); const kk = (id === c.r ? 1 : 0.5) * k * res; r.pop *= 1 - 0.08 * kk; r.troops = Math.round(r.troops * (1 - 0.1 * kk)); } };
      return [
        { label: doc ? `${josa(doc.name, '을/를')} 보낸다` : '의원을 보낸다', hint: doc ? '피해 대폭 감소 · 名 +10' : '錢 -300 · 피해 절반', ok: doc || F(S, fid).gold >= 300,
          apply: () => { if (doc) { hit(0.2); F(S, fid).prestige += 10; F(S, fid).prestigeTotal += 10; return `${josa(doc.name, '이/가')} 약을 달여 병을 잡았다. 칭송이 자자하다.`; } F(S, fid).gold -= 300; hit(0.5); return '의원들이 약재를 싣고 내려갔다.'; } },
        { label: '고을을 봉쇄한다', hint: '이웃으로 안 번짐 · 민심 -8', apply: () => { const r = S.regions[c.r]; const res = 1 - resist(S, r, 'plague'); r.pop *= 1 - 0.08 * res; r.troops = Math.round(r.troops * (1 - 0.1 * res)); r.loyalty = clamp(r.loyalty - 8, 0, 100); return '길목을 막았다. 병은 고을 안에서 그쳤다.'; } },
        { label: '하늘에 맡긴다', hint: '이웃 고을까지 번짐', apply: () => { hit(1); return '병이 이웃 고을까지 번졌다.'; } },
      ];
    },
    ai: (S, fid) => (F(S, fid).gold > 800 ? 0 : 1),
  },
  {
    id: 'comet', title: '혜성 출현', art: 'comet', scope: 'player',
    weight: () => 0.6,
    setup: () => ({}),
    text: () => '밤하늘에 꼬리 긴 별이 나타났다. "나라에 변고가 있을 징조"라는 말이 돈다.',
    choices: (S, fid) => {
      const sage = officersOf(S, fid).filter((o) => eff(o).int >= 90).sort((a, b) => eff(b).int - eff(a).int)[0];
      const out = [
        { label: '구언 교서를 내린다', hint: '名 -30 · 정통성 +3', ok: F(S, fid).prestige >= 30, apply: () => { F(S, fid).prestige -= 30; F(S, fid).legit = clamp(F(S, fid).legit + 3, 0, 100); return '임금이 스스로를 탓하는 교서를 내리자 민심이 가라앉았다.'; } },
        { label: '무시한다', hint: '정통성 -5 · 모든 민심 -3', apply: () => { F(S, fid).legit = clamp(F(S, fid).legit - 5, 0, 100); loyAll(S, fid, -3); return '흉흉한 소문이 저잣거리에 퍼졌다.'; } },
      ];
      if (sage) out.unshift({ label: `${sage.name}에게 천문을 살피게 한다`, hint: '연구 +60 · 정통성 -1', apply: () => { const f = F(S, fid); if (f.research.cur) f.research.prog += 60; else f.research.bank += 60; f.legit = clamp(f.legit - 1, 0, 100); return `${sage.name}: "별의 궤도를 재어 보니 이치가 있을 뿐, 변고가 아닙니다." 관측 기록이 쌓였다.`; } });
      return out;
    },
  },
  {
    id: 'memorial', title: '만인소', art: 'scroll', scope: 'player',
    weight: (S, fid) => (notForeign(S, fid) && F(S, fid).igs.sarim.appr < -10 ? 2 : 0),
    setup: () => ({}),
    text: () => '팔도 유생 만 명이 이름을 적은 상소를 메고 대궐 앞에 엎드렸다. "전하, 통촉하여 주시옵소서!"',
    choices: (S, fid) => [
      { label: '상소를 받아들인다', hint: '名 -40 · 사림 지지 +25', ok: F(S, fid).prestige >= 40, apply: () => { F(S, fid).prestige -= 40; ig(S, fid, 'sarim', 25); return '유생들이 만세를 부르며 물러갔다.'; } },
      { label: '물리친다', hint: '사림 -10 · 정통성 -3', apply: () => { ig(S, fid, 'sarim', -10); F(S, fid).legit = clamp(F(S, fid).legit - 3, 0, 100); return '유생들이 성균관을 비우고 권당(捲堂)에 들어갔다.'; } },
      { label: '주동자를 귀양 보낸다', hint: '사림 -25 · 훈척 +10 · 정통성 -2', apply: () => { ig(S, fid, 'sarim', -25); ig(S, fid, 'hunchuk', 10); F(S, fid).legit = clamp(F(S, fid).legit - 2, 0, 100); return '소두(疏頭)가 먼 섬으로 떠났다. 조정이 조용해졌지만 원망이 쌓였다.'; } },
    ],
  },
  {
    id: 'recommend', title: '인재 천거', art: 'person', scope: 'player',
    weight: (S, fid) => (officersOf(S, fid).some((o) => eff(o).cha >= 70) ? 1.2 : 0),
    setup: (S, fid) => {
      const by = R.pick(officersOf(S, fid).filter((o) => eff(o).cha >= 70 && !isRuler(S, o)));
      if (!by) return null;
      const own = new Set(regionsOf(S, fid).map((r) => r.id));
      let t = R.pick(Object.values(S.officers).filter((o) => o.status === 'free' && own.has(o.loc)));
      if (!t) t = genOfficer(S, { kind: R.pick(['civil', 'military']), loc: by.loc, status: 'free', bonus: 8 });
      return { by: by.id, t: t.id };
    },
    text: (S, fid, c) => `${josa(S.officers[c.by].name, '이/가')} 아뢴다. "${regionBase(S.officers[c.t].loc).name}에 ${S.officers[c.t].name}이라는 인물이 있사온데, 쓸 만합니다."`,
    choices: (S, fid, c) => [
      { label: '예를 갖춰 맞아들인다', hint: '名 -20 · 등용', ok: F(S, fid).prestige >= 20, apply: () => { const t = S.officers[c.t]; F(S, fid).prestige -= 20; const loc = S.regions[t.loc].owner === fid ? t.loc : S.officers[c.by].loc; joinFaction(S, t, fid, loc); t.acted = false; return `${josa(t.name, '이/가')} 뜻을 함께하기로 했다.`; } },
      { label: '이름만 적어 둔다', hint: '나중에 등용 가능', apply: () => { S.officers[c.t].found = true; return '언젠가 쓸 날이 올 것이다.'; } },
    ],
  },
  {
    id: 'exam', title: '식년시', art: 'exam', scope: 'all', forced: true,
    weight: (S, fid) => (S.season === 0 && S.year % 3 === 0 && notForeign(S, fid) && S.turn > 0 ? 100 : 0),
    setup: () => ({}),
    text: () => '세 해마다 치르는 식년시의 때가 되었다. 팔도의 선비와 무사가 한양으로 몰려든다.',
    choices: (S, fid) => {
      const bonus = (S.wonders.seonggyun?.owner === fid ? 10 : 0) + Math.min(10, regionsOf(S, fid).filter((r) => r.buildings.includes('seowon')).length * 2) + (F(S, fid).laws.status === 'abolish' ? 6 : F(S, fid).laws.status === 'seoeol' ? 3 : 0);
      const cap = F(S, fid).capital;
      const many = officersOf(S, fid).length >= regionsOf(S, fid).length * 6 + 6;
      const mk = (kind, n) => { n = many ? 1 : n; const out = []; for (let i = 0; i < n; i++) out.push(genOfficer(S, { kind, faction: fid, loc: cap, loyalty: 82, bonus })); return out.map((o) => o.name).join(', '); };
      return [
        { label: '문과(文科)', hint: '錢 -200 · 문관 2명', ok: F(S, fid).gold >= 200, apply: () => { F(S, fid).gold -= 200; return `급제: ${mk('civil', 2)}`; } },
        { label: '무과(武科)', hint: '錢 -200 · 무관 2명', ok: F(S, fid).gold >= 200, apply: () => { F(S, fid).gold -= 200; return `급제: ${mk('military', 2)}`; } },
        { label: '잡과(雜科)', hint: '錢 -150 · 기술관 1명 · 연구 +50', ok: F(S, fid).gold >= 150, apply: () => { F(S, fid).gold -= 150; const f = F(S, fid); if (f.research.cur) f.research.prog += 50; else f.research.bank += 50; return `급제: ${mk('specialist', 1)}`; } },
        { label: '이번에는 미룬다', hint: '사림 지지 -5', apply: () => { ig(S, fid, 'sarim', -5); return '선비들이 실망하여 고향으로 돌아갔다.'; } },
      ];
    },
    ai: (S, fid) => (F(S, fid).gold < 400 ? 3 : (F(S, fid).personality?.aggr || 0.5) > 0.6 ? 1 : 0),
  },
  {
    id: 'inspector', title: '암행어사 출두', art: 'mapae', scope: 'player',
    weight: (S, fid) => (regionsOf(S, fid).some((r) => r.loyalty < 50) ? 1.5 : 0),
    setup: (S, fid) => { const r = regionsOf(S, fid).sort((a, b) => a.loyalty - b.loyalty)[0]; return r ? { r: r.id } : null; },
    text: (S, fid, c) => `${nm(c.r)} 수령이 백성의 고혈을 짜낸다는 소문이 들려온다. 몰래 어사를 보낼 것인가?`,
    choices: (S, fid, c) => [
      { label: '마패를 내린다', hint: '錢 -100 · 민심 +15 · 名 +10 · 숨긴 재물 환수', ok: F(S, fid).gold >= 100, apply: () => { const r = S.regions[c.r]; F(S, fid).gold -= 100; r.loyalty = clamp(r.loyalty + 15, 0, 100); const g = R.int(10, 30) * 10; F(S, fid).gold += g; F(S, fid).prestige += 10; F(S, fid).prestigeTotal += 10; return `"암행어사 출두야!" 탐관오리를 봉고파직하고 錢 ${josa(g, '을/를')} 거두었다.`; } },
      { label: '그만둔다', hint: '', apply: () => '소문은 소문일 뿐.' },
    ],
  },
  {
    id: 'bandit', title: '화적 출몰', art: 'bandit', scope: 'player',
    weight: () => 1.2,
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => officersIn(S, r.id, fid).length > 0); return r ? { r: r.id, chief: { name: R.pick(['검은 수염', '외눈박이', '쇠도리깨', '범털 두령', '칼바위']) + ' ' + R.pick(['장두', '두령', '대장']), str: R.int(60, 88), look: 'rebel', seed: R.int(1, 99999) } } : null; },
    text: (S, fid, c) => `${nm(c.r)} 고갯길에 화적 떼가 나타나 장꾼을 턴다. 우두머리는 「${c.chief.name}」이라 불린다.`,
    choices: (S, fid, c) => {
      const champ = officersIn(S, c.r, fid).filter((o) => o.injured <= 0).sort((a, b) => eff(b).str - eff(a).str)[0];
      const out = [];
      if (champ) out.push({ label: `${josa(champ.name, '이/가')} 토벌하러 간다(일기토)`, hint: `무력 ${eff(champ).str} 대 ${c.chief.str}`, apply: () => ({
        text: '', duel: { officer: champ.id, enemy: c.chief,
          win: () => { const g = R.int(15, 35) * 10; F(S, fid).gold += g; S.regions[c.r].loyalty = clamp(S.regions[c.r].loyalty + 5, 0, 100); if (R.chance(0.35)) { const b = genOfficer(S, { kind: 'bandit', faction: fid, loc: c.r, loyalty: 70, name: undefined }); return `${josa(champ.name, '이/가')} 두령을 꺾었다! 錢 ${josa(g, '을/를')} 되찾고, 졸개였던 ${josa(b.name, '이/가')} 휘하에 들어왔다.`; } return `${josa(champ.name, '이/가')} 두령을 꺾었다! 錢 ${josa(g, '을/를')} 되찾았다.`; },
          lose: () => { champ.injured = 2; S.regions[c.r].loyalty = clamp(S.regions[c.r].loyalty - 5, 0, 100); return `${josa(champ.name, '이/가')} 다쳐서 돌아왔다. 화적은 산으로 사라졌다.`; } } }) });
      out.push({ label: '돈으로 회유한다', hint: '錢 -300 · 절반의 확률로 두령이 귀순', ok: F(S, fid).gold >= 300, apply: () => { F(S, fid).gold -= 300; if (R.chance(0.5)) { const b = genOfficer(S, { kind: 'bandit', faction: fid, loc: c.r, loyalty: 65 }); b.str = c.chief.str; return `두령이 무릎을 꿇었다. 이제 ${b.name}이라는 이름으로 우리를 돕는다.`; } return '돈만 받고 달아났다!'; } });
      out.push({ label: '내버려 둔다', hint: '상업 -10% · 민심 -6', apply: () => { const r = S.regions[c.r]; r.comm *= 0.9; r.loyalty = clamp(r.loyalty - 6, 0, 100); r.unrest = (r.unrest || 0) + 5; return '장꾼들의 발길이 끊겼다.'; } });
      return out;
    },
  },
  {
    id: 'tiger', title: '호환', art: 'tiger', scope: 'player',
    weight: (S, fid) => (regionsOf(S, fid).some((r) => REGION_BY_ID[r.id].terrain === 'mountain') ? 0.9 : 0),
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => REGION_BY_ID[r.id].terrain === 'mountain'); return r ? { r: r.id } : null; },
    text: (S, fid, c) => `${nm(c.r)} 뒷산에 집채만 한 범이 나타나 소와 사람을 물어 간다. 밤마다 마을이 문을 걸어 잠근다.`,
    choices: (S, fid, c) => {
      const champ = officersOf(S, fid).filter((o) => o.injured <= 0 && !o.ally).sort((a, b) => eff(b).str - eff(a).str)[0];
      const out = [];
      if (champ) out.push({ label: `${josa(champ.name, '이/가')} 범을 잡는다(일기토)`, hint: `무력 ${eff(champ).str} 대 산군 90`, apply: () => ({
        text: '', duel: { officer: champ.id, enemy: { name: '산군(山君)', str: 90, int: 30, look: 'tiger', seed: 7 },
          win: () => { F(S, fid).prestige += 25; F(S, fid).prestigeTotal += 25; champ.loyalty = clamp(champ.loyalty + 5, 0, 100); S.regions[c.r].loyalty = clamp(S.regions[c.r].loyalty + 8, 0, 100); F(S, fid).gold += 200; return `${josa(champ.name, '이/가')} 범을 맨손으로 때려잡았다! 호피를 팔아 錢 200, 名 +25.`; },
          lose: () => { champ.injured = 3; return `${josa(champ.name, '이/가')} 범에게 할퀴어 크게 다쳤다.`; } } }) });
      out.push({ label: '착호갑사를 보낸다', hint: '錢 -150', ok: F(S, fid).gold >= 150, apply: () => { F(S, fid).gold -= 150; S.regions[c.r].loyalty = clamp(S.regions[c.r].loyalty + 3, 0, 100); return '범 사냥꾼들이 사흘 만에 범을 잡았다.'; } });
      out.push({ label: '피해 다닌다', hint: '민심 -4', apply: () => { S.regions[c.r].loyalty = clamp(S.regions[c.r].loyalty - 4, 0, 100); return '해 지면 아무도 산에 가지 않는다.'; } });
      return out;
    },
  },
  {
    id: 'treasure', title: '보물 헌상', art: 'treasure', scope: 'player',
    weight: (S) => (Object.keys(ITEMS).some((k) => !itemOwned(S, k)) ? 0.7 : 0),
    setup: (S, fid) => { const it = R.pick(Object.keys(ITEMS).filter((k) => !itemOwned(S, k))); const r = pickReg(S, fid); return it && r ? { it, r: r.id } : null; },
    text: (S, fid, c) => `${nm(c.r)}의 농부가 밭을 갈다 오래된 함을 캐냈다. 안에서 「${ITEMS[c.it].name}」${pp(ITEMS[c.it].name, '이/가')} 나왔다고 한다.`,
    choices: (S, fid, c) => [
      { label: '후하게 상을 내린다', hint: '錢 -100 · 보물 · 민심 +3', ok: F(S, fid).gold >= 100, apply: () => { F(S, fid).gold -= 100; removeHidden(S, c.it); F(S, fid).treasury.push(c.it); S.regions[c.r].loyalty = clamp(S.regions[c.r].loyalty + 3, 0, 100); return `「${ITEMS[c.it].name}」${pp(ITEMS[c.it].name, '을/를')} 얻었다. 인물 열전에서 장수에게 하사할 수 있다.`; } },
      { label: '그냥 거둬들인다', hint: '보물 · 민심 -2', apply: () => { removeHidden(S, c.it); F(S, fid).treasury.push(c.it); S.regions[c.r].loyalty = clamp(S.regions[c.r].loyalty - 2, 0, 100); return `「${ITEMS[c.it].name}」${pp(ITEMS[c.it].name, '을/를')} 얻었다.`; } },
    ],
  },
  {
    id: 'envoy', title: '대국의 사신', art: 'envoy', scope: 'player',
    weight: (S, fid) => (notForeign(S, fid) && techEra(S, fid) <= 3 && S.scenario !== 'imjin' ? 0.8 : 0),
    setup: () => ({}),
    text: () => '압록강을 건너온 대국의 칙사가 세폐(歲幣)를 요구한다. 의주부터 한양까지 영접 행렬이 길다.',
    choices: (S, fid) => [
      { label: '예물을 넉넉히 보낸다', hint: '錢 -500 · 名 +15 · 정통성 +3', ok: F(S, fid).gold >= 500, apply: () => { const f = F(S, fid); f.gold -= 500; f.prestige += 15; f.prestigeTotal += 15; f.legit = clamp(f.legit + 3, 0, 100); return '칙사가 흡족해하며 돌아갔다. 책봉이 순조롭다.'; } },
      { label: '형편대로 보낸다', hint: '錢 -200', ok: F(S, fid).gold >= 200, apply: () => { F(S, fid).gold -= 200; return '무난히 넘어갔다.'; } },
      { label: '거절한다', hint: '名 +10 · 정통성 -4 · 북방이 시끄러워진다', apply: () => { const f = F(S, fid); f.prestige += 10; f.legit = clamp(f.legit - 4, 0, 100); S.flags = S.flags || {}; S.flags.northRaid = S.turn + 2; return '칙사가 얼굴을 붉히고 돌아갔다.'; } },
    ],
  },
  {
    id: 'waegu', title: '왜구 침입', art: 'pirate', scope: 'all',
    weight: (S, fid) => (S.scenario === 'imjin' ? 0 : regionsOf(S, fid).some((r) => REGION_BY_ID[r.id].coastal && ['jeolla', 'gyeongsang', 'chungcheong'].includes(REGION_BY_ID[r.id].prov)) ? 1.2 : 0),
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => REGION_BY_ID[r.id].coastal && ['jeolla', 'gyeongsang', 'chungcheong'].includes(REGION_BY_ID[r.id].prov)); return r ? { r: r.id, s: R.int(15, 40) * 100 + S.turn * 25 } : null; },
    text: (S, fid, c) => `왜구의 배 수십 척이 ${nm(c.r)} 앞바다에 나타났다! 어림잡아 ${fmt(c.s)}명.`,
    choices: (S, fid, c) => [
      { label: '나가 싸운다', hint: `우리 병력 ${fmt(S.regions[c.r].troops)} · 수군진이 있으면 유리`, apply: () => raid(S, S.regions[c.r], c.s, '왜구').text },
      { label: '성문을 닫고 버틴다', hint: '상업 -8% · 민심 -4', apply: () => { const r = S.regions[c.r]; r.comm *= 0.92; r.loyalty = clamp(r.loyalty - 4, 0, 100); return '왜구가 바닷가 마을을 털고 물러갔다.'; } },
    ],
    ai: () => 0,
  },
  {
    id: 'jurchen', title: '여진 침입', art: 'horse', scope: 'all',
    weight: (S, fid) => {
      if (S.scenario === 'imjin' || techEra(S, fid) > 2) return 0;
      const has = regionsOf(S, fid).some((r) => ['hoeryeong', 'gapsan', 'ganggye', 'uiju', 'gilju'].includes(r.id));
      return has ? (S.flags?.northRaid >= S.turn - 1 && S.flags?.northRaid <= S.turn ? 30 : 1) : 0;
    },
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => ['hoeryeong', 'gapsan', 'ganggye', 'uiju', 'gilju'].includes(r.id)); return r ? { r: r.id, s: R.int(20, 45) * 100 + S.turn * 25 } : null; },
    text: (S, fid, c) => `강 건너 여진 기병 ${josa(fmt(c.s), '이/가')} 얼어붙은 강을 넘어 ${josa(nm(c.r), '을/를')} 노린다!`,
    choices: (S, fid, c) => [
      { label: '맞받아친다', hint: `우리 병력 ${fmt(S.regions[c.r].troops)}`, apply: () => raid(S, S.regions[c.r], c.s * (mod(S, fid, 'northDef') ? 0.7 : 1), '여진 기병').text },
      { label: '곡식을 내주고 달랜다', hint: '米 -800', ok: F(S, fid).rice >= 800, apply: () => { F(S, fid).rice -= 800; return '여진 추장이 곡식을 싣고 돌아갔다.'; } },
    ],
    ai: () => 0,
  },
  {
    id: 'ships', title: '이양선 출몰', art: 'ship', scope: 'player',
    weight: (S, fid) => (notForeign(S, fid) && (F(S, fid).techs.seohak || techEra(S, fid) >= 4 || S.year >= 40) && regionsOf(S, fid).some((r) => REGION_BY_ID[r.id].coastal) ? 1.2 : 0),
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => REGION_BY_ID[r.id].coastal); return r ? { r: r.id } : null; },
    text: (S, fid, c) => `${nm(c.r)} 앞바다에 연기를 뿜는 검은 배가 나타났다. 코 큰 사람들이 통상을 요구한다.`,
    choices: (S, fid, c) => [
      { label: '포를 쏘아 쫓는다', hint: '名 +15 · 사림 +10 · 개화파 -10 · 언젠가 보복이…', apply: () => { const f = F(S, fid); f.prestige += 15; f.prestigeTotal += 15; ig(S, fid, 'sarim', 10); ig(S, fid, 'gaehwa', -10); S.flags = S.flags || {}; S.flags.yangyo = { turn: S.turn + R.int(3, 6), r: c.r }; return '이양선이 물러갔다. 척화비를 세우자는 소리가 높다.'; } },
      { label: '교섭한다', hint: '錢 +300 · 개화파 +10 · 사림 -10', apply: () => { F(S, fid).gold += 300; ig(S, fid, 'gaehwa', 10); ig(S, fid, 'sarim', -10); return '물자를 바꾸고 돌려보냈다. 낯선 물건이 장에 돈다.'; } },
      { label: '멀리서 지켜본다', hint: '', apply: () => '배는 해안을 재더니 떠났다.' },
    ],
  },
  {
    id: 'yangyo', title: '양요', art: 'ship', scope: 'player', forced: true,
    weight: (S, fid) => (S.flags?.yangyo && S.flags.yangyo.turn <= S.turn && S.regions[S.flags.yangyo.r]?.owner === fid ? 100 : 0),
    setup: (S) => { const c = { r: S.flags.yangyo.r, s: 6000 + S.turn * 30 }; delete S.flags.yangyo; return c; },
    text: (S, fid, c) => `지난번 쫓겨난 이양선이 함대를 이끌고 돌아왔다! 함포가 ${josa(nm(c.r), '을/를')} 겨눈다.`,
    choices: (S, fid, c) => [
      { label: '결사 항전', hint: `우리 병력 ${fmt(S.regions[c.r].troops)} · 이기면 名 +40`, apply: () => { const res = raid(S, S.regions[c.r], c.s * (F(S, fid).techs.sinsik ? 0.6 : 1.2), '서양 함대'); if (res.won) { F(S, fid).prestige += 30; F(S, fid).prestigeTotal += 30; } return res.text; } },
      { label: '배상하고 화친한다', hint: '錢 -1000 · 사림 -15', ok: F(S, fid).gold >= 1000, apply: () => { F(S, fid).gold -= 1000; ig(S, fid, 'sarim', -15); return '굴욕적인 조약을 맺었다.'; } },
    ],
  },
  {
    id: 'strife', title: '붕당의 다툼', art: 'scroll', scope: 'player',
    weight: (S, fid) => (notForeign(S, fid) && F(S, fid).igs.sarim.clout >= 18 && officersOf(S, fid).length >= 5 ? 0.9 : 0),
    setup: (S, fid) => { const offs = R.shuffle(officersOf(S, fid).filter((o) => !isRuler(S, o) && ['civil', 'scholar'].includes(o.look))); return offs.length >= 2 ? { a: offs[0].id, b: offs[1].id } : null; },
    text: (S, fid, c) => `이조전랑 자리를 두고 ${S.officers[c.a].name} 쪽(동인)과 ${S.officers[c.b].name} 쪽(서인)이 날을 세운다.`,
    choices: (S, fid, c) => {
      const tp = F(S, fid).laws.crown === 'tangpyeong';
      const out = [
        { label: `${S.officers[c.a].name}의 손을 든다`, hint: `${S.officers[c.b].name} 충성 -15 · 사림 +5`, apply: () => { S.officers[c.b].loyalty = clamp(S.officers[c.b].loyalty - 15, 0, 100); S.officers[c.a].loyalty = clamp(S.officers[c.a].loyalty + 5, 0, 100); ig(S, fid, 'sarim', 5); return '동인이 조정을 쥐었다.'; } },
        { label: `${S.officers[c.b].name}의 손을 든다`, hint: `${S.officers[c.a].name} 충성 -15 · 사림 +5`, apply: () => { S.officers[c.a].loyalty = clamp(S.officers[c.a].loyalty - 15, 0, 100); S.officers[c.b].loyalty = clamp(S.officers[c.b].loyalty + 5, 0, 100); ig(S, fid, 'sarim', 5); return '서인이 조정을 쥐었다.'; } },
      ];
      if (tp) out.unshift({ label: '탕평으로 고루 쓴다', hint: '탕평 법령 · 불이익 없음', apply: () => { ig(S, fid, 'sarim', 5); return '두 사람 모두 자리를 얻었다. 탕평비의 뜻이 서는구나.'; } });
      out.push({ label: '둘 다 내친다', hint: '두 사람 충성 -8 · 사림 -15 · 정통성 +2', apply: () => { for (const id of [c.a, c.b]) S.officers[id].loyalty = clamp(S.officers[id].loyalty - 8, 0, 100); ig(S, fid, 'sarim', -15); F(S, fid).legit = clamp(F(S, fid).legit + 2, 0, 100); return '임금의 서슬에 조정이 숨을 죽였다.'; } });
      return out;
    },
  },
  {
    id: 'yesong', title: '예송 논쟁', art: 'scroll', scope: 'player',
    weight: (S, fid) => (notForeign(S, fid) && F(S, fid).igs.sarim.clout >= 22 ? 0.5 : 0),
    setup: () => ({}),
    text: () => '대비가 상복을 몇 해 입어야 하는가. 1년설과 3년설로 조정이 둘로 갈렸다. 상소가 산더미다.',
    choices: (S, fid) => [
      { label: '1년설(기년설)', hint: '사림 +10 · 훈척 -10', apply: () => { ig(S, fid, 'sarim', 10); ig(S, fid, 'hunchuk', -10); return '예법을 따지는 선비들이 웃었다.'; } },
      { label: '3년설', hint: '훈척 +10 · 사림 -10 · 정통성 +2', apply: () => { ig(S, fid, 'hunchuk', 10); ig(S, fid, 'sarim', -10); F(S, fid).legit = clamp(F(S, fid).legit + 2, 0, 100); return '왕실의 위엄을 세웠다.'; } },
      { label: '"백성 밥 굶는 데 상복이 대수냐"', hint: '농민 +10 · 사림 -15', apply: () => { ig(S, fid, 'nongmin', 10); ig(S, fid, 'sarim', -15); return '저잣거리에서 박수가 터졌다. 선비들은 혀를 찼다.'; } },
    ],
  },
  {
    id: 'marriage', title: '혼인 동맹', art: 'marriage', scope: 'player',
    weight: (S, fid) => (Object.values(S.factions).some((f) => f.alive && f.id !== fid && !f.foreign && relation(S, fid, f.id) >= 25 && !treaty(S, fid, f.id)) ? 0.8 : 0),
    setup: (S, fid) => { const f = R.pick(Object.values(S.factions).filter((f) => f.alive && f.id !== fid && !f.foreign && relation(S, fid, f.id) >= 25 && !treaty(S, fid, f.id))); return f ? { f: f.id } : null; },
    text: (S, fid, c) => `${S.factions[c.f].name} 세력이 사람을 보내 혼인을 청한다. "두 집안이 사돈을 맺어 대대로 화목하기를."`,
    choices: (S, fid, c) => [
      { label: '혼례를 올린다', hint: '동맹 · 錢 -200', ok: F(S, fid).gold >= 200, apply: () => { F(S, fid).gold -= 200; return acceptDiplo(S, fid, c.f, 'alliance'); } },
      { label: '정중히 사양한다', hint: '우호 -10', apply: () => { S.factions[fid].relations[c.f] -= 10; S.factions[c.f].relations[fid] -= 10; return '사신이 서운한 얼굴로 돌아갔다.'; } },
    ],
  },
  {
    id: 'plot', title: '역모 밀고', art: 'dagger', scope: 'player',
    weight: (S, fid) => (officersOf(S, fid).some((o) => o.loyalty < 40 && !isRuler(S, o) && !o.ally) ? 2.5 : 0),
    setup: (S, fid) => { const o = officersOf(S, fid).filter((o) => o.loyalty < 40 && !isRuler(S, o) && !o.ally).sort((a, b) => a.loyalty - b.loyalty)[0]; return o ? { o: o.id } : null; },
    text: (S, fid, c) => `"${josa(S.officers[c.o].name, '이/가')} 밤마다 사람을 모아 역모를 꾸민다 하옵니다." 밀고장이 올라왔다. (충성 ${Math.round(S.officers[c.o].loyalty)})`,
    choices: (S, fid, c) => [
      { label: '불러서 달랜다', hint: '錢 -300 · 충성 +25', ok: F(S, fid).gold >= 300, apply: () => { F(S, fid).gold -= 300; const o = S.officers[c.o]; o.loyalty = clamp(o.loyalty + 25, 0, 100); return `${josa(o.name, '이/가')} 눈물을 흘리며 엎드렸다.`; } },
      { label: '귀양 보낸다', hint: '장수를 잃음 · 다른 장수 충성 +2', apply: () => { const o = S.officers[c.o]; o.faction = null; o.status = 'free'; o.found = true; o.loc = R.pick(Object.keys(S.regions)); for (const x of officersOf(S, fid)) x.loyalty = clamp(x.loyalty + 2, 0, 100); return `${josa(o.name, '이/가')} 먼 곳으로 떠났다.`; } },
      { label: '사약을 내린다', hint: '장수 처형 · 名 -10 · 다른 장수 충성 -3', apply: () => { const o = S.officers[c.o]; o.status = 'dead'; F(S, fid).prestige = Math.max(0, F(S, fid).prestige - 10); for (const x of officersOf(S, fid)) x.loyalty = clamp(x.loyalty - 3, 0, 100); log(S, `${josa(o.name, '이/가')} 사약을 받았다.`, 'war', fid); return `${josa(o.name, '이/가')} 사약을 받았다.`; } },
      { label: '헛소문이다', hint: '절반의 확률로 장수가 병력을 끌고 떠남', apply: () => { const o = S.officers[c.o]; if (R.chance(0.5)) { const r = S.regions[o.loc]; const n = Math.round(r.troops * 0.3); r.troops -= n; o.faction = null; o.status = 'free'; o.found = true; return `${josa(o.name, '이/가')} 병사 ${josa(fmt(n), '을/를')} 데리고 달아났다!`; } return '아무 일도 없었다. 정말 헛소문이었을까?'; } },
    ],
  },
  {
    id: 'market', title: '장시 번성', art: 'market', scope: 'player',
    weight: (S, fid) => (regionsOf(S, fid).some((r) => r.buildings.includes('market')) ? 1 : 0),
    setup: (S, fid) => { const r = pickReg(S, fid, (r) => r.buildings.includes('market')); return r ? { r: r.id } : null; },
    text: (S, fid, c) => `${nm(c.r)} 장날에 보부상과 송상이 몰려 장터가 미어터진다.`,
    choices: (S, fid, c) => [
      { label: '장세를 걷는다', hint: '錢 +300', apply: () => { F(S, fid).gold += 300; return '錢 300을 거두었다.'; } },
      { label: '장세를 면제한다', hint: '상업 +40 · 상인 지지 +10', apply: () => { S.regions[c.r].comm += 40; ig(S, fid, 'sangin', 10); return '상인들이 더 몰려들었다.'; } },
    ],
  },
  {
    id: 'invention', title: '새 기계', art: 'gear', scope: 'player',
    weight: (S, fid) => (F(S, fid).research.cur && officersOf(S, fid).some((o) => hasTrait(o, '발명')) ? 1.3 : 0),
    setup: (S, fid) => { const o = R.pick(officersOf(S, fid).filter((o) => hasTrait(o, '발명'))); return o ? { o: o.id } : null; },
    text: (S, fid, c) => `${josa(S.officers[c.o].name, '이/가')} 밤을 새워 새 기계를 만들어 바쳤다. 톱니와 도르래가 맞물려 돈다.`,
    choices: (S, fid, c) => [
      { label: '상을 내린다', hint: '錢 -150 · 연구 크게 진척 · 충성 +10', ok: F(S, fid).gold >= 150, apply: () => { const f = F(S, fid); f.gold -= 150; f.research.prog += 70; S.officers[c.o].loyalty = clamp(S.officers[c.o].loyalty + 10, 0, 100); return '연구가 크게 진척되었다.'; } },
      { label: '"신통하구나"', hint: '연구 진척', apply: () => { F(S, fid).research.prog += 40; return '연구가 진척되었다.'; } },
    ],
  },
  {
    id: 'festival', title: '명절', art: 'festival', scope: 'player',
    weight: (S) => (S.season === 1 || S.season === 2 ? 0.9 : 0),
    setup: () => ({}),
    text: (S) => (S.season === 1 ? '단오날이다. 아낙들은 그네를 뛰고 장정들은 씨름판에 모였다.' : '한가위 보름달이 떴다. 송편 냄새가 고을마다 퍼진다.'),
    choices: (S, fid) => [
      { label: '잔치를 크게 연다', hint: '錢 -300 · 모든 고을 민심 +5 · 名 +10', ok: F(S, fid).gold >= 300, apply: () => { F(S, fid).gold -= 300; loyAll(S, fid, 5); F(S, fid).prestige += 10; F(S, fid).prestigeTotal += 10; return '온 고을이 한바탕 놀았다.'; } },
      { label: '소박하게 치른다', hint: '錢 -80 · 민심 +2', ok: F(S, fid).gold >= 80, apply: () => { F(S, fid).gold -= 80; loyAll(S, fid, 2); return '조촐하지만 정겨운 명절이었다.'; } },
      { label: '그냥 넘긴다', hint: '', apply: () => '나라에 일이 많다.' },
    ],
  },
  {
    id: 'donghak', title: '동학의 물결', art: 'flame', scope: 'player',
    weight: (S, fid) => (notForeign(S, fid) && (techEra(S, fid) >= 3 || S.turn >= 60) && F(S, fid).igs.nongmin.appr < -15 ? 1.5 : 0),
    setup: () => ({}),
    text: () => '"사람이 곧 하늘이다." 동학의 가르침이 들불처럼 번진다. 보국안민의 깃발이 남쪽 들판을 메운다.',
    choices: (S, fid) => [
      { label: '폐정을 개혁한다', hint: '名 -60 · 농민 +30 · 사림 -15 · 모든 민심 +5', ok: F(S, fid).prestige >= 60, apply: () => { F(S, fid).prestige -= 60; ig(S, fid, 'nongmin', 30); ig(S, fid, 'sarim', -15); loyAll(S, fid, 5); return '집강소가 세워지고 탐관오리가 쫓겨났다.'; } },
      { label: '교조를 잡아들인다', hint: '농민 -20 · 가장 민심 낮은 고을에서 봉기', apply: () => { ig(S, fid, 'nongmin', -20); const r = regionsOf(S, fid).sort((a, b) => a.loyalty - b.loyalty)[0]; if (r && regionsOf(S, fid).length > 1 && r.id !== F(S, fid).capital) { revolt(S, r.id); return `${nm(r.id)}에서 농민군이 일어나 관아를 점령했다!`; } return '잡아들였으나 원성이 하늘을 찌른다.'; } },
      { label: '모르는 체한다', hint: '농민 -10', apply: () => { ig(S, fid, 'nongmin', -10); return '불씨는 꺼지지 않았다.'; } },
    ],
  },
  {
    id: 'concession', title: '이권 요구', art: 'gold', scope: 'player',
    weight: (S, fid) => (F(S, fid).techs.gaehang && notForeign(S, fid) ? 1 : 0),
    setup: () => ({}),
    text: () => '외국 공사가 금광 채굴권과 철도 부설권을 달라고 한다. 대가로 큰돈을 내겠다고 한다.',
    choices: (S, fid) => [
      { label: '내어 준다', hint: '錢 +1500 · 모든 민심 -6 · 개화파 +10 · 名 -20', apply: () => { const f = F(S, fid); f.gold += 1500; loyAll(S, fid, -6); ig(S, fid, 'gaehwa', 10); f.prestige = Math.max(0, f.prestige - 20); return '금이 실려 나갔다. 돈은 들어왔으나 백성의 눈길이 차갑다.'; } },
      { label: '거절한다', hint: '名 +15', apply: () => { F(S, fid).prestige += 15; F(S, fid).prestigeTotal += 15; return '공사가 언짢아하며 돌아갔다.'; } },
    ],
  },
  {
    id: 'loan', title: '거상의 제안', art: 'gold', scope: 'player',
    weight: (S, fid) => (F(S, fid).gold < 400 && !F(S, fid).debt ? 1.5 : 0),
    setup: () => ({}),
    text: () => '송상의 대방이 찾아왔다. "나랏일에 쓰실 돈이라면 얼마든지 융통해 드리지요. 이자는 조금만…"',
    choices: (S, fid) => [
      { label: '빌린다', hint: '錢 +1500 · 4철 동안 錢 -450씩', apply: () => { const f = F(S, fid); f.gold += 1500; f.debt = { per: 450, left: 4 }; return '돈궤가 들어왔다.'; } },
      { label: '사양한다', hint: '', apply: () => '빚은 무서운 법이다.' },
    ],
  },
  {
    id: 'crisis', title: '세력 집단의 반발', art: 'flame', scope: 'player',
    weight: (S, fid) => (notForeign(S, fid) && Object.entries(F(S, fid).igs).some(([k, g]) => g.appr <= -30 && g.clout >= 10) ? 2.2 : 0),
    setup: (S, fid) => { const e = Object.entries(F(S, fid).igs).filter(([k, g]) => g.appr <= -30 && g.clout >= 10).sort((a, b) => a[1].appr - b[1].appr)[0]; return e ? { ig: e[0] } : null; },
    text: (S, fid, c) => ({
      sarim: '사림이 관직을 내던지고 낙향한다. 서원마다 조정을 성토하는 통문이 돈다.',
      hunchuk: '훈척 대신들이 밤마다 모인다. 반정(反正)을 꾀한다는 말이 새어 나왔다.',
      muban: '군영의 병사들이 녹봉이 밀렸다며 무기고를 열었다. 군란이다!',
      sangin: '시전 상인들이 일제히 가게 문을 닫았다. 철시(撤市)다.',
      nongmin: '농민들이 죽창을 들고 관아로 몰려간다. 민란의 기운이 짙다.',
      gaehwa: '젊은 개화파 관료들이 외국 공관과 손잡고 정변을 꾸민다.',
    }[c.ig]),
    choices: (S, fid, c) => [
      { label: '달래고 요구를 들어준다', hint: '名 -50 · 지지 +25', ok: F(S, fid).prestige >= 50, apply: () => { F(S, fid).prestige -= 50; ig(S, fid, c.ig, 25); return '불길이 가라앉았다.'; } },
      { label: '강경하게 누른다', hint: '피해를 감수한다 · 지지 -5', apply: () => crisisHit(S, fid, c.ig) },
    ],
  },
];

function crisisHit(S, fid, id) {
  const f = F(S, fid);
  ig(S, fid, id, -5);
  if (id === 'sarim') { f.prestige = Math.max(0, f.prestige - 30); for (const o of R.shuffle(officersOf(S, fid)).slice(0, 3)) o.loyalty = clamp(o.loyalty - 6, 0, 100); return '선비들이 떠났다. 名과 장수 충성이 떨어졌다.'; }
  if (id === 'hunchuk') { f.legit = clamp(f.legit - 10, 0, 100); return '주모자를 잡았으나 정통성이 흔들렸다.'; }
  if (id === 'muban') { for (const r of regionsOf(S, fid)) { r.training = Math.max(10, r.training - 12); r.troops = Math.round(r.troops * 0.95); } return '군란을 진압했으나 군기가 무너졌다.'; }
  if (id === 'sangin') { const g = Math.round(Math.max(300, f.gold * 0.2)); f.gold = Math.max(0, f.gold - g); return `철시로 錢 ${josa(fmt(g), '을/를')} 잃었다.`; }
  if (id === 'nongmin') { const r = regionsOf(S, fid).filter((r) => r.id !== f.capital).sort((a, b) => a.loyalty - b.loyalty)[0]; if (r) { revolt(S, r.id); return `${nm(r.id)}에서 민란이 일어나 관아를 점령했다!`; } return '가까스로 진정시켰다.'; }
  if (id === 'gaehwa') { f.legit = clamp(f.legit - 8, 0, 100); f.prestige = Math.max(0, f.prestige - 20); return '정변은 사흘 만에 끝났지만 나라가 크게 흔들렸다.'; }
  return '';
}
function itemOwned(S, k) {
  if (Object.values(S.factions).some((f) => f.treasury.includes(k))) return true;
  if (Object.values(S.officers).some((o) => o.item === k && o.status !== 'dead')) return true;
  return false;
}
function removeHidden(S, k) {
  for (const rid in S.hiddenItems || {}) S.hiddenItems[rid] = S.hiddenItems[rid].filter((x) => x !== k);
}
export const EVENT_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
