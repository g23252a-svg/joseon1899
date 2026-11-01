// 지도 그리기: 바탕(바다·땅·산·강)은 한 번 그려 두고, 세력 색 층은 주인이 바뀔 때만 다시 그린다.
// 그 위에 고을 표식·이름·병력 깃발·선택 표시를 매 프레임 그린다.
import { buildGeo, proj } from '../core/geo.js';
import { REGIONS, REGION_BY_ID, PROVINCES } from '../data/regions.js';
import { hash, fmt } from '../core/util.js';

const BS = 2; // 바탕 해상도 배율
const INK = '#1d1b18';

export function createMap(canvas, opts) {
  const geo = buildGeo();
  const W = geo.W, H = geo.H;
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, ox: 0, oy: 0, w: 1, h: 1, dpr: 1 };
  const st = { selected: null, hover: null, targets: null, targetMode: null, arrows: [], dirty: true, ownersDirty: true, fontsReady: false };

  // Path2D(월드 좌표)
  const toPath = (pts) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p; };
  const landPath = new Path2D();
  for (const poly of geo.land) landPath.addPath(toPath(poly));
  const cellPath = {};
  for (const id in geo.cells) cellPath[id] = toPath(geo.cells[id].poly);
  const hitCtx = document.createElement('canvas').getContext('2d');

  // ── 바탕 ──
  const base = document.createElement('canvas');
  base.width = W * BS; base.height = H * BS;
  drawBase(base.getContext('2d'));
  const owners = document.createElement('canvas');
  owners.width = W * BS; owners.height = H * BS;

  function drawBase(g) {
    g.save();
    g.scale(BS, BS);
    // 바다
    const sea = g.createLinearGradient(0, 0, W, H);
    sea.addColorStop(0, '#cdd6cf'); sea.addColorStop(1, '#c3cfcb');
    g.fillStyle = sea; g.fillRect(0, 0, W, H);
    // 물결
    g.strokeStyle = 'rgba(60, 90, 100, 0.13)'; g.lineWidth = 0.8;
    for (let y = 8; y < H; y += 14) {
      for (let x = (y / 14) % 2 ? 0 : 9; x < W; x += 18) {
        if (hash(x * 13 + y * 7) < 0.45) continue;
        g.beginPath(); g.arc(x, y, 4, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      }
    }
    // 이웃 땅
    for (const poly of geo.foreign) {
      g.fillStyle = '#ddd6c4'; g.fill(toPath(poly));
      g.save(); g.clip(toPath(poly));
      g.strokeStyle = 'rgba(29,27,24,0.07)'; g.lineWidth = 1;
      for (let i = -H; i < W; i += 7) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke(); }
      g.restore();
      g.strokeStyle = 'rgba(29,27,24,0.35)'; g.lineWidth = 1; g.stroke(toPath(poly));
    }
    g.fillStyle = 'rgba(29,27,24,0.32)';
    g.font = '400 20px "Song Myung", serif'; g.textAlign = 'center';
    g.fillText('遼東', 40, 330); g.fillText('滿洲', 300, 60); g.fillText('沿海州', 655, 230);
    g.fillText('日本', 650, 1230); g.font = '400 13px "Song Myung", serif'; g.fillText('對馬', 552, 1090);
    // 바닷가 번짐
    g.save();
    g.strokeStyle = 'rgba(60, 90, 100, 0.16)'; g.lineWidth = 9; g.lineJoin = 'round';
    g.stroke(landPath);
    g.strokeStyle = 'rgba(60, 90, 100, 0.12)'; g.lineWidth = 18; g.stroke(landPath);
    g.restore();
    // 땅
    g.fillStyle = '#efe6d2'; g.fill(landPath);
    g.save(); g.clip(landPath);
    for (let i = 0; i < 5000; i++) {
      const x = hash(i * 3 + 1) * W, y = hash(i * 7 + 2) * H;
      g.fillStyle = `rgba(120, 95, 60, ${0.03 + hash(i * 11) * 0.05})`;
      g.fillRect(x, y, 1 + hash(i) * 2, 1);
    }
    // 도(道) 이름을 옅게
    const provC = {};
    for (const r of REGIONS) { const [x, y] = proj(r.lon, r.lat); (provC[r.prov] ||= []).push([x, y]); }
    g.fillStyle = 'rgba(29,27,24,0.07)'; g.font = '400 54px "Song Myung", serif'; g.textAlign = 'center';
    for (const p in provC) {
      const pts = provC[p];
      const x = pts.reduce((s, q) => s + q[0], 0) / pts.length, y = pts.reduce((s, q) => s + q[1], 0) / pts.length;
      g.fillText(PROVINCES[p].hanja, x + (p === 'jeolla' ? -20 : 0), y + 18 + (p === 'jeolla' ? -40 : 0));
    }
    // 산
    for (const m of geo.mountains) drawMountain(g, m.x, m.y, m.big, hash(Math.round(m.x * 7 + m.y)));
    // 강
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const rv of geo.rivers) {
      const p = new Path2D(); rv.pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      g.strokeStyle = 'rgba(70, 105, 125, 0.30)'; g.lineWidth = rv.border ? 5 : 3.5; g.stroke(p);
      g.strokeStyle = 'rgba(55, 90, 110, 0.85)'; g.lineWidth = rv.border ? 1.8 : 1.3; g.stroke(p);
    }
    g.restore();
    // 해안선
    g.strokeStyle = 'rgba(29,27,24,0.85)'; g.lineWidth = 1.5; g.stroke(landPath);
    // 산 이름
    g.fillStyle = 'rgba(29,27,24,0.42)'; g.font = '400 10px "Gowun Batang", serif'; g.textAlign = 'center';
    for (const m of geo.mountains) if (m.name) g.fillText(m.name, m.x, m.y + 14 * m.big);
    g.restore();
  }
  function drawMountain(g, x, y, big, h0) {
    const n = 2 + Math.floor(h0 * 3);
    for (let i = 0; i < n; i++) {
      const hx = x + (i - (n - 1) / 2) * 9 * big + (hash(i * 31 + h0 * 1000) - 0.5) * 4;
      const hh = (10 + hash(i * 17 + h0 * 99) * 9) * big * (i === Math.floor(n / 2) ? 1.25 : 1);
      const hw = hh * 0.85;
      const gr = g.createLinearGradient(hx, y - hh, hx, y);
      gr.addColorStop(0, 'rgba(29,27,24,0.55)'); gr.addColorStop(1, 'rgba(29,27,24,0.0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(hx - hw, y); g.quadraticCurveTo(hx - hw * 0.3, y - hh * 0.6, hx, y - hh); g.quadraticCurveTo(hx + hw * 0.35, y - hh * 0.55, hx + hw, y); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(29,27,24,0.7)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(hx - hw * 0.9, y - 1); g.quadraticCurveTo(hx - hw * 0.3, y - hh * 0.6, hx, y - hh); g.quadraticCurveTo(hx + hw * 0.2, y - hh * 0.7, hx + hw * 0.55, y - hh * 0.35); g.stroke();
    }
  }

  // ── 세력 색 층 ──
  function drawOwners() {
    const S = opts.getState();
    const g = owners.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, owners.width, owners.height);
    if (!S) return;
    g.save(); g.scale(BS, BS); g.clip(landPath);
    for (const id in cellPath) {
      const r = S.regions[id];
      if (r.owner) {
        g.fillStyle = hexA(S.factions[r.owner].color, 0.4);
        g.fill(cellPath[id]);
      } else if (r.rebels) {
        g.save(); g.clip(cellPath[id]);
        g.strokeStyle = 'rgba(168,50,42,0.25)'; g.lineWidth = 2;
        const c = geo.cells[id];
        for (let i = -80; i < 80; i += 6) { g.beginPath(); g.moveTo(c.x + i - 60, c.y - 60); g.lineTo(c.x + i + 60, c.y + 60); g.stroke(); }
        g.restore();
      } else {
        g.fillStyle = 'rgba(120, 110, 90, 0.07)'; g.fill(cellPath[id]);
      }
    }
    // 고을 경계
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const e of geo.edgeList) {
      const same = S.regions[e.a].owner === S.regions[e.b].owner;
      const p = new Path2D(); e.pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      if (same) { g.strokeStyle = 'rgba(29,27,24,0.22)'; g.lineWidth = 0.8; g.setLineDash([3, 3]); g.stroke(p); g.setLineDash([]); }
      else { g.strokeStyle = 'rgba(29,27,24,0.72)'; g.lineWidth = 2; g.stroke(p); }
    }
    g.restore();
  }

  // ── 화면 ──
  function resize() {
    const rect = canvas.getBoundingClientRect();
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.w = Math.max(1, rect.width); view.h = Math.max(1, rect.height);
    canvas.width = Math.round(view.w * view.dpr); canvas.height = Math.round(view.h * view.dpr);
    st.dirty = true;
  }
  function fit() {
    resize();
    const s = Math.min(view.w / (W * 0.82), view.h / (H * 0.98));
    view.scale = s;
    view.ox = (view.w - W * s) / 2 - W * 0.04 * s;
    view.oy = (view.h - H * s) / 2;
    clampView();
    st.dirty = true;
  }
  function clampView() {
    const mw = W * view.scale, mh = H * view.scale;
    const pad = 80;
    view.ox = Math.min(view.w - pad, Math.max(pad - mw, view.ox));
    view.oy = Math.min(view.h - pad, Math.max(pad - mh, view.oy));
  }
  const toWorld = (sx, sy) => [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale];
  const toScreen = (x, y) => [x * view.scale + view.ox, y * view.scale + view.oy];
  function zoomAt(sx, sy, k) {
    const [wx, wy] = toWorld(sx, sy);
    const minS = Math.min(view.w / W, view.h / H) * 0.7;
    view.scale = Math.max(minS, Math.min(5, view.scale * k));
    view.ox = sx - wx * view.scale; view.oy = sy - wy * view.scale;
    clampView();
    st.dirty = true;
  }
  function focus(id, zoom) {
    const c = geo.cells[id];
    if (!c) return;
    if (zoom) view.scale = Math.max(view.scale, Math.min(view.w / W, view.h / H) * zoom);
    view.ox = view.w * 0.45 - c.x * view.scale;
    view.oy = view.h * 0.42 - c.y * view.scale;
    clampView();
    st.dirty = true;
  }
  function regionAtScreen(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    if (!geo.onLand(wx, wy)) return null;
    for (const id of geo.nearestSeeds(wx, wy, 4)) if (hitCtx.isPointInPath(cellPath[id], wx, wy)) return id;
    return geo.regionAt(wx, wy);
  }

  function draw(now) {
    const S = opts.getState();
    if (st.ownersDirty) { drawOwners(); st.ownersDirty = false; }
    const { dpr, scale, ox, oy } = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#c6d0ca'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, ox, oy, W * scale, H * scale);
    ctx.drawImage(owners, ox, oy, W * scale, H * scale);
    if (!S) return;
    // 월드 좌표로 강조 그리기
    ctx.save();
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.save(); ctx.clip(landPath);
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    if (st.targets) {
      for (const id of st.targets) {
        ctx.fillStyle = st.targetMode === 'move' ? `rgba(47, 74, 92, ${0.15 + pulse * 0.18})` : `rgba(168, 50, 42, ${0.15 + pulse * 0.2})`;
        ctx.fill(cellPath[id]);
      }
    }
    if (st.hover && st.hover !== st.selected) { ctx.strokeStyle = 'rgba(29,27,24,0.5)'; ctx.lineWidth = 2 / scale; ctx.stroke(cellPath[st.hover]); }
    if (st.selected) {
      ctx.strokeStyle = 'rgba(168, 50, 42, 0.35)'; ctx.lineWidth = 9 / scale; ctx.stroke(cellPath[st.selected]);
      ctx.strokeStyle = '#a8322a'; ctx.lineWidth = 2.6 / scale; ctx.stroke(cellPath[st.selected]);
    }
    ctx.restore();
    // 출진 화살표
    st.arrows = st.arrows.filter((a) => now - a.t0 < 1800);
    for (const a of st.arrows) drawArrow(ctx, a, (now - a.t0) / 1800, scale);
    ctx.restore();
    // 화면 좌표로 고을 표식
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMarkers(S, scale);
    if (st.targets || st.arrows.length) st.dirty = true;
  }
  function drawArrow(g, a, t, scale) {
    const A = geo.cells[a.from], B = geo.cells[a.to];
    const k = Math.min(1, t * 1.6);
    const x = A.x + (B.x - A.x) * k, y = A.y + (B.y - A.y) * k;
    g.globalAlpha = t < 0.8 ? 1 : (1 - t) / 0.2;
    g.strokeStyle = a.color || '#a8322a'; g.lineWidth = 5 / scale; g.lineCap = 'round';
    g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(x, y); g.stroke();
    const ang = Math.atan2(B.y - A.y, B.x - A.x);
    g.fillStyle = a.color || '#a8322a';
    g.beginPath(); g.moveTo(x + Math.cos(ang) * 10 / scale * 1.6, y + Math.sin(ang) * 10 / scale * 1.6);
    g.lineTo(x + Math.cos(ang + 2.5) * 12 / scale, y + Math.sin(ang + 2.5) * 12 / scale);
    g.lineTo(x + Math.cos(ang - 2.5) * 12 / scale, y + Math.sin(ang - 2.5) * 12 / scale);
    g.closePath(); g.fill();
    g.globalAlpha = 1;
  }
  function drawMarkers(S, scale) {
    const small = scale < 0.62;
    const tiny = scale < 0.42;
    const fsz = Math.round(Math.max(11, Math.min(17, 12 * Math.sqrt(scale / 0.8))));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const r0 of REGIONS) {
      const id = r0.id;
      const r = S.regions[id];
      const c = geo.cells[id];
      const [x, y] = toScreen(c.x, c.y);
      if (x < -60 || y < -60 || x > view.w + 60 || y > view.h + 60) continue;
      const f = r.owner ? S.factions[r.owner] : null;
      const isCap = f && f.capital === id;
      // 성 표식
      const sz = isCap ? 9 : 6.5;
      ctx.fillStyle = f ? f.color : r.rebels ? '#a8322a' : '#8a8274';
      ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.rect(x - sz, y - sz * 0.6, sz * 2, sz * 1.25); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - sz * 1.35, y - sz * 0.55); ctx.quadraticCurveTo(x, y - sz * 1.7, x + sz * 1.35, y - sz * 0.55); ctx.closePath();
      ctx.fillStyle = INK; ctx.fill();
      if (isCap) { ctx.fillStyle = '#c9a227'; ctx.beginPath(); ctx.arc(x, y - sz * 1.75, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      if (r.build || (f?.wonder?.region === id)) { ctx.fillStyle = '#a8652a'; ctx.beginPath(); ctx.arc(x + sz + 3, y - sz, 3, 0, Math.PI * 2); ctx.fill(); }
      if (tiny) continue;
      // 이름
      const label = r0.name;
      ctx.font = `700 ${fsz}px "Gowun Batang", serif`;
      const ly = y + sz + fsz * 0.75;
      ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(239, 230, 210, 0.92)'; ctx.strokeText(label, x, ly);
      ctx.fillStyle = INK; ctx.fillText(label, x, ly);
      // 병력 깃발
      if (!small || id === st.selected) {
        const txt = fmt(r.troops);
        ctx.font = `700 ${Math.max(10, fsz - 2)}px "Gowun Batang", serif`;
        const tw = ctx.measureText(txt).width + 10;
        const fx = x + sz + 4, fy = y - sz - 15;
        ctx.fillStyle = 'rgba(247, 241, 227, 0.95)'; ctx.strokeStyle = 'rgba(29,27,24,0.6)'; ctx.lineWidth = 1;
        roundRect(ctx, fx, fy, tw + 4, 15, 3); ctx.fill(); ctx.stroke();
        ctx.fillStyle = f ? f.color : '#8a8274'; ctx.fillRect(fx + 1, fy + 1, 3, 13);
        ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.fillText(txt, fx + 7, fy + 8); ctx.textAlign = 'center';
        // 장수 수
        const n = Object.values(S.officers).filter((o) => o.status === 'active' && o.loc === id).length;
        if (n && !small) {
          ctx.fillStyle = INK;
          for (let i = 0; i < Math.min(n, 6); i++) { ctx.beginPath(); ctx.arc(fx + 5 + i * 5, fy + 19, 1.8, 0, Math.PI * 2); ctx.fill(); }
          if (n > 6) { ctx.font = `700 9px sans-serif`; ctx.textAlign = 'left'; ctx.fillText('+' + (n - 6), fx + 35, fy + 19.5); ctx.textAlign = 'center'; }
        }
      }
    }
  }

  // ── 입력 ──
  const pointers = new Map();
  let drag = null, pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 1) drag = { x: e.offsetX, y: e.offsetY, ox: view.ox, oy: view.oy, moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.scale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = (pinch.s * (d / pinch.d)) / view.scale;
      zoomAt(pinch.mx, pinch.my, k);
      return;
    }
    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (drag.moved) {
        canvas.classList.add('dragging');
        view.ox = drag.ox + dx; view.oy = drag.oy + dy; clampView(); st.dirty = true;
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const id = regionAtScreen(e.offsetX, e.offsetY);
      if (id !== st.hover) { st.hover = id; st.dirty = true; opts.onHover?.(id, e.offsetX, e.offsetY); }
      else if (id) opts.onHover?.(id, e.offsetX, e.offsetY);
    }
  });
  const end = (e) => {
    const wasDrag = drag?.moved;
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (pointers.size < 2) pinch = null;
    if (drag && !wasDrag && e.type === 'pointerup') {
      const id = regionAtScreen(e.offsetX, e.offsetY);
      opts.onSelect?.(id);
    }
    drag = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (st.hover) { st.hover = null; st.dirty = true; opts.onHover?.(null); } });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  canvas.addEventListener('dblclick', (e) => zoomAt(e.offsetX, e.offsetY, 1.6));
  window.addEventListener('resize', () => { const cx = view.w / 2, cy = view.h / 2; const [wx, wy] = toWorld(cx, cy); resize(); view.ox = view.w / 2 - wx * view.scale; view.oy = view.h / 2 - wy * view.scale; clampView(); });

  function loop(now) {
    if (st.dirty) { st.dirty = false; draw(now); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  document.fonts?.ready?.then(() => { const g = base.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, base.width, base.height); drawBase(g); st.dirty = true; });

  return {
    fit, resize, focus,
    zoom: (k) => zoomAt(view.w / 2, view.h / 2, k),
    render() { st.dirty = true; },
    invalidateOwners() { st.ownersDirty = true; st.dirty = true; },
    select(id) { st.selected = id; st.dirty = true; },
    setTargets(ids, mode) { st.targets = ids && ids.length ? new Set(ids) : null; st.targetMode = mode; st.dirty = true; },
    arrow(from, to, color) { st.arrows.push({ from, to, color, t0: performance.now() }); st.dirty = true; },
    get selected() { return st.selected; },
  };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
export { REGION_BY_ID };
