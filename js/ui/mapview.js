// 큰 지도 화면: world.mapCanvas 전체 지도. 끌어서 이동, 휠·두 손가락으로 확대, 눌러서 길잡이 점 지정/해제.
// 지명(종류별 크기·글꼴, 도시는 붓글씨), 노선·역, 가게, 미션 표식, 길잡이, 플레이어 위치.

import { FONT, PAL } from '../engine/palette.js';
import { clamp, mixHex, rgba, TAU } from '../engine/util.js';
import { dpr, h, setClass, setHidden, setText } from './dom.js';
import { drawMarker, drawPlayerArrow, drawVehicleMark } from './icons.js';
import { collectMarkers, drawImageClipped, drawLines, getMapImage, lineList, placeList } from './maputil.js';

// 지명 종류별 모양. min: 이 배율(px/m) 이상에서만 보임, pri: 겹칠 때 우선순위(작을수록 먼저)
const PLACE = {
  city: { font: 'brush', size: 34, min: 0, pri: 0 },
  port: { font: 'display', size: 16, min: 0.1, pri: 1, mark: 'port' },
  town: { font: 'display', size: 18, min: 0.1, pri: 2 },
  mountain: { font: 'display', size: 14, min: 0, pri: 3, color: PAL.ink2, peak: true },
  village: { font: 'display', size: 15, min: 0.18, pri: 4 },
  station: { font: 'body', size: 12, min: 0.22, pri: 5, mark: 'station' },
  ferry: { font: 'body', size: 12, min: 0.22, pri: 5, mark: 'ferry' },
  landmark: { font: 'body', size: 13, min: 0.35, pri: 6, color: PAL.ink2 },
  hideout: { font: 'body', size: 12, min: 0.35, pri: 6, color: PAL.seal },
  camp: { font: 'body', size: 12, min: 0.35, pri: 7, mark: 'camp' },
  market: { font: 'body', size: 12, min: 0.5, pri: 7, mark: 'market' },
  district: { font: 'body', size: 13, min: 0.5, pri: 8, color: PAL.ink2, spacing: 3 },
  tram_stop: { font: 'body', size: 11, min: 0.7, pri: 9, mark: 'tram_stop' },
};

