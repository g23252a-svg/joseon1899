// 뒤지기·가죽·채집·상자 [파밍] — game.sys.loot (ARCHITECTURE §5, 스펙 E.1~E.3).
//   rollTable(tableId, ctx?) → [{id, n}] ('money' 는 돈)   give(entries, source) → 실제로 받은 것   spawnContainer(x, y, tableId, opts)
//   (추가) start(label, sec, done) 시간 걸리는 동작(조작 잠금 + 진행 고리), busy, carried(어깨에 멘 짐승), dropCarry(), dropHeavy(),
//          lootBody(h), skin(animal), LOOT_TABLES
// 사람 시체 E '뒤지기'(1.2초, 민간인이면 crime looting — 목격 판정은 wanted), 죽은 짐승 E '가죽 벗기기'(3초 × skinSpeed, 꿩은 1초),
// 중·대형 짐승 F '어깨에 메기'(말 곁 F '말에 싣기' = horse.stow), 채집물 E '캐기'(1.5초, 다시 남 하루·싸리 반나절).
// 짐(멘 짐승·무거운 짐 heavy): 걸음 ×0.6, 질주·구르기 불가, 말 위면 말 속도 ×0.8. 무거운 짐은 X 길게(1초)로 내려놓고 E 로 다시 든다.

import { Entity, LAYER } from '../engine/entity.js';
import { FONT, PAL } from '../engine/palette.js';
import { RNG, TAU, hash2, pointInPolygon, rand, rgba } from '../engine/util.js';
import { ITEMS, itemDef, nowHours, smod } from './items.js';

/** [아이템|'money', 최소, 최대, 확률, 조건: 이 무기를 들고 있었을 때만] */
export const LOOT_TABLES = {
  lt_civilian: [['money', 1, 8, 0.7], ['c_makgeolli', 1, 1, 0.2], ['c_roast', 1, 1, 0.1]],
  lt_sungeom: [['money', 5, 15, 1], ['c_salve', 1, 1, 0.3]],
  lt_bandit: [['money', 3, 20, 1], ['a_ball', 3, 6, 0.6], ['a_matchcord', 1, 2, 0.5], ['c_makgeolli', 1, 1, 0.2]],
  lt_pirate: [['money', 2, 10, 1], ['a_ball', 2, 5, 0.5], ['mat_powder', 1, 1, 0.3]],
  lt_rail_guard: [['money', 10, 30, 1], ['a_rifle', 4, 8, 1, 'w_rifle'], ['c_salve', 1, 1, 0.2]],
  lt_bounty: [['money', 10, 40, 1], ['a_ball', 4, 8, 0.6], ['a_rifle', 4, 6, 0.3], ['c_salve', 1, 1, 0.3]],
  lt_passenger_1st: [['money', 200, 200, 1], ['v_watch', 2, 2, 1]],
  lt_passenger_3rd: [['money', 0, 8, 1]],
  lt_crate: [['money', 2, 15, 0.6], ['a_ball', 3, 6, 0.3], ['mat_powder', 1, 1, 0.2], ['c_salve', 1, 1, 0.2], ['c_makgeolli', 1, 1, 0.3]], // [창작] 상자 기본
};

// 짐승별 고기·부산물·크기 (E.1). animals 의 animal.spec 이 있으면 그것을 먼저 쓴다
const SP = {
  roe_deer: { meat: 2, size: 'M' }, water_deer: { meat: 1, size: 'M' }, pheasant: { meat: 1, size: 'S', bird: true, extra: [{ id: 'mat_feather', n: 2 }] },
  boar: { meat: 3, size: 'L' }, wolf: { meat: 1, size: 'M' }, fox: { meat: 0, size: 'S' }, tiger: { meat: 4, size: 'L' },
};
const specOf = (a) => ({ size: 'M', meat: 1, ...SP[a.species], ...(a.spec || {}) });
const CIVIL = new Set(['civilian', 'guild', 'foreign', 'hunter']);
// 채집 구역별 덩굴 수 (E.2)
const HERB_ZONES = {
  herb_gyeyang: { h_galgeun: 6, h_ssuk: 6 }, herb_suri: { h_galgeun: 4, h_omija: 4, h_dangwi: 3 }, herb_namsan: { h_doraji: 4, h_ssuk: 4 },
  herb_riverside: { h_ssuk: 6 }, herb_gwanak: { h_dangwi: 4, h_doraji: 4 }, herb_bukhan: { h_omija: 5, h_dangwi: 4 },
};
// 그림: [잎 색, 꽃·열매 색]
const LOOK = { h_ssuk: [PAL.treeLight, null], h_galgeun: [PAL.forest, null], h_dangwi: [PAL.treeLight, PAL.white], h_doraji: [PAL.treeLight, '#6d68a6'], h_omija: [PAL.treeDark, PAL.seal], mat_ssari: [PAL.pine, '#a8708a'] };
const SSARI_CELL = 30, SSARI_R = 120, SSARI_MAX = 12;
const strSeed = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

