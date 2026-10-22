// 사람(플레이어·NPC 공통). 이동, 체력·기력, 넘어짐/죽음, 탈것 좌석, 위에서 본 모습 그리기.
// NPC 의 '두뇌'는 this.brain = { update(human, dt, game) } 으로 붙인다 (entities/npc.js).

import { Entity, LAYER } from '../engine/entity.js';
import { moveCircle } from '../engine/physics.js';
import { angleApproach, clamp, damp, lerp, rand } from '../engine/util.js';

/** 신분·역할별 기본 옷차림. 색은 docs 팔레트 기준(흰옷이 기본). */
export const LOOKS = {
  player: { coat: '#d9d2bf', trim: '#3b3a36', hat: 'gat', hair: '#1c1a17', skin: '#d8b48c' },
  villager: { coat: '#ece6d6', trim: '#8a8172', hat: 'topknot', hair: '#1c1a17', skin: '#d6ae86' },
  woman: { coat: '#efe9dc', trim: '#9b4a3c', hat: 'jangot', hair: '#1c1a17', skin: '#dcb892', gender: 'f' },
  yangban: { coat: '#e8efe9', trim: '#2c3e50', hat: 'gat', hair: '#1c1a17', skin: '#dcb892' },
  merchant: { coat: '#c9b48a', trim: '#5a4630', hat: 'paeraengi', hair: '#1c1a17', skin: '#cfa47a' },
  sungeom: { coat: '#2b3245', trim: '#b8a26a', hat: 'cap', hair: '#1c1a17', skin: '#d4ab82' }, // 순검: 검은 양복 제복
  soldier: { coat: '#3a4a3a', trim: '#a33b2c', hat: 'cap', hair: '#1c1a17', skin: '#d4ab82' },
  bandit: { coat: '#6b5b45', trim: '#2a2520', hat: 'headband', hair: '#1c1a17', skin: '#c99d72' },
  gang: { coat: '#a8a08a', trim: '#7a2e24', hat: 'headband', hair: '#1c1a17', skin: '#cfa47a' },
  foreigner: { coat: '#3d3a40', trim: '#cfc6b0', hat: 'western', hair: '#7a5a3a', skin: '#e8c8a8' },
  porter: { coat: '#d8cfba', trim: '#6c6252', hat: 'headband', hair: '#1c1a17', skin: '#c99d72' },
  monk: { coat: '#9a958a', trim: '#5c5850', hat: 'none', hair: '#3a3632', skin: '#d4ab82' },
};

