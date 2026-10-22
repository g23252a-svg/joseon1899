// 게이지 [전투] — 체력·기력·호안 {value, max, core}. 플레이어 Human 의 hp/stamina 와 동기한다. 스펙 F.1.
//
//   game.sys.stats: health stamina hoan  useHoan(n) → bool  eat(itemId) → bool  rest(hours = 8, opts)
//   계약 밖: buffs [{stat, mul, until(누적 게임시)}]  addBuff(stat, mul, hours)  buffMul(stat)  refill()  lastHurt  EAT
//     buff stat: staminaDrain(기력 소모) · hoanDrain(호안 소모) · healthRegen(체력 회복) · regen(체력·기력 회복) · spread(취기 탄퍼짐)
//   심지(core)는 F(풀 버전) — 100 고정. 배고픔·피로 없음.
//   eat 는 효과만 준다(소지품에서 빼는 것은 inventory.use 몫). 조준 중이거나 쓰러져 있으면 false.
//     효과는 EAT 표, 없으면 아이템 정의의 use {hp, stamina, hoan, full[], buff{stat, mul, hours}, drunk}.
//   rest(hours, {buff:[stat, mul, hours], save:false}) — 시간을 건너뛰고 체력·기력 가득, 호안 +30, 조용히 저장 (G.4 잠과 휴식).

const EAT = {
  c_roast: { health: 25 },
  c_gukbap: { health: 40, stamina: 20 },
  c_makgeolli: { hoan: 15, stamina: 10, buff: ['spread', 1.3, 1] },
  c_salve: { health: 50 },
  c_galgeun: { stamina: 999, buff: ['staminaDrain', 0.7, 1] },
  c_cheongsim: { hoan: 999, buff: ['hoanDrain', 0.8, 2] },
  m_meat: { health: 5 },
  h_galgeun: { stamina: 5 },
  h_ssuk: { health: 3 },
  h_dangwi: { health: 5 },
  h_doraji: { health: 3, stamina: 5 },
  h_omija: { stamina: 10 },
};
const RAINY = new Set(['rain', 'storm']);

/** 아이템 use 형식 → EAT 형식 */
function fromUse(u) {
  if (!u || typeof u !== 'object' || u.horse) return null;
  const e = { health: u.hp, stamina: u.full?.includes?.('stamina') ? 999 : u.stamina, hoan: u.full?.includes?.('hoan') ? 999 : u.hoan };
  if (u.buff?.stat) e.buff = [u.buff.stat, u.buff.mul ?? 1, u.buff.hours ?? 1];
  else if (u.drunk) e.buff = ['spread', 1.3, u.drunk];
  return e;
}

class Stats {
  constructor(game) {
    Object.assign(this, { name: 'stats', order: 15, game, EAT, buffs: [], lastHurt: -99 });
    this.health = { value: 100, max: 100, core: 100 };
    this.stamina = { value: 100, max: 100, core: 100 };
    this.hoan = { value: 100, max: 100, core: 100 };
  }

  _sk(key, base) {
    const v = this.game.sys.skills?.mod?.(key, base);
    return Number.isFinite(v) ? v : base;
  }
  /** 누적 게임시 (버프 만료 기준) */
  _hours() {
    const t = this.game.sys.time;
    return t && Number.isFinite(t.hour) ? ((t.day || 1) - 1) * 24 + t.hour : this.game.time / 120;
  }
  addBuff(stat, mul, hours) {
    this.buffs = this.buffs.filter((b) => b.stat !== stat);
    this.buffs.push({ stat, mul, until: this._hours() + hours });
  }
  buffMul(stat) {
    let m = 1;
    for (const b of this.buffs) if (b.stat === stat) m *= b.mul;
    return m;
  }

  useHoan(amount) {
    const h = this.hoan;
    if (!(amount > 0)) return h.value > 0;
    if (h.value < amount) return (h.value = 0), false;
    h.value -= amount;
    return true;
  }

  eat(itemId, effect = null) {
    const p = this.game.player;
    const e = effect || EAT[itemId] || fromUse(this.game.sys.inventory?.def?.(itemId)?.use);
    if (!e || !p || p.state !== 'normal' || p.aiming) return false;
    if (e.health) p.hp = Math.min(p.maxHp, p.hp + e.health);
    if (e.stamina) p.stamina = Math.min(p.maxStamina, p.stamina + e.stamina);
    if (e.hoan) this.hoan.value = Math.min(this.hoan.max, this.hoan.value + e.hoan);
    if (e.buff) this.addBuff(...e.buff);
    this.lateUpdate(0, 0, this.game);
    return true;
  }