export function createMapView(c) {
  const { game, ui } = c;
  const cv = h('canvas', { role: 'img', 'aria-label': '전체 지도' });
  const tip = h('div', { class: 'jx-map-tip' });
  const bIn = h('button', { class: 'jx-btn', type: 'button', text: '+', 'aria-label': '가까이', onclick: () => zoomBy(1.4) });
  const bOut = h('button', { class: 'jx-btn', type: 'button', text: '−', 'aria-label': '멀리', onclick: () => zoomBy(1 / 1.4) });
  const bMe = h('button', { class: 'jx-btn', type: 'button', text: '◎', 'aria-label': '내 자리로', title: '내 자리로', onclick: () => centerOnPlayer() });
  const bClear = h('button', { class: 'jx-btn jx-small jx-gone', type: 'button', text: '길잡이 지우기', onclick: () => ui.clearWaypoint() });
  const el = h('div', { class: 'jx-map' }, cv, tip, h('div', { class: 'jx-map-ctl' }, bClear, bIn, bOut, bMe));

  const view = { cx: 0, cy: 0, scale: 1 };
  let W = 800, H = 600, minS = 0.05, maxS = 6;
  let dirty = true, redrawT = 0, clock = 0;
  let inited = false, keyPan = false;
  const pts = new Map();
  let pinch = null, moved = 0;

  const ws = () => game.world?.size || { w: 600, h: 400 };

  function measure() {
    const r = el.getBoundingClientRect();
    W = Math.max(50, r.width || 800);
    H = Math.max(50, r.height || 600);
    const s = ws();
    minS = Math.min(W / s.w, H / s.h) * 0.6;
    maxS = 6;
    dirty = true;
  }

  function clampView() {
    const s = ws();
    view.scale = clamp(view.scale, minS, maxS);
    view.cx = clamp(view.cx, 0, s.w);
    view.cy = clamp(view.cy, 0, s.h);
  }

  function centerOnPlayer() {
    const p = game.player;
    const s = ws();
    view.cx = p ? p.x : s.w / 2;
    view.cy = p ? p.y : s.h / 2;
    clampView();
    keyPan = false;
    dirty = true;
  }

  function zoomTo(ns, mx = W / 2, my = H / 2) {
    const wx = view.cx + (mx - W / 2) / view.scale, wy = view.cy + (my - H / 2) / view.scale;
    view.scale = clamp(ns, minS, maxS);
    view.cx = wx - (mx - W / 2) / view.scale;
    view.cy = wy - (my - H / 2) / view.scale;
    clampView();
    dirty = true;
  }
  const zoomBy = (k) => zoomTo(view.scale * k);

  function toWorld(mx, my) {
    return { x: view.cx + (mx - W / 2) / view.scale, y: view.cy + (my - H / 2) / view.scale };
  }

  function clickAt(mx, my) {
    const wp = game.waypoint;
    if (wp && typeof wp.x === 'number') {
      const sx = W / 2 + (wp.x - view.cx) * view.scale, sy = H / 2 + (wp.y - view.cy) * view.scale;
      if (Math.hypot(sx - mx, sy - my) < 18) {
        ui.clearWaypoint();
        dirty = true;
        return;
      }
    }
    const s = ws();
    const w = toWorld(mx, my);
    ui.setWaypoint(clamp(w.x, 0, s.w), clamp(w.y, 0, s.h));
    dirty = true;
  }

  // ---------------------------------------------------------------- 포인터 (마우스·터치 공통)
  cv.addEventListener('pointerdown', (e) => {
    try {
      cv.setPointerCapture?.(e.pointerId);
    } catch (err) {
      /* 무시 */
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      moved = 0;
      pinch = null;
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), scale: view.scale };
      moved = 99;
    }
    setClass(el, 'jx-drag', true);
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size === 1) {
      view.cx -= dx / view.scale;
      view.cy -= dy / view.scale;
      moved += Math.abs(dx) + Math.abs(dy);
      clampView();
      dirty = true;
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = cv.getBoundingClientRect();
      zoomTo((pinch.scale * d) / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0) {
      setClass(el, 'jx-drag', false);
      if (moved < 6 && e.type === 'pointerup') {
        const r = cv.getBoundingClientRect();
        clickAt(e.clientX - r.left, e.clientY - r.top);
      }
      pinch = null;
    }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault?.();
      const r = cv.getBoundingClientRect();
      zoomTo(view.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false }
  );

  // ---------------------------------------------------------------- 그리기
  function label(ctx, text, x, y, font, size, color, spacing = 0) {
    ctx.font = `${size}px ${font}`;
    if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.24);
    ctx.strokeStyle = rgba(PAL.paper, 0.86);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  function draw() {
    dirty = false;
    const r = dpr();
    const pw = Math.round(W * r), ph = Math.round(H * r);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    const s = view.scale;
    const ox = W / 2 - view.cx * s, oy = H / 2 - view.cy * s;
    const tf = (x, y) => [ox + x * s, oy + y * s];
    const size = ws();

    // 지도 밖은 짙은 한지, 안은 지도 그림
    ctx.fillStyle = mixHex(PAL.paperDeep, PAL.paperShade, 0.5);
    ctx.fillRect(0, 0, W, H);
    const img = getMapImage(game);
    if (img) {
      const k = s / img.scale; // 지도 px 당 화면 px
      ctx.imageSmoothingEnabled = true;
      drawImageClipped(ctx, img.canvas, -ox / k, -oy / k, W / k, H / k, 0, 0, W, H);
    }
    ctx.fillStyle = rgba(PAL.paper, 0.1);
    ctx.fillRect(ox, oy, size.w * s, size.h * s);
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(PAL.ink, 0.7);
    ctx.strokeRect(ox, oy, size.w * s, size.h * s);

    // 노선과 역
    drawLines(ctx, game.world, tf, { alpha: 0.75, width: clamp(s * 2.2, 1.4, 3.5), stops: s > 0.15, stopR: clamp(s * 3, 2.5, 5) });

    // 지명 (겹치면 우선순위 낮은 것을 뺀다)
    const placed = [];
    const fits = (x0, y0, x1, y1) => {
      for (const b of placed) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false;
      placed.push([x0, y0, x1, y1]);
      return true;
    };
    const places = placeList(game.world)
      .filter((p) => PLACE[p.kind] && !p.hidden && !(Array.isArray(p.tags) && p.tags.includes('hidden')))
      .sort((a, b) => PLACE[a.kind].pri - PLACE[b.kind].pri);
    const zf = clamp(s / 0.5, 0.7, 1.35);
    for (const p of places) {
      const st = PLACE[p.kind];
      if (s < st.min) continue;
      const [x, y] = tf(p.x, p.y);
      if (x < -120 || y < -60 || x > W + 120 || y > H + 60) continue;
      const fs = Math.round(st.size * (p.kind === 'city' ? clamp(zf, 0.8, 1.5) : zf));
      const font = FONT[st.font] || FONT.body;
      ctx.font = `${fs}px ${font}`;
      const tw = ctx.measureText(p.name).width + (st.spacing || 0) * p.name.length;
      const ly = st.mark ? y + fs * 0.95 : st.peak ? y + fs * 0.4 : y;
      if (!fits(x - tw / 2 - 2, ly - fs * 0.6, x + tw / 2 + 2, ly + fs * 0.6)) continue;
      if (st.mark) drawMarker(ctx, st.mark, x, y, clamp(13 * zf, 11, 17), clock);
      if (st.peak) {
        ctx.strokeStyle = rgba(PAL.ink, 0.75);
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        const u = fs * 0.5;
        ctx.moveTo(x - u * 1.4, y - u * 0.2);
        ctx.lineTo(x - u * 0.6, y - u * 1.3);
        ctx.lineTo(x, y - u * 0.6);
        ctx.lineTo(x + u * 0.6, y - u * 1.6);
        ctx.lineTo(x + u * 1.5, y - u * 0.2);
        ctx.stroke();
      }
      if (p.kind === 'city' && p.hanja) label(ctx, p.hanja, x, ly - fs * 0.85, FONT.display, Math.round(fs * 0.36), PAL.ink2, 2);
      label(ctx, p.name, x, ly, font, fs, st.color || PAL.ink, st.spacing || 0);
    }

    // 노선 정거장 이름 (지명에 없는 것만)
    if (s >= 0.45) {
      for (const l of lineList(game.world)) {
        for (const st of l.stops || []) {
          if (!st?.name || typeof st.x !== 'number') continue;
          const [x, y] = tf(st.x, st.y);
          if (x < -60 || y < -30 || x > W + 60 || y > H + 30) continue;
          ctx.font = `12px ${FONT.body}`;
          const tw = ctx.measureText(st.name).width;
          if (!fits(x - tw / 2, y + 6, x + tw / 2, y + 20)) continue;
          label(ctx, st.name, x, y + 13, FONT.body, 12, PAL.ink2);
        }
      }
    }

    // 가게
    if (s >= 0.6) {
      for (const b of game.world?.buildings || []) {
        if (!b?.shop || typeof b.x !== 'number') continue;
        const [x, y] = tf(b.x, b.y);
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        drawMarker(ctx, 'shop', x, y, 13, clock);
      }
    }

    // 미션 표식
    for (const m of collectMarkers(game)) {
      const [x, y] = tf(m.x, m.y);
      if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue;
      drawMarker(ctx, m.kind || 'mission', x, y, 17, clock);
      if (m.label && s >= 0.2) label(ctx, String(m.label), x, y + 20, FONT.body, 12, m.kind === 'objective' ? PAL.seal : PAL.ink);
    }

    // 길잡이 + 플레이어
    const p = game.player;
    const wp = game.waypoint;
    if (p && wp && typeof wp.x === 'number') {
      const [ax, ay] = tf(p.x, p.y), [bx, by] = tf(wp.x, wp.y);
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(PAL.ink, 0.55);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.restore();
      drawMarker(ctx, 'waypoint', bx, by, 15, clock);
    }
    if (p) {
      const [x, y] = tf(p.x, p.y);
      const pulse = 14 + (Math.sin(clock * 3) + 1) * 4;
      ctx.beginPath();
      ctx.arc(x, y, pulse, 0, TAU);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(PAL.seal, 0.45);
      ctx.stroke();
      if (p.vehicle) drawVehicleMark(ctx, x, y, p.vehicle.angle, p.vehicle.vtype, 10);
      else drawPlayerArrow(ctx, x, y, p.angle, 10);
    }

    // 키보드로 움직일 때 가운데 겨냥점
    if (keyPan) {
      ctx.strokeStyle = PAL.seal;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 10, H / 2);
      ctx.lineTo(W / 2 + 10, H / 2);
      ctx.moveTo(W / 2, H / 2 - 10);
      ctx.lineTo(W / 2, H / 2 + 10);
      ctx.stroke();
    }

    // 방위와 축척
    ctx.save();
    ctx.translate(W - 34, 34);
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, TAU);
    ctx.fillStyle = rgba(PAL.paper, 0.9);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAL.ink;
    ctx.stroke();
    ctx.fillStyle = PAL.seal;
    ctx.font = `16px ${FONT.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('北', 0, 1);
    ctx.restore();
    const choices = [25, 50, 100, 200, 400, 800, 2000, 4000, 8000];
    let len = choices[0];
    for (const m of choices) if (m * s <= 130) len = m;
    const bw = len * s;
    ctx.save();
    ctx.translate(16, 22);
    ctx.fillStyle = rgba(PAL.paper, 0.85);
    ctx.fillRect(-6, -14, bw + 12, 30);
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(0, 10);
    ctx.lineTo(bw, 10);
    ctx.lineTo(bw, 6);
    ctx.stroke();
    ctx.fillStyle = PAL.ink2;
    ctx.font = `12px ${FONT.body}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(len >= 400 ? `${len / 400}리` : `${len}m`, 0, 1);
    ctx.restore();
  }

  function updateTip() {
    setText(
      tip,
      ui.isTouch
        ? '끌어서 움직이고, 두 손가락으로 넓히며, 눌러서 길잡이 점을 놓습니다.'
        : '끌어서 움직이고, 휠로 넓히고 좁히며, 눌러서 길잡이 점을 놓습니다. (자판: WASD 이동 · Enter 길잡이)'
    );
    setHidden(bClear, !game.waypoint);
  }

  const onResize = () => {
    if (inited) measure();
  };
  game.on('resize', onResize);

  return {
    el,
    flush: true,
    mount() {
      measure();
      if (!inited) {
        const s = ws();
        view.scale = clamp(Math.min(W, H) / 700, minS, maxS);
        view.cx = s.w / 2;
        view.cy = s.h / 2;
        inited = true;
      }
      centerOnPlayer();
      updateTip();
      draw();
    },
    unmount() {
      pts.clear();
      pinch = null;
      setClass(el, 'jx-drag', false);
    },
    refresh() {
      updateTip();
      dirty = true;
    },
    frame(dt) {
      clock += dt;
      // 자판 이동 (멈춤 중에도 input.axis 는 동작)
      const a = game.input.axis();
      if (a.x || a.y) {
        view.cx += (a.x * 420 * dt) / view.scale;
        view.cy += (a.y * 420 * dt) / view.scale;
        clampView();
        keyPan = true;
        dirty = true;
      }
      if ((redrawT += dt) > 0.1) {
        redrawT = 0;
        dirty = true; // 표식 깜빡임
      }
      if (dirty) draw();
    },
    handleInput(inp) {
      if (inp.pressed('zoomIn')) zoomBy(1.4);
      if (inp.pressed('zoomOut')) zoomBy(1 / 1.4);
      if (inp.pressed('confirm') && keyPan) {
        clickAt(W / 2, H / 2);
        updateTip();
      }
    },
  };
}

