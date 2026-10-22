// 패널 틀: 가운데 한지 두루마리(비단 장황 + 위아래 축), 위에 탭(소지품·제작·기술·지도·일지·도움말).
// 좁은 화면(폭 < 640px)은 전체 화면. 상점·쉬어가기는 탭 없이 제목만.
// 여기에는 틀과 쉬어가기·도움말·일지 화면이 있다. 소지품·제작·상점은 goods.js, 기술은 skillsview.js, 지도는 mapview.js.

import { append, dirWord, distWord, emptyNote, formatMoney, h, safe, setAttr, setHidden, setText } from './dom.js';
import { createCraftView, createInventoryView, createShopView } from './goods.js';
import { createMapView } from './mapview.js';
import { createSkillsView } from './skillsview.js';

export const TABS = [
  { id: 'inventory', label: '소지품', hanja: '行裝' },
  { id: 'craft', label: '제작', hanja: '製作' },
  { id: 'skills', label: '기술', hanja: '技藝' },
  { id: 'map', label: '지도', hanja: '地圖' },
  { id: 'journal', label: '일지', hanja: '日誌' },
  { id: 'help', label: '도움말', hanja: '指南' },
];

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 컨테이너 안에서 포커스 옮기기 (코어 Input 이 Tab 키 기본 동작을 막기 때문에 직접 처리) */
export function cycleFocus(container, back = false) {
  const all = [...container.querySelectorAll(FOCUSABLE)].filter((e) => e.offsetParent !== null || e === document.activeElement);
  if (!all.length) return;
  const i = all.indexOf(document.activeElement);
  const n = i < 0 ? (back ? all.length - 1 : 0) : (i + (back ? -1 : 1) + all.length) % all.length;
  try {
    all[n].focus({ preventScroll: false });
  } catch (err) {
    /* 무시 */
  }
}

