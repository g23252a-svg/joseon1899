// 스킬 [전투] — 5계통 × 3 = 15 스킬, 계통 경험치·단(1~10)·공용 점수, 보정치 mod(key, base).
//
//   game.sys.skills: TREES  XP_LEVELS  MAX_LEVEL  xpForLevel(L)  level(tree)  xp(tree)  progress(tree) 0~1
//     addXP(tree, n, reason)  points  has(id)  canLearn(id)  learn(id) → bool
//     mod(key, base = 1) = (base + Σadd) × Πmul      계약 밖: grant(id)(미션이 무료로 줌), skill(id) → 정의
//   이벤트: skill:xp {tree, amount, level, reason}, skill:levelup {tree, level}, skill:learn {skillId}
//
// mod 키 (가산 +, 곱 ×; 없으면 base 그대로)
//   무예   meleeEvade+ bladeDamage× meleeSpeed×(휘두르기 간격) healthMax+ meleeTaken× meleeDamage×(단)
//   사격   aimSteady× matchlockReload× misfire× matchcordBurn×(화승 타는 속도) hoanMax+ hoanDrain× gunSpread×(단)
//   생존   skinSpeed×(단) skinQuality+ trackRadius+ windArrow+ animalDetect× gatherBonus+ herbGlow+
//   기마   horseBond× whistleRadius× boatSpeed× rowStamina× cartSpeed× cartStuck× horseStamina×(단)
//   처세   priceSell×(단) priceBuy× stealthNoise× crouchSpeed× intimidate+(목격자 위협 0.7 → 0.95) surrenderBonus+
//   스킬 없이 기본값만 쓰는 키(풀 버전 자리): gunDamage headZone bowDraw reloadSpeed nonLethal

const sys = (g) => g.sys;

export const XP_LEVELS = [0, 0, 100, 303, 580, 919, 1313, 1758, 2250, 2786, 3363];
export const xpForLevel = (L) => (L <= 1 ? 0 : Math.round(100 * Math.pow(L - 1, 1.6)));
export const MAX_LEVEL = 10;

