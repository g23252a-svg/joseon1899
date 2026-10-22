// HUD: 심지 게이지(체력·기력·호안), 돈·수배·의, 원형 미니맵·지역·시각, 현재 목표, 상호작용 안내,
// 탈것 패널, 디버그. DOM 은 값이 바뀔 때만 쓴다. 조준선·호안 비네트는 화면 렌더러로 캔버스에 그린다.

import { FONT, PAL } from '../engine/palette.js';
import { clamp, mixHex, rgba, sijin, TAU } from '../engine/util.js';
import { clamp01, compactView, dpr, formatMoney, h, safe, setAttr, setClass, setHidden, setStyle, setText } from './dom.js';
import { drawMarker, drawPlayerArrow, drawVehicleMark } from './icons.js';
import { collectMarkers, drawImageClipped, drawLines, getLocalMap, getMapImage, warmMapImage } from './maputil.js';

const HEALTH = mixHex(PAL.seal, PAL.blood, 0.35);
const STAMINA = mixHex(PAL.seaDeep, PAL.night, 0.45);

const WEATHER = {
  clear: ['晴', '맑음'],
  cloudy: ['曇', '흐림'],
  rain: ['雨', '비'],
  storm: ['雷', '폭풍우'],
  snow: ['雪', '눈'],
  fog: ['霧', '안개'],
};
const HONOR = {
  noble: ['의인', PAL.dancheongGreen],
  decent: ['선량', mixHex(PAL.dancheongGreen, PAL.ink2, 0.5)],
  neutral: ['보통', PAL.ink2],
  rough: ['거친 이', mixHex(PAL.seal, PAL.ink2, 0.45)],
  outlaw: ['무뢰배', PAL.seal],
};

