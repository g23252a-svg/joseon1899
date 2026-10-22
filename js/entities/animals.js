// 동물 [사람]: 7종 SPECIES(E.1), 상태기계(풀뜯기·배회·경계·도망·공격)·무리·냄새·소리 반응, 가죽 품질, 그리기(B.5). game.sys.animals
//   spawn(speciesId, x, y, opts) → Animal    (추가) spawnPack(speciesId, x, y, n, opts) → Animal[]   alert(x, y, r, kind)   list()   activeNow(spec, hour)
//   Animal: kind='animal', species, spec, hp, state, dead, skinned, quality(1~3), length·width(몸 L×W), hitTest(px, py, r), (추가) isHead(px, py)
//   가죽 벗기기는 loot.js 가 interaction provider 로 (animal.dead, skinned, species, quality, spec.meat/extra/size 를 읽음)

import { Entity, LAYER } from '../engine/entity.js';
import { moveCircle } from '../engine/physics.js';
import { PAL } from '../engine/palette.js';
import { angleWrap, clamp, rand } from '../engine/util.js';

// active: day 6~19, dawn 4~7, night 19~5 / temper: timid 달아남, reed 갈대로, flyer 날아감, charge 돌진, pack 무리 사냥, stalker 덮침
export const SPECIES = {
  roe_deer: { id: 'roe_deer', name: '노루', hp: 60, len: 1.1, wid: 0.35, walk: 1.5, run: 9.0, sight: [35, 20], smell: 25, temper: 'timid', fleeDist: 300, group: [1, 3], active: ['day', 'dawn'], size: 'M', pelt: 'pelt_roe_deer', price: 40, meat: 2, proper: ['w_bow', 'w_matchlock'], color: '#a8794a', head: 0.12, tail: 0.1 },
  water_deer: { id: 'water_deer', name: '고라니', hp: 45, len: 0.9, wid: 0.32, walk: 1.4, run: 8.5, sight: [30, 18], smell: 25, temper: 'reed', fleeDist: 150, group: [1, 2], active: ['day', 'night'], size: 'M', pelt: 'pelt_water_deer', price: 25, meat: 1, proper: ['w_bow'], color: '#a89070', head: 0.11, tail: 0.06, fangs: true },
  pheasant: { id: 'pheasant', name: '꿩', hp: 10, len: 0.35, wid: 0.15, walk: 1.0, run: 7.0, sight: [20, 10], smell: 10, temper: 'flyer', fleeDist: 30, group: [1, 3], active: ['day'], size: 'S', pelt: null, price: 0, meat: 1, extra: [{ id: 'mat_feather', n: 2 }], proper: null, color: '#8a5a3a', head: 0.06, tail: 0.3, bird: true },
  boar: { id: 'boar', name: '멧돼지', hp: 140, len: 1.2, wid: 0.5, walk: 1.6, run: 8.0, charge: 9.0, sight: [25, 15], smell: 30, temper: 'charge', chargeR: 12, attack: { dmg: 25, cool: 2.5, knock: 1.5 }, group: [1, 3], active: ['day', 'night'], size: 'L', pelt: 'pelt_boar', price: 50, meat: 3, proper: ['w_matchlock', 'w_rifle'], color: '#4a3f35', head: 0.17, tail: 0.12, big: true },
  wolf: { id: 'wolf', name: '늑대', hp: 70, len: 1.1, wid: 0.35, walk: 1.8, run: 8.5, sight: [30, 30], smell: 35, temper: 'pack', packR: 25, attack: { dmg: 12, cool: 1.2, knock: 0 }, group: [3, 4], active: ['night'], size: 'M', pelt: 'pelt_wolf', price: 60, meat: 1, proper: ['w_bow', 'w_matchlock', 'w_rifle'], color: '#8a8478', head: 0.13, tail: 0.35 },
  fox: { id: 'fox', name: '여우', hp: 30, len: 0.7, wid: 0.22, walk: 1.5, run: 7.5, sight: [30, 25], smell: 30, temper: 'timid', fleeDist: 120, group: [1, 1], active: ['dawn', 'night'], size: 'S', pelt: 'pelt_fox', price: 45, meat: 0, proper: ['w_bow'], color: '#b86a35', head: 0.1, tail: 0.35 },
  tiger: { id: 'tiger', name: '범', hp: 220, len: 2.0, wid: 0.6, walk: 2.0, run: 11.0, sight: [40, 40], smell: 40, temper: 'stalker', stalkR: 30, attack: { dmg: 45, cool: 2, knock: 2, unblockable: true }, group: [1, 1], active: ['night'], size: 'L', pelt: 'pelt_tiger', price: 600, meat: 4, proper: ['w_matchlock', 'w_rifle'], color: PAL.tiger, head: 0.2, tail: 0.9, big: true },
};
const NOT_SHOT = new Set(['melee', 'fist', 'trample', 'fall', 'animal', 'fire', 'drown']);
const WEATHER_DETECT = { rain: 0.8, fog: 0.5, storm: 0.6, snow: 0.7 }; // G.5 동물 감지 배수