// skillsview 가 읽는 형식: [{id, name, hanja, desc, skills:[{id, name, level, requires, cost, desc}]}]
export const TREES = [
  {
    id: 'muye', name: '무예', hanja: '武藝', desc: '칼·주먹·몽둥이',
    skills: [
      { id: 'muye_pumbalgi', name: '품밟기', level: 1, cost: 1, add: { meleeEvade: 0.15 }, desc: '택견 발놀림. 받는 근접 공격을 15% 피한다.' },
      { id: 'muye_hwando', name: '환도술', level: 2, cost: 1, mul: { bladeDamage: 1.2, meleeSpeed: 0.85 }, desc: '칼날 무기 피해 ×1.2, 휘두르기가 빨라진다.' },
      { id: 'muye_dallyeon', name: '단련', level: 3, cost: 2, requires: ['muye_pumbalgi'], add: { healthMax: 20 }, mul: { meleeTaken: 0.85 }, desc: '체력 최대 +20, 받는 근접 피해 ×0.85.' },
    ],
  },
  {
    id: 'sagyeok', name: '사격', hanja: '射擊', desc: '총·활·호안',
    skills: [
      { id: 'sag_breath', name: '숨 고르기', level: 1, cost: 1, mul: { aimSteady: 0.6 }, desc: '1초 넘게 겨누면 탄퍼짐이 ×0.6 으로 준다.' },
      { id: 'sag_hwaseung', name: '화승 다루기', level: 1, cost: 1, mul: { matchlockReload: 0.8, misfire: 0.5, matchcordBurn: 0.7 }, desc: '화승총 장전 ×0.8, 불발 ×0.5, 화승이 오래 탄다. 화승을 만들 수 있다.' },
      { id: 'sag_hoan1', name: '호안 수련', level: 2, cost: 2, requires: ['sag_breath'], add: { hoanMax: 25 }, mul: { hoanDrain: 0.8 }, desc: '호안 최대 +25, 호안 소모 ×0.8.' },
    ],
  },
  {
    id: 'saengjon', name: '생존', hanja: '生存', desc: '사냥·가죽·약초',
    skills: [
      { id: 'sae_skinning', name: '가죽 다루기', level: 1, cost: 1, mul: { skinSpeed: 0.6 }, add: { skinQuality: 0.25 }, desc: '가죽을 빨리 벗기고, 25% 확률로 품질이 한 단계 오른다.' },
      { id: 'sae_tracking', name: '발자취 읽기', level: 1, cost: 1, add: { trackRadius: 40, windArrow: 1 }, mul: { animalDetect: 0.85 }, desc: '발자국과 짐승 이름이 보이고, 바람 화살표가 뜬다. 짐승이 덜 알아챈다.' },
      { id: 'sae_herbal', name: '약초 지식', level: 1, cost: 1, add: { gatherBonus: 0.5, herbGlow: 15 }, desc: '채집이 늘고 약초가 눈에 띈다. 고약·갈근탕을 만들 수 있다.' },
    ],
  },
  {
    id: 'gima', name: '기마·조운', hanja: '騎馬漕運', desc: '말·배·수레',
    skills: [
      { id: 'gim_bond', name: '말 길들이기', level: 1, cost: 1, mul: { horseBond: 1.5, whistleRadius: 1.5 }, desc: '말과 빨리 친해지고, 휘파람이 멀리 닿는다.' },
      { id: 'gim_oar', name: '사공', level: 1, cost: 1, mul: { boatSpeed: 1.15, rowStamina: 0.7 }, desc: '노 젓는 배가 빨라지고 기력이 덜 든다.' },
      { id: 'gim_cart', name: '수레꾼', level: 2, cost: 1, mul: { cartSpeed: 1.15, cartStuck: 0.5 }, desc: '소달구지·인력거가 빨라지고 진흙에 덜 빠진다.' },
    ],
  },
  {
    id: 'cheose', name: '처세', hanja: '處世', desc: '흥정·잠행·위세',
    skills: [
      { id: 'che_haggle', name: '흥정', level: 1, cost: 1, mul: { priceSell: 1.1, priceBuy: 0.9 }, desc: '팔 때 ×1.1, 살 때 ×0.9.' },
      { id: 'che_quiet', name: '발소리 죽이기', level: 1, cost: 1, mul: { stealthNoise: 0.6, crouchSpeed: 1.2 }, desc: '웅크려 걷는 소리가 줄고 조금 빨라진다.' },
      { id: 'che_presence', name: '위세', level: 3, cost: 2, add: { intimidate: 0.25, surrenderBonus: 0.1 }, desc: '목격자 위협이 거의 통하고, 무장한 자가 더 쉽게 항복한다.' },
    ],
  },
];

// 계통 단 자체 보정: [키, 단당 비율]
const LEVEL_MOD = { muye: ['meleeDamage', 0.02], sagyeok: ['gunSpread', -0.02], saengjon: ['skinSpeed', -0.03], gima: ['horseStamina', 0.02], cheose: ['priceSell', 0.01] };
const SIZE = { pheasant: 'S', fox: 'S', roe_deer: 'M', water_deer: 'M', wolf: 'M', boar: 'L', tiger: 'L' };
const KILL_XP = { S: 5, M: 10, L: 20 };
const SKIN_XP = { S: 8, M: 15, L: 30 };
const CRAFT_XP = { rc_arrow: ['sagyeok', 2], rc_roast: ['saengjon', 3], rc_stew: ['saengjon', 5], rc_salve: ['saengjon', 8], rc_galgeun: ['saengjon', 8], rc_ball: ['sagyeok', 4], rc_matchcord: ['sagyeok', 4], rc_club: ['muye', 3] };
const RIDE_TYPES = new Set(['oxcart', 'rickshaw', 'gama']);

const DEFS = new Map();
for (const t of TREES) for (const s of t.skills) DEFS.set(s.id, { ...s, tree: t.id });

/** 짐승 크기 S/M/L (animals 의 정의를 먼저 본다) */
export function sizeOf(a) {
  const s = a?.size ?? a?.def?.size ?? a?.spec?.size ?? SIZE[a?.species?.id ?? a?.species];
  if (s === 'S' || s === 'M' || s === 'L') return s;
  const hp = a?.maxHp || 60;
  return hp < 40 ? 'S' : hp < 120 ? 'M' : 'L';
}

