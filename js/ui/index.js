// UI 시스템 (game.sys.ui): HUD·패널·대화창·타이틀·터치를 #ui 안에 DOM 으로 만든다.
// 공개 API (docs/ARCHITECTURE.md §5):
//   showTitle() hideTitle() toast(text, kind) banner(title, subtitle, seconds) fade(toBlack, ms) → Promise
//   dialogue(lines, opts) → Promise   choice(question, options) → Promise<number>
//   openPanel(name, arg) closePanel() panelOpen(열린 패널 이름 | null)
// 덧붙인 것: setWaypoint(x, y) clearWaypoint() setVolume(0~1) getVolume() saveGame(slot) loadGame(slot) hasSave(slot)
//            isTouch played dialogueOpen hud
// 이벤트: 'ui:panel' {name, open}, 'waypoint' {x, y, set, reached}

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
    /** 저장/불러오기 + 알림 (save 시스템이 알림을 띄우면 겹쳐 띄우지 않는다) */
    saveGame: (slot) => withNotice(() => game.sys.save?.save?.(slot ?? 'auto'), '기록을 남겼습니다', '기록을 남기지 못했습니다'),
    loadGame: (slot) => withNotice(() => game.sys.save?.load?.(slot ?? 'auto'), '남긴 기록을 불러왔습니다', '기록을 불러오지 못했습니다'),
    hasSave(slot) {
      const s = game.sys.save;
      if (typeof s?.load !== 'function') return false;
      return !!safe(() => (typeof s.hasSave === 'function' ? s.hasSave(slot ?? 'auto') : true), false);
    },

    init() {},
    onStart() {
      played = true;
      if (title.visible) title.hide();
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
  // 처음 화면에서 연 도움말을 닫으면 포커스를 처음 화면 단추로 돌려준다 (title 은 아래에서 만든다)
  const panels = createPanels(ui, game, { onClose: () => title.visible && title.focus() });
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
  let extBanners = 0; // 다른 모듈이 banner() 를 부른 횟수 (UI 가 스스로 띄운 것은 세지 않는다)
  let frameStamp = 0; // 지난 프레임 끝의 extBanners
  let lastBanner = { title: '', t: -99 };
  function banner(titleText, subtitle = '', seconds = 3.2, seal = '印') {
    if (showBanner(titleText, subtitle, seconds, seal)) extBanners++;
  }
  function showBanner(titleText, subtitle = '', seconds = 3.2, seal = '印') {
    titleText = String(titleText ?? '');
    if (!titleText) return false;
    if (lastBanner.title === titleText && clock - lastBanner.t < 2.5) return false; // 같은 배너 겹침 방지
    lastBanner = { title: titleText, t: clock };
    bannerQ.push({ title: titleText, subtitle: subtitle ? String(subtitle) : '', seconds: Math.max(1, Number(seconds) || 3.2), seal });
    if (bannerQ.length > 3) bannerQ.shift();
    return true;
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

  // 미션 이벤트 → 배너. 미션 시스템이 이벤트 앞뒤로(같은 프레임 안에) 직접 banner() 를 부르면 그쪽이 우선.
  // 미션 끝 → 다음 미션 시작이 한 프레임에 겹쳐도 둘 다 띄운다 (UI 가 띄운 배너는 '남이 띄움' 으로 치지 않는다).
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
  game.on('mission:start', (p) => pendingMB.push({ kind: 'start', p: p || {}, stamp: frameStamp }));
  game.on('mission:complete', (p) => pendingMB.push({ kind: 'complete', p: p || {}, stamp: frameStamp }));
  game.on('mission:fail', (p) => pendingMB.push({ kind: 'fail', p: p || {}, stamp: frameStamp }));
  function tickMissionBanners() {
    while (pendingMB.length) {
      const e = pendingMB.shift();
      if (extBanners !== e.stamp) continue; // 미션 쪽이 이미 배너를 띄웠다
      const { title: t, chapter } = missionTitle(e.p.id);
      if (e.kind === 'start') showBanner(t, chapter ? `제${chapter}장` : '새 이야기', 3.4, '始');
      else if (e.kind === 'complete') {
        const rw = rewardText(e.p.rewards);
        showBanner(t, rw ? `이야기를 마쳤다 — ${rw}` : '이야기를 마쳤다', 3.8, '完');
      } else showBanner('그르쳤다', e.p.reason ? String(e.p.reason) : t, 3.4, '敗');
    }
    frameStamp = extBanners;
  }

  // ---------------------------------------------------------------- 암전
  let fadeTimer = null;
  let fadeResolve = null;
  function fade(toBlack, ms = 600) {
    const d = reducedMotion() ? Math.min(Number(ms) || 0, 120) : Math.max(0, Number(ms) || 0);
    fadeEl.style.transitionDuration = `${d}ms`;
    void fadeEl.offsetWidth;
    fadeEl.style.opacity = toBlack ? '1' : '0';
    setClass(fadeEl, 'jx-on', !!toBlack);
    // 앞선 암전이 끝나기 전에 새로 불리면 앞의 약속은 바로 끝낸다 (기다리던 쪽이 멈추지 않게)
    if (fadeTimer) clearTimeout(fadeTimer);
    if (fadeResolve) fadeResolve();
    return new Promise((res) => {
      fadeResolve = res;
      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        fadeResolve = null;
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
  // 소리 시스템이 스스로 크기를 기억하면 그 값을 믿는다. 없을 때만 UI 가 따로 기억해 둔다.
  function audioVolume() {
    const a = game.sys.audio;
    const v = Number(a?.volume ?? a?.masterVolume ?? a?.master);
    return isFinite(v) ? clamp01(v) : null;
  }
  function getVolume() {
    return audioVolume() ?? volume ?? 0.8;
  }
  function setVolume(v) {
    volume = clamp01(Number(v) || 0);
    const a = game.sys.audio;
    if (typeof a?.setVolume === 'function') safe(() => a.setVolume(volume));
    else lsSet('volume', volume);
  }
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    const a = game.sys.audio;
    if (typeof a?.unlock !== 'function') return;
    unlocked = true;
    safe(() => a.unlock());
  }

  // ---------------------------------------------------------------- 저장·불러오기 (알림이 겹치지 않게)
  // save 시스템이 스스로 알림을 띄우면 그대로 두고, 아무 말이 없을 때만 UI 가 알린다.
  let notifyCount = 0;
  function withNotice(fn, okText, failText) {
    const before = notifyCount;
    const ok = !!safe(fn, false);
    if (notifyCount === before) toast(ok ? okText : failText, ok ? 'good' : 'warn');
    return ok;
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
    notifyCount++;
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
  // 단계마다 따로 감싼다: 코어는 화면 렌더러 오류를 한 번만 찍고 그 뒤 프레임을 통째로 건너뛰므로,
  // 예컨대 HUD 가 다른 시스템 값 때문에 던지면 대화창 타자기·패널까지 멈춰 게임이 잠긴다.
  const stepErr = new Set();
  function step(name, fn) {
    try {
      fn();
    } catch (err) {
      if (stepErr.has(name)) return;
      stepErr.add(name);
      console.error(`[ui ${name}]`, err);
    }
  }
  function frame(ctx, dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    clock += dt;
    const playing = game.state === 'play' && !title.visible;
    step('hud', () => {
      hud.setVisible(playing);
      hud.setDim(game.paused || dlg.active);
      hud.update(dt);
    });
    if (playing) {
      ctx.save();
      step('overlay', () => hud.drawOverlay(ctx, dt));
      ctx.restore();
    }
    step('banner', () => {
      tickMissionBanners();
      tickBanner();
    });
    step('toast', tickToasts);
    step('dialogue', () => dlg.tick(dt));
    step('panel', () => panels.frame(dt));
    step('title', () => title.frame(dt));
    step('touch', () => touch.frame(dt, playing && !panels.current && !dlg.active && !game.paused));
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