/** 지금 시각에 활동하는 종인가 */
export function activeNow(spec, hour) {
  const h = ((hour % 24) + 24) % 24;
  return spec.active.some((a) => (a === 'day' ? h >= 6 && h < 19 : a === 'dawn' ? h >= 4 && h < 7 : h >= 19 || h < 5));
}

/** 가죽 품질 (E.1 표): 적정 무기·맞은 횟수·머리 명중 */
export function peltQuality(spec, hits) {
  const n = hits.length;
  if (!n) return 1;
  const melee = hits.some((h) => NOT_SHOT.has(h.kind));
  const allProper = hits.every((h) => !spec.proper || spec.proper.includes(h.weapon));
  let q = 1;
  if (!melee && allProper && n <= (spec.big ? 2 : 1)) q = 3;
  else if (!melee && ((allProper && n <= 3) || n === 1)) q = 2;
  if (hits[n - 1].head) q = Math.min(3, q + 1);
  return q;
}

const isNightHour = (h) => h >= 20 || h < 4;
let GAME = null;

export class Animal extends Entity {
  constructor(spec, x, y, opts = {}) {
    super({ x, y, radius: clamp(spec.wid * 0.7, 0.14, 0.42), mass: spec.big ? 3 : spec.size === 'S' ? 0.3 : 1.2, hp: spec.hp, angle: rand.range(-Math.PI, Math.PI) });
    Object.assign(this, { kind: 'animal', species: spec.id, spec, name: spec.name, length: spec.len, width: spec.wid, state: 'graze', stateT: rand.range(1, 6) });
    Object.assign(this, { dead: false, skinned: false, quality: 0, hits: [], home: { x, y }, pack: opts.pack || null, target: null, threat: null, goal: null });
    Object.assign(this, { atkCd: rand.range(0.5, 1.5), phase: rand.range(0, 6), speedNow: 0, moveMode: 'foot', senseT: rand.range(0, 0.3), slot: opts.slot || 0 });
    this.tags.add('animal');
    this.tags.add(spec.id);
    if (opts.zone) this.data.zone = opts.zone;
  }

