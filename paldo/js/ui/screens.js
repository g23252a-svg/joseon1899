// 큰 화면들: 문물·정치·외교·인물·세력·실록·메뉴·도움말
import { h, clear, bar, store } from './dom.js';
import { modal, ask, toast, info } from './modal.js';
import { portrait } from './portrait.js';
import { audio } from './audio.js';
import { fmt, fmtSigned, clamp, josa, pp } from '../core/util.js';
import { TECHS, TECH_BY_ID, ERAS } from '../data/techs.js';
import { LAWS, IGS, TAX_LEVELS } from '../data/politics.js';
import { ITEMS, TRAITS, WONDERS, BUILDINGS, RESOURCES } from '../data/buildings.js';
import {
  regionsOf, officersOf, regionBase, eff, isRuler, dateStr, relation, treaty, factionPower, aliveFactions, hasTrait, statSum, rulerOf, scenarioOf, totalTroops,
} from '../core/state.js';
import { availableTechs, techCost, setResearch, factionIncome, igTarget, canChangeLaw, changeLaw, lawChangeCost, lawOpt, score } from '../core/rules.js';
import { reward } from '../core/actions.js';
import { DIPLO, diploChance, propose, breakTreaty } from '../core/diplomacy.js';
import { victoryProgress } from '../core/victory.js';

const LOOK_NAME = { king: '군주', civil: '문관', military: '무관', scholar: '선비', monk: '승려', rebel: '민중', woman: '여인', merchant: '상인', wae: '왜장', ming: '명장', modern: '개화' };
export const statLine = (o) => { const e = eff(o); return `통${e.lea} 무${e.str} 지${e.int} 정${e.pol} 매${e.cha}`; };

// ── 문물 ──
export function techScreen(app) {
  const S = app.S, P = S.player, f = S.factions[P];
  const m = modal({ title: '문물 — 기술 나무', cls: 'full' });
  const render = () => {
    const inc = factionIncome(S, P);
    const cur = f.research.cur ? TECH_BY_ID[f.research.cur] : null;
    const cost = cur ? techCost(S, P, cur) : 0;
    const eta = cur ? Math.ceil(Math.max(0, cost - f.research.prog) / Math.max(1, inc.sci)) : 0;
    const headBox = h('div.box', { style: { marginBottom: '12px' } },
      h('h3', '연구 중', h('span', `學 +${Math.round(inc.sci)}/철 (장수가 「연구」 명령을 내리면 더 빨라진다)`)),
      cur ? [h('div.row', h('b', cur.name), h('span', `${Math.round(f.research.prog)} / ${cost}`), h('span.tag', `약 ${eta}철`)), bar(f.research.prog, cost, '#a8322a')]
        : h('div', { style: { color: 'var(--bad)' } }, `연구할 문물을 고르라. (쌓아 둔 學 ${Math.round(f.research.bank)})`));
    const avail = new Set(availableTechs(S, P).map((t) => t.id));
    const tree = h('div.tree');
    for (const era of ERAS) {
      const col = h('div.era', h('h3', era.name, h('small', `${era.hanja} · ${era.desc}`)));
      for (const t of TECHS.filter((x) => x.era === era.id)) {
        const done = !!f.techs[t.id], isCur = f.research.cur === t.id, av = avail.has(t.id);
        const c = techCost(S, P, t);
        col.append(h('button.tech' + (done ? '.done' : isCur ? '.cur' : av ? '.av' : '.lock'), {
          disabled: done || (!av && !isCur) || null,
          onclick: () => { if (setResearch(S, P, t.id)) { audio.play('pluck'); toast(`「${t.name}」 연구를 시작한다.`, 'good'); render(); app.refresh(); } },
        },
          h('div.nm', h('span', t.name, ' ', h('small', t.hanja)), done ? null : h('small', fmt(c))),
          h('div.ds', t.desc),
          t.req.length ? h('div.rq', '선행: ' + t.req.map((q) => TECH_BY_ID[q].name + (f.techs[q] ? '✓' : '')).join(', ')) : null,
          isCur ? h('div.pg', h('i', { style: { width: Math.min(100, (f.research.prog / c) * 100) + '%' } })) : null));
      }
      tree.append(col);
    }
    m.setBody(headBox, h('div', { style: { overflowX: 'auto' } }, tree));
  };
  render();
}

