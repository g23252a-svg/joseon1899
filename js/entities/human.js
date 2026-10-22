// 사람(플레이어·NPC 공통). 이동, 체력·기력, 넘어짐/죽음, 탈것 좌석, 위에서 본 모습 그리기.
// NPC 의 '두뇌'는 this.brain = { update(human, dt, game) } 으로 붙인다 (entities/npc.js).

import { Entity, LAYER } from '../engine/entity.js';
import { moveCircle } from '../engine/physics.js';
import { angleApproach, clamp, damp, lerp, rand } from '../engine/util.js';
import { FACTION_COLOR, PAL } from '../engine/palette.js';

/** 신분·역할별 기본 옷차림 (스펙 B.3). 세력은 옷 전체가 아니라 작은 강조(띠·두건·완장)로만 구분한다. */
export const LOOKS = {
  player: { coat: '#d9d2bf', trim: '#3b3a36', hat: 'dugeon', hem: '#2f4a7a' }, // 한길: gang 두건 + 쪽빛 두루마기 끝선
  villager: { coat: '#ece6d6', trim: '#8a8172', hat: 'topknot' },
  woman: { coat: '#efe9dc', trim: '#9b4a3c', hat: 'jangot', gender: 'f' },
  child: { coat: '#ebe4d2', trim: '#8a8172', hat: 'braid', child: true },
  yangban: { coat: '#d8e3dc', trim: '#2c3e50', hat: 'gat' },
  clerk: { coat: '#d8e3dc', trim: '#4a453d', hat: 'gat' },
  merchant: { coat: '#c9b48a', trim: '#5a4630', hat: 'topknot' },
  peddler: { coat: '#ece6d6', trim: '#6c6252', hat: 'paeraengi' },
  porter: { coat: '#d8cfba', trim: '#6c6252', hat: 'headband', jige: true },
  worker: { coat: '#cfc5ae', trim: '#6c6252', hat: 'headband' },
  monk: { coat: '#9a958a', trim: '#5c5850', hat: 'none', hair: '#3a3632' },
  sungeom: { coat: '#2b2d33', trim: '#b08d3c', hat: 'cap', buttons: true },
  chongsun: { coat: '#2b2d33', trim: '#b08d3c', hat: 'cap', buttons: true },
  jogye_police: { coat: '#2b2d33', trim: '#b08d3c', hat: 'cap', buttons: true },
  soldier: { coat: '#2c3550', trim: '#a8322a', hat: 'armycap' },
  gwanbyeong: { coat: '#3d4a5a', trim: '#a8322a', hat: 'jeonrip' },
  militia: { coat: '#e6dfcc', trim: '#6c6252', hat: 'headband' },
  bandit: { coat: '#8a7f62', trim: '#2a2520', hat: 'headband' },
  bandit_boss: { coat: '#6f6550', trim: '#2a2520', hat: 'headband' },
  pirate: { coat: '#8a7f62', trim: '#2a2520', hat: 'towel' },
  bounty_hunter: { coat: '#4a3a2c', trim: '#2a2520', hat: 'satgat' },
  rail_guard: { coat: '#25324a', trim: '#2e757a', hat: 'jeonrip' },
  hunter: { coat: '#d8cfba', trim: '#6c6252', hat: 'topknot', vest: '#7a5a3c', ember: true },
  gang: { coat: '#b8a888', trim: '#5a4630', hat: 'dugeon' },
  foreigner: { coat: '#3b3530', trim: '#cfc6b0', hat: 'western' },
};
// 외국인 문화 표지는 하나만 (희화화 금지: 얼굴·체형·피부색은 같게)
const MARK_LOOK = { western: { coat: '#3b3530', hat: 'western' }, jp: { coat: '#34405a', hat: 'jpcollar' }, cn: { coat: '#3a3f4a', hat: 'queue' } };
const BASE = { hair: '#1c1a17', skin: '#d4ab82', gender: 'm' };

