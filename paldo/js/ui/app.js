// 게임 화면 전체를 묶는다: 위쪽 띠, 지도, 고을 판, 명령, 출진, 철 넘기기, 저장.
import { h, $, clear, bar, store } from './dom.js';
import { modal, ask, toast, banner, busy, info, topModal, closeAllModals, sleep } from './modal.js';
import { createMap, hexA } from './mapview.js';
import { portrait } from './portrait.js';
import { audio } from './audio.js';
import { runBattle, runDuel } from './battleview.js';
import { techScreen, politicsScreen, diplomacyScreen, officerScreen, factionScreen, chronicleScreen, menuScreen, helpScreen, bioDialog, statLine } from './screens.js';
import { fmt, fmtSigned, clamp, R, josa, pp } from '../core/util.js';
import { REGION_BY_ID, PROVINCES } from '../data/regions.js';
import { BUILDINGS, WONDERS, RESOURCES, ITEMS } from '../data/buildings.js';
import { TECH_BY_ID } from '../data/techs.js';
import {
  regionsOf, officersOf, officersIn, freeIn, regionBase, eff, isRuler, dateStr, hasTrait, adjOf, canAttack, treaty, relation, SEASONS,
  scenarioOf, totalTroops, aliveFactions, statSum, syncRng, VERSION,
} from '../core/state.js';
import { regionYield, factionIncome, caps, regionSlots, buildCost, mod, buildingEff, SEASON_RICE } from '../core/rules.js';
import { ACTIONS, ALLY_OK, canAct, doAction, actionCost, recruitAmount, movable, hireChance, schemeChance, startAttack, canStartAttack, POLICIES, autoOfficer } from '../core/actions.js';
import { simulateAttack, resolveCaptive, captiveHireChance } from '../core/battle.js';
import { fightBattle } from '../core/war.js';
import { endTurn } from '../core/turn.js';

const ART = { drought: '旱', flood: '洪', locust: '蝗', harvest: '豊', plague: '疫', comet: '彗', scroll: '疏', person: '薦', exam: '科', mapae: '御', bandit: '賊', tiger: '虎', treasure: '寶', envoy: '使', pirate: '倭', horse: '胡', ship: '船', marriage: '囍', dagger: '逆', market: '市', gear: '器', festival: '節', flame: '亂', gold: '金' };
const STAT_KO = { lea: '통솔', str: '무력', int: '지력', pol: '정치', cha: '매력' };