  // ---- 판정
  local(px, py) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle), dx = px - this.x, dy = py - this.y;
    return [dx * c + dy * s, -dx * s + dy * c];
  }
  /** 몸 타원 맞음 판정 (총알·화살) */
  hitTest(px, py, r = 0) {
    if (this.dead) return false;
    const [lx, ly] = this.local(px, py);
    const a = this.spec.len / 2 + r + this.spec.head, b = this.spec.wid / 2 + r;
    return (lx * lx) / (a * a) + (ly * ly) / (b * b) <= 1;
  }
  /** 머리 = 몸 앞쪽 30% (G.2) */
  isHead(px, py) {
    return this.hitTest(px, py, 0.12) && this.local(px, py)[0] > this.spec.len * 0.2;
  }

  damage(amount, info = {}, game) {
    if (this.dead) return;
    let head = !!info.headshot;
    // 전투 시스템이 머리 판정을 안 했으면 맞은 자리로 판정 (피해 ×3)
    if (info.headshot == null && (info.kind === 'bullet' || info.kind === 'arrow') && Number.isFinite(info.x) && this.isHead(info.x, info.y)) (head = true), (amount *= 3);
    this.hits.push({ weapon: info.weapon || null, kind: info.kind || 'bullet', head });
    this.hp -= amount;
    game?.events.emit('damage', { target: this, amount, ...info, headshot: head });
    if (this.hp <= 0) return (this.hp = 0), this.die({ ...info, headshot: head }, game);
    let src = info.source || null;
    if (src?.kind === 'vehicle') src = src.driver || src;
    const t = this.spec.temper;
    const brave = t === 'charge' || t === 'stalker' || (t === 'pack' && game && isNightHour(game.hour));
    if (src && brave && this.hp > this.spec.hp * 0.25) this.attackStart(src, game);
    else this.fleeFrom(src || { x: info.x ?? this.x, y: info.y ?? this.y });
  }
  die(info = {}, game) {
    if (this.dead) return;
    Object.assign(this, { dead: true, state: 'dead', solid: false, layer: LAYER.LOW, vx: 0, vy: 0, deathAngle: this.angle });
    this.quality = peltQuality(this.spec, this.hits);
    if (this.pack) {
      const m = this.pack.members;
      m.splice(m.indexOf(this), 1);
      if (this.spec.temper === 'pack' && m.length <= 1) for (const o of m) o.fleeFrom(info.source || this);
    }
    super.die(info, game); // 'kill' 이벤트
  }

  // ---- 행동
  fleeFrom(src) {
    if (!src) return;
    this.threat = src;
    this.target = null;
    if (this.spec.temper === 'flyer') {
      Object.assign(this, { state: 'fly', stateT: this.spec.fleeDist / this.spec.run, moveMode: 'ghost' });
      GAME?.sfx?.('bird', { x: this.x, y: this.y });
    } else Object.assign(this, { state: 'flee', stateT: 30, fleeStart: { x: this.x, y: this.y } });
    if (this.pack) for (const o of this.pack.members) if (o !== this && o.state !== 'flee' && o.state !== 'fly' && !o.dead) o.fleeFrom(src);
  }
  attackStart(t, game) {
    if (!t || this.dead) return;
    const sp = this.spec;
    if (sp.temper === 'stalker' && !['stalk', 'charge', 'recover'].includes(this.state)) game?.sfx?.('tiger', { x: this.x, y: this.y });
    Object.assign(this, { target: t, threat: null, state: sp.temper === 'stalker' ? 'stalk' : sp.temper === 'pack' ? 'circle' : 'charge', stateT: 0 });
    if (sp.temper === 'charge') this.chargeAt(t);
    if (this.pack && sp.temper === 'pack') {
      this.pack.target = t;
      for (const o of this.pack.members) if (o !== this && !o.dead && o.target !== t) o.attackStart(t, game);
    }
  }
  chargeAt(t) {
    Object.assign(this, { state: 'charge', stateT: 1.6, dir: Math.atan2(t.y - this.y, t.x - this.x) });
  }
  strike(t, game) {
    const a = this.spec.attack, dx = t.x - this.x, dy = t.y - this.y, d = Math.hypot(dx, dy) || 1;
    const victim = t.vehicle && t.vehicle.damage ? t.vehicle : t; // 말 탄 사람이면 말을 문다
    victim.damage?.(a.dmg, { source: this, weapon: this.species, kind: 'animal', x: t.x, y: t.y, headshot: false, unblockable: !!a.unblockable }, game);
    if (a.knock && victim === t && t.state === 'normal') t.knockDown?.(dx / d, dy / d, 3, a.knock);
    this.atkCd = a.cool + (this.spec.temper === 'pack' ? rand.range(0.4, 1.6) : 0);
    game?.sfx?.('hit', { x: t.x, y: t.y, pitch: 0.7 });
  }

  /** 이 사람을 알아챘는가: 시야(웅크리면 ×0.5)·냄새(맞바람 60°)·소리 */
  detects(p, game) {
    if (!p || p.state === 'dead' || p.hidden) return false;
    const dx = this.x - p.x, dy = this.y - p.y, d = Math.hypot(dx, dy), sp = this.spec;
    let sight = sp.sight[isNightHour(game.hour) ? 1 : 0] * (WEATHER_DETECT[game.sys.time?.weather] ?? 1) * (p.crouching ? 0.5 : 1);
    if (p.isPlayer) sight *= game.sys.skills?.mod?.('animalDetect', 1) ?? 1;
    if (d < sight) return true;
    const wind = game.sys.time?.wind;
    if (wind && wind.strength > 0.05 && d < sp.smell && Math.abs(angleWrap(Math.atan2(dy, dx) - wind.angle)) < Math.PI / 3) return true;
    return d < (game.sys.npcs?.noise?.(p) ?? (p.speedNow > 3 ? 12 : p.speedNow > 0.3 && !p.crouching ? 6 : 0));
  }

  sense(game) {
    const p = game.player, sp = this.spec;
    if (this.state === 'flee' || this.state === 'fly' || this.target) return;
    // 늑대(밤)·범: 가까운 사람을 노린다
    if ((sp.temper === 'pack' && isNightHour(game.hour)) || sp.temper === 'stalker') {
      const prey = game.nearest(this.x, this.y, sp.temper === 'pack' ? sp.packR : sp.stalkR, (e) => e.kind === 'human' && e.state !== 'dead' && !e.hidden);
      if (prey && (prey !== p || this.detects(p, game))) return this.attackStart(prey, game);
    }
    if (!p || !this.detects(p, game)) return;
    if (sp.temper === 'charge' && Math.hypot(p.x - this.x, p.y - this.y) < sp.chargeR) return this.attackStart(p, game);
    if (sp.temper === 'stalker') return;
    if (sp.temper === 'charge' && this.state !== 'alert') return void Object.assign(this, { state: 'alert', stateT: 1.2, threat: p });
    this.fleeFrom(p);
  }

  go(ang, speed, dt, game) {
    const k = Math.min(1, dt * (speed > 4 ? 5 : 8));
    this.vx += (Math.cos(ang) * speed - this.vx) * k;
    this.vy += (Math.sin(ang) * speed - this.vy) * k;
    const res = moveCircle(game.world, this, this.vx * dt, this.vy * dt, this.moveMode);
    this.speedNow = Math.hypot(this.vx, this.vy);
    if (this.speedNow > 0.1) this.angle = Math.atan2(this.vy, this.vx);
    return res?.hit;
  }
  halt(dt, game) {
    this.vx *= Math.pow(0.01, dt);
    this.vy *= Math.pow(0.01, dt);
    moveCircle(game.world, this, this.vx * dt, this.vy * dt, this.moveMode);
    this.speedNow = Math.hypot(this.vx, this.vy);
  }
  toward(g, speed, dt, game) {
    return this.go(Math.atan2(g.y - this.y, g.x - this.x), speed, dt, game);
  }
  rest(t0, t1) {
    Object.assign(this, { state: 'graze', stateT: rand.range(t0, t1), goal: null });
  }

  update(dt, game) {
    if (this.dead) return;
    const sp = this.spec;
    this.phase += dt * (1 + this.speedNow * 2.2);
    if (this.atkCd > 0) this.atkCd -= dt;
    if ((this.senseT -= dt) <= 0) (this.senseT = 0.25), this.sense(game);
    this.stateT -= dt;
    const t = this.target;
    if (t && (t.state === 'dead' || t.alive === false || t.hidden || Math.hypot(t.x - this.x, t.y - this.y) > 60)) Object.assign(this, { target: null, state: 'wander', goal: null });
    const d = t ? Math.hypot(t.x - this.x, t.y - this.y) : 0;
    switch (this.state) {
      case 'graze':
        this.halt(dt, game);
        if (this.stateT <= 0) Object.assign(this, { state: 'wander', goal: null });
        break;
      case 'wander': {
        const lead = this.pack?.members[0];
        if (lead && lead !== this && !lead.dead) {
          // 무리: 우두머리 곁을 따른다
          const dl = Math.hypot(lead.x - this.x, lead.y - this.y);
          if (dl > 4) this.toward(lead, sp.walk * (dl > 10 ? 2 : 1), dt, game);
          else this.halt(dt, game);
          if (this.stateT <= 0 && dl < 4) this.rest(2, 6);
          break;
        }
        if (!this.goal) this.goal = game.world?.randomPassableNear?.(this.home.x, this.home.y, 15, 'foot') || { x: this.home.x, y: this.home.y };
        const g = this.goal;
        if (Math.hypot(g.x - this.x, g.y - this.y) < 0.8 || this.toward(g, sp.walk, dt, game) || this.stateT < -20) this.rest(3, 9);
        break;
      }
      case 'alert': // 멧돼지: 멀면 노려보다 피해 간다
        this.halt(dt, game);
        if (this.threat) this.angle = Math.atan2(this.threat.y - this.y, this.threat.x - this.x);
        if (this.stateT <= 0) this.fleeFrom(this.threat);
        break;
      case 'investigate': // 범·멧돼지: 총소리 쪽으로
        if (!this.goal || this.stateT <= 0 || Math.hypot(this.goal.x - this.x, this.goal.y - this.y) < 3) this.rest(2, 5);
        else this.toward(this.goal, sp.walk * 1.5, dt, game);
        break;
      case 'flee':
      case 'fly': {
        const th = this.threat || this, fs = this.fleeStart || this.home, w = game.world;
        let ang = Math.atan2(this.y - th.y, this.x - th.x);
        if (sp.temper === 'reed' && w?.T?.REED != null) {
          // 고라니: 가까운 갈대밭 쪽으로
          for (let i = 0; i < 4; i++) {
            const a = ang + (i - 1.5) * 0.5;
            if (w.terrainAt(this.x + Math.cos(a) * 12, this.y + Math.sin(a) * 12) === w.T.REED) {
              ang = a;
              break;
            }
          }
        }
        if (this.go(ang + (this.swerve || 0), sp.run, dt, game)) this.swerve = (this.swerve || 0) + (Math.random() < 0.5 ? 0.9 : -0.9);
        else if (this.swerve) this.swerve *= 0.97;
        const far = Math.hypot(this.x - fs.x, this.y - fs.y) > sp.fleeDist || Math.hypot(this.x - th.x, this.y - th.y) > Math.max(60, sp.sight[0] * 2);
        if (this.stateT <= 0 || (this.state === 'flee' && far)) {
          if (this.state === 'fly') {
            if (w && !w.passable(this.x, this.y, 'foot')) break; // 물·건물 위면 조금 더 난다
            this.moveMode = 'foot';
          }
          this.rest(3, 8);
          Object.assign(this, { home: { x: this.x, y: this.y }, threat: null });
        }
        break;
      }
      case 'charge': // 멧돼지·범 돌진: 정한 방향으로 곧게
        if (this.go(this.dir ?? this.angle, sp.charge || sp.run, dt, game)) this.stateT = 0;
        if (t && this.atkCd <= 0 && d < sp.len / 2 + 0.7) this.strike(t, game);
        if (this.stateT <= 0) Object.assign(this, { state: 'recover', stateT: sp.temper === 'stalker' ? 1.5 : 1.2 });
        break;
      case 'recover':
        this.halt(dt, game);
        if (this.stateT > 0) break;
        if (t && d < 30) sp.temper === 'stalker' ? (this.state = 'stalk') : this.chargeAt(t);
        else Object.assign(this, { state: 'wander', target: null });
        break;
      case 'stalk': // 범: 낮게 다가오다 10 m 안에서 덮친다. 많이 다치면 물러난다
        if (!t) break;
        if (this.hp < sp.hp * 0.25) this.fleeFrom(t);
        else if (d < 10 && this.atkCd <= 0) this.chargeAt(t);
        else this.toward(t, sp.walk, dt, game);
        break;
      case 'circle': {
        // 늑대: 둘러싸고 번갈아 문다. 낮이면 (맞지 않은 한) 물러난다
        if (!t) break;
        if (!isNightHour(game.hour) && !this.hits.length) {
          this.fleeFrom(t);
          break;
        }
        if (this.lunge) {
          this.toward(t, sp.run, dt, game);
          if (d < sp.len / 2 + 0.6) (this.lunge = false), this.strike(t, game);
          else if (d > 14) this.lunge = false;
        } else {
          const a = (this.slot / (this.pack?.members.length || 1)) * Math.PI * 2 + game.time * 0.35;
          const g = { x: t.x + Math.cos(a) * 6, y: t.y + Math.sin(a) * 6 };
          this.toward(g, Math.hypot(g.x - this.x, g.y - this.y) > 2 ? sp.run * 0.6 : sp.walk, dt, game);
          if (this.atkCd <= 0 && Math.random() < dt * 0.8) this.lunge = true;
        }
        break;
      }
      default:
        this.state = 'graze';
    }
  }

  // ---- 그리기 (B.5): 몸통 타원 + 머리 원 + 꼬리 획 + 다리 4획
  draw(ctx) {
    const sp = this.spec, hl = sp.len / 2, hw = sp.wid / 2, ink = PAL.ink;
    const ell = (x, y, rx, ry, fill, stroke) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      if (fill) (ctx.fillStyle = fill), ctx.fill();
      if (stroke) ctx.stroke();
    };
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.dead) {
      // 먹 번짐 + 옆으로 누운 몸 (벗긴 뒤엔 붉은 고깃덩이)
      ctx.rotate(this.deathAngle || 0);
      ell(0.1, 0.05, hl * 1.1 + 0.2, hw + 0.3, 'rgba(70,26,20,0.28)');
      ctx.scale(1, 0.75);
      if (this.skinned) {
        Object.assign(ctx, { strokeStyle: ink, lineWidth: 0.03 });
        ell(0, 0, hl * 0.8, hw * 0.8, '#8a4a3a', true);
        return void ctx.restore();
      }
    } else {
      ctx.rotate(this.angle);
      ell(0.08, 0.1, hl + 0.05, hw + 0.05, 'rgba(29,27,24,0.15)'); // 그림자
    }
    const lw = sp.size === 'S' ? 0.025 : 0.04, run = Math.min(1, this.speedNow / 2.5);
    Object.assign(ctx, { strokeStyle: ink, lineWidth: lw, lineCap: 'round' });
    if (sp.bird && this.state === 'fly') {
      // 날개짓
      const f = Math.sin(this.phase * 6) * 0.5 + 0.5;
      for (const s of [-1, 1]) ell(0, s * (hw + 0.12 * f), 0.12, 0.05 + 0.1 * f, sp.color, true);
    } else {
      // 다리 4획 (말 다리 위상 오프셋을 빌림)
      ctx.beginPath();
      let i = 0;
      for (const fx of [hl * 0.55, -hl * 0.55])
        for (const s of [-1, 1]) {
          const sw = this.dead ? 0.1 : Math.sin(this.phase * 3 + [0.25, 0.75, 0, 0.5][i++] * 6.283) * (0.06 + 0.16 * run) * sp.len;
          ctx.moveTo(fx, s * hw * 0.6);
          ctx.lineTo(fx + sw, s * (hw + 0.1 * sp.len));
        }
      ctx.stroke();
    }
    // 꼬리
    const wag = Math.sin(this.phase * 0.7);
    Object.assign(ctx, { lineWidth: sp.id === 'fox' || sp.id === 'wolf' ? lw * 2.5 : lw * 1.2, strokeStyle: sp.id === 'pheasant' ? '#6a4a2a' : PAL.ink2 });
    ctx.beginPath();
    ctx.moveTo(-hl * 0.9, 0);
    ctx.quadraticCurveTo(-hl - sp.tail * 0.6, wag * 0.06, -hl - sp.tail, Math.sin(this.phase * 0.7 + 1) * sp.tail * 0.25);
    ctx.stroke();
    // 몸통
    Object.assign(ctx, { lineWidth: lw, strokeStyle: ink });
    ell(0, 0, hl, hw, sp.color, true);
    ctx.beginPath();
    if (sp.id === 'tiger') {
      // 먹 줄무늬 9획
      Object.assign(ctx, { strokeStyle: 'rgba(29,27,24,0.85)', lineWidth: 0.045 });
      for (let k = 0; k < 9; k++) {
        const x = -hl * 0.8 + (k * hl * 1.5) / 8, j = ((k * 37) % 5) * 0.012;
        ctx.moveTo(x - 0.04, -hw * 0.9);
        ctx.quadraticCurveTo(x + 0.06 + j, 0, x - 0.02, hw * 0.9);
      }
      ctx.stroke();
    } else if (sp.id === 'pheasant') ell(hl * 0.6, 0, 0.06, 0.06, '#3f6a5a');
    else if (sp.id === 'boar') {
      // 등갈기
      ctx.lineWidth = 0.05;
      ctx.moveTo(-hl * 0.6, 0);
      ctx.lineTo(hl * 0.6, 0);
      ctx.stroke();
    }
    // 머리
    const hr = sp.head, hx = hl + hr * 0.55;
    Object.assign(ctx, { strokeStyle: ink, lineWidth: lw });
    ell(hx, 0, hr, hr, sp.id === 'boar' ? '#3a312a' : sp.color, true);
    // 주둥이·엄니·뺨·송곳니
    if (sp.id === 'wolf' || sp.id === 'fox') {
      ctx.beginPath();
      ctx.moveTo(hx + hr * 0.6, -hr * 0.5);
      ctx.lineTo(hx + hr * 1.9, 0);
      ctx.lineTo(hx + hr * 0.6, hr * 0.5);
      ctx.fillStyle = sp.color;
      ctx.fill();
      ctx.stroke();
    } else if (sp.id === 'boar') {
      ell(hx + hr * 1.1, 0, hr * 0.5, hr * 0.6, '#3a312a', true);
      this.tusks(ctx, hx, hr, 0.9, 1.3, 0.6, 0.9, '#efeadf', lw);
    } else if (sp.id === 'pheasant') ell(hx + 0.01, 0, 0.03, 0.03, PAL.seal); // 붉은 뺨
    if (sp.fangs) this.tusks(ctx, hx, hr, 0.5, 1.3, 0.35, 0.55, '#f3eee2', 0.025); // 고라니 송곳니: 흰 획 2개
    // 귀
    if (sp.size !== 'S' || sp.id === 'fox') for (const s of [-1, 1]) ell(hx - hr * 0.3, s * hr * 0.75, hr * 0.28, hr * 0.28, PAL.ink2);
    ctx.lineCap = 'butt';
    ctx.restore();
  }
  tusks(ctx, hx, hr, x0, x1, y0, y1, color, w) {
    Object.assign(ctx, { strokeStyle: color, lineWidth: w });
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(hx + hr * x0, s * hr * y0);
      ctx.lineTo(hx + hr * x1, s * hr * y1);
    }
    ctx.stroke();
  }
}