// ── 정치 ──
export function politicsScreen(app) {
  const S = app.S, P = S.player, f = S.factions[P];
  const m = modal({ title: '정치 — 세력 집단과 법령', cls: 'full' });
  if (f.foreign) { m.setBody(h('p', '외세 세력에는 조정의 법령과 붕당이 없다. 대신 바닷길(제해권)과 군량이 생명줄이다.')); return; }
  const render = () => {
    const cost = lawChangeCost(S, P);
    const igBox = h('div.box', h('h3', '세력 집단', h('span', '지지 30 이상이면 혜택, -30 이하면 반발')));
    for (const id in IGS) {
      const G = IGS[id], st = f.igs[id];
      if (G.req && !f.techs[G.req]) continue;
      const a = st.appr, tgt = igTarget(S, f, id);
      const left = a >= 0 ? 50 : 50 + a / 2, width = Math.abs(a) / 2;
      igBox.append(h('div.ig',
        h('div.nm', G.name, h('small', `영향력 ${st.clout}%`)),
        h('div',
          h('div.appr', h('i', { style: { left: left + '%', width: width + '%', background: a >= 30 ? '#3f6b3a' : a <= -30 ? '#a8322a' : G.color } })),
          h('div', { style: { fontSize: '11.5px', color: 'var(--ink-3)', marginTop: '2px' } }, `지지 ${Math.round(a)} → ${Math.round(tgt)} · `, a >= 30 ? h('span.hi', '혜택: ' + G.good) : a <= -30 ? h('span.lo', '반발: ' + G.bad) : G.desc))));
    }
    const taxBox = h('div.box', h('h3', '세율', h('span', '세금이 무거우면 수입이 늘고 농민·상인과 민심이 등을 돌린다')),
      h('div.seg', TAX_LEVELS.map((t) => h('button', { class: f.taxLevel === t.id ? 'on' : '', onclick: () => { f.taxLevel = t.id; audio.play('click'); render(); app.refresh(); } }, `${t.name} ×${t.mul}`))));
    const laws = h('div');
    for (const cat in LAWS) {
      const L = LAWS[cat];
      laws.append(h('div.law', h('h4', L.name, h('small', L.hanja)),
        h('div.lopts', L.options.map((o) => {
          const on = f.laws[cat] === o.id;
          const why = on ? null : canChangeLaw(S, P, cat, o.id);
          const igs = Object.entries(o.ig || {}).map(([k, v]) => `${IGS[k].name}${v > 0 ? '+' : ''}${v}`).join(' ');
          return h('button.lopt' + (on ? '.on' : ''), {
            disabled: (!on && !!why) || null, title: why || '',
            onclick: async () => {
              if (on) return;
              if (!(await ask('법령 변경', `「${o.name}」${pp(o.name, '으로/로')} 바꾼다. 名 ${josa(cost, '이/가')} 든다.`, '바꾼다', '그만둔다'))) return;
              const r = changeLaw(S, P, cat, o.id);
              if (r) toast(r, 'bad'); else { audio.play('gong'); toast(`「${o.name}」 시행!`, 'good'); }
              render(); app.refresh();
            },
          }, h('b', o.name, on ? ' ✓' : ''), h('span', o.desc), igs ? h('span.igs', igs) : null, why && !on ? h('span', { style: { color: 'var(--bad)', fontSize: '11px' } }, why) : null);
        }))));
    }
    m.setBody(h('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' } },
      h('div', { style: { display: 'grid', gap: '12px', alignContent: 'start' } }, igBox, taxBox,
        h('div.box', h('h3', '정통성', h('span', Math.round(f.legit))), bar(f.legit, 100, '#a8842a'), h('p', { style: { fontSize: '12px', margin: '6px 0 0', color: 'var(--ink-3)' } }, '정통성이 높으면 장수 충성과 민심이 오른다. 도읍 한성, 위업(경복궁·종묘), 훈척의 지지가 정통성을 올린다.'))),
      h('div', h('div.box', { style: { marginBottom: '8px' } }, h('h3', '법령', h('span', `바꿀 때마다 名 ${cost} (지금 名 ${Math.round(f.prestige)})`))), laws)));
  };
  render();
}

