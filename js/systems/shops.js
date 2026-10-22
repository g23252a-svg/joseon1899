// 상점·시세 [파밍] — game.sys.shops (ARCHITECTURE §5, 스펙 D.3~D.5, G.6 돈 표시).
//   SHOPS, open(shopId), stock(shopId) → [{itemId, price, n}], buyPrice, sellPrice, buy, sell, formatMoney(jeon)
//   (추가) isOpen(id), refusal(id) → 거절 문구|null, fare(from, to, cls) → 경인선 운임, ticketFor(from, to) → {cls, from, to}|null,
//          useTicket(from, to) → 등급|0 (표 한 장 씀), sleepAt(id) 주막·호텔·산채 대청 묵기, restBlock() → 못 쉬는 까닭|null,
//          stableMenu(id) 마방(말죽·치료 20·맡긴 말 찾기·말 사기). 이벤트 'shop:refuse' {shopId, reason}, 'sleep' {shopId, hours, cost}
// 건물 id·건물의 shop 필드 = 상점 id. 문 앞 E '들어가기', 주막·호텔·대청 문 앞 F '묵기', 상점 NPC(npc.shop) F '거래'.
// 매표소는 표만 판다(경인선 운임 C.7, 등급·구간별 줄). 표는 소지품에 ticket_train_<등> 로 들어가고 구간은 여기 tickets 에 적힌다.

import { itemDef, smod, STATIONS } from './items.js';