class Skills {
  constructor(game) {
    this.name = 'skills';
    this.order = 10;
    this.game = game;
    this.TREES = TREES;
    this.XP_LEVELS = XP_LEVELS;
    this.MAX_LEVEL = MAX_LEVEL;
    this.xpForLevel = xpForLevel;
    this.points = 2;
    this.learned = new Set();
    this._xp = Object.fromEntries(TREES.map((t) => [t.id, 0]));
    this._add = {};
    this._mul = {};
    this._dirty = true;
    this._hits = new WeakMap(); // 같은 대상 근접 명중 횟수
    this._dist = { horse: 0, row: 0, cart: 0, sneak: 0 };
    this._last = null;
    this._acc = 0;
    this._daily = { day: -1 };
  }

  // ------------------------------------------------------------ 조회
  skill(id) {
    return DEFS.get(id) || null;
  }
  xp(tree) {
    return this._xp[tree] ?? 0;
  }
  level(tree) {
    const x = this._xp[tree];
    if (x == null) return 0;
    let L = 1;
    while (L < MAX_LEVEL && x >= XP_LEVELS[L + 1]) L++;
    return L;
  }
  progress(tree) {
    const L = this.level(tree);
    if (L >= MAX_LEVEL) return 1;
    const a = XP_LEVELS[L], b = XP_LEVELS[L + 1];
    return Math.max(0, Math.min(1, (this.xp(tree) - a) / (b - a)));
  }
  has(id) {
    return this.learned.has(id);
  }
  canLearn(id) {
    const s = DEFS.get(id);
    if (!s || this.learned.has(id) || this.points < s.cost) return false;
    if (this.level(s.tree) < s.level) return false;
    return (s.requires || []).every((r) => this.learned.has(r));
  }
  mod(key, base = 1) {
    if (this._dirty) this._rebuild();
    return (base + (this._add[key] || 0)) * (this._mul[key] ?? 1);
  }

  // ------------------------------------------------------------ 변경
  learn(id) {
    if (!this.canLearn(id)) return false;
    const s = DEFS.get(id);
    this.points -= s.cost;
    return this.grant(id);
  }
  /** 점수 없이 익힘 (미션 보상 등) */
  grant(id) {
    const s = DEFS.get(id);
    if (!s || this.learned.has(id)) return false;
    this.learned.add(id);
    this._dirty = true;
    this.game.emit('skill:learn', { skillId: id });
    this.game.notify(`${s.name}을(를) 익혔다`, 'good');
    this.game.sfx('craft');
    return true;
  }
  addXP(tree, amount, reason = '') {
    amount = Math.round(Number(amount) || 0);
    if (!(tree in this._xp) || amount <= 0) return 0;
    const before = this.level(tree);
    this._xp[tree] += amount;
    const L = this.level(tree);
    this.game.emit('skill:xp', { tree, amount, level: L, reason });
    for (let l = before + 1; l <= L; l++) {
      this.points++;
      this.game.emit('skill:levelup', { tree, level: l });
      this.game.notify(`${TREES.find((t) => t.id === tree).name} ${l}단 — 기술 점수 +1`, 'good');
    }
    if (L !== before) this._dirty = true;
    return amount;
  }
  _rebuild() {
    const add = {}, mul = {};
    for (const id of this.learned) {
      const s = DEFS.get(id);
      for (const [k, v] of Object.entries(s?.add || {})) add[k] = (add[k] || 0) + v;
      for (const [k, v] of Object.entries(s?.mul || {})) mul[k] = (mul[k] ?? 1) * v;
    }
    for (const [tree, [k, r]] of Object.entries(LEVEL_MOD)) mul[k] = (mul[k] ?? 1) * (1 + r * (this.level(tree) - 1));
    this._add = add;
    this._mul = mul;
    this._dirty = false;
  }
  /** 하루 한도가 있는 경험치 */
  _capped(key, cap, tree, n) {
    const day = this.game.sys.time?.day ?? 0;
    if (this._daily.day !== day) this._daily = { day };
    const used = this._daily[key] || 0;
    if (used >= cap) return;
    this._daily[key] = used + 1;
    this.addXP(tree, n, key);
  }
  _travel(key, d, per, tree, n = 1) {
    this._dist[key] += d;
    while (this._dist[key] >= per) {
      this._dist[key] -= per;
      this.addXP(tree, n, key);
    }
  }