// ── 외교 ──
export function diplomacyScreen(app) {
  const S = app.S, P = S.player, f = S.factions[P];
  const m = modal({ title: '외교', wide: true });
  const render = () => {
    const envoys = officersOf(S, P).filter((o) => !o.acted && o.injured <= 0 && !o.ally).sort((a, b) => eff(b).cha - eff(a).cha);
    const envoy = envoys[0];
    const rows = h('div', { style: { display: 'grid', gap: '8px' } });
    for (const o of aliveFactions(S).filter((x) => x.id !== P)) {
      const rel = relation(S, P, o.id), t = treaty(S, P, o.id);
      const ratio = factionPower(S, P) / Math.max(1, factionPower(S, o.id));
      const ruler = rulerOf(S, o.id);
      const btns = h('div.row');
      for (const type in DIPLO) {
        const ch = type === 'gift' ? 1 : diploChance(S, P, o.id, type, envoy);
        const dis = !envoy || (type === 'gift' && f.gold < 300) || (t && type !== 'gift') || (type === 'surrender' && ch < 0.02) || (o.foreign && type !== 'gift' && type !== 'truce');
        btns.append(h('button.btn.small', {
          disabled: dis || null, title: DIPLO[type].desc,
          onclick: async () => {
            if (!envoy) return;
            if (!(await ask(DIPLO[type].name, `${josa(envoy.name, '을/를')} 사신으로 ${o.name} 세력에 보낸다.\n${DIPLO[type].desc}${type !== 'gift' ? `\n성공 확률 약 ${Math.round(ch * 100)}%` : ''}`, '보낸다', '그만둔다'))) return;
            if (type === 'gift') f.gold -= 300;
            envoy.acted = true;
            const r = propose(S, P, o.id, type, envoy);
            audio.play(r.ok ? 'good' : 'bad');
            toast(r.text, r.ok ? 'good' : 'bad');
            app.refresh(true); render();
          },
        }, DIPLO[type].name + (type !== 'gift' && !dis ? ` ${Math.round(ch * 100)}%` : '')));
      }
      if (t) btns.append(h('button.btn.small.red', { onclick: async () => { if (!(await ask('맹약 파기', `${o.name} 세력과의 ${t.type === 'alliance' ? '동맹' : '휴전'}을 깬다. 名과 정통성이 떨어지고 모든 세력이 우리를 불신한다.`, '깬다', '그만둔다', true))) return; breakTreaty(S, P, o.id); render(); app.refresh(true); } }, '파기'));
      rows.append(h('div.box', { style: { display: 'grid', gridTemplateColumns: '54px 1fr', gap: '10px' } },
        ruler ? h('img', { src: portrait(ruler, 54), style: { width: '54px', height: '64px', borderRadius: '4px' } }) : h('div'),
        h('div', { style: { display: 'grid', gap: '4px' } },
          h('div.row', h('span.crest', { style: { background: o.color, width: '24px', height: '24px', fontSize: '13px' } }, o.crest), h('b', { style: { fontSize: '16px' } }, o.name), h('span', `군주 ${ruler?.name || '-'}`),
            t ? h('span.badge.' + (t.type === 'alliance' ? 'g' : 'y'), t.type === 'alliance' ? '동맹' : `휴전(${t.until - S.turn}철)`) : null),
          h('div.row', { style: { fontSize: '12.5px', color: 'var(--ink-2)' } }, `고을 ${regionsOf(S, o.id).length} · 병력 ${fmt(totalTroops(S, o.id))} · 장수 ${officersOf(S, o.id).length} · 국력비 ${ratio.toFixed(1)}배`),
          h('div.row', h('span', { style: { fontSize: '12px', width: '64px' } }, `우호 ${Math.round(rel)}`), h('div', { style: { flex: 1 } }, h('div.appr', h('i', { style: { left: (rel >= 0 ? 50 : 50 + rel / 2) + '%', width: Math.abs(rel) / 2 + '%', background: rel >= 0 ? '#3f6b3a' : '#a8322a' } })))),
          btns)));
    }
    m.setBody(h('p', { style: { margin: '0 0 10px', fontSize: '13px', color: 'var(--ink-2)' } }, envoy ? `사신: ${envoy.name} (매력 ${eff(envoy).cha}${hasTrait(envoy, '외교') ? ', 외교 특기' : ''}) — 이번 철에 움직이지 않은 장수 중 매력이 가장 높은 사람이 간다.` : '이번 철에 사신으로 보낼 장수가 없다.'), rows);
  };
  render();
}

