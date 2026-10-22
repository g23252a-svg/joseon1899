// 소지품·돈 [파밍] — game.sys.inventory (ARCHITECTURE §5).
// 돈은 전(錢) 정수. 아이템마다 '중첩' 수가 들 수 있는 최대 개수(D.1). 무거운 짐은 한 번에 하나.
// use(): 효과는 stats.eat(itemId) 에 맡기고, stats 가 없으면 플레이어 hp/stamina 에 직접 더한다.
// 이벤트 item:add {id, n} · item:remove {id, n} · money {delta, total, reason} · item:use {id} (추가)

import { itemDef } from './items.js';

const HORSES = new Set(['horse', 'pony', 'jeju_horse', 'western_horse']);
const START = [['w_knife', 1], ['w_matchlock', 1], ['a_ball', 12], ['a_matchcord', 3], ['c_roast', 2], ['c_salve', 1]];
const genericDef = (id) => ({ id, name: String(id), cat: 'other', stack: 99, price: 0, desc: '' });

class Inventory {
  constructor(game) {
    this.name = 'inventory';
    this.order = -20;
    this.game = game;
    this.money = 0;
    this.items = new Map(); // id → 개수 (넣은 순서 유지)
    this._useCd = 0;
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
  /** 더 들 수 있는 개수 */
  room(id) {
    const d = this.def(id);
    if (d.heavy && !this.has(id) && this.list().some((e) => e.def.heavy)) return 0;
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
    if (id === 'q_fare_bag') this.addMoney(30, 'loot'); // 줍는 즉시 돈 +30 (D.1)
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
    if (!u || !this.has(id) || !p || p.state === 'dead') return false;
    if (p.aiming || g.realTime < this._useCd) return false; // 조준 중에는 못 먹는다 (메뉴 중에도 흐르는 실시간으로 잰다)
    const before = this.count(id);
    if (u.horse) {
      if (!this.feedHorse(u.horse, id)) return false;
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
    g.emit('item:use', { id });
    return true;
  }

  /** 말죽: 3 m 안 말 */
  feedHorse(eff, id) {
    const g = this.game, p = g.player;
    const ph = g.sys.vehicles?.playerHorse;
    const h = ph && Math.hypot(ph.x - p.x, ph.y - p.y) < 3.5 ? ph : g.nearest(p.x, p.y, 3, (e) => HORSES.has(e.vtype) && !e.wrecked);
    if (!h) {
      g.notify('말 곁에서 먹여야 합니다', 'warn');
      return false;
    }
    if (typeof h.feed === 'function') return h.feed(g) !== false; // vehicles/horse.js feed(game)
    if (h.maxHp) h.hp = Math.min(h.maxHp, h.hp + eff.hp);
    if (Number.isFinite(h.stamina)) h.stamina = Math.min(h.maxStamina ?? 100, h.stamina + eff.stamina);
    h.addBond?.(eff.bond, 'feed');
    return true;
  }

  // ------------------------------------------------------------ 새 게임·저장
  reset() {
    this.items.clear();
    this.money = 30;
    for (const [id, n] of START) this.items.set(id, n);
  }
  onStart() {
    this.reset();
  }
  init(game) {
    game.on('mission:complete', () => this.has('q_fare_bag') && this.remove('q_fare_bag', this.count('q_fare_bag')));
  }
  serialize() {
    return { money: this.money, items: [...this.items] };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.money = Math.max(0, Math.round(Number(d.money) || 0));
    this.items.clear();
    for (const [id, n] of Array.isArray(d.items) ? d.items : []) if (typeof id === 'string' && n > 0) this.items.set(id, Math.floor(n));
  }
}

export function install(game) {
  return game.registerSystem(new Inventory(game));
}
