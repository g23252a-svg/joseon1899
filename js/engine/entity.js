// 엔티티 기본 클래스와 공간 해시.

import { uid } from './util.js';

/** 그리기 층. 낮은 수부터 그린다. */
export const LAYER = {
  GROUND: 0, // 지형 청크 (world 가 그림)
  DECAL: 10, // 철로·핏자국·발자국 등 땅에 붙은 것
  LOW: 20, // 시체, 떨어진 물건, 채집물, 상자
  ENTITY: 30, // 사람·동물·탈것 (y 순 정렬)
  HIGH: 40, // 지붕·나무 윗부분·성벽 문루
  SKY: 50, // 새, 연기, 날씨
  OVERLAY: 60, // 월드 공간 UI(조준선, 표시)
};

export class Entity {
  constructor(opts = {}) {
    this.id = opts.id || uid('e');
    this.kind = 'entity';
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.angle = opts.angle ?? 0;
    this.vx = 0;
    this.vy = 0;
    this.radius = opts.radius ?? 0.4;
    this.mass = opts.mass ?? 1;
    this.tags = new Set(opts.tags || []);
    this.alive = true; // false 가 되면 다음 틱에 목록에서 빠진다
    this.solid = opts.solid ?? true; // 다른 엔티티와 밀어내기 충돌
    this.static = opts.static ?? false; // true 면 update 를 부르지 않고 정적 해시에 들어감
    this.layer = opts.layer ?? LAYER.ENTITY;
    this.name = opts.name || '';
    this.maxHp = opts.hp ?? 0;
    this.hp = this.maxHp;
    this.data = opts.data || {}; // 시스템별 임의 데이터
    this._removed = false;
  }

  update(dt, game) {}
  draw(ctx, game) {}

  /**
   * 상호작용 목록. key 는 'interact'(E) 또는 'enter'(F).
   * [{ key, label, priority, run(actor, game) }]
   */
  getInteractions(actor, game) {
    return [];
  }

  /** 피해. info = {source, weapon, kind, x, y, headshot} */
  damage(amount, info = {}, game) {
    if (!this.maxHp || this.hp <= 0) return;
    this.hp -= amount;
    game?.events.emit('damage', { target: this, amount, ...info });
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(info, game);
    }
  }
  die(info = {}, game) {
    game?.events.emit('kill', { victim: this, killer: info.source || null, info });
  }

  /** 동적 충돌 시 호출 (impact = 접근 속도 m/s) */
  onCollide(other, impact, game) {}
  onAdded(game) {}
  onRemoved(game) {}

  hasTag(t) {
    return this.tags.has(t);
  }
  distTo(o) {
    return Math.hypot(o.x - this.x, o.y - this.y);
  }
}

/** 고정 크기 격자 공간 해시 */
export class SpatialHash {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this._stamp = 0;
  }
  _key(cx, cy) {
    return (cx + 4096) * 8192 + (cy + 4096);
  }
  clear() {
    this.map.clear();
  }
  insert(e) {
    const c = this.cell, r = e.radius || 0;
    const x0 = Math.floor((e.x - r) / c), x1 = Math.floor((e.x + r) / c);
    const y0 = Math.floor((e.y - r) / c), y1 = Math.floor((e.y + r) / c);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = this._key(cx, cy);
        let b = this.map.get(k);
        if (!b) this.map.set(k, (b = []));
        b.push(e);
      }
  }
  remove(e) {
    const c = this.cell, r = e.radius || 0;
    const x0 = Math.floor((e.x - r) / c), x1 = Math.floor((e.x + r) / c);
    const y0 = Math.floor((e.y - r) / c), y1 = Math.floor((e.y + r) / c);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.map.get(this._key(cx, cy));
        if (!b) continue;
        const i = b.indexOf(e);
        if (i >= 0) b.splice(i, 1);
      }
  }
  /** 사각형과 겹치는 칸의 엔티티 (중복 제거) */
  queryRect(x0, y0, x1, y1, out = []) {
    const c = this.cell;
    const stamp = ++this._stamp;
    const cx0 = Math.floor(x0 / c), cx1 = Math.floor(x1 / c);
    const cy0 = Math.floor(y0 / c), cy1 = Math.floor(y1 / c);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const b = this.map.get(this._key(cx, cy));
        if (!b) continue;
        for (const e of b) {
          if (e._hs === stamp) continue;
          e._hs = stamp;
          out.push(e);
        }
      }
    return out;
  }
}