// ── 인물 ──
export function officerScreen(app, initialTab = 'mine') {
  const S = app.S, P = S.player, f = S.factions[P];
  const m = modal({ title: '인물 열전', cls: 'full' });
  let tab = initialTab, sortKey = 'sum', dir = -1;
  const render = () => {
    const tabs = h('div.tabs', [['mine', `우리 장수 ${officersOf(S, P).length}`], ['free', '재야'], ['all', '천하의 인물'], ['treasury', `보물 ${f.treasury.length}`]].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; render(); } }, l)));
    let list = [];
    if (tab === 'mine') list = officersOf(S, P);
    if (tab === 'free') list = Object.values(S.officers).filter((o) => o.status === 'free' && o.found);
    if (tab === 'all') list = Object.values(S.officers).filter((o) => o.status === 'active');
    if (tab === 'treasury') {
      const box = h('div', { style: { display: 'grid', gap: '8px' } });
      if (!f.treasury.length) box.append(h('p', '보물이 없다. 장수에게 「탐색」을 시키거나 사건으로 얻는다.'));
      for (const it of f.treasury) {
        const I = ITEMS[it];
        const best = officersOf(S, P).filter((o) => !o.item).sort((a, b) => statSum(b) - statSum(a)).slice(0, 8);
        box.append(h('div.box', h('h3', `${I.name} ${I.hanja}`, h('span', Object.entries(I.stat).map(([k, v]) => `${{ lea: '통솔', str: '무력', int: '지력', pol: '정치', cha: '매력' }[k]}+${v}`).join(' '))),
          h('p', { style: { margin: '0 0 6px', fontSize: '13px' } }, I.desc),
          h('div.row', h('span', { style: { fontSize: '12px' } }, '하사:'), best.map((o) => h('button.btn.small', { onclick: () => { const r = reward(S, P, o.id, 'item', it); if (r) toast(r, 'bad'); else { audio.play('good'); toast(`${o.name}에게 「${I.name}」${pp(I.name, '을/를')} 내렸다. 충성 +15`, 'good'); } render(); app.refresh(); } }, o.name)))));
      }
      m.setBody(tabs, box);
      return;
    }
    const key = { sum: statSum, lea: (o) => eff(o).lea, str: (o) => eff(o).str, int: (o) => eff(o).int, pol: (o) => eff(o).pol, cha: (o) => eff(o).cha, loy: (o) => o.loyalty, name: (o) => o.name, loc: (o) => regionBase(o.loc)?.name || '' }[sortKey];
    list.sort((a, b) => (key(a) > key(b) ? dir : key(a) < key(b) ? -dir : 0));
    const th = (k, l, num) => h('th' + (num ? '.num' : ''), { onclick: () => { if (sortKey === k) dir = -dir; else { sortKey = k; dir = -1; } render(); } }, l + (sortKey === k ? (dir < 0 ? '▼' : '▲') : ''));
    const table = h('table.t', h('thead', h('tr', h('th', ''), th('name', '이름'), tab === 'all' ? h('th', '세력') : null, th('loc', '고을'), th('lea', '통솔', 1), th('str', '무력', 1), th('int', '지력', 1), th('pol', '정치', 1), th('cha', '매력', 1), th('sum', '합', 1), tab === 'mine' ? th('loy', '충성', 1) : null, h('th', '특기'), tab === 'mine' ? h('th', '') : null)));
    const tb = h('tbody');
    for (const o of list.slice(0, 200)) {
      const e = eff(o);
      const c = (v) => h('td.num', { class: v >= 85 ? 'num hi' : 'num' }, v);
      tb.append(h('tr',
        h('td', h('img', { src: portrait(o, 30), style: { width: '30px', height: '35px', borderRadius: '3px', display: 'block', cursor: 'pointer' }, onclick: () => bioDialog(app, o) })),
        h('td', h('b', { style: { cursor: 'pointer' }, onclick: () => bioDialog(app, o) }, o.name), ' ', isRuler(S, o) ? h('span.badge.r', '군주') : null, o.ally ? h('span.badge.y', '원군') : null, o.item ? h('span.badge.m', ITEMS[o.item].name) : null, o.injured > 0 ? h('span.badge', '부상') : null),
        tab === 'all' ? h('td', h('span.crest', { style: { background: S.factions[o.faction].color, width: '20px', height: '20px', fontSize: '11px', display: 'inline-grid' } }, S.factions[o.faction].crest)) : null,
        h('td', { style: { cursor: 'pointer' }, onclick: () => { m.close(); app.select(o.loc, true); } }, regionBase(o.loc)?.name || '-'),
        c(e.lea), c(e.str), c(e.int), c(e.pol), c(e.cha), h('td.num', statSum(o)),
        tab === 'mine' ? h('td.num', { class: o.loyalty < 40 ? 'num lo' : 'num' }, Math.round(o.loyalty)) : null,
        h('td', { style: { fontSize: '12px' } }, o.traits.join(' ')),
        tab === 'mine' ? h('td', isRuler(S, o) || o.ally ? null : h('button.btn.small', { disabled: f.gold < 100 || o.loyalty >= 100 || null, onclick: () => { const r = reward(S, P, o.id, 'gold'); if (r) toast(r, 'bad'); else audio.play('pluck'); render(); app.refresh(); } }, '포상 錢100')) : null));
    }
    table.append(tb);
    m.setBody(tabs, tab === 'free' && !list.length ? h('p', '찾아낸 재야 인물이 없다. 고을에서 「탐색」을 해 보자.') : h('div', { style: { overflowX: 'auto' } }, table));
  };
  render();
}
export function bioDialog(app, o) {
  const S = app.S;
  const e = eff(o);
  const statRow = (k, v) => h('div.stat', h('span.k', k), bar(v, 100, v >= 85 ? '#a8322a' : '#4a453d'), h('span.v', v));
  modal({
    title: `${o.name} ${o.hanja || ''}`,
    body: h('div', { style: { display: 'grid', gridTemplateColumns: '120px 1fr', gap: '14px' } },
      h('img', { src: portrait(o, 120), style: { width: '120px', height: '142px', borderRadius: '6px', border: '1px solid var(--line)' } }),
      h('div', { style: { display: 'grid', gap: '5px', alignContent: 'start' } },
        h('div.row', h('span.tag', LOOK_NAME[o.look] || ''), o.faction ? h('span.tag', S.factions[o.faction]?.name + ' 세력') : h('span.tag', '재야'), o.loc ? h('span.tag', regionBase(o.loc).name) : null, o.faction && !isRuler(S, o) ? h('span.tag', `충성 ${Math.round(o.loyalty)}`) : null),
        statRow('통솔', e.lea), statRow('무력', e.str), statRow('지력', e.int), statRow('정치', e.pol), statRow('매력', e.cha),
        o.traits.length ? h('div', { style: { fontSize: '12.5px' } }, o.traits.map((t) => h('div', h('b', t), ' — ', TRAITS[t] || ''))) : null,
        o.item ? h('div', { style: { fontSize: '12.5px' } }, h('b', '보물 '), `${ITEMS[o.item].name}: ${ITEMS[o.item].desc}`) : null,
        h('p', { style: { margin: '6px 0 0', fontSize: '14px', lineHeight: 1.6 } }, o.bio || ''),
        o.gen ? null : h('p', { style: { margin: 0, fontSize: '11px', color: 'var(--ink-3)' } }, '능력치는 게임을 위한 평가입니다.'))),
    footer: [],
  });
}

