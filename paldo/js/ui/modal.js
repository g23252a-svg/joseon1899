// 대화 상자·알림·띠(배너)·진행 표시. alert/confirm 은 쓰지 않는다.
import { h, $, clear } from './dom.js';
import { audio } from './audio.js';

const stack = [];
export function modal({ title, body, footer, cls = '', closable = true, onClose, wide }) {
  const layer = $('#layer');
  const bodyEl = h('div.db');
  const footEl = h('div.df');
  const close = () => {
    if (!scrim.isConnected) return;
    scrim.remove();
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    onClose?.();
  };
  const head = title != null ? h('div.dh', h('h2', title), closable ? h('button.x', { 'aria-label': '닫기', onclick: () => { audio.play('click'); close(); } }, '×') : null) : null;
  const dlg = h('div.dlg' + (wide ? '.wide' : '') + (cls ? '.' + cls.split(' ').join('.') : ''), { role: 'dialog', 'aria-modal': 'true' }, head, bodyEl, footEl);
  const scrim = h('div.scrim', dlg);
  if (closable) scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  const api = {
    el: dlg, body: bodyEl, foot: footEl, close,
    setBody(...kids) { clear(bodyEl); for (const k of kids) if (k) bodyEl.append(k); },
    setFoot(...kids) { clear(footEl); for (const k of kids) if (k) footEl.append(k); footEl.hidden = !footEl.childNodes.length; },
    setTitle(t) { const h2 = dlg.querySelector('.dh h2'); if (h2) h2.textContent = t; },
    closable,
  };
  api.setBody(...[].concat(body || []));
  api.setFoot(...[].concat(footer || []));
  layer.append(scrim);
  stack.push(api);
  return api;
}
export const topModal = () => stack[stack.length - 1];
export function closeAllModals() { for (const m of [...stack]) if (m.closable) m.close(); }

// 확인 상자 → Promise<boolean>
export function ask(title, text, yes = '예', no = '아니오', danger = false) {
  return new Promise((res) => {
    let done = false;
    const m = modal({
      title, body: h('p', { style: { fontSize: '15px', margin: 0, whiteSpace: 'pre-line' } }, text),
      footer: [
        h('button.btn', { onclick: () => { done = true; m.close(); res(false); } }, no),
        h('button.btn' + (danger ? '.red' : '.primary'), { onclick: () => { done = true; m.close(); res(true); } }, yes),
      ],
      onClose: () => { if (!done) res(false); },
    });
  });
}
export function info(title, ...kids) {
  return new Promise((res) => {
    const m = modal({ title, body: kids, footer: [h('button.btn.primary', { onclick: () => m.close() }, '확인')], onClose: res });
  });
}

export function toast(text, kind = 'info', ms = 3600) {
  const t = h('div.toast.' + kind, text);
  $('#toasts').append(t);
  setTimeout(() => { t.style.transition = 'opacity 0.4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, ms);
  const all = $('#toasts').children;
  const max = window.innerWidth > 860 ? 5 : 3;
  while (all.length > max) all[0].remove();
}
export function banner(a, b) {
  const el = h('div.banner', h('div.a', a), b ? h('div.b', b) : null);
  document.body.append(el);
  setTimeout(() => el.remove(), 2300);
}
let busyEl = null;
export function busy(text) {
  if (!text) { busyEl?.remove(); busyEl = null; return; }
  if (!busyEl) { busyEl = h('div.busy', h('div.card', h('div.spin'), h('span'))); document.body.append(busyEl); }
  busyEl.querySelector('span').textContent = text;
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
