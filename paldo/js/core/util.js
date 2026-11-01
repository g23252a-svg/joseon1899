// 공통 도구: 시드 난수, 수치 도구, 한국어 숫자 표기
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
export const by = (f, dir = 1) => (a, b) => (f(a) > f(b) ? dir : f(a) < f(b) ? -dir : 0);

// mulberry32 — 상태는 저장 파일에 들어간다
let _s = 20260101;
export const R = {
  seed(n) { _s = (n >>> 0) || 1; },
  getState() { return _s >>> 0; },
  setState(v) { _s = (v >>> 0) || 1; },
  next() {
    _s = (_s + 0x6d2b79f5) >>> 0;
    let t = _s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },
  range(a, b) { return a + (b - a) * R.next(); },
  int(a, b) { return Math.floor(a + (b - a + 1) * R.next()); },
  chance(p) { return R.next() < p; },
  pick(arr) { return arr.length ? arr[Math.floor(R.next() * arr.length)] : undefined; },
  weighted(items, wf) {
    let tot = 0;
    for (const it of items) tot += Math.max(0, wf(it));
    if (tot <= 0) return undefined;
    let r = R.next() * tot;
    for (const it of items) {
      r -= Math.max(0, wf(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  },
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(R.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },
};

// 결정적 해시 노이즈(지도 장식용 — 게임 난수와 분리)
export function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
export function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// 숫자 표기: 12,345 / 1.2만
export function fmt(n) {
  n = Math.round(n || 0);
  const neg = n < 0;
  n = Math.abs(n);
  let s;
  if (n >= 100000000) s = (n / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
  else if (n >= 10000) s = (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + '만';
  else s = n.toLocaleString('ko-KR');
  return (neg ? '-' : '') + s;
}
export const fmtSigned = (n) => (n >= 0 ? '+' : '') + fmt(n);
export const pct = (x) => Math.round(x * 100) + '%';

// 한국어 조사: 받침 여부
export function josa(word, pair) {
  const [a, b] = pair.split('/'); // '이/가', '을/를', '은/는', '과/와', '으로/로'
  const last = String(word).trim().slice(-1);
  // 숫자는 읽는 소리로: 0영 1일 2이 3삼 4사 5오 6육 7칠 8팔 9구
  if (/[0-9]/.test(last)) {
    const has = '0136 78'.includes(last) && last !== ' ';
    const rieul = '178'.includes(last);
    if (pair === '으로/로') return word + (!has || rieul ? b : a);
    return word + (has ? a : b);
  }
  const ch = last.charCodeAt(0);
  if (ch < 0xac00 || ch > 0xd7a3) return word + b;
  const jong = (ch - 0xac00) % 28;
  if (pair === '으로/로') return word + (jong === 0 || jong === 8 ? b : a);
  return word + (jong ? a : b);
}
// 조사만 돌려준다: 「경복궁」을
export const pp = (word, pair) => josa(word, pair).slice(String(word).length);

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export const deepClone = (o) => JSON.parse(JSON.stringify(o));