const TYPES = {
  jumak: { sells: ['c_gukbap', 'c_makgeolli', 'c_roast', 'f_maljuk'], buys: { m_meat: 0.5, c_roast: 0.4, herb: 0.3 }, hours: [5, 24], sleep: true },
  inn: { sells: [['c_roast', 8]], buys: {}, hours: null, refuseWanted: true, sleep: true },
  market: { sells: ['mat_ssari', ['a_arrow', 3], 'f_maljuk', 'c_makgeolli'], buys: { pelt: 0.55, m_meat: 0.5, mat_feather: 0.6, herb: 0.4 }, hours: [6, 20] },
  smith: { sells: ['w_knife', 'w_club', 'w_hwando'], buys: { melee: 0.35 }, hours: [6, 20] },
  yakbang: { sells: ['c_salve', 'c_galgeun', 'c_cheongsim'], buys: { herb: 0.6 }, hours: [6, 21], refuseOutlaw: true },
  gunshop: { sells: ['w_bow', 'a_arrow', 'w_matchlock', 'a_ball', 'a_matchcord', 'mat_powder', 'a_rifle', 'w_revolver', 'a_revolver'], buys: { weapon: 0.4, ammo: 0.4 }, hours: [8, 19], refuseOutlaw: true },
  stable: { sells: ['f_maljuk'], buys: {}, hours: [5, 22] },
  fence: { sells: [['mat_powder', 6], ['a_ball', 1]], buys: { v_watch: 0.8, pelt: 0.7, weapon: 0.5, ammo: 0.4 }, hours: [20, 4] },
  ticket: { sells: [], buys: {}, hours: [6, 16 + 40 / 60], flag: 'rail_open' },
  news: { sells: [['q_newspaper', 2]], buys: {}, hours: [6, 18], npcOnly: true },
  camp: { sells: [], buys: {}, hours: null, sleep: true, free: true, flag: 'prologue_done', bedOnly: true },
};
// [상점 id, 종류, 이름, 건물 id, x, y] (D.5)
const ROWS = [
  ['jumak_gyeonggyo', 'jumak', '경교 주막', 'jumak_gyeonggyo', 2215, 782], ['jumak_muak', 'jumak', '무악재 주막', 'jumak_muak', 2205, 640],
  ['jumak_cheongnyang', 'jumak', '청량리 주막', 'jumak_cheongnyang', 3435, 695], ['jumak_mapo', 'jumak', '마포 주막', 'mapo_jumak', 2265, 1360],
  ['jumak_noryang', 'jumak', '노량진 주막', 'noryang_jumak', 2700, 1640], ['jumak_origol', 'jumak', '오리골 주막', 'jumak_origol1', 1830, 1712],
  ['jumak_solgogae', 'jumak', '솔고개 주막', 'jumak_solgogae', 1560, 1712], ['jumak_sosa', 'jumak', '소사 주막', 'jumak_sosa1', 1255, 1703],
  ['jumak_jemulpo', 'jumak', '제물포 주막', 'jumak_jm', 650, 1598], ['hotel_daebul', 'inn', '대불호텔', 'hotel_daebul', 420, 1645],
  ['market_jongno', 'market', '종로 면포전', 'yuk_myeonpo', 2940, 770], ['market_chilpae', 'market', '칠패 난전', 'chilpae_stalls', 2550, 1145],
  ['market_mapo', 'market', '마포 여각', 'mapo_yeogak', 2300, 1365], ['market_jemulpo', 'market', '제물포 객주', 'gaekju_jm', 660, 1642],
  ['smith_baeogae', 'smith', '배오개 대장간', 'smith_baeogae', 3120, 812], ['smith_sosa', 'smith', '소사 대장간', 'smith_sosa', 1310, 1740],
  ['smith_jemulpo', 'smith', '제물포 대장간', 'smith_jm', 690, 1645], ['yakbang_guri', 'yakbang', '구리개 약방', 'herb_guri1', 2880, 873],
  ['yakbang_sosa', 'yakbang', '소사 약방', 'herb_sosa', 1240, 1735], ['yakbang_cn', 'yakbang', '청국 약재상', 'herb_cn', 330, 1600],
  ['gun_jeongdong', 'gunshop', '정동 서양 상회', 'gun_jeongdong', 2380, 800], ['gun_jingogae', 'gunshop', '진고개 일본 상점', 'gun_jingogae', 2860, 1025],
  ['gun_jemulpo', 'gunshop', '제물포 서양 상회', 'gun_jm', 520, 1470], ['stable_dongdaemun', 'stable', '동대문 안 마방', 'stable_dongdaemun', 3160, 808],
  ['stable_seodaemun', 'stable', '서대문 밖 마방', 'stable_seodaemun', 2160, 790], ['stable_mapo', 'stable', '마포 마방', 'mapo_stable', 2385, 1345],
  ['stable_noryang', 'stable', '노량진 마방', 'noryang_stable', 2660, 1660], ['stable_sosa', 'stable', '소사 마방', 'stable_sosa', 1340, 1702],
  ['stable_jemulpo', 'stable', '제물포 마방', 'stable_jm', 700, 1600], ['fence_mapo', 'fence', '마포 여각 뒷방', null, 2300, 1378],
  ['fence_camp', 'fence', '산채 장물', null, 1500, 2140], ['ticket_noryangjin', 'ticket', '노량진 매표소', 'st_noryangjin', 2400, 1722],
  ['ticket_oryu', 'ticket', '오류동 매표소', 'st_oryu', 1850, 1775], ['ticket_sosa', 'ticket', '소사 매표소', 'st_sosa', 1280, 1770],
  ['ticket_chukhyeon', 'ticket', '축현 매표소', 'st_chukhyeon', 650, 1680], ['ticket_jemulpo', 'ticket', '인천 매표소', 'st_jemulpo', 335, 1640],
  ['newsboy', 'news', '신문팔이', null, 2900, 797], ['camp_hall', 'camp', '산채 대청', 'hwalbin_hall', 1500, 2128],
];
export const SHOPS = Object.fromEntries(ROWS.map(([id, type, name, building, x, y]) => [id, { id, type, name, building, x, y, ...TYPES[type] }]));
Object.assign(SHOPS.fence_camp, { hours: null, flag: 'prologue_done', mul: 0.9, npcOnly: true });
for (const id in SHOPS) if (id.startsWith('ticket_')) SHOPS[id].station = id.slice(7);
SHOPS.stable_dongdaemun.horses = SHOPS.stable_jemulpo.horses = true; // 말 구입 (C.4)
// 이름 있는 NPC id → 상점 (npc.shop 이 없을 때)
const NPC_SHOP = { fence_mapo: 'fence_mapo', ma_cheonbok: 'fence_camp', newsboy_jongno: 'newsboy', newsboy_mapo: 'newsboy', newsboy_jemulpo: 'newsboy' };

