// 플레이어: 입력 → 이동, 탈것 타기/내리기(F), 주변 상호작용(E).
// 전투(조준·사격·호안)는 combat 시스템이 game.player 를 직접 다룬다.

import { Human, makeLook } from './human.js';

/** 상호작용 목록을 안전하게 받는다 (한 시스템의 버그가 플레이어를 멈추지 않게) */
const _warned = new Set();
function safeList(fn) {
  try {
    const r = fn();
    return Array.isArray(r) ? r.filter(Boolean) : [];
  } catch (err) {
    const k = String(err?.message);
    if (!_warned.has(k)) {
      _warned.add(k);
      console.error('[interaction provider]', err);
    }
    return [];
  }
}

export class Player extends Human {
  constructor(opts = {}) {
    super({ role: 'player', faction: 'gang', name: opts.name || '주인공', hp: 100, look: makeLook('player'), ...opts });
    this.isPlayer = true;
    this.tags.add('player');
    this.walkMode = false; // 걷기 고정 (CapsLock)
    this.interactRange = 1.7;
  }

  update(dt, game) {
    this.handleInput(dt, game);
    super.update(dt, game);
    this.updateInteractions(game);
  }

  handleInput(dt, game) {
    const input = game.input;
    if (this.state !== 'normal' || this.controlLocked) {
      this.moveX = this.moveY = 0;
      return;
    }
    if (this.vehicle) {
      this.moveX = this.moveY = 0;
      return;
    }
    const a = input.axis();
    this.moveX = a.x;
    this.moveY = a.y;
    if (input.pressed('CapsLock')) this.walkMode = !this.walkMode;
    this.gait = input.down('sprint') ? 'sprint' : this.walkMode ? 'walk' : 'run';
    if (input.pressed('crouch')) this.crouching = !this.crouching;
    if (input.pressed('brake') && this.roll(a.x, a.y)) input.consume('brake');
    if (this.gait === 'sprint') this.crouching = false;
  }

  /** 주변에서 E(interact)·F(enter) 로 할 수 있는 일 중 가장 좋은 것을 고른다 */
  updateInteractions(game) {
    const prompt = { interact: null, enter: null };
    if (this.state === 'normal' && !this.controlLocked) {
      if (this.vehicle) {
        const v = this.vehicle;
        prompt.enter = { label: v.exitLabel || `${v.displayName}에서 내리기`, run: (a) => v.exit(a, game) };
        const extra = v.getRiderInteractions?.(this, game) || [];
        for (const it of extra) if (!prompt[it.key] || (it.priority ?? 0) > (prompt[it.key].priority ?? 0)) prompt[it.key] = it;
      } else {
        const cands = [];
        const near = game.query(this.x, this.y, 9, (e) => e !== this);
        for (const e of near) {
          const d = e.interactDistance ? e.interactDistance(this) : Math.hypot(e.x - this.x, e.y - this.y) - (e.radius || 0);
          if (d > (e.interactRange ?? this.interactRange)) continue;
          for (const it of safeList(() => e.getInteractions?.(this, game))) cands.push({ ...it, d, target: e });
          for (const prov of game.interactionProviders) {
            for (const it of safeList(() => prov(this, e, game))) cands.push({ ...it, d, target: e });
          }
        }
        // 엔티티가 아닌 장소 기반 상호작용 (상점 문, 나루 표지 등)
        for (const prov of game.interactionProviders) {
          for (const it of safeList(() => prov(this, null, game))) cands.push({ ...it, d: it.d ?? 0.5, target: null });
        }
        for (const it of cands) {
          const cur = prompt[it.key];
          if (!cur || (it.priority ?? 0) > (cur.priority ?? 0) || ((it.priority ?? 0) === (cur.priority ?? 0) && it.d < cur.d)) prompt[it.key] = it;
        }
      }
    }
    game.prompt = prompt;
    const input = game.input;
    for (const key of ['enter', 'interact']) {
      const it = prompt[key];
      if (it && input.pressed(key)) {
        input.consume(key);
        try {
          it.run(this, game);
        } catch (err) {
          console.error('[interaction]', it.label, err);
        }
      }
    }
  }

  die(info, game) {
    super.die(info, game);
    game?.events.emit('player:dead', { info });
  }
}
