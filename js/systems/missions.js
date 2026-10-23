// 미션 엔진 [미션]: 목표 판정·표식·일지·달력(스펙 0.2)·길거리 사건(H.4)·도감 문구(K).
// 데이터: data/story.js (MISSIONS·EVENTS·CODEX·DATE_FLAGS), data/npcs.js (NPCS·EXTRAS).
// 공개 API (ARCHITECTURE §5): MISSIONS active start(id) complete() fail(reason) objectiveText() markers() available() journal() isDone(id)
// 추가: onTalk(npc)→bool (npcs.js 가 E 대화 때 먼저 부른다), codex()→[{id,title,text}], debugSkip(), date(), advanceTo('YYYY-MM-DD HH:MM'),
//       목표 타입 act{x,y,r,label,secs,flag,pick}(E 행동). 이벤트 mission:start/step/complete/fail, calendar:date {date}.
// 다른 시스템은 모두 옵셔널 체이닝으로 부른다. 없으면 그 단계는 대안(skipTp·도착 판정)으로 넘어간다.

import { LAYER } from '../engine/game.js';
import { Entity } from '../engine/entity.js';
import { FONT, PAL } from '../engine/palette.js';
import { angleWrap, clamp, closestOnPolyline, pointAtDistance, rand } from '../engine/util.js';
import { Human, makeLook } from '../entities/human.js';
import { CODEX, DATE_FLAGS, EVENTS, MAP_FLAGS, MISSIONS, START_DATE } from '../data/story.js';
import { NPCS, NPC_DEFS } from '../data/npcs.js';

const DAY = 864e5;
const dN = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
const dS = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const hm = (s) => +s.slice(0, 2) + +s.slice(3, 5) / 60;
const BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
const RAIL_V = new Set(['tram', 'train', 'steamer']);
const NEED = { mount: 'vehicles', ride: 'vehicles', skin: 'animals', buy: 'shops', collect: 'inventory', gather: 'loot', craft: 'crafting' };
const LOOK_ROLE = { chongsun: 'sungeom', bounty_hunter: 'bandit', bandit_boss: 'bandit', hunter: 'villager' };
const near = (e, x, y, r) => !!e && Math.hypot(e.x - x, e.y - y) <= r;
const isDown = (e) => !!e && (e.dead === true || e.state === 'dead' || e.state === 'down');
const line1 = (text) => [{ speaker: '', text }];

/** M12 선로 위 통나무 (열차 장애물) */
class Log extends Entity {
  constructor(x, y) {
    super({ x, y, radius: 1.2, static: true, solid: true, tags: ['rail_obstacle'], layer: LAYER.LOW, name: '통나무' });
    this.kind = 'obstacle';
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(0.12);
    ctx.fillStyle = PAL.timber;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.05;
    for (const o of [-0.3, 0.32]) {
      ctx.fillRect(-2.2, o - 0.22, 4.4, 0.44);
      ctx.strokeRect(-2.2, o - 0.22, 4.4, 0.44);
    }
    ctx.restore();
  }
}