const TIER = { noble: [0.9, 1.05], decent: [0.95, 1.02], neutral: [1, 1], rough: [1.05, 0.98], outlaw: [1.15, 0.9] };
const MELEE = new Set(['w_knife', 'w_club', 'w_hwando']);
const HORSE_SALE = [['pony', '과하마', 2500], ['jeju_horse', '제주마', 4000]];
const FLAG_DATE = { rail_open: '1899-09-18' }; // 플래그가 아직 안 켜졌으면 날짜로 판단
// 경인선 운임 [1등, 2등, 3등] (C.7)
const ORDER = Object.keys(STATIONS);
const FARES = {
  'noryangjin-oryu': [40, 25, 15], 'noryangjin-sosa': [85, 45, 25], 'noryangjin-chukhyeon': [130, 70, 35], 'noryangjin-jemulpo': [150, 80, 40],
  'oryu-sosa': [45, 25, 15], 'oryu-chukhyeon': [90, 50, 25], 'oryu-jemulpo': [115, 60, 30], 'sosa-chukhyeon': [50, 25, 15], 'sosa-jemulpo': [70, 40, 20], 'chukhyeon-jemulpo': [40, 20, 10],
};
const fmtH = (h) => (h % 1 ? `${h | 0}시 ${Math.round((h % 1) * 60)}분` : `${h % 24}시`);
const covers = (t, from, to) => {
  const a = ORDER.indexOf(t.from), b = ORDER.indexOf(t.to), x = ORDER.indexOf(from), y = ORDER.indexOf(to);
  return x >= 0 && y >= 0 && Math.min(x, y) >= Math.min(a, b) && Math.max(x, y) <= Math.max(a, b);
};

class Shops {
  constructor(game) {
    this.name = 'shops';
    this.order = 22;
    this.game = game;
    this.SHOPS = SHOPS;
    this.doors = []; // [{x, y, shop}]
    this.fed = {}; // 주막 id → 국밥 사 먹은 날
    this.tickets = []; // [{cls, from, to}]
  }

  // ------------------------------------------------------------ 값
  formatMoney(jeon) {
    let v = Math.round(Number(jeon) || 0);
    const neg = v < 0;
    v = Math.abs(v);
    const ny = Math.floor(v / 10), m = v % 10;
    return (neg ? '−' : '') + (ny ? `${ny.toLocaleString('ko-KR')}냥${m ? ` ${m}전` : ''}` : `${m}전`);
  }
  tier() {
    const t = this.game.sys.wanted?.honorTier?.();
    return TIER[t] ? t : 'neutral';
  }
  fare(from, to, cls = 3) {
    const a = ORDER.indexOf(from), b = ORDER.indexOf(to);
    const f = a >= 0 && b >= 0 && a !== b ? FARES[`${ORDER[Math.min(a, b)]}-${ORDER[Math.max(a, b)]}`] : null;
    return f ? (f[cls - 1] ?? 0) : 0;
  }
  /** 이 상점이 파는 줄: [{itemId, base(값 덮어쓰기)|null, give(실제 아이템)}] */
  _rows(id) {
    const s = SHOPS[id];
    if (!s) return [];
    if (s.type === 'ticket') {
      const out = [];
      for (const to of ORDER)
        if (to !== s.station) for (const c of [3, 2, 1]) out.push({ itemId: `ticket_train_${c}@${s.station}-${to}`, base: this.fare(s.station, to, c), give: `ticket_train_${c}`, fixed: true });
      return out;
    }
    const list = s.sells.map((e) => (Array.isArray(e) ? { itemId: e[0], base: e[1] } : { itemId: e, base: null }));
    if (id === 'gun_jemulpo' && this.game.flags.rifle_unlocked) list.push({ itemId: 'w_rifle', base: null });
    return list;
  }
  buyPrice(id, itemId) {
    const r = this._rows(id).find((e) => e.itemId === itemId), d = itemDef(itemId);
    if (!r || !d) return 0;
    if (r.fixed) return r.base;
    const f = this.game.flags;
    let mul = SHOPS[id].mul ?? 1;
    if (id === 'jumak_solgogae' && f.solgogae_discount) mul *= 0.9;
    if (id === 'gun_jeongdong' && itemId === 'w_revolver' && f.brantley_friend) mul *= 0.7;
    return Math.max(1, Math.round((r.base ?? d.price) * TIER[this.tier()][0] * smod(this.game, 'priceBuy') * mul));
  }
  sellPrice(id, itemId) {
    const s = SHOPS[id], d = itemDef(itemId);
    if (!s || !d || d.noSell || !(d.price > 0)) return 0;
    const b = s.buys || {};
    const rate = b[d.id] ?? b[d.base] ?? (MELEE.has(d.id) ? b.melee : null) ?? b[d.cat] ?? 0;
    if (!rate) return 0;
    const t = this.tier(), ts = t === 'outlaw' && s.type === 'fence' ? 1.1 : TIER[t][1];
    return Math.max(1, Math.floor(d.price * rate * ts * smod(this.game, 'priceSell')));
  }
  stock(id) {
    return this._rows(id).map((r) => ({ itemId: r.itemId, price: this.buyPrice(id, r.itemId), n: Infinity }));
  }

