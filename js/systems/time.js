// 시각·낮밤·날씨·바람 [분위기] + 조명·날씨 화면 연출.
//
//   game.sys.time.hour(0~24 실수) .day .minutesPerDay(실시간 분, 기본 48) .light(0~1) .weather .wind{angle, strength}
//   isNight()  setHour(h)  skip(hours)  curfew()  setWeather(w, {instant, lock})
//   이벤트 'time:hour' {hour, day} · 'time:day' {day} · 'weather:change' {weather, prev}
//   game.lights: 다른 모듈이 {x, y, r, color?, intensity?, on?} 를 넣으면 밤에 그 자리가 밝아진다.
//   wind.angle 은 바람이 '불어 가는' 방향(라디안, 0=동, +는 시계방향). 늦봄 기본은 남서풍(북동쪽으로 붊).
//
// 그리기: SKY 층 = 구름 그림자(먹 번짐)·물 위 빗방울 동심원,
//         OVERLAY 층 맨 앞(order -1000, 화면 좌표) = 밤 어둠(빛 구멍)·노을·비네트·빗줄기·눈·안개·번개.

import { LAYER } from '../engine/game.js';
import { PAL } from '../engine/palette.js';
import { RNG, clamp, damp, hash2, mixHex, rand, rgba, sijin, smoothstep, valueNoise } from '../engine/util.js';

const TAU = Math.PI * 2;
export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];
export const WEATHER_NAME = { clear: '맑음', cloudy: '흐림', rain: '비', storm: '폭풍우', fog: '안개', snow: '눈' };

// 날씨 전이 가중치 (몇 게임시간마다 한 번 굴림)
const TRANS = {
  clear: [['clear', 64], ['cloudy', 30], ['rain', 3], ['fog', 3]],
  cloudy: [['clear', 40], ['cloudy', 34], ['rain', 18], ['storm', 3], ['fog', 5]],
  rain: [['cloudy', 45], ['rain', 28], ['storm', 7], ['clear', 20]],
  storm: [['rain', 55], ['cloudy', 35], ['storm', 10]],
  fog: [['clear', 55], ['cloudy', 40], ['fog', 5]],
  snow: [['cloudy', 40], ['snow', 40], ['clear', 20]],
};
// 날씨별 연출 목표값 (부드럽게 따라감)
const FX = {
  clear: { cloud: 0.22, rain: 0, fog: 0, storm: 0, snow: 0 },
  cloudy: { cloud: 0.72, rain: 0, fog: 0, storm: 0, snow: 0 },
  rain: { cloud: 0.92, rain: 0.62, fog: 0.08, storm: 0, snow: 0 },
  storm: { cloud: 1, rain: 1, fog: 0.05, storm: 1, snow: 0 },
  fog: { cloud: 0.35, rain: 0, fog: 1, storm: 0, snow: 0 },
  snow: { cloud: 0.85, rain: 0, fog: 0.15, storm: 0, snow: 0.8 },
};
const WIND = { clear: 0.28, cloudy: 0.42, rain: 0.55, storm: 0.92, fog: 0.06, snow: 0.4 };
const NO_WINDOW = new Set(['wall', 'gate', 'ruin', 'tomb', 'pagoda', 'well', 'bridge', 'stele', 'jangseung', 'shrine_small']);

/** 해의 밝기 0(밤)~1(낮). 늦봄: 해 뜸 ≈ 5:30, 해 짐 ≈ 19:40 */
export function lightAt(h) {
  h = ((h % 24) + 24) % 24;
  return smoothstep(4.6, 6.4, h) * (1 - smoothstep(18.9, 20.5, h));
}
/** 노을(저녁)·여명(새벽) 붉은 기운 0~1 */
function duskAt(h) {
  const bell = (c, w) => Math.max(0, 1 - ((h - c) / w) ** 2);
  return Math.max(bell(19.3, 1.3), 0.7 * bell(5.4, 0.9));
}
/** 밤에 창문 불이 켜진 집의 비율 */
function litFraction(h) {
  if (h >= 18.5 && h < 22) return 0.85;
  if (h >= 22) return 0.85 - (h - 22) * 0.25;
  if (h < 4) return 0.18;
  if (h < 6.5) return 0.35;
  return 0;
}
function strHash(s) {
  s = String(s);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}
