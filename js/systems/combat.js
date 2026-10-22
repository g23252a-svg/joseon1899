// 전투 [전투] — 무기·사격·근접·투사체·호안(虎眼)·효과(연기·총구 화염·피).
//
//   game.sys.combat: WEAPONS  equip(h, id) → bool  weaponOf(h)  fire(shooter, angle, opts) → bool  melee(attacker, angle, opts) → 맞은 대상|null
//     npcAttack(npc, target, dt) → {dist, see, fired}|null   hoanActive  startHoan() → bool  endHoan()
//   계약 밖 추가: reload(h) · ammo(h) → {loaded, mag, reserve} · raycast(x, y, angle, dist, shooter) → {t, x, y, e, head}|null
//     lineOfSight(x0, y0, x1, y1) → bool(지형·건물·화승총 연기) · noiseOf(h) → m · smokeAt(x, y) · applyHit(target, dmg, info) · stealthKill(t)
//   이벤트: shot {shooter, weapon, x, y, angle, noise}, hit {target, amount, source, weapon, headshot, kind, ko, knock, blocked},
//     hoan:start / hoan:end. 계약 밖: knockout {victim, attacker, info}(비살상 기절 60초), noise {x, y, radius, source, kind}(근접·잠입)
//   피해 info 에 계약 밖 stealth(잠입 처치)·hoan(호안 중) 을 덧붙인다.
//   fire opts: {power(활 0.4~1), exact(퍼짐 0), force(간격 무시), spreadMul, mark}. NPC 는 탄이 무한, 장전 시간만 든다.
//   NPC 퍼짐 배수는 npc.data.spreadMul 이 있으면 그것, 없으면 role 표(G.2). 말 위 퍼짐은 human.mountedSpread(수 또는 함수).
// 플레이어 조작: 오른쪽 = 조준(근접 무기는 막기), 왼쪽 = 사격·공격(0.6초 눌렀다 놓기 = 강한 공격, 활은 당김), R 장전,
//   1/2 무기 바꾸기, Tab 직전 무기, X 넣기, Q 호안, 웅크려 등 뒤에서 E = 잠입 처치.

import { Entity, LAYER } from '../engine/entity.js';
import { PAL } from '../engine/palette.js';
import { angleWrap, clamp, rand } from '../engine/util.js';

export const WEAPONS = {
  fist: { id: 'fist', name: '주먹', kind: 'fist', damage: 8, range: 1.2, fireInterval: 0.45, reload: 0, mag: 0, ammo: null, spread: 0, noise: 8, stamina: 4, knock: 0.1, peltClass: 'melee', nonLethal: 0.9, length: 0 },
  w_knife: { id: 'w_knife', name: '장도', kind: 'melee', damage: 22, range: 1.3, fireInterval: 0.5, reload: 0, mag: 0, ammo: null, spread: 0, noise: 6, stamina: 5, knock: 0.05, peltClass: 'melee', blade: true, color: '#7d7a72', length: 0.38 },
  w_club: { id: 'w_club', name: '몽둥이', kind: 'melee', damage: 18, range: 1.8, fireInterval: 0.8, reload: 0, mag: 0, ammo: null, spread: 0, noise: 10, stamina: 8, knock: 0.35, peltClass: 'melee', blunt: true, nonLethal: 0.7, color: '#6b4a2a', length: 0.62 },
  w_hwando: { id: 'w_hwando', name: '환도', kind: 'melee', damage: 32, range: 2.0, fireInterval: 0.7, reload: 0, mag: 0, ammo: null, spread: 0, noise: 10, stamina: 7, knock: 0.1, peltClass: 'melee', blade: true, color: '#8c8a84', length: 0.85 },
  w_bow: { id: 'w_bow', name: '각궁', kind: 'bow', damage: 45, range: 90, effRange: 60, fireInterval: 1.0, reload: 0.6, mag: 1, ammo: 'a_arrow', spread: 0.02, noise: 4, draw: 0.8, projSpeed: 55, peltClass: 'arrow', color: '#5a3a1a', length: 0.55 },
  w_matchlock: { id: 'w_matchlock', name: '화승총', kind: 'gun', damage: 80, range: 70, effRange: 40, fireInterval: 0, reload: 6.0, mag: 1, ammo: 'a_ball', spread: 0.06, noise: 140, ignite: 0.35, needs: 'a_matchcord', peltClass: 'ball', color: '#3a2a1a', length: 1.05 },
  w_rifle: { id: 'w_rifle', name: '양총', kind: 'gun', damage: 90, range: 150, effRange: 90, fireInterval: 0, reload: 2.0, mag: 1, ammo: 'a_rifle', spread: 0.015, noise: 180, peltClass: 'rifle', color: '#2e2a26', length: 0.95 },
  w_revolver: { id: 'w_revolver', name: '육혈포', kind: 'gun', damage: 40, range: 35, effRange: 20, fireInterval: 0.45, reload: 4.5, mag: 6, ammo: 'a_revolver', spread: 0.04, noise: 110, reloadPerRound: 0.75, peltClass: 'pistol', color: '#2a2826', length: 0.3 },
  // NPC 전용
  npc_rock: { id: 'npc_rock', name: '돌', kind: 'throw', damage: 8, range: 15, fireInterval: 1.5, reload: 0, mag: 0, ammo: null, spread: 0.05, projSpeed: 18, noise: 3, npc: true, length: 0 },
};

const NPC_SPREAD = { sungeom: 1.3, chongsun: 1.1, soldier: 1.0, gwanbyeong: 1.4, jogye_police: 1.2, bandit: 1.6, rival: 1.6, bandit_boss: 1.0, bounty_hunter: 1.0, rail_guard: 1.1, pirate: 1.6, foreigner: 1.2 };
const NPC_REACT = { porter: 0.5, sungeom: 0.5, chongsun: 0.4, jogye_police: 0.5, bandit_boss: 0.4, bounty_hunter: 0.4, rail_guard: 0.5, bandit: 0.7, pirate: 0.7 };
const MISFIRE = { cloudy: 0.02, rain: 0.35, storm: 0.35, fog: 0.1, snow: 0.2 };
const SOUND_MUL = { rain: 0.6, storm: 0.6 };
const START_KIT = ['w_knife', 'w_matchlock']; // 소지품 시스템이 없을 때
const MAX_FX = 300;
const TAU = Math.PI * 2;
const _sol = [];