// ── 세력 비교 ──
export function factionScreen(app) {
  const S = app.S, P = S.player;
  const m = modal({ title: '천하의 형세', wide: true });
  const fs = aliveFactions(S).map((f) => ({ f, regs: regionsOf(S, f.id).length, troops: totalTroops(S, f.id), offs: officersOf(S, f.id).length, techs: Object.keys(f.techs).length, sc: score(S, f.id), pres: Math.round(f.prestigeTotal), wonders: Object.values(S.wonders).filter((w) => w.owner === f.id).length })).sort((a, b) => b.sc - a.sc);
  const maxSc = Math.max(...fs.map((x) => x.sc));
  const table = h('table.t', h('thead', h('tr', h('th', '세력'), h('th.num', '고을'), h('th.num', '병력'), h('th.num', '장수'), h('th.num', '문물'), h('th.num', '名'), h('th.num', '위업'), h('th', '국력'))),
    h('tbody', fs.map((x) => h('tr', { style: x.f.id === P ? { background: 'rgba(168,50,42,0.06)' } : {} },
      h('td', h('div.row', h('span.crest', { style: { background: x.f.color, width: '22px', height: '22px', fontSize: '12px' } }, x.f.crest), h('b', x.f.name), x.f.id === P ? h('span.badge.r', '나') : null)),
      h('td.num', x.regs), h('td.num', fmt(x.troops)), h('td.num', x.offs), h('td.num', x.techs), h('td.num', fmt(x.pres)), h('td.num', x.wonders),
      h('td', { style: { width: '30%' } }, bar(x.sc, maxSc, x.f.color))))));
  const vp = victoryProgress(S, P);
  const sc = scenarioOf(S);
  const vbox = h('div.box', { style: { marginTop: '12px' } }, h('h3', '승리 조건'));
  if (sc.special === 'imjin') {
    vbox.append(h('p', { style: { margin: 0, fontSize: '13.5px' } }, `왜군을 이 땅에서 모두 몰아내면 승리. ${sc.endYear}년 겨울까지 한성을 지키고 왜군이 4곳 이하만 쥐고 있으면 「전쟁 종결」 승리.`),
      h('div.row', { style: { marginTop: '6px' } }, h('span.tag', `제해권 ${Math.round(S.scn.sea || 0)}`), h('span.tag', `왜 수군 ${fmt(S.scn.waeNavy || 0)}`), h('span.tag', `왜군 고을 ${regionsOf(S, 'wae').length}`), S.scn.truce ? h('span.tag.b', '강화 교섭 중') : null),
      h('p', { style: { margin: '6px 0 0', fontSize: '12px', color: 'var(--ink-3)' } }, '제해권이 높을수록 왜군의 증원과 군량이 끊긴다. 남해·서해 바닷가 고을에서 수군 장수로 「해전」을 벌여라.'));
  } else {
    if (vp.unify) vbox.append(h('div', { style: { fontSize: '13.5px' } }, h('b', '천하통일 '), `경쟁 세력을 모두 없애고 고을 ${vp.unify.need}곳 이상 (지금 ${vp.unify.regs}곳, 남은 세력 ${vp.unify.rivals})`), bar(vp.unify.regs, vp.unify.need, '#a8322a'));
    if (vp.culture) vbox.append(h('div', { style: { fontSize: '13.5px', marginTop: '6px' } }, h('b', '태평성대 '), `名 누적 ${fmt(vp.culture.pres)}/${fmt(vp.culture.need)} · 위업 ${vp.culture.wonders}/${vp.culture.needW}`), bar(vp.culture.pres, vp.culture.need, '#a8842a'));
    if (vp.modern) vbox.append(h('div', { style: { fontSize: '13.5px', marginTop: '6px' } }, h('b', '근대화 '), `문물 「광무개혁」${vp.modern.done ? '✓' : '✗'} · 고을 ${vp.modern.regs}/${vp.modern.need}`));
    vbox.append(h('p', { style: { margin: '6px 0 0', fontSize: '12px', color: 'var(--ink-3)' } }, `컴퓨터 세력도 같은 조건으로 이길 수 있다. ${sc.era} ${sc.endYear}년이 지나면 점수로 판정한다.`));
  }
  const wbox = h('div.box', { style: { marginTop: '12px' } }, h('h3', '위업'), h('div', { style: { display: 'grid', gap: '4px', fontSize: '13px' } }, Object.entries(WONDERS).map(([id, W]) => {
    const w = S.wonders[id];
    const building = aliveFactions(S).find((f) => f.wonder?.id === id);
    return h('div.row', h('b', { style: { minWidth: '110px' } }, W.name), w ? h('span', `${S.factions[w.owner].name} — ${regionBase(w.region).name}`) : building ? h('span', { style: { color: 'var(--warn)' } }, `${building.name} 공사 중(${building.wonder.left}철)`) : h('span', { style: { color: 'var(--ink-3)' } }, '아직 없음'));
  })));
  m.setBody(table, vbox, wbox);
}