export function makeLook(role = 'villager', overrides = {}) {
  const base = LOOKS[role] || LOOKS.villager;
  const look = { ...BASE, ...base };
  if (role === 'foreigner') Object.assign(look, MARK_LOOK[overrides.mark] || MARK_LOOK.western);
  if (role === 'rail_guard' && overrides.mark === 'jp') look.hat = 'cap';
  Object.assign(look, overrides);
  // 흰옷도 조금씩 다르게
  if (!overrides.coat && (role === 'villager' || role === 'porter' || role === 'militia')) look.coat = shade(look.coat, rand.int(-10, 6));
  return look;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export const INK = '#1d1b18';
let PXM = 0.05; // 화면 1px 의 미터 (그릴 때 갱신)
// 머리 표지가 이미 세력색을 띠는 모자 (완장 생략)
const HEAD_ACC = new Set(['dugeon', 'headband', 'towel', 'armycap', 'satgat', 'jeonrip', 'cap']);
/** 먹선 테두리 캡슐 (팔) */
function capsule(ctx, ax, ay, bx, by, r, fill) {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = INK;
  ctx.lineWidth = r * 2 + 0.035;
  ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = r * 2;
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.035;
}
function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

export class Human extends Entity {
  constructor(opts = {}) {
    super({ radius: 0.33, mass: 1, hp: opts.hp ?? 100, ...opts });
    this.kind = 'human';
    this.role = opts.role || 'villager';
    this.faction = opts.faction || 'civilian'; // civilian | police | army | gang(플레이어 무리) | rival(화적) | foreign
    this.name = opts.name || '행인';
    this.look = opts.look || makeLook(this.role);
    this.maxStamina = opts.stamina ?? 100;
    this.stamina = this.maxStamina;

    // 이동 능력 (m/s)
    this.speedWalk = opts.speedWalk ?? 1.5;
    this.speedRun = opts.speedRun ?? 3.8;
    this.speedSprint = opts.speedSprint ?? 5.6;
    this.speedCrouch = 1.0;
    this.speedSwim = 1.1;
    this.speedSwimFast = 1.6;
    this.speedSwimExhausted = 0.6;
    this.rollT = 0; // 구르기 남은 시간
    this.rollVX = 0;
    this.rollVY = 0;
    this._drownAcc = 0;
    this.accel = 16;

    // 제어 입력 (플레이어 컨트롤러나 NPC 두뇌가 채운다)
    this.moveX = 0; // 원하는 이동 방향 (-1..1)
    this.moveY = 0;
    this.gait = 'walk'; // walk | run | sprint
    this.crouching = false;
    this.aiming = false; // true 면 몸을 aimAngle 로 돌림
    this.aimAngle = 0;

    this.state = 'normal'; // normal | down | dead
    this.downT = 0;
    this.swimming = false;
    this.moveMode = 'foot';
    this.vehicle = null;
    this.seatIndex = -1;
    this.seatPose = null; // 탈것이 정해줌: ride | sit | stand | row | pull | carry | hidden
    this.walkPhase = Math.random() * 6;
    this.speedNow = 0;
    this.brain = opts.brain || null;
    this.weapon = null; // combat 시스템이 채움: {id, kind:'melee'|'gun'|'bow', ...}
    this.carry = null; // 어깨에 멘 것 (사냥감 등) {kind, draw?}
    this.hitFlash = 0;
    this.speech = null; // {text, t} 말풍선
    this.dialog = opts.dialog || null; // 대화 데이터 id
    this.shop = opts.shop || null; // 상점 id
    this.home = opts.home || { x: this.x, y: this.y };
    this.isPlayer = false;
  }

  get alivePerson() {
    return this.state !== 'dead';
  }

  update(dt, game) {
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.speech && (this.speech.t -= dt) <= 0) this.speech = null;
    if (this.state === 'dead') {
      this.vx *= 0.8;
      this.vy *= 0.8;
      return;
    }
    if (this.vehicle) {
      // 위치는 탈것이 잡아준다. 기력만 회복.
      this.stamina = Math.min(this.maxStamina, this.stamina + 8 * dt);
      this.vx = this.vehicle.vx;
      this.vy = this.vehicle.vy;
      this.brain?.update?.(this, dt, game);
      return;
    }
    if (this.state === 'down') {
      this.downT -= dt;
      this.vx *= Math.pow(0.02, dt);
      this.vy *= Math.pow(0.02, dt);
      moveCircle(game.world, this, this.vx * dt, this.vy * dt, this.moveMode);
      if (this.downT <= 0) this.state = 'normal';
      return;
    }
    this.brain?.update?.(this, dt, game);
    this.locomotion(dt, game);
  }

  /** moveX/moveY/gait 를 실제 속도로 바꾼다 */
  locomotion(dt, game) {
    const w = game.world;
    const deep = w?.isDeepWater?.(this.x, this.y) ?? false;
    this.swimming = deep;
    this.moveMode = deep ? 'swim' : 'foot';

    let mx = this.moveX, my = this.moveY;
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }
    // 구르기: 0.45초 동안 1.8 m 를 정해진 방향으로 (조작 무시)
    if (this.rollT > 0) {
      this.rollT -= dt;
      this.vx = this.rollVX;
      this.vy = this.rollVY;
      moveCircle(w, this, this.vx * dt, this.vy * dt, this.moveMode);
      this.speedNow = Math.hypot(this.vx, this.vy);
      this.walkPhase += this.speedNow * dt * 3.2;
      return;
    }
    let speed = this.speedWalk;
    const fastSwim = this.swimming && this.gait === 'sprint' && this.stamina > 1;
    if (this.swimming) speed = this.stamina <= 0.5 ? this.speedSwimExhausted : fastSwim ? this.speedSwimFast : this.speedSwim;
    else if (this.crouching) speed = this.speedCrouch;
    else if (this.gait === 'sprint' && this.stamina > 1) speed = this.speedSprint;
    else if (this.gait === 'run') speed = this.speedRun;
    speed *= this.speedMul ?? 1;
    if (w?.speedMul) speed *= w.speedMul(this.x, this.y, this.moveMode);
    if (this.aiming && !this.swimming) speed = Math.min(speed, this.speedWalk * 1.1);

    const tvx = mx * speed, tvy = my * speed;
    const k = damp(this.accel / Math.max(1, speed), dt) * 1.0;
    this.vx = lerp(this.vx, tvx, Math.min(1, k * 4));
    this.vy = lerp(this.vy, tvy, Math.min(1, k * 4));
    moveCircle(w, this, this.vx * dt, this.vy * dt, this.moveMode);
    this.speedNow = Math.hypot(this.vx, this.vy);

    // 기력
    const moving = Math.hypot(mx, my) > 0.1;
    const sprinting = this.gait === 'sprint' && moving && !this.crouching;
    if (this.swimming) {
      // 헤엄: 기본 −1/s, 빠른 헤엄 −5/s, 기력이 바닥나면 익사 피해 −4/s
      this.stamina = Math.max(0, this.stamina - (fastSwim && moving ? 5 : 1.0) * dt * (this.staminaDrainMul ?? 1));
      if (this.stamina <= 0) {
        this._drownAcc += dt;
        if (this._drownAcc >= 0.5) {
          this._drownAcc -= 0.5;
          this.damage(2, { kind: 'drown', source: null, x: this.x, y: this.y }, game);
        }
      } else this._drownAcc = 0;
    } else if (sprinting) this.stamina = Math.max(0, this.stamina - 11 * dt * (this.staminaDrainMul ?? 1));
    else this.stamina = Math.min(this.maxStamina, this.stamina + (this.speedNow < 0.2 ? 14 : 8) * dt * (this.staminaRegenMul ?? 1));

    // 몸 방향
    if (this.aiming) this.angle = angleApproach(this.angle, this.aimAngle, 14 * dt);
    else if (this.speedNow > 0.15) this.angle = angleApproach(this.angle, Math.atan2(this.vy, this.vx), 10 * dt);
    this.walkPhase += this.speedNow * dt * 3.2;
  }

  /** 구르기: 기력 12, 0.45초에 1.8 m. 성공하면 true */
  roll(dirX, dirY) {
    if (this.state !== 'normal' || this.vehicle || this.swimming || this.rollT > 0 || this.stamina < 12) return false;
    let d = Math.hypot(dirX, dirY);
    if (d < 0.1) {
      dirX = Math.cos(this.angle);
      dirY = Math.sin(this.angle);
      d = 1;
    }
    this.rollT = 0.45;
    this.rollVX = (dirX / d) * 4;
    this.rollVY = (dirY / d) * 4;
    this.stamina -= 12;
    this.crouching = false;
    return true;
  }

  /** 넘어뜨리기 (말에 치임, 주먹 등) */
  knockDown(dirX, dirY, power = 4, time = 1.6) {
    if (this.state === 'dead' || this.vehicle) return;
    this.state = 'down';
    this.downT = time;
    this.vx = dirX * power;
    this.vy = dirY * power;
  }

  damage(amount, info = {}, game) {
    if (this.state === 'dead') return;
    amount *= this.damageTakenMul ?? 1;
    this.hp -= amount;
    this.hitFlash = 0.15;
    game?.events.emit('damage', { target: this, amount, ...info });
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(info, game);
    }
  }

  die(info = {}, game) {
    if (this.state === 'dead') return;
    if (this.vehicle) this.vehicle.exit(this, game, { force: true });
    this.state = 'dead';
    this.solid = false;
    this.layer = LAYER.LOW;
    this.speech = null;
    this.deathAngle = this.angle + (Math.random() - 0.5) * 0.8;
    game?.events.emit('kill', { victim: this, killer: info.source || null, info });
  }

  revive(hp = this.maxHp) {
    this.state = 'normal';
    this.hp = hp;
    this.solid = true;
    this.layer = LAYER.ENTITY;
  }

  say(text, seconds = 3) {
    this.speech = { text, t: seconds };
  }

  // ------------------------------------------------------------ 그리기 (위에서 본 모습, 스펙 B.3·B.5)

  draw(ctx, game) {
    PXM = 1 / (game.camera?.zoom || 20);
    if (this.vehicle && this.seatPose !== 'carry') return; // 탈것이 drawSeated 로 그림
    if (this.state === 'dead') return this.drawDead(ctx);
    const down = this.state === 'down';
    ctx.save();
    ctx.translate(this.x, this.y);
    // 그림자 (북서 광원 → 남동쪽)
    ctx.fillStyle = 'rgba(29,27,24,0.15)';
    ctx.beginPath();
    ctx.ellipse(0.1, 0.13, 0.34, 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.swimming) {
      ctx.strokeStyle = 'rgba(240,240,235,0.7)';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(0, 0, 0.45 + Math.sin(game.time * 4) * 0.05, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.rotate(down ? this.angle + Math.PI / 2 : this.angle);
    if (down) ctx.scale(1.25, 0.8);
    this.drawBody(ctx, this.walkPhase, this.swimming ? 'swim' : this.crouching ? 'crouch' : 'stand');
    ctx.restore();
    if (this.hostile && !down) this.drawSeal(ctx, this.x, this.y);
    if (this.speech) this.drawSpeech(ctx, game);
  }

  /** 적대: 머리 위 붉은 사각 낙관 0.3 m (색맹 대응 — 색이 아니라 모양). (cx, cy) = 사람 중심 */
  drawSeal(ctx, cx, cy) {
    const x = cx - 0.15, y = cy - 0.95;
    ctx.fillStyle = 'rgba(168,50,42,0.92)';
    ctx.fillRect(x, y, 0.3, 0.3);
    ctx.strokeStyle = '#efe6d2';
    ctx.lineWidth = 0.025;
    ctx.strokeRect(x + 0.04, y + 0.04, 0.22, 0.22);
    ctx.beginPath();
    ctx.moveTo(x + 0.09, y + 0.11);
    ctx.lineTo(x + 0.21, y + 0.11);
    ctx.moveTo(x + 0.15, y + 0.08);
    ctx.lineTo(x + 0.15, y + 0.23);
    ctx.stroke();
  }

  /** 원점 기준, +x 가 정면. pose: stand | crouch | swim | ride | sit | row | pull | carry */
  drawBody(ctx, phase = 0, pose = 'stand') {
    const L = this.look;
    const flash = this.hitFlash > 0;
    const coat = flash ? '#d8735c' : L.coat;
    const acc = FACTION_COLOR[this.faction] || null;
    const k = L.child ? 0.7 : 1;
    ctx.save();
    if (k !== 1) ctx.scale(k, k);
    const walking = pose === 'stand' || pose === 'crouch' || pose === 'pull' || pose === 'carry';
    const sw = walking ? Math.sin(phase) * Math.min(1, this.speedNow / 1.4) : 0;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.035;
    // 발 0.13×0.09, 보폭 ±0.18 m
    if (walking && Math.abs(sw) > 0.05) {
      ctx.fillStyle = PAL.ink2;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(0.04 + sw * s * 0.18, s * 0.1, 0.065, 0.045, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 지게(지게꾼): 등 뒤 두 가지
    if (L.jige) {
      ctx.strokeStyle = PAL.timber;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        ctx.moveTo(-0.12, s * 0.15);
        ctx.lineTo(-0.5, s * 0.2);
      }
      ctx.moveTo(-0.42, -0.2);
      ctx.lineTo(-0.42, 0.2);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.035;
    }
    // 팔 0.32 캡슐, 걸음에 따라 ±25°
    const aim = this.aiming && pose !== 'row';
    for (const s of [-1, 1]) {
      let ax, ay, bx, by;
      if (aim) [ax, ay, bx, by] = [0.02, s * 0.2, 0.3, s * 0.05];
      else if (this.handsUp) [ax, ay, bx, by] = [0.02, s * 0.22, 0.14, s * 0.48];
      else if (pose === 'row') [ax, ay, bx, by] = [0.02, s * 0.22, 0.24 + Math.sin(phase) * 0.12, s * 0.14];
      else if (pose === 'pull' || pose === 'carry') [ax, ay, bx, by] = [0.02, s * 0.22, 0.32, s * 0.2];
      else {
        // 소매가 앞뒤로 흔들린다 (어깨 기준 ±25°를 위에서 본 모양)
        ax = 0.1 + sw * s * 0.11;
        ay = s * 0.215;
        bx = ax - 0.3;
        by = ay + s * (0.03 + Math.abs(sw) * 0.05);
      }
      capsule(ctx, ax, ay, bx, by, 0.065, coat);
      // 완장: 세력 강조 (두건·머리띠·수건을 쓰는 세력은 머리에)
      if (acc && s < 0 && !HEAD_ACC.has(L.hat) && !this.isPlayer) {
        ctx.strokeStyle = acc;
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.moveTo(lerp(ax, bx, 0.35), lerp(ay, by, 0.35) - 0.05);
        ctx.lineTo(lerp(ax, bx, 0.35), lerp(ay, by, 0.35) + 0.05);
        ctx.stroke();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.035;
      }
    }
    // 몸통 타원 0.19×0.30 (앞뒤×어깨)
    const cr = pose === 'crouch' ? 0.86 : 1;
    ctx.beginPath();
    ctx.ellipse(-0.03, 0, 0.19 * cr, 0.3 * cr, 0, 0, Math.PI * 2);
    ctx.fillStyle = coat;
    ctx.fill();
    ctx.stroke();
    if (L.vest) {
      ctx.fillStyle = L.vest;
      ctx.beginPath();
      ctx.ellipse(-0.08, 0, 0.12 * cr, 0.24 * cr, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // 두루마기 끝선 (플레이어: 쪽빛 2 px)
    if (L.hem) {
      ctx.strokeStyle = L.hem;
      ctx.lineWidth = Math.max(0.05, 2 * PXM);
      ctx.beginPath();
      ctx.ellipse(-0.03, 0, 0.19 * cr - 0.02, 0.3 * cr - 0.02, 0, Math.PI * 0.55, Math.PI * 1.45);
      ctx.stroke();
    }
    // 옷깃(동정)
    ctx.strokeStyle = L.trim;
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    ctx.moveTo(0.07, -0.12);
    ctx.lineTo(0.14, 0.05);
    ctx.stroke();
    if (L.buttons) {
      ctx.fillStyle = PAL.gold;
      for (const t of [-0.1, 0, 0.1]) {
        ctx.beginPath();
        ctx.arc(0.13, t, 0.022, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.035;
    // 머리 r 0.11
    ctx.beginPath();
    ctx.arc(0.02, 0, 0.11, 0, Math.PI * 2);
    ctx.fillStyle = L.hair;
    ctx.fill();
    this.drawHat(ctx, L, acc);
    // 무기: 겨누면 앞으로, 아니면 총·활은 등에 비스듬히, 칼·몽둥이는 허리에
    const w = this.weapon;
    if (w && w.kind !== 'fist' && w.kind !== 'throw') {
      ctx.strokeStyle = w.color || '#3a2a1a';
      ctx.lineWidth = w.kind === 'gun' ? 0.06 : 0.045;
      ctx.beginPath();
      const len = w.length || 0.7;
      if (aim || w.alwaysShow) {
        ctx.moveTo(0.18, 0.08);
        ctx.lineTo(0.18 + len, 0.08);
      } else if (w.kind === 'gun' || w.kind === 'bow') {
        ctx.moveTo(-0.18 - len * 0.45, -0.22);
        ctx.lineTo(-0.18 + len * 0.5, 0.2);
      } else {
        ctx.moveTo(-0.15, 0.26);
        ctx.lineTo(-0.15 - len * 0.6, 0.3);
      }
      ctx.stroke();
    }
    if (this.carry) {
      ctx.fillStyle = this.carry.color || '#7a5a3a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.ellipse(-0.1, 0, 0.18, 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHat(ctx, L, acc) {
    const disc = (x, y, r, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const ring = (r, col, w) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(0.02, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    };
    const knot = () => disc(-0.01, 0, 0.045, '#100e0b'); // 상투
    switch (L.hat) {
      case 'gat': // 갓: 넓은 반투명 챙 + 검은 모정
        disc(0.02, 0, 0.3, 'rgba(25,22,20,0.32)');
        ring(0.3, INK, 0.025);
        disc(0.02, 0, 0.1, '#16140f');
        break;
      case 'satgat': // 삿갓 (현상금 사냥꾼)
        disc(0.02, 0, 0.32, '#b39a62');
        ring(0.32, INK, 0.025);
        ring(0.2, PAL.ink2, 0.012);
        if (acc) ring(0.08, acc, 0.04);
        break;
      case 'paeraengi': // 패랭이 + 양옆 목화송이 (보부상)
        disc(0.02, 0, 0.21, PAL.peddlerHat);
        ring(0.21, INK, 0.025);
        disc(0.02, 0.2, 0.055, '#f3eee2');
        disc(0.02, -0.2, 0.055, '#f3eee2');
        break;
      case 'cap': // 제모 (순검·일본인 경비) — 밑에 상투 또는 단발
        if (L.hairStyle !== 'short') disc(-0.1, 0, 0.04, '#100e0b');
        disc(0.02, 0, 0.14, '#1f2433');
        ctx.fillRect(0.1, -0.08, 0.09, 0.16);
        if (acc) ring(0.1, acc, 0.025);
        break;
      case 'armycap': // 군모 + 붉은 띠
        disc(0.02, 0, 0.14, '#232a40');
        ring(0.12, acc || PAL.seal, 0.035);
        ctx.fillStyle = '#232a40';
        ctx.fillRect(0.1, -0.08, 0.09, 0.16);
        break;
      case 'jeonrip': // 전립 (상투 위)
        disc(0.02, 0, 0.22, '#2a2826');
        ring(0.22, INK, 0.02);
        disc(0.02, 0, 0.09, '#3a3632');
        if (acc) ring(0.15, acc, 0.03);
        break;
      case 'western': // 서양 모자
        disc(0.02, 0, 0.2, '#2a2628');
        disc(0.02, 0, 0.12, '#3d383a');
        break;
      case 'jpcollar': // 일본식 깃: 목 둘레 V 깃
        ctx.strokeStyle = '#e6dfcf';
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        ctx.moveTo(-0.06, -0.16);
        ctx.lineTo(0.1, 0);
        ctx.lineTo(-0.06, 0.16);
        ctx.stroke();
        break;
      case 'queue': // 변발: 뒤로 늘인 땋은 머리
        ctx.strokeStyle = '#100e0b';
        ctx.lineWidth = 0.045;
        ctx.beginPath();
        ctx.moveTo(-0.08, 0);
        ctx.quadraticCurveTo(-0.25, 0.04, -0.36, -0.02);
        ctx.stroke();
        break;
      case 'dugeon': // 두건 (활빈패): 세력색 천 + 뒤로 늘어진 끈
        disc(0.02, 0, 0.125, acc || PAL.ink2);
        ctx.strokeStyle = acc || PAL.ink2;
        ctx.lineWidth = 0.035;
        ctx.beginPath();
        ctx.moveTo(-0.09, 0.02);
        ctx.lineTo(-0.24, 0.07);
        ctx.moveTo(-0.09, -0.02);
        ctx.lineTo(-0.22, -0.08);
        ctx.stroke();
        break;
      case 'towel': // 수건 (수적)
        disc(0.02, 0, 0.12, '#cfc6ae');
        ring(0.115, acc || L.trim, 0.04);
        break;
      case 'headband': // 머리띠 + 상투
        ring(0.11, acc || L.trim, 0.04);
        knot();
        break;
      case 'jangot': // 장옷(쓰개)
        ctx.fillStyle = PAL.jangot;
        ctx.beginPath();
        ctx.ellipse(-0.03, 0, 0.18, 0.17, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'braid': // 댕기머리 (아이)
        ctx.strokeStyle = '#100e0b';
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        ctx.moveTo(-0.08, 0);
        ctx.lineTo(-0.26, 0);
        ctx.stroke();
        disc(-0.27, 0, 0.025, PAL.seal);
        break;
      case 'topknot':
        knot();
        break;
      default:
        break;
    }
    if (L.ember) disc(-0.2, 0.12, 0.025, '#e0702a'); // 화승 불씨
  }

  drawDead(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // 먹 번짐 웅덩이 (id 시드로 고정)
    const sd = this._seed ?? (this._seed = hashStr(this.id));
    ctx.fillStyle = 'rgba(52,26,20,0.2)';
    for (let i = 0; i < 4; i++) {
      const a = sd * 6.283 + i * 1.7, r = 0.18 + ((sd * (i + 3) * 7.13) % 1) * 0.22;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 0.25, Math.sin(a) * 0.2, r + 0.15, r, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.rotate(this.deathAngle ?? this.angle);
    ctx.scale(1.3, 0.85);
    ctx.rotate(Math.PI / 2);
    const fl = this.hitFlash;
    this.hitFlash = 0;
    this.drawBody(ctx, 0, 'ride');
    this.hitFlash = fl;
    ctx.restore();
    if (this.looted) {
      ctx.fillStyle = 'rgba(29,27,24,0.5)';
      ctx.beginPath();
      ctx.arc(this.x + 0.4, this.y - 0.4, 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 탈것이 부르는 좌석 그리기 (ctx 는 이미 좌석 위치·방향으로 변환됨) */
  drawSeated(ctx, game, pose = 'sit') {
    if (pose === 'hidden') return;
    this.drawBody(ctx, this.walkPhase, pose);
    if (this.hostile) {
      // 좌석 회전을 되돌려 낙관을 화면 위쪽에 세운다
      const v = this.vehicle, rot = this.aiming ? this.aimAngle : (v?.angle || 0) + (v?.seats?.[this.seatIndex]?.facing || 0);
      ctx.save();
      ctx.rotate(-rot);
      this.drawSeal(ctx, 0, 0);
      ctx.restore();
    }
    if (this.speech) this.drawSpeech(ctx, game);
  }

  drawSpeech(ctx, game) {
    const cam = game.camera;
    const s = cam.worldToScreen(this.x, this.y - 0.9);
    ctx.save();
    cam.applyScreen(ctx);
    ctx.font = '15px "Gowun Batang", serif';
    const text = this.speech.text;
    const w = Math.min(260, ctx.measureText(text).width + 16);
    ctx.fillStyle = 'rgba(246,240,226,0.94)';
    ctx.strokeStyle = 'rgba(29,27,24,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect?.(s.x - w / 2, s.y - 30, w, 24, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, s.x, s.y - 18, 250);
    ctx.restore();
  }
}
