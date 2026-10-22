// NPC [사람]: 두뇌(brain)·감지 게이지·소음·사건 반응·대화. game.sys.npcs
//   spawn(def) → NPC   makeBrain(type, opts{target, weapon, home, radius, points, route, hostile, facing, vehicle, dest, zone…})   named(id)
//   spawnGroup(kind, x, y, n, opts{role, faction, target, hostile, tags, mounted})   alert(x, y, r, kind, source?)
//   perceive(npc, target, dt?) → 0~1 (dt 없으면 읽기만)   witnesses(x, y, r|offender, opts?) → NPC[]   awareness(npc, target?)
//   (계약 밖 추가) noise(h) → 소음 반경 m · setTarget(npc, t) · calm(npc) · clearPath(vehicle, range) · intimidate(npc) · equip(npc, wid)
//                  talk(npc, actor) · list() · applyPending() · COMBAT(G.2 표) · ROLE_FACTION
//   이벤트(추가) 'npc:report' {npc, crime, shout?, police?}  'npc:down' {npc}  'npc:surrender' {npc}  'npc:intimidated' {npc}
//   두뇌 mode: calm | fight | flee | report | surrender | watch | talk | dodge | investigate.  적대(플레이어 표적)면 npc.hostile + 'hostile' 태그.
//   wanted 가 목격자에 단 data.witness 를 보면 두뇌가 순검 쪽으로 달려간다(신고 판정·시간은 wanted 몫).

import { Human, makeLook } from './human.js';
import { angleWrap, clamp, rand } from '../engine/util.js';

// ---------------------------------------------------------------- G.2 NPC 전투 수치
// weapons [[무기, 확률]] (null 맨손) · spread 퍼짐 배수 · react 반응 초 · flee 도망 체력비(1 = 위협받으면 바로) · surrender 항복 체력비
const CIV = (hp) => ({ hp, weapons: null, spread: 1, react: 0.6, flee: 1 });
export const COMBAT = {
  villager: CIV(60), woman: CIV(60), child: CIV(40), yangban: CIV(70), merchant: CIV(70), clerk: CIV(70), monk: CIV(60), worker: CIV(80),
  foreigner: { ...CIV(100), spread: 1.2 },
  peddler: { hp: 80, weapons: [['w_club', 0.5]], spread: 1, react: 0.5, flee: 0.3 },
  porter: { hp: 80, weapons: [['w_club', 0.5]], spread: 1, react: 0.5, flee: 0.3 },
  sungeom: { hp: 100, weapons: [['w_hwando', 0.6], ['w_club', 0.4]], spread: 1.3, react: 0.5, surrender: 0.2 },
  chongsun: { hp: 130, weapons: [['w_revolver', 1]], spread: 1.1, react: 0.4, flee: 0 },
  soldier: { hp: 120, weapons: [['w_rifle', 1]], spread: 1.0, react: 0.6, flee: 0.15 },
  gwanbyeong: { hp: 110, weapons: [['w_matchlock', 1]], spread: 1.4, react: 0.6, flee: 0.2 },
  militia: { hp: 80, weapons: [['w_club', 1]], spread: 1, react: 0.6, flee: 0.3 },
  jogye_police: { hp: 100, weapons: [['w_club', 1]], spread: 1.2, react: 0.5, surrender: 0.2, revolver: 0.25 },
  bandit: { hp: 90, weapons: [['w_matchlock', 0.45], ['w_hwando', 0.2], ['w_club', 0.35]], spread: 1.6, react: 0.7, flee: 0.25 },
  bandit_boss: { hp: 220, weapons: [['w_revolver', 1]], spread: 1.0, react: 0.4, flee: 0.5, essential: true },
  bounty_hunter: { hp: 130, weapons: [['w_matchlock', 0.5], ['w_rifle', 0.2], ['w_club', 0.3]], spread: 1.0, react: 0.4, flee: 0.15 },
  rail_guard: { hp: 110, weapons: [['w_rifle', 0.5], ['w_club', 0.5]], spread: 1.1, react: 0.5, flee: 0.2 },
  pirate: { hp: 80, weapons: [['w_matchlock', 0.4], ['npc_rock', 0.6]], spread: 1.6, react: 0.7, flee: 0.3 },
  gang: { hp: 100, weapons: [['w_club', 0.6], ['w_knife', 0.4]], spread: 1.2, react: 0.5, flee: 0 }, // [창작] 활빈패
  hunter: { hp: 100, weapons: [['w_matchlock', 1]], spread: 1.2, react: 0.5, flee: 0.25 },
};
export const ROLE_FACTION = {
  sungeom: 'police', chongsun: 'police', jogye_police: 'police', soldier: 'army', gwanbyeong: 'army', bandit: 'rival', bandit_boss: 'rival',
  bounty_hunter: 'bounty', rail_guard: 'company', pirate: 'pirate', foreigner: 'foreign', gang: 'gang', hunter: 'hunter', peddler: 'guild',
};
const ROLE_BRAIN = {
  sungeom: 'police', chongsun: 'police', jogye_police: 'police', soldier: 'patrol', gwanbyeong: 'guard', militia: 'wander', bandit: 'bandit',
  bandit_boss: 'bandit', bounty_hunter: 'wander', rail_guard: 'guard', pirate: 'bandit', merchant: 'merchant', porter: 'porter', gang: 'gang', clerk: 'idle',
};
const ROLE_NAME = {
  villager: '백성', woman: '아낙', child: '아이', yangban: '양반', merchant: '장사치', clerk: '서리', monk: '스님', peddler: '보부상', porter: '지게꾼',
  sungeom: '순검', chongsun: '총순', soldier: '병정', gwanbyeong: '관병', militia: '마을 장정', jogye_police: '조계 순경', bandit: '화적', bandit_boss: '화적 두목',
  bounty_hunter: '현상금 사냥꾼', rail_guard: '회사 경비', pirate: '수적', gang: '활빈패', hunter: '포수', worker: '공사 인부',
};
const MARK_NAME = { western: '서양 사람', jp: '일본 사람', cn: '청국 사람' };
const GROUPS = {
  police: ['sungeom', 'police'], soldiers: ['soldier', 'patrol'], bandits: ['bandit', 'bandit'], rivals: ['bandit', 'bandit'], hunters: ['bounty_hunter', 'wander'],
  pirates: ['pirate', 'bandit'], guards: ['rail_guard', 'guard'], militia: ['militia', 'wander'], gwanbyeong: ['gwanbyeong', 'guard'], gang: ['gang', 'gang'],
  crowd: ['villager', 'wander'], workers: ['worker', 'wander'], peddlers: ['peddler', 'villager'],
};
// combat 시스템이 없을 때 대체값 [종류, 피해, 간격]
const W_FALLBACK = { w_knife: ['melee', 22, 0.6], w_club: ['melee', 18, 0.9], w_hwando: ['melee', 32, 1.0], w_bow: ['bow', 45, 1.1], w_matchlock: ['gun', 80, 1.4], w_rifle: ['gun', 90, 1.3], w_revolver: ['gun', 40, 0.5], npc_rock: ['throw', 8, 1.5] };
const EFF = { w_bow: 60, w_matchlock: 40, w_rifle: 90, w_revolver: 20, npc_rock: 15 };
const VIOLENT = new Set(['assault', 'murder', 'robbery', 'arson', 'jailbreak', 'animal_cruelty']);
const LAW = new Set(['police', 'army', 'company']);
const NOT_CIVIL = new Set(['gang', 'rival', 'police', 'army', 'bounty', 'pirate']); // 신고하지 않는 세력
const REST = new Set(['idle', 'wander', 'villager', 'merchant', 'guard', 'patrol', 'police', 'porter', 'bandit', 'gang', 'passenger']); // 멀면 쉬는 두뇌
// A.2 은신 배율 · G.5 날씨 시야·소리 배수
const STEALTH = { SHALLOW: 1, MUD: 1.2, SAND: 1.2, GRASS: 1, FIELD: 0.9, PADDY: 0.85, FOREST: 0.6, MOUNTAIN: 0.8, ROAD: 1.1, MAIN_ROAD: 1.15, STREET: 1.1, YARD: 1, BRIDGE: 1.1, RAIL: 1.1, PIER: 1, REED: 0.45 };
export const WEATHER_SIGHT = { clear: 1, cloudy: 0.95, rain: 0.75, fog: 0.45, storm: 0.6, snow: 0.7 };
export const WEATHER_SOUND = { clear: 1, cloudy: 1, rain: 0.6, fog: 1, storm: 0.5, snow: 0.8 };