  // ------------------------------------------------------------ 행동 경험치
  init(g) {
    const isP = (e) => !!e && (e === g.player || e.isPlayer === true);
    g.on('hit', (e) => {
      if (isP(e.target) && e.blocked) return this.addXP('muye', 2, 'block');
      if (!isP(e.source) || !e.target || isP(e.target) || !(e.amount > 0)) return;
      if (e.kind === 'melee' || e.kind === 'fist') {
        const n = (this._hits.get(e.target) || 0) + 1;
        this._hits.set(e.target, n);
        if (n <= 10) this.addXP('muye', 3, 'hit');
        if (e.knock || e.ko) this.addXP('muye', 12, 'knock');
      } else if (e.kind === 'bullet' || e.kind === 'arrow') this.addXP('sagyeok', e.headshot ? 6 : 2, 'hit');
    });
    g.on('kill', (e) => {
      const v = e.victim, info = e.info || {};
      if (!v || !isP(e.killer)) return;
      if (v.kind === 'human') {
        if (info.stealth) this.addXP('muye', 15, 'stealth');
        else if (info.kind === 'melee' || info.kind === 'fist') this.addXP('muye', 10, 'kill');
        else if (info.kind === 'bullet' || info.kind === 'arrow') this.addXP('sagyeok', 8, 'kill');
      } else if (v.kind === 'animal') this.addXP('sagyeok', KILL_XP[sizeOf(v)], 'hunt');
      else return;
      if (info.hoan) this.addXP('sagyeok', 4, 'hoan');
      if (g.player?.vehicle?.moveMode === 'horse') this.addXP('gima', 10, 'mounted');
    });
    g.on('skin', (e) => this.addXP('saengjon', SKIN_XP[sizeOf(e.animal)] * ((e.quality ?? 1) >= 3 ? 1.5 : 1), 'skin'));
    g.on('gather', () => this.addXP('saengjon', 3, 'gather'));
    g.on('craft', (e) => {
      const c = CRAFT_XP[e.recipeId];
      if (c) this.addXP(c[0], c[1], 'craft');
    });
    g.on('sell', (e) => {
      const total = e.total ?? (e.price || 0) * (e.n || 1);
      this.addXP('cheose', Math.min(25, Math.floor(total / 10)), 'sell');
    });
    g.on('buy', () => this._capped('buy', 20, 'cheose', 1));
    g.on('horse:bond', () => this.addXP('gima', 40, 'bond'));
    g.on('item:remove', (e) => e.id === 'f_maljuk' && this._capped('maljuk', 2, 'gima', 5));
    const rail = (e) => {
      const v = e.vehicle;
      if (isP(e.human) && (v?.vtype === 'tram' || v?.vtype === 'train') && Math.abs(v.speed || 0) > 0.5) this.addXP('gima', 8, 'rail');
    };
    g.on('vehicle:enter', rail);
    g.on('vehicle:exit', rail);
  }

  /** 거리 경험치: 말 100 m(질주 ×1.5) · 노 80 m · 수레 100 m · 몰래 30 m */
  update(dt, realDt, g) {
    if ((this._acc += dt) < 0.5) return;
    this._acc = 0;
    const p = g.player;
    if (!p || p.state !== 'normal') return (this._last = null);
    const v = p.vehicle, pos = v || p;
    const last = this._last;
    this._last = { x: pos.x, y: pos.y };
    if (!last) return;
    const d = Math.hypot(pos.x - last.x, pos.y - last.y);
    if (d > 40) return; // 순간이동
    if (v && v.driver === p) {
      if (v.moveMode === 'horse') this._travel('horse', d * (v.ctl?.sprint ? 1.5 : 1), 100, 'gima');
      else if (v.moveMode === 'boat' && v.vtype !== 'steamer') this._travel('row', d, 80, 'gima');
      else if (RIDE_TYPES.has(v.vtype)) this._travel('cart', d, 100, 'gima');
    } else if (!v && p.crouching && !((sys(g).wanted?.level ?? 0) > 0)) this._travel('sneak', d, 30, 'cheose', 2);
  }

  serialize() {
    return { xp: { ...this._xp }, points: this.points, learned: [...this.learned] };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    for (const t of TREES) this._xp[t.id] = Math.max(0, Number(d.xp?.[t.id]) || 0);
    if (Number.isFinite(d.points)) this.points = Math.max(0, d.points);
    this.learned = new Set((d.learned || []).filter((id) => DEFS.has(id)));
    this._dirty = true;
  }
}

export function install(game) {
  return game.registerSystem(new Skills(game));
}