function tableFor(h) {
  if (h.lootTable) return h.lootTable;
  if (h.tags?.has('passenger1')) return 'lt_passenger_1st';
  if (h.role === 'passenger' || h.tags?.has('passenger')) return 'lt_passenger_3rd';
  return { police: 'lt_sungeom', army: 'lt_sungeom', rival: 'lt_bandit', pirate: 'lt_pirate', company: 'lt_rail_guard', bounty: 'lt_bounty' }[h.faction] || 'lt_civilian';
}
const carcassIn = (v) => [...(v.cargo?.large || []), ...(v.cargo?.small || [])].find((r) => r?.kind === 'carcass' && !r.skinned) || null;
const isDeadAnimal = (e) => e.kind === 'animal' && (e.dead || e.state === 'dead') && !e.skinned && !e.hidden;

// ---------------------------------------------------------------- 채집물·상자 엔티티

class Plant extends Entity {
  constructor(id, x, y, itemId, regrow) {
    super({ id, x, y, static: true, solid: false, radius: 0.35, layer: LAYER.LOW });
    Object.assign(this, { kind: 'gather', itemId, regrow, readyAt: 0 }); // regrow: 게임 시간
  }
  ready(g) {
    return nowHours(g) >= this.readyAt;
  }
  getInteractions(actor, g) {
    const L = g.sys.loot;
    if (!actor?.isPlayer || !this.ready(g) || L?.carried) return [];
    const label = `${itemDef(this.itemId)?.name || this.itemId} ${this.itemId === 'mat_ssari' ? '꺾기' : '캐기'}`;
    return [{ key: 'interact', label, priority: 4, run: () => L?.start(label, 1.5, () => L.pick(this)) }];
  }
  draw(ctx, g) {
    const [leaf, flower] = LOOK[this.itemId] || LOOK.h_ssuk, s = hash2(this.x | 0, this.y | 0, 3) * 6, big = this.itemId === 'mat_ssari';
    const ready = this.ready(g), p = g.player, glow = smod(g, 'herbGlow', 0);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = rgba(PAL.ink, 0.7);
    if (ready && glow > 0 && p && !big && Math.hypot(p.x - this.x, p.y - this.y) < glow) {
      ctx.fillStyle = rgba(PAL.lantern, 0.22 + 0.08 * Math.sin(g.realTime * 3)); // 약초 지식: 옅게 빛남
      ctx.beginPath();
      ctx.arc(0, 0, 0.75, 0, TAU);
      ctx.fill();
    }
    const n = big ? 7 : 5, L = ready ? (big ? 0.55 : 0.4) : 0.15;
    ctx.globalAlpha = ready ? 1 : 0.45; // 다시 나는 중이면 밑동만
    ctx.fillStyle = leaf;
    for (let i = 0; i < n; i++) {
      const a = s + (i / n) * TAU;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * L * 0.55, Math.sin(a) * L * 0.55, L * 0.5, L * 0.2, a, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = flower || leaf;
    for (let i = 0; flower && ready && i < 4; i++) {
      ctx.beginPath();
      ctx.arc(Math.cos(s * 2 + i * 1.6) * L * 0.6, Math.sin(s * 2 + i * 1.6) * L * 0.6, 0.07, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

// 상자·궤짝. opts.pickup = 내려놓은 무거운 짐(줍기만 하고 사라진다)
class Container extends Entity {
  constructor(x, y, o) {
    super({ id: o.id, x, y, angle: o.angle ?? 0, static: true, solid: false, radius: 0.45, layer: LAYER.LOW });
    Object.assign(this, { kind: 'container', table: o.table, opts: o, label: o.name || '궤짝', opened: false });
  }
  getInteractions(actor, g) {
    const L = g.sys.loot, pk = this.opts.pickup;
    if (!actor?.isPlayer || this.opened || L?.carried) return [];
    const label = `${this.label} ${pk ? '들기' : '열기'}`;
    return [{ key: 'interact', label, priority: 4, run: () => L?.start(pk ? label : `${this.label} 여는 중`, pk ? 0.6 : 1.0, () => L.openContainer(this)) }];
  }
  draw(ctx) {
    const pk = this.opts.pickup;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.lineWidth = 0.04;
    ctx.strokeStyle = PAL.ink;
    ctx.fillStyle = pk ? (itemDef(pk)?.icon?.shape === 'box' ? PAL.ink2 : PAL.roofThatch) : this.opened ? PAL.ink2 : PAL.timber;
    ctx.fillRect(-0.4, -0.27, 0.8, 0.54);
    ctx.strokeRect(-0.4, -0.27, 0.8, 0.54);
    ctx.fillStyle = PAL.gold;
    if (!this.opened && !pk) ctx.fillRect(-0.06, -0.08, 0.12, 0.16); // 자물쇠
    ctx.restore();
  }
}

// ---------------------------------------------------------------- 시스템

class Loot {
  constructor(game) {
    this.name = 'loot';
    this.order = 20;
    this.game = game;
    this.LOOT_TABLES = LOOT_TABLES;
    this.busy = null; // {label, t, dur, done, lock}
    this.carried = null; // 어깨에 멘 짐승
    this.plants = new Map(); // id → Plant (고정 덩굴)
    this.ssari = new Map(); // 칸 key → Plant
    this.ssariPicked = new Map(); // 칸 key → 다시 나는 시각
    this._scan = 0;
    this._mul = 1; // 짐 때문에 곱한 걸음 배수
    this._setMul = null;
    this._sprint0 = null;
  }

  // ------------------------------------------------------------ 표·주기
  rollTable(tableId, ctx = {}) {
    const out = [];
    for (const [id, a, b, p, need] of LOOT_TABLES[tableId] || []) {
      if ((need && ctx.weapon !== need) || rand.next() >= p) continue;
      const n = rand.int(a, b);
      if (n > 0) out.push({ id, n });
    }
    return out;
  }
  /** 소지품·돈에 넣고 실제로 받은 것을 돌려준다. quiet 면 'loot' 이벤트 없음 */
  give(entries, source = null, quiet = false) {
    const g = this.game, inv = g.sys.inventory, got = [], left = [];
    for (const e of entries || []) {
      if (!e || !(e.n > 0)) continue;
      const k = e.id === 'money' ? (inv?.addMoney?.(e.n, 'loot'), e.n) : inv?.add?.(e.id, e.n) ?? 0;
      if (k > 0) got.push({ id: e.id, n: k });
      if (k < e.n) left.push(e.id);
    }
    const fm = (n) => g.sys.shops?.formatMoney?.(n) ?? `${n}전`;
    if (got.length) g.notify('얻음: ' + got.map((e) => (e.id === 'money' ? `돈 ${fm(e.n)}` : `${itemDef(e.id)?.name || e.id}${e.n > 1 ? ' ' + e.n : ''}`)).join(', '), 'good');
    if (!quiet) g.emit('loot', { source, items: got, left });
    return got;
  }

  // ------------------------------------------------------------ 시간 걸리는 동작
  start(label, sec, done) {
    const p = this.game.player;
    if (!p || this.busy || p.state !== 'normal' || p.vehicle) return false;
    this.busy = { label, t: 0, dur: Math.max(0.05, sec), done, lock: !p.controlLocked };
    if (this.busy.lock) p.controlLocked = true;
    p.moveX = p.moveY = 0;
    return true;
  }
  endBusy(ok) {
    const b = this.busy, p = this.game.player;
    if (!b) return;
    this.busy = null;
    if (b.lock && p) p.controlLocked = false;
    try {
      if (ok) b.done();
    } catch (err) {
      console.error('[loot]', b.label, err);
    }
  }

  // ------------------------------------------------------------ 시체·짐승
  lootBody(h) {
    const g = this.game;
    if (!h || h.looted) return;
    h.looted = true;
    const w = (typeof h.weapon === 'string' ? h.weapon : h.weapon?.id) ?? null, ml = h.loot ?? h.data?.loot; // 미션 전리품이 표보다 앞선다
    const entries = Array.isArray(ml) ? [...ml] : [];
    // 든 무기는 늘 떨어뜨린다 (이미 가진 무기면 두고 간다)
    if (ITEMS[w]?.cat === 'weapon' && (g.sys.inventory?.room?.(w) ?? 1) > 0) entries.push({ id: w, n: 1 });
    entries.push(...this.rollTable(tableFor(h), { weapon: w }));
    if (!this.give(entries, h).length) g.notify('아무것도 없습니다');
    // 목격 판정은 wanted 가 한다
    if (CIVIL.has(h.faction)) g.emit('crime', { kind: 'looting', x: h.x, y: h.y, offender: g.player, victim: h });
  }
  skin(a) {
    const g = this.game;
    if (!a || a.skinned) return;
    const sp = specOf(a);
    let q = Math.max(1, Math.min(3, Math.round(a.quality ?? 2)));
    if (q < 3 && rand.next() < smod(g, 'skinQuality', 0)) q++;
    const entries = [{ id: `pelt_${a.species}_q${q}`, n: ITEMS[`pelt_${a.species}`] ? 1 : 0 }, { id: 'm_meat', n: sp.meat }, ...(sp.extra || [])];
    a.skinned = true;
    const items = this.give(entries, a, true);
    g.emit('skin', { animal: a, species: a.species, quality: q, items });
  }
  pickUp(a) {
    const g = this.game, p = g.player;
    if (!p || this.carried || !a?.alive || p.vehicle) return;
    if (g.sys.inventory?.heavy?.()) return g.notify('무거운 짐을 들고는 멜 수 없습니다', 'warn');
    this.carried = a;
    a.hidden = true;
    a.solid = false;
    p.carry = { kind: 'carcass', animal: a, species: a.species, color: a.spec?.color || PAL.timber };
  }
  dropCarry(stowed = false) {
    const a = this.carried, p = this.game.player;
    if (!a) return;
    this.carried = null;
    if (p?.carry?.animal === a) p.carry = null;
    if (stowed) return this.game.remove(a); // 말 짐칸에는 기록만 남는다
    a.hidden = false;
    if (p) [a.x, a.y] = [p.x - Math.cos(p.angle) * 0.9, p.y - Math.sin(p.angle) * 0.9];
  }
  /** 무거운 짐을 발치에 내려놓는다 (E 로 다시 든다) */
  dropHeavy() {
    const g = this.game, p = g.player, inv = g.sys.inventory, id = inv?.heavy?.();
    if (!p || !id || !inv.remove(id, 1)) return null;
    g.notify(`${itemDef(id)?.name || id}을(를) 내려놓았다`);
    return this.spawnContainer(p.x + Math.cos(p.angle) * 0.8, p.y + Math.sin(p.angle) * 0.8, null, { name: itemDef(id)?.name || '짐', items: [{ id, n: 1 }], pickup: id, angle: p.angle });
  }

  /** 짐 무게 (매 틱): 멘 짐승·무거운 짐 → 걸음 ×0.6, 질주·구르기 불가. speedMul 은 남이 쓴 값을 바탕으로 곱한다 */
  applyLoad(p, g, dt) {
    const heavy = g.sys.inventory?.heavy?.(), load = !!(this.carried || heavy) && !p.vehicle && p.state === 'normal';
    const base = p.speedMul === this._setMul ? (p.speedMul ?? 1) / this._mul : p.speedMul ?? 1;
    this._mul = load ? 0.6 : 1;
    p.speedMul = this._setMul = base * this._mul;
    if (load && this._sprint0 == null) [this._sprint0, p.speedSprint] = [p.speedSprint, p.speedRun];
    else if (!load && this._sprint0 != null) [p.speedSprint, this._sprint0] = [this._sprint0, null];
    if (load) g.input?.consume?.('brake'); // 구르기 막기
    if (!heavy) return (this._holdX = 0);
    // X 길게 1초 → 내려놓기
    if (!p.vehicle && p.state === 'normal' && g.input?.down?.('holster')) (this._holdX = (this._holdX || 0) + dt) >= 1 && ((this._holdX = -99), this.dropHeavy());
    else this._holdX = 0;
  }

  provide(actor, t, g) {
    if (!actor?.isPlayer || this.busy) return null;
    if (this.carried) {
      if (t) return null;
      const out = [{ key: 'interact', label: '짐승 내려놓기', priority: 6, run: () => this.dropCarry() }];
      const h = g.sys.vehicles?.playerHorse;
      if (typeof h?.stow === 'function' && !h.stabled && Math.hypot(h.x - actor.x, h.y - actor.y) < 3.5) out.push({ key: 'enter', label: '말에 싣기', priority: 6, run: () => this.stowOn(h) });
      return out;
    }
    if (!t) return g.sys.inventory?.heavy?.() ? [{ key: 'interact', label: '짐 내려놓기', priority: 0, run: () => this.dropHeavy() }] : null;
    const rec = carcassIn(t);
    if (rec) return [{ key: 'interact', label: '실은 짐승 가죽 벗기기', priority: 5, run: () => this.start('가죽 벗기는 중', 3 * smod(g, 'skinSpeed'), () => carcassIn(t) === rec && (t.cargo[rec.slot].splice(t.cargo[rec.slot].indexOf(rec), 1), this.skin(rec))) }];
    if (t.kind === 'human' && t.state === 'dead' && !t.looted && !t.isPlayer)
      return [{ key: 'interact', label: '뒤지기', priority: 3, run: () => this.start('뒤지는 중', 1.2, () => this.lootBody(t)) }];
    if (!isDeadAnimal(t)) return null;
    const sp = specOf(t), label = sp.bird ? '깃털 뽑기' : '가죽 벗기기';
    const out = [{ key: 'interact', label, priority: 3, run: () => this.start(label, (sp.bird ? 1 : 3) * smod(g, 'skinSpeed'), () => this.skin(t)) }];
    if (sp.size !== 'S') out.push({ key: 'enter', label: '어깨에 메기', priority: 2, run: () => this.pickUp(t) });
    return out;
  }

  /** 멘 짐승을 탈것 짐칸(vehicles Bag.stow(obj, 'large'|'small'))에 기록으로 싣는다 */
  stowOn(v) {
    const a = this.carried, sp = a && specOf(a), slot = sp?.size === 'L' ? 'large' : 'small';
    if (!a || typeof v?.stow !== 'function') return false;
    const rec = { kind: 'carcass', species: a.species, spec: a.spec, size: sp.size, quality: a.quality, slot };
    if (v.stow(rec, slot) === false) return this.game.notify('더 실을 자리가 없습니다', 'warn'), false;
    this.dropCarry(true);
    return true;
  }

  // ------------------------------------------------------------ 상자 (opts: id, name, items:[{id,n}], money, owner → crime theft, angle, pickup)
  spawnContainer(x, y, tableId = 'lt_crate', opts = {}) {
    return this.game.add(new Container(x, y, { ...opts, table: tableId }));
  }
  openContainer(c) {
    const g = this.game, o = c?.opts;
    if (!c || c.opened) return;
    if (o.pickup && !(g.sys.inventory?.room?.(o.pickup) > 0)) return g.notify('이미 무거운 짐을 들고 있습니다', 'warn');
    c.opened = true;
    const entries = [...(o.items || []), ...(c.table ? this.rollTable(c.table) : []), { id: 'money', n: o.money || 0 }];
    if (!this.give(entries, c, !!o.pickup).length) g.notify('비어 있습니다');
    if (o.pickup) g.remove(c);
    if (o.owner) g.emit('crime', { kind: 'theft', x: c.x, y: c.y, offender: g.player, victim: c }); // 목격 판정은 wanted
  }

  // ------------------------------------------------------------ 채집
  pick(pl) {
    const g = this.game;
    if (!pl?.alive || !pl.ready(g)) return;
    const k = g.sys.inventory?.add?.(pl.itemId, 1 + (rand.next() < smod(g, 'gatherBonus', 0) ? 1 : 0)) ?? 0;
    if (k <= 0) return;
    pl.readyAt = nowHours(g) + pl.regrow;
    if (pl.ssariKey) {
      this.ssariPicked.set(pl.ssariKey, pl.readyAt);
      this.ssari.delete(pl.ssariKey);
      g.remove(pl);
    }
    g.notify(`${itemDef(pl.itemId)?.name}${k > 1 ? ' ' + k : ''} 얻음`, 'good');
    g.emit('gather', { itemId: pl.itemId, n: k, x: pl.x, y: pl.y });
  }
  _freeAt(x, y) {
    const w = this.game.world;
    return w.passable(x, y, 'foot') && !w.isWater(x, y) && !w.querySolids(x - 0.6, y - 0.6, x + 0.6, y + 0.6, []).length;
  }
  _zonePoint(z, rng) {
    const P = z.poly;
    if (!P && !Number.isFinite(z.x)) return null;
    const xs = P?.map((q) => q[0]), ys = P?.map((q) => q[1]);
    for (let k = 0; k < 60; k++) {
      const a = rng.range(0, TAU), r = (z.r || 30) * Math.sqrt(rng.next());
      const x = P ? rng.range(Math.min(...xs), Math.max(...xs)) : z.x + Math.cos(a) * r;
      const y = P ? rng.range(Math.min(...ys), Math.max(...ys)) : z.y + Math.sin(a) * r;
      if ((!P || pointInPolygon(x, y, P)) && this._freeAt(x, y)) return { x, y };
    }
    return null;
  }
  _addPlant(id, x, y, itemId) {
    this.plants.set(id, this.game.add(new Plant(id, x, y, itemId, 24)));
  }
  placePlants() {
    const w = this.game.world;
    if (!w?.passable) return;
    for (const z of w.zones || []) {
      const rng = new RNG(strSeed(z.id));
      let i = 0;
      for (const [itemId, n] of Object.entries(HERB_ZONES[z.id] || {}))
        for (let k = 0; k < n; k++) {
          const pt = this._zonePoint(z, rng);
          if (pt) this._addPlant(`gp_${z.id}_${i++}`, pt.x, pt.y, itemId);
        }
    }
    // 길가 풀밭의 쑥 40
    const roads = (w.roads || []).filter((r) => r.kind !== 'street' && r.points?.length > 1), rng = new RNG(1899);
    for (let k = 0, n = 0; roads.length && k < 800 && n < 40; k++) {
      const rd = rng.pick(roads), i = rng.int(0, rd.points.length - 2);
      const [ax, ay] = rd.points[i], [bx, by] = rd.points[i + 1], L = Math.hypot(bx - ax, by - ay) || 1, t = rng.next();
      const off = ((rd.width || 6) / 2 + rng.range(1.5, 4)) * (rng.chance(0.5) ? 1 : -1);
      const x = ax + (bx - ax) * t - ((by - ay) / L) * off, y = ay + (by - ay) * t + ((bx - ax) / L) * off;
      if (w.terrainAt(x, y) === w.T?.GRASS && this._freeAt(x, y)) this._addPlant(`gp_road_${n++}`, x, y, 'h_ssuk');
    }
  }
  /** 플레이어 120 m 안 숲 칸에 싸리 (30 m 칸마다 정해진 자리, 최대 12) */
  scanSsari(p) {
    const g = this.game, w = g.world, now = nowHours(g), F = w.T?.FOREST, C = SSARI_CELL;
    for (const [k, pl] of this.ssari)
      if (!pl.alive || Math.hypot(pl.x - p.x, pl.y - p.y) > SSARI_R + 40) {
        g.remove(pl);
        this.ssari.delete(k);
      }
    for (const [k, t] of this.ssariPicked) if (t <= now) this.ssariPicked.delete(k);
    if (F == null || this.ssari.size >= SSARI_MAX) return;
    const cand = [];
    for (let cx = Math.floor((p.x - SSARI_R) / C); cx <= Math.floor((p.x + SSARI_R) / C); cx++)
      for (let cy = Math.floor((p.y - SSARI_R) / C); cy <= Math.floor((p.y + SSARI_R) / C); cy++) {
        const key = `${cx},${cy}`;
        if (this.ssari.has(key) || this.ssariPicked.has(key) || hash2(cx, cy, 77) > 0.55) continue;
        const x = (cx + 0.1 + hash2(cx, cy, 78) * 0.8) * C, y = (cy + 0.1 + hash2(cx, cy, 79) * 0.8) * C, d = Math.hypot(x - p.x, y - p.y);
        if (d <= SSARI_R && w.terrainAt(x, y) === F) cand.push({ key, x, y, d });
      }
    cand.sort((a, b) => a.d - b.d);
    for (const c of cand) {
      if (this.ssari.size >= SSARI_MAX) break;
      if (!this._freeAt(c.x, c.y)) continue;
      const pl = new Plant(`ssari_${c.key}`, c.x, c.y, 'mat_ssari', 12);
      pl.ssariKey = c.key;
      this.ssari.set(c.key, g.add(pl));
    }
  }

  // ------------------------------------------------------------ 루프
  init(game) {
    game.addInteractionProvider((actor, t, g) => this.provide(actor, t, g));
    game.on('damage', (e) => e.target === game.player && this.endBusy(false));
    game.addScreenRenderer((ctx, g) => this.drawBusy(ctx, g), 50);
    // 자유 탐험 중 죽으면 무거운 짐은 그 자리에 떨어진다 (미션 중이면 미션이 다시 쥐여 준다)
    game.on('player:dead', () => !game.sys.missions?.active && this.dropHeavy());
    this.placePlants();
  }
  update(dt, realDt, game) {
    const p = game.player, a = this.carried;
    if (this.busy) {
      if (!p || p.state !== 'normal' || p.vehicle) this.endBusy(false);
      else if ((this.busy.t += dt) >= this.busy.dur) this.endBusy(true);
    }
    if (a && (!a.alive || !p)) this.carried = null;
    else if (a && (p.state === 'dead' || p.vehicle)) this.stowOn(p.vehicle) || this.dropCarry();
    else if (a) [a.x, a.y] = [p.x, p.y];
    if (!p) return;
    this.applyLoad(p, game, realDt);
    if ((this._scan -= dt) <= 0) {
      this._scan = 2;
      this.scanSsari(p);
    }
  }
  /** 무거운 짐을 실은 말은 ×0.8 (말 물리 뒤에 속도를 누른다) */
  lateUpdate(dt, realDt, game) {
    const v = game.player?.vehicle;
    if (v?.moveMode !== 'horse' || v.driver !== game.player || !game.sys.inventory?.heavy?.()) return;
    const lim = (v.ctl?.sprint ? v.sprintSpeed : v.maxSpeed) * 0.8;
    if (v.speed > lim) v.speed = lim;
  }
  drawBusy(ctx, g) {
    const b = this.busy, p = g.player;
    if (!b || !p) return;
    const s = g.camera.worldToScreen(p.x, p.y - 1.2), f = Math.min(1, b.t / b.dur);
    ctx.lineWidth = 4;
    for (const [col, a0, a1] of [[rgba(PAL.paper, 0.85), 0, TAU], [PAL.seal, -Math.PI / 2, -Math.PI / 2 + f * TAU]]) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 13, a0, a1);
      ctx.stroke();
    }
    ctx.font = `14px ${FONT.body}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = PAL.ink;
    ctx.fillText(b.label, s.x, s.y - 22);
  }

  // ------------------------------------------------------------ 새 게임·저장
  onStart() {
    for (const pl of this.plants.values()) pl.readyAt = 0;
    this.ssariPicked.clear();
    this.dropCarry();
    this.endBusy(false);
  }
  serialize() {
    const now = nowHours(this.game), plants = {};
    for (const [id, pl] of this.plants) if (pl.readyAt > now) plants[id] = +pl.readyAt.toFixed(2);
    return { plants, ssari: Object.fromEntries(this.ssariPicked) };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    for (const pl of this.plants.values()) pl.readyAt = Number(d.plants?.[pl.id]) || 0;
    this.ssariPicked = new Map(Object.entries(d.ssari || {}).filter(([, t]) => Number.isFinite(t)));
    for (const k of this.ssariPicked.keys()) this.ssari.get(k)?.alive && this.game.remove(this.ssari.get(k));
    for (const k of this.ssariPicked.keys()) this.ssari.delete(k);
    this.dropCarry();
    this.endBusy(false);
  }
}

export function install(game) {
  return game.registerSystem(new Loot(game));
}
