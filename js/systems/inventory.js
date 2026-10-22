// 소지품·돈 [파밍] — game.sys.inventory (ARCHITECTURE §5).
// 돈은 전(錢) 정수. 아이템마다 '중첩' 수가 들 수 있는 최대 개수(D.1). 무거운 짐(heavy)은 한 번에 하나.
// use(): 효과는 stats.eat(itemId) 에 맡기고, stats 가 없으면 플레이어 hp/stamina 에 직접 더한다.
// 이벤트 item:add {id, n} · item:remove {id, n} · money {delta, total, reason} · item:use {id} (추가)
// (추가) room(id) 더 들 수 있는 수, heavy() 든 무거운 짐 id|null, staggerUntil 탁주 비틀거림 끝(누적 게임시)

import { moveCircle } from '../engine/physics.js';
import { itemDef, nowHours } from './items.js';

const HORSES = new Set(['horse', 'pony', 'jeju_horse', 'western_horse']);
const START = [['w_knife', 1], ['w_matchlock', 1], ['a_ball', 12], ['a_matchcord', 3], ['c_roast', 2], ['c_salve', 1]];
const genericDef = (id) => ({ id, name: String(id), cat: 'other', stack: 99, price: 0, desc: '' });
const STAGGER = (15 * Math.PI) / 180;

class Inventory {
  constructor(game) {
    this.name = 'inventory';
    this.order = -20;
    this.game = game;
    this.money = 0;
    this.items = new Map(); // id → 개수 (넣은 순서 유지)
    this._useCd = 0;
    this._drinks = []; // 탁주 마신 시각(누적 게임시)
    this.staggerUntil = 0;
  }

  def(id) {
    return itemDef(id) || genericDef(id);
  }

  // ------------------------------------------------------------ 돈
  addMoney(n, reason = '') {
    n = Math.round(Number(n) || 0);
    if (!n) return;
    this.money = Math.max(0, this.money + n);
    this.game.emit('money', { delta: n, total: this.money, reason });
  }
  spendMoney(n, reason = 'spend') {
    n = Math.round(Number(n) || 0);
    if (n <= 0) return true;
    if (this.money < n) return false;
    this.money -= n;
    this.game.emit('money', { delta: -n, total: this.money, reason });
    return true;
  }

  // ------------------------------------------------------------ 물건
  count(id) {
    return this.items.get(id) || 0;
  }
  has(id, n = 1) {
    return this.count(id) >= n;
  }
  heavy() {
    for (const id of this.items.keys()) if (itemDef(id)?.heavy) return id;
    return null;
  }
  /** 더 들 수 있는 개수 */
  room(id) {
    const d = this.def(id);
    if (d.heavy && !this.has(id) && this.heavy()) return 0;
    return Math.max(0, (d.stack ?? 99) - this.count(id));
  }
  /** 실제로 넣은 개수를 돌려준다 */
  add(id, n = 1) {
    n = Math.floor(Number(n) || 0);
    if (!id || n <= 0) return 0;
    if (!itemDef(id)) console.warn(`[inventory] 모르는 아이템 ${id}`);
    const k = Math.min(n, this.room(id));
    if (k <= 0) {
      this.game.notify(`${this.def(id).name}: 더 들 수 없습니다`, 'warn');
      return 0;
    }
    this.items.set(id, this.count(id) + k);
    this.game.emit('item:add', { id, n: k });
    if (this.def(id).heavy) this.game.notify('무거운 짐: 뛸 수 없다. X 길게 눌러 내려놓기', 'info');
    return k;
  }
  remove(id, n = 1) {
    n = Math.floor(Number(n) || 0);
    if (n <= 0) return true;
    const c = this.count(id);
    if (c < n) return false;
    if (c === n) this.items.delete(id);
    else this.items.set(id, c - n);
    this.game.emit('item:remove', { id, n });
    return true;
  }
  list() {
    const out = [];
    for (const [id, n] of this.items) if (n > 0) out.push({ id, n, def: this.def(id) });
    return out;
  }
  weapons() {
    return this.list().filter((e) => e.def.cat === 'weapon').map((e) => e.id);
  }

