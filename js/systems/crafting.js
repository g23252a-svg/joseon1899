// 제작 [파밍] — game.sys.crafting (ARCHITECTURE §5, 스펙 D.2).
//   recipes() → [{id, name, inputs:[{id,n}], output:{id,n}, skill?, where, time, xp}]   canCraft(id)   craft(id) → bool
//   (추가) RECIPES, whyNot(id) → 못 만드는 까닭(문구)|null, nearFire(x, y, pot?)
// 경험치는 skills 가 'craft' 이벤트로 준다. "불 곁" = 모닥불·주막·산채 솥 3 m 안. 제작은 소지품 화면에서 하므로 시간(초)은 기록만 하고 바로 만든다.

import { itemDef } from './items.js';

const R = (id, out, n, inputs, time, where, skill, tree, xp) => ({ id, output: { id: out, n }, inputs: inputs.map(([i, k]) => ({ id: i, n: k })), time, where, ...(skill ? { skill } : {}), xp: { [tree]: xp } });

export const RECIPES = [
  R('rc_arrow', 'a_arrow', 5, [['mat_ssari', 2], ['mat_feather', 1]], 4, 'any', null, 'sagyeok', 2),
  R('rc_roast', 'c_roast', 1, [['m_meat', 1]], 3, 'fire', null, 'saengjon', 3),
  R('rc_stew', 'c_gukbap', 1, [['m_meat', 2], ['h_doraji', 1]], 5, 'pot', null, 'saengjon', 5),
  R('rc_salve', 'c_salve', 1, [['h_ssuk', 2], ['h_dangwi', 1]], 4, 'any', 'sae_herbal', 'saengjon', 8),
  R('rc_galgeun', 'c_galgeun', 1, [['h_galgeun', 2], ['h_omija', 1]], 4, 'fire', 'sae_herbal', 'saengjon', 8),
  R('rc_ball', 'a_ball', 5, [['mat_powder', 1]], 3, 'any', null, 'sagyeok', 4),
  R('rc_matchcord', 'a_matchcord', 3, [['h_galgeun', 1], ['mat_powder', 1]], 4, 'any', 'sag_hwaseung', 'sagyeok', 4),
  R('rc_club', 'w_club', 1, [['mat_ssari', 3]], 5, 'any', null, 'muye', 3),
];
const NAMES = { rc_stew: '국밥(고깃국)' };
const WHERE = { fire: '불 곁', pot: '산채 솥·주막' };
const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

class Crafting {
  constructor(game) {
    this.name = 'crafting';
    this.order = 21;
    this.game = game;
    this.RECIPES = RECIPES;
    this._fires = null; // [{x, y, r, pot}]
  }

  recipes() {
    return RECIPES.map((r) => {
      const base = NAMES[r.id] || itemDef(r.output.id)?.name || r.id;
      return { ...r, name: WHERE[r.where] ? `${base} (${WHERE[r.where]})` : base };
    });
  }

  /** 모닥불·솥 자리 + 주막 건물 (처음 부를 때 한 번 모은다) */
  fires() {
    if (this._fires) return this._fires;
    const w = this.game.world, out = [];
    // 장소 id 끝이 _fire/_pot 이거나 이름에 모닥불·솥 (lm_fire_1899 같은 사고 현장은 빼고)
    for (const p of Object.values(w?.places || {})) {
      const s = `${p.id} ${p.name || ''}`, pot = /_pot\b|솥/.test(s), fire = pot || /_fire\b|모닥불/.test(s) || p.tags?.includes('fire');
      if (fire) out.push({ x: p.x, y: p.y, r: 3.5, pot });
    }
    for (const b of w?.buildings || [])
      if (b.kind === 'jumak' || String(b.shop || '').startsWith('jumak_')) out.push({ x: b.x, y: b.y, r: Math.max(b.w || 8, b.h || 8) / 2 + 3, pot: true });
    return (this._fires = out);
  }
  nearFire(x, y, pot = false) {
    for (const f of this.fires()) if ((!pot || f.pot) && Math.hypot(f.x - x, f.y - y) <= f.r) return true;
    // 미션·NPC 가 놓은 불 엔티티 (태그 fire / campfire / pot)
    return !!this.game.nearest(x, y, 3, (e) => e.tags?.has('pot') || (!pot && (e.tags?.has('fire') || e.tags?.has('campfire'))));
  }

  whyNot(id) {
    const r = BY_ID.get(id), g = this.game, inv = g.sys.inventory, p = g.player;
    if (!r) return '그런 조리법은 없습니다';
    if (r.skill && g.sys.skills?.has && !g.sys.skills.has(r.skill)) return '기술을 먼저 익혀야 합니다';
    for (const i of r.inputs) if ((inv?.count?.(i.id) ?? 0) < i.n) return '재료가 모자랍니다';
    if (r.where !== 'any' && (!p || !this.nearFire(p.x, p.y, r.where === 'pot'))) return `${WHERE[r.where]}에서만 만들 수 있습니다`;
    if ((inv?.room?.(r.output.id) ?? 99) < r.output.n) return '더 들 수 없습니다';
    return null;
  }
  canCraft(id) {
    return !this.whyNot(id);
  }
  craft(id) {
    const r = BY_ID.get(id), g = this.game, inv = g.sys.inventory;
    if (!r || !inv || this.whyNot(id)) return false;
    for (const i of r.inputs) inv.remove(i.id, i.n);
    inv.add(r.output.id, r.output.n);
    g.emit('craft', { recipeId: id, output: r.output, xp: r.xp });
    return true;
  }
}

export function install(game) {
  return game.registerSystem(new Crafting(game));
}
