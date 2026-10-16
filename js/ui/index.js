// UI 시스템 (game.sys.ui): HUD·패널·대화창·타이틀·터치를 #ui 안에 DOM 으로 만든다.
// 공개 API (docs/ARCHITECTURE.md §5):
//   showTitle() hideTitle() toast(text, kind) banner(title, subtitle, seconds) fade(toBlack, ms) → Promise
//   dialogue(lines, opts) → Promise   choice(question, options) → Promise<number>
//   openPanel(name, arg) closePanel() panelOpen(열린 패널 이름 | null)
// 덧붙인 것: setWaypoint(x, y) clearWaypoint() setVolume(0~1) getVolume() isTouch played dialogueOpen

import { clamp01, coarsePointer, formatMoney, h, lsGet, lsSet, reducedMotion, safe, setClass, setText, ssGet, ssSet } from './dom.js';
import { createDialogue } from './dialogue.js';
import { createHud } from './hud.js';
import { createPanels } from './panels.js';
import { injectStyles } from './styles.js';
import { createTitle } from './title.js';
import { createTouch } from './touch.js';

const KEY_PANELS = [
  ['inventory', 'inventory'],
  ['skills', 'skills'],
  ['map', 'map'],
  ['journal', 'journal'],
];
const KINDS = new Set(['info', 'warn', 'good', 'bad']);