function colorA(c, a) {
  if (typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return rgba(c, a);
  return rgba('#ffc27a', a);
}
function makeCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

class TimeSystem {
  constructor(game) {
    this.name = 'time';
    this.order = -50;
    this.game = game;
    this.minutesPerDay = 48; // 하루 = 실시간 48분
    this.hour = 7;
    this.day = 1;
    this.season = '늦봄';
    this.year = 1899;
    this.era = '광무';
    this.eraYear = 3;
    this.weather = 'clear';
    this.weatherLocked = false;
    this.wind = { angle: -0.8, strength: 0.28 };
    this.windHome = -0.8; // 남서풍
    this.curfewEnabled = false; // 1895 년 통금(인정·파루) 폐지 — 필요하면 켠다
    this.curfewStart = 22;
    this.curfewEnd = 4;
    this.frozen = false; // true 면 시계가 멈춤(컷신 등)
    this.playerLantern = true;
    this.light = lightAt(this.hour);
    this.darkness = 0; // 지금 화면에 덮인 어둠 알파 (다른 모듈 참고용)
    this.fx = { ...FX.clear };
    this._windBase = WIND.clear;
    this._wclock = 3;
    this._lastAbs = this._abs();
    this._cloudOff = { x: 0, y: 0 };
    this._flashAt = -9;
    this._flashPow = 1;
    this._thunder = [];
    this._r = null;
    this._tex = null;
    this._dark = null;
    this._grid = null;
    this._gridRef = null;
    this._gridLen = -1;
    this._lightBuf = [];
    this._vig = null;
    this._duskG = null;
  }

  // ------------------------------------------------------------ 공개 API

  isNight() {
    return this.light < 0.3;
  }
  isDawn() {
    return this.hour >= 4.5 && this.hour < 7;
  }
  isDusk() {
    return this.hour >= 18 && this.hour < 20.5;
  }
  /** 통금 여부 (기본 꺼짐) */
  curfew() {
    if (!this.curfewEnabled) return false;
    const h = this.hour, a = this.curfewStart, b = this.curfewEnd;
    return a > b ? h >= a || h < b : h >= a && h < b;
  }
  setCurfew(on) {
    this.curfewEnabled = !!on;
  }
  /** 같은 날 안에서 시각을 바꾼다 */
  setHour(h) {
    if (!Number.isFinite(h)) return;
    this.hour = ((h % 24) + 24) % 24;
    this._lastAbs = this._abs();
    this.light = lightAt(this.hour);
    this._snapFx();
    this.game.emit('time:hour', { hour: Math.floor(this.hour), day: this.day });
  }
  /** 시간을 앞으로 건너뛴다 (잠·기다리기). 지나간 정시마다 이벤트·날씨 판정 */
  skip(hours) {
    if (!(hours > 0)) return;
    this._advance(hours);
    this._snapFx();
  }
  /** 다음에 오는 h 시까지 건너뛴다 (예: 아침 6시까지 자기) */
  skipTo(h) {
    let d = (((h - this.hour) % 24) + 24) % 24;
    if (d < 0.01) d = 24;
    this.skip(d);
  }
  setWeather(w, opts = {}) {
    if (!WEATHERS.includes(w)) return false;
    if (opts.lock != null) this.weatherLocked = !!opts.lock;
    const prev = this.weather;
    this.weather = w;
    if (opts.instant) this._snapFx();
    if (prev !== w) this.game.emit('weather:change', { weather: w, prev });
    return true;
  }
  weatherName() {
    return WEATHER_NAME[this.weather] || this.weather;
  }
  /** 'HH:MM' */
  clockText() {
    const m = Math.floor(this.hour * 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  /** '진시' 같은 십이시 이름 */
  sijinText() {
    return sijin(this.hour);
  }
  /** '광무 3년 늦봄 · 1일째' */
  dateText() {
    return `${this.era} ${this.eraYear}년 ${this.season} · ${this.day}일째`;
  }
  /** 시야 배수 0.25~1 (밤·안개·폭우에 줄어든다: 목격·탐지 거리용) */
  visibility() {
    const f = this.fx;
    return clamp(1 - (1 - this.light) * 0.5 - f.fog * 0.45 - f.rain * 0.15 - f.snow * 0.15, 0.25, 1);
  }

  serialize() {
    return {
      hour: this.hour,
      day: this.day,
      weather: this.weather,
      weatherLocked: this.weatherLocked,
      wind: { angle: this.wind.angle, strength: this.wind.strength },
      season: this.season,
      curfewEnabled: this.curfewEnabled,
    };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    if (Number.isFinite(d.day)) this.day = Math.max(1, Math.floor(d.day));
    if (Number.isFinite(d.hour)) this.hour = ((d.hour % 24) + 24) % 24;
    if (typeof d.season === 'string') this.season = d.season;
    if (typeof d.curfewEnabled === 'boolean') this.curfewEnabled = d.curfewEnabled;
    this.weatherLocked = !!d.weatherLocked;
    if (d.wind && Number.isFinite(d.wind.angle)) this.wind.angle = d.wind.angle;
    if (d.wind && Number.isFinite(d.wind.strength)) this.wind.strength = clamp(d.wind.strength, 0, 1);
    const prev = this.weather;
    if (WEATHERS.includes(d.weather)) this.weather = d.weather;
    this._lastAbs = this._abs();
    this.light = lightAt(this.hour);
    this._wclock = 2 + rand.int(0, 2);
    this._snapFx();
    if (prev !== this.weather) this.game.emit('weather:change', { weather: this.weather, prev });
    this.game.emit('time:hour', { hour: Math.floor(this.hour), day: this.day });
  }

  // ------------------------------------------------------------ 시스템 훅

  init(game) {
    // 디버그: 주소 끝에 #hour=21&weather=rain
    try {
      const hash = String(typeof location !== 'undefined' ? location.hash || '' : '');
      const m = /hour=([\d.]+)/.exec(hash);
      if (m) this.setHour(parseFloat(m[1]));
      const w = /weather=(\w+)/.exec(hash);
      if (w) this.setWeather(w[1], { instant: true });
    } catch {
      /* 무시 */
    }
  }

  update(dt, realDt, game) {
    if (!this.frozen && dt > 0) this._advance((dt * 24) / (Math.max(0.1, this.minutesPerDay) * 60));
    this._updateFx(dt, realDt, game);
  }

  // ------------------------------------------------------------ 시계

  _abs() {
    return (this.day - 1) * 24 + this.hour;
  }

  _advance(dh) {
    if (!(dh > 0)) return;
    this.hour += dh;
    while (this.hour >= 24) {
      this.hour -= 24;
      this.day++;
    }
    const abs = this._abs();
    const from = Math.floor(this._lastAbs), to = Math.floor(abs);
    if (to > from) {
      for (let k = Math.max(from + 1, to - 47); k <= to; k++) this._onHour(k % 24, Math.floor(k / 24) + 1);
    }
    this._lastAbs = abs;
    this.light = lightAt(this.hour);
  }

  _onHour(h, day) {
    if (h === 0) this.game.emit('time:day', { day });
    if (!this.weatherLocked) {
      const w = this.weather;
      const winter = /겨울|winter/.test(this.season);
      if ((h === 4 || h === 5) && (w === 'clear' || w === 'cloudy') && !winter && rand.chance(0.3)) this.setWeather('fog'); // 새벽 안개
      else if (w === 'fog' && h >= 9 && h <= 16 && rand.chance(0.6)) this.setWeather(rand.chance(0.6) ? 'clear' : 'cloudy'); // 안개 걷힘
      else if (--this._wclock <= 0) {
        this._wclock = rand.int(2, 4);
        this._rollWeather(winter);
      }
    }
    this.game.emit('time:hour', { hour: h, day });
  }

  _rollWeather(winter) {
    const table = TRANS[this.weather] || TRANS.clear;
    let total = 0;
    for (const [, w] of table) total += w;
    let r = rand.next() * total, next = this.weather;
    for (const [id, w] of table) {
      if ((r -= w) <= 0) {
        next = id;
        break;
      }
    }
    if (winter && next === 'rain') next = 'snow';
    if (!winter && next === 'snow') next = 'rain';
    this.setWeather(next);
  }

  // ------------------------------------------------------------ 연출 상태

  _snapFx() {
    const t = FX[this.weather] || FX.clear;
    Object.assign(this.fx, t);
    this._windBase = WIND[this.weather] ?? 0.3;
  }

  _updateFx(dt, realDt, game) {
    const tgt = FX[this.weather] || FX.clear;
    const k = damp(0.06, dt);
    for (const key in tgt) this.fx[key] += (tgt[key] - this.fx[key]) * k;
    // 바람: 날씨에 따른 세기 + 돌풍, 방향은 천천히 돈다
    this._windBase += ((WIND[this.weather] ?? 0.3) - this._windBase) * damp(0.02, dt);
    const t = game.time;
    this.wind.strength = clamp(this._windBase + (valueNoise(t / 25, 3.3, 11) - 0.5) * 0.35 * (0.4 + this._windBase), 0, 1);
    this.wind.angle = this.windHome + (valueNoise(t / 400, 7.7, 12) - 0.5) * 2.2;
    const ww = game.world?.wind;
    if (ww && typeof ww === 'object' && 'angle' in ww) {
      ww.angle = this.wind.angle;
      ww.strength = this.wind.strength;
    }
    // 구름은 바람 따라 흐른다
    const cs = 2 + this.wind.strength * 7;
    this._cloudOff.x += Math.cos(this.wind.angle) * cs * dt;
    this._cloudOff.y += Math.sin(this.wind.angle) * cs * dt;
    // 번개와 늦게 오는 천둥
    if (this.weather === 'storm' && this.fx.storm > 0.6 && rand.chance(realDt / 7)) {
      this._flashAt = game.realTime;
      this._flashPow = rand.range(0.6, 1);
      const delay = rand.range(0.4, 3);
      this._thunder.push({ at: game.realTime + delay, near: 1 - delay / 3.4, vol: rand.range(0.6, 1) });
    }
    for (let i = this._thunder.length - 1; i >= 0; i--) {
      const th = this._thunder[i];
      if (game.realTime >= th.at) {
        this._thunder.splice(i, 1);
        game.sfx?.('thunder', { volume: th.vol, near: th.near });
      }
    }
  }

  // ------------------------------------------------------------ 그리기 준비

  _ensure() {
    if (this._r) return;
    const rng = new RNG(1899);
    this._r = new Float32Array(1500);
    for (let i = 0; i < this._r.length; i++) this._r[i] = rng.next();
    // 먹 번짐 구름 그림자
    const blob = (color, alpha, n, seed) => {
      const c = makeCanvas(256, 256);
      if (!c) return null;
      const x = c.getContext('2d');
      const r = new RNG(seed);
      for (let i = 0; i < n; i++) {
        const cx = 128 + r.range(-66, 66), cy = 128 + r.range(-42, 42), rad = r.range(28, 78);
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, rgba(color, alpha));
        g.addColorStop(0.6, rgba(color, alpha * 0.45));
        g.addColorStop(1, rgba(color, 0));
        x.fillStyle = g;
        x.fillRect(0, 0, 256, 256);
      }
      // 가장자리를 둥글게 지운다
      x.globalCompositeOperation = 'destination-in';
      const m = x.createRadialGradient(128, 128, 60, 128, 128, 128);
      m.addColorStop(0, 'rgba(0,0,0,1)');
      m.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = m;
      x.fillRect(0, 0, 256, 256);
      x.globalCompositeOperation = 'source-over';
      return c;
    };
    this._tex = { cloud: blob(PAL.ink, 0.2, 16, 77), fog: blob(PAL.paper, 0.5, 12, 91) };
    this._dark = makeCanvas(4, 4);
    this._darkCtx = this._dark?.getContext('2d') || null;
  }

  // ------------------------------------------------------------ SKY 층 (월드 좌표)

  _renderSky(ctx, game, b) {
    this._ensure();
    this._drawClouds(ctx, game, b);
    this._drawRipples(ctx, game, b);
  }

  _drawClouds(ctx, game, b) {
    const cover = this.fx.cloud, sun = this.light, tex = this._tex?.cloud;
    if (!tex || sun < 0.15 || cover < 0.05) return;
    // 아주 흐리면 그림자 경계가 뭉개진다
    const alpha = 0.36 * sun * (cover > 0.85 ? 1 - (cover - 0.85) * 3 : 1);
    if (alpha <= 0.01) return;
    const CELL = 140, ox = this._cloudOff.x, oy = this._cloudOff.y;
    const cx0 = Math.floor((b.x0 - ox) / CELL) - 1, cx1 = Math.floor((b.x1 - ox) / CELL) + 1;
    const cy0 = Math.floor((b.y0 - oy) / CELL) - 1, cy1 = Math.floor((b.y1 - oy) / CELL) + 1;
    if ((cx1 - cx0) * (cy1 - cy0) > 400) return;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const h = hash2(cx, cy, 31);
        if (h > cover * 0.75 + 0.05) continue;
        const size = CELL * (1 + hash2(cx, cy, 32) * 0.9);
        const px = cx * CELL + ox + hash2(cx, cy, 33) * CELL * 0.5;
        const py = cy * CELL + oy + hash2(cx, cy, 34) * CELL * 0.5;
        if (px + size / 2 < b.x0 || px - size / 2 > b.x1 || py + size / 2 < b.y0 || py - size / 2 > b.y1) continue;
        ctx.globalAlpha = alpha * (0.5 + 0.5 * hash2(cx, cy, 35));
        ctx.drawImage(tex, px - size / 2, py - size * 0.32, size, size * 0.64);
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawRipples(ctx, game, b) {
    const a = this.fx.rain, w = game.world;
    if (a < 0.05 || !w?.isWater) return;
    const n = Math.floor(110 * a), P = 0.8, t = game.time;
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    const zoom = game.camera?.zoom || 14;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = Math.max(0.02, 1.1 / zoom);
    for (let i = 0; i < n; i++) {
      const ph = t / P + this._r[i];
      const cyc = Math.floor(ph), age = ph - cyc;
      const x = b.x0 + hash2(i, cyc, 71) * bw, y = b.y0 + hash2(i, cyc, 72) * bh;
      if (!w.isWater(x, y)) continue;
      const r = 0.12 + age * 0.75;
      ctx.globalAlpha = (1 - age) * 0.42 * (0.5 + a * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      if (age < 0.5) {
        ctx.moveTo(x + r * 0.45, y);
        ctx.arc(x, y, r * 0.45, 0, TAU);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ OVERLAY 층 (화면 좌표)

  _renderOverlay(ctx, game, b) {
    this._ensure();
    const cam = game.camera;
    cam.applyScreen(ctx);
    const W = cam.viewW, H = cam.viewH;
    ctx.save();
    this._drawLighting(ctx, game, W, H, b);
    this._drawRain(ctx, game, W, H);
    this._drawSnow(ctx, game, W, H);
    this._drawFog(ctx, game, W, H, b);
    this._drawFlash(ctx, game, W, H);
    ctx.restore();
  }

  _drawLighting(ctx, game, W, H, b) {
    const light = this.light, night = 1 - light, fx = this.fx;
    // 노을·여명: 해 쪽(저녁엔 서쪽=왼쪽, 새벽엔 동쪽=오른쪽)이 더 붉다
    const dusk = duskAt(this.hour) * (1 - fx.cloud * 0.6);
    if (dusk > 0.01) {
      const evening = this.hour > 12;
      const key = `${W}|${evening}`;
      if (!this._duskG || this._duskG.key !== key) {
        const g = ctx.createLinearGradient(0, 0, W, 0);
        const col = evening ? PAL.dusk : mixHex(PAL.dusk, '#d98a8a', 0.45);
        g.addColorStop(evening ? 0 : 1, rgba(col, 1));
        g.addColorStop(evening ? 1 : 0, rgba(col, 0.3));
        this._duskG = { key, g };
      }
      ctx.globalAlpha = dusk * 0.2;
      ctx.fillStyle = this._duskG.g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // 흐림·비로 낮에도 살짝 어둡다
    const overcast = light * (0.05 * fx.cloud + 0.1 * fx.rain + 0.08 * fx.storm + 0.03 * fx.fog);
    const darkA = clamp(night * 0.66 + overcast + night * fx.rain * 0.06, 0, 0.8);
    this.darkness = darkA;
    if (darkA < 0.015) return;
    const lights = this._collectLights(game, night, b);
    const d = this._darkCtx;
    if (d) {
      const S = 0.5;
      const cw = Math.max(1, Math.ceil(W * S)), ch = Math.max(1, Math.ceil(H * S));
      if (this._dark.width !== cw || this._dark.height !== ch) {
        this._dark.width = cw;
        this._dark.height = ch;
      }
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalCompositeOperation = 'source-over';
      d.globalAlpha = 1;
      d.clearRect(0, 0, cw, ch);
      d.fillStyle = PAL.night;
      d.globalAlpha = darkA;
      d.fillRect(0, 0, cw, ch);
      // 빛 구멍
      d.globalAlpha = 1;
      d.globalCompositeOperation = 'destination-out';
      for (const L of lights) {
        const x = L.sx * S, y = L.sy * S, r = L.sr * S;
        const g = d.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(0,0,0,${L.k})`);
        g.addColorStop(0.45, `rgba(0,0,0,${L.k * 0.65})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        d.fillStyle = g;
        d.fillRect(x - r, y - r, r * 2, r * 2);
      }
      d.globalCompositeOperation = 'source-over';
      ctx.drawImage(this._dark, 0, 0, W, H);
    }
    // 등불의 따스한 기운
    if (night > 0.2 && lights.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const L of lights) {
        if (!(L.warm > 0)) continue;
        const r = L.sr * 0.8;
        const g = ctx.createRadialGradient(L.sx, L.sy, 0, L.sx, L.sy, r);
        g.addColorStop(0, colorA(L.color, 0.1 * L.warm * night));
        g.addColorStop(1, colorA(L.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(L.sx - r, L.sy - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // 비네트
    const vig = clamp(0.5 * night + 0.15 * fx.storm, 0, 0.6) * (darkA / 0.66);
    if (vig > 0.01) {
      const key = `${W}x${H}`;
      if (!this._vig || this._vig.key !== key) {
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
        g.addColorStop(0, rgba(PAL.night, 0));
        g.addColorStop(1, rgba(PAL.night, 1));
        this._vig = { key, g };
      }
      ctx.globalAlpha = vig;
      ctx.fillStyle = this._vig.g;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  /** 화면 안의 빛: 플레이어 등불, 집 창문, game.lights */
  _collectLights(game, night, b) {
    const out = this._lightBuf;
    out.length = 0;
    const cam = game.camera, z = cam.zoom, W = cam.viewW, H = cam.viewH, t = game.realTime;
    const push = (x, y, r, k, color, warm) => {
      if (out.length >= 64 || !(r > 0) || !(k > 0)) return;
      const s = cam.worldToScreen(x, y), sr = r * z;
      if (s.x + sr < 0 || s.y + sr < 0 || s.x - sr > W || s.y - sr > H) return;
      out.push({ sx: s.x, sy: s.y, sr, k: clamp(k, 0, 1), color, warm });
    };
    const p = game.player;
    if (p && this.playerLantern && night > 0.25 && p.state !== 'dead') {
      const fl = 1 + Math.sin(t * 11.3) * 0.03 + Math.sin(t * 6.1) * 0.03;
      push(p.x, p.y, 6.5 * fl, clamp((night - 0.25) * 1.6, 0, 0.85), '#ffc27a', 1);
    }
    const lights = game.lights;
    if (Array.isArray(lights)) {
      for (const L of lights) {
        if (!L || L.on === false || !Number.isFinite(L.x) || !Number.isFinite(L.y)) continue;
        push(L.x, L.y, L.r ?? 6, (L.intensity ?? 0.9) * (L.always ? 1 : clamp(night * 1.4, 0, 1)), L.color || '#ffc27a', L.warm ?? 1);
      }
    }
    const frac = litFraction(this.hour);
    if (night > 0.3 && frac > 0) {
      for (const bd of this._buildingsIn(game, b)) {
        const h = bd._litH ?? (bd._litH = strHash(bd.id ?? `${bd.x},${bd.y}`));
        if (h >= frac || NO_WINDOW.has(bd.kind)) continue;
        const cx = bd.x, cy = bd.y;
        const dx = bd.door?.x ?? cx, dy = bd.door?.y ?? cy;
        const lx = cx + (dx - cx) * 0.55, ly = cy + (dy - cy) * 0.55;
        const r = clamp(Math.max(bd.w || 6, bd.h || 6) * 0.75, 4, 12);
        const k = 0.75 * (0.88 + 0.12 * Math.sin(t * 2.1 + h * 40)) * clamp((night - 0.3) * 2, 0, 1);
        push(lx, ly, r, k, '#ffb45c', 0.8);
      }
    }
    return out;
  }

  /** 화면 안 건물 (64m 격자 캐시) */
  _buildingsIn(game, b) {
    const list = game.world?.buildings;
    if (!Array.isArray(list) || !list.length || !b) return [];
    if (this._gridRef !== list || this._gridLen !== list.length) {
      this._gridRef = list;
      this._gridLen = list.length;
      this._grid = new Map();
      for (const bd of list) {
        if (!bd || !Number.isFinite(bd.x) || !Number.isFinite(bd.y)) continue;
        const k = `${Math.floor(bd.x / 64)},${Math.floor(bd.y / 64)}`;
        let a = this._grid.get(k);
        if (!a) this._grid.set(k, (a = []));
        a.push(bd);
      }
    }
    const res = [];
    const pad = 12;
    const x0 = Math.floor((b.x0 - pad) / 64), x1 = Math.floor((b.x1 + pad) / 64);
    const y0 = Math.floor((b.y0 - pad) / 64), y1 = Math.floor((b.y1 + pad) / 64);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 900) return res;
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        const a = this._grid.get(`${gx},${gy}`);
        if (a) for (const bd of a) res.push(bd);
      }
    return res;
  }

  _drawRain(ctx, game, W, H) {
    const a = this.fx.rain;
    if (a < 0.02 || !this._r) return;
    const t = game.time; // 호안 때 빗줄기도 느려진다
    const slant = 0.32 + Math.cos(this.wind.angle) * this.wind.strength * 0.45; // 먹 빗줄기는 늘 비스듬히
    const n = Math.min(360, Math.floor(((W * H) / 4200) * a * (1 + this.fx.storm * 0.6)));
    const night = 1 - this.light;
    const pw = W + 80, ph = H + 80;
    // 먼 빗줄기(가늘고 옅게)와 가까운 빗줄기(길고 진하게) 두 겹
    for (let layer = 0; layer < 2; layer++) {
      const cnt = layer ? Math.floor(n * 0.3) : n;
      const len = (layer ? 26 : 15) + 10 * a, speed = layer ? 1500 : 950;
      ctx.beginPath();
      for (let i = 0; i < cnt; i++) {
        const j = (i + layer * 360) * 3; // 0..1403 (난수표 1500 안)
        const hs = 0.75 + 0.5 * this._r[j + 2];
        let y = (this._r[j + 1] * ph + t * speed * hs) % ph;
        let x = (this._r[j] * pw + t * speed * hs * slant) % pw;
        if (x < 0) x += pw;
        x -= 40;
        y -= 40;
        const l = len * hs;
        ctx.moveTo(x, y);
        ctx.lineTo(x - slant * l, y - l);
      }
      ctx.lineWidth = layer ? 1.4 : 1;
      ctx.strokeStyle = night > 0.5 ? rgba(PAL.paperShade, (layer ? 0.2 : 0.12) * (0.5 + a * 0.5)) : rgba(PAL.ink2, (layer ? 0.3 : 0.18) * (0.5 + a * 0.5));
      ctx.stroke();
    }
    // 젖은 공기
    ctx.fillStyle = rgba(PAL.ink2, 0.05 * a);
    ctx.fillRect(0, 0, W, H);
  }

  _drawSnow(ctx, game, W, H) {
    const a = this.fx.snow;
    if (a < 0.02 || !this._r) return;
    const t = game.time;
    const n = Math.min(260, Math.floor(((W * H) / 6000) * a));
    const drift = Math.cos(this.wind.angle) * this.wind.strength * 40;
    const pw = W + 40, ph = H + 40;
    ctx.fillStyle = rgba(PAL.white, 0.85);
    for (let i = 0; i < n; i++) {
      const j = (i + 800) * 3 % 1497;
      const hs = 0.6 + 0.8 * this._r[j + 2];
      let y = (this._r[j + 1] * ph + t * 45 * hs) % ph;
      let x = (this._r[j] * pw + t * drift * hs + Math.sin(t * 1.3 + i) * 12) % pw;
      if (x < 0) x += pw;
      const s = 1.2 + hs * 1.6;
      ctx.fillRect(x - 20, y - 20, s, s);
    }
  }

  _drawFog(ctx, game, W, H, b) {
    const f = this.fx.fog;
    if (f < 0.02) return;
    const cam = game.camera, z = cam.zoom, night = 1 - this.light;
    const col = mixHex(PAL.paper, PAL.night, night * 0.75);
    // 바람 따라 흐르는 한지색 안개 덩이 (월드에 붙어 있다)
    const tex = this._tex?.fog;
    if (tex && b) {
      const CELL = 50, ox = this._cloudOff.x * 0.4, oy = this._cloudOff.y * 0.4;
      const cx0 = Math.floor((b.x0 - ox) / CELL) - 1, cx1 = Math.floor((b.x1 - ox) / CELL) + 1;
      const cy0 = Math.floor((b.y0 - oy) / CELL) - 1, cy1 = Math.floor((b.y1 - oy) / CELL) + 1;
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= 120) {
        for (let cy = cy0; cy <= cy1; cy++)
          for (let cx = cx0; cx <= cx1; cx++) {
            if (hash2(cx, cy, 51) > 0.7) continue;
            const wx = cx * CELL + ox + hash2(cx, cy, 52) * CELL, wy = cy * CELL + oy + hash2(cx, cy, 53) * CELL;
            const s = cam.worldToScreen(wx, wy), size = CELL * 1.7 * z;
            ctx.globalAlpha = f * 0.55 * (1 - night * 0.6);
            ctx.drawImage(tex, s.x - size / 2, s.y - size * 0.35, size, size * 0.7);
          }
        ctx.globalAlpha = 1;
      }
    }
    // 플레이어 둘레는 옅고 멀수록 짙게
    const p = game.player;
    const ps = p ? cam.worldToScreen(p.x, p.y) : { x: W / 2, y: H / 2 };
    const r0 = 6 * z, r1 = Math.max(r0 + 10, 45 * z);
    const g = ctx.createRadialGradient(ps.x, ps.y, r0, ps.x, ps.y, r1);
    g.addColorStop(0, rgba(col, 0.1 * f));
    g.addColorStop(0.5, rgba(col, 0.45 * f));
    g.addColorStop(1, rgba(col, 0.78 * f));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _drawFlash(ctx, game, W, H) {
    const e = game.realTime - this._flashAt;
    if (e < 0 || e > 0.5) return;
    const v = e < 0.05 ? 1 : e < 0.09 ? 0.15 : e < 0.16 ? 0.75 : Math.max(0, 0.75 * (1 - (e - 0.16) / 0.34));
    ctx.globalAlpha = v * 0.5 * this._flashPow;
    ctx.fillStyle = PAL.paper;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

export function install(game) {
  const time = new TimeSystem(game);
  if (!Array.isArray(game.lights)) game.lights = [];
  game.registerSystem(time);
  game.addRenderer(LAYER.SKY, (ctx, g, b) => time._renderSky(ctx, g, b), -100);
  game.addRenderer(LAYER.OVERLAY, (ctx, g, b) => time._renderOverlay(ctx, g, b), -1000);
  return time;
}
