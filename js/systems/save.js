// 저장/불러오기 [분위기].
//
//   game.sys.save.save(slot='auto', {quiet}) → bool     각 시스템 serialize() + game.flags + 플레이어 + 시각
//   game.sys.save.load(slot='auto', {quiet}) → bool     각 시스템 deserialize(data) 후 플레이어 복원
//   game.sys.save.hasSave(slot='auto') · clear(slot) · list() → [{slot, savedAt, day, hour, region, money}] · info(slot)
//   자동 저장: 'mission:complete' 직후, 그리고 실시간 3분마다(플레이 중, 살아 있고 수배 중이 아닐 때). 자동 저장은 조용히.
//   localStorage 키 'joseon1899:'+slot. 접근은 모두 try/catch — 저장소가 막히면 이번 세션 메모리에만 보관한다.
//   자동 저장은 물 위(헤엄·배)에서는 미룬다. 불러올 때 설 수 없는 자리(깊은 물·지도 밖)면 가까운 뭍으로 옮긴다.
//   이벤트 'save:done' {slot, auto}, 'save:beforeLoad' {slot}, 'save:load' {slot}

import { clamp } from '../engine/util.js';

export const SAVE_VERSION = 1;
const PREFIX = 'joseon1899:';
const slotName = (s) => String(s ?? 'auto'); // 키·이벤트·캐시가 같은 이름을 쓰게

function makeStore() {
  const mem = new Map();
  const ls = () => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  };
  return {
    persistent: true,
    get(k) {
      // 이번 세션에 쓴 값이 가장 새것이다 (용량 초과로 setItem 이 실패했어도 옛 저장을 읽지 않게)
      if (mem.has(k)) return mem.get(k);
      try {
        const v = ls()?.getItem(k);
        if (v != null) return v;
      } catch {
        /* 막힘 */
      }
      return null;
    },
    set(k, v) {
      mem.set(k, v);
      try {
        const s = ls();
        if (!s) throw new Error('no storage');
        s.setItem(k, v);
        this.persistent = true;
        return true;
      } catch {
        this.persistent = false;
        return true; // 메모리에는 남았다
      }
    },
    del(k) {
      mem.delete(k);
      try {
        ls()?.removeItem(k);
      } catch {
        /* 막힘 */
      }
    },
    keys() {
      const out = new Set(mem.keys());
      try {
        const s = ls();
        const n = s?.length ?? 0;
        for (let i = 0; i < n; i++) {
          const k = s.key(i);
          if (k) out.add(k);
        }
      } catch {
        /* 막힘 */
      }
      return [...out];
    },
  };
}

class SaveSystem {
  constructor(game) {
    this.name = 'save';
    this.order = 900;
    this.game = game;
    this.version = SAVE_VERSION;
    this.autosave = true;
    this.autosaveSeconds = 180; // 실시간 3분
    this.loaded = false; // 이번 세션에 불러온 적 있는가 (onStart 에서 새 게임 초기화를 건너뛸 때 참고)
    this.lastSlot = null;
    this.lastSaveAt = 0;
    this.store = makeStore();
    this._since = 0;
    this._play = 0;
    this._pending = 0; // 미션 완료 뒤 자동 저장 대기(초)
    this._known = new Map();
    this._lastHideSave = -999;
  }

  key(slot = 'auto') {
    return PREFIX + slotName(slot);
  }

  // ------------------------------------------------------------ 저장