export function createPanels(ui, game, hooks = {}) {
  const tabsNav = h('div', { class: 'jx-tabs', role: 'tablist', 'aria-label': '메뉴' });
  const titleText = h('span');
  const titleHanja = h('small');
  const titleEl = h('h2', { class: 'jx-panel-title jx-gone' }, titleText, titleHanja);
  const moneyEl = h('div', { class: 'jx-head-money', 'aria-label': '가진 돈' });
  const closeBtn = h('button', { class: 'jx-close', type: 'button', 'aria-label': '닫기 (Esc)', title: '닫기 (Esc)', text: '✕', onclick: () => close() });
  const head = h('div', { class: 'jx-panel-head' }, tabsNav, titleEl, h('div', { class: 'jx-head-side' }, moneyEl, closeBtn));
  const body = h('div', { class: 'jx-panel-body', role: 'tabpanel' });
  const panel = h('section', { class: 'jx-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '메뉴' }, h('div', { class: 'jx-panel-in jx-paper' }, head, body));
  const wrap = h('div', { class: 'jx-panel-wrap jx-gone' }, panel);
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === wrap) close();
  });
  // 슬라이더(INPUT) 에서는 코어 Input 이 키를 무시하므로 Esc 만 따로 받는다
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target?.tagName === 'INPUT') {
      e.preventDefault?.();
      close();
    }
  });

  const tabBtns = TABS.map((t) => {
    const b = h(
      'button',
      { class: 'jx-tab', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-id': t.id, onclick: () => open(t.id) },
      h('small', { text: t.hanja, 'aria-hidden': 'true' }),
      h('span', { text: t.label })
    );
    tabsNav.append(b);
    return b;
  });

  const factories = {
    inventory: createInventoryView,
    craft: createCraftView,
    shop: createShopView,
    skills: createSkillsView,
    map: createMapView,
    journal: createJournalView,
    pause: createPauseView,
    help: createHelpView,
  };
  const views = {};
  let current = null;
  let queued = false;

  const ctx = {
    game,
    ui,
    open: (n, a) => open(n, a),
    close: () => close(),
    toast: (t, k) => ui.toast(t, k),
    money: (j) => formatMoney(game, j),
    setTitle(text, hanja = '') {
      setText(titleText, text || '');
      setText(titleHanja, hanja || '');
      setAttr(panel, 'aria-label', text || '메뉴');
    },
    queueRefresh: () => (queued = true),
  };

  function open(name, arg) {
    if (!factories[name]) {
      console.warn(`[ui] 알 수 없는 패널: ${name}`);
      return false;
    }
    // 처음 화면에서 연 도움말의 탭으로 소지품·지도 등을 열지 못하게 (ui.openPanel 과 같은 규칙)
    if (hooks.canOpen && !hooks.canOpen(name)) return false;
    const was = current;
    if (was) {
      try {
        views[was]?.unmount?.();
      } catch (err) {
        console.error('[ui panel unmount]', err);
      }
      if (was !== name) game.emit('ui:panel', { name: was, open: false });
    }
    let v = views[name];
    if (!v) v = views[name] = factories[name](ctx);
    current = name;
    body.textContent = '';
    body.append(v.el);
    body.className = 'jx-panel-body' + (v.flush ? ' jx-flush' : v.fill ? ' jx-fill' : '');
    const tab = TABS.find((t) => t.id === name);
    setHidden(tabsNav, !tab);
    setHidden(titleEl, !!tab);
    for (const b of tabBtns) {
      const id = b.getAttribute('data-id');
      const on = id === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      setHidden(b, !on && !!hooks.canOpen && !hooks.canOpen(id));
    }
    if (tab) ctx.setTitle(tab.label);
    else ctx.setTitle(v.title || '', v.hanja || '');
    setHidden(moneyEl, !v.money);
    setHidden(wrap, false);
    // 여닫는 소리는 audio 가 'ui:panel' 이벤트를 듣고 낸다
    if (!was) game.pause('ui');
    try {
      v.mount?.(arg);
    } catch (err) {
      console.error('[ui panel mount]', name, err);
    }
    queued = false;
    game.emit('ui:panel', { name, open: true });
    // 처음 열 때, 또는 탭에 포커스가 있던 채로 바꿀 때 포커스를 새 탭으로
    const ae = document.activeElement;
    const onTab = !!ae && tabBtns.includes(ae);
    if (!was || onTab || !panel.contains(ae)) {
      try {
        (tab ? tabBtns[TABS.indexOf(tab)] : v.focusEl || closeBtn).focus({ preventScroll: true });
      } catch (err) {
        /* 무시 */
      }
    }
    return true;
  }

  function close() {
    if (!current) return;
    const name = current;
    try {
      views[name]?.unmount?.();
    } catch (err) {
      console.error('[ui panel unmount]', err);
    }
    current = null;
    setHidden(wrap, true);
    body.textContent = '';
    game.resume('ui');
    game.emit('ui:panel', { name, open: false });
    try {
      document.activeElement?.blur?.();
      game.canvas?.focus?.({ preventScroll: true });
      hooks.onClose?.(name);
    } catch (err) {
      /* 무시 */
    }
  }

  // 데이터가 바뀌면 열린 화면을 다음 프레임에 다시 그린다
  for (const ev of ['item:add', 'item:remove', 'money', 'craft', 'buy', 'sell', 'skill:xp', 'skill:levelup', 'skill:learn', 'mission:start', 'mission:step', 'mission:complete', 'mission:fail', 'waypoint']) {
    game.on(ev, () => {
      if (current) queued = true;
    });
  }

  return {
    el: wrap,
    open,
    close,
    get current() {
      return current;
    },
    queueRefresh: () => (queued = true),
    frame(dt) {
      if (!current) return;
      const v = views[current];
      if (v?.money) {
        const m = game.sys.inventory?.money;
        setText(moneyEl, typeof m === 'number' ? formatMoney(game, m) : '');
      }
      if (queued) {
        queued = false;
        try {
          v?.refresh?.();
        } catch (err) {
          console.error('[ui panel refresh]', current, err);
        }
      }
      v?.frame?.(dt);
    },
    handleInput(inp) {
      if (!current) return;
      if (inp.pressed('weaponWheel')) {
        inp.consume('weaponWheel');
        cycleFocus(panel, inp.down('sprint'));
      }
      views[current]?.handleInput?.(inp);
    },
  };
}