const isRanged = (w) => w.kind === 'gun' || w.kind === 'bow' || w.kind === 'throw';
const cbOf = (h) => h.data.cb || (h.data.cb = { cool: 0, reloadT: 0, reloadMax: 1, reloadOne: false, mag: {}, pend: null, cord: 0, draw: 0, holdT: 0, swingT: 0, aimT: 0, combo: 0, lastSwing: -9, lDown: false, rDown: false, blocking: false, last: null });
function gauss() {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random());
}
function rayCircle(x0, y0, c, n, cx, cy, r) {
  const dx = cx - x0, dy = cy - y0, tc = dx * c + dy * n;
  const p2 = dx * dx + dy * dy - tc * tc;
  if (p2 > r * r) return Infinity;
  const th = Math.sqrt(r * r - p2);
  if (tc - th >= 0) return tc - th;
  return tc + th >= 0 ? 0.06 : Infinity; // 원 안에서 쏨
}
/** 회전 사각형(중심 x,y) 진입 거리. 사각형 안에서 시작하면 무시 */
function rayRect(x0, y0, c, n, r) {
  const ca = Math.cos(-(r.angle || 0)), sa = Math.sin(-(r.angle || 0));
  const lx = (x0 - r.x) * ca - (y0 - r.y) * sa, ly = (x0 - r.x) * sa + (y0 - r.y) * ca;
  const dx = c * ca - n * sa, dy = c * sa + n * ca;
  const hw = r.w / 2, hh = r.h / 2;
  let t0 = -Infinity, t1 = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (lx < -hw || lx > hw) return Infinity;
  } else {
    const a = (-hw - lx) / dx, b = (hw - lx) / dx;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (Math.abs(dy) < 1e-9) {
    if (ly < -hh || ly > hh) return Infinity;
  } else {
    const a = (-hh - ly) / dy, b = (hh - ly) / dy;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t1 >= t0 && t0 > 0 ? t0 : Infinity;
}
/** hitTest 를 가진 대상(탈것 등): 감싸는 원 안을 0.15 m 씩 훑는다 */
function stepTest(q, x0, y0, c, n, maxT) {
  const R = Math.max(q.radius || 0.5, (q.length || 0) / 2 + 0.3);
  const t0 = rayCircle(x0, y0, c, n, q.x, q.y, R);
  if (!(t0 < maxT)) return Infinity;
  const t1 = Math.min(maxT, t0 + 2 * R);
  for (let t = t0; t <= t1; t += 0.15) if (q.hitTest(x0 + c * t, y0 + n * t, 0.03)) return t;
  return Infinity;
}

/** 땅에 떨어진 화살 (E 로 줍기) */
class DroppedArrow extends Entity {
  constructor(x, y, a) {
    super({ x, y, angle: a, radius: 0.3, solid: false, static: true, layer: LAYER.LOW, name: '화살' });
    this.kind = 'arrow';
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.strokeStyle = PAL.ink2;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(-0.35, 0);
    ctx.lineTo(0.35, 0);
    ctx.stroke();
    ctx.fillStyle = PAL.paperShade;
    ctx.fillRect(-0.36, -0.05, 0.12, 0.1);
    ctx.restore();
  }
  getInteractions(actor, game) {
    if (!actor.isPlayer) return [];
    return [{ key: 'interact', label: '화살 줍기', priority: 2, run: () => (game.sys.inventory?.add?.('a_arrow', 1), game.remove(this)) }];
  }
}

class Combat {
  constructor(game) {
    this.name = 'combat';
    this.order = 20;
    this.game = game;
    this.WEAPONS = WEAPONS;
    this.hoanActive = false;
    this.marks = []; // 호안 표식 {e, ox, oy}
    this.fx = []; // 입자
    this.decals = []; // 핏자국
    this.proj = []; // 날아가는 화살·돌
    this.smokes = []; // 시야 막는 화승총 연기
    this.arrows = []; // 떨어진 화살 엔티티
    this._armed = new Set();
    this._hoanCool = 0;
    this._exec = null;
    this._stealth = null;
    this._prevTS = 1;
    this._pendWeapon = null;
  }

  // ------------------------------------------------------------ 도움
  sk(key, base = 1) {
    return this.game.sys.skills?.mod?.(key, base) ?? base;
  }
  /** 플레이어만 스킬 보정 */
  pm(h, key, base = 1) {
    return h?.isPlayer ? this.sk(key, base) : base;
  }
  _soundMul() {
    return SOUND_MUL[this.game.sys.time?.weather] ?? 1;
  }
  _noise(x, y, r, source, kind) {
    this.game.emit('noise', { x, y, radius: r * this._soundMul(), source, kind });
  }
  _fx(f) {
    if (this.fx.length >= MAX_FX) return;
    f.t = 0;
    this.fx.push(f);
  }
  noiseOf(h) {
    let r = 0;
    const v = h.vehicle;
    if (v) {
      const sp = Math.hypot(v.vx || 0, v.vy || 0);
      r = v.moveMode === 'horse' ? (sp > 6 ? 30 : sp > 0.5 ? 15 : 0) : sp > 0.5 ? 10 : 0;
    } else if ((h.speedNow || 0) > 0.2) r = h.crouching ? 2 * this.pm(h, 'stealthNoise') : h.speedNow > 4.5 ? 18 : h.speedNow > 2.6 ? 12 : 6;
    return r * this._soundMul();
  }
  smokeAt(x, y) {
    const t = this.game.time;
    return this.smokes.some((s) => s.until > t && (s.x - x) ** 2 + (s.y - y) ** 2 < s.r * s.r);
  }

  // ------------------------------------------------------------ 무기
  weaponOf(h) {
    const w = h?.weapon;
    if (typeof w === 'string') return WEAPONS[w] || WEAPONS.fist;
    return (w && WEAPONS[w.id]) || (w?.kind ? w : WEAPONS.fist);
  }
  _owns(id) {
    const inv = this.game.sys.inventory;
    if (!inv?.has) return START_KIT.includes(id);
    return !!inv.has(id);
  }
  /** 플레이어가 쓸 수 있는 무기 목록 (맨손 먼저) */
  weaponList() {
    const inv = this.game.sys.inventory;
    let ids = START_KIT;
    if (inv?.weapons) {
      try {
        ids = inv.weapons() || [];
      } catch {
        ids = [];
      }
    }
    return ['fist', ...ids.filter((id) => WEAPONS[id] && id !== 'fist' && !WEAPONS[id].npc)];
  }
  equip(h, id) {
    if (!h) return false;
    const w = id == null || id === 'fist' ? WEAPONS.fist : WEAPONS[id];
    if (!w || (h.isPlayer && w.id !== 'fist' && !this._owns(w.id))) return false;
    const cb = cbOf(h), prev = h.weapon?.id;
    if (prev && prev !== w.id) cb.last = prev;
    cb.reloadT = 0;
    cb.pend = null;
    cb.draw = cb.holdT = cb.aimT = 0;
    h.weapon = w;
    if (!(w.id in cb.mag)) cb.mag[w.id] = w.mag || 0; // 처음 쥔 무기는 장전된 채
    if (h.isPlayer && w.needs) this._lightCord(h);
    this._armed.add(h);
    return true;
  }
  _switch(id) {
    const p = this.game.player;
    if (!p || p.weapon?.id === id) return;
    if (this.equip(p, id)) this.game.notify(id === 'fist' ? '무기를 넣었다' : `${WEAPONS[id].name}을(를) 들었다`);
  }
  _cycle(dir) {
    const list = this.weaponList(), p = this.game.player;
    const i = list.indexOf(p.weapon?.id ?? 'fist');
    this._switch(list[(i + dir + list.length) % list.length]);
  }
  _reserve(h, w) {
    if (!w.ammo || !h.isPlayer) return Infinity;
    const inv = this.game.sys.inventory;
    return inv?.count ? inv.count(w.ammo) || 0 : Infinity;
  }
  _take(h, w, n) {
    const inv = this.game.sys.inventory;
    if (!h.isPlayer || !w.ammo || !inv?.remove || !inv.count) return n;
    const k = Math.min(n, inv.count(w.ammo) || 0);
    return k > 0 && inv.remove(w.ammo, k) !== false ? k : 0;
  }
  ammo(h) {
    const w = this.weaponOf(h), cb = cbOf(h);
    return { loaded: cb.mag[w.id] ?? 0, mag: w.mag || 0, reserve: this._reserve(h, w) };
  }
  /** 화승: 남은 것이 있으면 다시 불붙이고, 없으면 하나 꺼낸다 (300초 ÷ matchcordBurn) */
  _lightCord(h, auto = false) {
    const cb = cbOf(h);
    if (cb.cord > 0) return true;
    const inv = this.game.sys.inventory;
    if (inv?.remove && !inv.remove('a_matchcord', 1)) {
      this.game.notify(auto ? '화승이 다 탔다 — 남은 화승이 없다' : '화승이 없어 화승총을 쏠 수 없다', 'warn');
      return false;
    }
    cb.cord = 300 / Math.max(0.1, this.sk('matchcordBurn'));
    if (auto) this.game.notify('새 화승에 불을 붙였다');
    return true;
  }
  reload(h) {
    const w = this.weaponOf(h), cb = cbOf(h);
    if (!isRanged(w) || !w.mag || cb.reloadT > 0 || cb.pend) return false;
    const ld = cb.mag[w.id] ?? 0;
    if (ld >= w.mag || this._reserve(h, w) <= 0) {
      if (h.isPlayer && ld < w.mag) this.game.notify('탄이 없다', 'warn');
      return false;
    }
    if (h.isPlayer && w.id === 'w_matchlock' && h.vehicle && Math.hypot(h.vehicle.vx || 0, h.vehicle.vy || 0) > 1.8) {
      this.game.notify('화승총은 멈추거나 평보일 때만 장전할 수 있다', 'warn');
      return false;
    }
    cb.reloadOne = !!w.reloadPerRound && ld > 0;
    let t = cb.reloadOne ? w.reloadPerRound : w.reload;
    if (w.id === 'w_matchlock') t *= this.pm(h, 'matchlockReload');
    cb.reloadT = cb.reloadMax = t * this.pm(h, 'reloadSpeed');
    if (w.kind === 'gun') this.game.sfx('reload', { x: h.x, y: h.y, volume: h.isPlayer ? 1 : 0.6 });
    return true;
  }
  _finishReload(h, w, cb) {
    const ld = cb.mag[w.id] ?? 0;
    cb.mag[w.id] = ld + this._take(h, w, cb.reloadOne ? 1 : w.mag - ld);
    // 육혈포는 한 발씩 계속 (쏘면 끊긴다)
    if (cb.reloadOne && cb.mag[w.id] < w.mag && this._reserve(h, w) > 0) cb.reloadT = cb.reloadMax = w.reloadPerRound * this.pm(h, 'reloadSpeed');
  }
  /** 사람마다 쿨·장전·점화 지연·화승 */
  _tick(h, dt, rdt) {
    const cb = h.data.cb;
    if (!cb) return;
    const w = this.weaponOf(h);
    if (cb.cool > 0) cb.cool -= dt;
    if (cb.reloadT > 0 && (cb.reloadT -= dt) <= 0) {
      cb.reloadT = 0;
      this._finishReload(h, w, cb);
    }
    if (cb.pend && (cb.pend.t -= rdt) <= 0) {
      const p = cb.pend;
      cb.pend = null;
      this._ignite(h, w, p);
    }
    if (h.isPlayer && w.needs && cb.cord > 0 && (cb.cord -= dt) <= 0) {
      cb.cord = 0;
      this._lightCord(h, true);
    }
  }

  // ------------------------------------------------------------ 사격
  fire(s, angle, opts = {}) {
    if (!s || s.state !== 'normal') return false;
    const w = this.weaponOf(s), cb = cbOf(s);
    this._armed.add(s);
    if (!isRanged(w)) return !!this.melee(s, angle, opts);
    if ((cb.cool > 0 && !opts.force) || cb.pend) return false;
    if (cb.reloadT > 0) {
      if (!(cb.reloadOne && (cb.mag[w.id] ?? 0) > 0)) return false;
      cb.reloadT = 0; // 한 발씩 장전은 끊고 쏜다
    }
    if (w.mag && (cb.mag[w.id] ?? 0) <= 0) {
      if (s.isPlayer) this.game.sfx('dry_fire', { x: s.x, y: s.y });
      this.reload(s);
      return false;
    }
    if (w.needs && s.isPlayer && !(cb.cord > 0) && !this._lightCord(s)) return false;
    cb.cool = Math.max(w.fireInterval || 0, 0.12) * (s.isPlayer ? 1 : 1.5);
    const ig = w.ignite ? (s.isPlayer && this.hoanActive ? 0.1 : w.ignite) : 0;
    if (ig > 0) cb.pend = { t: ig, angle, opts };
    else this._ignite(s, w, { angle, opts });
    return true;
  }
  _ignite(s, w, p) {
    const g = this.game, cb = cbOf(s), o = p.opts || {};
    if (s.state !== 'normal' || this.weaponOf(s) !== w) return;
    if (w.ignite) {
      const W = g.world;
      let pm = MISFIRE[g.sys.time?.weather] ?? 0;
      if (W?.T && W.terrainAt(s.x, s.y) === W.T.SHALLOW) pm += 0.15;
      if (rand.next() < pm * this.pm(s, 'misfire')) {
        g.sfx('dry_fire', { x: s.x, y: s.y });
        this._fx({ k: 'smoke', x: s.x + Math.cos(s.angle) * 0.5, y: s.y + Math.sin(s.angle) * 0.5, r0: 0.2, r1: 0.8, life: 1.2 });
        if (s.isPlayer) g.notify('불발! 화약에 불이 붙지 않았다', 'warn');
        return; // 탄은 남는다
      }
    }
    let a = p.angle;
    if (o.mark) a = Math.atan2(o.mark.e.y + o.mark.oy - s.y, o.mark.e.x + o.mark.ox - s.x);
    else if (s.isPlayer && s.aiming) a = s.aimAngle;
    if (w.mag) cb.mag[w.id] = Math.max(0, (cb.mag[w.id] ?? 1) - 1);
    this._discharge(s, w, a, o);
    if (w.kind === 'bow') this.reload(s); // 다음 화살 메기기
  }
  _moveSpread(s) {
    const v = s.vehicle;
    if (v) {
      const m = typeof s.mountedSpread === 'function' ? s.mountedSpread() : s.mountedSpread ?? v.mountedSpread;
      if (Number.isFinite(m)) return m;
      return v.moveMode === 'horse' ? 0.05 : Math.hypot(v.vx || 0, v.vy || 0) > 0.5 ? 0.03 : 0;
    }
    const sp = s.speedNow || 0;
    return sp > 2.6 ? 0.07 : sp > 0.3 ? 0.03 : 0;
  }
  _discharge(s, w, a0, o) {
    const g = this.game, cb = cbOf(s);
    let sig = 0;
    if (!o.exact) {
      sig = (w.spread || 0) + this._moveSpread(s);
      if (s.crouching) sig *= 0.75;
      if (cb.aimT >= 1) sig *= this.pm(s, 'aimSteady');
      if (s.isPlayer) sig *= this.sk('gunSpread') * (g.sys.stats?.buffMul?.('spread') ?? 1) * (this.hoanActive ? 0.3 : 1);
      else sig *= s.data.spreadMul ?? NPC_SPREAD[s.role] ?? 1.2;
      sig *= o.spreadMul ?? 1;
    }
    const a = a0 + gauss() * sig, c = Math.cos(a), n = Math.sin(a);
    const len = 0.2 + (w.length || 0.4), mx = s.x + c * len, my = s.y + n * len;
    const hoan = !!(s.isPlayer && this.hoanActive);
    g.emit('shot', { shooter: s, weapon: w.id, x: s.x, y: s.y, angle: a, noise: w.noise * this._soundMul() });
    if (w.kind !== 'gun') {
      this.proj.push({ x: mx, y: my, vx: c * w.projSpeed, vy: n * w.projSpeed, d: 0, s, w, power: o.power ?? 1, hoan });
      return;
    }
    const big = w.id === 'w_matchlock';
    this._fx({ k: 'flash', x: mx, y: my, a, fr: 2, life: 0.1 });
    const wind = g.sys.time?.wind, wx = wind ? Math.cos(wind.angle) * wind.strength : 0, wy = wind ? Math.sin(wind.angle) * wind.strength : 0;
    for (let i = 0; i < (big ? 3 : 2); i++) {
      const k = 0.4 + i * 0.6;
      this._fx({ k: 'smoke', x: mx + c * k, y: my + n * k, vx: c * 1.2 + wx, vy: n * 1.2 + wy, r0: 0.6, r1: big ? 2 : 3, life: big ? 4 : 3 });
    }
    if (big) this.smokes.push({ x: mx + c, y: my + n, r: 1.5, until: g.time + 2 });
    const hit = this.raycast(mx, my, a, w.range, s, { headMul: hoan ? 2 : 1 });
    const end = hit ? hit.t : w.range;
    this._fx({ k: 'trace', x: mx, y: my, x2: mx + c * end, y2: my + n * end, life: 0.07 });
    if (hit?.e) this._rangedHit(s, w, hit, end + len, o, hoan);
    else if (hit) this._fx({ k: 'dust', x: hit.x, y: hit.y, r0: 0.1, r1: 0.5, life: 0.5 });
  }
  _rangedHit(s, w, hit, dist, o, hoan) {
    const e = hit.e;
    let dmg = w.damage * (o.power ?? 1);
    if (w.effRange && dist > w.effRange) dmg *= 1 - 0.5 * clamp((dist - w.effRange) / (w.range - w.effRange), 0, 1);
    if (w.kind === 'gun') dmg *= this.pm(s, 'gunDamage');
    if (hit.head) dmg *= e.kind === 'animal' ? 3 : 2;
    const kind = w.kind === 'gun' ? 'bullet' : w.kind === 'bow' ? 'arrow' : 'melee';
    this.applyHit(e, dmg, { source: s, weapon: w.id, kind, x: hit.x, y: hit.y, headshot: !!hit.head, hoan }, { dir: Math.atan2(hit.y - s.y, hit.x - s.x) });
  }

  /** 즉시 판정 광선: 지형(ROCK·WALL)·건물에 막히고 사람·짐승·탈것에 맞는다 */
  raycast(x0, y0, a, maxD, s = null, o = {}) {
    const g = this.game, W = g.world, c = Math.cos(a), n = Math.sin(a);
    let best = maxD, e = null;
    if (W) {
      const T = W.T || {};
      for (let t = 0.5; t < best; t += 0.5) {
        const id = W.terrainAt(x0 + c * t, y0 + n * t);
        if (id === T.ROCK || id === T.WALL) {
          best = t;
          break;
        }
      }
      const x1 = x0 + c * best, y1 = y0 + n * best;
      _sol.length = 0;
      W.querySolids?.(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), _sol);
      for (const r of _sol) {
        const t = rayRect(x0, y0, c, n, r);
        if (t < best) best = t;
      }
    }
    if (!o.noEnts) {
      const x1 = x0 + c * best, y1 = y0 + n * best;
      for (const q of g.queryRect(Math.min(x0, x1) - 3, Math.min(y0, y1) - 3, Math.max(x0, x1) + 3, Math.max(y0, y1) + 3, [])) {
        if (!q.alive || q.static || q === s || (s && q === s.vehicle)) continue;
        if (q.kind === 'human') {
          if (q.state === 'dead' || q.seatPose === 'hidden' || (s?.vehicle && q.vehicle === s.vehicle)) continue;
        } else if (q.kind === 'animal') {
          if (q.dead || q.state === 'dead') continue;
        } else if (q.kind !== 'vehicle' || q.wrecked) continue;
        const t = q.kind !== 'human' && q.hitTest ? stepTest(q, x0, y0, c, n, best) : rayCircle(x0, y0, c, n, q.x, q.y, q.radius || 0.35);
        if (t > 0.05 && t < best) {
          best = t;
          e = q;
        }
      }
    }
    if (best >= maxD) return null;
    const hx = x0 + c * best, hy = y0 + n * best;
    let head = false;
    if (e?.kind === 'human' && e.state === 'normal') {
      const kx = e.x + Math.cos(e.angle) * 0.1, ky = e.y + Math.sin(e.angle) * 0.1;
      head = Math.abs((kx - x0) * n - (ky - y0) * c) <= 0.12 * (o.headMul || 1) * this.pm(s, 'headZone');
    } else if (e?.kind === 'animal') {
      const L = e.length || e.def?.L || (e.radius || 0.4) * 2.5;
      head = (hx - e.x) * Math.cos(e.angle) + (hy - e.y) * Math.sin(e.angle) > 0.2 * L; // 몸 앞쪽 30%
    }
    return { t: best, x: hx, y: hy, e, head };
  }
  lineOfSight(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 0.6) return true;
    if (this.raycast(x0, y0, Math.atan2(y1 - y0, x1 - x0), d - 0.4, null, { noEnts: true })) return false;
    const t = this.game.time;
    for (const s of this.smokes) {
      if (s.until <= t) continue;
      const k = clamp(((s.x - x0) * (x1 - x0) + (s.y - y0) * (y1 - y0)) / (d * d), 0, 1);
      if (Math.hypot(x0 + (x1 - x0) * k - s.x, y0 + (y1 - y0) * k - s.y) < s.r) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ 피해
  /** 대상에게 피해. x: {melee, knock, blocked, dir} */
  applyHit(t, dmg, info, x = {}) {
    const g = this.game, s = info.source;
    let ko = false, knock = false;
    const dir = x.dir ?? 0;
    if (t.kind === 'human') {
      if (t.state === 'dead') return 0;
      if (t.isPlayer) {
        if (s && !s.isPlayer) dmg *= 0.6; // NPC → 플레이어
        if (x.melee) {
          if (rand.next() < this.sk('meleeEvade', 0)) {
            g.emit('hit', { target: t, amount: 0, source: s, weapon: info.weapon, headshot: false, kind: info.kind, evaded: true });
            return 0;
          }
          dmg *= this.sk('meleeTaken');
        }
      }
      const w = WEAPONS[info.weapon];
      if (x.melee && !t.isPlayer && !t.essential && w?.nonLethal && t.hp - dmg * (t.damageTakenMul ?? 1) <= 0 && rand.next() < w.nonLethal * this.pm(s, 'nonLethal')) {
        ko = true;
        this._knockout(t, info, dir);
      } else {
        t.damage(dmg, info, g);
        if (x.knock && t.state === 'normal' && !t.vehicle) {
          knock = true;
          t.knockDown(Math.cos(dir), Math.sin(dir), 3, t.isPlayer ? 1.5 : 2.0);
        }
      }
      if (info.kind !== 'fist') this._blood(t.x, t.y, dir, dmg);
    } else {
      t.damage?.(dmg, info, g);
      if (t.kind === 'animal' || (t.kind === 'vehicle' && t.moveMode === 'horse')) this._blood(t.x, t.y, dir, dmg);
    }
    g.emit('hit', { target: t, amount: dmg, source: s, weapon: info.weapon, headshot: !!info.headshot, kind: info.kind, x: info.x, y: info.y, ko, knock, blocked: !!x.blocked });
    return dmg;
  }
  /** 비살상 기절 60초 (죽이지 않음 — 범죄는 assault) */
  _knockout(t, info, dir) {
    const g = this.game, before = t.hp;
    if (t.vehicle) t.vehicle.exit(t, g, { force: true });
    t.hp = 1;
    t.hitFlash = 0.15;
    t.speech = null;
    t.knockDown(Math.cos(dir), Math.sin(dir), 2, 60);
    t.data.ko = g.time;
    g.emit('damage', { target: t, amount: before - 1, ...info, ko: true });
    g.emit('knockout', { victim: t, attacker: info.source, info });
  }
  _blood(x, y, dir, dmg) {
    const n = clamp(Math.round(dmg / 12), 2, 6);
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * 1.2, sp = 2 + Math.random() * 3;
      this._fx({ k: 'blood', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r0: 0.04 + Math.random() * 0.04, life: 0.25 + Math.random() * 0.2 });
    }
    if (this.decals.length >= 80) this.decals.shift();
    this.decals.push({ x: x + Math.cos(dir) * 0.45, y: y + Math.sin(dir) * 0.45, r: clamp(0.12 + dmg / 260, 0.12, 0.45), a: dir, t: this.game.time });
  }

  // ------------------------------------------------------------ 근접
  _meleeTarget(a, ang, range, pref) {
    let best = null, bs = Infinity;
    for (const e of this.game.query(a.x, a.y, range + 1, (q) => q !== a && q !== a.vehicle)) {
      if (e.kind === 'human') {
        if (e.state === 'dead' || (a.vehicle && e.vehicle === a.vehicle)) continue;
      } else if (e.kind === 'animal') {
        if (e.dead || e.state === 'dead') continue;
      } else if (!(e.kind === 'vehicle' && e.moveMode === 'horse' && !e.wrecked)) continue;
      const dx = e.x - a.x, dy = e.y - a.y, d = Math.hypot(dx, dy) - (e.radius || 0.3);
      if (d > range) continue;
      const da = Math.abs(angleWrap(Math.atan2(dy, dx) - ang));
      if (da > (e === pref ? 1.25 : 0.9) && d > 0.15) continue;
      const sc = d + da * 0.8 - (e === pref ? 1 : 0);
      if (sc < bs) {
        bs = sc;
        best = e;
      }
    }
    return best;
  }
  melee(a, angle, opts = {}) {
    const g = this.game;
    if (!a || a.state !== 'normal') return null;
    const cb = cbOf(a);
    if (cb.cool > 0) return null;
    this._armed.add(a);
    const w0 = this.weaponOf(a), w = isRanged(w0) ? WEAPONS.fist : w0;
    const heavy = !!opts.heavy;
    cb.cool = w.fireInterval * this.pm(a, 'meleeSpeed') * (heavy ? 1.3 : 1) * (a.isPlayer ? 1 : 1.5);
    a.stamina = Math.max(0, a.stamina - (w.stamina || 4) * (heavy ? 2 : 1));
    if (!a.vehicle) a.angle = angle;
    let mul = heavy ? 1.8 : 1;
    if (w.kind === 'fist' && !heavy) {
      cb.combo = g.time - cb.lastSwing < 0.8 ? cb.combo + 1 : 1; // 맨손 3연타
      if (cb.combo >= 3) {
        mul *= 1.5;
        cb.combo = 0;
      }
    }
    cb.lastSwing = g.time;
    g.sfx('swing', { x: a.x, y: a.y, pitch: heavy ? 0.8 : 1 });
    this._noise(a.x, a.y, 10, a, 'melee');
    const t = this._meleeTarget(a, angle, w.range, opts.target);
    if (!t) return null;
    let dmg = w.damage * mul * this.pm(a, 'meleeDamage') * (w.blade ? this.pm(a, 'bladeDamage') : 1);
    let blocked = false;
    const tcb = t.data?.cb;
    if (t.kind === 'human' && tcb?.blocking && t.stamina >= 10 && Math.abs(angleWrap(Math.atan2(a.y - t.y, a.x - t.x) - t.angle)) < 1.2) {
      blocked = true; // 막기: 피해 −70%, 기력 10
      dmg *= 0.3;
      t.stamina -= 10;
    }
    const knock = !blocked && rand.next() < (w.knock || 0) + (heavy ? 0.3 : 0);
    this.applyHit(t, dmg, { source: a, weapon: w.id, kind: w.kind === 'fist' ? 'fist' : 'melee', x: t.x, y: t.y, headshot: false }, { melee: true, knock, blocked, dir: angle });
    return t;
  }

  // ------------------------------------------------------------ 잠입 처치
  _aware(t, p) {
    if (t.brain?.target === p || t.data?.alert || t.data?.aggroPlayer) return true;
    const npcs = this.game.sys.npcs, f = npcs?.perceive;
    if (typeof f !== 'function') return false;
    const v = f.call(npcs, t, p);
    return typeof v === 'number' ? v >= 0.5 : !!v;
  }
  _stealthOffer(actor, t) {
    if (!t || !actor?.isPlayer || t.kind !== 'human' || t.isPlayer || this._stealth) return null;
    if (!actor.crouching || actor.vehicle || t.vehicle || t.state !== 'normal' || actor.state !== 'normal') return null;
    const dx = actor.x - t.x, dy = actor.y - t.y;
    if (dx * dx + dy * dy > 1.5 * 1.5) return null;
    if (Math.abs(angleWrap(Math.atan2(dy, dx) - t.angle)) < (Math.PI * 5) / 6) return null; // 등 뒤 60°
    if (this._aware(t, actor)) return null;
    const kill = !!this.weaponOf(actor).blade;
    return [{ key: 'interact', label: kill ? '몰래 처치' : '몰래 기절시키기', priority: 9, run: () => this.stealthKill(t) }];
  }
  stealthKill(t) {
    const p = this.game.player;
    if (!p || this._stealth || !t || t.state === 'dead') return false;
    const w = this.weaponOf(p);
    this._stealth = { t, w, time: w.blade ? 1.2 : 0.9, lock: !!p.controlLocked };
    p.controlLocked = true;
    p.moveX = p.moveY = p.vx = p.vy = 0;
    p.angle = Math.atan2(t.y - p.y, t.x - p.x);
    t.state = 'down';
    t.downT = 1.6;
    t.vx = t.vy = 0;
    t.speech = null;
    return true;
  }
  _stealthTick(dt) {
    const S = this._stealth;
    if (!S) return;
    const g = this.game, p = g.player, t = S.t;
    const end = () => {
      this._stealth = null;
      if (p) p.controlLocked = S.lock;
    };
    if (!p || p.state !== 'normal' || !t.alive || t.state === 'dead') return end();
    t.downT = Math.max(t.downT, 0.3);
    if ((S.time -= dt) > 0) return;
    end();
    const info = { source: p, weapon: S.w.id, kind: S.w.kind === 'fist' ? 'fist' : 'melee', x: t.x, y: t.y, headshot: false, stealth: true };
    if (S.w.blade) {
      t.damage(t.hp / (t.damageTakenMul || 1) + 1, info, g);
      g.emit('hit', { target: t, amount: t.maxHp, source: p, weapon: S.w.id, headshot: false, kind: info.kind, stealth: true });
    } else {
      this._knockout(t, info, p.angle);
      g.emit('hit', { target: t, amount: 0, source: p, weapon: S.w.id, headshot: false, kind: info.kind, ko: true, stealth: true });
    }
    this._noise(t.x, t.y, 3, p, 'stealth');
  }

  // ------------------------------------------------------------ 호안
  startHoan() {
    const g = this.game, p = g.player;
    if (this.hoanActive || !p || p.state !== 'normal' || this._hoanCool > 0) return false;
    const w = this.weaponOf(p);
    if (w.kind !== 'gun' && w.kind !== 'bow') {
      g.notify('호안은 총이나 활을 들어야 쓸 수 있다', 'warn');
      return false;
    }
    const st = g.sys.stats;
    if (st?.hoan && st.hoan.value < 20) {
      g.notify('호안이 모자란다', 'warn');
      return false;
    }
    this.hoanActive = true;
    this.marks = [];
    this._exec = null;
    this._prevTS = g.timeScale;
    g.timeScale = 0.3;
    g.emit('hoan:start', {});
    return true;
  }
  endHoan() {
    if (!this.hoanActive) return;
    const g = this.game;
    this.hoanActive = false;
    this.marks = [];
    this._exec = null;
    if (g.timeScale === 0.3) g.timeScale = this._prevTS > 0.3 ? this._prevTS : 1;
    this._hoanCool = 3;
    g.emit('hoan:end', {});
  }
  /** 표식이 있으면 차례로 쏘고, 없으면 끝 */
  _release() {
    if (this.marks.length && !this._exec) this._exec = { i: 0, t: 0 };
    else if (!this._exec) this.endHoan();
  }
  _pickMark() {
    const g = this.game, p = g.player, m = g.input.mouse;
    const w = this.weaponOf(p), ld = cbOf(p).mag[w.id] ?? 0;
    const max = w.mag > 1 ? Math.min(2, ld) : ld > 0 ? 1 : 0;
    const e = g.nearest(m.wx, m.wy, 1.0, (q) => q !== p && q !== p.vehicle && !q.static && ((q.kind === 'human' && q.state !== 'dead') || (q.kind === 'animal' && !q.dead && q.state !== 'dead') || (q.kind === 'vehicle' && !q.wrecked)));
    if (!e) return false;
    if (this.marks.length < max) {
      this.marks.push({ e, ox: m.wx - e.x, oy: m.wy - e.y });
      g.sfx('ui_click');
    }
    return true;
  }
  _hoanTick(rdt) {
    const g = this.game, p = g.player;
    if (this._hoanCool > 0) this._hoanCool -= rdt;
    if (!this.hoanActive) return;
    const w = p && this.weaponOf(p);
    if (!p || p.state !== 'normal' || (w.kind !== 'gun' && w.kind !== 'bow')) return this.endHoan();
    const ex = this._exec;
    if (ex) {
      if ((ex.t -= rdt) > 0) return;
      const m = this.marks[ex.i++];
      if (!m) return cbOf(p).pend ? undefined : this.endHoan();
      ex.t = 0.15;
      if (!m.e.alive || m.e.state === 'dead' || m.e.dead) return;
      p.aimAngle = Math.atan2(m.e.y + m.oy - p.y, m.e.x + m.ox - p.x);
      this.fire(p, p.aimAngle, { exact: true, force: true, mark: m });
      return;
    }
    const st = g.sys.stats;
    if (st?.useHoan && !st.useHoan(12 * rdt * this.sk('hoanDrain') * (st.buffMul?.('hoanDrain') ?? 1))) this._release();
  }

  // ------------------------------------------------------------ 플레이어 조작
  _assist(p) {
    const wanted = (this.game.sys.wanted?.level ?? 0) > 0;
    let best = null, bs = Infinity;
    for (const e of this.game.query(p.x, p.y, 30, (q) => q !== p)) {
      let pri;
      if (e.kind === 'human') {
        if (e.state === 'dead' || !(e.faction === 'rival' || e.brain?.target === p || e.data?.hostile || e.tags.has('hostile') || (wanted && (e.faction === 'police' || e.faction === 'army')))) continue;
        pri = 0;
      } else if (e.kind === 'animal' && !e.dead && e.state !== 'dead') pri = 12;
      else continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y), da = Math.abs(angleWrap(Math.atan2(e.y - p.y, e.x - p.x) - p.angle));
      if (da > 1.4) continue;
      if (d * (1 + da) + pri < bs) {
        bs = d * (1 + da) + pri;
        best = e;
      }
    }
    return best;
  }
  _player(dt, rdt) {
    const g = this.game, p = g.player, inp = g.input;
    if (!p || !inp) return;
    if (this._pendWeapon) {
      const id = this._pendWeapon;
      this._pendWeapon = null;
      if (!this.equip(p, id)) this.equip(p, 'fist');
    }
    const cb = cbOf(p);
    this._armed.add(p);
    if (!p.weapon) p.weapon = WEAPONS.fist;
    const v = p.vehicle, seat = v?.seats?.[p.seatIndex];
    const can = p.state === 'normal' && !p.controlLocked && !p.swimming && (!v || seat?.role === 'passenger' || v.moveMode === 'horse' || v.moveMode === 'boat');
    if (!can) {
      p.aiming = false;
      cb.blocking = false;
      cb.holdT = cb.draw = 0;
      cb.lDown = cb.rDown = false;
      return;
    }
    if (inp.pressed('weaponNext')) this._cycle(1);
    if (inp.pressed('weaponPrev')) this._cycle(-1);
    if (inp.pressed('weaponWheel') && cb.last) this._switch(cb.last);
    if (inp.pressed('holster')) this._switch('fist');
    const w = this.weaponOf(p), ranged = isRanged(w);
    const rDown = inp.mouseDown(2), lDown = inp.mouseDown(0), lPress = inp.mousePressed(0);
    const lUp = cb.lDown && !lDown, rUp = cb.rDown && !rDown;
    cb.lDown = lDown;
    cb.rDown = rDown;
    let aimA = Math.atan2(inp.mouse.wy - p.y, inp.mouse.wx - p.x);
    if (inp.lastDevice === 'touch') {
      const t = this._assist(p);
      if (t) aimA = Math.atan2(t.y - p.y, t.x - p.x);
    }
    if (cb.swingT > 0) cb.swingT -= dt;
    const sprinting = !v && p.gait === 'sprint' && p.speedNow > 2.6;
    if (ranged) {
      cb.blocking = false;
      p.aiming = !sprinting && (rDown || this.hoanActive || cb.draw > 0 || cb.swingT > 0);
    } else {
      cb.blocking = rDown && !v && !sprinting;
      p.aiming = cb.blocking || cb.swingT > 0 || cb.holdT > 0.15;
    }
    if (p.aiming && !this._exec) p.aimAngle = aimA;
    cb.aimT = p.aiming ? cb.aimT + rdt : 0;
    // 호안
    if (inp.pressed('hoan')) {
      if (this.hoanActive) this._release();
      else this.startHoan();
    }
    if (this.hoanActive && rUp) this._release();
    if (inp.pressed('reload')) this.reload(p);
    if (this._exec) return;
    // 공격
    if (w.kind === 'bow') {
      if (lDown && !sprinting) cb.draw += dt;
      if (lUp && cb.draw > 0) {
        const pow = 0.4 + 0.6 * Math.min(1, cb.draw / (0.8 * this.sk('bowDraw')));
        cb.draw = 0;
        this._shoot(p, aimA, { power: pow });
      }
    } else if (ranged) {
      if (lPress && !sprinting) this._shoot(p, aimA, {});
    } else if (!v) {
      if (lDown) cb.holdT += dt;
      if (lUp) {
        const heavy = cb.holdT >= 0.6;
        cb.holdT = 0;
        cb.swingT = 0.25;
        p.aimAngle = aimA;
        this.melee(p, aimA, { heavy });
      }
    }
  }
  _shoot(p, a, o) {
    if (this.hoanActive && this._pickMark()) return; // 호안 중 대상 위 클릭 = 표식
    cbOf(p).swingT = 0.4;
    p.aiming = true;
    p.aimAngle = a;
    this.fire(p, a, o);
  }

  // ------------------------------------------------------------ NPC
  /** NPC 두뇌가 매 틱 부른다: 거리 유지·조준·사격·근접. 탈것 위면 이동은 하지 않는다 */
  npcAttack(npc, target, dt) {
    if (!npc || npc.state !== 'normal') return null;
    if (!target || !target.alive || target.state === 'dead' || target.dead) {
      npc.aiming = false;
      return null;
    }
    const g = this.game, cb = cbOf(npc), w = this.weaponOf(npc);
    this._armed.add(npc);
    const ai = cb.ai || (cb.ai = { aimT: 0, need: 0.8 + Math.random() * 0.4 + (NPC_REACT[npc.role] ?? 0.6), los: false, losT: 0 });
    const dx = target.x - npc.x, dy = target.y - npc.y, d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    if ((ai.losT -= dt) <= 0) {
      ai.losT = 0.25;
      ai.los = d <= (w.range || 2) + 2 && this.lineOfSight(npc.x, npc.y, target.x, target.y);
    }
    const out = { dist: d, see: ai.los, fired: false };
    const walk = !npc.vehicle;
    const steer = (a, gait) => {
      npc.moveX = Math.cos(a);
      npc.moveY = Math.sin(a);
      npc.gait = gait;
    };
    if (isRanged(w)) {
      if (walk) {
        if (!ai.los || d > w.range * 0.85) steer(ang, 'run');
        else if (d < Math.min(5, (w.effRange || w.range) * 0.25)) steer(ang + Math.PI, 'run');
        else npc.moveX = npc.moveY = 0;
      }
      if (ai.los && d <= w.range) {
        npc.aiming = true;
        npc.aimAngle = ang;
        if ((ai.aimT += dt) >= ai.need && cb.cool <= 0 && !cb.pend && !(cb.reloadT > 0)) {
          if (w.mag && (cb.mag[w.id] ?? 0) <= 0) this.reload(npc);
          else out.fired = this.fire(npc, ang, {});
        }
      } else {
        npc.aiming = false;
        ai.aimT = Math.max(0, ai.aimT - dt);
      }
    } else {
      const reach = (w.range || 1.2) + (target.radius || 0.3) * 0.5 + 0.2;
      if (walk) {
        if (d > reach * 0.85) steer(ang, d > 6 ? 'run' : 'walk');
        else npc.moveX = npc.moveY = 0;
      }
      npc.aiming = d < reach + 2;
      npc.aimAngle = ang;
      if (d <= reach && cb.cool <= 0 && (ai.aimT += dt) > (NPC_REACT[npc.role] ?? 0.6)) {
        out.fired = !!this.melee(npc, ang, { heavy: Math.random() < 0.2, target });
        ai.aimT = 0;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ 갱신
  _projTick(dt) {
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const p = this.proj[i];
      const a = Math.atan2(p.vy, p.vx), c = Math.cos(a), n = Math.sin(a);
      const step = Math.min(Math.hypot(p.vx, p.vy) * dt, p.w.range - p.d);
      const hit = this.raycast(p.x, p.y, a, step + 0.01, p.s);
      if (hit || p.d + step >= p.w.range - 0.01) {
        if (hit?.e) this._rangedHit(p.s, p.w, hit, p.d + hit.t, { power: p.power }, p.hoan);
        else this._dropArrow(p, hit ? hit.x - c * 0.4 : p.x + c * step, hit ? hit.y - n * 0.4 : p.y + n * step, a);
        this.proj.splice(i, 1);
        continue;
      }
      p.x += c * step;
      p.y += n * step;
      p.d += step;
    }
  }
  /** 사거리 끝에서 떨어진 화살은 50% 다시 주울 수 있다 */
  _dropArrow(p, x, y, a) {
    const g = this.game;
    if (!p.s?.isPlayer || p.w.ammo !== 'a_arrow' || Math.random() >= 0.5 || g.world?.passable?.(x, y, 'foot') === false) return;
    if (this.arrows.length >= 30) g.remove(this.arrows.shift());
    this.arrows.push(g.add(new DroppedArrow(x, y, a)));
  }
  _fxTick(dt) {
    let w = 0;
    for (const f of this.fx) {
      f.t += dt;
      if (f.t >= f.life) continue;
      if (f.vx) {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        const k = f.k === 'blood' ? 0.85 : 0.97;
        f.vx *= k;
        f.vy *= k;
      }
      this.fx[w++] = f;
    }
    this.fx.length = w;
    const t = this.game.time;
    if (this.decals.length && t - this.decals[0].t > 40) this.decals.shift();
    if (this.smokes.length && this.smokes[0].until < t) this.smokes.shift();
    this.arrows = this.arrows.filter((e) => e.alive);
  }

  init(g) {
    g.addInteractionProvider((actor, target) => this._stealthOffer(actor, target));
    g.addRenderer(LAYER.DECAL, (ctx, gm, b) => this._drawDecals(ctx, b), 20);
    g.addRenderer(LAYER.SKY, (ctx, gm, b) => this._drawSky(ctx, b), 5);
    g.addRenderer(LAYER.OVERLAY, (ctx) => this._drawOverlay(ctx), 10);
    g.on('player:dead', () => this.endHoan());
  }
  onStart(g) {
    if (g.player && !g.player.weapon) this.equip(g.player, 'fist');
  }
  update(dt, realDt, g) {
    if (g.state !== 'play') return;
    this._player(dt, realDt);
    for (const h of this._armed) {
      if (!h.alive || h.state === 'dead') {
        this._armed.delete(h);
        continue;
      }
      this._tick(h, dt, realDt);
    }
    this._hoanTick(realDt);
    this._stealthTick(dt);
    this._projTick(dt);
    this._fxTick(dt);
  }

  // ------------------------------------------------------------ 그리기 (월드 좌표)
  _drawDecals(ctx, b) {
    if (!this.decals.length) return;
    const t = this.game.time;
    ctx.fillStyle = PAL.blood;
    for (const d of this.decals) {
      if (d.x < b.x0 || d.x > b.x1 || d.y < b.y0 || d.y > b.y1) continue;
      const age = t - d.t;
      ctx.globalAlpha = 0.5 * (age > 30 ? Math.max(0, 1 - (age - 30) / 10) : 1);
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r * 1.3, d.r, d.a, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(d.x + Math.cos(d.a) * d.r * 1.6, d.y + Math.sin(d.a) * d.r * 1.6, d.r * 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  _drawSky(ctx, b) {
    for (const f of this.fx) {
      if (f.x < b.x0 - 4 || f.x > b.x1 + 4 || f.y < b.y0 - 4 || f.y > b.y1 + 4) continue;
      const k = f.t / f.life;
      if (f.k === 'smoke' || f.k === 'dust') {
        ctx.globalAlpha = (f.k === 'smoke' ? 0.3 : 0.35) * (1 - k);
        ctx.fillStyle = f.k === 'smoke' ? PAL.ink3 : PAL.paperShade;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r0 + (f.r1 - f.r0) * Math.sqrt(k), 0, TAU);
        ctx.fill();
      } else if (f.k === 'flash') {
        if (f.fr-- <= 0) continue;
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = PAL.lantern;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = f.a + (i / 8) * TAU, r = i % 2 ? 0.12 : i === 0 ? 0.55 : 0.28;
          ctx.lineTo(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r);
        }
        ctx.fill();
      } else if (f.k === 'trace') {
        ctx.globalAlpha = 0.35 * (1 - k);
        ctx.strokeStyle = PAL.ink;
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
      } else if (f.k === 'blood') {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = PAL.blood;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 0.035;
    for (const p of this.proj) {
      const sp = Math.hypot(p.vx, p.vy) || 1;
      if (p.w.kind === 'throw') {
        ctx.fillStyle = PAL.ink2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 0.08, 0, TAU);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (p.vx / sp) * 0.7, p.y - (p.vy / sp) * 0.7);
      ctx.stroke();
    }
  }
  /** 호안 표식, 플레이어 장전·당김 고리, 장전 탄 점 */
  _drawOverlay(ctx) {
    const p = this.game.player;
    if (!p || p.state !== 'normal') return;
    for (const m of this.marks) {
      const x = m.e.x + m.ox, y = m.e.y + m.oy;
      ctx.fillStyle = PAL.seal;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x - 0.16, y - 0.16, 0.32, 0.32);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = PAL.paper;
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(x - 0.09, y - 0.09);
      ctx.lineTo(x + 0.09, y + 0.09);
      ctx.moveTo(x + 0.09, y - 0.09);
      ctx.lineTo(x - 0.09, y + 0.09);
      ctx.stroke();
    }
    const cb = p.data.cb;
    if (!cb) return;
    const w = this.weaponOf(p);
    let prog = -1, col = PAL.ink;
    if (cb.reloadT > 0) prog = 1 - cb.reloadT / (cb.reloadMax || 1);
    else if (cb.draw > 0) prog = Math.min(1, cb.draw / (0.8 * this.sk('bowDraw')));
    else if (cb.holdT > 0.15 && !isRanged(w)) prog = Math.min(1, cb.holdT / 0.6);
    if (prog >= 0) {
      if (prog >= 1 && cb.reloadT <= 0) col = PAL.seal;
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.62, -Math.PI / 2, -Math.PI / 2 + TAU * prog);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (w.mag && (p.aiming || cb.reloadT > 0)) {
      const ld = cb.mag[w.id] ?? 0;
      ctx.lineWidth = 0.025;
      ctx.strokeStyle = PAL.ink;
      ctx.fillStyle = PAL.ink;
      for (let i = 0; i < w.mag; i++) {
        ctx.beginPath();
        ctx.arc(p.x - (w.mag - 1) * 0.08 + i * 0.16, p.y + 0.78, 0.05, 0, TAU);
        if (i < ld) ctx.fill();
        else ctx.stroke();
      }
    }
    if (w.needs && cb.cord > 0 && p.aiming) {
      const a = p.aimAngle, r = 0.25;
      ctx.fillStyle = PAL.lantern;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * r - Math.sin(a) * 0.12, p.y + Math.sin(a) * r + Math.cos(a) * 0.12, 0.04 + Math.random() * 0.02, 0, TAU);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------ 저장
  serialize() {
    const p = this.game.player;
    const cb = p?.data?.cb;
    return { weapon: p?.weapon?.id ?? 'fist', mag: { ...(cb?.mag || {}) }, cord: cb?.cord ?? 0, last: cb?.last ?? null };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.endHoan();
    const p = this.game.player;
    if (p) {
      const cb = cbOf(p);
      cb.mag = {};
      for (const [k, v] of Object.entries(d.mag || {})) if (WEAPONS[k] && Number.isFinite(v)) cb.mag[k] = clamp(Math.floor(v), 0, WEAPONS[k].mag || 0);
      cb.cord = Number.isFinite(d.cord) ? Math.max(0, d.cord) : 0;
      cb.last = WEAPONS[d.last] ? d.last : null;
      cb.reloadT = 0;
      cb.pend = null;
      p.weapon = WEAPONS.fist;
    }
    this._pendWeapon = WEAPONS[d.weapon] ? d.weapon : 'fist'; // 소지품이 먼저 돌아온 뒤 쥔다
  }
}

export function install(game) {
  return game.registerSystem(new Combat(game));
}