export function makeLook(role = 'villager', overrides = {}) {
  const base = LOOKS[role] || LOOKS.villager;
  const look = { gender: 'm', ...base, ...overrides };
  // 흰옷도 조금씩 다르게
  if (!overrides.coat && (role === 'villager' || role === 'porter')) {
    const v = rand.int(-10, 6);
    look.coat = shade(look.coat, v);
  }
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

  // ------------------------------------------------------------ 그리기 (위에서 본 모습)

  draw(ctx, game) {
    if (this.vehicle && this.seatPose !== 'carry') return; // 탈것이 drawSeated 로 그림
    if (this.state === 'dead') return this.drawDead(ctx);
    const down = this.state === 'down';
    ctx.save();
    ctx.translate(this.x, this.y);
    // 그림자
    ctx.fillStyle = 'rgba(30,25,20,0.18)';
    ctx.beginPath();
    ctx.ellipse(0.08, 0.1, 0.36, 0.3, 0, 0, Math.PI * 2);
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
    if (this.speech) this.drawSpeech(ctx, game);
  }

  /** 원점 기준, +x 가 정면. pose: stand | crouch | swim | ride | sit | row | pull | carry */
  drawBody(ctx, phase = 0, pose = 'stand') {
    const L = this.look;
    const flash = this.hitFlash > 0;
    const swing = pose === 'stand' || pose === 'pull' || pose === 'carry' ? Math.sin(phase) * 0.16 * Math.min(1, this.speedNow / 2 + 0.2) : 0;
    ctx.lineWidth = 0.045;
    ctx.strokeStyle = INK;
    // 팔 (흔들림)
    ctx.fillStyle = flash ? '#c8553d' : L.coat;
    const armY = 0.24;
    const armFx = pose === 'row' ? 0.18 + Math.sin(phase) * 0.12 : pose === 'pull' ? 0.3 : 0.05;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(armFx + swing * s, s * armY, 0.17, 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // 몸통 (어깨 타원) — 도포/두루마기 자락
    const crouch = pose === 'crouch' ? 0.85 : 1;
    ctx.beginPath();
    ctx.ellipse(-0.04, 0, 0.2 * crouch, 0.28 * crouch, 0, 0, Math.PI * 2);
    ctx.fillStyle = flash ? '#d8735c' : L.coat;
    ctx.fill();
    ctx.stroke();
    // 옷깃(동정) 선
    ctx.strokeStyle = L.trim;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(0.06, -0.12);
    ctx.lineTo(0.13, 0.06);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.045;
    // 머리
    ctx.beginPath();
    ctx.arc(0.02, 0, 0.13, 0, Math.PI * 2);
    ctx.fillStyle = L.hair;
    ctx.fill();
    this.drawHat(ctx, L);
    // 무기 (겨누는 중이면 앞으로)
    if (this.weapon && this.weapon.kind !== 'fist' && (this.aiming || this.weapon.alwaysShow)) {
      ctx.strokeStyle = this.weapon.color || '#3a2a1a';
      ctx.lineWidth = this.weapon.kind === 'gun' ? 0.07 : 0.05;
      ctx.beginPath();
      ctx.moveTo(0.18, 0.12);
      ctx.lineTo(0.18 + (this.weapon.length || 0.7), 0.12);
      ctx.stroke();
    }
    if (this.carry) {
      ctx.fillStyle = this.carry.color || '#7a5a3a';
      ctx.beginPath();
      ctx.ellipse(-0.1, 0, 0.18, 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawHat(ctx, L) {
    switch (L.hat) {
      case 'gat': // 갓: 넓은 반투명 챙 + 검은 모정
        ctx.fillStyle = 'rgba(25,22,20,0.35)';
        ctx.beginPath();
        ctx.arc(0.02, 0, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 0.03;
        ctx.stroke();
        ctx.fillStyle = '#16140f';
        ctx.beginPath();
        ctx.arc(0.02, 0, 0.11, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'paeraengi': // 패랭이(보부상)
        ctx.fillStyle = '#c9a85c';
        ctx.beginPath();
        ctx.arc(0.02, 0, 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 0.03;
        ctx.stroke();
        ctx.fillStyle = '#efe6d0';
        ctx.beginPath();
        ctx.arc(0.1, 0.12, 0.05, 0, Math.PI * 2); // 목화송이
        ctx.fill();
        break;
      case 'cap': // 제모
        ctx.fillStyle = '#1f2433';
        ctx.beginPath();
        ctx.arc(0.02, 0, 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(0.1, -0.08, 0.1, 0.16);
        break;
      case 'western': // 중절모
        ctx.fillStyle = '#2a2628';
        ctx.beginPath();
        ctx.arc(0.02, 0, 0.21, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3d383a';
        ctx.beginPath();
        ctx.arc(0.02, 0, 0.12, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'headband': // 머리띠 + 상투
        ctx.strokeStyle = this.look.trim;
        ctx.lineWidth = 0.04;
        ctx.beginPath();
        ctx.arc(0.02, 0, 0.12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = this.look.hair;
        ctx.beginPath();
        ctx.arc(-0.02, 0, 0.05, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'jangot': // 장옷/쓰개치마
        ctx.fillStyle = this.look.trim;
        ctx.beginPath();
        ctx.ellipse(-0.02, 0, 0.17, 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'topknot': // 상투
        ctx.fillStyle = '#100e0b';
        ctx.beginPath();
        ctx.arc(-0.01, 0, 0.05, 0, Math.PI * 2);
        ctx.fill();
        break;
      default:
        break;
    }
  }

  drawDead(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.deathAngle ?? this.angle);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(110,20,15,0.35)';
    ctx.beginPath();
    ctx.ellipse(0.05, 0.05, 0.45, 0.3, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(1.3, 0.85);
    ctx.rotate(Math.PI / 2);
    this.drawBody(ctx, 0, 'stand');
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