// ── 실록 ──
export function chronicleScreen(app) {
  const S = app.S;
  let filter = 'all';
  const m = modal({ title: '실록 — 지난 일의 기록', wide: true });
  const render = () => {
    const kinds = { all: '전체', mine: '우리 세력', war: '전쟁', major: '큰일', event: '사건' };
    const list = S.log.filter((l) => filter === 'all' || (filter === 'mine' ? l.fid === S.player : filter === 'war' ? l.kind === 'war' || l.kind === 'major' && /함락|멸망|항복/.test(l.text) : l.kind === filter)).slice(-300).reverse();
    m.setBody(h('div.tabs', Object.entries(kinds).map(([k, v]) => h('button', { class: filter === k ? 'on' : '', onclick: () => { filter = k; render(); } }, v))),
      h('div', { style: { display: 'grid', gap: '3px' } }, list.map((l) => h('div', { style: { fontSize: '13.5px', padding: '3px 0', borderBottom: '1px dotted var(--line)', color: l.kind === 'major' ? 'var(--seal)' : '' } }, h('span', { style: { color: 'var(--ink-3)', fontSize: '12px', marginRight: '8px' } }, l.d), l.text))));
  };
  render();
}

// ── 메뉴(저장·불러오기·설정) ──
export function menuScreen(app) {
  const S = app.S;
  const m = modal({ title: '차림표', wide: false });
  const render = () => {
    const slots = [1, 2, 3].map((i) => {
      const meta = app.saveMeta(i);
      return h('div.box', h('h3', `${i}번 칸`, h('span', meta ? meta.label : '비어 있음')),
        h('div.row', h('button.btn.small.primary', { onclick: () => { const ok = app.save(i); toast(ok ? `${i}번 칸에 저장했다.` : '저장하지 못했다(브라우저 저장소를 쓸 수 없음). 아래 「저장 문자열」을 쓰자.', ok ? 'good' : 'bad'); render(); } }, '저장'),
          h('button.btn.small', { disabled: !meta || null, onclick: async () => { if (await ask('불러오기', `${i}번 칸을 불러온다. 지금 진행은 사라진다.`, '불러온다', '그만둔다')) { m.close(); app.load(i); } } }, '불러오기')));
    });
    const code = h('textarea.code', { readonly: true, 'aria-label': '저장 문자열' });
    const paste = h('textarea.code', { placeholder: '여기에 저장 문자열을 붙여 넣는다', 'aria-label': '불러올 문자열' });
    m.setBody(
      h('div', { style: { display: 'grid', gap: '8px' } }, ...slots,
        h('div.box', h('h3', '저장 문자열', h('span', '다른 기기로 옮기거나 백업')),
          h('div.row', h('button.btn.small', { onclick: () => { code.value = app.exportSave(); code.select(); navigator.clipboard?.writeText(code.value).then(() => toast('복사했다.', 'good')).catch(() => toast('선택된 글을 직접 복사하라.', 'info')); } }, '만들고 복사'), h('span', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, '자동 저장은 해마다 봄에 된다.')), code,
          paste, h('button.btn.small', { onclick: async () => { if (!paste.value.trim()) return; if (await ask('불러오기', '붙여 넣은 문자열로 불러온다.', '불러온다', '그만둔다')) { const ok = app.importSave(paste.value.trim()); if (ok) m.close(); else toast('문자열이 올바르지 않다.', 'bad'); } } }, '문자열로 불러오기')),
        h('div.box', h('h3', '설정'),
          h('label.switch', h('input', { type: 'checkbox', checked: !audio.muted || null, onchange: () => { audio.toggle(); } }), '소리'),
          h('label.switch', { style: { marginLeft: '14px' } }, h('input', { type: 'checkbox', checked: S.settings.autoBattle || null, onchange: (e) => { S.settings.autoBattle = e.target.checked; } }), '전투 자동 진행')),
        h('div.row', h('button.btn', { onclick: () => { m.close(); helpScreen(); } }, '도움말'), h('button.btn', { onclick: async () => { if (await ask('처음으로', '타이틀 화면으로 돌아간다. 저장하지 않은 진행은 사라진다.', '돌아간다', '그만둔다', true)) { m.close(); app.toTitle(); } } }, '타이틀로'))));
  };
  render();
}

