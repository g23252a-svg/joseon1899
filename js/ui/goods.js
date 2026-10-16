// 물건 화면: 소지품(분류별 격자 + 설명·사용), 제작(조리법·재료), 상점(사기·팔기).
// 다른 시스템이 없거나 아직 덜 만들어져도 깨지지 않게 모든 호출은 safe/옵셔널 체이닝.

import { emptyNote, h, josa, safe, setAttr, setClass, setText } from './dom.js';
import { itemIcon } from './icons.js';

// ---------------------------------------------------------------- 아이템 정의

let itemsMod = null;
let itemsTried = false;

/** systems/items.js 를 필요할 때 한 번만 불러온다 (없으면 조용히 넘어감) */
export function ensureItemDefs(onLoad) {
  if (itemsTried) return;
  itemsTried = true;
  import('../systems/items.js')
    .then((m) => {
      itemsMod = m;
      onLoad?.();
    })
    .catch(() => {});
}

export function defOf(id, entry) {
  if (entry?.def) return entry.def;
  const d = safe(() => itemsMod?.itemDef?.(id), null);
  if (d) return d;
  const I = itemsMod?.ITEMS;
  if (I) {
    const x = Array.isArray(I) ? I.find((i) => i?.id === id) : I[id];
    if (x) return x;
  }
  return { id, name: String(id), cat: 'other' };
}

export const CATS = {
  quest: ['중요한 물건', '要'],
  weapon: ['무기', '兵'],
  ammo: ['탄약', '彈'],
  consumable: ['먹을거리 · 약', '食'],
  herb: ['약초', '藥'],
  meat: ['고기', '肉'],
  pelt: ['가죽', '皮'],
  material: ['재료', '材'],
  valuable: ['귀중품', '寶'],
  other: ['그 밖의 것', '雜'],
};
const CAT_ORDER = Object.keys(CATS);
const catOf = (def) => (CATS[def?.cat] ? def.cat : 'other');

function isUsable(def) {
  if (!def) return false;
  if (typeof def.use === 'function' || def.use === true) return true;
  if (def.use && typeof def.use === 'object') return true;
  return def.cat === 'consumable';
}

function invList(game) {
  const l = safe(() => game.sys.inventory?.list?.(), []);
  return Array.isArray(l) ? l.filter((e) => e && e.id != null && (e.n ?? 1) > 0) : [];
}

// ==================================================================== 소지품