const L = {
  panic: ['사람 살려!', '아이고, 총이다!', '피하시오!', '난리 났네!', '어머나!'],
  crime: ['저, 저런…', '도둑이야!', '순검 나리를 불러야 하오!', '이게 무슨 일이여.'],
  dodge: ['어이쿠!', '길 좀 보고 다니시오!', '아이고, 놀래라.'],
  surrender: ['살려 주시오!', '항복이오, 항복!'],
  arrest: ['포박을 받으시오!', '순순히 따라오시오!', '멈추시오! 경무청이오.'],
  tram: ['전기거다!', '말도 없이 가요!', '저것 좀 보게.'], train: ['화륜거다!', '우레 같은 소리구먼.'], steamer: ['화륜선이다!', '연기 좀 보게.'],
  merchant: ['사려! 좋은 물건 있소!', '구경하고 가시오!', '값은 싸게 쳐 드리리다.'],
  talk: {
    villager: ['날이 좋구먼유.', '요새 쌀값이 올라 큰일이여.', '전기거 구경은 하셨소?'], woman: ['볼일 보시오.', '장에 가는 길이오.'],
    child: ['아저씨, 어디 가요?', '전기거다! 말도 없이 가요!'], yangban: ['어허, 길을 비키게. 갓이 상하겠네.', '세상이 어지럽구먼.'],
    merchant: ['셈은 깔끔하게 하시지요.', '물건 보고 가시오.'], police: ['수상한 자는 없었소?', '길 막지 마시오.'], army: ['물러서시오.', '여긴 함부로 들어오는 데가 아니오.'],
    rival: ['뭘 보느냐.'], pirate: ['물 위에선 우리가 법이여.'], gang: ['형님, 무사하시오?', '산채는 걱정 마시오.'], hunter: ['바람을 안고 다가가야 하오.'],
    guild: ['셈이 맞아야 길이 열리는 법이여.'], company: ['선로에 가까이 오지 마시오.'], bounty: ['현상금 붙은 머리만 잡소.'],
    foreign: { western: ['[영어] 좋은 날이오.', '[영어] 길을 찾으시오?'], jp: ['[일본어] 무슨 일이오?'], cn: ['[청국어] 물건 보고 가시오.'] },
  },
};

const pick = (a) => a[(Math.random() * a.length) | 0];
const roll = (list) => {
  let r = Math.random();
  for (const [id, p] of list || []) if ((r -= p) <= 0) return id;
  return null;
};
const valid = (e) => e && e.alive !== false && !e._removed && e.state !== 'dead' && !e.dead && !e.hidden;
const C_OF = (h) => COMBAT[h.role] || COMBAT.villager;
const civ = (h) => C_OF(h).flee === 1;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let pathBudget = 4; // 틱마다 길찾기 상한
let SYS = null;

// ---------------------------------------------------------------- NPC 클래스
export class NPC extends Human {
  constructor(opts = {}) {
    super(opts);
    this.tags.add('npc');
    this.essential = !!opts.essential;
    this.fleeAt = opts.fleeAt ?? null;
    this.hostile = false;
    this.npcId = opts.npcId || null;
    this._aw = 0; // 플레이어 감지 게이지
    this._hidden = false;
  }
  get hidden() {
    return this._hidden;
  }
  set hidden(v) {
    this._hidden = !!v;
    this.solid = !v && this.state !== 'dead' && !this.vehicle;
  }
  update(dt, game) {
    if (this._hidden) return void (this.moveX = this.moveY = 0);
    const p = game.player, b = this.brain;
    // 멀리 있는 한가한 NPC 는 쉰다 (성능: 화면 밖 250 m 넘게)
    if (p && this.state === 'normal' && !this.vehicle && b?.mode === 'calm' && REST.has(b.type) && Math.abs(this.x - p.x) + Math.abs(this.y - p.y) > 250) {
      this.vx = this.vy = this.speedNow = 0;
      if (this.speech && (this.speech.t -= dt) <= 0) this.speech = null;
      return;
    }
    super.update(dt, game);
  }
  damage(amount, info = {}, game) {
    if (this.state === 'dead' || this._hidden) return;
    super.damage(amount, info, game);
    if (this.state !== 'dead') this.brain?.onDamaged?.(this, info, game);
  }
  die(info = {}, game) {
    if (this.state === 'dead') return;
    this.setHostile(false);
    if (this.essential && !info.forceKill) {
      // §10 essential: 체력 0 → 죽지 않고 15초 쓰러졌다가 일어나 도주
      if (this.vehicle) this.vehicle.exit(this, game, { force: true });
      Object.assign(this, { hp: 1, state: 'down', downT: 15, essentialDown: true });
      return void game?.events.emit('npc:down', { npc: this, info });
    }
    super.die(info, game);
    this.handsUp = false;
  }
  setHostile(on) {
    if (this.hostile === !!on) return;
    this.hostile = !!on;
    on ? this.tags.add('hostile') : this.tags.delete('hostile');
  }
}

// ---------------------------------------------------------------- 두뇌
const CALM_RADIUS = { wander: 12, villager: 40, porter: 60, gang: 15, bandit: 20, patrol: 30, police: 150 };