// ── 도움말 ──
export function helpScreen() {
  modal({
    title: '도움말 — 팔도천하를 다스리는 법', wide: true,
    body: h('div.help',
      h('p', '「팔도천하」는 조선 팔도를 무대로 한 턴제 전략 게임이다. 삼국지식 장수 경영, 문명식 문물(기술) 나무와 위업, 빅토리아식 세력 집단·법령 정치를 한데 묶었다. 한 턴은 한 철(봄·여름·가을·겨울)이다.'),
      h('h3', '한 철의 흐름'),
      h('ul', h('li', '지도에서 우리 고을을 누르면 오른쪽(휴대폰은 아래)에 고을 판이 열린다.'), h('li', '장수를 누르고 명령을 내린다. 장수마다 한 철에 한 번 움직인다.'), h('li', '「위임」을 켠 고을은 철이 끝날 때 남은 장수들이 「방침」대로 알아서 일한다.'), h('li', '다 했으면 오른쪽 위 「철 넘기기」. 다른 세력이 움직이고, 세금·인구·연구·사건이 처리된다.')),
      h('h3', '자원'),
      h('ul', h('li', h('b', '錢(돈) '), '상업·인구·교역에서. 명령·건설·녹봉에 쓴다.'), h('li', h('b', '米(쌀) '), '농업·인구에서. 가을에 크게 거둔다. 병사가 먹는다. 바닥나면 군사가 흩어진다.'), h('li', h('b', '學(연구) '), '문물을 익힌다. 지력 높은 장수, 향교·서원·학교, 「연구」 명령.'), h('li', h('b', '名(명망) '), '위업·예술가·승리에서. 법령을 바꾸고 인재를 부르는 데 쓴다. 누적 名은 문화 승리 조건.'), h('li', h('b', '정통성 '), '높을수록 장수 충성과 민심이 오른다.')),
      h('h3', '장수 명령'),
      h('ul', h('li', '내정: 개간(농업) · 상업 · 축성(성곽) · 선정(민심) · 연구 · 건설 · 위업'), h('li', '군사: 징병 · 훈련 · 이동 · 수송 · 출진(고을 판의 「출진」)'), h('li', '인사: 탐색(재야 인재·보물) · 등용(재야나 적 장수 데려오기)'), h('li', '계략: 유언비어(적 민심↓) · 이간(적 장수 충성↓) · 선동(민심 40 미만 적 고을에 민란)'), h('li', '외교: 위쪽 「외교」에서 친선·동맹·휴전·항복 권고')),
      h('h3', '전투'),
      h('p', '출진하면 하루씩 작전을 고른다. 돌격은 계략을 깨고, 수비는 돌격을 받아치며, 계략은 수비에 강하다. 사격은 무난하다. 성곽이 있으면 수비측이 크게 유리하니 성벽부터 깎아야 한다. 일기토로 적장을 꺾으면 사기가 치솟는다. 이기면 고을과 포로를 얻는다. 포로는 등용·석방·처형할 수 있다.'),
      h('p', '일기토: 베기는 내려치기를 끊고, 내려치기는 막기를 부수며, 막기는 베기를 받아친다. 기합으로 기를 모아 필살을 쓴다. 지력 높은 적은 버릇을 읽는다.'),
      h('h3', '정치'),
      h('p', '사림·훈척·무반·상인·농민(그리고 개화파)이 저마다 법령과 형편에 따라 지지하거나 반발한다. 지지 30 이상이면 혜택, -30 이하면 상소·반정·군란·철시·민란이 일어난다. 문물을 익히면 대동법·균역법·신해통공 같은 새 법령이 열린다.'),
      h('h3', '승리'),
      h('ul', h('li', '천하통일: 경쟁 세력을 모두 없앤다.'), h('li', '태평성대: 名을 많이 쌓고 위업 셋을 세운다.'), h('li', '근대화: 광무개혁을 익히고 고을 열 곳을 지닌다.'), h('li', '임진년: 왜군을 몰아내거나 1598년 겨울까지 버틴다.')),
      h('h3', '조작'),
      h('p', '지도 끌기: 이동 · 휠/두 손가락: 확대 · 두 번 누르기: 확대. ', h('span.kbd', 'Enter'), ' 철 넘기기 · ', h('span.kbd', 'Esc'), ' 창 닫기 · ', h('span.kbd', 'T'), ' 문물 · ', h('span.kbd', 'P'), ' 정치 · ', h('span.kbd', 'O'), ' 인물'),
      h('p', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, '인물의 능력치와 「팔도군웅전」의 설정은 게임을 위한 가상이다. 「임진년」은 실제 전쟁을 바탕으로 각색했다.')),
    footer: [],
  });
}
export { LOOK_NAME };
