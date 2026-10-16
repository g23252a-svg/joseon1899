// 타이틀: game.state = 'title' 일 때. 뒤로 월드가 비치는 반투명 한지 위에 세로쓰기 제목과 붓글씨 부제, 붉은 낙관.
// 단추: 새로 시작 / 이어 하기(저장이 있으면) / 조작법. 타이틀 동안 카메라가 천천히 흘러간다.

import { cycleFocus } from './panels.js';
import { h, safe, setClass, setHidden, setText, ssSet } from './dom.js';

export function createTitle(ui, game) {
  const btn = (label, hanja, fn, primary) => {
    const text = h('span', { text: label });
    const b = h('button', { class: `jx-btn${primary ? ' jx-primary' : ''}`, type: 'button', onclick: fn }, text, h('span', { class: 'jx-btn-hanja', text: hanja, 'aria-hidden': 'true' }));
    b._label = text;
    return b;
  };

  const bNew = btn('새로 시작', '始', () => onNew(), true);
  const bCont = btn('이어 하기', '續', () => onContinue());
  const bHelp = btn('조작법', '法', () => ui.openPanel('help'));
  const note = h('p', { class: 'jx-title-foot', 'aria-live': 'polite' });

  const el = h(
    'section',
    { class: 'jx-title jx-gone', role: 'dialog', 'aria-label': '조선 1899 — 처음 화면' },
    h(
      'div',
      { class: 'jx-title-art' },
      h(
        'div',
        { style: 'display:flex;flex-direction:column;align-items:center;gap:18px' },
        h('h1', { class: 'jx-title-main' }, '조선', h('span', { class: 'jx-year', text: '1899' })),
        h('span', { class: 'jx-seal jx-title-seal', text: '光武', 'aria-hidden': 'true' })
      ),
      h('p', { class: 'jx-title-sub', text: '광무 3년, 기찻길이 들어오던 해' })
    ),
    h(
      'nav',
      { class: 'jx-title-menu', 'aria-label': '처음 화면 메뉴' },
      bNew,
      bCont,
      bHelp,
      note,
      h('p', { class: 'jx-title-foot', text: 'WASD 걷기 · E 행동 · F 타기 · 마우스 조준과 사격 · Esc 메뉴' })
    )
  );

  let visible = false;
  let leaveT = -1;
  let t = 0;
  let anchor = null; // 카메라 흐름 기준점
  let busy = false;

  function hasSave() {
    const s = game.sys.save;
    if (typeof s?.load !== 'function') return false;
    return !!safe(() => s.hasSave?.('auto') ?? s.hasSave?.(), false);
  }

  function refresh() {
    const save = hasSave();
    setHidden(bCont, !(ui.played || save));
    setText(bCont._label, ui.played ? '하던 길 이어 가기' : '이어 하기');
    setText(note, '');
  }

  function start() {
    ui.hideTitle();
    game.beginPlay();
  }

  function onNew() {
    if (busy) return;
    if (!ui.played) return start();
    busy = true;
    ui.choice('지금까지 걸어온 길은 남지 않습니다. 처음부터 다시 시작하시겠습니까?', ['처음부터 다시', '그만두기']).then((i) => {
      busy = false;
      if (i !== 0) return;
      ssSet('autostart', '1');
      try {
        window.location.reload();
      } catch (err) {
        setText(note, '다시 시작하지 못했습니다. 페이지를 새로 고쳐 주십시오.');
      }
    });
  }

  function onContinue() {
    if (ui.played) {
      ui.hideTitle();
      game.state = 'play';
      return;
    }
    ui.hideTitle();
    game.beginPlay();
    const ok = safe(() => game.sys.save?.load?.(), false);
    ui.toast(ok ? '남긴 기록을 불러왔습니다' : '기록을 불러오지 못해 처음부터 시작합니다', ok ? 'good' : 'warn');
  }

  return {
    el,
    get visible() {
      return visible;
    },
    show() {
      visible = true;
      leaveT = -1;
      setClass(el, 'jx-leave', false);
      setHidden(el, false);
      refresh();
      const cam = game.camera;
      anchor = { x: cam.x, y: cam.y };
      t = 0;
      if (cam.baseZoom) cam.zoom = cam.baseZoom * 0.72;
      try {
        bNew.focus({ preventScroll: true });
      } catch (err) {
        /* 무시 */
      }
    },
    hide() {
      if (!visible) return;
      visible = false;
      setClass(el, 'jx-leave', true);
      leaveT = 0.65;
      try {
        document.activeElement?.blur?.();
        game.canvas?.focus?.({ preventScroll: true });
      } catch (err) {
        /* 무시 */
      }
    },
    startNew: start,
    frame(dt) {
      if (leaveT >= 0) {
        leaveT -= dt;
        if (leaveT < 0) setHidden(el, true);
      }
      if (!visible || !anchor || game.state !== 'title') return;
      // 수묵화를 펼쳐 보듯 카메라가 천천히 흐른다
      t += dt;
      const cam = game.camera;
      cam.x = anchor.x + Math.sin(t * 0.045) * 26;
      cam.y = anchor.y + Math.sin(t * 0.031 + 1) * 10;
    },
    handleInput(inp) {
      if (inp.pressed('weaponWheel')) {
        inp.consume('weaponWheel');
        cycleFocus(el, inp.down('sprint'));
      }
    },
    refresh,
  };
}
