// UI 공용 도우미: DOM 만들기, 바뀔 때만 쓰기, 돈 표기, 조사(을/를), 환경 감지, 저장소.

const PROP_KEYS = new Set(['hidden', 'disabled', 'value', 'checked', 'type', 'tabIndex', 'id', 'title', 'htmlFor', 'name']);

/** h('div', {class, text, onclick, 'aria-label'}, ...자식) */
export function h(tag, attrs = null, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (PROP_KEYS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const c of [kids].flat(4)) {
    if (c == null || c === false || c === '') continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** 자식 모두 지우기 (firstChild 반복문은 쓰지 않는다) */
export function clear(el) {
  el.textContent = '';
  return el;
}

// ---------------------------------------------------------------- 바뀔 때만 DOM 에 쓰기

const textCache = new WeakMap();
export function setText(el, s) {
  s = s == null ? '' : String(s);
  if (textCache.get(el) === s) return false;
  textCache.set(el, s);
  el.textContent = s;
  return true;
}

const styleCache = new WeakMap();
export function setStyle(el, prop, v) {
  let m = styleCache.get(el);
  if (!m) styleCache.set(el, (m = new Map()));
  if (m.get(prop) === v) return;
  m.set(prop, v);
  el.style[prop] = v;
}

const classCache = new WeakMap();
export function setClass(el, cls, on) {
  on = !!on;
  let m = classCache.get(el);
  if (!m) classCache.set(el, (m = new Map()));
  if (m.get(cls) === on) return;
  m.set(cls, on);
  el.classList.toggle(cls, on);
}

const attrCache = new WeakMap();
export function setAttr(el, name, v) {
  let m = attrCache.get(el);
  if (!m) attrCache.set(el, (m = new Map()));
  const s = v == null ? null : String(v);
  if (m.get(name) === s) return;
  m.set(name, s);
  if (s == null) el.removeAttribute(name);
  else el.setAttribute(name, s);
}

export function setHidden(el, hidden) {
  setClass(el, 'jx-gone', hidden);
}

// ---------------------------------------------------------------- 돈·글

/** 내부값은 전(錢). 1냥 = 10전 으로 가정. shops.formatMoney 가 있으면 그것을 쓴다. */
export function formatMoney(game, jeon) {
  const shops = game?.sys?.shops;
  if (typeof shops?.formatMoney === 'function') {
    try {
      const s = shops.formatMoney(jeon);
      if (typeof s === 'string' && s) return s;
    } catch (err) {
      /* 상대 모듈 오류는 무시하고 자체 표기 */
    }
  }
  return ownMoney(jeon);
}

export function ownMoney(jeon) {
  let v = Math.round(Number(jeon) || 0);
  const neg = v < 0;
  v = Math.abs(v);
  const nyang = Math.floor(v / 10), j = v % 10;
  const ny = nyang.toLocaleString('ko-KR');
  const s = nyang && j ? `${ny}냥 ${j}전` : nyang ? `${ny}냥` : `${j}전`;
  return (neg ? '−' : '') + s;
}

/** 빈 화면 안내 (큰 붓글씨 한 글자 + 제목 + 설명) */
export function emptyNote(big, title, text) {
  return h('div', { class: 'jx-empty' }, h('b', { text: big, 'aria-hidden': 'true' }), h('strong', { text: title }), text ? h('p', { text }) : null);
}

/** 받침에 따라 조사 고르기: josa('말', '을', '를') → '말을' */
export function josa(word, withBatchim, without) {
  const w = String(word ?? '');
  const code = w.charCodeAt(w.length - 1);
  if (code >= 0xac00 && code <= 0xd7a3) return w + ((code - 0xac00) % 28 ? withBatchim : without);
  return `${w}${withBatchim}(${without})`;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** (x0,y0) 에서 (x1,y1) 쪽 방위 (화면 위 = 북) */
export function dirWord(x0, y0, x1, y1) {
  const a = Math.atan2(y1 - y0, x1 - x0); // 0 = 동, + = 남쪽으로
  const names = ['동', '남동', '남', '남서', '서', '북서', '북', '북동'];
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return `${names[i]}쪽`;
}

/** 거리(m) → '가까이' / '약 n리' (1리 ≈ 400m) */
export function distWord(m) {
  if (!(m >= 0)) return '';
  if (m < 60) return '바로 곁';
  if (m < 200) return '가까이';
  const ri = m / 400;
  return `약 ${ri < 10 ? ri.toFixed(1).replace(/\.0$/, '') : Math.round(ri)}리`;
}

// ---------------------------------------------------------------- 환경

function mq(q) {
  try {
    return window.matchMedia?.(q) || null;
  } catch (err) {
    return null;
  }
}

let _reduced = null;
export function reducedMotion() {
  if (_reduced == null) {
    const m = mq('(prefers-reduced-motion: reduce)');
    _reduced = !!m?.matches;
    try {
      m?.addEventListener?.('change', (e) => (_reduced = !!e.matches));
    } catch (err) {
      /* 옛 브라우저 */
    }
  }
  return _reduced;
}

export function coarsePointer() {
  return !!mq('(pointer: coarse)')?.matches;
}

export function dpr() {
  return Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
}

export function viewW() {
  return (typeof window !== 'undefined' && window.innerWidth) || 800;
}

// ---------------------------------------------------------------- 저장소 (항상 try/catch)

const LS_PREFIX = 'joseon1899:';
export function lsGet(key, fallback = null) {
  try {
    const v = window.localStorage?.getItem(LS_PREFIX + key);
    return v == null ? fallback : v;
  } catch (err) {
    return fallback;
  }
}
export function lsSet(key, value) {
  try {
    window.localStorage?.setItem(LS_PREFIX + key, String(value));
  } catch (err) {
    /* 저장소 막힘 */
  }
}
export function ssGet(key) {
  try {
    return window.sessionStorage?.getItem(LS_PREFIX + key) ?? null;
  } catch (err) {
    return null;
  }
}
export function ssSet(key, value) {
  try {
    if (value == null) window.sessionStorage?.removeItem(LS_PREFIX + key);
    else window.sessionStorage?.setItem(LS_PREFIX + key, String(value));
  } catch (err) {
    /* 저장소 막힘 */
  }
}

/** 상대 모듈 함수를 안전하게 부르기: 없거나 던지면 fallback */
export function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    return fallback;
  }
}

/** 작은 캔버스 만들기 (CSS 크기 w×h, dpr 반영) */
export function makeCanvas(w, h, cls) {
  const c = document.createElement('canvas');
  const r = dpr();
  c.width = Math.max(1, Math.round(w * r));
  c.height = Math.max(1, Math.round(h * r));
  if (cls) c.className = cls;
  return c;
}
