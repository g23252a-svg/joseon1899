// 터치 조작: (pointer: coarse) 기기이거나 첫 touchstart 이후에만 보인다.
// 왼쪽 아래 떠다니는 가상 조이스틱(input.setVirtualAxis), 오른쪽 버튼 무리(input.setVirtual).
// 손가락마다 pointerId 로 따로 추적하므로 걸으면서 쏠 수 있다. 조준·공격 중에는 가까운 표적을 겨눠 준다.

import { h, setClass, setStyle } from './dom.js';

const BUTTONS = [
  { action: 'fire', label: '공격', big: true, r: 0, b: 0 },
  { action: 'aim', label: '조준', r: 92, b: 4 },
  { action: 'sprint', label: '달리기', r: 162, b: 4 },
  { action: 'interact', label: '행동', r: 86, b: 84 },
  { action: 'enter', label: '타기', r: 4, b: 94 },
  { action: 'hoan', label: '호안', r: 4, b: 164, gold: true },
  { action: 'pause', label: '메뉴', r: 160, b: 160, menu: true },
];

export function createTouch(ui, game) {
  const knob = h('div', { class: 'jx-knob' });
  const stick = h('div', { class: 'jx-stick', 'aria-hidden': 'true' }, knob);
  const zone = h('div', { class: 'jx-stick-zone', 'aria-label': '이동 막대' }, stick);
  const cluster = h('div', { class: 'jx-tbtns' });
  const el = h('div', { class: 'jx-touch', 'aria-hidden': 'true' }, zone, cluster);

  const R = 54;
  let stickId = null;
  let base = { x: 0, y: 0 };
  let shown = false;
  const held = new Map(); // action → Set(pointerId)
  const btnEls = [];

  function homeStick() {
    setStyle(stick, 'left', '96px');
    setStyle(stick, 'top', 'calc(100% - 124px)');
    setStyle(knob, 'transform', 'translate(0px, 0px)');
  }
  homeStick();

  function moveStick(e) {
    const r = zone.getBoundingClientRect();
    let dx = e.clientX - r.left - base.x, dy = e.clientY - r.top - base.y;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx *= R / len;
      dy *= R / len;
    }
    setStyle(knob, 'transform', `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`);
    const k = Math.min(1, len / R);
    if (k < 0.14) game.input.setVirtualAxis(0, 0);
    else game.input.setVirtualAxis((dx / R) * (k > 0.9 ? 1 / k : 1), (dy / R) * (k > 0.9 ? 1 / k : 1));
  }

  zone.addEventListener('pointerdown', (e) => {
    if (stickId != null) return;
    e.preventDefault?.();
    stickId = e.pointerId;
    try {
      zone.setPointerCapture?.(e.pointerId);
    } catch (err) {
      /* 무시 */
    }
    const r = zone.getBoundingClientRect();
    base = { x: e.clientX - r.left, y: e.clientY - r.top };
    setStyle(stick, 'left', `${base.x}px`);
    setStyle(stick, 'top', `${base.y}px`);
    setClass(stick, 'jx-active', true);
    moveStick(e);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) moveStick(e);
  });
  const endStick = (e) => {
    if (e && e.pointerId !== stickId) return;
    stickId = null;
    game.input.setVirtualAxis(0, 0);
    setClass(stick, 'jx-active', false);
    homeStick();
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);
  zone.addEventListener('lostpointercapture', endStick);

  function press(action, on) {
    if (action === 'pause') {
      if (on) ui.openPanel('pause');
      return;
    }
    game.input.setVirtual(action, on);
    // 코어 mouseDown(0) 은 가상 'fire' 를 보지만 mousePressed(0) 은 안 본다: 한 발씩 쏘는 무기를 위해 '눌림' 도 넣어 준다
    if (action === 'fire' && on && game.input.mouse?.pressed) game.input.mouse.pressed[0] = true;
  }

  for (const d of BUTTONS) {
    const b = h('button', {
      class: `jx-tbtn${d.big ? ' jx-big' : ''}${d.gold ? ' jx-gold' : ''}`,
      type: 'button',
      tabIndex: -1,
      text: d.label,
      style: { right: `${d.r}px`, bottom: `${d.b}px`, ...(d.menu ? { width: '50px', height: '50px', fontSize: '12px' } : {}) },
    });
    const ids = new Set();
    held.set(d.action, ids);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault?.();
      try {
        b.setPointerCapture?.(e.pointerId);
      } catch (err) {
        /* 무시 */
      }
      const first = ids.size === 0;
      ids.add(e.pointerId);
      if (first) {
        setClass(b, 'jx-held', true);
        press(d.action, true);
      }
    });
    const rel = (e) => {
      if (!ids.delete(e.pointerId) || ids.size) return;
      setClass(b, 'jx-held', false);
      press(d.action, false);
    };
    b.addEventListener('pointerup', rel);
    b.addEventListener('pointercancel', rel);
    b.addEventListener('lostpointercapture', rel);
    b.addEventListener('contextmenu', (e) => e.preventDefault?.());
    cluster.append(b);
    btnEls.push({ b, d, ids });
  }

  function releaseAll() {
    for (const { b, d, ids } of btnEls) {
      if (!ids.size) continue;
      ids.clear();
      setClass(b, 'jx-held', false);
      press(d.action, false);
    }
    if (stickId != null) endStick(null);
    game.input.setVirtualAxis(0, 0);
  }

  /** 터치로 조준·공격할 때 가까운 표적(적대 사람 > 짐승)을 마우스 위치로 겨눈다 */
  function aimAssist() {
    const inp = game.input;
    const p = game.player;
    if (!p || p.state !== 'normal') return;
    if (!(inp.virtual.get('aim') || inp.virtual.get('fire'))) return;
    const wanted = (game.sys.wanted?.level || 0) > 0;
    let best = null, bestScore = Infinity;
    for (const e of game.query(p.x, p.y, 30, (e) => e !== p && e.alive)) {
      let pri;
      if (e.kind === 'human') {
        if (e.state === 'dead' || e.vehicle === p.vehicle && p.vehicle) continue;
        const hostile = e.faction === 'rival' || e.tags?.has?.('hostile') || e.data?.hostile || e.brain?.target === p || (wanted && (e.faction === 'police' || e.faction === 'army'));
        if (!hostile) continue;
        pri = 0;
      } else if (e.kind === 'animal') {
        if (e.dead || e.state === 'dead') continue;
        pri = 1;
      } else continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(e.y - p.y, e.x - p.x) - p.angle), Math.cos(Math.atan2(e.y - p.y, e.x - p.x) - p.angle)));
      const score = d * (1 + ang) + pri * 40;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    let tx, ty;
    if (best) {
      tx = best.x;
      ty = best.y;
    } else {
      const ax = inp.virtualAxis;
      const a = ax && (ax.x || ax.y) ? Math.atan2(ax.y, ax.x) : p.angle;
      tx = p.x + Math.cos(a) * 6;
      ty = p.y + Math.sin(a) * 6;
    }
    const s = game.camera.worldToScreen(tx, ty);
    inp.mouse.sx = s.x;
    inp.mouse.sy = s.y;
    inp.mouse.inside = true;
  }

  return {
    el,
    frame(dt, want) {
      const show = !!(want && ui.isTouch);
      if (show !== shown) {
        shown = show;
        setClass(el, 'jx-show', show);
        if (!show) releaseAll();
      }
      if (shown) aimAssist();
    },
    releaseAll,
  };
}