export function createApp({ onTitle }) {
  const app = { S: null, map: null, sel: null, busy: false };
  const top = $('#top'), panel = $('#panel'), mapwrap = $('#mapwrap');
  let tip = null, legend = null;

  app.map = createMap($('#map'), {
    getState: () => app.S,
    onSelect: (id) => { audio.unlock(); if (app.picker) return app.picker(id); app.select(id); },
    onHover: (id, x, y) => {
      if (!id || !app.S) { tip?.remove(); tip = null; return; }
      const r = app.S.regions[id];
      const f = r.owner ? app.S.factions[r.owner] : null;
      if (!tip) { tip = h('div.maptip'); mapwrap.append(tip); }
      tip.textContent = `${regionBase(id).name} · ${f ? f.name : r.rebels ? '민란군' : '주인 없음'} · 병력 ${fmt(r.troops)} · 성곽 ${Math.round(r.def)}`;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    },
  });
  const ctl = h('div.mapctl', h('button', { 'aria-label': '확대', onclick: () => app.map.zoom(1.3) }, '+'), h('button', { 'aria-label': '축소', onclick: () => app.map.zoom(1 / 1.3) }, '−'), h('button', { 'aria-label': '전체 보기', onclick: () => app.map.fit() }, '◎'));
  mapwrap.append(ctl);

  // ── 시작·저장 ──
  app.start = (S, { intro } = {}) => {
    app.S = S;
    R.setState(S.rng || 1);
    app.sel = null;
    $('#app').hidden = false;
    app.map.fit();
    app.map.invalidateOwners();
    const cap = S.factions[S.player].capital;
    app.select(cap, false);
    app.map.focus(cap, window.innerWidth > 860 ? 1.7 : 2.2);
    app.refresh(true);
    if (intro) showIntro();
  };
  app.saveMeta = (i) => { try { return JSON.parse(store.get(`paldo.slot.${i}.meta`) || 'null'); } catch { return null; } };
  app.save = (i) => {
    syncRng(app.S);
    const S = app.S;
    const ok = store.set(`paldo.slot.${i}`, JSON.stringify(S));
    if (ok) store.set(`paldo.slot.${i}.meta`, JSON.stringify({ label: `${scenarioOf(S).name} · ${S.factions[S.player].name} · ${dateStr(S)}`, t: Date.now() }));
    return ok;
  };
  app.load = (i) => { const raw = store.get(`paldo.slot.${i}`); if (!raw) return false; return app.importSave(raw); };
  app.exportSave = () => { syncRng(app.S); return 'PALDO1:' + JSON.stringify(app.S); };
  app.importSave = (txt) => {
    try {
      const S = JSON.parse(txt.startsWith('PALDO1:') ? txt.slice(7) : txt);
      if (!S || S.version !== VERSION || !S.regions || !S.factions) return false;
      closeAllModals();
      app.start(S);
      toast(`${dateStr(S)}부터 이어 간다.`, 'good');
      return true;
    } catch { return false; }
  };
  app.toTitle = () => { closeAllModals(); app.S = null; onTitle(); };

  // ── 다시 그리기 ──
  app.refresh = (owners) => {
    if (!app.S) return;
    if (owners) app.map.invalidateOwners();
    renderTop();
    renderPanel();
    renderLegend();
    app.map.render();
  };
  app.select = (id, focus) => {
    app.sel = id;
    app.map.select(id);
    if (focus && id) app.map.focus(id);
    if (id) audio.play('click');
    panel.classList.remove('collapsed');
    renderPanel();
  };

  function renderTop() {
    const S = app.S, P = S.player, f = S.factions[P];
    const inc = factionIncome(S, P);
    const cur = f.research.cur ? TECH_BY_ID[f.research.cur] : null;
    const chip = (ic, color, val, d, title, onclick) => h('span.chip' + (onclick ? '.click' : ''), { title, onclick }, h('span.ic', { style: { background: color } }, ic), h('b', val), d != null ? h('span.d' + (d > 0 ? '.up' : d < 0 ? '.down' : ''), fmtSigned(d)) : null);
    const nextRice = factionIncome(S, P, (S.season + 1) % 4);
    clear(top).append(
      h('span.crest', { style: { background: f.color } }, f.crest),
      h('div', h('div.fname', f.name), h('div.fdate', dateStr(S))),
      h('div.res',
        chip('錢', '#a8842a', fmt(f.gold), Math.round(inc.netGold), `돈. 이번 철 수입 ${fmt(inc.gold)} − 녹봉·군비 ${fmt(inc.upGold)}${inc.trade ? ` (교역 ${fmt(inc.trade)})` : ''}`),
        chip('米', '#5a7a2a', fmt(f.rice), Math.round(inc.netRice), `쌀. 이번 철 수확 ${fmt(inc.rice)} − 군량 ${fmt(inc.upRice)}. 가을에 많이 거둔다.`),
        chip('學', '#2f4a7c', cur ? `${cur.name} ${Math.round((f.research.prog / Math.max(1, techCostOf(S, P, cur))) * 100)}%` : '연구 없음', null, `연구 +${Math.round(inc.sci)}/철`, () => techScreen(app)),
        chip('名', '#7b3f7a', fmt(f.prestige), Math.round(inc.pres), '명망. 법령을 바꾸고 인재를 부른다.', () => politicsScreen(app)),
        chip('統', '#a8322a', Math.round(f.legit), null, '정통성', () => politicsScreen(app)),
        chip('兵', '#3a3530', fmt(inc.troops), null, `총병력 · 고을 ${regionsOf(S, P).length}곳 · 장수 ${officersOf(S, P).length}명`, () => factionScreen(app)),
      ),
      h('nav.nav',
        navBtn('形', '형세', () => factionScreen(app)), navBtn('人', '인물', () => officerScreen(app)), navBtn('文', '문물', () => techScreen(app)),
        navBtn('政', '정치', () => politicsScreen(app)), navBtn('交', '외교', () => diplomacyScreen(app)), navBtn('錄', '실록', () => chronicleScreen(app)), navBtn('☰', '', () => menuScreen(app))),
      h('button.endturn', { disabled: app.busy || !!S.over || null, onclick: () => endTurnFlow(), title: 'Enter' }, S.over ? '끝' : '철 넘기기 ▸'),
    );
  }
  const navBtn = (hz, label, fn) => h('button.nbtn', { onclick: () => { audio.unlock(); audio.play('click'); fn(); } }, h('b', hz), label);
  const techCostOf = (S, P, t) => Math.round(t.cost * 3.6 * (1 + Object.keys(S.factions[P].techs).length * 0.025));

  function renderLegend() {
    const S = app.S;
    if (!legend) { legend = h('div.legend'); mapwrap.append(legend); }
    clear(legend).append(...aliveFactions(S).map((f) => h('span', h('i', { style: { background: f.color } }), f.name)), h('span', h('i', { style: { background: '#d9d2c0', border: '1px solid #aaa' } }), '주인 없음'));
  }

  // ── 고을 판 ──
  function renderPanel() {
    const S = app.S;
    if (!S) return;
    clear(panel);
    const id = app.sel;
    if (!id) { panel.classList.add('empty'); panel.append(overview()); if (window.innerWidth > 860) panel.classList.remove('empty'); return; }
    panel.classList.remove('empty');
    const r = S.regions[id], base = REGION_BY_ID[id];
    const P = S.player;
    const f = r.owner ? S.factions[r.owner] : null;
    const mine = r.owner === P;
    const head = h('div.ph', { onclick: (e) => { if (window.innerWidth <= 860 && e.target.closest('.ph') && !e.target.closest('button,select,input,label')) panel.classList.toggle('collapsed'); } },
      h('div.grip'),
      h('h2', base.name, h('small', base.hanja), h('span.owner', h('i', { style: { background: f ? f.color : '#8a8274' } }, f ? f.crest : r.rebels ? '亂' : '無'), f ? f.name : r.rebels ? '민란군' : '주인 없음'),
        f && f.capital === id ? h('span.badge.y', '도읍') : null),
      h('div.row', { style: { fontSize: '12px', color: 'var(--ink-3)', marginTop: '2px' } }, `${PROVINCES[base.prov].name}도 · ${({ plain: '평야', river: '강', mountain: '산지', coast: '해안', island: '섬' })[base.terrain]}`, base.trade ? h('span.tag.res', { port: '제물포', port2: '원산포', wae: '왜관', chaek: '책문', buk: '북관 개시' }[base.trade]) : null),
    );
    panel.append(head);
    const body = h('div.pb');
    panel.append(body);
    body.append(h('p.rdesc', base.desc));
    const c = caps(S, r);
    const st = (k, v, max, color, capv) => h('div.stat', h('span.k', k), bar(v, max, color, capv), h('span.v', Math.round(v)));
    const statGrid = h('div.stats',
      h('div.stat', h('span.k', '인구'), h('span', fmt(r.pop * 1000) + '명'), h('span')),
      h('div.stat', h('span.k', '병력'), h('b', fmt(r.troops)), h('span')),
      st('농업', r.agri, Math.max(c.agri, 1), '#5a7a2a'), st('상업', r.comm, Math.max(c.comm, 1), '#a8842a'),
      st('성곽', r.def, Math.max(c.def, 1), '#4a453d'), st('민심', r.loyalty, 100, r.loyalty < 30 ? '#a8322a' : '#7b3f7a'),
      st('훈련', r.training, 100, '#2f4a7c'),
    );
    body.append(statGrid);
    if (mine) body.append(...ownRegionBlocks(S, r, base));
    else body.append(...foreignRegionBlocks(S, r, base));
    if (window.innerWidth <= 860) panel.scrollTop = 0;
  }

  function overview() {
    const S = app.S, P = S.player;
    const wrap = h('div.pb');
    wrap.append(h('div.ph', h('h2', '우리 고을')), h('p.rdesc', '고을을 누르면 장수에게 명령을 내릴 수 있다.'));
    const list = h('div.olist');
    for (const r of regionsOf(S, P).sort((a, b) => b.pop - a.pop)) {
      const idle = officersIn(S, r.id, P).filter((o) => !o.acted).length;
      list.append(h('button.ocard', { onclick: () => app.select(r.id, true), style: { gridTemplateColumns: '1fr auto' } },
        h('div', h('div.n', regionBase(r.id).name, h('small', `병력 ${fmt(r.troops)} · 민심 ${Math.round(r.loyalty)}`)), h('div.s', `장수 ${officersIn(S, r.id, P).length} (남은 ${idle}) ${r.delegate ? '· 위임' : ''}`)),
        idle ? h('span.badge.r', idle) : h('span.badge', '완료')));
    }
    wrap.append(list);
    return wrap;
  }

  function ownRegionBlocks(S, r, base) {
    const P = S.player, f = S.factions[P];
    const out = [];
    const y = regionYield(S, r);
    out.push(h('div.row', { style: { fontSize: '12.5px' } }, h('span.tag', `錢 +${fmt(y.gold)}`), h('span.tag', `米 +${fmt(y.rice)} (${SEASONS[S.season]})`), h('span.tag', `學 +${y.sci.toFixed(1)}`),
      ...base.res.map((x) => h('span.tag.res', { title: RESOURCES[x]?.desc }, `${RESOURCES[x]?.icon || ''} ${x}`))));
    // 위임·방침
    out.push(h('div.box', h('h3', '위임과 방침', h('label.switch', h('input', { type: 'checkbox', checked: r.delegate || null, onchange: (e) => { r.delegate = e.target.checked; renderPanel(); } }), '위임')),
      h('div.seg', Object.entries(POLICIES).map(([k, p]) => h('button', { class: r.policy === k ? 'on' : '', title: p.desc, onclick: () => { r.policy = k; renderPanel(); } }, p.name))),
      h('div', { style: { fontSize: '11.5px', color: 'var(--ink-3)', marginTop: '5px' } }, r.delegate ? '철을 넘길 때 움직이지 않은 장수가 방침대로 일한다.' : '위임을 끄면 직접 명령한 장수만 일한다.')));
    // 장수
    const offs = officersIn(S, r.id, P).sort((a, b) => (a.acted - b.acted) || statSum(b) - statSum(a));
    const idle = offs.filter((o) => !o.acted && o.injured <= 0);
    const obox = h('div.box', h('h3', `장수 ${offs.length}명`, idle.length ? h('span', { style: { color: 'var(--seal)' } }, `움직일 수 있는 장수 ${idle.length}`) : h('span', '모두 움직였다')));
    const list = h('div.olist');
    for (const o of offs) list.append(officerCard(S, o, () => actionDialog(o)));
    if (!offs.length) list.append(h('div', { style: { fontSize: '13px', color: 'var(--ink-3)' } }, '이 고을에는 장수가 없다. 이웃 고을에서 「이동」시키자.'));
    obox.append(list);
    if (idle.length >= 2) obox.append(h('div.row', { style: { marginTop: '8px' } }, h('span', { style: { fontSize: '12px' } }, '남은 장수 모두:'),
      ...['agri', 'comm', 'fort', 'relief', 'train', 'study', 'recruit'].map((a) => h('button.btn.small', { onclick: () => bulk(r.id, a) }, ACTIONS[a].name))));
    out.push(obox);
    // 출진
    const targets = adjOf(r.id).filter((t) => canAttack(S, P, t));
    out.push(h('div.row',
      h('button.btn.red', { disabled: !targets.length || !idle.length || r.troops < 500 || null, onclick: () => pickTarget(r.id, targets), title: !targets.length ? '칠 수 있는 이웃이 없다' : '' }, '⚔ 출진'),
      S.scenario === 'imjin' && P === 'joseon' && base.coastal && ['jeolla', 'gyeongsang'].includes(base.prov) ? h('button.btn', { disabled: !idle.length || null, onclick: () => navalDialog(r) }, '⚓ 해전') : null,
      h('button.btn', { onclick: () => { app.map.setTargets(adjOf(r.id), 'move'); setTimeout(() => app.map.setTargets(null), 1600); } }, '이웃 보기')));
    // 재야
    const free = freeIn(S, r.id, true);
    if (free.length) {
      const fb = h('div.box', h('h3', '이 고을의 재야 인물'));
      for (const t of free) {
        const by = idleBest(S, r.id, 'cha');
        const ch = by ? hireChance(S, by, t) : 0;
        fb.append(h('div.row', { style: { justifyContent: 'space-between' } }, h('span', h('b', { style: { cursor: 'pointer' }, onclick: () => bioDialog(app, t) }, t.name), ' ', h('span', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, statLine(t))),
          h('button.btn.small', { disabled: !by || null, onclick: () => runAction(by, 'hire', { target: t.id }) }, by ? `${josa(by.name, '이/가')} 등용 ${Math.round(ch * 100)}%` : '움직일 장수 없음')));
      }
      out.push(fb);
    }
    // 건물
    const bb = h('div.box', h('h3', `건물 ${r.buildings.length}/${regionSlots(r)}`, r.build ? h('span', { style: { color: 'var(--warn)' } }, `${BUILDINGS[r.build.id].name} 공사 중 · ${r.build.left}철`) : null),
      h('div.tags', r.buildings.length ? r.buildings.map((b) => h('span.tag.b', { title: BUILDINGS[b].desc }, BUILDINGS[b].name)) : h('span', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, '아직 없다. 장수에게 「건설」을 시키자.')));
    if (f.wonder?.region === r.id) bb.append(h('div', { style: { marginTop: '6px', fontSize: '13px' } }, `위업 「${WONDERS[f.wonder.id].name}」 공사 중 · ${f.wonder.left}철 남음`));
    for (const w in S.wonders) if (S.wonders[w].region === r.id) bb.append(h('div', { style: { marginTop: '6px' } }, h('span.badge.y', '위업'), ' ', WONDERS[w].name));
    out.push(bb);
    return out;
  }

  function foreignRegionBlocks(S, r, base) {
    const P = S.player;
    const out = [];
    const f = r.owner ? S.factions[r.owner] : null;
    if (base.res.length) out.push(h('div.tags', base.res.map((x) => h('span.tag.res', { title: RESOURCES[x]?.desc }, `${RESOURCES[x]?.icon || ''} ${x}`))));
    if (f) {
      const t = treaty(S, P, f.id);
      out.push(h('div.row', { style: { fontSize: '13px' } }, `우호 ${Math.round(relation(S, P, f.id))}`, t ? h('span.badge.' + (t.type === 'alliance' ? 'g' : 'y'), t.type === 'alliance' ? '동맹' : '휴전') : null));
      const offs = officersIn(S, r.id, f.id).sort((a, b) => statSum(b) - statSum(a));
      const ob = h('div.box', h('h3', `${f.name}의 장수 ${offs.length}명`));
      const list = h('div.olist');
      for (const o of offs) list.append(officerCard(S, o, () => bioDialog(app, o), true));
      if (!offs.length) list.append(h('div', { style: { fontSize: '13px', color: 'var(--ink-3)' } }, '장수가 없다. 수비대만 지킨다.'));
      ob.append(list);
      out.push(ob);
    } else {
      out.push(h('div.box', h('p', { style: { margin: 0, fontSize: '13px' } }, r.rebels ? '민란군이 관아를 차지하고 있다. 치면 되찾을 수 있다.' : '어느 세력에도 속하지 않은 고을. 토호의 수비대가 지킨다. 쳐서 차지하자.')));
    }
    const from = adjOf(r.id).filter((n) => S.regions[n].owner === P && officersIn(S, n, P).some((o) => !o.acted && o.injured <= 0) && S.regions[n].troops >= 500);
    const can = canAttack(S, P, r.id);
    out.push(h('div.row',
      h('button.btn.red', { disabled: !from.length || !can || null, onclick: () => attackDialog(r.id, from[0]), title: !can ? '맹약을 맺은 세력' : !from.length ? '맞닿은 우리 고을에 움직일 장수와 병력이 있어야 한다' : '' }, '⚔ 이 고을을 친다'),
      f ? h('button.btn', { onclick: () => schemeDialog(r.id) }, '계략') : null,
      f ? h('button.btn', { onclick: () => diplomacyScreen(app) }, '외교') : null));
    if (!from.length && can) out.push(h('div', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, '이 고을과 맞닿은 우리 고을에서 출진할 수 있다.'));
    return out;
  }

  function officerCard(S, o, onclick, foreign) {
    const e = eff(o);
    const tags = [];
    if (isRuler(S, o)) tags.push(h('span.badge.r', '군주'));
    if (o.ally) tags.push(h('span.badge.y', '원군'));
    if (o.injured > 0) tags.push(h('span.badge', '부상'));
    if (o.item) tags.push(h('span.badge.m', ITEMS[o.item].name));
    return h('button.ocard' + (o.acted && !foreign ? '.done' : ''), { onclick },
      h('img', { src: portrait(o, 44), alt: '' }),
      h('div', h('div.n', o.name, h('small', o.traits.join('·')), ...tags),
        h('div.s', ...['lea', 'str', 'int', 'pol', 'cha'].map((k) => [STAT_KO[k][0], h('b', e[k]), ' ']))),
      h('div.st', foreign ? '' : o.acted ? '완료' : o.injured > 0 ? `부상 ${o.injured}` : '대기', h('br'), foreign || isRuler(S, o) || o.ally ? '' : h('span', { class: o.loyalty < 40 ? 'lo' : '' }, `충 ${Math.round(o.loyalty)}`)));
  }
  const idleBest = (S, rid, stat) => officersIn(S, rid, S.player).filter((o) => !o.acted && o.injured <= 0 && !o.ally).sort((a, b) => eff(b)[stat] - eff(a)[stat])[0];

  // ── 명령 ──
  function preview(S, o, a) {
    const e = eff(o);
    const r = S.regions[o.loc];
    const c = caps(S, r);
    switch (a) {
      case 'agri': return `농업 +${Math.round(Math.min(c.agri - r.agri, (6 + e.pol * 0.22) * (hasTrait(o, '내정') ? 1.3 : 1)))}`;
      case 'comm': return `상업 +${Math.round(Math.min(c.comm - r.comm, (6 + e.pol * 0.22) * (hasTrait(o, '상재') ? 1.4 : hasTrait(o, '내정') ? 1.3 : 1)))}`;
      case 'fort': return `성곽 +${Math.round(Math.min(c.def - r.def, (6 + e.lea * 0.18) * (hasTrait(o, '축성') ? 1.5 : 1) * (1 + mod(S, o.faction, 'fort'))))}`;
      case 'relief': return `민심 +${Math.round((3 + e.cha * 0.07) * (hasTrait(o, '인덕') ? 1.5 : 1))}`;
      case 'study': return `연구 +${Math.round(e.int * 0.22 * (hasTrait(o, '학문') ? 1.5 : 1) * (hasTrait(o, '발명') ? 1.3 : 1))}`;
      case 'recruit': return `병사 +${fmt(recruitAmount(S, o))}`;
      case 'train': return `훈련 +${Math.round(3 + e.lea * 0.07)}`;
      default: return '';
    }
  }
  function costText(c) { const t = []; if (c.gold) t.push(`錢 ${fmt(c.gold)}`); if (c.rice) t.push(`米 ${fmt(c.rice)}`); return t.join(' · '); }

  function actionDialog(o) {
    const S = app.S;
    const e = eff(o);
    const m = modal({ title: `${o.name}에게 명령`, wide: true });
    const head = h('div', { style: { display: 'grid', gridTemplateColumns: '64px 1fr', gap: '10px', marginBottom: '6px' } },
      h('img', { src: portrait(o, 64), style: { width: '64px', height: '76px', borderRadius: '5px', cursor: 'pointer' }, onclick: () => bioDialog(app, o) }),
      h('div', h('div.row', h('b', { style: { fontSize: '17px' } }, o.name), isRuler(S, o) ? h('span.badge.r', '군주') : null, o.ally ? h('span.badge.y', '원군') : null, h('span', { style: { fontSize: '12.5px', color: 'var(--ink-3)' } }, `${regionBase(o.loc).name} · 충성 ${Math.round(o.loyalty)}`)),
        h('div', { style: { fontSize: '13px' } }, statLine(o)), h('div', { style: { fontSize: '12px', color: 'var(--ink-2)' } }, o.traits.map((t) => t).join(' · ') || '특기 없음')));
    const groups = {};
    for (const [a, A] of Object.entries(ACTIONS)) {
      if (a === 'naval' && !(S.scenario === 'imjin' && o.faction === 'joseon')) continue;
      (groups[A.group] ||= []).push(a);
    }
    const body = [head];
    for (const g in groups) {
      body.push(h('div.grp', g));
      const grid = h('div.acts');
      for (const a of groups[g]) {
        const A = ACTIONS[a];
        const needsParam = ['move', 'transport', 'hire', 'scheme', 'envoy', 'build', 'wonder', 'naval'].includes(a);
        const why = canAct(S, o, a, {});
        const cost = actionCost(S, o, a);
        const pv = preview(S, o, a);
        grid.append(h('button.act', { disabled: !!why || null, title: A.desc, onclick: () => { m.close(); if (needsParam) paramDialog(o, a); else runAction(o, a); } },
          h('span.t', A.name, h('small', A.hanja)),
          h('span.c', [pv, costText(cost)].filter(Boolean).join(' · ') || A.desc.split('.')[0]),
          why ? h('span.why', why) : null));
      }
      body.push(grid);
    }
    m.setBody(...body);
  }

  function runAction(o, a, p = {}) {
    const S = app.S;
    const res = doAction(S, o, a, p);
    if (!res.ok) { toast(res.msg, 'bad'); audio.play('bad'); return res; }
    if (res.battle) { battleFlow(res.battle); return res; }
    if (res.envoy) { return res; }
    audio.play('pluck');
    if (res.msg) toast(`${o.name}: ${res.msg}`, /찾|등용|성공|모았|뜻|넘어왔/.test(res.msg) ? 'good' : 'info');
    app.refresh(a === 'scheme');
    return res;
  }
  function bulk(rid, a) {
    const S = app.S;
    const offs = officersIn(S, rid, S.player).filter((o) => !o.acted && o.injured <= 0);
    let n = 0, last = '';
    for (const o of offs) { const res = doAction(S, o, a); if (res.ok) { n++; last = res.msg; } }
    toast(n ? `${n}명이 ${ACTIONS[a].name}했다. ${last}` : `${ACTIONS[a].name}할 수 있는 장수가 없다.`, n ? 'info' : 'bad');
    audio.play(n ? 'pluck' : 'bad');
    app.refresh();
  }

  function paramDialog(o, a) {
    const S = app.S, P = S.player;
    const r = S.regions[o.loc];
    const A = ACTIONS[a];
    const m = modal({ title: `${o.name} — ${A.name}`, wide: a === 'build' || a === 'wonder' || a === 'hire', onClose: () => app.map.setTargets(null) });
    if (a === 'move' || a === 'transport') {
      const dests = Object.keys(S.regions).filter((id) => movable(S, o.loc, id, P));
      let dest = dests[0] || null;
      let troops = a === 'transport' ? Math.round(r.troops * 0.5 / 100) * 100 : 0;
      const render = () => {
        const sl = h('input', { type: 'range', min: a === 'transport' ? 100 : 0, max: Math.max(0, r.troops), step: 100, value: troops, oninput: (e) => { troops = +e.target.value; lab.textContent = `병력 ${fmt(troops)} / ${fmt(r.troops)}`; } });
        const lab = h('div', `병력 ${fmt(troops)} / ${fmt(r.troops)}`);
        m.setBody(h('p', { style: { margin: '0 0 8px' } }, A.desc),
          dests.length ? h('div.row', dests.map((id) => h('button.btn' + (dest === id ? '.primary' : ''), { onclick: () => { dest = id; render(); } }, `${regionBase(id).name} (병력 ${fmt(S.regions[id].troops)})`))) : h('p', '갈 수 있는 자기 고을이 없다.'),
          h('div', { style: { marginTop: '10px' } }, lab, sl));
        m.setFoot(h('button.btn', { onclick: () => m.close() }, '그만둔다'), h('button.btn.primary', { disabled: !dest || (a === 'transport' && troops <= 0) || null, onclick: () => { m.close(); runAction(o, a, { to: dest, troops }); } }, A.name));
      };
      app.map.setTargets(dests, 'move');
      render();
      return;
    }
    if (a === 'hire') {
      const own = new Set(regionsOf(S, P).map((x) => x.id));
      const free = Object.values(S.officers).filter((t) => t.status === 'free' && t.found && own.has(t.loc));
      const enemies = Object.values(S.officers).filter((t) => t.status === 'active' && t.faction !== P && !isRuler(S, t) && !t.ally).map((t) => ({ t, ch: hireChance(S, o, t) })).filter((x) => x.ch > 0.02).sort((x, y) => y.ch - x.ch).slice(0, 12);
      const row = (t, ch, label) => h('div.row', { style: { justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dotted var(--line)' } },
        h('div.row', h('img', { src: portrait(t, 32), style: { width: '32px', height: '38px', borderRadius: '3px' } }), h('div', h('b', t.name), ' ', h('span', { style: { fontSize: '12px', color: 'var(--ink-3)' } }, `${label} · ${statLine(t)}`))),
        h('button.btn.small.primary', { onclick: () => { m.close(); runAction(o, 'hire', { target: t.id }); } }, `등용 ${Math.round(ch * 100)}%`));
      m.setBody(h('div.grp', '재야 인물(우리 고을)'), free.length ? free.map((t) => row(t, hireChance(S, o, t), regionBase(t.loc).name)) : h('p', { style: { fontSize: '13px' } }, '찾아 둔 재야 인물이 없다. 「탐색」을 먼저 하자.'),
        h('div.grp', '적 장수 빼 오기(충성이 낮을수록 쉽다)'), enemies.length ? enemies.map(({ t, ch }) => row(t, ch, `${S.factions[t.faction].name} · 충성 ${Math.round(t.loyalty)}`)) : h('p', { style: { fontSize: '13px' } }, '넘어올 만한 적 장수가 없다.'));
      return;
    }
    if (a === 'scheme') {
      let type = 'rumor';
      const render = () => {
        const tabs = h('div.seg', [['rumor', '유언비어'], ['discord', '이간'], ['incite', '선동']].map(([k, l]) => h('button', { class: type === k ? 'on' : '', onclick: () => { type = k; render(); } }, l)));
        const list = h('div');
        if (type === 'discord') {
          const ts = Object.values(S.officers).filter((t) => t.status === 'active' && t.faction !== P && !isRuler(S, t)).sort((x, y) => x.loyalty - y.loyalty).slice(0, 14);
          for (const t of ts) list.append(h('div.row', { style: { justifyContent: 'space-between', padding: '3px 0' } }, h('span', h('b', t.name), ` (${S.factions[t.faction].name}) 충성 ${Math.round(t.loyalty)}`), h('button.btn.small', { onclick: () => { m.close(); runAction(o, 'scheme', { type, target: t.id }); } }, `${Math.round(schemeChance(S, o, { type, target: t.id }) * 100)}%`)));
        } else {
          const own = new Set(regionsOf(S, P).map((x) => x.id));
          const ts = Object.values(S.regions).filter((x) => x.owner && x.owner !== P && adjOf(x.id).some((n) => own.has(n)) && (type !== 'incite' || x.loyalty < 40));
          for (const t of ts) list.append(h('div.row', { style: { justifyContent: 'space-between', padding: '3px 0' } }, h('span', h('b', regionBase(t.id).name), ` (${S.factions[t.owner].name}) 민심 ${Math.round(t.loyalty)}`), h('button.btn.small', { onclick: () => { m.close(); runAction(o, 'scheme', { type, target: t.id }); } }, `${Math.round(schemeChance(S, o, { type, target: t.id }) * 100)}%`)));
          if (!ts.length) list.append(h('p', { style: { fontSize: '13px' } }, type === 'incite' ? '민심 40 미만인 맞닿은 적 고을이 없다.' : '맞닿은 적 고을이 없다.'));
        }
        m.setBody(h('p', { style: { margin: '0 0 8px', fontSize: '13px' } }, { rumor: '적 고을에 헛소문을 퍼뜨려 민심을 깎는다.', discord: '적 장수와 군주 사이를 벌려 충성을 깎는다. 충성이 낮은 장수는 넘어오거나 떠난다.', incite: '민심이 낮은 적 고을에서 민란을 일으켜 주인 없는 땅으로 만든다.' }[type] + ` (錢 60)`), tabs, h('div', { style: { marginTop: '8px' } }, list));
      };
      render();
      return;
    }
    if (a === 'envoy') { m.close(); diplomacyScreen(app); return; }
    if (a === 'build') {
      const grid = h('div.acts');
      for (const [id, B] of Object.entries(BUILDINGS)) {
        const why = canAct(S, o, 'build', { id });
        if (why && /필요$/.test(why) && !BUILDINGS[id].req) continue;
        grid.append(h('button.act', { disabled: !!why || null, onclick: () => { m.close(); runAction(o, 'build', { id }); } }, h('span.t', B.name, h('small', B.hanja)), h('span.c', `錢 ${fmt(buildCost(S, P, B.cost))} · ${B.turns}철`), h('span.c', B.desc), why ? h('span.why', why) : null));
      }
      m.setBody(h('p', { style: { margin: '0 0 8px', fontSize: '13px' } }, `빈 터 ${regionSlots(r) - r.buildings.length} · 한 고을에 한 번에 하나씩 짓는다.`), grid);
      return;
    }
    if (a === 'wonder') {
      const grid = h('div.acts');
      for (const [id, W] of Object.entries(WONDERS)) {
        const why = canAct(S, o, 'wonder', { id });
        const owner = S.wonders[id] ? S.factions[S.wonders[id].owner].name : null;
        grid.append(h('button.act', { disabled: !!why || null, onclick: () => { m.close(); runAction(o, 'wonder', { id }); } }, h('span.t', W.name, h('small', W.hanja)), h('span.c', `錢 ${fmt(buildCost(S, P, W.cost))} · ${W.turns}철`), h('span.c', W.desc), owner ? h('span.why', `${owner} 세력이 세웠다`) : why ? h('span.why', why) : null));
      }
      m.setBody(h('p', { style: { margin: '0 0 8px', fontSize: '13px' } }, '위업은 천하에 하나뿐이다. 다른 세력이 먼저 끝내면 공사비 절반만 돌려받는다.'), grid);
      return;
    }
    if (a === 'naval') { m.close(); navalDialog(r, o); }
  }

  function navalDialog(r, admiral) {
    const S = app.S, P = S.player;
    const adm = admiral || officersIn(S, r.id, P).filter((o) => !o.acted && o.injured <= 0).sort((a, b) => (hasTrait(b, '수군') - hasTrait(a, '수군')) || eff(b).lea - eff(a).lea)[0];
    if (!adm) return toast('나설 장수가 없다.', 'bad');
    let troops = Math.round(r.troops * 0.6 / 100) * 100;
    const m = modal({ title: '해전 — 왜 수군을 친다' });
    const est = h('div');
    const calc = () => { const s = simulateAttack(S, { fid: P, from: r.id, to: r.id, officers: [adm.id], troops, naval: true }, 12); est.textContent = `예상 승률 ${Math.round(s.win * 100)}% · 왜 수군 ${fmt(S.scn.waeNavy)} · 지금 제해권 ${Math.round(S.scn.sea)}`; };
    const lab = h('div', `수군 ${fmt(troops)}`);
    m.setBody(h('p', `${josa(adm.name, '이/가')} 판옥선을 이끌고 나간다. 이기면 제해권이 오르고, 제해권이 높을수록 왜군의 증원과 군량이 끊긴다.`), lab,
      h('input', { type: 'range', min: 2000, max: r.troops, step: 100, value: troops, oninput: (e) => { troops = +e.target.value; lab.textContent = `수군 ${fmt(troops)}`; calc(); } }), est);
    calc();
    m.setFoot(h('button.btn', { onclick: () => m.close() }, '그만둔다'), h('button.btn.red', { disabled: r.troops < 2000 || null, onclick: () => { m.close(); runAction(adm, 'naval', { troops }); } }, '출격'));
  }

  // ── 출진 ──
  function pickTarget(from, targets) {
    if (targets.length === 1) return attackDialog(targets[0], from);
    app.map.setTargets(targets, 'attack');
    const bar = h('div.modebar', '칠 고을을 지도에서 고르라', h('button', { onclick: () => done(null) }, '취소'));
    mapwrap.append(bar);
    const m = modal({ title: '어디를 칠까', body: h('div.row', targets.map((t) => h('button.btn', { onclick: () => done(t) }, `${regionBase(t).name} (${app.S.regions[t].owner ? app.S.factions[app.S.regions[t].owner].name : '무주'} · ${fmt(app.S.regions[t].troops)})`))), onClose: () => done(null, true) });
    function done(t, fromClose) {
      app.picker = null; app.map.setTargets(null); bar.remove();
      if (!fromClose) m.close();
      if (t) attackDialog(t, from);
    }
    app.picker = (id) => { if (targets.includes(id)) done(id); };
  }
  function attackDialog(to, from0) {
    const S = app.S, P = S.player;
    const tr = S.regions[to];
    const sources = adjOf(to).filter((n) => S.regions[n].owner === P && S.regions[n].troops >= 500 && officersIn(S, n, P).some((o) => !o.acted && o.injured <= 0));
    if (!sources.length) return toast('맞닿은 우리 고을에 움직일 장수와 병력이 없다.', 'bad');
    let from = sources.includes(from0) ? from0 : sources[0];
    let picked = [], troops = 0;
    const reset = () => {
      const fr = S.regions[from];
      const offs = officersIn(S, from, P).filter((o) => !o.acted && o.injured <= 0).sort((a, b) => eff(b).lea + eff(b).str - (eff(a).lea + eff(a).str));
      picked = offs.slice(0, 3).map((o) => o.id);
      troops = Math.round(fr.troops * 0.8 / 100) * 100;
    };
    reset();
    const m = modal({ title: `${regionBase(to).name} 출진`, wide: true });
    let timer = null;
    const est = h('div.box');
    const calc = () => {
      clearTimeout(timer);
      est.textContent = '모의 전투 중…';
      timer = setTimeout(() => {
        if (!picked.length || troops < 500) { est.textContent = '장수와 병력을 정하라.'; return; }
        const s = simulateAttack(S, { fid: P, from, to, officers: picked, troops }, 16);
        const p = Math.round(s.win * 100);
        clear(est).append(h('h3', '모의 전투 16번', h('span', { style: { color: p >= 60 ? 'var(--good)' : p >= 35 ? 'var(--warn)' : 'var(--bad)', fontSize: '16px' } }, `예상 승률 ${p}%`)), bar(p, 100, p >= 60 ? '#3f6b3a' : p >= 35 ? '#a8652a' : '#a8322a'),
          h('div', { style: { fontSize: '12.5px', marginTop: '4px' } }, `예상 손실: 아군 ${fmt(s.atkLoss)} · 적 ${fmt(s.defLoss)} (실제 전투에서는 작전에 따라 달라진다)`));
      }, 120);
    };
    const render = () => {
      const fr = S.regions[from];
      const offs = officersIn(S, from, P).filter((o) => !o.acted && o.injured <= 0).sort((a, b) => eff(b).lea + eff(b).str - (eff(a).lea + eff(a).str));
      const defOffs = tr.owner ? officersIn(S, to, tr.owner) : [];
      const why = canStartAttack(S, P, from, to, picked, troops);
      const lab = h('b', fmt(troops));
      m.setBody(
        sources.length > 1 ? h('div.row', { style: { marginBottom: '8px' } }, '어디서:', sources.map((s) => h('button.btn.small' + (s === from ? '.primary' : ''), { onclick: () => { from = s; reset(); render(); } }, `${regionBase(s).name} (${fmt(S.regions[s].troops)})`))) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' } },
          h('div.box', h('h3', `우리 군 — ${regionBase(from).name}`, h('span', `${picked.length}/5명`)),
            h('div.olist', offs.map((o) => h('label.ocard', { style: { cursor: 'pointer', gridTemplateColumns: 'auto 40px 1fr' } },
              h('input', { type: 'checkbox', checked: picked.includes(o.id) || null, onchange: (e) => { if (e.target.checked) { if (picked.length >= 5) { e.target.checked = false; return toast('장수는 다섯까지', 'bad'); } picked.push(o.id); } else picked = picked.filter((x) => x !== o.id); render(); } }),
              h('img', { src: portrait(o, 40), style: { width: '40px', height: '47px' } }),
              h('div', h('div.n', o.name, h('small', o.traits.join('·'))), h('div.s', statLine(o)))))),
            h('div', { style: { marginTop: '8px' } }, '병력 ', lab, ` / ${fmt(fr.troops)} · 훈련 ${Math.round(fr.training)} · 군량 米 ${fmt(troops * 0.1)}`),
            h('input', { type: 'range', min: 500, max: fr.troops, step: 100, value: troops, oninput: (e) => { troops = +e.target.value; lab.textContent = fmt(troops); calc(); }, onchange: () => render() })),
          h('div.box', h('h3', `적 — ${regionBase(to).name}`, h('span', tr.owner ? S.factions[tr.owner].name : tr.rebels ? '민란군' : '토호')),
            h('div', `병력 ${fmt(tr.troops)} · 성곽 ${Math.round(tr.def)} · 훈련 ${Math.round(tr.training)}`),
            h('div', { style: { fontSize: '12.5px', color: 'var(--ink-2)' } }, `지형 ${({ plain: '평야', river: '강(수공·도하)', mountain: '산지(매복 유리, 돌격 불리)', coast: '해안', island: '섬' })[REGION_BY_ID[to].terrain]}`),
            h('div.olist', { style: { marginTop: '6px' } }, defOffs.length ? defOffs.slice(0, 5).map((o) => h('div.ocard', { style: { gridTemplateColumns: '40px 1fr' } }, h('img', { src: portrait(o, 40), style: { width: '40px', height: '47px' } }), h('div', h('div.n', o.name, h('small', o.traits.join('·'))), h('div.s', statLine(o))))) : h('div', { style: { fontSize: '12.5px' } }, '장수 없음 — 수비대장이 지휘한다.'))),
        ),
        h('div', { style: { marginTop: '10px' } }, est),
        leftWarn(),
        why ? h('div', { style: { color: 'var(--bad)', fontSize: '13px', marginTop: '6px' } }, why) : null);
      m.setFoot(h('button.btn', { onclick: () => m.close() }, '그만둔다'), h('button.btn.red', { disabled: !!why || null, onclick: () => go() }, '⚔ 출진'));
      calc();
    };
    function leftWarn() {
      const left = S.regions[from].troops - troops;
      const foes = adjOf(from).filter((n) => n !== to && S.regions[n].owner && S.regions[n].owner !== P && !treaty(S, P, S.regions[n].owner));
      if (!foes.length) return null;
      const big = foes.map((n) => S.regions[n]).sort((a, b) => b.troops - a.troops)[0];
      if (big.troops <= left * 1.2) return null;
      return h('div', { style: { color: 'var(--warn)', fontSize: '13px', marginTop: '6px' } }, `⚠ 출진하면 ${regionBase(from).name}에 ${fmt(left)}만 남는다. 이웃 ${S.factions[big.owner].name}의 ${regionBase(big.id).name}에는 ${josa(fmt(big.troops), '이/가')} 있다.`);
    }
    const go = async () => {
      m.close();
      const res = startAttack(S, P, from, to, picked, troops);
      if (!res.ok) return toast(res.msg, 'bad');
      app.map.arrow(from, to, S.factions[P].color);
      await sleep(500);
      battleFlow(res.battle);
    };
    render();
  }
  async function battleFlow(B) {
    app.busy = true; renderTop();
    try { await fightBattle(app.S, B, hooks); } finally { app.busy = false; }
    app.refresh(true);
    checkOver();
  }

  function schemeDialog(rid) {
    const S = app.S, P = S.player;
    const cands = officersOf(S, P).filter((o) => !o.acted && o.injured <= 0 && !o.ally).sort((a, b) => eff(b).int - eff(a).int).slice(0, 8);
    if (!cands.length) return toast('움직일 장수가 없다.', 'bad');
    const r = S.regions[rid];
    const m = modal({ title: `${regionBase(rid).name}에 계략` });
    const rows = [];
    for (const o of cands) {
      for (const type of ['rumor', 'incite']) {
        const why = canAct(S, o, 'scheme', { type, target: rid });
        if (why && type === 'incite') continue;
        rows.push(h('div.row', { style: { justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px dotted var(--line)' } }, h('span', h('b', o.name), ` 지력 ${eff(o).int} · ${type === 'rumor' ? '유언비어' : '선동(민란)'}`),
          h('button.btn.small', { disabled: !!why || null, title: why || '', onclick: () => { m.close(); runAction(o, 'scheme', { type, target: rid }); } }, why ? why : `${Math.round(schemeChance(S, o, { type, target: rid }) * 100)}% · 錢 60`)));
      }
    }
    m.setBody(h('p', { style: { margin: '0 0 6px', fontSize: '13px' } }, `민심 ${Math.round(r.loyalty)} — 40 미만이면 선동으로 민란을 일으킬 수 있다.`), ...rows);
  }

  // ── 시작 안내 ──
  function showIntro() {
    const S = app.S, sc = scenarioOf(S), f = S.factions[S.player];
    const ruler = S.officers[f.ruler];
    modal({
      title: `${sc.name} ${sc.hanja}`,
      body: h('div', { style: { display: 'grid', gridTemplateColumns: '96px 1fr', gap: '14px' } },
        h('img', { src: portrait(ruler, 96), style: { width: '96px', height: '113px', borderRadius: '6px' } }),
        h('div', h('p', { style: { margin: '0 0 8px', fontSize: '15px', lineHeight: 1.7 } }, sc.desc),
          h('p', { style: { margin: '0 0 8px', fontSize: '14px' } }, h('b', `${f.name} 세력`), ` — ${f.desc}`),
          h('div.box', h('h3', '처음 할 일'), h('ol', { style: { margin: 0, paddingLeft: '18px', fontSize: '13.5px' } },
            h('li', '도읍의 장수를 눌러 개간·상업·징병 같은 명령을 내린다.'),
            h('li', '「문물」에서 연구할 기술을 고른다.'),
            h('li', '주인 없는 이웃 고을(회색)을 「출진」으로 차지해 땅을 넓힌다.'),
            h('li', '다 했으면 「철 넘기기」. 위임한 고을은 알아서 일한다.'))))),
      footer: [h('button.btn', { onclick: () => { topModal()?.close(); helpScreen(); } }, '도움말'), h('button.btn.primary', { onclick: () => { topModal()?.close(); if (!f.research.cur) techScreen(app); } }, '시작한다')],
    });
    audio.play('gong');
  }

  // ── 철 넘기기 ──
  async function endTurnFlow() {
    const S = app.S;
    if (app.busy || S.over) return;
    const P = S.player;
    const idleNoDel = regionsOf(S, P).filter((r) => !r.delegate).reduce((s, r) => s + officersIn(S, r.id, P).filter((o) => !o.acted && o.injured <= 0).length, 0);
    if (idleNoDel > 0 && !store.get('paldo.nowarn')) {
      const yes = await ask('철을 넘길까', `위임하지 않은 고을에 아직 움직이지 않은 장수가 ${idleNoDel}명 있다.\n그대로 철을 넘기면 그들은 쉰다.`, '넘긴다', '돌아간다');
      if (!yes) return;
    }
    audio.unlock();
    app.busy = true; renderTop();
    const before = { gold: S.factions[P].gold, rice: S.factions[P].rice, regs: regionsOf(S, P).length, log: S.log.length };
    busy('다른 세력이 움직인다…');
    turning = true;
    try {
      await endTurn(S, hooks);
    } catch (e) {
      console.error(e);
      toast('턴 처리 중 문제가 생겼다: ' + e.message, 'bad', 8000);
    }
    turning = false;
    busy(null);
    app.busy = false;
    if (S.season === 0) { app.save('auto'); }
    app.refresh(true);
    audio.play('turn');
    const f = S.factions[P];
    banner(`${SEASONS[S.season]}`, `${dateStr(S)} · 錢 ${fmtSigned(f.gold - before.gold)} · 米 ${fmtSigned(f.rice - before.rice)}`);
    const news = S.log.slice(before.log).filter((l) => !notified.has(l.text) && !/세력에 들어왔다|맞아들였다|천거했다/.test(l.text) && ((l.fid === P && ['war', 'major', 'warn'].includes(l.kind)) || (l.kind === 'major' && !l.text.startsWith('[')))).slice(-(window.innerWidth > 860 ? 4 : 2));
    notified.clear();
    for (const l of news) toast(l.text, l.kind === 'war' || l.kind === 'warn' ? 'bad' : l.kind === 'good' ? 'good' : 'info', 5200);
    if (!f.research.cur && !S.over) toast('연구할 문물을 고르자 — 위쪽 「學」', 'info', 5000);
    checkOver();
  }
  function checkOver() {
    const S = app.S;
    if (!S?.over || S.overShown) return;
    S.overShown = true;
    const v = S.over;
    const win = v.result === 'win';
    audio.play(win ? 'win' : 'lose');
    const title = { unify: '천하통일', culture: '태평성대', modern: '근대화', expel: '왜란 종결', endwar: '전쟁 종결', score: '시간 끝', destroyed: '멸망', conquest: '패망' }[v.type] || '끝';
    modal({
      title: win ? '승리' : '패배', closable: true,
      body: h('div', { style: { textAlign: 'center' } }, h('div', { style: { fontFamily: 'var(--font-brush)', fontSize: 'clamp(64px, 14vw, 120px)', lineHeight: 1, color: win ? 'var(--seal)' : 'var(--ink-2)' } }, title),
        h('p', { style: { fontSize: '16px' } }, v.text), h('p', { style: { color: 'var(--ink-3)' } }, `${dateStr(S)} · ${S.turn}철 · 고을 ${regionsOf(S, S.player).length} · 문물 ${Object.keys(S.factions[S.player].techs).length}`)),
      footer: [h('button.btn', { onclick: () => { topModal()?.close(); } }, '지도 보기'), h('button.btn.primary', { onclick: () => app.toTitle() }, '타이틀로')],
    });
  }

  // ── 핵심 규칙이 부르는 UI 연결 ──
  const notified = new Set();
  let turning = false;
  // 대화 상자가 닫힌 뒤에도 철 처리가 이어지면 '진행 중' 표시를 되살린다
  const resume = (p) => Promise.resolve(p).then((v) => { if (turning) busy('철을 정리하는 중…'); return v; });
  const hooks = {
    progress: (text) => busy(text),
    notify: (text, kind) => { notified.add(text); toast(text, kind || 'info', 5000); },
    battle: async (B) => {
      busy(null);
      if (B.atk.fid !== app.S.player) {
        app.map.arrow(B.from, B.to, app.S.factions[B.atk.fid]?.color);
        app.map.focus(B.to);
        await sleep(400);
        if (app.S.settings.defend === 'auto') { toast(`${app.S.factions[B.atk.fid].name} 군이 ${josa(regionBase(B.to).name, '을/를')} 친다! 수비대장이 맞선다.`, 'bad'); return; }
        const choice = await defendPrompt(B);
        if (choice !== 'manual') { if (choice === 'always') app.S.settings.defend = 'auto'; return; }
      }
      await runBattle(app.S, B);
    },
    battleResult: async (B, res) => {
      if (res.text) toast(res.text, (B.winner === 'atk') === (B.atk.fid === app.S.player) ? 'good' : 'bad', 4500);
      app.refresh(true);
      if (turning) busy('철을 정리하는 중…');
    },
    captive: (o) => resume(captiveDialog(o)),
    event: (inst) => eventDialog(inst),
    eventResult: (inst, text) => resume(eventResultP(text)),
    duel: async (D, opts) => { busy(null); await runDuel(app.S, D, 'a', opts?.title || '일기토'); },
    proposal: (p) => resume(proposalDialog(p)),
  };
  app.hooks = hooks;

  function defendPrompt(B) {
    const S = app.S;
    return new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
      const m = modal({
        title: '적의 침공!', closable: false,
        body: h('p', { style: { fontSize: '15px', margin: 0, whiteSpace: 'pre-line' } }, `${S.factions[B.atk.fid].name} 군 ${josa(fmt(B.atk.troops), '이/가')} 우리 ${regionBase(B.to).name}(병력 ${fmt(B.def.troops)} · 성곽 ${Math.round(B.wall)})${pp(regionBase(B.to).name, '을/를')} 친다!\n직접 지휘하겠는가?`),
        footer: [h('button.btn', { onclick: () => fin('always') }, '앞으로도 늘 맡긴다'), h('button.btn', { onclick: () => fin('auto') }, '수비대장에게 맡긴다'), h('button.btn.red', { onclick: () => fin('manual') }, '직접 지휘')],
      });
    });
  }
  let evModal = null, evResolve = null;
  function eventDialog(inst) {
    busy(null);
    audio.play('gong');
    return new Promise((resolve) => {
      const body = h('div.evt', h('div.stamp', ART[inst.art] || '事'),
        h('div', h('p', inst.text), h('div.choices', inst.choices.map((c, i) => h('button.choice', { disabled: !c.ok || null, onclick: () => { audio.play('click'); for (const b of body.querySelectorAll('.choice')) b.disabled = true; resolve(i); } }, h('b', c.label), c.hint ? h('span', c.hint) : null)))));
      evModal = modal({ title: inst.title, body, closable: false });
    });
  }
  function eventResultP(text) {
    return new Promise((resolve) => {
      if (!evModal) return resolve();
      const m = evModal; evModal = null;
      if (!text) { m.close(); return resolve(); }
      m.body.querySelector('.choices')?.after(h('div.result', text));
      m.setFoot(h('button.btn.primary', { onclick: () => { m.close(); resolve(); } }, '확인'));
      m.foot.querySelector('button')?.focus();
    });
  }
  function captiveDialog(o) {
    busy(null);
    const S = app.S, P = S.player;
    return new Promise((resolve) => {
      const isR = Object.values(S.factions).some((f) => f.alive && f.ruler === o.id);
      const ch = captiveHireChance(S, P, o);
      const msg = h('div.result', { hidden: true });
      let triedHire = false;
      const btns = () => [
        h('button.btn.primary', { disabled: isR || triedHire || null, onclick: () => { const r = resolveCaptive(S, P, o.id, 'hire'); msg.hidden = false; msg.textContent = r.text; if (r.ok) { audio.play('good'); finish(); } else { audio.play('bad'); triedHire = true; m.setFoot(...btns()); } } }, isR ? '등용 불가(군주)' : `등용 ${Math.round(ch * 100)}%`),
        h('button.btn', { onclick: () => { const r = resolveCaptive(S, P, o.id, 'release'); msg.hidden = false; msg.textContent = r.text; finish(); } }, '석방'),
        h('button.btn.red', { onclick: async () => { if (!(await ask('처형', `${josa(o.name, '을/를')} 처형한다. 名이 깎이고 원한을 산다.`, '처형한다', '그만둔다', true))) return; const r = resolveCaptive(S, P, o.id, 'execute'); msg.hidden = false; msg.textContent = r.text; finish(); } }, '처형'),
      ];
      const m = modal({
        title: '포로', closable: false,
        body: [h('div', { style: { display: 'grid', gridTemplateColumns: '90px 1fr', gap: '12px' } },
          h('img', { src: portrait(o, 90), style: { width: '90px', height: '106px', borderRadius: '5px', filter: 'sepia(0.4)' } }),
          h('div', h('div.row', h('b', { style: { fontSize: '18px' } }, o.name), isR ? h('span.badge.r', '군주') : null, h('span', { style: { fontSize: '12.5px', color: 'var(--ink-3)' } }, o.faction ? S.factions[o.faction]?.name : '')),
            h('div', statLine(o)), h('div', { style: { fontSize: '12.5px' } }, o.traits.join(' · ')), h('p', { style: { fontSize: '13px', margin: '6px 0 0' } }, o.bio || ''))), msg],
        footer: btns(),
      });
      function finish() { m.setFoot(h('button.btn.primary', { onclick: () => { m.close(); app.refresh(); resolve(); } }, '확인')); }
    });
  }
  function proposalDialog(p) {
    busy(null);
    const S = app.S;
    const f = S.factions[p.from];
    const text = p.special || {
      alliance: `${f.name} 세력이 동맹을 청한다. 받으면 서로 치지 않는다.`,
      truce: `${f.name} 세력이 휴전을 청한다. 두 해 동안 싸움을 멈춘다.`,
      submit: `${f.name} 세력이 귀순을 청한다! 받으면 그 땅과 장수가 모두 우리 것이 된다.`,
    }[p.type];
    audio.play('gong');
    return ask(`${f.name} 세력의 사신`, text, '받아들인다', '물리친다');
  }

  // ── 단축키 ──
  window.addEventListener('keydown', (e) => {
    if (!app.S || $('#title').childElementCount) return;
    if (e.target.matches('input, textarea, select')) return;
    const tm = topModal();
    if (e.key === 'Escape') { if (tm?.closable) tm.close(); else if (app.picker) app.picker(null); return; }
    if (tm) return;
    if (e.key === 'Enter') { if (e.target.closest?.('button, a, label')) return; e.preventDefault(); endTurnFlow(); }
    const k = e.key.toLowerCase();
    if (k === 't') techScreen(app);
    if (k === 'p') politicsScreen(app);
    if (k === 'o') officerScreen(app);
    if (k === 'd') diplomacyScreen(app);
    if (k === 'f') factionScreen(app);
    if (k === 'l') chronicleScreen(app);
  });
  return app;
}
