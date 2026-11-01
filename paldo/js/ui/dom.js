// 작은 DOM 도구. h('div.cls#id', {attrs}, ...children)
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  if (m?.[2]) for (const p of m[2].match(/[.#][\w-]+/g) || []) { if (p[0] === '.') el.classList.add(p.slice(1)); else el.id = p.slice(1); }
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (s, root = document) => root.querySelector(s);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export function bar(v, max, color, cap) {
  const p = Math.max(0, Math.min(100, (v / Math.max(1, max)) * 100));
  return h('div.bar' + (cap != null ? '.cap' : ''), h('i', { style: { width: p + '%', background: color || '' } }), cap != null ? h('b', { style: { left: Math.min(100, (cap / Math.max(1, max)) * 100) + '%' } }) : null);
}
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 없음 */ } },
};
