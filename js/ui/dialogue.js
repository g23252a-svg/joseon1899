// 대화창: 아래쪽 한지 띠, 화자 이름은 붉은 낙관, 본문 타자기 효과. 선택지(1~4 키·클릭).
// dialogue(lines, opts) → Promise<void>,  choice(question, options) → Promise<number>
// 여러 번 불러도 차례로 줄을 선다. 열려 있는 동안 game.pause('dialogue').

import { h, reducedMotion, setClass, setHidden, setText } from './dom.js';

const PUNCT_SLOW = new Set(['.', '!', '?', '…', '。']);
const PUNCT_MID = new Set([',', '、', '—', '·', ';', ':']);

function normLines(lines) {
  if (lines == null) return [];
  if (!Array.isArray(lines)) lines = [lines];
  return lines
    .map((l) => (typeof l === 'string' ? { text: l } : l && typeof l === 'object' ? { ...l, text: String(l.text ?? '') } : null))
    .filter((l) => l && (l.text || l.speaker));
}

export function createDialogue(ui, game) {
  const speaker = h('div', { class: 'jx-seal jx-dlg-speaker jx-gone' });
  const portrait = h('div', { class: 'jx-dlg-portrait jx-gone', 'aria-hidden': 'true' });
  const text = h('div', { class: 'jx-dlg-text', 'aria-hidden': 'true' });
  const live = h('div', { class: 'jx-sr', 'aria-live': 'polite' });
  const list = h('ol', { class: 'jx-choices jx-gone' });
  const hintKey = h('span');
  const hint = h('div', { class: 'jx-dlg-hint' }, hintKey, h('b', { text: '▼' }));
  const box = h(
    'div',
    { class: 'jx-dlg jx-paper jx-frame jx-gone', role: 'dialog', 'aria-label': '대화' },
    speaker,
    h('div', { class: 'jx-dlg-body' }, portrait, h('div', { style: 'flex:1;min-width:0' }, text, list)),
    hint,
    live
  );

  const queue = [];
  let cur = null; // {type, lines, i, opts, resolve} | {type:'choice', ...}
  let shown = 0, full = '', acc = 0, openT = 0, lineDone = false, autoT = 0;
  let hi = 0;
  let choiceBtns = [];
  let pausedByUs = false;

  box.addEventListener('pointerdown', (e) => {
    if (!cur || cur.type !== 'lines') return;
    e.preventDefault?.();
    advance();
  });

  function setPause(on) {
    if (on && !pausedByUs) {
      game.pause('dialogue');
      pausedByUs = true;
    } else if (!on && pausedByUs) {
      game.resume('dialogue');
      pausedByUs = false;
    }
  }

  function next() {
    cur = queue.shift() || null;
    if (!cur) {
      setHidden(box, true);
      setPause(false);
      ui._onDialogue?.(false);
      return;
    }
    setHidden(box, false);
    ui._onDialogue?.(true);
    setPause(cur.opts?.pause !== false);
    openT = 0;
    if (cur.type === 'lines') {
      cur.i = 0;
      showLine();
    } else showChoice();
  }

  function setSpeaker(name, port) {
    setHidden(speaker, !name);
    setText(speaker, name || '');
    portrait.textContent = '';
    if (port && typeof port === 'object' && typeof port.getContext === 'function') {
      portrait.append(port);
      setHidden(portrait, false);
    } else if (typeof port === 'string' && port) {
      portrait.textContent = port;
      setHidden(portrait, false);
    } else setHidden(portrait, true);
  }

  function showLine() {
    const l = cur.lines[cur.i];
    setSpeaker(l.speaker, l.portrait);
    full = l.text || '';
    shown = reducedMotion() || cur.opts?.instant ? full.length : 0;
    acc = 0;
    autoT = 0;
    lineDone = shown >= full.length;
    setText(text, full.slice(0, shown));
    setClass(text, 'jx-narr', !l.speaker);
    setHidden(list, true);
    setClass(box, 'jx-choosing', false);
    setHidden(hint, false);
    setText(hintKey, ui.isTouch ? '눌러서 넘기기' : 'E · Space 넘기기');
    live.textContent = (l.speaker ? `${l.speaker}: ` : '') + full;
  }

  function advance() {
    if (!cur || cur.type !== 'lines' || openT < 0.12) return;
    if (!lineDone) {
      shown = full.length;
      lineDone = true;
      setText(text, full);
      return;
    }
    game.sfx?.('ui_click');
    cur.i++;
    if (cur.i >= cur.lines.length) {
      const done = cur;
      cur = null;
      done.resolve();
      next();
    } else showLine();
  }

  function showChoice() {
    const opts = cur.options;
    setSpeaker(cur.opts?.speaker, cur.opts?.portrait);
    full = cur.question || '';
    shown = full.length;
    lineDone = true;
    setText(text, full);
    setClass(text, 'jx-narr', !cur.opts?.speaker);
    live.textContent = full + ' — 선택지: ' + opts.map((o, i) => `${i + 1}. ${o}`).join(', ');
    list.textContent = '';
    choiceBtns = opts.map((o, i) => {
      const b = h(
        'button',
        { class: 'jx-choice', type: 'button', onclick: () => pick(i), onpointerenter: () => highlight(i) },
        h('span', { class: 'jx-key', text: String(i + 1) }),
        h('span', { text: o })
      );
      list.append(h('li', null, b));
      return b;
    });
    setHidden(list, false);
    setClass(box, 'jx-choosing', true);
    setHidden(hint, true);
    highlight(0);
    try {
      choiceBtns[0]?.focus?.({ preventScroll: true });
    } catch (err) {
      /* 무시 */
    }
  }

  function highlight(i) {
    hi = Math.max(0, Math.min(choiceBtns.length - 1, i));
    choiceBtns.forEach((b, j) => setClass(b, 'jx-hi', j === hi));
  }

  function pick(i) {
    if (!cur || cur.type !== 'choice' || cur.done || openT < 0.15) return;
    if (i < 0 || i >= cur.options.length) return;
    cur.done = true;
    game.sfx?.('ui_click');
    const done = cur;
    cur = null;
    choiceBtns = [];
    done.resolve(i);
    next();
  }

  /** 입력 처리 (시스템 update/updatePaused 에서). 대화가 열려 있으면 true */
  function handleInput(inp) {
    if (!cur) return false;
    if (cur.type === 'lines') {
      const go = inp.pressed('interact') || inp.pressed('confirm') || inp.pressed('brake') || inp.mousePressed(0);
      if (go) advance();
    } else {
      for (let i = 0; i < Math.min(9, cur.options.length); i++) {
        if (inp.pressed(`Digit${i + 1}`) || inp.pressed(`Numpad${i + 1}`)) {
          pick(i);
          break;
        }
      }
      if (cur?.type === 'choice') {
        if (inp.pressed('up')) highlight(hi - 1);
        if (inp.pressed('down')) highlight(hi + 1);
        if (inp.pressed('interact') || inp.pressed('brake') || inp.pressed('confirm')) pick(hi);
      }
    }
    for (const a of ['interact', 'confirm', 'brake', 'enter', 'up', 'down', 'weaponNext', 'weaponPrev']) inp.consume(a);
    inp.mouse.pressed[0] = false;
    return true;
  }

  /** 타자기 효과 (매 프레임) */
  function tick(dt) {
    if (!cur) return;
    openT += dt;
    if (cur.type !== 'lines') return;
    if (!lineDone) {
      const speed = cur.opts?.speed ?? 40;
      acc += dt * speed;
      let changed = false;
      while (shown < full.length) {
        const ch = full[shown];
        const cost = PUNCT_SLOW.has(ch) ? 6 : PUNCT_MID.has(ch) ? 3 : ch === ' ' ? 0.5 : 1;
        if (acc < cost) break;
        acc -= cost;
        shown++;
        changed = true;
      }
      if (changed) setText(text, full.slice(0, shown));
      if (shown >= full.length) lineDone = true;
    } else if (cur.opts?.auto) {
      autoT += dt;
      if (autoT >= cur.opts.auto) {
        openT = 1;
        advance();
      }
    }
  }

  return {
    el: box,
    get active() {
      return !!cur;
    },
    dialogue(lines, opts = {}) {
      const ls = normLines(lines);
      if (!ls.length) return Promise.resolve();
      return new Promise((resolve) => {
        queue.push({ type: 'lines', lines: ls, opts: opts || {}, resolve });
        if (!cur) next();
      });
    },
    choice(question, options, opts = {}) {
      const os = (Array.isArray(options) ? options : [])
        .map((o) => (typeof o === 'string' ? o : o?.text ?? o?.label ?? String(o)))
        .filter((o) => o !== '');
      if (!os.length) return Promise.resolve(-1);
      return new Promise((resolve) => {
        queue.push({ type: 'choice', question: String(question ?? ''), options: os, opts: opts || {}, resolve });
        if (!cur) next();
      });
    },
    handleInput,
    tick,
    /** 모두 닫기 (처음 화면으로 갈 때 등). 대화는 끝난 것으로, 선택은 -1 로 끝낸다 */
    closeAll() {
      const all = cur ? [cur, ...queue] : [...queue];
      queue.length = 0;
      cur = null;
      for (const q of all) q.resolve(q.type === 'choice' ? -1 : undefined);
      next();
    },
  };
}
