// Node 에서 게임 로직을 돌리기 위한 가짜 DOM/Canvas. 무엇이든 받아주는 Proxy.
// 화면은 없지만 update/draw 코드 경로의 예외를 잡을 수 있다.

function makeAny(name = 'any') {
  const fn = function () {};
  const store = new Map();
  const handler = {
    get(target, prop) {
      if (prop === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'then') return undefined; // await 대상이 되지 않게
      if (prop === 'toString' || prop === 'valueOf') return () => '';
      if (prop === 'length') return 0;
      if (prop === 'width' && !store.has(prop)) return 800;
      if (prop === 'height' && !store.has(prop)) return 600;
      if (prop === 'clientWidth' || prop === 'offsetWidth' || prop === 'innerWidth') return 800;
      if (prop === 'clientHeight' || prop === 'offsetHeight' || prop === 'innerHeight') return 600;
      if (prop === 'measureText') return (t) => ({ width: String(t ?? '').length * 8, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 });
      if (prop === 'getContext') return () => makeAny('ctx');
      if (prop === 'getImageData' || prop === 'createImageData')
        return (a, b, c, d) => {
          const w = typeof c === 'number' ? c : typeof a === 'number' ? a : 1;
          const h = typeof d === 'number' ? d : typeof b === 'number' ? b : 1;
          return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) };
        };
      if (prop === 'getBoundingClientRect') return () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 });
      if (prop === 'querySelectorAll' || prop === 'getElementsByClassName' || prop === 'getElementsByTagName') return () => [];
      if (prop === 'children' || prop === 'childNodes') return [];
      if (prop === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (prop === 'dataset') return store.get('dataset') || (store.set('dataset', {}), store.get('dataset'));
      if (prop === 'style') return store.get('style') || (store.set('style', makeAny('style')), store.get('style'));
      if (store.has(prop)) return store.get(prop);
      const child = makeAny(String(prop));
      store.set(prop, child);
      return child;
    },
    set(target, prop, value) {
      store.set(prop, value);
      return true;
    },
    apply() {
      return makeAny('ret');
    },
    construct() {
      return makeAny('new');
    },
    has() {
      return true;
    },
  };
  return new Proxy(fn, handler);
}

const listeners = new Map();
const win = {
  devicePixelRatio: 1,
  innerWidth: 800,
  innerHeight: 600,
  addEventListener(name, fn) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(fn);
  },
  removeEventListener() {},
  dispatchEvent(ev) {
    for (const fn of listeners.get(ev.type) || []) fn(ev);
  },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame() {},
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval() {},
  getComputedStyle: () => makeAny('cs'),
  location: { hash: '', search: '', href: 'http://localhost/' },
  localStorage: (() => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
  })(),
  AudioContext: undefined,
  webkitAudioContext: undefined,
};
win.window = win;

globalThis.window = win;
globalThis.document = makeAny('document');
globalThis.localStorage = win.localStorage;
globalThis.requestAnimationFrame = win.requestAnimationFrame;
globalThis.cancelAnimationFrame = win.cancelAnimationFrame;
globalThis.getComputedStyle = win.getComputedStyle;
globalThis.matchMedia = win.matchMedia;
globalThis.navigator = globalThis.navigator || { userAgent: 'node', maxTouchPoints: 0 };
globalThis.OffscreenCanvas = class {
  constructor(w, h) {
    this.width = w;
    this.height = h;
  }
  getContext() {
    return makeAny('octx');
  }
};
globalThis.Image = class {
  constructor() {
    return makeAny('img');
  }
};
globalThis.Path2D = class {
  constructor() {
    return makeAny('path');
  }
};
globalThis.KeyboardEvent = class {
  constructor(type, init = {}) {
    Object.assign(this, { type, ...init });
  }
};
globalThis.CustomEvent = class {
  constructor(type, init = {}) {
    Object.assign(this, { type, detail: init.detail });
  }
};
globalThis.HTMLElement = class {};
globalThis.FontFace = undefined;

export { makeAny, win };