export function install(game) {
  const g = game, S = g.sys;
  const done = new Set(), failed = new Set(), evCool = {}, evRoll = {}, timers = [], stray = [], cache = new Map(), missAt = new Map();
  let st = null, last = null, ev = null, resume = null, newGame = false, clock = 0, slow = 0, slow2 = 0, evClock = 0, avail = [], availT = -1;
  const P = () => g.player;
  const ui = () => S.ui;
  const cur = () => (st && st.step >= 0 ? st.def.steps[st.step] : null);

  // ------------------------------------------------------------ 조건·달력
  const date = () => g.flags.date || START_DATE;
  function canStart(m) {
    if (!m || done.has(m.id) || st?.id === m.id) return false;
    return (m.requires || []).every((r) => done.has(r)) && (!m.unlock || !!g.flags[m.unlock]);
  }
  function cond(c) {
    if (!c) return true;
    if (c === 'never') return false;
    if (c[0] === '!') return !cond(c.slice(1));
    const [k, id] = c.split(':');
    if (!id) return !!g.flags[c];
    if (k === 'done') return done.has(id);
    if (k === 'start') return done.has(id) || st?.id === id;
    return k === 'avail' ? canStart(BY_ID[id]) : false;
  }
  function setFlag(f, v, force) {
    const was = !!g.flags[f];
    g.flags[f] = v;
    if (MAP_FLAGS.includes(f) && (force || was !== !!v)) g.world?.setMapState?.(f, !!v);
  }
  function applyDate(force) {
    const n = dN(date());
    for (const [f, a, b] of DATE_FLAGS) {
      const on = n >= dN(a) && (!b || n <= dN(b));
      if (on !== !!g.flags[f]) setFlag(f, on);
    }
    if (force) for (const f of MAP_FLAGS) if (g.flags[f]) g.world?.setMapState?.(f, true);
  }
  function setDate(n) {
    g.flags.date = dS(n);
    applyDate();
    g.emit('calendar:date', { date: g.flags.date });
  }
  /** 본편 보호: 아직 시작 안 한 다음 본편 미션 날짜의 전날까지만 */
  function dayCap() {
    if (g.flags.ch1_done) return Infinity;
    const m = MISSIONS.find((m) => m.chapter != null && m.date && !m.chain && !done.has(m.id) && st?.id !== m.id);
    return m ? dN(m.date) - 1 : Infinity;
  }
  function jumpTo(ds, ts) {
    const t = S.time, n0 = dN(date()), days = ds ? dN(ds) - n0 : 0, h = ts ? hm(ts) : null;
    if (days > 0) {
      if (t) t.day += days;
      setDate(n0 + days);
      if (h != null) t?.setHour?.(h);
    } else if (days === 0 && h != null && t && h > t.hour + 0.01) t.setHour?.(h);
    return Math.max(0, days);
  }
  const dateText = () => { const d = date(); return `${+d.slice(0, 4)}년 ${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`; };
  function setWeather(o) {
    const t = S.time;
    if (!t || !o) return;
    if (o.weather) t.forceWeather ? t.forceWeather(o.weather, 8) : t.setWeather?.(o.weather, { instant: true, lock: true });
    if (o.wind) t.forceWind ? t.forceWind(o.wind[0], o.wind[1], 8) : t.wind && Object.assign(t.wind, { angle: o.wind[0], strength: o.wind[1] });
  }

  // ------------------------------------------------------------ 대사·효과
  function say(lines, opts) {
    if (typeof lines === 'function') lines = lines(g, M);
    return lines?.length && ui()?.dialogue ? ui().dialogue(lines, opts) : Promise.resolve();
  }
  const chat = (lines) => say(lines, { pause: false, auto: 3.5 });
  function choice(q, opts, o) {
    return ui()?.choice ? Promise.resolve(ui().choice(q, opts, o)).then((i) => (i >= 0 ? i : 0)) : Promise.resolve(0);
  }
  async function doChoice(c) {
    const k = await choice(c.q, c.opts.map((o) => o.t), c.speaker ? { speaker: c.speaker } : undefined);
    const o = c.opts[k] || c.opts[0];
    fx(o.fx);
    o.run?.(g, M);
    await say(o.say);
  }
  function crime(kind) {
    const p = P();
    g.emit('crime', { kind, x: p?.x ?? 0, y: p?.y ?? 0, offender: p, victim: null, scripted: true });
  }
  function fx(f) {
    if (!f) return;
    if (Array.isArray(f)) return f.forEach(fx);
    const inv = S.inventory, wd = S.wanted;
    if (f.money > 0) inv?.addMoney?.(f.money, 'mission');
    else if (f.money < 0) inv?.spendMoney?.(Math.min(-f.money, inv.money ?? 0));
    if (f.honor) wd?.addHonor?.(f.honor, 'mission');
    for (const [id, n] of f.items || []) inv?.add?.(id, n);
    for (const [id, n] of f.remove || []) { const c = inv?.count?.(id) ?? 0; if (c > 0) inv.remove?.(id, Math.min(n, c)); }
    for (const k of f.flags || []) setFlag(k, true);
    for (const k in f.set || {}) setFlag(k, f.set[k]);
    for (const k in f.xp || {}) S.skills?.addXP?.(k, f.xp[k], 'mission');
    if (f.wanted) wd?.set ? wd.set(...f.wanted) : crime(f.crime || f.wanted[2]);
    else if (f.crime) crime(f.crime);
    if (f.pardon) { wd?.clear?.('pardon'); if (wd && 'bounty' in wd) wd.bounty = 0; }
  }
  function later(sec, fn) { timers.push({ t: sec, fn }); }

  // ------------------------------------------------------------ 인물·탈것
  function npc(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    let h = cache.get(id);
    if (h && h.alive) return h;
    if (clock - (missAt.get(id) ?? -9) < 1) return null;
    h = S.npcs?.named?.(id) || g.byId(id);
    if (!h || !h.alive || h.kind !== 'human') h = g.entities.find((e) => e.alive && e.kind === 'human' && (e.npcId === id || e.data?.npcId === id)) || null;
    if (h) { cache.set(id, h); if (h.data && !h.data.npcId) h.data.npcId = id; } else missAt.set(id, clock);
    return h;
  }
  const match = (e, id) => !!e && !!id && (e === npc(id) || e.id === id || e.npcId === id || e.data?.npcId === id);
  function makeNpc(d) {
    const def = { ...d, tags: [...(d.tags || []), ...(d.tag ? [d.tag] : [])], hidden: false };
    if (d.hostile) def.target = P();
    let h = null;
    try { h = S.npcs?.spawn?.(def) || null; } catch (err) { console.warn('[missions] npcs.spawn', d.id || d.role, err?.message); }
    if (!h) h = g.add(new Human({ ...def, look: makeLook(LOOK_ROLE[def.role] || def.role, def.look || {}), brain: null }));
    h.hidden = false;
    if (d.id) { h.data.npcId = d.id; cache.set(d.id, h); missAt.delete(d.id); }
    for (const t of def.tags) h.tags.add(t);
    if (d.essential) h.essential = true;
    if (d.fleeAt) h.fleeAt = d.fleeAt;
    if (d.speedRun) { h.speedRun = d.speedRun; h.speedSprint = d.speedSprint || d.speedRun; }
    if (d.hp) h.maxHp = h.hp = d.hp;
    if (d.hostile) h.tags.add('hostile');
    if (d.weapon && !h.weapon) S.combat?.equip?.(h, d.weapon);
    if (d.torch && Array.isArray(g.lights)) g.lights.push({ ent: h, get x() { return h.x; }, get y() { return h.y; }, r: 7, color: PAL.lantern, intensity: 0.8 });
    return h;
  }
  function ensure(id, x, y) {
    let h = npc(id);
    if (!h) { const d = NPC_DEFS[id] || { id, name: id, role: 'villager', faction: 'civilian' }; h = makeNpc({ ...d, x: x ?? d.x, y: y ?? d.y }); }
    else if (x != null) tp(h, x, y);
    if (h.state === 'dead' && NPC_DEFS[id]?.essential) h.revive?.(h.maxHp || 100);
    h.hidden = false;
    h.solid = h.state !== 'dead' && !h.vehicle;
    st?.cast.add(id);
    return h;
  }
  function tp(e, x, y) {
    if (!e || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (e.kind === 'human' && e.vehicle) e.vehicle.exit(e, g, { force: true, silent: true });
    if (e.static) g.moveStatic(e, x, y);
    else { e.x = x; e.y = y; }
    e.vx = e.vy = 0;
    if ('speed' in e) e.speed = 0;
    e.placeOccupants?.();
    if (e.home) e.home = { x, y };
    if (e === P() || e.hasPlayer) g.camera?.snap?.(x, y);
  }
  function spawnVehicle(vt, x, y, a = 0, o = {}) {
    try { return S.vehicles?.spawn?.(vt, x, y, a, o) || null; } catch (err) { console.warn('[missions] vehicles.spawn', vt, err?.message); return null; }
  }
  function track(e, s) {
    if (!e) return null;
    if (s?.tag) e.tags?.add(s.tag);
    if (!s?.keep) (st ? st.ents : ev ? ev.ents : stray).push(e);
    return e;
  }
  function kill(e) {
    if (e.kind === 'human' && e.vehicle) e.vehicle.exit(e, g, { force: true, silent: true });
    e.ejectAll?.(g);
    if (Array.isArray(g.lights)) for (let i = g.lights.length - 1; i >= 0; i--) if (g.lights[i].ent === e) g.lights.splice(i, 1);
    e.alive = false;
  }
  const vehicle = (tag) => g.findByTag(tag).find((e) => e.kind === 'vehicle' && !e.wrecked) || null;
  const dismount = (h) => h?.vehicle?.exit(h, g, { force: true });
  function board(who, v, role = 'passenger') {
    const h = typeof who === 'string' ? ensure(who) : who;
    if (!h || !v || h.vehicle === v) return;
    let i = v.freeSeatIndex(role);
    if (i < 0) i = v.freeSeatIndex();
    if (i < 0) return;
    if (h.vehicle) h.vehicle.exit(h, g, { force: true, silent: true });
    v.enter(h, g, i);
  }
  function mountNew(h, vt) {
    if (!h || h.vehicle) return;
    const v = track(spawnVehicle(vt, h.x + 1.2, h.y, h.angle || 0, { owner: h.data?.npcId || 'npc' }), {});
    if (v) v.enter(h, g, Math.max(0, v.freeSeatIndex('driver')));
  }
  function spawnV(s, x, y) {
    if (s.horse && S.vehicles?.playerHorse) { const h = S.vehicles.playerHorse; tp(h, x, y); return h; }
    const v = spawnVehicle(s.vehicle, x, y, s.angle || 0, { owner: s.owner ?? 'public', name: s.name, line: s.line, parked: s.parked, cargo: s.cargo, mission: st?.id });
    const crew = (c) => (typeof c === 'string' ? ensure(c, x, y) : c.npc ? npcSpawn(c, x, y) : track(makeNpc({ ...c, x, y }), c));
    if (!v) { for (const c of [s.driver, ...(s.passengers || [])]) if (c && typeof c === 'object') crew(c); return null; }
    if (s.name) v.name = s.name;
    const d = s.driverNpc ? ensure(s.driverNpc, x, y) : s.driver ? crew(s.driver) : null;
    if (d) board(d, v, 'driver');
    for (const c of s.passengers || []) board(crew(c), v);
    if (s.mount) board(P(), v, 'driver');
    if (s.chase) goto(v, null, null, s.chase);
    return v;
  }
  function npcSpawn(s, x, y) {
    const h = ensure(s.npc, x, y);
    if (s.look) h.look = makeLook(LOOK_ROLE[h.role] || h.role, s.look);
    if (s.tag) h.tags.add(s.tag);
    if (s.carry) carrier(h, s.carry);
    if (s.hostile) h.tags.add('hostile');
    if (s.weapon) S.combat?.equip?.(h, s.weapon);
    if (s.follow) follow(s.npc, s.follow, s.ride);
    else { if (s.ride) mountNew(h, s.ride); if (s.brain) setBrain(h, s.brain, s); }
    return h;
  }
  function spawn(specs, from = 0) {
    if (typeof specs === 'function') specs = specs(g, M);
    const out = [], p = P();
    for (const s of specs || []) {
      if (s.until != null && from >= s.until) continue;
      if (s.once && s.tag && g.findByTag(s.tag).some((e) => !isDown(e) && !e.wrecked)) continue;
      const pl = s.at === 'player' && p, bx = pl ? p.x + (s.dx ?? s.x ?? 0) : s.x, by = pl ? p.y + (s.dy ?? s.y ?? 0) : s.y;
      if (s.group) { for (const e of S.npcs?.spawnGroup?.(s.group, bx, by, s.n || 1, s) || []) out.push(track(e, s)); continue; }
      for (let i = 0; i < (s.npc ? 1 : s.n || 1); i++) {
        const j = s.spread || 0, x = bx + (j ? rand.range(-j, j) : 0), y = by + (j ? rand.range(-j, j) : 0);
        let e = null;
        if (s.npc) e = npcSpawn(s, x, y);
        else if (s.vehicle) e = track(spawnV(s, x, y), s);
        else if (s.animal) { try { e = track(S.animals?.spawn?.(s.animal, x, y) || null, s); } catch (err) { console.warn('[missions] animals.spawn', err?.message); } }
        else {
          e = track(makeNpc({ ...s, x, y }), s);
          if (s.ride) { mountNew(e, s.ride); setBrain(e, s.brain || 'idle', s); }
          if (s.carry) carrier(e, s.carry);
        }
        if (e) out.push(e);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ 두뇌 (따라가기·가기)
  function goBrain(tx, ty, dist = 3, thr = 1) {
    const tgt = () => (tx == null ? P()?.vehicle || P() : { x: tx, y: ty });
    return {
      kind: 'mission_go',
      update(h) {
        if (h.vehicle || h.state !== 'normal') return;
        const t = tgt(), dx = t.x - h.x, dy = t.y - h.y, d = Math.hypot(dx, dy);
        if (d <= dist) { h.moveX = h.moveY = 0; return; }
        h.moveX = dx / d;
        h.moveY = dy / d;
        h.gait = d > 14 ? 'sprint' : d > 6 ? 'run' : 'walk';
      },
      drive(v) {
        const t = tgt(), c = v.ctl, dx = t.x - v.x, dy = t.y - v.y, d = Math.hypot(dx, dy);
        if (d <= dist) { c.throttle = c.steer = 0; c.brake = true; return; }
        const df = angleWrap(Math.atan2(dy, dx) - v.angle);
        c.brake = false;
        c.steer = clamp(df * 2, -1, 1);
        c.throttle = thr * (Math.abs(df) > 1.2 ? 0.35 : 1);
        c.sprint = thr >= 1 && d > 30;
      },
    };
  }
  function setBrain(h, type, o = {}) {
    if (!h) return null;
    let b = null;
    try { b = S.npcs?.makeBrain?.(type, { ...o, home: { x: h.x, y: h.y }, target: o.hostile ? P() : o.target }) || null; } catch (err) { console.warn('[missions] makeBrain', type, err?.message); }
    if (h.vehicle?.driver === h && !b?.drive) b = Object.assign(b || {}, { drive: goBrain(null, null, o.hostile ? 6 : 8).drive });
    h.brain = b;
    return b;
  }
  function goto(e, x, y, dist = 3, thr = 1) {
    const h = e?.kind === 'vehicle' ? e.driver : e;
    if (h && !h.isPlayer) h.brain = goBrain(x, y, dist, thr);
  }
  function follow(id, dist = 4, ride) {
    if (!st) return;
    const h0 = npc(id);
    if (!dist) { st.fol.delete(id); if (h0) setBrain(h0, NPC_DEFS[id]?.brain || 'idle', NPC_DEFS[id] || {}); return; }
    const p = P(), h = !h0 || !near(h0, p.x, p.y, 80) ? ensure(id, p.x - 3, p.y + 2) : ensure(id);
    st.fol.set(id, { dist, hid: 0 });
    if (ride && h.vehicle?.moveMode === 'boat') dismount(h);
    if (ride && !h.vehicle) mountNew(h, ride);
    const v = h.vehicle;
    if (v && v.driver !== h) { if (v.driver && !v.driver.isPlayer) goto(v, null, null, dist + 2); return; }
    let b = null;
    if (!v) try { b = S.npcs?.makeBrain?.('follower', { target: p, leader: p, dist }) || null; } catch { b = null; }
    h.brain = b || goBrain(null, null, dist);
  }
  function folTick() {
    const p = P(), pv = p.vehicle;
    for (const [id, f] of st.fol) {
      const h = npc(id);
      if (!h || h.state === 'dead') continue;
      if (pv && RAIL_V.has(pv.vtype)) { if (!h.vehicle) { h.hidden = true; h.solid = false; h.x = p.x; h.y = p.y; f.hid = 1; } continue; }
      if (f.hid) { f.hid = 0; h.hidden = false; h.solid = true; tp(h, p.x - 2, p.y + 2); }
      const v = h.vehicle;
      if (pv && pv.moveMode === 'boat' && !v && near(h, p.x, p.y, 12) && pv.freeSeatIndex('passenger') >= 0) { board(h, pv); continue; }
      if (v && v.moveMode === 'boat' && v !== pv && !pv && v.driver !== h && near(h, p.x, p.y, 25)) { dismount(h); h.brain = goBrain(null, null, f.dist); continue; }
      const e = v ? (v === pv ? null : v) : h;
      if (e && !near(e, p.x, p.y, 60)) {
        const q = g.world?.randomPassableNear?.(p.x - Math.cos(p.angle) * 8, p.y - Math.sin(p.angle) * 8, 6, e.moveMode || 'foot') || { x: p.x - 4, y: p.y + 3 };
        tp(e, q.x, q.y);
      }
    }
  }
  function hide(id) {
    const h = npc(id);
    if (!h) return;
    dismount(h);
    h.hidden = true;
    h.solid = false;
    h.brain = null;
    st?.fol.delete(id);
    st?.cast.add(id);
  }

  // ------------------------------------------------------------ E 행동 (줍기·뒤지기·지점 행동)
  const allActs = () => (st ? st.acts : ev ? ev.acts : []);
  function act(a) { (st ? st.acts : ev?.acts)?.push(a); return a; }
  function give(id, n) {
    S.inventory?.add?.(id, n);
    if (st) st.picked[id] = (st.picked[id] || 0) + n;
    g.sfx('pickup');
  }
  function carrier(e, item) { if (st) act({ ent: e, item, label: '몸 뒤지기', secs: 1.2, show: () => isDown(e), run: () => give(item, 1) }); }
  function runAct(a) {
    if (a.busy) return;
    if (a.need && !a.need(g, M)) return g.notify(a.needText || '아직은 할 수 없다', 'warn');
    const fin = () => { const L = allActs(), i = L.indexOf(a); if (i >= 0) L.splice(i, 1); a.run?.(g, M); };
    if (!a.secs) return fin();
    const p = P();
    a.busy = 1;
    p.controlLocked = true;
    g.notify(`${a.label}…`, 'info');
    later(a.secs, () => { p.controlLocked = false; a.busy = 0; fin(); });
  }

  // ------------------------------------------------------------ 미션 흐름
  function mk(def) {
    return { id: def.id, def, title: def.title, step: -1, tok: 0, ckpt: 0, ckptPos: null, ents: [], cast: new Set(), fol: new Map(), acts: [], deaths: [], picked: {},
      hits: new Set(), fired: new Set(), busy: true, t: 0, count: 0, dead: 0 };
  }
  function start(id, o = {}) {
    const def = BY_ID[id];
    if (!def || st || (done.has(id) && !o.force)) return false;
    st = mk(def);
    failed.delete(id);
    run(st);
    return true;
  }
  async function run(s0) {
    const def = s0.def, p = P();
    if (def.id === 'pro01_ferry' && p) p.name = '한길';
    g.emit('mission:start', { id: def.id });
    g.sfx('mission_start');
    try {
      if (def.giver) await say(def.intro);
      if (st !== s0) return;
      const days = def.date ? dN(def.date) - dN(date()) : 0;
      if (days > 0 || def.fade || def.tp) await fadeJump(def.date, def.time, def.fade, def.tp);
      else if (def.time) jumpTo(def.date, def.time);
      setWeather(def);
      if (def.card) await say(line1(`(${def.card})`));
      if (!def.giver) await say(def.intro);
      if (st !== s0) return;
      def.begin?.(g, M);
      spawn(def.spawn, 0);
    } catch (err) { console.error('[missions start]', def.id, err); }
    if (st === s0) beginStep(0);
  }
  async function fadeJump(ds, ts, text, tpPos) {
    await ui()?.fade?.(true, 600);
    const days = jumpTo(ds, ts), p = P();
    if (tpPos && p) {
      dismount(p);
      tp(p, tpPos[0], tpPos[1]);
      const h = S.vehicles?.playerHorse;
      if (h && !h.hasPlayer && !h.wrecked) tp(h, tpPos[0] + 2.5, tpPos[1] + 1);
    }
    await ui()?.fade?.(false, 600);
    const card = text ? (text[0] === '(' ? text : `(${text})`) : days > 0 ? `(${days === 1 ? '이튿날' : `${days}일 뒤`}. ${dateText()})` : '';
    if (card) await say(line1(card));
  }
  async function fadeTp(f, fn) {
    await ui()?.fade?.(true, 500);
    const T = f.teleport || {};
    if (T.player) { dismount(P()); tp(P(), T.player[0], T.player[1]); }
    for (const id in T.npcs || {}) tp(ensure(id), ...T.npcs[id]);
    for (const tag in T.vehicles || {}) tp(vehicle(tag), ...T.vehicles[tag]);
    fn?.();
    await ui()?.fade?.(false, 500);
    if (f.text) await say(line1(`(${f.text})`));
  }
  const whenOk = (w) => { const v = g.flags[w.flag]; return 'eq' in w ? v === w.eq : 'ne' in w ? v !== w.ne : !!v; };
  async function beginStep(i) {
    if (!st) return;
    const def = st.def, s = def.steps[i];
    if (!s) return complete();
    const tok = ++st.tok;
    Object.assign(st, { step: i, t: 0, hits: new Set(), fired: new Set(), count: 0, picked: {}, aboard: 0, rideDone: 0, acted: 0, busy: true });
    st.acts = st.acts.filter((a) => a.step == null);
    if (s.when && !whenOk(s.when)) return beginStep(i + 1);
    if (def.checkpoint?.includes(i + 1)) { st.ckpt = i; st.ckptPos = { x: P().x, y: P().y }; }
    g.emit('mission:step', { id: st.id, step: i });
    const o = s.onStart || {};
    try {
      if (o.set) { if (o.set.time) jumpTo(null, o.set.time); setWeather(o.set); if (o.set.timeScale) g.timeScale = o.set.timeScale; }
      spawn(o.spawn);
      if (o.fade) await fadeTp(o.fade);
      if (st?.tok !== tok) return;
      s.start?.(g, M);
      await say(o.say);
      if (s.type !== 'talk') { await say(s.say); if (st?.tok === tok && s.choice) await doChoice(s.choice); }
    } catch (err) { console.error('[missions step]', st?.id, i, err); }
    if (st?.tok !== tok) return;
    if (s.hint) g.notify(s.hint, 'info');
    if (s.chat) chat(s.chat);
    setupStep(s, i);
    st.busy = false;
  }
  function setupStep(s, i) {
    const p = P();
    if (s.type === 'escort') follow(s.npcId, 4);
    if (s.type === 'talk') ensure(s.npcId);
    if (s.alt?.npcId) ensure(s.alt.npcId);
    if (s.type === 'collect' && s.at) {
      const q = s.at === 'player' ? { x: p.x + 1.5, y: p.y } : typeof s.at === 'string' ? linePt('train', +s.at.split(':')[1]) : { x: s.at[0], y: s.at[1] };
      act({ step: i, x: q.x, y: q.y, r: 2.5, item: s.itemId, label: s.label || '줍기', secs: s.secs, run: () => give(s.itemId, s.n || 1) });
    }
    if (s.type === 'act') {
      const put = () => act({ step: i, x: s.x, y: s.y, r: s.r || 3, label: s.label, secs: s.secs, need: s.need, needText: s.needText, run: () => (s.flag ? setFlag(s.flag, true) : (st.acted = 1)) });
      if (s.pick) act({ step: i, x: s.pick.x, y: s.pick.y, r: s.pick.r || 3, label: s.pick.label, secs: s.pick.secs, run: put });
      else put();
    }
  }
  async function completeStep() {
    if (!st) return;
    const s = cur(), tok = ++st.tok;
    st.busy = true;
    try {
      if (s.carryFirst && !st.acts.some((a) => a.item === s.carryFirst)) act({ x: P().x + 1.5, y: P().y, r: 2.5, item: s.carryFirst, label: '떨어진 물건 줍기', run: () => give(s.carryFirst, 1) });
      await say(s.onDone);
      if (st?.tok !== tok) return;
      fx(s.onDoneFx);
      s.done?.(g, M);
    } catch (err) { console.error('[missions done]', st?.id, err); }
    if (st?.tok === tok) beginStep(st.step + 1);
  }
  async function talk(s, alt) {
    if (!st || st.busy) return;
    const tok = st.tok, c = alt ? s.alt : s;
    st.busy = true;
    let ok = true;
    try {
      if (c.need && !c.need(g, M)) { ok = false; await say(c.needSay); return; }
      await say(c.say);
      for (const q of c.quiz || []) {
        for (let k = 0; ui()?.choice && st?.tok === tok && k < 20; k++) {
          if ((await choice(q.q, q.opts)) === q.a) break;
          await say(c.quizWrong || line1('(틀렸다. 다시.)'));
        }
      }
      if (c.choice && st?.tok === tok) await doChoice(c.choice);
      if (alt) fx(c.fx);
    } catch (err) { console.error('[missions talk]', err); } finally { if (st?.tok === tok) st.busy = false; }
    if (ok && st?.tok === tok) completeStep();
  }
  function onTalk(h) {
    if (!h) return false;
    if (st) {
      const s = cur();
      if (!s || st.busy) return false;
      if (s.type === 'talk' && match(h, s.npcId)) { talk(s, false); return true; }
      if (s.alt?.type === 'talk' && match(h, s.alt.npcId)) { talk(s, true); return true; }
      return false;
    }
    const m = available().find((a) => a.giver && match(h, a.giver));
    return m ? start(m.id) : false;
  }
  function complete() {
    if (!st || st.ending) return false;
    finish(st);
    return true;
  }
  async function finish(s0) {
    const def = s0.def, r = def.rewards || {};
    s0.ending = true;
    s0.busy = true;
    s0.tok++;
    try { await say(def.outro); } catch { /* 무시 */ }
    if (st !== s0) return;
    fx(r);
    try { def.after?.(g, M); } catch (err) { console.error('[missions after]', err); }
    done.add(def.id);
    failed.delete(def.id);
    g.sfx('mission_complete');
    g.emit('mission:complete', { id: def.id, rewards: r });
    cleanup();
    if (r.advanceTo) { const [d, t] = r.advanceTo.split(' '); await fadeJump(d, t, def.endCard); }
    if (def.epilogue) await say(typeof def.epilogue === 'function' ? def.epilogue(g, M) : def.epilogue);
    const nx = MISSIONS.find((m) => m.chain && m.requires?.includes(def.id) && canStart(m));
    if (nx && !st) start(nx.id);
  }
  function revive() {
    const p = P();
    if (!p) return;
    if (p.state === 'dead' || p.hp <= 0) { p.revive?.(p.maxHp || 100); p.state = 'normal'; }
    p.controlLocked = false;
  }
  function fail(reason = '그르쳤다') {
    if (!st || st.ending) return false;
    const def = st.def;
    st.tok++;
    st.busy = true;
    g.emit('mission:fail', { id: def.id, reason });
    if (def.checkpoint?.length) { const s0 = st; later(1.2, () => st === s0 && restart(st.ckpt, true)); return true; }
    failed.add(def.id);
    revive();
    cleanup();
    return true;
  }
  async function restart(i, toPos, quick) {
    if (!st) return;
    const tok = ++st.tok;
    st.busy = true;
    if (!quick) await ui()?.fade?.(true, 500);
    if (st?.tok !== tok) return;
    for (const e of st.ents) kill(e);
    st.ents = [];
    st.fol.clear();
    st.acts = [];
    st.dead = 0;
    revive();
    const p = P();
    if (toPos && st.ckptPos) { dismount(p); tp(p, st.ckptPos.x, st.ckptPos.y); }
    setWeather(st.def);
    spawn(st.def.spawn, i);
    if (!quick) await ui()?.fade?.(false, 500);
    if (st?.tok === tok) beginStep(i);
  }
  async function missTrain(m) {
    const tok = ++st.tok;
    st.busy = true;
    g.notify('열차를 놓쳤다', 'warn');
    await ui()?.fade?.(true, 600);
    if (st?.tok !== tok) return;
    jumpTo(dS(dN(date()) + 1), m.retry);
    if (m.pos) { dismount(P()); tp(P(), m.pos[0], m.pos[1]); }
    await ui()?.fade?.(false, 600);
    await say(line1(`(이튿날 ${m.retry}. 다시 해 보자.)`));
    if (st?.tok === tok) restart(m.step, false, true);
  }
  function cleanup() {
    if (!st) return;
    const s0 = st;
    last = st;
    st = null;
    const t = S.time;
    if (t && !t.forceWeather && (s0.def.weather || s0.def.wind)) t.weatherLocked = false;
    g.flags.npc_pays_fare = false;
    g.flags.hud_wind = false;
    const p = P();
    if (p) p.controlLocked = false;
    stray.push(...s0.ents);
    for (const id of new Set([...s0.cast, ...s0.fol.keys()])) {
      const h = npc(id);
      if (h) setBrain(h, NPC_DEFS[id]?.brain || 'idle', NPC_DEFS[id] || {});
    }
  }
  function goStep(i) {
    if (!st) return;
    st.busy = false;
    beginStep(i);
  }
  function debugSkip() {
    if (!st || st.ending || st.step < 0) return false;
    st.busy = false;
    completeStep();
    return true;
  }

  // ------------------------------------------------------------ 판정
  function stopPos(line, id) {
    const s = g.world?.lines?.[line]?.stops?.find((q) => q.id === id);
    return s ? { x: s.x, y: s.y } : null;
  }
  function linePt(line, d) {
    const L = g.world?.lines?.[line];
    return L?.points ? pointAtDistance(L.points, d, L.cum) : { x: 1560, y: 1808, angle: 0 };
  }
  function killCheck(s) {
    const p = P(), down = (e) => (s.lethal ? e.dead === true || e.state === 'dead' : isDown(e));
    const hit = (e) => {
      if (st.hits.has(e)) return;
      st.hits.add(e);
      if (s.carryFirst && st.hits.size === 1 && e.kind === 'human') carrier(e, s.carryFirst);
    };
    let alive = 0;
    if (s.tag) for (const e of g.findByTag(s.tag)) { if (down(e)) hit(e); else alive++; }
    else if (s.faction) for (const e of g.query(p.x, p.y, 80, (e) => e.faction === s.faction)) if (down(e)) hit(e);
    if (st.hits.size >= s.n) return true;
    if (s.tag && st.t > 3 && st.hits.size + alive < s.n) return true; // 대상이 모자라면 막히지 않게
    return !!s.species && !s.tag && !S.animals;
  }
  function check(s) {
    const p = P();
    if (NEED[s.type] && !S[NEED[s.type]]) {
      if (s.type !== 'ride') return 'skip';
      const q = stopPos(s.line, s.to);
      return !q || near(p, q.x, q.y, 30);
    }
    switch (s.type) {
      case 'reach': return near(p, s.x, s.y, s.r || 10);
      case 'mount': {
        const v = p.vehicle;
        return !!v && (!s.vtype || v.vtype === s.vtype) && (!s.moveMode || v.moveMode === s.moveMode) && (!s.role || v.seats?.[p.seatIndex]?.role === s.role);
      }
      case 'dismount': return !p.vehicle;
      case 'ride': {
        const v = p.vehicle, on = !!v && (v.vtype === s.line || v.line === s.line || v.line?.id === s.line);
        if (on) st.aboard = 1;
        if (st.rideDone) return true;
        const q = st.aboard && !on && stopPos(s.line, s.to);
        return !!q && near(p, q.x, q.y, 45);
      }
      case 'kill': return killCheck(s);
      case 'collect': return (S.inventory?.count?.(s.itemId) ?? 0) >= (s.n || 1) || (st.picked[s.itemId] || 0) >= (s.n || 1);
      case 'survive': case 'wait': return st.t >= s.seconds;
      case 'escort': {
        const h = npc(s.npcId), e = h?.vehicle || h;
        return !e || near(e, s.x, s.y, s.r) || (near(p, s.x, s.y, s.r) && near(e, p.x, p.y, 30));
      }
      case 'skin': case 'gather': case 'buy': case 'craft': return st.count >= (s.n || 1);
      case 'flag': return 'eq' in s ? g.flags[s.name] === s.eq : !!g.flags[s.name];
      case 'act': return s.flag ? !!g.flags[s.flag] : !!st.acted;
      case 'custom': return !!s.fn?.(g, M);
      default: return false;
    }
  }
  function trigTick(s) {
    (s.trig || []).forEach((tr, j) => {
      if (st.busy || st.fired.has(j) || (tr.delay && st.t < tr.delay)) return;
      const q = tr.rail != null ? linePt('train', tr.rail) : tr.x != null ? tr : null;
      if ((q && !near(P(), q.x, q.y, tr.r || 10)) || (tr.test && !tr.test(g, M))) return;
      st.fired.add(j);
      if (tr.chat) { tr.run?.(g, M); chat(tr.say); fx(tr.fx); return; }
      const tok = st.tok;
      st.busy = true;
      (async () => {
        await tr.run?.(g, M);
        await say(tr.say);
        if (tr.choice && st?.tok === tok) await doChoice(tr.choice);
        fx(tr.fx);
      })().catch((err) => console.error('[missions trig]', err)).finally(() => { if (st?.tok === tok) st.busy = false; });
    });
    (s.waves || []).forEach((w, j) => {
      const k = 'w' + j;
      if (st.fired.has(k) || st.t < (typeof w[0] === 'function' ? w[0](g) : w[0])) return;
      st.fired.add(k);
      typeof w[1] === 'function' ? w[1](g, M) : spawn(w[1]);
    });
  }
  function missionTick(dt) {
    if (st.dead) { if (clock - st.dead > 6) { st.dead = 0; fail('쓰러졌다'); } return; }
    const s = cur();
    if (!s || st.busy) return;
    st.t += dt;
    for (const id of s.keepAlive || []) if (npc(id)?.state === 'dead') return fail('지켜야 할 사람이 죽었다');
    if (s.type === 'escort' && npc(s.npcId)?.state === 'dead') return fail('일행이 죽었다');
    if (s.timeout && st.t >= s.timeout.seconds) {
      if (s.timeout.flag) setFlag(s.timeout.flag, true);
      return s.timeout.then === 'fail' ? fail('시간이 다 됐다') : completeStep();
    }
    s.tick?.(g, M, dt);
    if (!st || st.busy) return;
    trigTick(s);
    if (st.busy) return;
    const r = check(s);
    if (r === 'skip') {
      st.busy = true;
      g.notify('(이 단계는 건너뜁니다)', 'info');
      return s.skipTp ? fadeTp({ teleport: { player: s.skipTp } }).then(() => st && completeStep()) : completeStep();
    }
    if (r) return completeStep();
    if (s.alt && s.alt.type !== 'talk' && check({ ...s.alt })) { fx(s.alt.fx); return completeStep(); }
    const m = s.miss;
    if (m && S.vehicles && st.t > 1) {
      const h = g.hour, at = hm(m.at), pv = P().vehicle;
      if (h >= at && h < at + 3 && !(pv && RAIL_V.has(pv.vtype)) && !(s.type === 'ride' && st.aboard)) missTrain(m);
    }
  }

  // ------------------------------------------------------------ 표식·일지
  function objPos(s) {
    if (!s) return null;
    switch (s.type) {
      case 'talk': { const h = npc(s.npcId); return h && !h.hidden ? h : NPC_DEFS[s.npcId] || null; }
      case 'escort': return { x: s.x, y: s.y };
      case 'ride': return stopPos(s.line, s.to);
      case 'mount':
        return st.ents.find((e) => e.kind === 'vehicle' && !e.hasPlayer && (!s.vtype || e.vtype === s.vtype) && (!s.moveMode || e.moveMode === s.moveMode)) ||
          (s.moveMode === 'horse' ? S.vehicles?.playerHorse || null : null);
      case 'kill': return s.tag ? g.findByTag(s.tag).find((e) => !isDown(e)) || null : null;
      case 'collect': case 'act': { const a = st.acts.find((a) => (a.step === st.step || (a.item && a.item === s.itemId)) && (!a.show || a.show())); return a ? a.ent || a : null; }
      default: return s.x != null ? { x: s.x, y: s.y } : null;
    }
  }
  function available() {
    if (st) return [];
    if (clock - availT < 0.25 && availT >= 0) return avail;
    availT = clock;
    avail = MISSIONS.filter(canStart).map((m) => {
      const h = m.giver ? npc(m.giver) : null, q = h && !h.hidden ? h : m.start;
      return { id: m.id, title: m.title, x: q.x, y: q.y, giver: m.giver || null };
    });
    return avail;
  }
  function markers() {
    const out = [];
    if (st) {
      const s = cur(), q = s && objPos(s);
      if (q && Number.isFinite(q.x)) out.push({ x: q.x, y: q.y, kind: 'objective', label: s.text });
    } else for (const a of available()) if (BY_ID[a.id].stranger) out.push({ x: a.x, y: a.y, kind: 'stranger', label: a.title });
    return out;
  }
  function objectiveText() {
    if (!st) return '';
    const s = cur();
    if (!s) return st.title;
    return s.type === 'kill' && s.n > 1 ? `${s.text} (${Math.min(st.hits.size, s.n)}/${s.n})` : s.text;
  }
  function journal() {
    const out = st ? [{ id: st.id, title: st.title, status: 'active', summary: objectiveText() }] : [];
    for (const m of MISSIONS) {
      if (done.has(m.id)) out.push({ id: m.id, title: m.title, status: 'done', summary: m.sum || '' });
      else if (failed.has(m.id)) out.push({ id: m.id, title: m.title, status: 'failed', summary: '다시 찾아가면 처음부터 할 수 있다.' });
    }
    return out;
  }

  // ------------------------------------------------------------ 이름 있는 인물 자리·보이기 (스펙 I.1 화살표)
  function relocTick() {
    const p = P();
    for (const d of NPCS) {
      if (st?.cast.has(d.id)) continue;
      const vis = (d.appear ? cond(d.appear) : !d.hidden) && !(d.gone && cond(d.gone));
      let x = d.x, y = d.y;
      for (const [c, sx, sy] of d.spots || []) if (cond(c)) { x = sx; y = sy; }
      let h = npc(d.id);
      if (!h) { if (vis && !S.spawner && near(p, x, y, 150)) makeNpc({ ...d, x, y }); continue; }
      if (!vis) { if (!h.hidden) { h.hidden = true; h.solid = false; } continue; }
      let far = !near(h, x, y, 30);
      if (far && !near(p, h.x, h.y, 45) && !near(p, x, y, 45)) { tp(h, x, y); setBrain(h, d.brain || 'idle', d); far = false; }
      if (h.hidden && !far) { h.hidden = false; h.solid = h.state !== 'dead'; }
      if (d.dialogAfter && Array.isArray(h.dialog)) for (const [c, l] of d.dialogAfter) if (cond(c) && !h.dialog.includes(l)) h.dialog.push(l);
    }
  }

  // ------------------------------------------------------------ 길거리 사건 (H.4)
  function evTick(dt) {
    if (ev) {
      ev.t += dt;
      let fin = !!st;
      if (!fin) try { fin = !!ev.def.tick(g, M, ev, dt); } catch (err) { console.error('[missions event]', ev.def.id, err); fin = true; }
      if (fin) { stray.push(...ev.ents); ev = null; }
      return;
    }
    if (st || (evClock += dt) < 5) return;
    evClock = 0;
    const now = dN(date()) * 24 + g.hour;
    for (const d of EVENTS) {
      if (clock - (evRoll[d.id] ?? -1e9) < d.every) continue;
      let key = null;
      try { key = d.check(g, M); } catch (err) { console.error('[missions event check]', d.id, err); }
      if (key == null || key === false) continue;
      evRoll[d.id] = clock;
      const ck = `${d.id}:${key}`;
      if (now - (evCool[ck] ?? -99) < 24 || !rand.chance(d.chance)) continue;
      evCool[ck] = now;
      ev = { def: d, t: 0, ents: [], acts: [] };
      try { d.begin(g, M, ev); } catch (err) { console.error('[missions event begin]', d.id, err); stray.push(...ev.ents); ev = null; }
      break;
    }
  }

  // ------------------------------------------------------------ 데이터 쪽 도우미 (story.js 의 hook 이 받는 M)
  const M = {
    get st() { return st; },
    g, npc, ensure, spawn, say, chat, choice, fx, goStep, follow, hide, dismount, board, goto, act, later, linePt,
    brain: setBrain, vehicle, near, notify: (t) => g.notify(t, 'info'),
    remove: (tag) => { for (const e of g.findByTag(tag)) kill(e); },
    setHorse(v) { if (!v) return; v.owner = 'player'; if (!v.name) v.name = '먹구름'; S.vehicles?.setPlayerHorse?.(v); if (st) st.ents = st.ents.filter((e) => e !== v); },
    stableHorse(x, y) { const h = S.vehicles?.playerHorse || vehicle('meokgureum'); if (!h) return; if (h.hasPlayer) dismount(P()); h.ejectAll?.(g); tp(h, x, y); },
    kills(faction, tag) { const D = (st || last)?.deaths || []; return D.filter((d) => (tag ? d.tags.includes(tag) : d.byP) && (!faction || d.faction === faction)).length; },
    logs(x, y) { if (!g.findByTag('rail_obstacle').length) track(g.add(new Log(x, y)), {}); },
    trainStopped: (x, y, r) => g.query(x, y, r, (e) => e.kind === 'vehicle' && e.vtype === 'train' && Math.abs(e.speed || 0) < 0.5).length > 0,
    execute(id) {
      const h = npc(id), p = P();
      if (!h) return;
      h.essential = false;
      g.sfx('gun_revolver', { x: h.x, y: h.y });
      h.die?.({ source: p, kind: 'bullet', weapon: 'w_revolver' }, g);
      g.emit('crime', { kind: 'murder', x: h.x, y: h.y, offender: p, victim: h });
    },
    ensureVehicle(vt, x, y, a, o) { if (!g.query(x, y, 150, (e) => e.vtype === vt).length) track(spawnVehicle(vt, x, y, a, o), {}); },
    trialTrain() {
      const q = linePt('train', 1100);
      track(spawnVehicle('train', q.x, q.y, q.angle, { line: 'train', d: 1100, dir: 1, trial: true, maxSpeed: 8, cars: ['freight', 'freight'] }), {});
      g.sfx('train_whistle');
      later(1.5, () => g.sfx('train_whistle'));
    },
    fadeSkip: (text, time, fn) => fadeTp({ text }, () => { jumpTo(null, time); fn?.(); }),
    placeAt(kinds) {
      const p = P();
      for (const q of Object.values(g.world?.places || {})) if (kinds.includes(q.kind) && near(p, q.x, q.y, (q.radius || 30) + 10)) return q.id;
      return null;
    },
    inRect(rects) { const p = P(), i = rects.findIndex(([a, b, c, d]) => p.x >= a && p.x <= c && p.y >= b && p.y <= d); return i >= 0 ? 'r' + i : null; },
    region() { const r = g.world?.regionAt?.(P().x, P().y); return r?.wanted || r?.id || null; },
    nearLine: (pts, r) => closestOnPolyline(pts, P().x, P().y).dist <= r,
    nearRail(line, r) { const L = g.world?.lines?.[line]; return !!L?.points && closestOnPolyline(L.points, P().x, P().y, L.cum).dist <= r; },
    railAhead(line, dd) {
      const L = g.world?.lines?.[line], p = P();
      if (!L?.points) return { x: p.x + dd, y: p.y };
      const c = closestOnPolyline(L.points, p.x, p.y, L.cum);
      return pointAtDistance(L.points, c.d + (rand.chance(0.5) ? dd : -dd), L.cum);
    },
  };

  // ------------------------------------------------------------ 상호작용 (E)
  g.addInteractionProvider((actor, target) => {
    if (!actor?.isPlayer) return null;
    const out = [];
    if (target) {
      if (target.kind === 'human' && target.state !== 'dead' && !target.hidden) {
        const s = st && !st.busy ? cur() : null;
        if (s && ((s.type === 'talk' && match(target, s.npcId)) || (s.alt?.type === 'talk' && match(target, s.alt.npcId))))
          out.push({ key: 'interact', label: `${target.name || ''}에게 말 걸기`, priority: 6, run: () => onTalk(target) });
        else if (!st) {
          const a = available().find((a) => a.giver && match(target, a.giver));
          if (a) out.push({ key: 'interact', label: `이야기 듣기 — ${a.title}`, priority: 6, run: () => start(a.id) });
        }
      }
      for (const a of allActs()) if (a.ent === target && (!a.show || a.show())) out.push({ key: 'interact', label: a.label, priority: 7, run: () => runAct(a) });
      return out;
    }
    const p = actor;
    for (const a of allActs()) if (!a.ent && near(p, a.x, a.y, a.r || 3)) out.push({ key: 'interact', label: a.label, priority: 7, d: Math.hypot(p.x - a.x, p.y - a.y), run: () => runAct(a) });
    const s = st && !st.busy ? cur() : null;
    if (s?.waitTo && hm(s.waitTo) > g.hour + 0.02 && g.hour > hm(s.waitTo) - 3)
      out.push({ key: 'interact', label: '숨어서 기다리기', priority: 1, run: () => S.time?.setHour?.(hm(s.waitTo)) });
    return out;
  });

  // ------------------------------------------------------------ 그리기: 의뢰인 '事' 낙관, 목표 표시
  function seal(ctx, x, y, ch) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = PAL.seal;
    ctx.fillRect(-0.36, -0.36, 0.72, 0.72);
    ctx.scale(0.02, 0.02);
    ctx.fillStyle = PAL.paper;
    ctx.font = `30px ${FONT.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, 1);
    ctx.restore();
  }
  function ring(ctx, x, y, r, a) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = PAL.seal;
    ctx.lineWidth = 0.12;
    ctx.setLineDash([0.8, 0.6]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  g.addRenderer(LAYER.OVERLAY, (ctx, gg, b) => {
    const inV = (x, y) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1, bob = Math.sin(clock * 2.6) * 0.08;
    if (!st) {
      for (const a of available()) {
        const h = a.giver ? npc(a.giver) : null, x = h ? h.x : a.x, y = h ? h.y - 1.9 : a.y;
        if (!inV(x, y)) continue;
        if (!h) ring(ctx, a.x, a.y, Math.min(6, BY_ID[a.id].start?.r ?? 4), 0.3);
        seal(ctx, x, y + bob, BY_ID[a.id].stranger ? '?' : '事');
      }
      return;
    }
    const s = cur(), q = s && objPos(s);
    if (q && inV(q.x, q.y)) {
      if ((s.type === 'reach' || s.type === 'escort') && s.r <= 30) ring(ctx, s.x, s.y, s.r, 0.35);
      else seal(ctx, q.x, q.y - 1.9 + bob, '目');
    }
    for (const a of st.acts) {
      const e = a.ent || a;
      if (e !== q && (!a.show || a.show()) && inV(e.x, e.y)) ring(ctx, e.x, e.y, 0.7, 0.5 + 0.3 * Math.sin(clock * 4));
    }
  }, 50);

  // ------------------------------------------------------------ 이벤트
  const curIs = (type) => { const s = st && cur(); return s?.type === type ? s : null; };
  g.on('time:day', () => { const n = dN(date()); if (n + 1 <= dayCap()) setDate(n + 1); });
  g.on('kill', (e) => {
    const v = e?.victim;
    if (!st || !v) return;
    const p = P(), byP = !!p && (e.killer === p || e.info?.source === p || e.killer?.driver === p);
    st.deaths.push({ faction: v.faction, tags: [...(v.tags || [])], byP });
    const s = curIs('kill');
    if (s?.species && v.species === s.species && !s.tag) st.hits.add(v);
  });
  g.on('buy', (e) => { const s = curIs('buy'); if (s && (!s.itemId || e?.itemId === s.itemId) && (!s.shop || e?.shopId === s.shop)) st.count += e?.n || 1; });
  g.on('skin', (e) => { const s = curIs('skin'); if (s && (!s.species || (e?.animal?.species ?? e?.species) === s.species)) st.count++; });
  g.on('gather', (e) => { const s = curIs('gather'); if (s && (!s.itemId || e?.itemId === s.itemId)) st.count += e?.n || 1; });
  g.on('craft', (e) => { const s = curIs('craft'); if (s && (!s.recipeId || e?.recipeId === s.recipeId)) st.count++; });
  g.on('rail:arrive', (e) => {
    const s = curIs('ride');
    if (s && (e?.line?.id ?? e?.line) === s.line && (e?.stop?.id ?? e?.stop) === s.to && (e.playerAboard || P()?.vehicle === e.vehicle)) st.rideDone = 1;
  });
  g.on('damage', (e) => {
    const s = st && cur();
    if (s?.fistOnly && e?.target?.tags?.has?.(s.fistOnly) && (e.source === P() || e.source?.isPlayer) && e.kind && e.kind !== 'fist') fail('무기를 썼다');
  });
  g.on('player:dead', () => { if (st && !st.ending) { st.dead = clock || 1e-6; st.tok++; st.busy = true; } });
  g.on('player:respawn', () => { if (st?.dead) { st.dead = 0; fail('쓰러졌다'); } });
  g.on('game:start', () => { newGame = !S.save?.loaded; });
  // 엉뚱한 탈것에 탔을 때 길잡이 (예: 거룻배 대신 증기선 승객이 되면 조종할 수 없어 멈춘 것처럼 보인다)
  g.on('vehicle:enter', (e) => {
    const s = curIs('mount');
    if (!s || e?.human !== P() || !e.vehicle) return;
    const v = e.vehicle, role = v.seats?.[e.seat]?.role;
    const wrong = (s.vtype && v.vtype !== s.vtype) || (s.moveMode && v.moveMode !== s.moveMode) || (s.role && role !== s.role);
    if (wrong) g.notify(`지금 목표와 다른 탈것입니다. F 로 내려서 '${s.text}'`, 'warn');
  });
  g.on('save:beforeLoad', () => { newGame = false; });
  g.on('save:load', () => {
    applyDate(true);
    const r = resume;
    resume = null;
    if (r && BY_ID[r.id] && !st) { st = mk(BY_ID[r.id]); st.ckptPos = r.pos || null; restart(r.step || 0, false); }
  });

  // ------------------------------------------------------------ 시스템
  const sys = {
    name: 'missions',
    order: 60,
    MISSIONS, EVENTS, CODEX,
    get active() { return st; },
    start, complete, fail, onTalk, debugSkip, objectiveText, markers, available, journal,
    isDone: (id) => done.has(id),
    codex: () => CODEX.map((c) => ({ ...c })),
    date,
    advanceTo: (s) => { const [d, t] = String(s).split(' '); return fadeJump(d, t); },
    onStart() {
      if (st) for (const e of st.ents) kill(e);
      st = null;
      ev = null;
      done.clear();
      failed.clear();
      if (!g.flags.date) g.flags.date = START_DATE;
    },
    update(dt, realDt) {
      if (g.state !== 'play') return;
      clock += realDt;
      for (let i = timers.length - 1; i >= 0; i--) {
        const t = timers[i];
        if ((t.t -= dt) > 0) continue;
        timers.splice(i, 1);
        try { t.fn(); } catch (err) { console.error('[missions timer]', err); }
      }
      if (newGame) {
        newGame = false;
        applyDate(true);
        if (!done.size && !st) start('pro01_ferry');
      }
      if ((slow += realDt) >= 0.5) {
        slow = 0;
        if (st) folTick();
        else for (const m of MISSIONS) if (!m.giver && canStart(m) && m.start && near(P(), m.start.x, m.start.y, m.start.r)) { start(m.id); break; }
      }
      if ((slow2 += realDt) >= 1) {
        slow2 = 0;
        relocTick();
        const p = P();
        for (let i = stray.length - 1; i >= 0; i--) {
          const e = stray[i];
          if (!e.alive) stray.splice(i, 1);
          else if (!e.hasPlayer && e !== p && (e.hidden || !near(e, p.x, p.y, 70))) { kill(e); stray.splice(i, 1); }
        }
      }
      if (st) missionTick(dt);
      evTick(dt);
    },
    serialize() {
      return { v: 1, done: [...done], failed: [...failed], active: st ? { id: st.id, step: st.ckpt || 0, pos: st.ckptPos } : null, cool: { ...evCool } };
    },
    deserialize(d) {
      if (!d || typeof d !== 'object') return;
      if (st) for (const e of st.ents) kill(e);
      st = null;
      if (ev) stray.push(...ev.ents);
      ev = null;
      done.clear();
      failed.clear();
      for (const id of d.done || []) if (BY_ID[id]) done.add(id);
      for (const id of d.failed || []) if (BY_ID[id]) failed.add(id);
      Object.assign(evCool, d.cool || {});
      resume = d.active && BY_ID[d.active.id] ? d.active : null;
    },
  };
  game.registerSystem(sys);
  return sys;
}