// ==================================================================== 쉬어가기(pause)

function createPauseView(c) {
  const { game, ui } = c;
  const status = h('p', { class: 'jx-muted', 'aria-live': 'polite' });
  const btn = (label, hanja, fn, primary) =>
    h('button', { class: `jx-btn${primary ? ' jx-primary' : ''}`, type: 'button', onclick: fn }, h('span', { text: label }), h('span', { class: 'jx-btn-hanja', text: hanja, 'aria-hidden': 'true' }));

  const bResume = btn('이어 하기', '續', () => c.close(), true);
  const bSave = btn('기록 남기기', '記', () => {
    const ok = ui.saveGame();
    setText(status, ok ? '기록을 남겼습니다.' : '기록을 남기지 못했습니다.');
    refresh();
  });
  const bLoad = btn('기록 불러오기', '讀', () => {
    c.close();
    ui.loadGame();
  });
  const bHelp = btn('조작법', '法', () => c.open('help'));
  const bTitle = btn('처음 화면으로', '初', () => {
    c.close();
    ui.showTitle();
  });

  const volOut = h('output');
  const vol = h('input', {
    class: 'jx-range',
    type: 'range',
    id: 'jx-volume',
    min: '0',
    max: '100',
    step: '5',
    'aria-label': '소리 크기',
    oninput: () => {
      const v = Math.max(0, Math.min(100, Number(vol.value) || 0)) / 100;
      ui.setVolume(v);
      setText(volOut, `${Math.round(v * 100)}`);
    },
  });
  // 소리 끔/켬 (audio.muted, N 키와 같은 상태)
  let lastMuted = false;
  const bMute = h('button', {
    class: 'jx-btn jx-mute',
    type: 'button',
    'aria-pressed': 'false',
    onclick: () => {
      const a = game.sys.audio;
      if (!a || !('muted' in a)) return;
      safe(() => (typeof a.toggleMute === 'function' ? a.toggleMute() : (a.muted = !a.muted)));
      refresh();
    },
  });
  const links = h(
    'div',
    { class: 'jx-links' },
    TABS.filter((t) => t.id !== 'help').map((t) => h('button', { class: 'jx-btn', type: 'button', text: t.label, onclick: () => c.open(t.id) }))
  );
  const el = h(
    'div',
    { class: 'jx-pause' },
    h('div', { class: 'jx-menu' }, bResume, bSave, bLoad, bHelp, bTitle),
    h(
      'div',
      { class: 'jx-side' },
      h('div', { class: 'jx-field' }, h('label', { htmlFor: 'jx-volume' }, h('span', { text: '소리 크기' }), volOut), h('div', { class: 'jx-vol-row' }, vol, bMute)),
      h('div', { class: 'jx-field' }, h('h3', { class: 'jx-sec-h', text: '바로 가기' }), links),
      status,
      h('p', { class: 'jx-muted', text: 'Esc 또는 P 를 누르면 돌아갑니다.' })
    )
  );

  function refresh() {
    const s = game.sys.save;
    bSave.disabled = typeof s?.save !== 'function';
    bLoad.disabled = !ui.hasSave();
    if (!s) setText(status, '저장 기능이 아직 마련되지 않았습니다.');
    else if (s.lastSaveAt && !status.textContent) {
      const d = new Date(s.lastSaveAt);
      if (!isNaN(d)) setText(status, `마지막 기록: ${d.getHours()}시 ${String(d.getMinutes()).padStart(2, '0')}분`);
    }
    const v = ui.getVolume();
    vol.value = String(Math.round(v * 100));
    const a = game.sys.audio;
    const canMute = !!a && 'muted' in a;
    const muted = canMute && !!a.muted;
    lastMuted = !!a?.muted;
    setHidden(bMute, !canMute);
    setText(bMute, muted ? '소리 켜기' : '소리 끄기');
    bMute.setAttribute('aria-pressed', muted ? 'true' : 'false');
    setText(volOut, muted ? '꺼짐' : `${Math.round(v * 100)}`);
  }

  return {
    el,
    title: '쉬어가기',
    hanja: '休',
    focusEl: bResume,
    mount() {
      setText(status, '');
      refresh();
    },
    refresh,
    frame() {
      // N 키로 소리를 끄고 켜면 단추 글자도 따라 바꾼다
      const m = !!game.sys.audio?.muted;
      if (m !== lastMuted) {
        lastMuted = m;
        refresh();
      }
    },
  };
}