export function createInventoryView(c) {
  const { game } = c;
  ensureItemDefs(() => c.queueRefresh());
  const list = h('div', { class: 'jx-inv-list' });
  const detail = h('aside', { class: 'jx-detail', 'aria-live': 'polite' });
  const el = h('div', { class: 'jx-inv' }, list, detail);
  let sel = null;
  let cells = new Map();
  let items = [];

  function equippedId() {
    const p = game.player;
    return safe(() => game.sys.combat?.weaponOf?.(p)?.id, null) ?? p?.weapon?.id ?? null;
  }

  function select(id) {
    sel = id;
    for (const [k, b] of cells) b.setAttribute('aria-pressed', k === id ? 'true' : 'false');
    renderDetail();
  }

  function renderDetail() {
    detail.textContent = '';
    const e = items.find((i) => i.id === sel);
    if (!e) {
      detail.append(h('p', { class: 'jx-muted', text: '물건을 고르면 자세한 내용이 여기 나옵니다.' }));
      return;
    }
    const def = defOf(e.id, e);
    const [catName] = CATS[catOf(def)];
    detail.append(
      h('div', { class: 'jx-detail-top' }, itemIcon(def, 64), h('div', null, h('h2', { text: def.name || e.id }), h('div', { class: 'jx-muted', text: `${catName} · ${e.n ?? 1}개` })))
    );
    if (def.desc) detail.append(h('p', { class: 'jx-desc', text: def.desc }));
    if (def.price) detail.append(h('p', { class: 'jx-muted', text: `시세 ${c.money(def.price)}` }));
    const acts = h('div', { class: 'jx-actions' });
    const inv = game.sys.inventory;
    if (isUsable(def) && typeof inv?.use === 'function') {
      acts.append(
        h('button', {
          class: 'jx-btn jx-primary',
          type: 'button',
          text: def.cat === 'consumable' || def.cat === 'herb' || def.cat === 'meat' ? '먹기 · 쓰기' : '쓰기',
          onclick: () => {
            const ok = safe(() => inv.use(e.id), false);
            if (!ok) c.toast(`지금은 ${josa(def.name || e.id, '을', '를')} 쓸 수 없습니다`, 'warn');
            refresh();
          },
        })
      );
    }
    const combat = game.sys.combat;
    if (def.cat === 'weapon' && typeof combat?.equip === 'function' && game.player) {
      const eq = equippedId() === e.id;
      acts.append(
        h('button', {
          class: 'jx-btn',
          type: 'button',
          text: eq ? '손에 들고 있음' : '손에 들기',
          disabled: eq,
          onclick: () => {
            const ok = safe(() => combat.equip(game.player, e.id), false);
            if (ok !== false) c.toast(`${josa(def.name || e.id, '을', '를')} 손에 들었습니다`);
            refresh();
          },
        })
      );
    }
    if (acts.childElementCount !== 0) detail.append(acts);
  }

  function refresh() {
    list.textContent = '';
    cells = new Map();
    const inv = game.sys.inventory;
    setClass(el, 'jx-solo', !inv?.list || !invList(game).length);
    if (!inv?.list) {
      items = [];
      list.append(emptyNote('囊', '보따리를 아직 풀 수 없습니다', '소지품 기능이 준비되면 여기에 물건이 나옵니다.'));
      renderDetail();
      return;
    }
    items = invList(game);
    if (!items.length) {
      list.append(emptyNote('空', '보따리가 비어 있습니다', '사냥하고, 약초를 캐고, 길에서 물건을 주워 보십시오.'));
      sel = null;
      renderDetail();
      return;
    }
    const eq = equippedId();
    const groups = new Map();
    for (const e of items) {
      const k = catOf(defOf(e.id, e));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const order = [];
    for (const k of CAT_ORDER) {
      const g = groups.get(k);
      if (!g) continue;
      const [name, hanja] = CATS[k];
      const grid = h('div', { class: 'jx-grid', role: 'list' });
      for (const e of g) {
        const def = defOf(e.id, e);
        order.push(e.id);
        const b = h(
          'button',
          {
            class: 'jx-cell',
            type: 'button',
            role: 'listitem',
            'aria-pressed': 'false',
            'aria-label': `${def.name || e.id} ${e.n ?? 1}개`,
            title: def.name || e.id,
            onclick: () => select(e.id),
          },
          itemIcon(def, 42),
          (e.n ?? 1) > 1 ? h('span', { class: 'jx-n', text: `${e.n}` }) : null,
          eq === e.id ? h('span', { class: 'jx-seal jx-eq', text: '手', 'aria-label': '손에 듦' }) : null
        );
        cells.set(e.id, b);
        grid.append(b);
      }
      list.append(h('section', { class: 'jx-cat' }, h('h3', { class: 'jx-sec-h' }, h('span', { text: name }), h('small', { text: hanja })), grid));
    }
    if (!sel || !cells.has(sel)) sel = order[0];
    select(sel);
  }

  return { el, fill: true, money: true, mount: refresh, refresh };
}

// ==================================================================== 제작

function skillName(game, id) {
  const sk = game.sys.skills;
  const T = sk?.TREES;
  if (!T) return String(id);
  const trees = Array.isArray(T) ? T : Object.values(T);
  for (const t of trees) {
    const nodes = t?.skills || t?.nodes || t?.perks || [];
    const arr = Array.isArray(nodes) ? nodes : Object.keys(nodes).map((k) => ({ id: k, ...nodes[k] }));
    const n = arr.find((x) => x?.id === id);
    if (n) return n.name || n.title || String(id);
    if (t?.id === id) return t.name || String(id);
  }
  return String(id);
}

function skillReq(game, s) {
  const sk = game.sys.skills;
  if (!s) return null;
  if (typeof s === 'string') return { text: `기술: ${skillName(game, s)}`, ok: safe(() => sk?.has?.(s), true) !== false };
  if (typeof s === 'object') {
    if (s.tree) {
      const lv = safe(() => sk?.level?.(s.tree), null);
      return { text: `${skillName(game, s.tree)} ${s.level ?? 1}단`, ok: lv == null ? true : lv >= (s.level ?? 1) };
    }
    if (s.id) return { text: `기술: ${skillName(game, s.id)}`, ok: safe(() => sk?.has?.(s.id), true) !== false };
  }
  return null;
}

export function createCraftView(c) {
  const { game } = c;
  ensureItemDefs(() => c.queueRefresh());
  const el = h('div');

  function refresh() {
    el.textContent = '';
    const cr = game.sys.crafting;
    if (!cr?.recipes) {
      el.append(emptyNote('工', '아직 손재주를 부릴 수 없습니다', '제작 기능이 준비되면 만들 수 있는 것이 여기에 나옵니다.'));
      return;
    }
    const recipes = (safe(() => cr.recipes(), []) || []).filter((r) => r && r.id != null);
    if (!recipes.length) {
      el.append(emptyNote('工', '만들 수 있는 것이 없습니다', '기술을 익히면 새 조리법이 생깁니다.'));
      return;
    }
    const inv = game.sys.inventory;
    const rows = recipes.map((r) => {
      const inputs = Array.isArray(r.inputs) ? r.inputs : [];
      const have = (id) => Number(safe(() => inv?.count?.(id), 0)) || 0;
      const enough = inputs.every((i) => have(i.id) >= (i.n ?? 1));
      const can = safe(() => cr.canCraft?.(r.id), enough) !== false && enough;
      return { r, inputs, have, can };
    });
    rows.sort((a, b) => (b.can ? 1 : 0) - (a.can ? 1 : 0));
    el.append(h('h3', { class: 'jx-sec-h' }, h('span', { text: '만들 수 있는 것' }), h('small', { text: '製作' })));
    const box = h('div', { class: 'jx-rows' });
    for (const { r, inputs, have, can } of rows) {
      const outId = r.output?.id ?? r.id;
      const outDef = defOf(outId);
      const req = skillReq(game, r.skill);
      box.append(
        h(
          'div',
          { class: `jx-row${can ? ' jx-ok' : ''}` },
          itemIcon(outDef, 44),
          h(
            'div',
            null,
            h('h4', { text: `${r.name || outDef.name || outId}${(r.output?.n ?? 1) > 1 ? ` ×${r.output.n}` : ''}` }),
            h(
              'div',
              { class: 'jx-chips' },
              inputs.map((i) => {
                const n = have(i.id), need = i.n ?? 1;
                return h('span', { class: `jx-chip${n < need ? ' jx-lack' : ''}`, text: `${defOf(i.id).name || i.id} ${n}/${need}` });
              }),
              req ? h('span', { class: `jx-chip${req.ok ? '' : ' jx-lack'}`, text: req.text }) : null
            )
          ),
          h('button', {
            class: 'jx-btn jx-primary',
            type: 'button',
            text: '만들기',
            disabled: !can,
            'aria-label': `${r.name || outDef.name || outId} 만들기`,
            onclick: () => {
              const ok = safe(() => cr.craft(r.id), false);
              if (!ok) c.toast('재료가 모자라거나 아직 만들 수 없습니다', 'warn');
              refresh();
            },
          })
        )
      );
    }
    el.append(box);
  }

  return { el, money: true, mount: refresh, refresh };
}

// ==================================================================== 상점

function shopName(sh, id) {
  const S = sh?.SHOPS;
  const d = S ? (Array.isArray(S) ? S.find((s) => s?.id === id) : S[id]) : null;
  return d?.name || d?.title || '가게';
}

export function createShopView(c) {
  const { game } = c;
  ensureItemDefs(() => c.queueRefresh());
  const buyCol = h('div', { class: 'jx-shop-col' });
  const sellCol = h('div', { class: 'jx-shop-col' });
  const tradeName = h('div', { class: 'jx-trade-name', 'aria-live': 'polite' });
  const qtyOut = h('output', { 'aria-label': '수량' });
  const total = h('div', { class: 'jx-price' });
  const minus = h('button', { class: 'jx-btn', type: 'button', text: '−', 'aria-label': '하나 덜', onclick: () => setQty(qty - 1) });
  const plus = h('button', { class: 'jx-btn', type: 'button', text: '+', 'aria-label': '하나 더', onclick: () => setQty(qty + 1) });
  const go = h('button', { class: 'jx-btn jx-primary', type: 'button', text: '사기', onclick: () => doTrade() });
  const trade = h('div', { class: 'jx-trade' }, tradeName, h('div', { class: 'jx-qty' }, minus, qtyOut, plus), total, go);
  const el = h('div', { class: 'jx-shop' }, buyCol, sellCol, trade);

  let shopId = null;
  let sel = null; // {mode:'buy'|'sell', id, price, max}
  let qty = 1;
  let rowBtns = [];

  function setQty(n) {
    if (!sel) return;
    qty = Math.max(1, Math.min(Math.max(1, sel.max), n | 0));
    renderTrade();
  }

  function renderTrade() {
    if (!sel) {
      setText(tradeName, '물건을 고르십시오');
      setText(qtyOut, '');
      setText(total, '');
      minus.disabled = plus.disabled = go.disabled = true;
      go.textContent = '사기';
      return;
    }
    const def = defOf(sel.id);
    setText(tradeName, `${def.name || sel.id} · 한 개 ${c.money(sel.price)}`);
    setText(qtyOut, String(qty));
    setText(total, `${sel.mode === 'buy' ? '값' : '받을 돈'} ${c.money(sel.price * qty)}`);
    minus.disabled = qty <= 1;
    plus.disabled = qty >= sel.max;
    go.textContent = sel.mode === 'buy' ? '사기' : '팔기';
    go.disabled = sel.max < 1;
    setAttr(go, 'aria-label', `${def.name || sel.id} ${qty}개 ${sel.mode === 'buy' ? '사기' : '팔기'}`);
  }

  function doTrade() {
    const sh = game.sys.shops;
    if (!sel || !sh) return;
    const def = defOf(sel.id);
    const fn = sel.mode === 'buy' ? sh.buy : sh.sell;
    const ok = typeof fn === 'function' ? safe(() => fn.call(sh, shopId, sel.id, qty), false) : false;
    if (!ok) c.toast(sel.mode === 'buy' ? '돈이 모자라거나 살 수 없는 물건입니다' : `${josa(def.name || sel.id, '은', '는')} 팔 수 없습니다`, 'warn');
    refresh();
  }

  function row(mode, id, price, sub, max) {
    const def = defOf(id);
    const b = h(
      'button',
      {
        class: 'jx-srow',
        type: 'button',
        'aria-pressed': sel && sel.mode === mode && sel.id === id ? 'true' : 'false',
        onclick: () => {
          sel = { mode, id, price, max };
          qty = 1;
          for (const r of rowBtns) r.setAttribute('aria-pressed', r === b ? 'true' : 'false');
          renderTrade();
        },
      },
      itemIcon(def, 32),
      h('span', { class: 'jx-nm' }, def.name || id, sub ? h('small', { text: sub }) : null),
      h('span', { class: 'jx-price', text: c.money(price) })
    );
    rowBtns.push(b);
    return b;
  }

  function refresh() {
    const sh = game.sys.shops;
    buyCol.textContent = '';
    sellCol.textContent = '';
    rowBtns = [];
    c.setTitle(shopName(sh, shopId), '商');
    if (!sh) {
      buyCol.append(emptyNote('商', '가게 문이 닫혀 있습니다', '상점 기능이 준비되지 않았습니다.'));
      sel = null;
      renderTrade();
      return;
    }
    const money = Number(game.sys.inventory?.money) || 0;
    const stock = (safe(() => sh.stock?.(shopId), []) || []).filter((s) => s && s.itemId != null);
    buyCol.append(h('h3', { class: 'jx-sec-h' }, h('span', { text: '사기' }), h('small', { text: '買' })));
    if (!stock.length) buyCol.append(h('p', { class: 'jx-muted', text: '팔 물건이 다 떨어졌습니다.' }));
    let stillSel = false;
    for (const s of stock) {
      const price = Number(safe(() => sh.buyPrice?.(shopId, s.itemId), null) ?? s.price ?? defOf(s.itemId).price ?? 0) || 0;
      const left = typeof s.n === 'number' && isFinite(s.n) ? s.n : 99;
      const max = Math.min(left, price > 0 ? Math.floor(money / price) : 99, 99);
      if (sel?.mode === 'buy' && sel.id === s.itemId) {
        sel = { mode: 'buy', id: s.itemId, price, max };
        stillSel = true;
      }
      buyCol.append(row('buy', s.itemId, price, typeof s.n === 'number' && isFinite(s.n) ? `${s.n}개 남음` : '', max));
    }
    sellCol.append(h('h3', { class: 'jx-sec-h' }, h('span', { text: '팔기' }), h('small', { text: '賣' })));
    const mine = invList(game).filter((e) => catOf(defOf(e.id, e)) !== 'quest');
    let nSell = 0;
    for (const e of mine) {
      const price = Number(safe(() => sh.sellPrice?.(shopId, e.id), 0)) || 0;
      if (price <= 0) continue;
      nSell++;
      const max = Math.min(e.n ?? 1, 99);
      if (sel?.mode === 'sell' && sel.id === e.id) {
        sel = { mode: 'sell', id: e.id, price, max };
        stillSel = true;
      }
      sellCol.append(row('sell', e.id, price, `${e.n ?? 1}개 가짐`, max));
    }
    if (!nSell) sellCol.append(h('p', { class: 'jx-muted', text: '이 가게가 사 줄 물건이 없습니다.' }));
    if (!stillSel) sel = null;
    if (sel) qty = Math.max(1, Math.min(qty, Math.max(1, sel.max)));
    for (const r of rowBtns) if (r.getAttribute('aria-pressed') === 'true' && !sel) r.setAttribute('aria-pressed', 'false');
    renderTrade();
  }

  return {
    el,
    fill: true,
    money: true,
    title: '가게',
    hanja: '商',
    mount(arg) {
      if (arg !== shopId) {
        sel = null;
        qty = 1;
      }
      shopId = arg ?? null;
      refresh();
    },
    refresh,
  };
}