  save(slot = 'auto', opts = {}) {
    const g = this.game;
    slot = slotName(slot);
    opts = opts || {};
    const data = { version: SAVE_VERSION, slot, savedAt: Date.now(), meta: {}, systems: {}, flags: {}, player: null };
    for (const s of g.systems) {
      if (!s || s === this || !s.name || typeof s.serialize !== 'function') continue;
      try {
        const d = s.serialize();
        if (d === undefined) continue;
        JSON.stringify(d); // 순환 참조 등은 여기서 걸러낸다
        data.systems[s.name] = d;
      } catch (err) {
        console.warn(`[save] ${s.name}.serialize 실패:`, err?.message);
      }
    }
    try {
      data.flags = JSON.parse(JSON.stringify(g.flags || {}));
    } catch (err) {
      console.warn('[save] flags 저장 실패:', err?.message);
    }
    const p = g.player;
    if (p) {
      data.player = {
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: p.maxHp,
        stamina: p.stamina,
        maxStamina: p.maxStamina,
        angle: p.angle,
        crouching: !!p.crouching,
        walkMode: !!p.walkMode,
        name: p.name,
        vehicle: p.vehicle ? { vtype: p.vehicle.vtype ?? null, moveMode: p.vehicle.moveMode ?? null } : null,
      };
    }
    const tm = g.sys.time;
    let region = '';
    try {
      if (p) region = g.world?.regionAt?.(p.x, p.y)?.name || '';
    } catch {
      /* 없음 */
    }
    data.meta = {
      day: tm?.day ?? 1,
      hour: tm?.hour ?? g.hour,
      weather: tm?.weather ?? null,
      region,
      money: g.sys.inventory?.money ?? null,
      playSeconds: Math.round(this._play),
      mission: g.sys.missions?.active?.id ?? g.sys.missions?.active?.title ?? null,
    };
    let json;
    try {
      json = JSON.stringify(data);
    } catch (err) {
      console.warn('[save] 직렬화 실패:', err?.message);
      if (!opts.quiet) g.notify('저장하지 못했습니다', 'bad');
      return false;
    }
    this.store.set(this.key(slot), json);
    this._known.set(slot, true);
    this.lastSlot = slot;
    this.lastSaveAt = data.savedAt;
    this._since = 0;
    if (!opts.quiet) g.notify(this.store.persistent ? '저장했습니다' : '저장했습니다 (이 창을 닫으면 사라집니다)', 'good');
    g.emit('save:done', { slot, auto: !!opts.auto });
    return true;
  }

  // ------------------------------------------------------------ 불러오기