// ==================================================================== 도움말

const HELP = [
  {
    cap: '걷기와 탈것',
    rows: [
      ['이동', ['W', 'A', 'S', 'D'], '왼쪽 막대'],
      ['달리기 · 질주 (누르고 있기)', ['Shift'], '달리기'],
      ['걷기 고정', ['Caps Lock'], '—'],
      ['웅크리기', ['C'], '—'],
      ['탈것 타기 · 내리기 · 빼앗기', ['F'], '타기'],
      ['말 부르기 (휘파람)', ['H'], '—'],
      ['급정지 · 노 멈춤', ['Space'], '—'],
    ],
  },
  {
    cap: '싸움',
    rows: [
      ['조준', ['마우스 오른쪽'], '조준 (가까운 적을 겨눔)'],
      ['쏘기 · 치기', ['마우스 왼쪽'], '공격'],
      ['호안(虎眼) — 시간을 늦추고 겨누기', ['Q'], '호안'],
      ['재장전', ['R'], '—'],
      ['무기 바꾸기', ['1', '2', 'Tab'], '—'],
      ['무기 넣기', ['X'], '—'],
    ],
  },
  {
    cap: '사람과 물건',
    rows: [
      ['말 걸기 · 줍기 · 뒤지기 · 가죽 벗기기', ['E'], '행동'],
      ['대화 넘기기', ['E', 'Space', 'Enter'], '대화창 누르기'],
      ['선택지 고르기', ['1', '~', '4'], '누르기'],
    ],
  },
  {
    cap: '메뉴와 화면',
    rows: [
      ['소지품', ['I'], '메뉴 → 소지품'],
      ['기술', ['K'], '메뉴 → 기술'],
      ['지도 (길잡이 점 놓기)', ['M'], '작은 지도 누르기'],
      ['일지', ['J'], '메뉴 → 일지'],
      ['쉬어가기 · 메뉴 닫기', ['Esc', 'P'], '메뉴'],
      ['메뉴 안에서 옮겨 다니기', ['Tab', 'Shift+Tab'], '—'],
      ['가까이 · 멀리 보기', ['휠', '+', '−'], '두 손가락 (지도)'],
      ['소리 켬 · 끔', ['N'], '메뉴 → 소리 크기'],
      ['디버그 정보', ['`'], '—'],
    ],
  },
];

function createHelpView(c) {
  const el = h(
    'div',
    { class: 'jx-help' },
    HELP.map((sec) =>
      h(
        'table',
        null,
        h('caption', { text: sec.cap }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: '하는 일' }), h('th', { scope: 'col', text: '자판 · 마우스' }), h('th', { scope: 'col', text: '손가락(터치)' }))),
        h(
          'tbody',
          null,
          sec.rows.map(([what, keys, touch]) =>
            h('tr', null, h('td', { text: what }), h('td', null, keys.map((k) => (k === '~' ? ' ~ ' : h('kbd', { text: k })))), h('td', { text: touch }))
          )
        )
      )
    )
  );
  return { el, mount() {}, refresh() {} };
}