  // ------------------------------------------------------------ 열기·거래
  isOpen(id) {
    const h = SHOPS[id]?.hours;
    if (!h) return true;
    const t = this.game.hour;
    return h[0] < h[1] ? t >= h[0] && t < h[1] : t >= h[0] || t < h[1];
  }
  flagOn(f) {
    const g = this.game;
    return !f || !!g.flags[f] || (!!FLAG_DATE[f] && String(g.flags.date || '') >= FLAG_DATE[f]);
  }
  refusal(id) {
    const s = SHOPS[id], g = this.game;
    if (!s) return '그런 가게는 없습니다';
    if (!this.flagOn(s.flag)) return s.type === 'ticket' ? '경인선은 아직 손님을 받지 않습니다' : '아직 거래할 수 없습니다';
    if (!this.isOpen(id)) return `${s.name}: 문을 닫았습니다 (${fmtH(s.hours[0])}~${fmtH(s.hours[1])})`;
    if (s.refuseWanted && (g.sys.wanted?.level ?? 0) > 0) return `${s.name}: 쫓기는 사람은 받지 않소`;
    if (s.refuseOutlaw && this.tier() === 'outlaw') return `${s.name}: 무뢰배와는 거래하지 않소`;
    return null;
  }
  open(id) {
    const g = this.game, why = this.refusal(id);
    if (why) {
      g.notify(why, 'warn');
      g.emit('shop:refuse', { shopId: id, reason: why });
      return false;
    }
    if (!g.sys.ui?.openPanel) return false;
    g.sys.ui.openPanel('shop', id);
    return true;
  }
  buy(id, itemId, n = 1) {
    const g = this.game, inv = g.sys.inventory, r = this._rows(id).find((e) => e.itemId === itemId);
    if (!r || !inv || this.refusal(id)) return false;
    const real = r.give || itemId, price = this.buyPrice(id, itemId);
    n = Math.min(Math.max(1, n | 0), inv.room?.(real) ?? 99);
    if (n < 1 || !(price > 0) || !inv.spendMoney(price * n, 'buy')) return false;
    inv.add(real, n);
    const route = itemDef(itemId)?.route;
    if (route) for (let i = 0; i < n; i++) this.tickets.push({ ...route });
    const day = g.sys.time?.day ?? 1;
    if (real === 'c_gukbap' && SHOPS[id].type === 'jumak') this.fed[id] = day;
    g.emit('buy', { shopId: id, shop: id, itemId: real, n, price, total: price * n, ...(route ? { route } : {}) });
    return true;
  }
  sell(id, itemId, n = 1) {
    const g = this.game, inv = g.sys.inventory, price = this.sellPrice(id, itemId);
    n = Math.min(Math.max(1, n | 0), inv?.count?.(itemId) ?? 0);
    if (!(price > 0) || n < 1 || !inv.remove(itemId, n)) return false;
    inv.addMoney(price * n, 'sell');
    g.emit('sell', { shopId: id, shop: id, itemId, n, price, total: price * n });
    return true;
  }

  // ------------------------------------------------------------ 차표
  /** 그 구간을 덮는 표 (cls 를 주면 그 등급 이상). 구간이 가장 짧고 값싼 것부터 */
  ticketFor(from, to, cls = 3) {
    const span = (t) => Math.abs(ORDER.indexOf(t.to) - ORDER.indexOf(t.from));
    return this.tickets.filter((t) => t.cls <= cls && covers(t, from, to)).sort((a, b) => span(a) - span(b) || b.cls - a.cls)[0] || null;
  }
  useTicket(from, to, cls = 3) {
    const t = this.ticketFor(from, to, cls);
    if (!t) return 0;
    this.tickets.splice(this.tickets.indexOf(t), 1);
    this.game.sys.inventory?.remove?.(`ticket_train_${t.cls}`, 1);
    return t.cls;
  }
  _syncTickets(id) {
    const m = /^ticket_train_([123])$/.exec(id);
    if (!m) return;
    const c = +m[1], have = this.game.sys.inventory?.count?.(id) ?? 0;
    while (this.tickets.filter((t) => t.cls === c).length > have) this.tickets.splice(this.tickets.findIndex((t) => t.cls === c), 1);
  }