  /** 먹기·쓰기. 성공하면 하나 줄이고 true */
  use(id) {
    const g = this.game, p = g.player, d = itemDef(id), u = d?.use;
    if (!u || !this.has(id) || !p || p.state !== 'normal') return false;
    if (p.aiming || g.realTime < this._useCd) return false; // 조준 중에는 못 먹는다 (메뉴 중에도 흐르는 실시간으로 잰다)
    const before = this.count(id);
    if (u.horse) {
      if (!this.feedHorse(u.horse)) return false;
    } else if (typeof g.sys.stats?.eat === 'function') {
      if (g.sys.stats.eat(id) === false) return false; // 효과 표는 stats.EAT
    } else {
      // stats 가 없을 때: 체력·기력만 직접
      if (u.hp) p.hp = Math.min(p.maxHp || 100, p.hp + u.hp);
      if (u.stamina) p.stamina = Math.min(p.maxStamina || 100, p.stamina + u.stamina);
      if (u.full?.includes('stamina')) p.stamina = p.maxStamina || 100;
    }
    if (this.count(id) === before) this.remove(id, 1); // 혹시 stats.eat 이 이미 뺐으면 또 빼지 않는다
    this._useCd = g.realTime + (u.time ?? 1.0);
    if (u.drunk) this.drink();
    g.emit('item:use', { id });
    return true;
  }
  /** 탁주: 1게임시 안에 3병째면 1게임시 비틀거림 (D.1) */
  drink() {
    const now = nowHours(this.game);
    this._drinks = this._drinks.filter((t) => t > now - 1).concat(now);
    if (this._drinks.length >= 3 && this.staggerUntil <= now) this.game.notify('술기운이 올라 비틀거린다', 'warn');
    if (this._drinks.length >= 3) this.staggerUntil = now + 1;
  }

  /** 말죽: 3 m 안 말 */
  feedHorse(eff) {
    const g = this.game, p = g.player;
    const ph = g.sys.vehicles?.playerHorse;
    const h = ph && !ph.stabled && Math.hypot(ph.x - p.x, ph.y - p.y) < 3.5 ? ph : g.nearest(p.x, p.y, 3, (e) => HORSES.has(e.vtype) && !e.wrecked && !e.down);
    if (!h) {
      g.notify('말 곁에서 먹여야 합니다', 'warn');
      return false;
    }
    if (typeof h.feed === 'function') return h.feed(g) !== false; // vehicles/horse.js feed(game)
    if (h.maxHp) h.hp = Math.min(h.maxHp, h.hp + eff.hp);
    if (Number.isFinite(h.stamina)) h.stamina = Math.min(h.maxStamina ?? 100, h.stamina + eff.stamina);
    h.addBond?.(eff.bond, g);
    return true;
  }

  // ------------------------------------------------------------ 비틀거림: 걷는 방향이 ±15° 흔들린다
  lateUpdate(dt, realDt, g) {
    const p = g.player;
    if (!p || p.vehicle || p.state !== 'normal' || !(p.speedNow > 0.3) || nowHours(g) >= this.staggerUntil) return;
    const a = Math.atan2(p.vy, p.vx) + Math.PI / 2, off = Math.tan(STAGGER * Math.sin(g.time * 2.3)) * p.speedNow * dt;
    moveCircle(g.world, p, Math.cos(a) * off, Math.sin(a) * off, p.moveMode);
  }

  // ------------------------------------------------------------ 새 게임·저장
  reset() {
    this.items.clear();
    this.money = 30;
    this._drinks = [];
    this.staggerUntil = 0;
    for (const [id, n] of START) this.items.set(id, n);
  }
  onStart() {
    this.reset();
  }
  serialize() {
    return { money: this.money, items: [...this.items] };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.money = Math.max(0, Math.round(Number(d.money) || 0));
    this.items.clear();
    this._drinks = [];
    this.staggerUntil = 0;
    for (const [id, n] of Array.isArray(d.items) ? d.items : []) if (typeof id === 'string' && n > 0) this.items.set(id, Math.floor(n));
  }
}

export function install(game) {
  return game.registerSystem(new Inventory(game));
}