// ==================================================================== 일지

const ST_ACTIVE = new Set(['active', 'current', 'inprogress', 'in_progress', 'progress', 'started', 'open']);
const ST_DONE = new Set(['done', 'complete', 'completed', 'success', 'passed', 'finished']);
const ST_FAIL = new Set(['failed', 'fail', 'lost']);

function createJournalView(c) {
  const { game, ui } = c;
  const el = h('div', { class: 'jx-journal' });

  function entry(e, kind) {
    const seal = kind === 'done' ? '完' : kind === 'fail' ? '敗' : '行';
    return h(
      'article',
      { class: `jx-entry${kind === 'done' ? ' jx-done' : kind === 'fail' ? ' jx-fail' : ''}` },
      h('h4', { text: e.title || e.id || '이름 없는 이야기' }),
      h('span', { class: 'jx-seal', text: seal, 'aria-label': kind === 'done' ? '마침' : kind === 'fail' ? '실패' : '진행 중' }),
      e.summary ? h('p', { text: e.summary }) : null
    );
  }

  function refresh() {
    el.textContent = '';
    const m = game.sys.missions;
    const obj = safe(() => m?.objectiveText?.(), '') || '';
    const list = safe(() => m?.journal?.(), []) || [];
    const avail = safe(() => m?.available?.(), []) || [];
    if (obj) el.append(h('div', { class: 'jx-now' }, h('span', { class: 'jx-seal', text: '目', 'aria-hidden': 'true' }), h('div', null, h('div', { class: 'jx-muted', text: '지금 할 일' }), h('p', { text: obj }))));
    const act = [], done = [], fail = [];
    for (const e of Array.isArray(list) ? list : []) {
      if (!e) continue;
      const s = String(e.status || '').toLowerCase();
      if (ST_DONE.has(s)) done.push(e);
      else if (ST_FAIL.has(s)) fail.push(e);
      else act.push(e);
    }
    const p = game.player;
    const avs = (Array.isArray(avail) ? avail : []).filter((a) => a && typeof a.x === 'number');
    if (!obj && !act.length && !done.length && !fail.length && !avs.length) {
      el.append(emptyNote('空', '아직 기록이 없습니다', '사람들과 이야기를 나누다 보면 일지가 채워집니다.'));
      return;
    }
    const sec = (title, hanja, items, kind) =>
      items.length ? h('section', { class: 'jx-sec' }, h('h3', { class: 'jx-sec-h' }, h('span', { text: title }), h('small', { text: hanja })), items.map((e) => entry(e, kind))) : null;
    // sec() 는 비면 null: 기본 Element.append(null) 은 'null' 글자를 붙이므로 dom.append 로 거른다
    append(el, sec('진행 중인 이야기', '進行', act, 'act'));
    if (avs.length) {
      el.append(
        h(
          'section',
          { class: 'jx-sec' },
          h('h3', { class: 'jx-sec-h' }, h('span', { text: '들어 볼 만한 이야기' }), h('small', { text: '風聞' })),
          avs.map((a) => {
            const where = p ? `${dirWord(p.x, p.y, a.x, a.y)} ${distWord(Math.hypot(a.x - p.x, a.y - p.y))}` : '';
            return h(
              'article',
              { class: 'jx-entry' },
              h('h4', { text: a.title || a.id || '소문' }),
              h('button', { class: 'jx-btn', type: 'button', text: '길잡이 놓기', onclick: () => ui.setWaypoint(a.x, a.y) }),
              where ? h('p', { text: where }) : null
            );
          })
        )
      );
    }
    append(el, [sec('마친 이야기', '完了', done, 'done'), sec('그르친 이야기', '失敗', fail, 'fail')]);
  }

  return { el, mount: refresh, refresh };
}