  // ------------------------------------------------------------ 묵기 (G.4)
  sleepCost(id) {
    const day = this.game.sys.time?.day ?? 1;
    return SHOPS[id]?.free || this.fed[id] === day || this.tier() === 'noble' ? 0 : 5;
  }
  /** 쉬기 제한 (C.10): 수배 중, 싸움 중(적 40 m 안·10초 안 피격), 미션이 막을 때 */
  restBlock() {
    const g = this.game, p = g.player;
    if ((g.sys.wanted?.level ?? 0) > 0) return '쫓기는 몸으로는 묵을 수 없습니다';
    if (g.realTime - (g.sys.stats?.lastHurt ?? -99) < 10 || (p && g.nearest(p.x, p.y, 40, (e) => e.tags?.has('hostile') && e.state === 'normal'))) return '싸움 중에는 쉴 수 없습니다';
    if (g.sys.missions?.canRest?.() === false) return '지금은 쉴 수 없습니다';
    return null;
  }
  async sleepAt(id) {
    const g = this.game, s = SHOPS[id], inv = g.sys.inventory, ui = g.sys.ui;
    try {
      const why = this.restBlock();
      if (why) return g.notify(why, 'warn');
      let cost = this.sleepCost(id), deluxe = false;
      if (s.type === 'inn') {
        const i = ui?.choice ? await ui.choice('어느 방에 묵으시겠소?', [`일반실 (${this.formatMoney(200)})`, `상등실 (${this.formatMoney(250)})`, '그만두기']) : 0;
        if (i !== 0 && i !== 1) return;
        cost = i ? 250 : 200;
        deluxe = i === 1;
      }
      if (cost && !inv?.spendMoney?.(cost, 'sleep')) return g.notify('돈이 모자랍니다', 'warn');
      await ui?.fade?.(true, 500);
      const st = g.sys.stats, p = g.player;
      // 상등실: 2게임시 체력·기력 회복 ×1.5. stats.rest 가 시간 건너뛰기·회복·저장을 한다
      if (typeof st?.rest === 'function') st.rest(8, { place: id, ...(deluxe ? { buff: ['regen', 1.5, 2] } : {}) });
      else {
        g.sys.time?.skip?.(8);
        if (p) [p.hp, p.stamina] = [p.maxHp, p.maxStamina];
        g.sys.save?.save?.('auto', { quiet: true, auto: true });
        g.notify('8시간 푹 쉬었다', 'good');
      }
      g.emit('sleep', { shopId: id, hours: 8, cost, deluxe });
      await ui?.fade?.(false, 500);
    } catch (err) {
      console.warn('[shops] 묵기', err?.message);
    }
  }

  // ------------------------------------------------------------ 상호작용
  npcShop(h) {
    const id = SHOPS[h.shop] ? h.shop : NPC_SHOP[h.npcId ?? h.data?.npcId ?? h.id] || (/^newsboy/.test(h.npcId ?? h.id) ? 'newsboy' : null);
    return id && SHOPS[id] ? id : null;
  }
  provide(actor, t, g) {
    if (!actor?.isPlayer || g.sys.loot?.busy || g.sys.loot?.carried) return null;
    if (t) {
      if (t.kind !== 'human' || t.state !== 'normal' || t.isPlayer || t.hostile) return null;
      const id = this.npcShop(t), s = SHOPS[id];
      if (!s || s.bedOnly || !this.flagOn(s.flag)) return null;
      return [{ key: 'enter', label: `거래 — ${s.name}`, priority: 3, run: () => (s.type === 'stable' ? this.stableMenu(id) : this.open(id)) }];
    }
    let best = null, bd = 2.6;
    for (const d of this.doors) {
      const dd = Math.hypot(d.x - actor.x, d.y - actor.y);
      if (dd < bd && (!d.shop.bedOnly || this.flagOn(d.shop.flag))) [bd, best] = [dd, d.shop];
    }
    if (!best) return null;
    const out = [];
    if (!best.bedOnly) {
      const label = best.type === 'ticket' ? `${best.name}에서 표 사기` : `${best.name}에 들어가기`;
      out.push({ key: 'interact', label, priority: 2, d: bd, run: () => (best.type === 'stable' ? this.stableMenu(best.id) : this.open(best.id)) });
    }
    if (best.sleep) {
      const c = best.type === 'inn' ? '방 고르기' : this.sleepCost(best.id) ? this.formatMoney(5) : '공짜';
      out.push({ key: 'enter', label: `묵기 (${c})`, priority: 2, d: bd, run: () => this.sleepAt(best.id) });
    }
    return out;
  }