export function install(game) {
  GAME = game;
  const list = [], packs = new Set();
  let howlT = 30;

  function spawn(speciesId, x, y, opts = {}) {
    const spec = SPECIES[speciesId];
    if (!spec) return null;
    const a = game.add(new Animal(spec, x, y, opts));
    list.push(a);
    return a;
  }
  function spawnPack(speciesId, x, y, n, opts = {}) {
    const spec = SPECIES[speciesId];
    if (!spec) return [];
    n = n ?? rand.int(spec.group[0], spec.group[1]);
    const pack = n > 1 ? { members: [], target: null, species: speciesId } : null, out = [];
    for (let i = 0; i < n; i++) {
      const p = i === 0 ? { x, y } : game.world?.randomPassableNear?.(x, y, 4 + n, 'foot') || { x: x + rand.range(-3, 3), y: y + rand.range(-3, 3) };
      const a = spawn(speciesId, p.x, p.y, { ...opts, pack, slot: i });
      if (pack) pack.members.push(a);
      out.push(a);
    }
    if (pack) packs.add(pack);
    return out;
  }
  /** 소리에 반응: 겁 많은 짐승은 달아나고, 범·멧돼지는 50% 소리 쪽으로 */
  function alert(x, y, r = 60) {
    for (const a of list) {
      if (a.dead || a._removed || a.target || a.state === 'flee' || a.state === 'fly' || Math.hypot(a.x - x, a.y - y) > r) continue;
      const t = a.spec.temper;
      if ((t === 'charge' || t === 'stalker') && Math.random() < 0.5) Object.assign(a, { state: 'investigate', stateT: 25, goal: { x, y } });
      else a.fleeFrom({ x, y });
    }
  }
  game.on('shot', (e) => {
    const x = e.x ?? e.shooter?.x, y = e.y ?? e.shooter?.y, w = game.sys.time?.weather;
    if (Number.isFinite(x)) alert(x, y, (e.noise ?? 100) * (w === 'rain' ? 0.6 : w === 'storm' ? 0.5 : 1), 'shot');
  });

  const sys = {
    name: 'animals',
    order: 22,
    SPECIES,
    spawn,
    spawnPack,
    alert,
    activeNow,
    list: () => list.filter((a) => !a._removed),
    update(dt) {
      let w = 0;
      for (const a of list) if (!a._removed) list[w++] = a;
      list.length = w;
      // 밤 늑대 울음 (멀리서)
      if ((howlT -= dt) > 0) return;
      howlT = rand.range(40, 90);
      const p = game.player;
      for (const pk of packs) {
        const l = pk.members.find((m) => !m.dead && !m._removed);
        if (!l) packs.delete(pk);
        else if (pk.species === 'wolf' && isNightHour(game.hour) && p && Math.hypot(l.x - p.x, l.y - p.y) < 300) return void game.sfx?.('wolf', { x: l.x, y: l.y });
      }
    },
  };
  game.registerSystem(sys);
  return sys;
}