export function createHud(ui, game) {
  const el = h('div', { class: 'jx-hud jx-off' });

  // ---------------------------------------------------------------- 왼쪽 위: 심지 + 돈·수배·의
  const coreDefs = [
    { key: 'health', glyph: '體', label: '체력', color: HEALTH, glyphColor: PAL.ink },
    { key: 'stamina', glyph: '氣', label: '기력', color: STAMINA, glyphColor: PAL.ink },
    { key: 'hoan', glyph: '虎', label: '호안', color: PAL.gold, glyphColor: mixHex(PAL.gold, PAL.ink, 0.25) },
  ];
  const cores = coreDefs.map((d) => {
    const cv = document.createElement('canvas');
    const wrap = h('div', { class: 'jx-core', role: 'img', 'aria-label': d.label }, cv);
    return { ...d, wrap, cv, sig: '' };
  });
  const moneyText = h('span');
  const money = h('div', { class: 'jx-money', 'aria-label': '가진 돈' }, moneyText);
  const stamps = [0, 1, 2, 3].map(() => h('span', { class: 'jx-seal jx-stamp jx-gone', text: '手配' }));
  const wanted = h('div', { class: 'jx-wanted', role: 'img', 'aria-label': '수배 없음' }, stamps);
  const honorPin = h('i');
  const honorTier = h('span');
  const honor = h(
    'div',
    { class: 'jx-honor', role: 'img', 'aria-label': '의 평판' },
    h('span', { class: 'jx-honor-mark' }, h('span', { text: '義' })),
    h('span', { class: 'jx-honor-track' }, honorPin),
    honorTier
  );
  const purse = h('div', { class: 'jx-purse' }, money, wanted, honor);
  el.append(h('div', { class: 'jx-tl' }, h('div', { class: 'jx-cores' }, cores.map((c) => c.wrap)), purse));

  // ---------------------------------------------------------------- 오른쪽 위: 미니맵 + 지역·시각
  const miniCv = document.createElement('canvas');
  // 대화로 멈춘 동안에는 M 키처럼 지도를 열지 않는다 (메뉴가 대화를 덮어 버리므로)
  const mini = h('button', { class: 'jx-mini', type: 'button', 'aria-label': '작은 지도. 누르면 큰 지도를 펼칩니다', onclick: () => !game.paused && ui.openPanel('map') }, miniCv);
  const region = h('div', { class: 'jx-region' });
  const clockEl = h('div', { class: 'jx-clock' });
  el.append(h('div', { class: 'jx-tr' }, mini, h('div', { class: 'jx-where' }, region, clockEl)));

  // ---------------------------------------------------------------- 위 가운데: 목표
  const objText = h('span', { class: 'jx-obj-text' });
  const obj = h('div', { class: 'jx-obj jx-gone', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'jx-seal jx-obj-mark' }), objText);
  el.append(obj);

  // ---------------------------------------------------------------- 아래 가운데: 상호작용 안내
  const prompts = h('div', { class: 'jx-prompts', 'aria-live': 'polite' });
  el.append(prompts);

  // ---------------------------------------------------------------- 오른쪽 아래: 탈것
  const vehName = h('div', { class: 'jx-veh-name' });
  const vehGait = h('div', { class: 'jx-veh-gait' });
  const vehFill = h('i');
  const vehBar = h('div', { class: 'jx-veh-bar jx-gone', role: 'img', 'aria-label': '말 기력' }, vehFill);
  const veh = h('div', { class: 'jx-veh jx-gone' }, vehName, vehGait, vehBar);
  el.append(veh);

  // ---------------------------------------------------------------- 디버그
  const debug = h('div', { class: 'jx-debug jx-gone', 'aria-hidden': 'true' });
  el.append(debug);

  // ---------------------------------------------------------------- 상태
  let visible = false;
  let dim = false;
  let clock = 0;
  let coreSize = 54, miniSize = 176;
  let miniR = 90; // 미니맵 반경(m)
  let miniAcc = 1;
  let whereAcc = 1, objAcc = 1, dbgAcc = 1;
  let lastWanted = 0;
  let promptSig = '';
  let vehSig = '';
  let hoanK = 0, lowK = 0;
  const deltas = []; // 돈 변화 떠오르는 글자
  let lastRegionPos = { x: NaN, y: NaN };
  let markerCache = [], markerT = -1;

  function measure() {
    const narrow = compactView();
    coreSize = narrow ? 40 : 54;
    miniSize = narrow ? 112 : 176;
    for (const c of cores) c.sig = '';
    miniAcc = 1;
  }
  measure();
  game.on('resize', measure);
  // 웹 글꼴(Song Myung)이 늦게 오면 심지 글자(體·氣·虎)를 다시 그린다 (값이 바뀔 때만 그리므로)
  try {
    const redraw = () => {
      for (const c of cores) c.sig = '';
    };
    document.fonts?.ready?.then?.(redraw);
    document.fonts?.addEventListener?.('loadingdone', redraw);
  } catch (err) {
    /* 글꼴 API 없음 */
  }

  game.on('money', (p) => {
    const d = Math.round(Number(p?.delta) || 0);
    if (!d || !visible) return;
    const s = h('span', { class: `jx-money-delta ${d > 0 ? 'jx-plus' : 'jx-minus'}`, text: (d > 0 ? '+' : '−') + formatMoney(game, Math.abs(d)) });
    money.append(s);
    deltas.push({ el: s, t: clock + 1.7 });
    if (deltas.length > 3) deltas.shift().el.remove();
  });

  // ---------------------------------------------------------------- 심지 게이지
  function readCore(key) {
    const st = game.sys.stats;
    const p = game.player;
    if (st) {
      const g = st[key];
      if (g && typeof g === 'object' && typeof g.value === 'number') return { v: g.value, max: g.max || 100, core: Number.isFinite(g.core) ? g.core : 100 };
      if (typeof g === 'number') return { v: g, max: 100, core: 100 };
    }
    if (!p) return null;
    if (key === 'health') return { v: p.hp, max: p.maxHp || 100, core: 100 };
    if (key === 'stamina') return { v: p.stamina, max: p.maxStamina || 100, core: 100 };
    return null; // stats 가 없으면 호안은 숨김
  }

  function drawCore(c, v) {
    const S = coreSize, r = dpr();
    const px = Math.round(S * r);
    if (c.cv.width !== px) {
      c.cv.width = px;
      c.cv.height = px;
    }
    const ctx = c.cv.getContext('2d');
    if (!ctx) return;
    const frac = clamp01(v.v / (v.max || 1));
    const core = clamp(v.core, 0, 100);
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2, R = S * 0.39;
    // 종이 원판
    ctx.beginPath();
    ctx.arc(cx, cx, R + S * 0.085, 0, TAU);
    ctx.fillStyle = rgba(PAL.paper, 0.8);
    ctx.fill();
    // 바깥 고리: 바탕 + 값
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cx, R, 0, TAU);
    ctx.lineWidth = S * 0.09;
    ctx.strokeStyle = rgba(PAL.ink, 0.15);
    ctx.stroke();
    if (frac > 0.003) {
      ctx.beginPath();
      ctx.arc(cx, cx, R, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.strokeStyle = c.color;
      ctx.stroke();
      // 붓끝: 바깥쪽 가는 먹선, 끝으로 갈수록 가늘게
      ctx.beginPath();
      ctx.arc(cx, cx, R + S * 0.05, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
      ctx.lineWidth = Math.max(0.8, S * 0.02);
      ctx.strokeStyle = rgba(PAL.ink, 0.5);
      ctx.stroke();
    }
    // 심지(core): 안쪽 원이 아래에서부터 차오름
    const cr = R * 0.66;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cx, cr, 0, TAU);
    ctx.clip();
    ctx.fillStyle = rgba(PAL.paper, 0.95);
    ctx.fillRect(0, 0, S, S);
    const lvl = core / 100;
    ctx.fillStyle = rgba(c.color, 0.34);
    ctx.fillRect(cx - cr, cx + cr - 2 * cr * lvl, 2 * cr, 2 * cr * lvl);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cx, cr, 0, TAU);
    ctx.lineWidth = Math.max(1, S * 0.03);
    ctx.strokeStyle = PAL.ink;
    ctx.stroke();
    ctx.font = `${Math.round(S * 0.34)}px ${FONT.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = core < 15 ? PAL.seal : c.glyphColor;
    ctx.fillText(c.glyph, cx, cx + S * 0.025);
  }

  function updateCores() {
    for (const c of cores) {
      const v = readCore(c.key);
      setHidden(c.wrap, !v);
      if (!v) continue;
      const frac = clamp01(v.v / (v.max || 1));
      const sig = `${Math.round(frac * 80)}|${Math.round(v.core)}|${coreSize}`;
      if (sig !== c.sig) {
        c.sig = sig;
        drawCore(c, v);
        setAttr(c.wrap, 'aria-label', `${c.label} ${Math.round(frac * 100)}%`);
      }
      setClass(c.wrap, 'jx-low', c.key === 'health' && frac < 0.25 && frac > 0);
    }
  }

  // ---------------------------------------------------------------- 돈·수배·의
  let lastMoney = NaN;
  function updatePurse() {
    const inv = game.sys.inventory;
    const hasMoney = inv && typeof inv.money === 'number';
    setHidden(money, !hasMoney);
    // 돈 글자는 값이 바뀔 때만 만든다 (formatMoney·toLocaleString 을 매 프레임 부르지 않게)
    if (hasMoney && inv.money !== lastMoney) {
      lastMoney = inv.money;
      setText(moneyText, formatMoney(game, inv.money));
    }

    const w = game.sys.wanted;
    const lvl = w ? clamp(Math.round(Number(w.level) || 0), 0, 4) : 0;
    setHidden(wanted, lvl <= 0);
    if (lvl !== lastWanted) {
      for (let i = 0; i < 4; i++) {
        setHidden(stamps[i], i >= lvl);
        setClass(stamps[i], 'jx-new', i >= lastWanted && i < lvl);
      }
      const bounty = Number(w?.bounty) || 0;
      setAttr(wanted, 'aria-label', lvl ? `수배 ${lvl}단계${bounty ? `, 현상금 ${formatMoney(game, bounty)}` : ''}` : '수배 없음');
      setAttr(wanted, 'title', lvl ? `수배 ${lvl}단계${bounty ? ` · 현상금 ${formatMoney(game, bounty)}` : ''}` : '');
      lastWanted = lvl;
    }

    const hasHonor = w && Number.isFinite(w.honor);
    setHidden(honor, !hasHonor);
    if (hasHonor) {
      const tier = safe(() => w.honorTier?.(), null) || (w.honor > 60 ? 'noble' : w.honor > 20 ? 'decent' : w.honor > -20 ? 'neutral' : w.honor > -60 ? 'rough' : 'outlaw');
      const [name, color] = HONOR[tier] || HONOR.neutral;
      setText(honorTier, name);
      setStyle(honor, 'color', color);
      setStyle(honorPin, 'left', `${Math.round(((clamp(w.honor, -100, 100) + 100) / 200) * 100)}%`);
      setAttr(honor, 'aria-label', `의(義) 평판: ${name} (${Math.round(w.honor)})`);
    }
  }

  // ---------------------------------------------------------------- 미니맵
  function drawMinimap(dt) {
    const S = miniSize, r = dpr();
    const px = Math.round(S * r);
    if (miniCv.width !== px) {
      miniCv.width = px;
      miniCv.height = px;
    }
    const ctx = miniCv.getContext('2d');
    const p = game.player;
    if (!ctx || !p) return;
    const focus = p.vehicle || p;
    const fx = focus.x, fy = focus.y;
    // 좌표가 깨졌으면(NaN) 그리지 않는다: 가까운 곳 그림을 매번 통째로 다시 만들게 되므로
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return;
    const sp = Math.hypot(focus.vx || 0, focus.vy || 0) || 0;
    const target = 80 + clamp(sp, 0, 26) * 7.5;
    miniR += (target - miniR) * Math.min(1, dt * 1.2);
    const c = S / 2, rad = S / 2 - 6;
    const k = rad / miniR;
    const tf = (x, y) => [c + (x - fx) * k, c + (y - fy) * k];

    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, rad, 0, TAU);
    ctx.clip();
    ctx.fillStyle = PAL.paper;
    ctx.fillRect(0, 0, S, S);
    // 전체 지도 그림이 충분히 촘촘하면 그것을, 아니면 가까운 곳만 따로 그린 그림을 쓴다
    const wm = game.world?.mapCanvas ? getMapImage(game) : null;
    const img = wm && wm.scale * miniR * 2 >= S * 0.8 ? wm : getLocalMap(game, fx, fy, miniR);
    if (img) {
      const s = img.scale, ox = img.x0 || 0, oy = img.y0 || 0;
      ctx.imageSmoothingEnabled = true;
      drawImageClipped(ctx, img.canvas, (fx - miniR - ox) * s, (fy - miniR - oy) * s, 2 * miniR * s, 2 * miniR * s, c - rad, c - rad, 2 * rad, 2 * rad);
    }
    // 종이에 스민 듯 옅게
    ctx.fillStyle = rgba(PAL.paper, 0.14);
    ctx.fillRect(0, 0, S, S);
    drawLines(ctx, game.world, tf, { alpha: 0.5, width: S < 140 ? 1 : 1.3 });

    // 화면에 보이는 범위
    const b = game.camera.bounds(0);
    const [ax, ay] = tf(b.x0, b.y0), [bx, by] = tf(b.x1, b.y1);
    if (bx - ax < rad * 1.9) {
      ctx.strokeStyle = rgba(PAL.ink, 0.32);
      ctx.lineWidth = 1;
      ctx.strokeRect(ax, ay, bx - ax, by - ay);
    }

    // 표식 (미션 시스템의 markers()/available() 는 1/10초마다만 묻는다: 미니맵은 1초에 30번 그린다)
    if (clock - markerT > 0.1 || clock < markerT) {
      markerT = clock;
      markerCache = collectMarkers(game);
    }
    const markers = markerCache.slice();
    const wp = game.waypoint;
    if (wp && typeof wp.x === 'number') {
      const [wx, wy] = tf(wp.x, wp.y);
      ctx.save();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = rgba(PAL.ink, 0.5);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(wx, wy);
      ctx.stroke();
      ctx.restore();
      markers.push({ x: wp.x, y: wp.y, kind: 'waypoint' });
    }
    const ms = S < 140 ? 9 : 11;
    for (const m of markers) {
      let [mx, my] = tf(m.x, m.y);
      const dx = mx - c, dy = my - c, d = Math.hypot(dx, dy);
      if (d > rad - 6) {
        if (m.kind !== 'objective' && m.kind !== 'waypoint') continue;
        mx = c + (dx / d) * (rad - 8);
        my = c + (dy / d) * (rad - 8);
        drawMarker(ctx, m.kind, mx, my + (m.kind === 'waypoint' ? ms * 0.5 : 0), ms * 0.75, clock);
      } else drawMarker(ctx, m.kind || 'mission', mx, my, ms, clock);
    }

    // 플레이어
    if (p.vehicle) drawVehicleMark(ctx, c, c, p.vehicle.angle, p.vehicle.vtype, S < 140 ? 6.5 : 8);
    else drawPlayerArrow(ctx, c, c, p.angle, S < 140 ? 6 : 7.5);
    ctx.restore();

    // 먹 테두리(고르지 않은 붓질) + 방위
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, rad, 0, TAU);
    ctx.lineWidth = 3;
    ctx.strokeStyle = PAL.ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, rad + 2.2, 2.3, 2.3 + TAU * 0.72);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = rgba(PAL.ink, 0.45);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAL.ink;
    for (const a of [0, Math.PI / 2, Math.PI]) {
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * (rad - 5), c + Math.sin(a) * (rad - 5));
      ctx.lineTo(c + Math.cos(a) * (rad + 1), c + Math.sin(a) * (rad + 1));
      ctx.stroke();
    }
    const nr = S < 140 ? 7 : 8.5;
    ctx.beginPath();
    ctx.arc(c, c - rad + 1, nr, 0, TAU);
    ctx.fillStyle = PAL.paper;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = PAL.seal;
    ctx.font = `${Math.round(nr * 1.35)}px ${FONT.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('北', c, c - rad + 1.5);
  }

  function updateWhere() {
    const p = game.player;
    const w = game.world;
    if (p && w?.regionAt) {
      const f = p.vehicle || p;
      if (!(Math.abs(f.x - lastRegionPos.x) + Math.abs(f.y - lastRegionPos.y) <= 3)) {
        lastRegionPos = { x: f.x, y: f.y };
        const reg = safe(() => w.regionAt(f.x, f.y), null);
        setText(region, reg?.name || '');
      }
    }
    const t = game.sys.time;
    const wch = WEATHER[t?.weather];
    // sijin() 은 0~24 밖이나 NaN 이면 'undefined시' 를 돌려주므로 감싸 둔다
    const hr = ((Number(game.hour) % 24) + 24) % 24 || 0;
    const sj = sijin(hr);
    setText(clockEl, `${sj}${wch ? ` · ${wch[0]}` : ''}`);
    setAttr(clockEl, 'title', `${sj}${wch ? `, ${wch[1]}` : ''}${t?.day ? `, ${t.day}일째` : ''}`);
  }

  function updateObjective() {
    const txt = safe(() => game.sys.missions?.objectiveText?.(), '') || '';
    if (setText(objText, typeof txt === 'string' ? txt : String(txt))) {
      setHidden(obj, !txt);
      setAttr(obj, 'title', txt || null);
      if (txt) {
        obj.classList.remove('jx-flash');
        void obj.offsetWidth; // 애니메이션 다시 시작
        obj.classList.add('jx-flash');
      }
    }
  }

  // ---------------------------------------------------------------- 상호작용 안내
  function updatePrompts() {
    const pr = game.prompt || {};
    const touch = ui.isTouch;
    const list = [];
    if (pr.interact?.label) list.push(['interact', String(pr.interact.label)]);
    if (pr.enter?.label) list.push(['enter', String(pr.enter.label)]);
    const sig = list.map((e) => e.join(':')).join('|') + (touch ? '#t' : '#k');
    if (sig === promptSig) return;
    promptSig = sig;
    prompts.textContent = '';
    for (const [key, label] of list) {
      const cap = touch
        ? h('span', { class: 'jx-key jx-tkey', text: key === 'interact' ? '행동' : '타기' })
        : h('span', { class: 'jx-key', text: key === 'interact' ? 'E' : 'F' });
      prompts.append(
        h(
          'button',
          {
            class: 'jx-prompt jx-in',
            type: 'button',
            tabIndex: -1,
            'aria-label': `${touch ? '' : (key === 'interact' ? 'E' : 'F') + ' 키: '}${label}`,
            onclick: () => {
              game.input.setVirtual(key, true);
              game.input.setVirtual(key, false);
            },
          },
          cap,
          h('span', { text: label })
        )
      );
    }
  }

  // ---------------------------------------------------------------- 탈것
  function gaitWord(v, p) {
    const sp = typeof v.speed === 'number' ? v.speed : Math.hypot(v.vx || 0, v.vy || 0);
    const a = Math.abs(sp);
    const driving = v.driver === p;
    if (!driving) return a < 0.3 ? '멈춰 섬' : '타고 가는 중';
    if (sp < -0.15) return '뒷걸음';
    const ratio = a / (v.maxSpeed || 4);
    if (/horse|pony/.test(v.vtype || '')) {
      if (a < 0.25) return '멈춤';
      if (ratio < 0.35) return '걸음';
      if (ratio < 0.7) return '속보';
      if (ratio <= 1.03) return '구보';
      return '질주';
    }
    if (a < 0.25) return '멈춤';
    if (ratio < 0.4) return '느릿느릿';
    if (ratio <= 1.03) return '제 속도';
    return '힘껏';
  }

  function updateVehicle() {
    const p = game.player;
    const v = p?.vehicle;
    setClass(el, 'jx-riding', !!v);
    if (!v) {
      if (vehSig !== '') {
        vehSig = '';
        setHidden(veh, true);
      }
      return;
    }
    const st = typeof v.stamina === 'number' ? v.stamina : v.data?.stamina;
    const mx = v.maxStamina ?? v.data?.maxStamina ?? 100;
    const f = typeof st === 'number' ? clamp01(st / (mx || 1)) : -1;
    const gait = gaitWord(v, p);
    const sig = `${v.id}|${gait}|${Math.round(f * 50)}`;
    if (sig === vehSig) return;
    vehSig = sig;
    setHidden(veh, false);
    setText(vehName, v.displayName || '탈것');
    setText(vehGait, gait);
    setHidden(vehBar, f < 0);
    if (f >= 0) {
      setStyle(vehFill, 'transform', `scaleX(${f.toFixed(3)})`);
      setClass(vehBar, 'jx-low', f < 0.25);
    }
  }

  // ---------------------------------------------------------------- 디버그
  function updateDebug() {
    const on = !!game.debug;
    setHidden(debug, !on);
    if (!on) return;
    const s = game.stats || {};
    const p = game.player;
    const w = game.world;
    let terr = '-';
    if (p && w?.terrainAt) {
      const id = safe(() => w.terrainAt(p.x, p.y), '?');
      const info = safe(() => w.terrainInfo?.(id), null);
      terr = info?.name ? `${info.name} (${id})` : String(id);
    }
    const lines = [
      `FPS ${s.fps ?? '-'}`,
      `엔티티 그림 ${s.ents ?? '-'} / 전체 ${game.entities.length}`,
      `갱신 ${(s.upd ?? 0).toFixed(2)}ms · 그리기 ${(s.rnd ?? 0).toFixed(2)}ms`,
      p ? `좌표 ${p.x.toFixed(1)}, ${p.y.toFixed(1)}  각 ${(p.angle * 57.3).toFixed(0)}°` : '플레이어 없음',
      `지형 ${terr}`,
      `줌 ${game.camera.zoom.toFixed(1)} · 시간배율 ${game.timeScale.toFixed(2)}`,
      `시스템 ${game.systems.length} · 멈춤 [${[...game.pauseReasons].join(',')}]`,
    ];
    setText(debug, lines.join('\n'));
  }

  // ---------------------------------------------------------------- 캔버스 덧그림: 호안 비네트·위급 비네트·조준선
  function drawOverlay(ctx, dt) {
    const p = game.player;
    if (!p || game.state !== 'play') {
      hoanK = lowK = 0;
      return;
    }
    const cam = game.camera;
    const W = cam.viewW, H = cam.viewH;
    const hoanOn = !!game.sys.combat?.hoanActive || game.timeScale < 0.98;
    hoanK = clamp(hoanK + (hoanOn ? dt * 3 : -dt * 2), 0, 1);
    const hf = clamp01((p.hp ?? 100) / (p.maxHp || 100));
    const lowT = p.state === 'dead' ? 0 : hf < 0.3 ? 1 - hf / 0.3 : 0;
    lowK += (lowT - lowK) * Math.min(1, dt * 3);

    if (hoanK > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.56);
      g.addColorStop(0, rgba(PAL.gold, 0));
      g.addColorStop(0.62, rgba(PAL.gold, 0.16 * hoanK));
      g.addColorStop(1, rgba(mixHex(PAL.gold, PAL.ink, 0.4), 0.55 * hoanK));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = rgba(mixHex(PAL.gold, PAL.paper, 0.5), 0.22 * hoanK);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (lowK > 0.01) {
      const pulse = 0.85 + Math.sin(clock * 5) * 0.15;
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.58);
      g.addColorStop(0, rgba(PAL.blood, 0));
      g.addColorStop(1, rgba(PAL.blood, 0.45 * lowK * pulse));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    const aiming = !!p.aiming && !game.paused && p.state === 'normal';
    if (game.canvas?.style) setStyle(game.canvas, 'cursor', aiming && !ui.isTouch ? 'none' : '');
    if (!aiming) return;
    const inp = game.input;
    let mx = inp.mouse.sx, my = inp.mouse.sy;
    if (ui.isTouch || inp.lastDevice === 'touch' || !inp.mouse.inside) {
      const a = p.aimAngle ?? p.angle;
      const s = cam.worldToScreen(p.x + Math.cos(a) * 7, p.y + Math.sin(a) * 7);
      mx = s.x;
      my = s.y;
    }
    const firing = inp.mouseDown(0);
    const r = 11 + (firing ? 3 : 0);
    ctx.save();
    ctx.translate(mx, my);
    ctx.lineCap = 'round';
    for (const pass of [
      [4.4, rgba(PAL.paper, 0.75)],
      [2, PAL.ink],
    ]) {
      ctx.lineWidth = pass[0];
      ctx.strokeStyle = pass[1];
      ctx.beginPath();
      ctx.arc(0, 0, r, -2.75, -0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0.45, 2.55);
      ctx.stroke();
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3));
        ctx.lineTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
        ctx.stroke();
      }
    }
    ctx.fillStyle = PAL.seal;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- 매 프레임
  function update(dt) {
    clock += dt;
    for (let i = deltas.length - 1; i >= 0; i--) {
      if (clock > deltas[i].t) {
        deltas[i].el.remove();
        deltas.splice(i, 1);
      }
    }
    if (!visible) return;
    updateCores();
    updatePurse();
    updatePrompts();
    updateVehicle();
    if ((miniAcc += dt) >= 1 / 30) {
      drawMinimap(miniAcc);
      miniAcc = 0;
    }
    if ((whereAcc += dt) >= 0.3) {
      whereAcc = 0;
      updateWhere();
    }
    if ((objAcc += dt) >= 0.2) {
      objAcc = 0;
      updateObjective();
    }
    if ((dbgAcc += dt) >= 0.25) {
      dbgAcc = 0;
      updateDebug();
    }
    // 큰 지도 그림을 틈틈이 미리 만들어 둔다 (world.mapCanvas 가 없을 때만)
    if (!game.paused) warmMapImage(game, 1.2);
  }

  return {
    el,
    update,
    drawOverlay,
    get visible() {
      return visible;
    },
    setVisible(v) {
      v = !!v;
      if (v === visible) return;
      visible = v;
      setClass(el, 'jx-off', !v);
      el.setAttribute('aria-hidden', v ? 'false' : 'true');
      if (v) {
        miniAcc = whereAcc = objAcc = 1;
        markerT = -1;
        lastRegionPos = { x: NaN, y: NaN };
      } else if (game.canvas?.style) {
        // 조준하던 채로 처음 화면 등으로 가면 drawOverlay 가 안 불려 커서가 숨은 채 남는다
        setStyle(game.canvas, 'cursor', '');
      }
    },
    setDim(v) {
      if (v === dim) return;
      dim = !!v;
      setClass(el, 'jx-dim', dim);
    },
    refreshPrompts() {
      promptSig = '';
    },
  };
}