  _read(slot) {
    const raw = this.store.get(this.key(slot));
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      return d && typeof d === 'object' && d.version === SAVE_VERSION ? d : null; // 버전이 다르면 무시
    } catch {
      return null;
    }
  }

  load(slot = 'auto', opts = {}) {
    const g = this.game;
    slot = slotName(slot);
    opts = opts || {};
    const data = this._read(slot);
    if (!data) {
      if (!opts.quiet) g.notify('불러올 저장이 없습니다', 'warn');
      return false;
    }
    g.emit('save:beforeLoad', { slot });
    const sys = data.systems || {};
    for (const s of g.systems) {
      if (!s || s === this || !s.name || typeof s.deserialize !== 'function') continue;
      if (!(s.name in sys)) continue;
      try {
        s.deserialize(sys[s.name], g);
      } catch (err) {
        console.warn(`[save] ${s.name}.deserialize 실패:`, err?.message);
      }
    }
    // 플래그: 같은 객체를 유지한 채 내용만 바꾼다
    if (!g.flags || typeof g.flags !== 'object') g.flags = {};
    for (const k of Object.keys(g.flags)) delete g.flags[k];
    Object.assign(g.flags, data.flags || {});
    try {
      this._restorePlayer(data.player);
    } catch (err) {
      // 플레이어 복원이 실패해도 불러오기는 끝맺는다 ('save:load' 를 기다리는 모듈이 꼬이지 않게)
      console.warn('[save] 플레이어 복원 실패:', err?.message);
    }
    this.loaded = true;
    this.lastSlot = slot;
    this._since = 0;
    this._pending = 0;
    if (!opts.quiet) g.notify('불러왔습니다', 'good');
    g.emit('save:load', { slot });
    return true;
  }

  _restorePlayer(d) {
    const g = this.game, p = g.player;
    if (!p || !d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
    const v = p.vehicle;
    if (v) {
      // 달리는 탈것에서 내리다 구르지 않게 먼저 세운다
      v.vx = v.vy = 0;
      if ('speed' in v) v.speed = 0;
      try {
        v.exit(p, g, { force: true, silent: true });
      } catch {
        p.vehicle = null;
      }
    }
    if (Number.isFinite(d.maxHp) && d.maxHp > 0) p.maxHp = d.maxHp;
    if (Number.isFinite(d.maxStamina) && d.maxStamina > 0) p.maxStamina = d.maxStamina;
    const hp = clamp(Number.isFinite(d.hp) ? d.hp : p.maxHp, 1, p.maxHp || 100);
    if (p.state === 'dead' && typeof p.revive === 'function') p.revive(hp);
    p.state = 'normal';
    p.hp = hp;
    p.solid = true;
    // 배 위·깊은 물·지도 밖에서 저장했으면 가까운 뭍으로 옮긴다 (탈것은 다시 만들지 않으므로)
    const spot = this._landSpot(d.x, d.y);
    p.x = spot.x;
    p.y = spot.y;
    p.vx = p.vy = 0;
    p.moveX = p.moveY = 0;
    if (Number.isFinite(d.angle)) p.angle = d.angle;
    if (Number.isFinite(d.stamina)) p.stamina = clamp(d.stamina, 0, p.maxStamina || 100);
    p.crouching = !!d.crouching;
    if ('walkMode' in p) p.walkMode = !!d.walkMode;
    g.camera?.snap?.(p.x, p.y);
  }

  /** 걸어서 설 수 있는 가까운 자리 (못 찾으면 world.spawn, 그것도 없으면 그대로) */
  _landSpot(x, y) {
    const w = this.game.world;
    if (!w) return { x, y };
    const size = w.size;
    if (size && Number.isFinite(size.w) && Number.isFinite(size.h)) {
      x = clamp(x, 1, Math.max(1, size.w - 1));
      y = clamp(y, 1, Math.max(1, size.h - 1));
    }
    const ok = (px, py) => {
      try {
        if (w.isDeepWater?.(px, py)) return false;
        return w.passable?.(px, py, 'foot') !== false;
      } catch {
        return true;
      }
    };
    if (ok(x, y)) return { x, y };
    try {
      const q = w.randomPassableNear?.(x, y, 60, 'foot');
      if (q && Number.isFinite(q.x) && Number.isFinite(q.y) && ok(q.x, q.y)) return { x: q.x, y: q.y };
    } catch {
      /* 없음 */
    }
    for (let r = 4; r <= 200; r += 4) {
      const n = Math.max(8, Math.round(r * 0.8));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (ok(px, py)) return { x: px, y: py };
      }
    }
    const sp = w.spawn;
    return sp && Number.isFinite(sp.x) && Number.isFinite(sp.y) ? { x: sp.x, y: sp.y } : { x, y };
  }

  // ------------------------------------------------------------ 조회

  hasSave(slot = 'auto') {
    const k = slotName(slot);
    if (this._known.has(k)) return this._known.get(k);
    const ok = !!this._read(k);
    this._known.set(k, ok);
    return ok;
  }

  /** 저장 요약 {slot, savedAt, day, hour, weather, region, money, playSeconds, mission} | null */
  info(slot = 'auto') {
    slot = slotName(slot);
    const d = this._read(slot);
    return d ? { ...(d.meta || {}), slot, savedAt: d.savedAt } : null;
  }

  list() {
    const out = [];
    for (const k of this.store.keys()) {
      if (!k.startsWith(PREFIX)) continue;
      const info = this.info(k.slice(PREFIX.length));
      if (info) out.push(info);
    }
    return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  clear(slot = 'auto') {
    slot = slotName(slot);
    this.store.del(this.key(slot));
    this._known.set(slot, false);
    return true;
  }

  // ------------------------------------------------------------ 자동 저장

  _alive() {
    const g = this.game, p = g.player;
    return g.state === 'play' && !!p && p.state !== 'dead' && p.hp > 0;
  }
  _canAutosave() {
    const g = this.game, p = g.player;
    if (!this._alive() || g.paused || p.state !== 'normal') return false;
    if ((g.sys.wanted?.level ?? 0) > 0) return false; // 수배 중엔 저장하지 않는다
    if (g.cameraTarget) return false; // 연출 중
    if (p.swimming || p.vehicle?.moveMode === 'boat') return false; // 물 위 (탈것은 다시 만들지 않는다)
    return true;
  }

  init(game) {
    game.on('mission:complete', () => (this._pending = 0.6)); // 미션 상태가 정리된 뒤 저장
    const hideSave = () => {
      const t = game.realTime;
      if (!this.autosave || this._play < 20 || t - this._lastHideSave < 20 || !this._canAutosave()) return;
      this._lastHideSave = t;
      this.save('auto', { quiet: true, auto: true });
    };
    try {
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', hideSave);
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') hideSave();
        });
      }
    } catch {
      /* 없음 */
    }
  }

  update(dt, realDt, game) {
    if (game.state !== 'play') return;
    this._play += realDt;
    this._since += realDt;
    if (!this.autosave) this._pending = 0; // 자동 저장을 끄면 미션 완료 저장도 하지 않는다
    if (this._pending > 0 && (this._pending -= realDt) <= 0) {
      if (this._canAutosave()) this.save('auto', { quiet: true, auto: true });
      else this._pending = 2; // 살아나거나 수배가 풀리거나 뭍에 오를 때까지 다시 시도
    }
    if (this.autosave && this._since >= this.autosaveSeconds) {
      if (this._canAutosave()) this.save('auto', { quiet: true, auto: true });
      else this._since = this.autosaveSeconds - 10; // 10초 뒤 다시
    }
  }
}

export function install(game) {
  const save = new SaveSystem(game);
  game.registerSystem(save);
  return save;
}