class Brain {
  constructor(type, opts = {}) {
    Object.assign(this, { type, opts, mode: 'calm', modeT: 0, target: null, threat: null, goal: null, path: null, nextPathT: 0, stuckT: 0 });
    Object.assign(this, { pauseT: rand.range(0, 3), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0, reactT: 0, atkCd: 0, lostT: 0, ptIndex: 0, sayT: rand.range(4, 12) });
  }
  // ---- 이동
  stop(h) {
    h.moveX = h.moveY = 0;
  }
  face(h, x, y) {
    h.angle = Math.atan2(y - h.y, x - h.x);
  }
  steer(h, x, y, gait) {
    const dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy) || 1;
    Object.assign(h, { moveX: dx / d, moveY: dy / d, gait });
  }
  /** 길찾기로 (x,y) 까지. 도착하면 true */
  moveTo(h, x, y, gait, dt, game, arrive = 0.9) {
    const d = Math.hypot(x - h.x, y - h.y);
    if (d <= arrive) return this.stop(h), (this.path = null), true;
    const p = this.path;
    if ((!p || Math.hypot(p.gx - x, p.gy - y) > 3 || this.stuckT > 1.2) && game.time >= this.nextPathT && pathBudget > 0) {
      pathBudget--;
      this.nextPathT = game.time + 0.8 + Math.random() * 0.6;
      let pts = d > 5 ? game.world?.findPath?.(h.x, h.y, x, y, 'foot', 2500) : null;
      if (pts?.links?.length) pts = pts.slice(0, pts.links[0].i + 1); // 나루 건너기 전까지만
      const okp = pts && pts.length > 1;
      this.path = { pts: okp ? pts : [[x, y]], i: okp ? 1 : 0, gx: x, gy: y };
      if (this.stuckT > 1.2) {
        // 막혔으면 옆으로 비켜 본다
        const a = h.angle + (Math.PI / 2) * (this.strafe = -this.strafe);
        Object.assign(h, { moveX: Math.cos(a), moveY: Math.sin(a) });
        return (this.stuckT = 0), false;
      }
    }
    let tx = x, ty = y;
    if (this.path) {
      const P = this.path, pts = P.pts;
      while (P.i < pts.length - 1 && Math.hypot(pts[P.i][0] - h.x, pts[P.i][1] - h.y) < 1.3) P.i++;
      [tx, ty] = pts[Math.min(P.i, pts.length - 1)];
    }
    this.steer(h, tx, ty, gait);
    this.stuckT = h.speedNow < 0.2 ? this.stuckT + dt : 0;
    return false;
  }
  /** (x,y) 에서 멀어지는 쪽으로. 막힌 방향은 피한다 */
  runFrom(h, x, y, gait, game) {
    const base = Math.atan2(h.y - y, h.x - x), w = game.world;
    let a = base;
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
      const b = base + off * this.strafe, px = h.x + Math.cos(b) * 3, py = h.y + Math.sin(b) * 3;
      if (!w || (w.passable(px, py, 'foot') && !w.isDeepWater?.(px, py))) {
        a = b;
        break;
      }
    }
    Object.assign(h, { moveX: Math.cos(a), moveY: Math.sin(a), gait });
  }
  setMode(mode, t = 0) {
    Object.assign(this, { mode, modeT: t, path: null });
  }
  resolve(t, game) {
    return typeof t === 'string' ? SYS?.named(t) || game.byId(t) : t || null;
  }
  onScreen(e, game) {
    const b = game.camera?.bounds?.(4);
    return !!b && e.x > b.x0 && e.x < b.x1 && e.y > b.y0 && e.y < b.y1;
  }

  // ---- 갱신
  update(h, dt, game) {
    if (!this._init) {
      // makeBrain 옵션: home·weapon·target (미션·탈것이 두뇌만 바꿔 끼울 때)
      this._init = true;
      const o = this.opts;
      if (o.home) h.home = { x: o.home.x ?? o.home[0], y: o.home.y ?? o.home[1] };
      if (o.weapon !== undefined) SYS?.equip(h, o.weapon === 'fist' ? null : o.weapon);
      if (o.target) this.engage(h, this.resolve(o.target, game), game, 0.3);
    }
    if (this.atkCd > 0) this.atkCd -= dt;
    if (h.vehicle) return this.riding(h, dt, game);
    if (h.data.dodgeUntil > game.time) return this.stop(h); // 탈것 담당의 비키기가 움직이는 중
    if (h.essentialDown) (h.essentialDown = false), this.flee(h, this.lastAttacker || game.player, 20);
    // wanted 가 고른 목격자: 순검에게 신고하러 간다
    const wit = h.data.witness;
    if (!wit && this.byWanted) (this.byWanted = false), this.mode === 'report' && this.calmDown(h); // 신고가 끝났거나 위협당함
    else if (wit && !this.byWanted && this.mode !== 'fight' && this.mode !== 'surrender') {
      this.setMode('report');
      Object.assign(this, { byWanted: true, said: false, repT: 0, crime: { ...wit, offender: game.player } });
    }
    if (this.modeT > 0) this.modeT -= dt;
    const p = game.player;
    switch (this.mode) {
      case 'fight':
        return this.fight(h, dt, game);
      case 'flee': {
        const t = this.threat, tx = t?.x ?? h.x, ty = t?.y ?? h.y, d = Math.hypot(h.x - tx, h.y - ty);
        if (this.modeT <= 0 || d > (this.opts.fleeDist ?? 70)) return this.calmDown(h);
        this.runFrom(h, tx, ty, h.stamina > 30 && d < 15 ? 'sprint' : 'run', game);
        if ((this.sayT -= dt) <= 0 && ((this.sayT = rand.range(3, 7)), civ(h)) && Math.random() < 0.5) h.say(pick(L.panic), 2);
        return;
      }
      case 'report':
        return this.report(h, dt, game);
      case 'surrender':
        this.stop(h);
        h.handsUp = true;
        if (this.modeT <= 0 && (!p || dist(p, h) > 12)) {
          h.handsUp = h.surrendered = h.data.surrendered = false;
          h.tags.delete('surrendered');
          this.flee(h, p, 15);
        }
        return;
      case 'watch':
      case 'talk':
        this.stop(h);
        if (this.lookAt) this.face(h, this.lookAt.x, this.lookAt.y);
        return void (this.modeT <= 0 && this.calmDown(h));
      case 'dodge':
        if (this.modeT <= 0 || this.moveTo(h, this.goal.x, this.goal.y, 'run', dt, game, 0.4)) this.calmDown(h);
        return;
      case 'investigate':
        if (this.modeT <= 0) return this.calmDown(h);
        if (this.moveTo(h, this.goal.x, this.goal.y, 'run', dt, game, 3)) h.angle += dt * 1.2;
        return this.checkHostile(h, dt, game);
      default:
        this.calm(h, dt, game);
        this.checkHostile(h, dt, game);
    }
  }
  calmDown(h) {
    this.setMode('calm');
    Object.assign(this, { target: null, threat: null, goal: null, pauseT: rand.range(1, 3) });
    h.handsUp = h.aiming = false;
    h.setHostile?.(false);
  }
  flee(h, from, t = 12) {
    if (!from) return;
    this.setMode('flee', t);
    Object.assign(this, { threat: from, target: null });
    h.aiming = false;
    h.setHostile?.(false);
  }

  // ---- 평소 행동
  calm(h, dt, game) {
    const o = this.opts, home = h.home || h;
    switch (this.type) {
      case 'idle':
      case 'merchant':
      case 'guard':
        if (Math.hypot(h.x - home.x, h.y - home.y) > (o.radius ?? 1.5)) this.moveTo(h, home.x, home.y, 'walk', dt, game, 0.5);
        else {
          this.stop(h);
          if (o.facing != null) h.angle = o.facing;
          else if ((this.pauseT -= dt) <= 0) (this.pauseT = rand.range(3, 9)), (h.angle += rand.range(-1.2, 1.2));
        }
        if (this.type === 'merchant' && (this.sayT -= dt) <= 0) {
          this.sayT = rand.range(9, 18);
          if (game.player && dist(game.player, h) < 14) h.say(pick(L.merchant), 2.5);
        }
        return;
      case 'follower':
      case 'companion':
        return this.follow(h, dt, game);
      case 'flee': {
        const from = this.resolve(o.from, game) || game.player;
        if (!from || dist(from, h) > (o.dist ?? 60)) return this.stop(h);
        if (o.speed) h.speedRun = o.speed;
        return this.runFrom(h, from.x, from.y, 'run', game);
      }
      case 'driver': {
        // 걸어서: 맡은 탈것 운전석으로
        const v = this.resolve(o.vehicle, game);
        if (!v || v.driver) return this.stop(h);
        if (dist(v, h) > 2.5) return void this.moveTo(h, v.x, v.y, 'walk', dt, game, 2);
        return void v.enter(h, game, v.freeSeatIndex('driver'));
      }
      case 'passenger':
        return this.stop(h);
      case 'patrol':
      case 'police':
        if (o.points?.length) {
          const pt = o.points[this.ptIndex % o.points.length];
          if (this.pauseT > 0) return (this.pauseT -= dt), this.stop(h);
          if (this.moveTo(h, pt.x ?? pt[0], pt.y ?? pt[1], 'walk', dt, game, 1.2)) (this.ptIndex++), (this.pauseT = rand.range(1.5, 4));
          return;
        }
      // falls through — 점이 없으면 거닐기
      default:
        return this.wander(h, dt, game, o.radius ?? CALM_RADIUS[this.type] ?? 15);
    }
  }
  wander(h, dt, game, radius) {
    const o = this.opts;
    if (o.route?.length > 1) {
      // 길 따라 오가는 나그네: 끝에 닿으면 되돌아간다
      if (this.ptIndex < 0 || this.ptIndex >= o.route.length) (o.route = o.route.slice().reverse()), (this.ptIndex = 0);
      const pt = o.route[this.ptIndex];
      if (this.moveTo(h, pt[0], pt[1], 'walk', dt, game, 2)) this.ptIndex++;
      return;
    }
    if (this.pauseT > 0) return (this.pauseT -= dt), this.stop(h);
    if (!this.goal) {
      const home = h.home || h, w = game.world;
      let g = w?.randomPassableNear?.(home.x, home.y, radius, 'foot');
      if (g && this.type === 'villager' && Math.random() < 0.5) {
        const r = w.nearestRoadPoint?.(g.x, g.y, 30);
        if (r && Math.hypot(r.x - home.x, r.y - home.y) < radius * 1.2) g = r;
      }
      this.goal = g ? { x: g.x, y: g.y } : { x: home.x, y: home.y };
      this.goalT = 40;
    }
    if (this.moveTo(h, this.goal.x, this.goal.y, 'walk', dt, game, 1.2) || (this.goalT -= dt) <= 0) (this.goal = null), (this.pauseT = rand.range(2, 8));
  }
  follow(h, dt, game) {
    const o = this.opts, lead = this.resolve(o.target, game) || game.player;
    if (!lead) return this.stop(h);
    const lv = lead.vehicle;
    if (lv && o.board !== false) {
      // 지도자가 탈것에 타면 빈 승객석에 오른다
      const si = lv.freeSeatIndex?.('passenger') ?? -1;
      if (si >= 0 && Math.abs(lv.speed || 0) < 1) {
        if (dist(lv, h) < 3.5) return void lv.enter(h, game, si);
        return void this.moveTo(h, lv.x, lv.y, 'run', dt, game, 2);
      }
    }
    const d = dist(lead, h), near = o.dist ?? 2.6;
    if (d > 60 && o.teleport !== false && !this.onScreen(h, game) && !this.onScreen(lead, game)) {
      const q = game.world?.randomPassableNear?.(lead.x, lead.y, 4, 'foot');
      if (q) (h.x = q.x), (h.y = q.y);
    }
    if (d > near) this.moveTo(h, lead.x, lead.y, d > 12 ? 'sprint' : d > 5 ? 'run' : 'walk', dt, game, near);
    else this.stop(h);
  }
  riding(h, dt, game) {
    const o = this.opts, v = h.vehicle, slow = Math.abs(v.speed || 0) < 0.8;
    if (this.mode === 'fight') {
      // 탈것 위 싸움: 이동은 drive 가, 조준·사격은 combat 이
      const t = this.target;
      if (!valid(t) || dist(t, h) > 150) return this.calmDown(h);
      if ((this.reactT -= dt) <= 0) game.sys.combat?.npcAttack?.(h, t, dt);
      return;
    }
    if (this.type === 'follower' || this.type === 'companion') {
      const lead = this.resolve(o.target, game) || game.player;
      if (lead && lead.vehicle !== v && slow) v.exit(h, game);
    } else if (this.type === 'passenger' && o.exitAt && slow && Math.hypot(v.x - (o.exitAt.x ?? o.exitAt[0]), v.y - (o.exitAt.y ?? o.exitAt[1])) < (o.exitR ?? 15)) v.exit(h, game);
  }

  // ---- 적대 판단 (0.3초마다)
  checkHostile(h, dt, game) {
    if ((this._hcT = (this._hcT || 0) - dt) > 0) return;
    this._hcT = 0.3;
    const p = game.player;
    if (!p || p.state === 'dead' || p.hidden) return;
    const d = dist(p, h);
    if (d > 45) return;
    const aw = h._aw || 0, W = game.sys.wanted, lvl = W?.level || 0, f = h.faction;
    let fight = false;
    if (this.opts.hostile) fight = aw >= 0.5 || d < 20;
    else if (LAW.has(f)) fight = lvl > 0 && aw >= 1;
    else if (f === 'rival') fight = aw >= 1 && d < 30 && W?.honorTier?.() !== 'outlaw';
    else if (f === 'pirate') fight = aw >= 1 && d < 30;
    else if (f === 'bounty') fight = aw >= 1 && (W?.bounty || 0) >= 100;
    if (fight) this.engage(h, p, game);
    // 금지 구역 경비: 경고 뒤 5초 지나면 trespass
    const z = this.opts.zone;
    if (!z || (this.type !== 'guard' && this.type !== 'patrol') || aw < 1) return;
    if (!insideZone(z, p.x, p.y)) return void (this.warnT = this.warned = 0);
    if ((this.warnT = (this.warnT || 0) + 0.3) < 0.4) h.say('여기는 들어올 수 없소! 물러가시오.', 3);
    else if (this.warnT > 5 && !this.warned) (this.warned = true), game.emit('crime', { kind: 'trespass', x: p.x, y: p.y, offender: p, victim: h });
  }
  engage(h, target, game, react) {
    if (!valid(target) || target === h || this.mode === 'surrender' || (this.mode === 'fight' && this.target === target)) return;
    if (civ(h) && !this.opts.hostile) return this.flee(h, target, 14);
    this.setMode('fight');
    Object.assign(this, { target, reactT: react ?? C_OF(h).react ?? 0.6, lastSeen: { x: target.x, y: target.y }, lostT: 0 });
    h.setHostile?.(!!target.isPlayer);
    if (h.faction === 'police' && target.isPlayer && Math.random() < 0.5) h.say(pick(L.arrest), 2.5);
  }

  // ---- 싸움: 거리 유지·측면 이동은 두뇌가, 조준·사격·근접은 combat.npcAttack (없으면 몸싸움)
  fight(h, dt, game) {
    const t = this.target;
    if (!valid(t) || (t.state === 'down' && !t.isPlayer)) return this.calmDown(h);
    const C = C_OF(h), W = game.sys.wanted, lvl = W?.level || 0;
    // 수배가 풀리면 순검·병정·추격조는 물러난다
    if (t.isPlayer && W && !lvl && !this.provoked && (LAW.has(h.faction) || h.tags.has('pursuer'))) return this.calmDown(h);
    const ratio = h.maxHp ? h.hp / h.maxHp : 1, fleeAt = h.fleeAt ?? C.flee ?? 0;
    if (C.surrender && ratio <= C.surrender && !h.essential) return this.surrender(h, game);
    if (fleeAt > 0 && fleeAt < 1 && ratio <= fleeAt) return this.flee(h, t, 25);
    const d = dist(t, h);
    const seen = t.isPlayer ? (h._aw || 0) >= 0.6 || d < 6 : d < 40;
    if (seen) (this.lastSeen = { x: t.x, y: t.y }), (this.lostT = 0);
    else this.lostT += dt;
    if (this.lostT > (this.opts.persist ?? 20) || d > 120) return this.calmDown(h);
    h.aimAngle = Math.atan2(t.y - h.y, t.x - h.x);
    if (this.reactT > 0) return (this.reactT -= dt), this.stop(h), this.face(h, t.x, t.y);
    const cb = game.sys.combat, wid = h.weapon?.id || 'fist', kind = cb?.WEAPONS?.[wid]?.kind || W_FALLBACK[wid]?.[0] || 'fist';
    const atk = typeof cb?.npcAttack === 'function', ranged = atk && (kind === 'gun' || kind === 'bow' || kind === 'throw'); // 전투 시스템이 없으면 몸싸움
    // G.3: 1~2단계 순검은 먼저 체포(넘어뜨리기)를 시도한다. 겨누거나 공격하면 사격으로 바뀐다
    if (t.isPlayer && h.faction === 'police' && lvl > 0 && lvl <= 2 && !this.provoked && !W?.shouldShoot?.()) return this.arrest(h, t, d, dt, game);
    const pref = ranged ? clamp((cb?.WEAPONS?.[wid]?.effRange ?? EFF[wid] ?? 20) * 0.55, 7, 22) : 1.0;
    const goal = seen ? t : this.lastSeen;
    if (d > (ranged ? pref + 2.5 : pref) || !seen) {
      if (this.moveTo(h, goal.x, goal.y, !ranged || d > 10 ? 'run' : 'walk', dt, game, seen ? pref : 2) && !seen) this.lastSeen = { x: goal.x + rand.range(-15, 15), y: goal.y + rand.range(-15, 15) };
    } else if (ranged && d < pref - 4) this.runFrom(h, t.x, t.y, 'walk', game);
    else if (ranged) {
      if ((this.strafeT -= dt) <= 0) (this.strafeT = rand.range(1.5, 3)), (this.strafe = -this.strafe);
      const a = h.aimAngle + (Math.PI / 2) * this.strafe;
      Object.assign(h, { moveX: Math.cos(a) * 0.6, moveY: Math.sin(a) * 0.6, gait: 'walk' });
    } else this.stop(h);
    if (!seen) return void (h.aiming = false);
    if (!atk) return this.brawl(h, t, d, wid, game);
    // npcAttack 도 이동을 정하므로 두뇌의 이동(길찾기·측면 이동)을 되돌려 놓는다
    const mx = h.moveX, my = h.moveY, gait = h.gait;
    cb.npcAttack(h, t, dt);
    if (ranged || d > 3) Object.assign(h, { moveX: mx, moveY: my, gait });
  }
  arrest(h, t, d, dt, game) {
    h.aiming = false;
    if (d > 1.3) this.moveTo(h, t.x, t.y, d > 4 ? 'run' : 'walk', dt, game, 1.2);
    else this.stop(h), this.face(h, t.x, t.y);
    if ((this.sayT -= dt) <= 0) (this.sayT = rand.range(4, 7)), h.say(pick(L.arrest), 2.2);
    if (d > 1.8 || this.atkCd > 0) return;
    this.atkCd = 1.4;
    const cb = game.sys.combat;
    if (cb?.melee) cb.melee(h, Math.atan2(t.y - h.y, t.x - h.x), { heavy: true, target: t }); // 넘어지면 wanted 가 체포
    else this.brawl(h, t, d, 'fist', game);
  }
  brawl(h, t, d, wid, game) {
    this.face(h, t.x, t.y);
    if (d > 1.4 || this.atkCd > 0) return;
    const fb = W_FALLBACK[wid], melee = fb?.[0] === 'melee';
    this.atkCd = melee ? fb[2] * 1.5 : 1.2;
    t.damage?.((melee ? fb[1] : 8) * (t.isPlayer ? 0.6 : 1), { source: h, weapon: melee ? wid : 'fist', kind: melee ? 'melee' : 'fist', x: t.x, y: t.y, headshot: false }, game);
    game.sfx?.(melee ? 'hit' : 'punch', { x: t.x, y: t.y });
  }
  surrender(h, game) {
    this.setMode('surrender', 10);
    this.target = null;
    h.aiming = false;
    h.handsUp = h.surrendered = h.data.surrendered = true;
    h.tags.add('surrendered');
    h.setHostile?.(false);
    h.say(pick(L.surrender), 3);
    game.emit('npc:surrender', { npc: h });
  }

  // ---- 신고 (G.3): 가까운 순검에게 3.8 m/s 로 달려가 15 m 안에서 신고, 150 m 안에 없으면 25초 뒤 소리친다
  report(h, dt, game) {
    const wit = h.data.witness;
    this.repT = (this.repT || 0) + dt;
    const pol = wit?.police != null ? game.byId(wit.police) : null;
    const cop = valid(pol) ? pol : nearestCop(h, 150);
    const done = (ev, line) => {
      if (!this.said) (this.said = true), h.say(line, 3);
      if (this.byWanted) return; // 판정은 wanted 가 한다
      game.emit('npc:report', { npc: h, crime: this.crime, ...ev });
      this.repT = 0;
      this.calmDown(h);
    };
    if (cop) {
      if (dist(cop, h) < 15) return this.stop(h), this.face(h, cop.x, cop.y), done({ police: cop }, '나리! 저자가 죄를 지었습니다요!');
      return void this.moveTo(h, cop.x, cop.y, 'run', dt, game, 12);
    }
    const o = this.crime?.offender || game.player;
    if (o && dist(o, h) < 40) this.runFrom(h, o.x, o.y, 'run', game);
    else this.stop(h);
    if (this.repT > 25) done({ shout: true }, '사람 살려! 순검 나리!');
  }

  // ---- 사건
  onDamaged(h, info, game) {
    let src = info?.source || null;
    if (src?.kind === 'vehicle') src = src.driver || null;
    if (!src || src === h) return;
    this.lastAttacker = src;
    if (src.isPlayer) this.provoked = true;
    if (this.mode === 'surrender') return this.flee(h, src, 20);
    if ((this.mode === 'fight' && this.target === src) || (src.faction && src.faction === h.faction && !src.isPlayer)) return;
    if (civ(h) && !this.opts.hostile) return this.flee(h, src, 18), h.say(pick(L.panic), 2);
    this.engage(h, src, game, 0.2);
  }
  onRobbed(h, robber, game) {
    h.say('도둑이야!', 3);
    if (!civ(h)) return this.engage(h, robber, game);
    this.setMode('report');
    Object.assign(this, { said: false, repT: 0, crime: { kind: 'theft', x: h.x, y: h.y, offender: robber, victim: h } });
  }

  // ---- 탈것 운전: 싸움이면 표적을 쫓고, 아니면 목적지(opts.dest)나 근처 길로. 앞에 사람이 있으면 서서 비키라 한다
  drive(v, h, dt, game) {
    const c = v.ctl, o = this.opts, w = game.world, t = this.mode === 'fight' && valid(this.target) ? this.target : null;
    if (t && (!this.dest || dist(this.dest, t) > 8)) (this.dest = { x: t.x, y: t.y }), (this.vpath = null);
    if (!this.dest) {
      this.dest = o.dest ? { x: o.dest.x ?? o.dest[0], y: o.dest.y ?? o.dest[1] } : null;
      if (!this.dest) {
        const p = w?.randomPassableNear?.(v.x, v.y, 150, v.moveMode === 'boat' ? 'boat' : 'foot');
        const r = p && v.moveMode !== 'boat' ? w.nearestRoadPoint?.(p.x, p.y, 60) : null;
        this.dest = r ? { x: r.x, y: r.y } : p;
      }
      this.vpath = null;
    }
    const goal = this.dest;
    if (!goal || Math.hypot(goal.x - v.x, goal.y - v.y) < (t ? 7 : o.arrive ?? 5)) {
      Object.assign(c, { throttle: 0, steer: 0, brake: true });
      if (!t && !o.dest && (this.waitT = (this.waitT || 0) + dt) > 4) this.dest = this.waitT = null;
      return;
    }
    if (!this.vpath && pathBudget > 0 && game.time >= this.nextPathT) {
      pathBudget--;
      this.nextPathT = game.time + (t ? 1 : 2);
      const pts = w?.findPath?.(v.x, v.y, goal.x, goal.y, v.moveMode, 5000);
      this.vpath = { pts: pts?.length > 1 ? pts : [[goal.x, goal.y]], i: pts?.length > 1 ? 1 : 0 };
    }
    let tx = goal.x, ty = goal.y;
    if (this.vpath) {
      const P = this.vpath;
      while (P.i < P.pts.length - 1 && Math.hypot(P.pts[P.i][0] - v.x, P.pts[P.i][1] - v.y) < 3) P.i++;
      [tx, ty] = P.pts[Math.min(P.i, P.pts.length - 1)];
    }
    const diff = angleWrap(Math.atan2(ty - v.y, tx - v.x) - v.angle), ahead = (v.length || 2) / 2 + 2.5;
    const block = game.nearest(v.x + Math.cos(v.angle) * ahead, v.y + Math.sin(v.angle) * ahead, 2.2, (e) => e.kind === 'human' && !e.vehicle && e.state !== 'dead' && e !== t);
    Object.assign(c, { steer: clamp(diff * 2, -1, 1), throttle: block ? 0 : Math.abs(diff) > 1.4 ? 0.3 : t ? 1 : o.speed ?? 0.7, sprint: !!t && !block, brake: !!block });
    if (block && game.time > (this.honkT || 0)) {
      this.honkT = game.time + 3;
      SYS?.clearPath(v, 12);
      if (block.isPlayer && Math.random() < 0.5) h.say('비키시오!', 2);
    }
  }
}