  // ------------------------------------------------------------ 마방 (C.4): 말죽 2, 치료 20, 맡긴 말 찾기, 말 사기(동대문·제물포)
  async stableMenu(id) {
    const g = this.game, s = SHOPS[id], V = g.sys.vehicles, ph = V?.playerHorse, inv = g.sys.inventory, fm = (n) => this.formatMoney(n);
    const why = this.refusal(id);
    if (why) return g.notify(why, 'warn');
    const door = this.doors.find((d) => d.shop === s) || s, near = ph && Math.hypot(ph.x - door.x, ph.y - door.y) < 30;
    const pay = (n) => inv?.spendMoney?.(n, 'stable') || (g.notify('돈이 모자랍니다', 'warn'), false);
    const spot = () => g.world?.randomPassableNear?.(door.x, door.y, 5, 'horse') || { x: door.x, y: door.y + 3 };
    const acts = [['말죽 사기', () => this.open(id)]];
    if (near && !ph.stabled && ph.hp < ph.maxHp)
      acts.push([`말 치료 (${fm(20)})`, () => pay(20) && ((ph.hp = ph.maxHp), ph.addBond?.(5, g), g.notify('마방 주인이 말을 돌봐 주었다', 'good'))]);
    if (near && ph.stabled && typeof ph.unstable === 'function')
      acts.push(['맡긴 말 찾기', () => {
        const pt = spot();
        ph.unstable(pt.x, pt.y, 0);
      }]);
    for (const [vt, name, price] of s.horses && V?.spawn ? HORSE_SALE : [])
      acts.push([`${name} 사기 (${fm(price)})`, () => {
        if (!pay(price)) return;
        const { x, y } = spot(), v = V.spawn(vt, x, y, 0, { owner: 'player' });
        if (!v) return inv.addMoney(price, 'refund');
        v.owner = 'player';
        V.setPlayerHorse?.(v);
        g.notify(`${name}를 샀다`, 'good');
      }]);
    try {
      const i = acts.length > 1 && g.sys.ui?.choice ? await g.sys.ui.choice(s.name, [...acts.map((a) => a[0]), '그만두기']) : 0;
      acts[i]?.[1]();
    } catch (err) {
      console.warn('[shops] 마방', err?.message);
    }
  }

  buildDoors() {
    const done = new Set(), byB = {};
    for (const s of Object.values(SHOPS)) if (s.building) byB[s.building] = s.id;
    for (const b of this.game.world?.buildings || []) {
      const id = SHOPS[b.shop] ? b.shop : byB[b.id];
      if (!id || done.has(id)) continue;
      done.add(id);
      this.doors.push({ x: b.door?.x ?? b.x, y: b.door?.y ?? b.y, shop: SHOPS[id] });
    }
    // 건물이 없는 지도면 D.5 좌표를 문으로 쓴다
    for (const s of Object.values(SHOPS)) if (!done.has(s.id) && !s.npcOnly) this.doors.push({ x: s.x, y: s.y, shop: s });
  }

  // ------------------------------------------------------------ 루프·저장
  init(game) {
    this.buildDoors();
    game.addInteractionProvider((a, t, g) => this.provide(a, t, g));
    game.on('item:remove', (e) => this._syncTickets(e?.id));
  }
  onStart() {
    this.fed = {};
    this.tickets = [];
  }
  serialize() {
    return { fed: this.fed, tickets: this.tickets };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.fed = d.fed && typeof d.fed === 'object' ? { ...d.fed } : {};
    this.tickets = (Array.isArray(d.tickets) ? d.tickets : []).filter((t) => t && [1, 2, 3].includes(t.cls) && STATIONS[t.from] && STATIONS[t.to]);
  }
}

export function install(game) {
  return game.registerSystem(new Shops(game));
}