  /** 게이지 가득 (부활·잠) */
  refill() {
    const p = this.game.player;
    if (p) (p.hp = p.maxHp), (p.stamina = p.maxStamina);
    this.hoan.value = this.hoan.max;
    this.lateUpdate(0, 0, this.game);
  }

  rest(hours = 8, opts = {}) {
    const g = this.game, p = g.player;
    if (!p || p.state === 'dead') return false;
    g.sys.time?.skip?.(hours);
    p.hp = p.maxHp;
    p.stamina = p.maxStamina;
    this.hoan.value = Math.min(this.hoan.max, this.hoan.value + 30);
    if (opts?.buff) this.addBuff(...opts.buff);
    this.lateUpdate(0, 0, g);
    if (opts?.save !== false) g.sys.save?.save?.('auto', { quiet: true, auto: true });
    g.notify(`${Math.round(hours)}시간 푹 쉬었다`, 'good');
    return true;
  }

  init(g) {
    g.on('damage', (e) => {
      if (e.target && e.target === g.player && e.amount > 0) this.lastHurt = g.realTime;
    });
    // 호안 채우기: 사람 처치 +5, 머리 처치 +10, 동물 처치 +3
    g.on('kill', (e) => {
      const k = e.killer, v = e.victim;
      if (!k || !(k === g.player || k.isPlayer) || !v) return;
      const n = v.kind === 'human' ? (e.info?.headshot ? 10 : 5) : v.kind === 'animal' ? 3 : 0;
      if (n) this.hoan.value = Math.min(this.hoan.max, this.hoan.value + n);
    });
  }

  update(dt, realDt, g) {
    const p = g.player;
    if (!p || g.state !== 'play') return;
    // 최대치 (스킬: 단련 +20, 호안 수련 +25)
    const hmax = 100 + this._sk('healthMax', 0);
    if (p.maxHp !== hmax) (p.maxHp = hmax), (p.hp = Math.min(p.hp, hmax));
    this.hoan.max = 100 + this._sk('hoanMax', 0);
    if (this.buffs.length) {
      const now = this._hours();
      this.buffs = this.buffs.filter((b) => b.until > now);
    }
    if (p.state === 'dead') return;
    const regen = this.buffMul('regen');
    // 체력: 마지막 피해 6실초 뒤부터 0.8/s
    if (p.hp > 0 && p.hp < p.maxHp && g.realTime - this.lastHurt >= 6) p.hp = Math.min(p.maxHp, p.hp + 0.8 * dt * this.buffMul('healthRegen') * regen);
    // 기력: 회복·소모는 Human 이 하고 배수만 준다 (비 오면 회복 ×0.85)
    p.staminaRegenMul = (RAINY.has(g.sys.time?.weather) ? 0.85 : 1) * regen;
    p.staminaDrainMul = this.buffMul('staminaDrain');
    p.speedCrouch = this._sk('crouchSpeed', 1);
    // 호안: 쓰지 않을 때 0.4/s
    if (!g.sys.combat?.hoanActive) this.hoan.value = Math.min(this.hoan.max, this.hoan.value + 0.4 * dt);
  }

  lateUpdate(dt, realDt, g) {
    const p = g.player;
    if (!p) return;
    Object.assign(this.health, { value: Math.max(0, p.hp), max: p.maxHp });
    Object.assign(this.stamina, { value: p.stamina, max: p.maxStamina });
    if (this.hoan.value > this.hoan.max) this.hoan.value = this.hoan.max;
  }

  serialize() {
    return { hoan: this.hoan.value, buffs: this.buffs.map((b) => ({ ...b })) };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    if (Number.isFinite(d.hoan)) this.hoan.value = Math.max(0, d.hoan);
    this.buffs = Array.isArray(d.buffs) ? d.buffs.filter((b) => b && typeof b.stat === 'string' && Number.isFinite(b.mul) && Number.isFinite(b.until)) : [];
  }
}

export function install(game) {
  return game.registerSystem(new Stats(game));
}
