// 게임 본체: 고정 시간 간격 루프, 엔티티 목록, 시스템 등록, 층별 렌더링.
// 모든 모듈은 `import { game } from '../engine/game.js'` 로 같은 인스턴스를 쓴다.

import { Camera } from './camera.js';
import { EventBus } from './events.js';
import { Input } from './input.js';
import { LAYER, SpatialHash } from './entity.js';
import { resolveDynamic } from './physics.js';

export { LAYER };

class Game {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.events = new EventBus();
    this.camera = new Camera();
    this.input = null;
    this.world = null; // world/world.js 가 채운다
    this.player = null;

    this.entities = [];
    this.byIdMap = new Map();
    this.dynHash = new SpatialHash(12);
    this.staticHash = new SpatialHash(24);

    this.systems = []; // {name, order, init, update, lateUpdate, updatePaused, onStart}
    this.sys = {}; // 이름으로 접근: game.sys.inventory 등
    this.renderers = []; // 월드 공간 {layer, order, fn}
    this.screenRenderers = []; // 화면 공간 {order, fn}
    this.interactionProviders = []; // (actor, entity, game) => [{key,label,priority,run}]

    this.state = 'loading'; // loading | title | play
    this.pauseReasons = new Set();
    this.timeScale = 1; // 호안(虎眼) 등 시간 감속
    this.time = 0; // 게임 내 경과 초(감속 반영)
    this.realTime = 0;
    this.tickCount = 0;
    this.fixedDt = 1 / 60;
    this.flags = {}; // 이야기 진행 플래그
    this.debug = false;
    this.cameraTarget = null; // 지정하면 플레이어 대신 이것을 따라감
    this.prompt = { interact: null, enter: null }; // HUD 가 표시할 현재 상호작용
    this.stats = { fps: 0, ents: 0, upd: 0, rnd: 0 };
    this._acc = 0;
    this._last = 0;
    this._fpsAcc = 0;
    this._fpsN = 0;
  }

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.input = new Input(canvas);
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      this.camera.resize(w, h, dpr);
      this.events.emit('resize', { w, h, dpr });
    };
    window.addEventListener('resize', resize);
    resize();
  }

  // ------------------------------------------------------------ 등록

  registerSystem(sys) {
    this.systems.push(sys);
    this.systems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (sys.name) this.sys[sys.name] = sys;
    return sys;
  }

  /** 월드 공간 그리기 함수. layer 는 LAYER 값, order 는 같은 층 안 순서 */
  addRenderer(layer, fn, order = 0) {
    this.renderers.push({ layer, order, fn });
    this.renderers.sort((a, b) => a.layer - b.layer || a.order - b.order);
  }
  addScreenRenderer(fn, order = 0) {
    this.screenRenderers.push({ order, fn });
    this.screenRenderers.sort((a, b) => a.order - b.order);
  }
  addInteractionProvider(fn) {
    this.interactionProviders.push(fn);
  }

  // ------------------------------------------------------------ 엔티티

  add(e) {
    this.entities.push(e);
    this.byIdMap.set(e.id, e);
    if (e.static) this.staticHash.insert(e);
    else this.dynHash.insert(e);
    e.onAdded?.(this);
    return e;
  }
  remove(e) {
    if (!e || e._removed) return;
    e.alive = false;
  }
  byId(id) {
    return this.byIdMap.get(id) || null;
  }
  /** 정적 엔티티가 움직였을 때(드물게) 해시 갱신 */
  moveStatic(e, x, y) {
    this.staticHash.remove(e);
    e.x = x;
    e.y = y;
    this.staticHash.insert(e);
  }

  /** 반경 r 안의 엔티티 (엔티티 반지름 포함 판정) */
  query(x, y, r, pred = null, out = []) {
    const tmp = [];
    this.dynHash.queryRect(x - r - 2, y - r - 2, x + r + 2, y + r + 2, tmp);
    this.staticHash.queryRect(x - r - 2, y - r - 2, x + r + 2, y + r + 2, tmp);
    for (const e of tmp) {
      if (!e.alive) continue;
      const rr = r + (e.radius || 0);
      const dx = e.x - x, dy = e.y - y;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (pred && !pred(e)) continue;
      out.push(e);
    }
    return out;
  }
  queryRect(x0, y0, x1, y1, out = []) {
    this.dynHash.queryRect(x0, y0, x1, y1, out);
    this.staticHash.queryRect(x0, y0, x1, y1, out);
    return out;
  }
  nearest(x, y, r, pred = null) {
    let best = null, bd = Infinity;
    for (const e of this.query(x, y, r, pred)) {
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  findByTag(tag) {
    return this.entities.filter((e) => e.alive && e.tags.has(tag));
  }

  // ------------------------------------------------------------ 일시정지

  pause(reason) {
    this.pauseReasons.add(reason);
  }
  resume(reason) {
    this.pauseReasons.delete(reason);
  }
  get paused() {
    return this.pauseReasons.size > 0 || this.state !== 'play';
  }

  // ------------------------------------------------------------ 루프

  async start() {
    for (const s of this.systems) {
      try {
        await s.init?.(this);
      } catch (err) {
        console.error(`[system ${s.name} init]`, err);
      }
    }
    this._last = performance.now();
    requestAnimationFrame((t) => this._frame(t));
  }

  /** 타이틀에서 '시작' 했을 때 */
  beginPlay() {
    this.state = 'play';
    for (const s of this.systems) {
      try {
        s.onStart?.(this);
      } catch (err) {
        console.error(`[system ${s.name} onStart]`, err);
      }
    }
    this.events.emit('game:start', {});
  }

  _frame(now) {
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    this.realTime += dt;
    this._fpsAcc += dt;
    this._fpsN++;
    if (this._fpsAcc > 0.5) {
      this.stats.fps = Math.round(this._fpsN / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsN = 0;
    }
    const t0 = performance.now();
    if (!this.paused) {
      this._acc += dt;
      let steps = 0;
      while (this._acc >= this.fixedDt) {
        this._update(this.fixedDt);
        this._acc -= this.fixedDt;
        if (++steps >= 4) {
          this._acc = 0;
          break;
        }
      }
    } else {
      this._acc = 0;
      for (const s of this.systems) {
        try {
          s.updatePaused?.(dt, this);
        } catch (err) {
          console.error(`[system ${s.name} updatePaused]`, err);
        }
      }
      this.input.endTick();
    }
    const t1 = performance.now();
    this._render(dt);
    const t2 = performance.now();
    this.stats.upd = t1 - t0;
    this.stats.rnd = t2 - t1;
    this.input.endFrame();
    requestAnimationFrame((t) => this._frame(t));
  }

  _update(realDt) {
    const dt = realDt * this.timeScale;
    this.time += dt;
    this.tickCount++;
    this.input.updateMouseWorld(this.camera);

    for (const s of this.systems) {
      if (!s.update) continue;
      try {
        s.update(dt, realDt, this);
      } catch (err) {
        console.error(`[system ${s.name} update]`, err);
      }
    }

    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (!e.alive || e.static) continue;
      try {
        e.update(dt, this);
      } catch (err) {
        console.error(`[entity ${e.kind} ${e.id} update]`, err);
        e._errors = (e._errors || 0) + 1;
        if (e._errors > 30 && !e.isPlayer) e.alive = false;
      }
    }

    this._rebuildDynHash();
    resolveDynamic(this);

    for (const s of this.systems) {
      if (!s.lateUpdate) continue;
      try {
        s.lateUpdate(dt, realDt, this);
      } catch (err) {
        console.error(`[system ${s.name} lateUpdate]`, err);
      }
    }

    this._cleanup();
    this._rebuildDynHash();
    this._updateCamera(realDt);
    this.input.endTick();
  }

  _rebuildDynHash() {
    this.dynHash.clear();
    for (const e of this.entities) if (e.alive && !e.static) this.dynHash.insert(e);
  }

  _cleanup() {
    let w = 0;
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.alive) {
        this.entities[w++] = e;
        continue;
      }
      e._removed = true;
      this.byIdMap.delete(e.id);
      if (e.static) this.staticHash.remove(e);
      try {
        e.onRemoved?.(this);
      } catch (err) {
        console.error(err);
      }
    }
    this.entities.length = w;
  }

  _updateCamera(dt) {
    const p = this.player;
    let t = this.cameraTarget || (p && p.vehicle) || p;
    if (!t) return;
    const zs = t.cameraZoom ?? 1;
    this.camera.follow(t, dt, zs);
    this.camera.wheel(this.input.mouse.wheel);
    if (this.input.pressed('zoomIn')) this.camera.wheel(-1);
    if (this.input.pressed('zoomOut')) this.camera.wheel(1);
  }

  _render(dt) {
    const ctx = this.ctx, cam = this.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#e9dfc7';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.state === 'loading') return;
    if (this.paused) this._updateCamera(0); // 메뉴 중에도 줌 변화는 반영 안 함
    cam.apply(ctx);

    const b = cam.bounds(6);
    const vis = this.queryRect(b.x0, b.y0, b.x1, b.y1, []);
    // 층별 정렬: 렌더러(층 고정) + 엔티티(층 + y)
    const items = [];
    for (const r of this.renderers) items.push({ layer: r.layer, order: r.order - 1e6, r });
    for (const e of vis) {
      if (!e.alive || e.hidden) continue;
      items.push({ layer: e.layer, order: e.y + (e.drawBias || 0), e });
    }
    items.sort((a, b) => a.layer - b.layer || a.order - b.order);
    let n = 0;
    for (const it of items) {
      try {
        cam.apply(ctx);
        if (it.r) it.r.fn(ctx, this, b);
        else {
          it.e.draw(ctx, this);
          n++;
        }
      } catch (err) {
        if (!this._renderErrLogged) {
          console.error('[render]', err);
          this._renderErrLogged = true;
        }
      }
    }
    this.stats.ents = n;

    cam.applyScreen(ctx);
    for (const r of this.screenRenderers) {
      try {
        r.fn(ctx, this, dt);
      } catch (err) {
        if (!this._screenErrLogged) {
          console.error('[screen render]', err);
          this._screenErrLogged = true;
        }
      }
      cam.applyScreen(ctx);
    }
  }

  // ------------------------------------------------------------ 편의

  emit(name, payload) {
    this.events.emit(name, payload);
  }
  on(name, fn) {
    return this.events.on(name, fn);
  }
  /** UI 알림 (UI 시스템이 없으면 콘솔) */
  notify(text, kind = 'info') {
    this.events.emit('notify', { text, kind });
  }
  /** 효과음 (audio 시스템이 없으면 무시) */
  sfx(name, opts) {
    this.sys.audio?.play?.(name, opts);
  }
  /** 게임 시각 0~24 (time 시스템이 없으면 정오) */
  get hour() {
    return this.sys.time?.hour ?? 12;
  }
}

export const game = new Game();
if (typeof window !== 'undefined') window.__game = game; // 디버그용