function insideZone(z, x, y) {
  if (z.poly) {
    let inside = false;
    const p = z.poly;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
    return inside;
  }
  if (z.rect) return x >= z.rect[0] && y >= z.rect[1] && x <= z.rect[2] && y <= z.rect[3];
  return !!z.r && (x - z.x) ** 2 + (y - z.y) ** 2 <= z.r * z.r;
}
function nearestCop(h, r) {
  let best = null, bd = r * r;
  for (const n of SYS.npcs) {
    if (n === h || n.faction !== 'police' || n.state !== 'normal' || n._hidden) continue;
    const d = (n.x - h.x) ** 2 + (n.y - h.y) ** 2;
    if (d < bd) (bd = d), (best = n);
  }
  return best;
}

// ---------------------------------------------------------------- 시스템
export function install(game) {
  const npcs = [], byName = new Map(), tStealth = new Map();
  let murmurT = 0, scanT = 0, novT = 0, cleanT = 2;
  const isNight = () => game.sys.time?.isNight?.() ?? (game.hour < 5 || game.hour >= 20);
  const weather = () => game.sys.time?.weather || 'clear';
  const live = (n) => n.state === 'normal' && !n._hidden;
  const stealthAt = (x, y) => {
    const w = game.world;
    if (!w?.T) return 1;
    if (!tStealth.size) for (const k in STEALTH) if (w.T[k] != null) tStealth.set(w.T[k], STEALTH[k]);
    return tStealth.get(w.terrainAt(x, y)) ?? 1;
  };
  const los = (a, b) => game.sys.combat?.lineOfSight?.(a.x, a.y, b.x, b.y) ?? true;

  /** 소음 반경(m) — G.2: 웅크려 걷기 2(× stealthNoise), 걷기 6, 달리기 12, 질주 18, 말 평보 15, 말 질주 30 × 날씨 */
  function noise(h) {
    if (!h || h.state === 'dead') return 0;
    const wm = WEATHER_SOUND[weather()] ?? 1, v = h.vehicle;
    if (v) {
      const sp = Math.abs(v.speed ?? Math.hypot(v.vx, v.vy));
      return sp < 0.3 ? 0 : (sp < 2.6 ? 15 : 30) * wm;
    }
    if (h.speedNow < 0.2) return 0;
    return (h.crouching ? 2 * (game.sys.skills?.mod?.('stealthNoise', 1) ?? 1) : h.gait === 'sprint' ? 18 : h.gait === 'run' && h.speedNow > 2 ? 12 : 6) * wm;
  }

  /** 감지 게이지 (G.2): R = 시야(낮 22/밤 10) × 날씨 × 지형 은신 (× 횃불 2). R 안·시야각 110°·가림 없으면 차고, 아니면 −0.4/s. 1 이면 발견.
   *  dt 를 주지 않으면 지금 값만 돌려준다 (wanted·combat 의 판정용) */
  function perceive(npc, target, dt) {
    if (!npc || !target) return 0;
    const store = target.isPlayer ? null : (npc._awm ||= new Map());
    let v = store ? store.get(target.id) || 0 : npc._aw || 0;
    if (!(dt > 0) || !live(npc)) return v;
    const dx = target.x - npc.x, dy = target.y - npc.y, d = Math.hypot(dx, dy);
    let R = (isNight() ? 10 : 22) * (WEATHER_SIGHT[weather()] ?? 1) * stealthAt(target.x, target.y) * (target.torch ? 2 : 1);
    if (target.hidden || target.state === 'dead') R = 0;
    const fov = Math.abs(angleWrap(Math.atan2(dy, dx) - npc.angle)) < (55 * Math.PI) / 180;
    let see = d < R && (fov || d < 4);
    if (see && store) see = los(npc, target);
    else if (see) {
      // 가림 판정은 0.3초마다 (성능)
      if (!npc._los || game.time - npc._los.t > 0.3) npc._los = { t: game.time, v: los(npc, target) };
      see = npc._los.v;
    }
    if (see) {
      const pose = target.crouching ? 0.5 : target.gait === 'sprint' || (target.gait === 'run' && target.speedNow > 2) || target.vehicle ? 1.5 : 1;
      v += dt * (1.5 * (1 - d / R) + 0.25) * pose;
    } else if (d < noise(target)) {
      // 소리를 들으면 그쪽을 돌아본다
      if (npc.brain?.mode === 'calm' && v < 0.8) npc.angle = Math.atan2(dy, dx);
      v += dt * 0.35;
    } else v -= 0.4 * dt;
    v = clamp(v, 0, 1);
    store ? store.set(target.id, v) : (npc._aw = v);
    return v;
  }
  const awareness = (npc, target = game.player) => (!npc ? 0 : !target || target.isPlayer ? npc._aw || 0 : npc._awm?.get(target.id) || 0);
  /** (x,y) 를 볼 수 있는 NPC: 반경(기본 낮 25/밤 12 m × 날씨) 안, 시야각 안이거나 가깝거나 이미 알아챈 자, 가림 없음. 가까운 순 */
  function seers(x, y, r, except) {
    const out = [], rr = (Number.isFinite(r) ? r : isNight() ? 12 : 25) * (WEATHER_SIGHT[weather()] ?? 1), at = { x, y };
    for (const n of npcs) {
      if (n === except || !live(n) || n.noWitness) continue;
      const dx = x - n.x, dy = y - n.y, d = Math.hypot(dx, dy);
      if (d <= rr && (Math.abs(angleWrap(Math.atan2(dy, dx) - n.angle)) < 1.1 || d < rr * 0.35 || (n._aw || 0) >= 0.5) && (d < 3 || los(n, at))) out.push([d, n]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  }
  /** 목격자(신고할 사람): witnesses(x, y, r) 또는 wanted 식 witnesses(x, y, offender, {kind, victim}). 활빈패·화적·관헌·현상금꾼·수적은 빼고 */
  function witnesses(x, y, r, opts) {
    const off = r && typeof r === 'object' ? r : opts?.offender || null;
    return seers(x, y, typeof r === 'number' ? r : undefined, off).filter((n) => !NOT_CIVIL.has(n.faction) && n.brain?.mode !== 'fight');
  }

  const makeBrain = (type = 'idle', opts = {}) => new Brain(type, opts || {});
  function equip(n, wid) {
    if (!wid) return void (n.weapon = null);
    try {
      game.sys.combat?.equip?.(n, wid);
    } catch (err) {
      console.error('[npcs] equip', err);
    }
    if (n.weapon?.id !== wid) {
      const k = (W_FALLBACK[wid] || ['melee'])[0];
      n.weapon = { id: wid, kind: k, length: k === 'gun' ? 1.0 : k === 'bow' ? 0.8 : 0.7, color: '#3a2a1a' };
    }
  }

  function spawn(def = {}) {
    const role = def.role || 'villager', C = COMBAT[role] || COMBAT.villager, faction = def.faction || ROLE_FACTION[role] || 'civilian';
    const extra = { ...(def.look || {}) };
    if (role === 'foreigner') extra.mark ||= def.mark || pick(['western', 'western', 'jp', 'cn']);
    if ((role === 'sungeom' || role === 'jogye_police') && !extra.hairStyle) extra.hairStyle = Math.random() < 0.6 ? 'topknot' : 'short'; // 상투 60%·단발 40%
    if (role === 'rail_guard') extra.mark ||= def.mark || (Math.random() < 0.5 ? 'jp' : 'kr');
    if (role === 'child' || def.child) extra.child = true;
    const look = makeLook(role, extra);
    const x = def.x ?? game.player?.x ?? 0, y = def.y ?? game.player?.y ?? 0;
    const n = new NPC({
      id: def.id && !game.byId(def.id) ? def.id : undefined, npcId: def.id || null, x, y, angle: def.angle ?? rand.range(-Math.PI, Math.PI),
      role, faction, look, name: def.name || (role === 'foreigner' && MARK_NAME[look.mark]) || ROLE_NAME[role] || '행인', hp: def.hp ?? C.hp,
      dialog: def.dialog || null, shop: def.shop || null, home: def.home ? { ...def.home } : { x, y }, tags: def.tags || [],
      essential: def.essential ?? C.essential ?? false, fleeAt: def.fleeAt ?? null,
    });
    if (look.child) Object.assign(n, { speedWalk: 1.3, speedRun: 3.4 });
    if (def.speedRun || def.speed) n.speedRun = def.speedRun || def.speed;
    if (def.speedSprint) n.speedSprint = def.speedSprint;
    if (def.hanja) n.hanja = def.hanja;
    if (def.dialogAfter) n.dialogAfter = def.dialogAfter;
    n.data.spreadMul = C.spread ?? 1;
    const bo = { ...(def.brainOpts || {}) };
    if (def.radius ?? def.wanderR) bo.radius = def.radius ?? def.wanderR;
    if (def.points || def.route) bo.points = def.points || def.route;
    if (def.hostile) bo.hostile = true;
    n.brain = def.brain && typeof def.brain === 'object' ? def.brain : makeBrain(def.brain || ROLE_BRAIN[role] || 'villager', bo);
    game.add(n);
    npcs.push(n);
    if (def.id) byName.set(def.id, n);
    if (def.hidden) n.hidden = true;
    // 무기 (G.2 확률표). 순검은 수배 2단계부터 4명 중 1명 육혈포, 외국인 경호원은 육혈포
    let wid = def.weapon !== undefined ? (def.weapon === 'fist' ? null : def.weapon) : roll(C.weapons);
    if (def.weapon === undefined && ((role === 'sungeom' && (game.sys.wanted?.level || 0) >= 2 && Math.random() < 0.25) || (C.revolver && Math.random() < C.revolver) || def.bodyguard)) wid = 'w_revolver';
    equip(n, wid);
    if (def.target) n.brain.engage?.(n, def.target, game, def.react);
    return n;
  }

  function spawnGroup(kind, x, y, count = 3, opts = {}) {
    const [role, brain] = GROUPS[kind] || GROUPS.crowd, out = [], target = opts.target || (opts.hostile ? game.player : null);
    for (let i = 0; i < count; i++) {
      const p = game.world?.randomPassableNear?.(x, y, 3 + count, 'foot') || { x: x + rand.range(-2, 2), y: y + rand.range(-2, 2) };
      const n = spawn({ ...opts, role: opts.role || role, brain: opts.brain || brain, x: p.x, y: p.y, target: undefined, brainOpts: { persist: target ? 60 : undefined, ...(opts.brainOpts || {}) } });
      n.data.group = kind;
      if (opts.mounted) {
        // 기마 추격조: 말에 태운다 (탈것 시스템이 없으면 걸어서)
        try {
          const v = game.sys.vehicles?.spawn?.(opts.mounted, n.x, n.y, 0, { owner: n.id });
          if (v && v.enter(n, game, v.freeSeatIndex?.('driver') ?? 0) === false) game.remove(v);
        } catch (err) {
          console.warn('[npcs] mounted', err?.message);
        }
      }
      if (target) n.brain.engage(n, target, game, rand.range(0.2, 0.8));
      out.push(n);
    }
    return out;
  }

  /** 군중 웅성: 반경 안 민간인 둘까지 한마디 */
  function murmur(x, y, r, lines, max = 2) {
    if (game.realTime < murmurT) return;
    murmurT = game.realTime + 1.5;
    for (const n of npcs) {
      if (max <= 0) break;
      if (!live(n) || n.speech || n.faction !== 'civilian' || Math.hypot(n.x - x, n.y - y) > r || Math.random() < 0.4) continue;
      n.say(pick(lines), 2.5);
      max--;
    }
  }

  /** 소리(총·비명·소음·수배 신고): 가까운 민간인은 도망(가끔 손 들기), 먼 민간인은 돌아본다. 법·적대 세력은 대응, 그 밖은 살피러 간다 */
  function alert(x, y, radius = 30, kind = 'shot', source = null) {
    const loud = kind === 'shot' || kind === 'scream' || kind === 'explosion' || kind === 'fire', W = game.sys.wanted;
    if (kind === 'wanted') source ||= game.player;
    for (const n of npcs) {
      const b = n.brain, d = Math.hypot(n.x - x, n.y - y);
      if (n === source || d > radius || !live(n) || n.vehicle || !b || b.mode === 'fight' || b.mode === 'surrender' || b.mode === 'report') continue;
      const pl = source?.isPlayer, f = n.faction;
      if (civ(n)) {
        if (loud && (d < radius * 0.6 || d < 12)) Math.random() < 0.85 || d < 10 ? b.flee(n, { x, y }, rand.range(8, 15)) : b.surrender(n, game);
        else if (b.mode === 'calm') (b.setMode('watch', loud ? 3 : 1.5), (b.lookAt = { x, y }));
      } else if (pl && (f === 'rival' || f === 'pirate' || (f === 'bounty' && (W?.bounty || 0) >= 100) || (LAW.has(f) && (W?.level || 0) > 0))) b.engage(n, source, game);
      else if (f !== 'gang' && b.mode === 'calm' && d < Math.max(12, radius * 0.7)) (b.setMode('investigate', 8), (b.goal = { x: x + rand.range(-4, 4), y: y + rand.range(-4, 4) }));
    }
    if (loud) murmur(x, y, radius * 0.5, L.panic);
  }

  /** 위협(1.5초 겨누기): 성공 0.7(스킬 'intimidate') → 손들기. wanted 가 맡은 목격자 위협은 wanted 가 판정한다 */
  function intimidate(n) {
    const b = n?.brain;
    if (!b || n.state !== 'normal' || Math.random() >= (game.sys.skills?.mod?.('intimidate', 0.7) ?? 0.7)) return false;
    const rep = b.mode === 'report';
    b.surrender(n, game);
    n.say(rep ? '아, 알겠소! 아무 말 않겠소!' : pick(L.surrender), 3);
    game.emit('npc:intimidated', { npc: n, report: rep });
    return true;
  }

  /** 탈것 앞 행인 비키기 (C.3): 앞 부채꼴 reach m 안에서 확률로 옆으로 1.8 m */
  function dodgeAhead(v, reach, pDay, pNight, fan, full) {
    const c = Math.cos(v.angle), s = Math.sin(v.angle), half = (v.width ?? 1) / 2 + 0.6, now = game.time;
    for (const n of npcs) {
      const b = n.brain;
      if (n.vehicle || !live(n) || n === v.driver || !b || b.mode === 'fight' || b.mode === 'dodge' || b.mode === 'flee') continue;
      const dx = n.x - v.x, dy = n.y - v.y, lx = dx * c + dy * s, ly = -dx * s + dy * c;
      if (lx < 0 || lx > reach + (v.length ?? 0) / 2 || Math.abs(ly) > Math.max(lx * Math.tan(fan), half + (full ? 1 : 0))) continue;
      if (!full && n._dodgeV === v.id && now - n._dodgeT < 4) continue;
      Object.assign(n, { _dodgeV: v.id, _dodgeT: now });
      if (Math.random() > (n.tags.has('sleeper') ? 0.5 : isNight() ? pNight : pDay)) continue;
      const side = ly >= 0 ? 1 : -1, off = Math.max(1.8, half + 1.8 - Math.abs(ly));
      b.setMode('dodge', 1.4);
      b.goal = { x: n.x - s * side * off, y: n.y + c * side * off };
      if (Math.random() < 0.3) n.say(pick(L.dodge), 1.8);
    }
  }
  const clearPath = (v, range = 25) => v && dodgeAhead(v, range, 1, 1, (25 * Math.PI) / 180, true);

  // ---- 대화 ('거래'는 shops.js 가 npc.shop 을 보고 붙인다)
  function talkTo(n, actor) {
    const b = n.brain;
    if (b && b.mode !== 'fight') (b.setMode('talk', 3), (b.lookAt = { x: actor.x, y: actor.y }));
    n.angle = Math.atan2(actor.y - n.y, actor.x - n.x);
    let handled = false;
    try {
      handled = game.sys.missions?.onTalk?.(n) === true;
    } catch (err) {
      console.error('[npcs] onTalk', err);
    }
    const line = handled ? null : nextLine(n);
    if (line) n.npcId && game.sys.ui?.dialogue ? game.sys.ui.dialogue([{ speaker: n.name, text: line }]) : n.say(line, 3.5);
    game.emit('talk', { npc: n });
  }
  const cond = (c) => game.sys.missions?.cond?.(c) ?? (c?.[0] === '!' ? !game.flags[c.slice(1)] : !!game.flags[c]);
  function nextLine(n) {
    let lines = typeof n.dialog === 'string' ? [n.dialog] : (n.dialog || []).slice();
    for (const [c, t] of n.dialogAfter || []) if (cond(c) && !lines.includes(t)) lines.push(t);
    lines = lines.filter((l) => typeof l === 'string' || (l && (!l.flag || cond(l.flag)) && (!l.not || !game.flags[l.not])));
    if (lines.length) {
      const l = lines[(n._dlgI = ((n._dlgI ?? -1) + 1) % lines.length)];
      return typeof l === 'string' ? l : l.text;
    }
    const T = L.talk;
    if (n.faction === 'foreign') return pick(T.foreign[n.look?.mark] || T.foreign.western);
    return pick(n.look?.child ? T.child : T[n.role] || T[n.faction] || T.villager);
  }
  game.addInteractionProvider((actor, t) => {
    if (!(t instanceof NPC) || !actor?.isPlayer || !live(t) || t.hostile || t.vehicle || ['fight', 'flee', 'report'].includes(t.brain?.mode)) return [];
    return [{ key: 'interact', label: `대화 — ${t.name}`, priority: 2, run: (a) => talkTo(t, a) }];
  });

  // ---- 이벤트 반응
  game.on('shot', (e) => {
    const x = e.x ?? e.shooter?.x, y = e.y ?? e.shooter?.y, r = (e.noise ?? 100) * (WEATHER_SOUND[weather()] ?? 1);
    if (Number.isFinite(x) && r > 1) alert(x, y, r, 'shot', e.shooter);
  });
  game.on('noise', (e) => e && Number.isFinite(e.x) && e.radius > 1 && alert(e.x, e.y, e.radius, 'noise', e.source)); // combat: 근접·잠입 소음
  game.on('crime', (e) => {
    const off = e.offender;
    if (!off || !Number.isFinite(e.x)) return;
    // 플레이어 범죄의 신고는 wanted 가 목격자(data.witness)를 골라 맡는다
    const violent = VIOLENT.has(e.kind), managed = off.isPlayer && !!game.sys.wanted?.report;
    let reporter = null;
    for (const n of seers(e.x, e.y, undefined, off)) {
      const b = n.brain;
      if (!b || b.mode === 'fight' || b.mode === 'report') continue;
      if (LAW.has(n.faction)) {
        if (violent || off.isPlayer) b.engage(n, off, game);
      } else if (!managed && !reporter && n.faction === 'civilian' && n !== e.victim) {
        reporter = n;
        b.setMode('report');
        Object.assign(b, { crime: e, said: false, repT: 0 });
        n.say(violent ? '사람 죽네! 순검 나리!' : '도둑이야!', 2.5);
      } else if (civ(n) && violent) b.flee(n, off, rand.range(8, 14));
      else if (b.mode === 'calm') (b.setMode('watch', 2.5), (b.lookAt = { x: e.x, y: e.y }));
    }
    murmur(e.x, e.y, 14, violent ? L.panic : L.crime);
  });
  game.on('damage', (e) => {
    const t = e.target, src = e.source, p = game.player;
    if (t?.kind !== 'human') return;
    // 동료: 플레이어를 친 자, 플레이어가 친 적대자를 노린다
    const foe = t === p && src && src !== p && src.kind !== 'vehicle' ? src : src === p && t !== p && (t.hostile || t.faction === 'rival' || t.brain?.target === p) ? t : null;
    if (foe) for (const n of npcs) if (n.brain?.type === 'companion' && n.brain.mode !== 'fight' && live(n) && dist(n, foe) < 40) n.brain.engage(n, foe, game, 0.3);
    if (t !== p && (e.kind === 'bullet' || e.kind === 'melee' || e.kind === 'fist')) murmur(t.x, t.y, 12, e.kind === 'bullet' ? L.panic : L.crime);
  });
  game.on('kill', (e) => {
    const v = e.victim;
    if (v?.kind !== 'human') return;
    for (const n of npcs) if (n.brain?.target === v) n.brain.calmDown(n);
    if (Math.random() < 0.6) alert(v.x, v.y, 14, 'scream', e.killer);
  });

  // ---- 주기 판단: 탈것 앞 비키기, 겨눔 위협, 마당 반응, 신문물 구경
  const NOVEL = { tram: [L.tram, 0.3], train: [L.train, 0.4], steamer: [L.steamer, 0.4] };
  function periodic(dt, p) {
    if ((scanT -= dt) <= 0) {
      scanT = 0.2;
      for (const v of game.query(p.x, p.y, 70, (e) => e.kind === 'vehicle')) {
        const sp = Math.hypot(v.vx, v.vy);
        if (sp > 1.2) dodgeAhead(v, sp * 1.2 + 2, 0.85, 0.55, (15 * Math.PI) / 180, false);
      }
      const wk = p.weapon?.kind;
      for (const n of npcs) {
        if (!live(n)) continue;
        const dx = n.x - p.x, dy = n.y - p.y, d = Math.hypot(dx, dy);
        if (n.data.witness || !(p.aiming && (wk === 'gun' || wk === 'bow') && d < 25 && Math.abs(angleWrap(Math.atan2(dy, dx) - p.aimAngle)) < 0.14)) {
          n._aimedT = 0;
          continue;
        }
        if ((n._aimedT = (n._aimedT || 0) + 0.2) < 1.5 || n._aimedT > 1.75) continue;
        const b = n.brain;
        if (!b || b.mode === 'surrender') continue;
        b.provoked = true;
        if (b.mode === 'fight') continue;
        if (civ(n)) !intimidate(n) && (b.mode === 'report' || Math.random() < 0.5 ? b.flee(n, p, 15) : b.surrender(n, game));
        else if (n.faction !== 'gang' && n.faction !== 'civilian' && n.faction !== 'guild') b.engage(n, p, game);
      }
      // 마당(YARD): "남의 집이오"
      const w = game.world;
      if (w?.T?.YARD != null && !p.vehicle && w.terrainAt(p.x, p.y) === w.T.YARD && game.realTime > (p._yardT || 0)) {
        const n = npcs.find((n) => n.faction === 'civilian' && live(n) && n.brain?.mode === 'calm' && dist(n, p) < 7 && (n._aw || 0) > 0.5);
        if (n) (n.say('남의 집이오.', 2.5), n.brain.setMode('watch', 2), (n.brain.lookAt = { x: p.x, y: p.y }), (p._yardT = game.realTime + 30));
      }
    }
    if ((novT -= dt) > 0) return;
    novT = 0.5;
    // 신문물 구경 (C.3): 반경 12 m NPC 가 2초 멈춰 쳐다본다 — 전차 30%(개통 축제 80%), 기차·증기선 40%
    for (const v of game.query(p.x, p.y, 110, (e) => e.kind === 'vehicle' && NOVEL[e.vtype])) {
      if (Math.hypot(v.vx, v.vy) < 0.5) continue;
      const [lines, base] = NOVEL[v.vtype], chance = v.vtype === 'tram' && game.flags.tram_festival ? 0.8 : base;
      for (const n of npcs) {
        if (n.vehicle || !live(n) || n.brain?.mode !== 'calm' || n.faction === 'foreign' || dist(n, v) > 12) continue;
        if (n._novV === v.id && game.time - n._novT < 30) continue;
        Object.assign(n, { _novV: v.id, _novT: game.time });
        if (Math.random() > chance) continue;
        n.brain.setMode('watch', 2);
        n.brain.lookAt = v;
        if (Math.random() < 0.25) n.say(pick(lines), 2);
      }
    }
  }
  /** 추격조·현상금 습격조는 멀어지면 정리 (spawner 가 맡지 않는 무리) */
  function cleanStray(p) {
    const b = game.camera?.bounds?.(4);
    for (const n of npcs) {
      if (!(n.tags.has('pursuer') || n.tags.has('bounty_ambush')) || (n.brain?.mode === 'fight' && n.state !== 'dead') || dist(n, p) < 200) continue;
      if (b && n.x > b.x0 && n.x < b.x1 && n.y > b.y0 && n.y < b.y1) continue;
      n.vehicle?.exit?.(n, game, { force: true, silent: true });
      game.remove(n);
    }
  }

  SYS = {
    name: 'npcs', order: 20, COMBAT, ROLE_FACTION, npcs,
    spawn, makeBrain, spawnGroup, alert, perceive, witnesses, awareness, noise, clearPath, intimidate, equip, talk: talkTo,
    named: (id) => {
      const n = byName.get(id);
      return n && !n._removed ? n : null;
    },
    setTarget: (n, t) => n?.brain && (t ? n.brain.engage?.(n, t, game, 0.3) : n.brain.calmDown?.(n)),
    calm: (n) => n?.brain?.calmDown?.(n),
    list: () => npcs.filter((n) => !n._removed),
    update(dt) {
      pathBudget = 4;
      const p = game.player;
      let w = 0;
      for (const n of npcs) {
        if (n._removed) {
          if (n.npcId && byName.get(n.npcId) === n) byName.delete(n.npcId);
          continue;
        }
        npcs[w++] = n;
        if (!p || !live(n)) continue;
        if (Math.abs(n.x - p.x) < 45 && Math.abs(n.y - p.y) < 45) perceive(n, p, dt);
        else if (n._aw) n._aw = Math.max(0, n._aw - 0.4 * dt);
      }
      npcs.length = w;
      if (!p) return;
      periodic(dt, p);
      if ((cleanT -= dt) <= 0) (cleanT = 2), cleanStray(p);
    },
    serialize() {
      const out = {};
      for (const [id, n] of byName) if (!n._removed) out[id] = { x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10, hidden: n._hidden, dead: n.state === 'dead', home: n.home };
      return { named: out };
    },
    deserialize(d) {
      this._pending = d?.named || null;
      this.applyPending();
    },
    /** 저장된 이름 있는 인물 상태 적용 (spawner 가 인물을 만든 뒤에도 부른다) */
    applyPending() {
      const d = this._pending;
      for (const id in d || {}) {
        const n = byName.get(id), s = d[id];
        if (!n || !s) continue;
        if (Number.isFinite(s.x)) (n.x = s.x), (n.y = s.y);
        if (s.home) n.home = { ...s.home };
        n.hidden = !!s.hidden;
        if (s.dead && n.state !== 'dead' && !n.essential) n.die({ forceKill: true }, null);
      }
    },
  };
  game.registerSystem(SYS);
  return SYS;
}