export function install(game) {
  injectStyles();
  const host = document.getElementById('ui') || document.body;
  const root = h('div', { class: 'jx-root' });
  host.append(root);
  if (game.waypoint === undefined) game.waypoint = null;

  let clock = 0;
  let isTouch = coarsePointer();
  let played = false;
  let volume = (() => {
    const v = lsGet('volume', null);
    const n = v == null ? NaN : Number(v);
    return isFinite(n) ? clamp01(n) : null;
  })();

  // ---------------------------------------------------------------- 시스템 객체 = game.sys.ui
  const ui = {
    name: 'ui',
    order: -100, // 다른 시스템보다 먼저 메뉴 키를 받는다

    showTitle,
    hideTitle,
    toast,
    banner,
    fade,
    dialogue: (lines, opts) => dlg.dialogue(lines, opts),
    choice: (question, options, opts) => dlg.choice(question, options, opts),
    openPanel: (name, arg) => {
      if (title.visible && name !== 'help') return false;
      return panels.open(name, arg);
    },
    closePanel: () => panels.close(),
    get panelOpen() {
      return panels.current;
    },
    get dialogueOpen() {
      return dlg.active;
    },
    get isTouch() {
      return isTouch;
    },
    get played() {
      return played;
    },
    setWaypoint,
    clearWaypoint,
    setVolume,
    getVolume,

    init() {},
    onStart() {
      played = true;
      if (title.visible) title.hide();
      if (volume != null) safe(() => game.sys.audio?.setVolume?.(volume));
    },
    update() {
      handleInput();
    },
    updatePaused() {
      handleInput();
    },
    serialize() {
      return { waypoint: game.waypoint ? { x: game.waypoint.x, y: game.waypoint.y } : null };
    },
    deserialize(d) {
      const w = d?.waypoint;
      game.waypoint = w && typeof w.x === 'number' && typeof w.y === 'number' ? { x: w.x, y: w.y } : null;
    },
  };

  const hud = createHud(ui, game);
  const touch = createTouch(ui, game);
  const panels = createPanels(ui, game);
  const dlg = createDialogue(ui, game);
  const title = createTitle(ui, game);
  ui.hud = hud;

  const toastsEl = h('div', { class: 'jx-toasts', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const bannerHost = h('div', { 'aria-live': 'assertive' });
  const fadeEl = h('div', { class: 'jx-fade', 'aria-hidden': 'true' });
  root.append(hud.el, touch.el, toastsEl, bannerHost, title.el, dlg.el, panels.el, fadeEl);
  setClass(root, 'jx-touch-on', isTouch);

  // ---------------------------------------------------------------- 타이틀
  function showTitle() {
    if (panels.current) panels.close();
    game.state = 'title';
    title.show();
    if (ssGet('autostart')) {
      // '처음부터 다시' 로 새로 고친 직후: 바로 시작
      ssSet('autostart', null);
      title.startNew();
    }
  }
  function hideTitle() {
    title.hide();
  }

  // ---------------------------------------------------------------- 토스트
  const toasts = []; // {el, countEl, text, kind, n, until, out, rm}
  function toast(text, kind = 'info') {
    if (text == null || text === '') return;
    text = String(text);
    const k = KINDS.has(kind) ? kind : 'info';
    const same = toasts.find((t) => !t.out && t.text === text && t.kind === k);
    if (same) {
      same.n++;
      setText(same.countEl, `×${same.n}`);
      same.until = clock + 4;
      return;
    }
    const countEl = h('span', { class: 'jx-count' });
    const el = h('div', { class: 'jx-toast', 'data-kind': k }, h('span', { text }), countEl);
    toastsEl.append(el);
    toasts.push({ el, countEl, text, kind: k, n: 1, until: clock + 4, out: false, rm: 0 });
    const live = toasts.filter((t) => !t.out);
    if (live.length > 5) live[0].until = clock - 1;
  }
  function tickToasts() {
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i];
      if (!t.out && clock > t.until) {
        t.out = true;
        t.rm = clock + (reducedMotion() ? 0 : 0.45);
        t.el.classList.add('jx-out');
      }
      if (t.out && clock >= t.rm) {
        t.el.remove();
        toasts.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- 배너 (미션 시작·완료)
  const bannerQ = [];
  let bannerCur = null;
  let bannerCount = 0;
  let lastBanner = { title: '', t: -99 };
  function banner(titleText, subtitle = '', seconds = 3.2, seal = '印') {
    titleText = String(titleText ?? '');
    if (!titleText) return;
    if (lastBanner.title === titleText && clock - lastBanner.t < 2.5) return; // 같은 배너 겹침 방지
    lastBanner = { title: titleText, t: clock };
    bannerCount++;
    bannerQ.push({ title: titleText, subtitle: subtitle ? String(subtitle) : '', seconds: Math.max(1, Number(seconds) || 3.2), seal });
    if (bannerQ.length > 3) bannerQ.shift();
  }
  function tickBanner() {
    if (!bannerCur && bannerQ.length) {
      const b = bannerQ.shift();
      const el = h(
        'div',
        { class: 'jx-banner', role: 'status' },
        h('div', { class: 'jx-banner-title', text: b.title }),
        b.subtitle ? h('div', { class: 'jx-banner-sub', text: b.subtitle }) : null,
        b.seal ? h('span', { class: 'jx-seal', text: b.seal, 'aria-hidden': 'true' }) : null
      );
      bannerHost.append(el);
      bannerCur = { el, until: clock + b.seconds, out: false, rm: 0 };
    }
    if (bannerCur) {
      if (!bannerCur.out && clock > bannerCur.until) {
        bannerCur.out = true;
        bannerCur.rm = clock + (reducedMotion() ? 0 : 0.75);
        bannerCur.el.classList.add('jx-out');
      }
      if (bannerCur.out && clock >= bannerCur.rm) {
        bannerCur.el.remove();
        bannerCur = null;
      }
    }
  }

  // 미션 이벤트 → 배너. 미션 시스템이 직접 banner() 를 부르면 그쪽이 우선(같은 틱 안에 불리면 생략)
  const pendingMB = [];
  function missionTitle(id) {
    const m = game.sys.missions;
    const M = m?.MISSIONS;
    const def = M ? (Array.isArray(M) ? M.find((x) => x?.id === id) : M[id]) : null;
    return { title: def?.title || m?.active?.title || m?.active?.def?.title || '이야기', chapter: def?.chapter };
  }
  function rewardText(r) {
    if (!r || typeof r !== 'object') return '';
    const out = [];
    if (r.money) out.push(formatMoney(game, r.money));
    if (Array.isArray(r.items) && r.items.length) out.push(`물건 ${r.items.length}가지`);
    if (r.honor) out.push(`의 ${r.honor > 0 ? '+' : ''}${r.honor}`);
    return out.join(' · ');
  }
  game.on('mission:start', (p) => pendingMB.push({ kind: 'start', p: p || {}, stamp: bannerCount }));
  game.on('mission:complete', (p) => pendingMB.push({ kind: 'complete', p: p || {}, stamp: bannerCount }));
  game.on('mission:fail', (p) => pendingMB.push({ kind: 'fail', p: p || {}, stamp: bannerCount }));
  function tickMissionBanners() {
    while (pendingMB.length) {
      const e = pendingMB.shift();
      if (bannerCount !== e.stamp) continue; // 이미 누군가 배너를 띄웠다
      const { title: t, chapter } = missionTitle(e.p.id);
      if (e.kind === 'start') banner(t, chapter ? `제${chapter}장` : '새 이야기', 3.4, '始');
      else if (e.kind === 'complete') {
        const rw = rewardText(e.p.rewards);
        banner(t, rw ? `이야기를 마쳤다 — ${rw}` : '이야기를 마쳤다', 3.8, '完');
      } else banner('그르쳤다', e.p.reason ? String(e.p.reason) : t, 3.4, '敗');
    }
  }

  // ---------------------------------------------------------------- 암전
  let fadeTimer = null;
  function fade(toBlack, ms = 600) {
    const d = reducedMotion() ? Math.min(ms, 120) : Math.max(0, Number(ms) || 0);
    fadeEl.style.transitionDuration = `${d}ms`;
    void fadeEl.offsetWidth;
    fadeEl.style.opacity = toBlack ? '1' : '0';
    setClass(fadeEl, 'jx-on', !!toBlack);
    if (fadeTimer) clearTimeout(fadeTimer);
    return new Promise((res) => {
      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        res();
      }, d + 16);
    });
  }

  // ---------------------------------------------------------------- 길잡이 점
  function setWaypoint(x, y) {
    if (!isFinite(x) || !isFinite(y)) return;
    game.waypoint = { x, y };
    game.emit('waypoint', { x, y, set: true });
    game.sfx?.('ui_click');
  }
  function clearWaypoint(reached = false) {
    if (!game.waypoint) return;
    game.waypoint = null;
    game.emit('waypoint', { set: false, reached: !!reached });
  }

  // ---------------------------------------------------------------- 소리 크기 (+ 첫 입력에서 오디오 깨우기)
  function getVolume() {
    if (volume != null) return volume;
    const a = game.sys.audio;
    const v = Number(a?.volume ?? a?.master ?? a?.masterVolume);
    return isFinite(v) ? clamp01(v) : 0.8;
  }
  function setVolume(v) {
    volume = clamp01(Number(v) || 0);
    lsSet('volume', volume);
    safe(() => game.sys.audio?.setVolume?.(volume));
  }
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    const a = game.sys.audio;
    if (typeof a?.unlock !== 'function') return;
    unlocked = true;
    safe(() => a.unlock());
    if (volume != null) safe(() => a.setVolume?.(volume));
  }
  function setTouch(on) {
    if (on === isTouch) return;
    isTouch = on;
    setClass(root, 'jx-touch-on', on);
    hud.refreshPrompts();
  }
  window.addEventListener(
    'pointerdown',
    (e) => {
      unlockAudio();
      if (e?.pointerType === 'touch' || e?.pointerType === 'pen') setTouch(true);
      else if (e?.pointerType === 'mouse' && !coarsePointer()) setTouch(false);
    },
    true
  );
  window.addEventListener('keydown', () => unlockAudio(), true);
  window.addEventListener(
    'touchstart',
    () => {
      unlockAudio();
      setTouch(true);
    },
    { passive: true, capture: true }
  );

  // ---------------------------------------------------------------- 알림
  game.on('notify', (p) => {
    if (typeof p === 'string') toast(p);
    else toast(p?.text, p?.kind);
  });

  // ---------------------------------------------------------------- 키 입력 (update / updatePaused)
  function handleInput() {
    const inp = game.input;
    if (!inp) return;
    if (panels.current) {
      // 패널이 맨 위: Esc·같은 키로 닫기, 다른 패널 키로 바꾸기
      if (inp.pressed('pause')) {
        inp.consume('pause');
        panels.close();
        return;
      }
      if (!title.visible) {
        for (const [action, name] of KEY_PANELS) {
          if (!inp.pressed(action)) continue;
          inp.consume(action);
          if (panels.current === name) panels.close();
          else panels.open(name);
          return;
        }
      }
      panels.handleInput(inp);
      return;
    }
    if (dlg.active) {
      dlg.handleInput(inp);
      return;
    }
    if (title.visible) {
      title.handleInput(inp);
      return;
    }
    if (game.state !== 'play') return;
    if (inp.pressed('debug')) {
      inp.consume('debug');
      game.debug = !game.debug;
    }
    if (inp.pressed('pause')) {
      inp.consume('pause');
      panels.open('pause');
      return;
    }
    for (const [action, name] of KEY_PANELS) {
      if (!inp.pressed(action)) continue;
      inp.consume(action);
      panels.open(name);
      return;
    }
  }

  // ---------------------------------------------------------------- 매 프레임 (화면 렌더러, 멈춤 중에도 불린다)
  function frame(ctx, dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    clock += dt;
    const playing = game.state === 'play' && !title.visible;
    hud.setVisible(playing);
    hud.setDim(game.paused || dlg.active);
    hud.update(dt);
    if (playing) hud.drawOverlay(ctx, dt);
    tickMissionBanners();
    tickToasts();
    tickBanner();
    dlg.tick(dt);
    panels.frame(dt);
    title.frame(dt);
    touch.frame(dt, playing && !panels.current && !dlg.active && !game.paused);
    // 길잡이 점에 다다르면 지운다
    const wp = game.waypoint, p = game.player;
    if (playing && wp && p && Math.hypot(wp.x - p.x, wp.y - p.y) < 8) {
      clearWaypoint(true);
      toast('길잡이 점에 다다랐습니다', 'good');
    }
  }
  game.addScreenRenderer((ctx, g, dt) => frame(ctx, dt), 1000);

  game.registerSystem(ui);
  return ui;
}
