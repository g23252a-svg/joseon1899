// 소리 [분위기] — WebAudio 합성 효과음·배경음·환경음. 소리 파일 없이 전부 코드로 만든다.
//
//   game.sys.audio.play(name, {x, y, volume, pitch, delay})   효과음 (x,y 가 있으면 거리 감쇠·좌우 팬)
//   game.sys.audio.music(trackId | 'auto' | null)              배경음 크로스페이드. 기본 'auto' = 상황에 맞춰 고름
//   game.sys.audio.ambient(kind | 'auto' | null)               환경음. 기본 'auto' = 플레이어 주변 지형으로 고름
//   game.sys.audio.unlock()                                    첫 사용자 입력 때 (스스로도 첫 입력을 잡는다)
//   game.sys.audio.setVolume(0..1), .muted = bool               N 키: 소리 켬/끔
//
// AudioContext 가 없는 환경(Node 스모크)에서는 모든 함수가 예외 없이 아무것도 안 한다.
// 음악: 황종을 E♭ 으로 잡은 평조(황·태·중·임·남)·계면조(황·협·중·임·무) 5음.
//       가야금 뜯는 소리(짧은 감쇠 + 농현·꺾는 소리) + 장구(덩·덕·쿵) 세마치·굿거리·휘모리 장단, 밤엔 대금 숨소리.

import { clamp } from './util.js';

const TAU = Math.PI * 2;
const SETTINGS_KEY = 'joseon1899.settings.audio';
const HORSES = new Set(['horse', 'pony', 'jeju_horse', 'western_horse']);
const MAX_VOICES = 48;
const FADE = 2.5; // 곡 크로스페이드(초)
const rr = (a, b) => a + (b - a) * Math.random();

// ---------------------------------------------------------------- 음계

const TONIC = 155.56; // 황종 = E♭3
const SCALES = { pyeong: [0, 2, 5, 7, 9], gyemyeon: [0, 3, 5, 7, 10] };
const mod5 = (d) => ((d % 5) + 5) % 5;
function noteFreq(scale, deg) {
  const iv = SCALES[scale] || SCALES.pyeong;
  return TONIC * Math.pow(2, (iv[mod5(deg)] + 12 * Math.floor(deg / 5)) / 12);
}
function nearestTonic(deg, lo, hi) {
  let best = deg, bd = 99;
  for (let d = Math.ceil(lo / 5) * 5; d <= hi; d += 5) {
    if (Math.abs(d - deg) < bd) {
      bd = Math.abs(d - deg);
      best = d;
    }
  }
  return best;
}
/** 시김새: 계면조는 '미'(임)를 떨고 '도'(협)를 꺾는다. 평조는 긴 음에 잔잔한 농현 */
function ornamentFor(scale, deg, strong) {
  const i = mod5(deg);
  if (scale === 'gyemyeon') {
    if (i === 3) return 'shake';
    if (i === 1) return 'bend';
    return strong && Math.random() < 0.3 ? 'vib' : null;
  }
  if (strong && Math.random() < 0.45) return 'vib';
  return Math.random() < 0.08 ? 'slide' : null;
}
const STEPS = [-2, -1, -1, -1, 0, 1, 1, 1, 2];

// 장단: D 덩(합장단) · K 쿵(북편) · k 덕(채편) · g 기(작은 채) · gk 기덕 · r 더러러러
const JANGDAN = {
  semachi: { beat: 3, pat: ['D', '', '', 'D', '', 'k', 'K', 'k', ''] },
  gutgeori: { beat: 3, pat: ['D', '', 'gk', 'K', '', 'r', 'K', '', 'gk', 'K', '', 'r'] },
  hwimori: { beat: 2, pat: ['D', '', 'k', 'g', 'K', '', 'k', ''] },
  sparse: { beat: 4, pat: ['K', '', '', '', '', '', '', '', 'g', '', '', '', '', '', '', ''] },
};

// 곡: slot = 장단 한 칸(초), mel = 칸마다 음 낼 확률, lo/hi = 음역(음계 도수), 나머지는 음량
const TRACKS = {
  title: { scale: 'pyeong', jd: 'semachi', slot: 0.33, mel: 0.36, lo: 4, hi: 11, drum: 0.3, pluck: 0.34, flute: 0.4, bass: 0.5 },
  day: { scale: 'pyeong', jd: 'gutgeori', slot: 0.27, mel: 0.32, lo: 5, hi: 12, drum: 0.26, pluck: 0.3, flute: 0.12, bass: 0.4 },
  town: { scale: 'pyeong', jd: 'semachi', slot: 0.22, mel: 0.44, lo: 5, hi: 13, drum: 0.32, pluck: 0.3, flute: 0, bass: 0.35 },
  night: { scale: 'gyemyeon', jd: 'sparse', slot: 0.42, mel: 0.12, lo: 3, hi: 10, drum: 0.2, pluck: 0.3, flute: 0.6, fluteVol: 0.13, bass: 0.3, sparse: 0.5 },
  wanted: { scale: 'gyemyeon', jd: 'hwimori', slot: 0.14, mel: 0.42, lo: 2, hi: 9, drum: 0.36, pluck: 0.26, flute: 0, bass: 0.6, repeat: 0.45, bright: 1.5 },
  tense: { scale: 'gyemyeon', jd: 'semachi', slot: 0.26, mel: 0.3, lo: 3, hi: 10, drum: 0.28, pluck: 0.26, flute: 0.25, bass: 0.5 },
};
const TRACK_ALIAS = {
  explore: 'day', calm: 'day', field: 'day', combat: 'wanted', battle: 'wanted', chase: 'wanted', fight: 'wanted',
  market: 'town', city: 'town', village: 'town', mission: 'tense', danger: 'tense', sad: 'night', menu: 'title',
};
function resolveTrack(id) {
  if (TRACKS[id]) return id;
  if (TRACK_ALIAS[id]) return TRACK_ALIAS[id];
  const s = String(id);
  if (/night|밤/.test(s)) return 'night';
  if (/combat|fight|wanted|chase|battle|전투|수배|추격/.test(s)) return 'wanted';
  if (/town|market|city|장터|마을|성안/.test(s)) return 'town';
  if (/tense|mission|danger|긴장/.test(s)) return 'tense';
  if (/title|menu/.test(s)) return 'title';
  return 'day';
}

// ---------------------------------------------------------------- 효과음 표

const ALIAS = {
  gun: 'gun_rifle', shot: 'gun_rifle', rifle: 'gun_rifle', fire: 'gun_rifle', matchlock: 'gun_matchlock', revolver: 'gun_revolver',
  pistol: 'gun_revolver', arrow: 'bow', neigh: 'horse_neigh', gallop: 'horse_gallop', hooves: 'horse_gallop', bell: 'tram_bell',
  horn: 'train_whistle', click: 'ui_click', open: 'ui_open', close: 'ui_close', money: 'coin', item: 'pickup', loot: 'pickup',
  melee: 'swing', crash: 'bump', empty: 'dry_fire', footstep: 'step', water: 'splash', row: 'oar', complete: 'mission_complete',
  fail: 'mission_fail', hurt: 'hit', chirp: 'bird',
};
// 들리는 거리(m)
const RANGE = {
  gun_matchlock: 280, gun_rifle: 320, gun_revolver: 220, bow: 45, step: 22, hoof: 45, horse_gallop: 60, horse_neigh: 80,
  hit: 35, punch: 30, death: 40, swing: 25, tram_bell: 140, train_whistle: 520, steam: 70, oar: 35, splash: 50, door: 30,
  bump: 70, reload: 20, dry_fire: 15, skin: 20, gather: 20, craft: 20, coin: 20, pickup: 20, thunder: 2000, temple_bell: 2000,
  rail_clack: 80, whistle: 120, bird: 60,
};
// 최소 재생 간격(초) — 같은 소리가 한 틱에 겹쳐 터지지 않게
const THROTTLE = {
  step: 0.06, coin: 0.06, pickup: 0.08, hit: 0.03, punch: 0.03, ui_click: 0.03, ui_open: 0.08, ui_close: 0.08,
  horse_neigh: 1.2, wanted: 1.5, gather: 0.12, skin: 0.3, craft: 0.2, death: 0.05, mission_start: 1, mission_complete: 1,
  mission_fail: 1, hoan_in: 0.3, hoan_out: 0.3, temple_bell: 5, train_whistle: 0.8, tram_bell: 0.5, bump: 0.15,
};
// 잔향 보내기 양
const WET = {
  gun_matchlock: 0.35, gun_rifle: 0.35, gun_revolver: 0.25, train_whistle: 0.3, tram_bell: 0.25, thunder: 0.4, temple_bell: 0.5,
  mission_start: 0.3, mission_complete: 0.3, mission_fail: 0.3, wanted: 0.25, horse_neigh: 0.15, hoan_in: 0.3, whistle: 0.2,
};

const BELL_PARTS = [[1, 1, 1], [2.0, 0.45, 0.7], [2.76, 0.35, 0.5], [5.4, 0.15, 0.3], [8.9, 0.06, 0.18]];
const TEMPLE_PARTS = [[0.5, 0.5, 1], [1, 1, 0.9], [1.007, 0.8, 0.9], [2.02, 0.42, 0.6], [2.6, 0.3, 0.45], [3.9, 0.12, 0.3]];

// 각 함수: (A, out, t, pitch, opts) → 길이(초). out 은 거리·팬이 적용된 출력.
const SFX = {
  step(A, out, t, p, o) {
    const s = o.surface || 'ground';
    if (s === 'water') {
      A.noise(out, t, { dur: 0.18, vol: 0.32, a: 0.01, type: 'bandpass', f: 900 * p, f1: 2200 * p, q: 1.2 });
      return 0.25;
    }
    if (s === 'wood') {
      A.tone(out, t, { type: 'triangle', f: 190 * p, f1: 120 * p, dur: 0.07, vol: 0.25 });
      A.noise(out, t, { dur: 0.05, vol: 0.16, a: 0.002, type: 'bandpass', f: 1400 * p, q: 2 });
      return 0.1;
    }
    if (s === 'road') {
      A.noise(out, t, { dur: 0.055, vol: 0.28, a: 0.002, type: 'bandpass', f: 1700 * p, q: 1.1 });
      A.tone(out, t, { f: 110 * p, f1: 70 * p, dur: 0.05, vol: 0.12 });
      return 0.08;
    }
    if (s === 'soft') {
      A.noise(out, t, { dur: 0.09, vol: 0.26, a: 0.008, type: 'lowpass', f: 650 * p, q: 0.7 });
      return 0.1;
    }
    A.noise(out, t, { dur: 0.07, vol: 0.24, a: 0.004, type: 'lowpass', f: 1100 * p, q: 0.6 });
    A.noise(out, t + 0.01, { dur: 0.05, vol: 0.07, a: 0.003, type: 'highpass', f: 3500, q: 0.5 }); // 풀 스침
    return 0.1;
  },

  hoof(A, out, t, p, o) {
    const s = o.surface || 'ground';
    if (s === 'water') {
      A.noise(out, t, { dur: 0.14, vol: 0.3, a: 0.01, type: 'bandpass', f: 900 * p, f1: 2400 * p, q: 1.2 });
      return 0.2;
    }
    if (s === 'road' || s === 'wood') {
      A.tone(out, t, { type: 'triangle', f: (s === 'wood' ? 190 : 260) * p, f1: 140 * p, dur: 0.06, vol: 0.28, a: 0.001 });
      A.noise(out, t, { dur: 0.045, vol: 0.3, a: 0.001, type: 'bandpass', f: 1300 * p, q: 2.2 });
      return 0.1;
    }
    A.tone(out, t, { f: 120 * p, f1: 62 * p, dur: 0.08, vol: 0.4, a: 0.002 });
    A.noise(out, t, { dur: 0.07, vol: 0.34, a: 0.002, type: 'lowpass', f: (s === 'soft' ? 380 : 560) * p, q: 0.6 });
    return 0.1;
  },

  horse_gallop(A, out, t, p, o) {
    for (const [dt, k] of [[0, 1], [0.09, 0.85], [0.19, 1.1]]) SFX.hoof(A, out, t + dt, p * k, o);
    return 0.35;
  },

  horse_neigh(A, out, t, p) {
    const c = A.ctx, d = 1.25;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const f = osc.frequency;
    f.setValueAtTime(420 * p, t);
    f.exponentialRampToValueAtTime(980 * p, t + 0.14);
    f.setValueAtTime(980 * p, t + 0.2);
    f.exponentialRampToValueAtTime(560 * p, t + 0.85);
    f.exponentialRampToValueAtTime(360 * p, t + d);
    // 히히힝 떨림
    const lfo = c.createOscillator();
    lfo.frequency.value = 13;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(70 * p, t + 0.25);
    lg.gain.linearRampToValueAtTime(35 * p, t + d);
    lfo.connect(lg);
    lg.connect(f);
    const f1 = A.biquad('bandpass', 1100 * p, 4);
    const f2 = A.biquad('bandpass', 2400 * p, 5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.34, t + 0.06);
    g.gain.setValueAtTime(0.3, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const g2 = c.createGain();
    g2.gain.value = 0.6;
    osc.connect(f1);
    osc.connect(f2);
    f1.connect(g);
    f2.connect(g2);
    g2.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + d + 0.1);
    lfo.start(t);
    lfo.stop(t + d + 0.1);
    A.noise(out, t, { dur: d, vol: 0.05, a: 0.1, type: 'bandpass', f: 1600, q: 0.8 }); // 숨
    A.noise(out, t + d - 0.05, { dur: 0.35, vol: 0.12, a: 0.02, type: 'bandpass', f: 700, q: 0.6 }); // 푸르릉
    return d + 0.5;
  },

  whistle(A, out, t, p) {
    // 휘익- 휘익 (말 부르는 휘파람)
    A.tone(out, t, { f: 1700 * p, f1: 2600 * p, glide: 0.2, dur: 0.28, vol: 0.3, a: 0.03 });
    A.tone(out, t + 0.36, { f: 1900 * p, f1: 2900 * p, glide: 0.18, dur: 0.42, vol: 0.32, a: 0.03, hold: 0.15 });
    A.noise(out, t, { dur: 0.8, vol: 0.03, a: 0.05, type: 'bandpass', f: 2600, q: 1 });
    return 0.9;
  },

  gun_matchlock(A, out, t, p, o) {
    // 치익(심지·화약 접시) → 쾅(둔탁한 폭음)
    const fuse = o.fuse ?? 0.16;
    if (fuse > 0) {
      A.noise(out, t, { dur: fuse + 0.04, vol: 0.2, a: 0.015, type: 'highpass', f: 4200, q: 0.7, am: [1, 0.3, 0.9, 0.5, 1, 0.2, 0.8], amStep: 0.025 });
      A.noise(out, t + fuse * 0.6, { dur: 0.08, vol: 0.25, a: 0.004, type: 'bandpass', f: 2500, q: 1 }); // 화약 접시 '푸슉'
    }
    const tb = t + fuse;
    A.noise(out, tb, { dur: 0.95, vol: 0.9, a: 0.003, type: 'lowpass', f: 1500 * p, f1: 280 * p, glide: 0.5, q: 0.8 });
    A.tone(out, tb, { f: 92 * p, f1: 36 * p, glide: 0.35, dur: 0.65, vol: 0.85, a: 0.002 });
    A.noise(out, tb, { dur: 0.12, vol: 0.45, a: 0.001, type: 'bandpass', f: 900 * p, q: 1.2 });
    A.noise(out, tb + 0.06, { dur: 1.6, vol: 0.12, a: 0.1, type: 'lowpass', f: 480, q: 0.5, buf: 'brown' }); // 연기 속 울림
    return fuse + 1.8;
  },

  gun_rifle(A, out, t, p) {
    // 날카로운 '탕'
    A.noise(out, t, { dur: 0.09, vol: 0.9, a: 0.0015, type: 'highpass', f: 1800 * p, q: 0.7 });
    A.noise(out, t, { dur: 0.22, vol: 0.65, a: 0.002, type: 'bandpass', f: 3200 * p, f1: 900 * p, q: 0.9 });
    A.tone(out, t, { f: 140 * p, f1: 48 * p, glide: 0.14, dur: 0.22, vol: 0.65, a: 0.001 });
    A.noise(out, t + 0.03, { dur: 0.95, vol: 0.2, a: 0.02, type: 'lowpass', f: 900 * p, f1: 250, q: 0.5 }); // 메아리
    return 1.05;
  },

  gun_revolver(A, out, t, p) {
    // 짧은 '탕'
    A.noise(out, t, { dur: 0.07, vol: 0.75, a: 0.0015, type: 'highpass', f: 2200 * p, q: 0.7 });
    A.noise(out, t, { dur: 0.14, vol: 0.5, a: 0.002, type: 'bandpass', f: 2400 * p, f1: 1100 * p, q: 1 });
    A.tone(out, t, { f: 175 * p, f1: 70 * p, glide: 0.1, dur: 0.13, vol: 0.5, a: 0.001 });
    A.noise(out, t + 0.02, { dur: 0.45, vol: 0.1, a: 0.02, type: 'lowpass', f: 1100 * p, f1: 300, q: 0.5 });
    return 0.5;
  },

  bow(A, out, t, p) {
    // 퉁(시위) - 쉭(화살)
    A.tone(out, t, { type: 'triangle', f: 210 * p, f1: 150 * p, glide: 0.08, dur: 0.24, vol: 0.45, a: 0.002 });
    A.tone(out, t, { f: 105 * p, f1: 80 * p, dur: 0.18, vol: 0.3, a: 0.002 });
    A.noise(out, t, { dur: 0.03, vol: 0.22, a: 0.001, type: 'bandpass', f: 2500, q: 2 });
    A.noise(out, t + 0.04, { dur: 0.32, vol: 0.22, a: 0.05, type: 'bandpass', f: 2600 * p, f1: 700 * p, q: 1.6 });
    return 0.45;
  },

  hit(A, out, t, p) {
    A.noise(out, t, { dur: 0.09, vol: 0.45, a: 0.002, type: 'lowpass', f: 900 * p, q: 0.8 });
    A.tone(out, t, { f: 150 * p, f1: 55 * p, dur: 0.12, vol: 0.45, a: 0.002 });
    return 0.15;
  },

  punch(A, out, t, p) {
    A.noise(out, t, { dur: 0.07, vol: 0.5, a: 0.002, type: 'bandpass', f: 900 * p, q: 0.9 });
    A.noise(out, t, { dur: 0.02, vol: 0.18, a: 0.001, type: 'highpass', f: 2500 });
    A.tone(out, t, { f: 120 * p, f1: 60 * p, dur: 0.09, vol: 0.42, a: 0.002 });
    return 0.12;
  },

  swing(A, out, t, p) {
    A.noise(out, t, { dur: 0.18, vol: 0.28, a: 0.06, type: 'bandpass', f: 700 * p, f1: 2200 * p, q: 1.4 });
    return 0.2;
  },

  death(A, out, t, p) {
    // 털썩
    A.tone(out, t, { f: 110 * p, f1: 42 * p, dur: 0.45, vol: 0.45, a: 0.005 });
    A.noise(out, t, { dur: 0.4, vol: 0.32, a: 0.01, type: 'lowpass', f: 380 * p, q: 0.6 });
    A.noise(out, t + 0.05, { dur: 0.5, vol: 0.05, a: 0.05, type: 'bandpass', f: 700 * p, q: 0.8 });
    return 0.6;
  },

  pickup(A, out, t, p) {
    A.pluck(out, t, 698.5 * p, { dur: 0.45, vol: 0.2 });
    A.pluck(out, t + 0.07, 932.3 * p, { dur: 0.6, vol: 0.18 });
    return 0.7;
  },

  coin(A, out, t, p) {
    // 짤랑
    for (let k = 0; k < 2; k++) {
      const tt = t + k * rr(0.05, 0.09);
      for (const [r, a, d] of [[1, 0.22, 0.25], [1.34, 0.16, 0.2], [2.1, 0.1, 0.12], [2.9, 0.07, 0.08]]) {
        A.tone(out, tt, { f: 2400 * p * r * rr(0.98, 1.02), dur: d, vol: a * (k ? 0.7 : 1), a: 0.001 });
      }
      A.noise(out, tt, { dur: 0.02, vol: 0.1, a: 0.001, type: 'highpass', f: 6000 });
    }
    return 0.4;
  },

  craft(A, out, t, p) {
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.14;
      A.tone(out, tt, { type: 'triangle', f: rr(300, 420) * p, dur: 0.06, vol: 0.28, a: 0.001 });
      A.noise(out, tt, { dur: 0.04, vol: 0.22, a: 0.001, type: 'bandpass', f: 1000 * p, q: 3 });
    }
    return 0.5;
  },

  door(A, out, t, p) {
    // 삐걱 - 쿵
    const c = A.ctx;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(75 * p, t);
    osc.frequency.linearRampToValueAtTime(115 * p, t + 0.15);
    osc.frequency.linearRampToValueAtTime(88 * p, t + 0.3);
    const bp = A.biquad('bandpass', 700, 6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(bp);
    bp.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + 0.4);
    A.tone(out, t + 0.33, { f: 95 * p, f1: 50 * p, dur: 0.18, vol: 0.38 });
    A.noise(out, t + 0.33, { dur: 0.08, vol: 0.22, a: 0.002, type: 'lowpass', f: 900 });
    return 0.6;
  },

  tram_bell(A, out, t, p) {
    // 땡땡
    A.bell(out, t, 1320 * p, { dur: 1.2, vol: 0.26 });
    A.bell(out, t + 0.3, 1320 * p, { dur: 1.4, vol: 0.24 });
    return 1.8;
  },

  temple_bell(A, out, t, p) {
    // 멀리서 울리는 범종 (새벽·저녁)
    A.noise(out, t, { dur: 0.25, vol: 0.2, a: 0.005, type: 'lowpass', f: 300 });
    A.bell(out, t, 98 * p, { dur: 7, vol: 0.2, parts: TEMPLE_PARTS, noClick: true });
    return 7.2;
  },

  train_whistle(A, out, t, p, o) {
    // 기적 '뿌우-': 두 음 화음 사각파 + 필터
    const c = A.ctx, dur = o.long ? 2.4 : 1.6;
    const lp = A.biquad('lowpass', 1700 * p, 0.7);
    const bp = A.biquad('bandpass', 900 * p, 1.2);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.08);
    g.gain.setValueAtTime(0.18, t + dur - 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const f of [311, 370]) {
      const osc = c.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f * 0.94 * p, t);
      osc.frequency.exponentialRampToValueAtTime(f * p, t + 0.12);
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    lp.connect(bp);
    const g2 = c.createGain();
    g2.gain.value = 0.7;
    lp.connect(g2);
    bp.connect(g);
    g2.connect(g);
    g.connect(out);
    A.noise(out, t, { dur, vol: 0.07, a: 0.05, type: 'bandpass', f: 1800, q: 0.8 }); // 김 새는 소리
    return dur + 0.3;
  },

  steam(A, out, t, p) {
    A.noise(out, t, { dur: 0.9, vol: 0.3, a: 0.03, type: 'highpass', f: 2600 * p, f1: 1300 * p, q: 0.6 });
    A.noise(out, t, { dur: 0.25, vol: 0.2, a: 0.01, type: 'lowpass', f: 500 * p, q: 0.6 });
    return 1;
  },

  oar(A, out, t, p) {
    // 노를 물에 담그고 당기는 소리 + 물방울
    A.noise(out, t, { dur: 0.22, vol: 0.28, a: 0.03, type: 'bandpass', f: 500 * p, f1: 1500 * p, q: 1.1 });
    A.noise(out, t + 0.18, { dur: 0.5, vol: 0.16, a: 0.05, type: 'lowpass', f: 900 * p, f1: 400, q: 0.7 });
    for (let i = 0; i < 3; i++) {
      const f = rr(380, 700) * p;
      A.tone(out, t + 0.25 + i * rr(0.05, 0.12), { f, f1: f * rr(1.5, 2), glide: 0.04, dur: 0.05, vol: 0.05 });
    }
    return 0.8;
  },

  splash(A, out, t, p) {
    A.noise(out, t, { dur: 0.75, vol: 0.5, a: 0.005, type: 'lowpass', f: 3500 * p, f1: 500 * p, q: 0.6 });
    A.noise(out, t, { dur: 0.4, vol: 0.25, a: 0.01, type: 'bandpass', f: 1200 * p, f1: 300, q: 1 });
    for (let i = 0; i < 4; i++) {
      const f = rr(400, 900) * p;
      A.tone(out, t + 0.15 + i * rr(0.05, 0.12), { f, f1: f * 1.7, glide: 0.04, dur: 0.05, vol: 0.05 });
    }
    return 0.8;
  },

  bump(A, out, t, p) {
    A.noise(out, t, { dur: 0.3, vol: 0.55, a: 0.002, type: 'lowpass', f: 700 * p, q: 0.7 });
    A.tone(out, t, { f: 85 * p, f1: 40 * p, dur: 0.3, vol: 0.45 });
    A.noise(out, t, { dur: 0.08, vol: 0.28, a: 0.001, type: 'bandpass', f: 1500, q: 2 }); // 나무 삐걱
    return 0.4;
  },

  reload(A, out, t, p) {
    A.noise(out, t, { dur: 0.025, vol: 0.4, a: 0.001, type: 'bandpass', f: 3200 * p, q: 6 });
    A.tone(out, t, { type: 'triangle', f: 1800 * p, dur: 0.02, vol: 0.12, a: 0.001 });
    A.noise(out, t + 0.16, { dur: 0.04, vol: 0.42, a: 0.001, type: 'bandpass', f: 2200 * p, q: 4 });
    A.tone(out, t + 0.16, { f: 300 * p, f1: 200 * p, dur: 0.04, vol: 0.2, a: 0.001 });
    return 0.25;
  },

  dry_fire(A, out, t, p) {
    A.noise(out, t, { dur: 0.025, vol: 0.35, a: 0.001, type: 'bandpass', f: 3000 * p, q: 6 });
    return 0.05;
  },

  skin(A, out, t, p) {
    for (let i = 0; i < 5; i++) A.noise(out, t + i * 0.09, { dur: 0.07, vol: 0.16, a: 0.005, type: 'bandpass', f: rr(1200, 2200) * p, q: 1.5 });
    A.noise(out, t + 0.1, { dur: 0.35, vol: 0.1, a: 0.03, type: 'lowpass', f: 500, q: 1 });
    return 0.6;
  },

  gather(A, out, t, p) {
    let tt = t;
    for (let i = 0; i < 4; i++) {
      A.noise(out, tt, { dur: rr(0.05, 0.1), vol: 0.14, a: 0.004, type: 'highpass', f: rr(2500, 4500) * p, q: 0.6 });
      tt += rr(0.05, 0.1);
    }
    A.tone(out, tt, { type: 'triangle', f: 900 * p, f1: 600 * p, dur: 0.04, vol: 0.12, a: 0.001 }); // 똑
    return 0.5;
  },

  ui_click(A, out, t, p) {
    A.tone(out, t, { type: 'triangle', f: 1500 * p, dur: 0.03, vol: 0.1, a: 0.001 });
    A.noise(out, t, { dur: 0.015, vol: 0.08, a: 0.001, type: 'bandpass', f: 3000, q: 4 });
    return 0.05;
  },

  ui_open(A, out, t, p) {
    A.noise(out, t, { dur: 0.03, vol: 0.12, a: 0.001, type: 'bandpass', f: 1800, q: 3 }); // 한지 넘기는 톡
    A.pluck(out, t + 0.01, noteFreq('pyeong', 8) * p, { dur: 0.6, vol: 0.13 });
    A.pluck(out, t + 0.07, noteFreq('pyeong', 10) * p, { dur: 0.7, vol: 0.12 });
    return 0.8;
  },

  ui_close(A, out, t, p) {
    A.noise(out, t, { dur: 0.03, vol: 0.1, a: 0.001, type: 'bandpass', f: 1500, q: 3 });
    A.pluck(out, t + 0.01, noteFreq('pyeong', 9) * p, { dur: 0.5, vol: 0.11 });
    A.pluck(out, t + 0.07, noteFreq('pyeong', 7) * p, { dur: 0.6, vol: 0.1 });
    return 0.7;
  },

  mission_start(A, out, t, p) {
    // 덩 + 평조 상행 악구
    A.janggu(out, t, 'D', 0.4);
    const seq = [5, 7, 8, 10];
    seq.forEach((d, i) => A.pluck(out, t + 0.12 + i * 0.16, noteFreq('pyeong', d) * p, { dur: i === 3 ? 2.4 : 1.2, vol: 0.22, orn: i === 3 ? 'vib' : null }));
    A.pluck(out, t + 0.6, noteFreq('pyeong', 5) * p, { dur: 2.4, vol: 0.12, bright: 0.6 });
    A.janggu(out, t + 0.6, 'K', 0.32);
    return 3;
  },

  mission_complete(A, out, t, p) {
    const seq = [7, 8, 9, 10, 12];
    seq.forEach((d, i) => A.pluck(out, t + i * 0.14, noteFreq('pyeong', d) * p, { dur: i === 4 ? 2.8 : 1.1, vol: 0.22, orn: i === 4 ? 'slide' : null }));
    A.pluck(out, t + 0.56, noteFreq('pyeong', 5) * p, { dur: 2.8, vol: 0.13, bright: 0.6 });
    A.janggu(out, t, 'D', 0.3);
    A.janggu(out, t + 0.56, 'D', 0.38);
    A.janggu(out, t + 0.84, 'D', 0.32);
    A.flute(out, t + 0.56, noteFreq('pyeong', 15) * p, { dur: 2.2, vol: 0.06 });
    return 3.5;
  },

  mission_fail(A, out, t, p) {
    const seq = [9, 8, 7, 5];
    seq.forEach((d, i) => A.pluck(out, t + i * 0.22, noteFreq('gyemyeon', d) * p, { dur: i === 3 ? 2.6 : 1.3, vol: 0.2, orn: i === 3 ? 'fall' : i === 1 ? 'bend' : null }));
    A.janggu(out, t + 0.66, 'K', 0.4);
    return 3.2;
  },

  wanted(A, out, t, p) {
    // 꽹과리 '갱-갱' + 쿵
    A.metal(out, t, 0.1, p);
    A.metal(out, t + 0.18, 0.08, p);
    A.janggu(out, t, 'K', 0.55);
    A.janggu(out, t + 0.36, 'K', 0.45);
    return 0.9;
  },

  hoan_in(A, out, t, p) {
    // 시간이 느려지는 '우웅' + 심장 박동
    A.noise(out, t, { dur: 0.7, vol: 0.35, a: 0.02, type: 'lowpass', f: 5000, f1: 180, q: 2 });
    A.tone(out, t, { f: 320 * p, f1: 55 * p, dur: 0.8, vol: 0.4, a: 0.01 });
    A.tone(out, t + 0.05, { f: 58, dur: 0.4, vol: 0.32, a: 0.01 });
    A.tone(out, t + 0.42, { f: 52, dur: 0.35, vol: 0.22, a: 0.01 });
    return 1;
  },

  hoan_out(A, out, t, p) {
    A.noise(out, t, { dur: 0.45, vol: 0.28, a: 0.3, type: 'lowpass', f: 200, f1: 5000, glide: 0.4, q: 1.5 });
    A.tone(out, t, { f: 60 * p, f1: 260 * p, dur: 0.45, vol: 0.25, a: 0.2 });
    return 0.6;
  },

  heartbeat(A, out, t) {
    A.tone(out, t, { f: 58, f1: 45, dur: 0.16, vol: 0.32, a: 0.008 });
    A.tone(out, t + 0.2, { f: 52, f1: 42, dur: 0.14, vol: 0.22, a: 0.008 });
    return 0.4;
  },

  thunder(A, out, t, p, o) {
    const near = clamp(o.near ?? 0.5, 0, 1);
    if (near > 0.55) A.noise(out, t, { dur: 0.25, vol: 0.45 * near, a: 0.003, type: 'highpass', f: 1500, q: 0.5 }); // 우지끈
    const am = [];
    for (let i = 0; i < 40; i++) am.push(rr(0.35, 1) * (1 - i / 48));
    A.noise(out, t + 0.05, { dur: 3.8, vol: 0.7, a: 0.15, type: 'lowpass', f: 420 * p, f1: 90, q: 0.7, buf: 'brown', am, amStep: 0.09 });
    A.tone(out, t + 0.05, { f: 48, f1: 30, dur: 2.5, vol: 0.3, a: 0.1 });
    return 4.2;
  },

  rail_clack(A, out, t, p) {
    // 덜컹
    A.tone(out, t, { f: 140 * p, f1: 80 * p, dur: 0.06, vol: 0.24 });
    A.noise(out, t, { dur: 0.05, vol: 0.22, a: 0.001, type: 'bandpass', f: 900 * p, q: 2 });
    A.tone(out, t + 0.11, { f: 125 * p, f1: 72 * p, dur: 0.06, vol: 0.2 });
    A.noise(out, t + 0.11, { dur: 0.05, vol: 0.18, a: 0.001, type: 'bandpass', f: 820 * p, q: 2 });
    return 0.2;
  },

  bird(A, out, t, p, o) {
    A.chirp(out, t, o.kind || 'tweet', p);
    return 1;
  },
};

// 환경음 강제 종류 → 층
const AMB_KIND = {
  wind: 'wind', river: 'water', water: 'water', sea: 'sea', waves: 'sea', coast: 'sea', rain: 'rain', birds: 'birds',
  forest: 'birds', day: 'birds', insects: 'insects', night: 'insects', crickets: 'insects', market: 'crowd', crowd: 'crowd',
  town: 'crowd', city: 'crowd', frogs: 'frogs', paddy: 'frogs',
};
// 장소 종류 → 마을 웅성임 가중치
const TOWN_W = { city: 1, market: 1, district: 0.8, port: 0.7, station: 0.6, village: 0.5, tram_stop: 0.3 };

// ================================================================ 시스템

class AudioSystem {
  constructor(game) {
    this.name = 'audio';
    this.order = 95;
    this.game = game;
    this.ctx = null;
    this.masterVolume = 0.6;
    this.musicVolume = 0.25;
    this.sfxVolume = 0.9;
    this.ambientVolume = 0.35;
    this._muted = false;
    /** 자동 소리 켜고 끄기 (다른 모듈이 직접 낸다면 false 로) */
    this.auto = { steps: true, hooves: true, rail: true, oar: true };
    this.track = null; // 지금 나오는 곡 id
    this.musicMode = 'auto'; // 'auto' | 'manual'
    this.ambientMode = 'auto'; // 'auto' | 'off' | 종류
    this.tracks = Object.keys(TRACKS);
    this.sounds = Object.keys(SFX);
    this._manualTrack = null;
    this._manualInMission = false;
    this._players = [];
    this._voices = [];
    this._last = Object.create(null);
    this._env = { water: 0, sea: 0, forest: 0, mountain: 0, paddy: 0, town: 0, crowd: 0 };
    this._amb = null;
    this._envT = 0;
    this._ambT = 0;
    this._t = 0;
    this._combatUntil = -1;
    this._hold = false;
    this._candidate = null;
    this._candidateT = 0;
    this._stepK = null;
    this._hoofT = 0;
    this._railT = 0;
    this._oarT = 0;
    this._hbT = 0;
    this._birdT = 3;
    this._owlT = 8;
    this._frogT = 2;
    this._muffled = false;
    this._lastWanted = 0;
    this._loadSettings();
  }

  // ------------------------------------------------------------ 공개 API

  get muted() {
    return this._muted;
  }
  set muted(v) {
    this._muted = !!v;
    this._applyMaster();
    this._saveSettings();
    if (!this._muted) this.unlock();
  }
  get volume() {
    return this.masterVolume;
  }
  get unlocked() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(master) {
    this.masterVolume = clamp(Number(master) || 0, 0, 1);
    this._applyMaster();
    this._saveSettings();
  }
  setMusicVolume(v) {
    this.musicVolume = clamp(Number(v) || 0, 0, 1);
    this._setParam(this.musicBus?.gain, this.musicVolume);
    this._saveSettings();
  }
  setSfxVolume(v) {
    this.sfxVolume = clamp(Number(v) || 0, 0, 1);
    this._setParam(this.sfxBus?.gain, this.sfxVolume);
    this._setParam(this.sfxRev?.gain, this.sfxVolume);
    this._saveSettings();
  }
  setAmbientVolume(v) {
    this.ambientVolume = clamp(Number(v) || 0, 0, 1);
    this._setParam(this.ambBus?.gain, this.ambientVolume);
    this._saveSettings();
  }
  toggleMute() {
    this.muted = !this._muted;
    this.game.notify?.(this._muted ? '소리를 껐습니다 (N)' : '소리를 켰습니다 (N)', 'info');
  }

  /** 첫 사용자 입력 때 부른다. AudioContext 를 만들거나 깨운다. */
  unlock() {
    try {
      if (!this.ctx && !this._build()) return false;
      if (this.ctx.state === 'suspended' && !this._hidden) this.ctx.resume?.()?.catch?.(() => {});
      return true;
    } catch (err) {
      console.warn('[audio] 시작하지 못함:', err?.message);
      return false;
    }
  }

  /** 효과음. opts: {x, y, volume, pitch, delay, range, ...소리별 옵션} */
  play(name, opts = {}) {
    const c = this.ctx;
    if (!c || this._muted || c.state !== 'running') return false;
    const key = SFX[name] ? name : ALIAS[name];
    const fn = key && SFX[key];
    if (!fn) return false;
    const now = c.currentTime;
    if (opts.at == null && now - (this._last[key] ?? -9) < (THROTTLE[key] ?? 0.025)) return false;
    this._pruneVoices(now);
    if (this._voices.length >= MAX_VOICES && !opts.important) return false;
    let vol = opts.volume ?? 1, pan = 0, lp = 0, wet = WET[key] ?? 0.08;
    if (Number.isFinite(opts.x) && Number.isFinite(opts.y)) {
      const L = this._listener();
      const dx = opts.x - L.x, dy = opts.y - L.y, d = Math.hypot(dx, dy);
      const range = (RANGE[key] ?? 60) * (opts.range ?? 1);
      if (d >= range) return false;
      const k = 1 - d / range;
      vol *= Math.pow(k, 1.5);
      pan = clamp(dx / 22, -0.85, 0.85);
      if (d > 12) lp = 400 + 17000 * k * k; // 멀수록 먹먹하게
      wet = Math.min(0.6, wet + (1 - k) * 0.35);
    }
    if (vol < 0.004) return false;
    this._last[key] = now;
    const pitch = (opts.pitch ?? 1) * (this._muffled ? 0.86 : 1);
    const t = opts.at ?? now + 0.004 + (opts.delay ?? 0);
    try {
      const out = c.createGain();
      out.gain.value = vol;
      let tail = out;
      if (lp) {
        const f = this.biquad('lowpass', lp, 0.5);
        tail.connect(f);
        tail = f;
      }
      if (pan && c.createStereoPanner) {
        const pn = c.createStereoPanner();
        pn.pan.value = pan;
        tail.connect(pn);
        tail = pn;
      }
      tail.connect(this.sfxBus);
      if (wet > 0.01) {
        const s = c.createGain();
        s.gain.value = wet;
        tail.connect(s);
        s.connect(this.sfxRev);
      }
      const dur = fn(this, out, t, pitch, opts) || 1;
      this._voices.push(t + dur);
    } catch (err) {
      console.warn('[audio]', name, err?.message);
      return false;
    }
    return true;
  }

  /** 배경음. trackId: title|day|town|night|wanted|tense (그 밖의 이름은 비슷한 곡으로), 'auto' = 자동, null = 끔 */
  music(trackId) {
    if (trackId === undefined || trackId === 'auto') {
      this.musicMode = 'auto';
      this._manualTrack = null;
      this._manualInMission = false;
      return;
    }
    // 짧은 악구 이름이면 효과음으로
    if (typeof trackId === 'string' && /^mission_/.test(trackId) && SFX[trackId]) {
      this.play(trackId);
      return;
    }
    this.musicMode = 'manual';
    this._manualTrack = trackId === null || trackId === 'none' || trackId === 'off' ? null : resolveTrack(trackId);
    this._manualInMission = !!this.game.sys.missions?.active;
    this._setTrack(this._manualTrack);
  }

  /** 환경음. kind: wind|river|sea|rain|birds|insects|market|frogs, 'auto' = 자동, null = 끔 */
  ambient(kind) {
    if (kind === undefined || kind === 'auto') this.ambientMode = 'auto';
    else if (kind === null || kind === 'none' || kind === 'off') this.ambientMode = 'off';
    else this.ambientMode = AMB_KIND[kind] ? kind : 'auto';
    this._ambT = 0;
  }

  // ------------------------------------------------------------ 시스템 훅

  init() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const h = () => {
      if (!this.ctx || this.ctx.state !== 'running') this.unlock();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, h, { passive: true });
    try {
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', () => {
          this._hidden = document.visibilityState === 'hidden';
          if (!this.ctx) return;
          if (this._hidden) this.ctx.suspend?.()?.catch?.(() => {});
          else this.ctx.resume?.()?.catch?.(() => {});
        });
      }
    } catch {
      /* 없음 */
    }
  }

  update(dt, realDt) {
    this._tick(realDt, false);
  }
  updatePaused(realDt) {
    this._tick(realDt, true);
  }

  _tick(rdt, paused) {
    const g = this.game;
    if (g.input?.pressed?.('KeyN')) this.toggleMute();
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    this._t += rdt;
    const now = c.currentTime;
    // 호안: 먹먹하게 + 심장 소리
    const want = (g.timeScale ?? 1) < 0.85 || !!g.sys.combat?.hoanActive;
    if (want !== this._muffled) {
      this._muffled = want;
      this.muffle.frequency.setTargetAtTime(want ? 900 : 20000, now, want ? 0.08 : 0.25);
    }
    if (this._muffled && !paused && (this._hbT -= rdt) <= 0) {
      this._hbT = 0.9;
      this.play('heartbeat', { important: true });
    }
    if ((this._envT -= rdt) <= 0) {
      this._envT = 0.5;
      this._sense();
    }
    if ((this._ambT -= rdt) <= 0) {
      this._ambT = 0.25;
      this._updateAmbient(paused);
    }
    this._critters(rdt);
    this._autoMusic(rdt);
    this._scheduleMusic();
    if (!paused && g.state === 'play') {
      this._footsteps();
      this._vehicleSounds();
    } else this._stepK = null;
  }

  // ------------------------------------------------------------ 그래프 만들기

  _build() {
    const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
    if (!AC) return false;
    let c;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch {
      c = new AC();
    }
    this.ctx = c;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(c.destination);
    this.muffle = this.biquad('lowpass', 20000, 0.5);
    this.muffle.connect(comp);
    this.masterGain = c.createGain();
    this.masterGain.gain.value = this._muted ? 0 : this.masterVolume;
    this.masterGain.connect(this.muffle);
    const bus = (v) => {
      const g = c.createGain();
      g.gain.value = v;
      g.connect(this.masterGain);
      return g;
    };
    this.sfxBus = bus(this.sfxVolume);
    this.musicBus = bus(this.musicVolume);
    this.ambBus = bus(this.ambientVolume);
    this.musicDuck = c.createGain();
    this.musicDuck.connect(this.musicBus);
    this.buf = { white: this._noiseBuf('white', 2), pink: this._noiseBuf('pink', 4), brown: this._noiseBuf('brown', 4) };
    // 잔향 (생성한 임펄스)
    this.reverbIn = c.createGain();
    const conv = c.createConvolver();
    conv.buffer = this._impulse(2.4, 2.6);
    const ret = c.createGain();
    ret.gain.value = 0.5;
    this.reverbIn.connect(conv);
    conv.connect(ret);
    ret.connect(this.masterGain);
    this.sfxRev = c.createGain();
    this.sfxRev.gain.value = this.sfxVolume;
    this.sfxRev.connect(this.reverbIn);
    const ms = c.createGain();
    ms.gain.value = 0.4;
    this.musicBus.connect(ms);
    ms.connect(this.reverbIn);
    this._buildAmbient();
    // iOS 깨우기용 무음
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, c.sampleRate);
    s.connect(c.destination);
    s.start(0);
    return true;
  }

  _noiseBuf(kind, sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), m = Math.floor(c.sampleRate * 0.05);
    const raw = new Float32Array(n + m);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n + m; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') raw[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last * 3.5;
      }
    }
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    // 끝과 처음을 겹쳐 이어 붙인다 (반복 때 '틱' 소리 없게)
    for (let i = 0; i < n; i++) d[i] = i < m ? raw[i] * (i / m) + raw[n + i] * (1 - i / m) : raw[i];
    return b;
  }

  _impulse(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 80 ? i / 80 : 1);
    }
    return b;
  }

  _buildAmbient() {
    const c = this.ctx;
    const loop = (buf) => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(c.currentTime, Math.random() * (buf.duration - 0.2));
      return s;
    };
    const gain = (v = 0, dest = this.ambBus) => {
      const g = c.createGain();
      g.gain.value = v;
      if (dest) g.connect(dest);
      return g;
    };
    const L = {};
    {
      // 바람: 핑크 노이즈 + 띠 필터
      const g = gain();
      const f = this.biquad('bandpass', 420, 0.5);
      loop(this.buf.pink).connect(f);
      f.connect(g);
      L.wind = { g, f };
    }
    {
      // 물: 낮은 물살 + 높은 찰랑임
      const g = gain();
      const f = this.biquad('lowpass', 650, 0.5);
      loop(this.buf.brown).connect(f);
      f.connect(g);
      const g2 = gain(0.3, g);
      const f2 = this.biquad('bandpass', 1600, 1.8);
      loop(this.buf.white).connect(f2);
      f2.connect(g2);
      L.water = { g, f, g2 };
    }
    {
      // 비
      const g = gain();
      const hp = this.biquad('highpass', 1300, 0.5);
      const lp = this.biquad('lowpass', 7500, 0.5);
      loop(this.buf.white).connect(hp);
      hp.connect(lp);
      lp.connect(g);
      L.rain = { g };
    }
    {
      // 장터 웅성임: 말소리 대역 두 개를 따로 출렁이게
      const g = gain();
      const gA = gain(0.5, g), gB = gain(0.5, g);
      const fA = this.biquad('bandpass', 450, 1.4), fB = this.biquad('bandpass', 1150, 2.2);
      const src = loop(this.buf.pink);
      src.connect(fA);
      src.connect(fB);
      fA.connect(gA);
      fB.connect(gB);
      L.crowd = { g, gA, gB };
    }
    {
      // 풀벌레: 높은 사인을 빠른·느린 사각 LFO 로 끊는다 (두 마리)
      const g = gain();
      for (const [f, r1, r2] of [[4350, 23, 0.8], [3720, 31, 1.3]]) {
        const osc = c.createOscillator();
        osc.frequency.value = f;
        const am1 = gain(0.5, null), am2 = gain(0.5, g);
        const l1 = c.createOscillator(), l2 = c.createOscillator();
        l1.type = l2.type = 'square';
        l1.frequency.value = r1;
        l2.frequency.value = r2;
        const lg1 = gain(0.5, null), lg2 = gain(0.5, null);
        l1.connect(lg1);
        lg1.connect(am1.gain);
        l2.connect(lg2);
        lg2.connect(am2.gain);
        osc.connect(am1);
        am1.connect(am2);
        osc.start();
        l1.start();
        l2.start();
      }
      L.insects = { g };
    }
    this._ambL = L;
  }

  // ------------------------------------------------------------ 합성 도구

  biquad(type, f, q = 0.7) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = clamp(f, 20, 20000);
    b.Q.value = q;
    return b;
  }

  /** 오실레이터 한 음. o: {type, f, f1, glide, dur, vol, a, hold, lp, q} */
  tone(dest, t, o) {
    const c = this.ctx;
    const dur = o.dur ?? 0.2, a = Math.min(o.a ?? 0.004, dur * 0.5), vol = o.vol ?? 0.3;
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f), t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide ?? dur));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    if (o.hold) g.gain.setValueAtTime(vol, t + a + Math.min(o.hold, dur - a - 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    if (o.lp) {
      const f = this.biquad('lowpass', o.lp, o.q ?? 0.7);
      g.connect(f);
      f.connect(dest);
    } else g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return osc;
  }

  /** 걸러진 노이즈 한 덩이. o: {dur, vol, a, hold, type, f, f1, glide, q, buf, rate, am:[...], amStep} */
  noise(dest, t, o) {
    const c = this.ctx;
    const dur = o.dur ?? 0.2, a = Math.min(o.a ?? 0.005, dur * 0.5), vol = o.vol ?? 0.3;
    const buf = this.buf[o.buf || 'white'];
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(clamp(o.f ?? 1000, 20, 20000), t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(clamp(o.f1, 20, 20000), t + (o.glide ?? dur));
    f.Q.value = o.q ?? 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    if (o.hold) g.gain.setValueAtTime(vol, t + a + Math.min(o.hold, dur - a - 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    if (o.am) {
      const m = c.createGain();
      const step = o.amStep ?? 0.03;
      m.gain.setValueAtTime(o.am[0] ?? 1, t);
      for (let i = 1; i < o.am.length; i++) m.gain.setValueAtTime(o.am[i], t + i * step);
      g.connect(m);
      m.connect(dest);
    } else g.connect(dest);
    src.start(t, Math.random() * buf.duration * 0.8);
    src.stop(t + dur + 0.05);
    return g;
  }

  /** 가야금 뜯는 소리. orn: vib(농현)·shake(떠는 소리)·bend(꺾는 소리)·slide(추성)·fall(퇴성) */
  pluck(dest, t, f, o = {}) {
    const c = this.ctx, dur = o.dur ?? 1.6, vol = o.vol ?? 0.3, bright = o.bright ?? 1;
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'sine';
    const fl = c.createBiquadFilter();
    fl.type = 'lowpass';
    fl.Q.value = 1.5;
    fl.frequency.setValueAtTime(clamp(f * 9 * bright, 200, 9000), t);
    fl.frequency.exponentialRampToValueAtTime(clamp(f * 1.6, 120, 9000), t + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain();
    g2.gain.value = 0.5;
    o1.connect(fl);
    fl.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(dest);
    const orn = o.orn;
    for (const fr of [o1.frequency, o2.frequency]) {
      if (orn === 'bend') {
        fr.setValueAtTime(f * 1.06, t);
        fr.exponentialRampToValueAtTime(f, t + 0.14);
      } else if (orn === 'slide') {
        fr.setValueAtTime(f, t);
        fr.setValueAtTime(f, t + 0.25);
        fr.exponentialRampToValueAtTime(f * 1.122, t + 0.5);
      } else if (orn === 'fall') {
        fr.setValueAtTime(f, t);
        fr.setValueAtTime(f, t + dur * 0.35);
        fr.exponentialRampToValueAtTime(f * 0.944, t + dur * 0.7);
      } else fr.setValueAtTime(f, t);
    }
    if (orn === 'vib' || orn === 'shake') {
      const lfo = c.createOscillator();
      lfo.frequency.value = orn === 'shake' ? 6.5 : 5.2;
      const lg = c.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.setValueAtTime(0, t + 0.15);
      lg.gain.linearRampToValueAtTime(f * (orn === 'shake' ? 0.03 : 0.016), t + 0.5);
      lfo.connect(lg);
      lg.connect(o1.frequency);
      lg.connect(o2.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
    // 술대로 뜯는 잡음
    this.noise(dest, t, { dur: 0.025, vol: vol * 0.25, a: 0.001, type: 'bandpass', f: Math.min(6000, f * 5), q: 2 });
  }

  /** 대금 같은 숨 섞인 긴 음 */
  flute(dest, t, f, o = {}) {
    const c = this.ctx, dur = Math.max(0.9, o.dur ?? 2.5), vol = o.vol ?? 0.12;
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o2.type = 'triangle';
    for (const [osc, k] of [[o1, 1], [o2, 2]]) {
      osc.frequency.setValueAtTime(f * k * 0.97, t);
      osc.frequency.exponentialRampToValueAtTime(f * k, t + 0.18);
    }
    const g2 = c.createGain();
    g2.gain.value = 0.12;
    const lp = this.biquad('lowpass', 3000, 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.3);
    g.gain.linearRampToValueAtTime(vol * 0.85, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(dest);
    const lfo = c.createOscillator();
    lfo.frequency.value = 4.8;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + Math.min(0.6, dur * 0.4));
    lg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(1.3, dur * 0.8));
    lfo.connect(lg);
    lg.connect(o1.frequency);
    for (const osc of [o1, o2, lfo]) {
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
    this.noise(dest, t, { dur, vol: vol * 0.18, a: 0.08, type: 'bandpass', f: f * 2, q: 1.2 }); // 숨
    this.noise(dest, t, { dur: 0.14, vol: vol * 0.3, a: 0.01, type: 'bandpass', f: f * 3, q: 2 }); // 첫 김
  }

  /** 장구 한 타. tok: D 덩 · K 쿵 · k 덕 · g 기 · gk 기덕 · r 더러러러 */
  janggu(dest, t, tok, vol) {
    const gung = (tt, v) => {
      this.tone(dest, tt, { f: 118, f1: 62, glide: 0.1, dur: 0.5, vol: v, a: 0.002 });
      this.noise(dest, tt, { dur: 0.07, vol: v * 0.35, a: 0.001, type: 'lowpass', f: 300 });
    };
    const chae = (tt, v) => {
      this.noise(dest, tt, { dur: 0.06, vol: v * 0.55, a: 0.001, type: 'bandpass', f: 3000, q: 1.4 });
      this.tone(dest, tt, { type: 'triangle', f: 620, f1: 420, dur: 0.05, vol: v * 0.25, a: 0.001 });
    };
    switch (tok) {
      case 'D':
        gung(t, vol);
        chae(t, vol * 0.8);
        break;
      case 'K':
        gung(t, vol);
        break;
      case 'k':
        chae(t, vol);
        break;
      case 'g':
        chae(t, vol * 0.4);
        break;
      case 'gk':
        chae(t, vol * 0.35);
        chae(t + 0.07, vol);
        break;
      case 'r':
        for (let i = 0; i < 4; i++) chae(t + i * 0.045, vol * (0.55 - i * 0.1));
        break;
    }
  }

  /** 꽹과리 쇳소리 */
  metal(dest, t, vol, p = 1) {
    const c = this.ctx;
    const bp = this.biquad('bandpass', 3200 * p, 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    for (const r of [1, 1.47, 1.93, 2.51, 3.07]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = 820 * r * p;
      o.connect(bp);
      o.start(t);
      o.stop(t + 0.4);
    }
    bp.connect(g);
    g.connect(dest);
    this.noise(dest, t, { dur: 0.12, vol: vol * 0.6, a: 0.001, type: 'highpass', f: 5000 });
  }

  /** 종: 배음 묶음 */
  bell(dest, t, f, o = {}) {
    const dur = o.dur ?? 1.2, vol = o.vol ?? 0.25;
    for (const [r, amp, dk] of o.parts || BELL_PARTS) this.tone(dest, t, { f: f * r, dur: dur * dk, vol: vol * amp, a: 0.002 });
    if (!o.noClick) this.noise(dest, t, { dur: 0.03, vol: vol * 0.5, a: 0.001, type: 'highpass', f: 3000 });
  }

  /** 새소리: tweet(짹짹) · whistle(휘파람새) · cuckoo(뻐꾹) */
  chirp(dest, t, kind, p = 1) {
    if (kind === 'cuckoo') {
      this.tone(dest, t, { f: 690 * p, f1: 675 * p, dur: 0.24, vol: 0.5, a: 0.02, hold: 0.1 });
      this.tone(dest, t + 0.32, { f: 560 * p, f1: 540 * p, dur: 0.34, vol: 0.45, a: 0.02, hold: 0.14 });
      return;
    }
    if (kind === 'whistle') {
      this.tone(dest, t, { f: 2600 * p, f1: 3400 * p, glide: 0.12, dur: 0.18, vol: 0.4, a: 0.01 });
      this.tone(dest, t + 0.22, { f: 3300 * p, f1: 2200 * p, dur: 0.3, vol: 0.35, a: 0.01 });
      return;
    }
    const n = 2 + Math.floor(Math.random() * 4), base = rr(3000, 4200) * p;
    for (let i = 0; i < n; i++) {
      const tt = t + i * rr(0.07, 0.11);
      this.tone(dest, tt, { f: base * rr(0.9, 1.05), f1: base * rr(1.15, 1.35), glide: 0.04, dur: 0.06, vol: 0.4, a: 0.004 });
    }
  }

  // ------------------------------------------------------------ 내부

  _setParam(param, v) {
    if (!param || !this.ctx) return;
    param.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }
  _applyMaster() {
    this._setParam(this.masterGain?.gain, this._muted ? 0 : this.masterVolume);
  }
  _loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (Number.isFinite(s.master)) this.masterVolume = clamp(s.master, 0, 1);
        if (Number.isFinite(s.music)) this.musicVolume = clamp(s.music, 0, 1);
        if (Number.isFinite(s.sfx)) this.sfxVolume = clamp(s.sfx, 0, 1);
        if (Number.isFinite(s.ambient)) this.ambientVolume = clamp(s.ambient, 0, 1);
        this._muted = !!s.muted;
      }
    } catch {
      /* 저장소 없음 */
    }
  }
  _saveSettings() {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ master: this.masterVolume, music: this.musicVolume, sfx: this.sfxVolume, ambient: this.ambientVolume, muted: this._muted })
      );
    } catch {
      /* 저장소 없음 */
    }
  }
  _pruneVoices(now) {
    let w = 0;
    for (const e of this._voices) if (e > now) this._voices[w++] = e;
    this._voices.length = w;
  }
  _listener() {
    const p = this.game.player;
    if (p && Number.isFinite(p.x)) return p;
    const cam = this.game.camera;
    return cam ? { x: cam.x, y: cam.y } : { x: 0, y: 0 };
  }
  _combat() {
    this._combatUntil = this.game.realTime + 25;
  }
  _duck(sec) {
    const p = this.musicDuck?.gain;
    if (!p) return;
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(0.35, now, 0.08);
    p.setTargetAtTime(1, now + sec, 0.8);
  }

  _bindEvents() {
    const g = this.game;
    const on = (name, fn) => g.on(name, (e) => this.ctx && fn(e || {}));
    on('shot', (e) => {
      const s = e.shooter;
      const x = e.x ?? s?.x, y = e.y ?? s?.y;
      this.play(this._weaponSound(e.weapon), { x, y, volume: s?.isPlayer ? 1 : 0.9 });
      const p = g.player;
      if (s?.isPlayer) this._combat();
      else if (p && s && s.faction !== 'hunter' && Math.hypot(x - p.x, y - p.y) < 50) this._combat();
    });
    on('hit', (e) => {
      const t = e.target;
      if (!t) return;
      const k = this._weaponKind(e.weapon);
      this.play(k === 'fist' ? 'punch' : 'hit', { x: t.x, y: t.y, volume: clamp(0.5 + (e.amount || 10) / 60, 0.4, 1) });
      if (t.isPlayer) this._combat();
    });
    on('kill', (e) => {
      const v = e.victim;
      if (!v) return;
      if (v.kind === 'human') this.play('death', { x: v.x, y: v.y });
      else if (v.kind === 'animal') this.play('death', { x: v.x, y: v.y, pitch: 0.8, volume: 0.7 });
    });
    on('item:add', () => g.state === 'play' && this.play('pickup'));
    on('money', (e) => (e.delta ?? 0) > 0 && g.state === 'play' && this.play('coin'));
    on('buy', () => this.play('coin', { pitch: 0.9 }));
    on('sell', () => this.play('coin'));
    on('gather', () => this.play('gather'));
    on('skin', () => this.play('skin'));
    on('craft', () => this.play('craft'));
    on('vehicle:enter', (e) => {
      const v = e.vehicle, h = e.human;
      if (!v) return;
      const pos = { x: v.x, y: v.y };
      if (HORSES.has(v.vtype) || v.moveMode === 'horse') {
        if (h?.isPlayer || Math.random() < 0.4) {
          const pitch = v.vtype === 'pony' || v.vtype === 'jeju_horse' ? 1.15 : v.vtype === 'western_horse' ? 0.9 : 1;
          this.play('horse_neigh', { ...pos, pitch: pitch * rr(0.95, 1.05) });
        }
      } else if (v.moveMode === 'boat') this.play('oar', { ...pos, volume: 0.5 });
      else if (h?.isPlayer) this.play('door', { ...pos, volume: 0.45 });
    });
    on('vehicle:crash', (e) => {
      const v = e.vehicle;
      this.play('bump', { x: v?.x, y: v?.y, volume: clamp((e.speed || 3) / 8, 0.3, 1) });
    });
    on('rail:depart', (e) => {
      const id = typeof e.line === 'string' ? e.line : e.line?.id;
      const v = e.vehicle, pos = v ? { x: v.x, y: v.y } : {};
      if (id === 'tram') this.play('tram_bell', pos);
      else if (id === 'steamer') this.play('train_whistle', { ...pos, pitch: 0.6, long: true });
      else {
        this.play('train_whistle', pos);
        this.play('steam', { ...pos, delay: 0.4 });
      }
    });
    on('rail:arrive', (e) => {
      const id = typeof e.line === 'string' ? e.line : e.line?.id;
      const v = e.vehicle, pos = v ? { x: v.x, y: v.y } : {};
      if (id === 'tram') this.play('tram_bell', { ...pos, volume: 0.6 });
      else this.play('steam', pos);
    });
    on('wanted:change', (e) => {
      const lv = e.level ?? 0;
      if (lv > this._lastWanted) {
        this.play('wanted');
        this._combat();
      }
      this._lastWanted = lv;
    });
    on('hoan:start', () => this.play('hoan_in', { important: true }));
    on('hoan:end', () => this.play('hoan_out', { important: true }));
    on('mission:start', () => {
      this.play('mission_start', { important: true });
      this._duck(3);
    });
    const endMission = (snd) => {
      this.play(snd, { important: true });
      this._duck(4);
      if (this.musicMode === 'manual' && this._manualInMission) this.music('auto');
    };
    on('mission:complete', () => endMission('mission_complete'));
    on('mission:fail', () => endMission('mission_fail'));
    on('ui:panel', (e) => this.play(e.open ? 'ui_open' : 'ui_close'));
    on('player:dead', () => {
      this.play('death', { important: true });
      this.play('mission_fail', { delay: 0.8, important: true });
      this._hold = true;
    });
    on('player:respawn', () => (this._hold = false));
    on('game:start', () => (this._hold = false));
    on('time:hour', (e) => (e.hour === 6 || e.hour === 18) && this.play('temple_bell', { volume: 0.55 }));
  }

  _weaponDef(w) {
    if (w && typeof w === 'object') return w;
    const W = this.game.sys.combat?.WEAPONS;
    if (!w || !W) return null;
    return Array.isArray(W) ? W.find((x) => x?.id === w) || null : W[w] || null;
  }
  _weaponKind(w) {
    const def = this._weaponDef(w);
    if (def?.kind) return def.kind;
    return /fist|주먹/.test(String(w || '')) ? 'fist' : 'melee';
  }
  /** 무기 → 총소리 이름. 무기 정의에 sound 가 있으면 그것을 쓴다 */
  _weaponSound(w) {
    const def = this._weaponDef(w);
    if (def?.sound && (SFX[def.sound] || ALIAS[def.sound])) return def.sound;
    const s = `${typeof w === 'string' ? w : def?.id || ''} ${def?.name || ''}`.toLowerCase();
    if (/match|hwaseung|jochong|화승|조총/.test(s)) return 'gun_matchlock';
    if (/revolver|pistol|yukhyeol|육혈|권총|단총/.test(s)) return 'gun_revolver';
    if (/bow|arrow|gakgung|활|궁/.test(s)) return 'bow';
    if (/rifle|carbine|murata|snider|winchester|mauser|양총|소총|장총|엽총|shotgun/.test(s)) return 'gun_rifle';
    const k = def?.kind;
    if (k === 'bow') return 'bow';
    if (k === 'melee' || k === 'fist' || k === 'throw') return 'swing';
    return 'gun_rifle';
  }

  // ------------------------------------------------------------ 주변 감지·환경음

  _surface(x, y) {
    const w = this.game.world;
    if (!w) return 'ground';
    try {
      if (w.isWater?.(x, y)) return 'water';
      const T = w.T || {};
      const id = w.terrainAt?.(x, y);
      if (id != null) {
        if (id === T.BRIDGE || id === T.PIER) return 'wood';
        if (id === T.SAND || id === T.MUD || id === T.PADDY) return 'soft';
        if (id === T.ROAD || id === T.MAIN_ROAD || id === T.STREET || id === T.YARD || id === T.ROCK || id === T.RAIL) return 'road';
      }
      if (w.isRoad?.(x, y)) return 'road';
    } catch {
      /* 월드 없음 */
    }
    return 'ground';
  }

  _sense() {
    const g = this.game, w = g.world, E = this._env;
    if (!w) return;
    const L = this._listener();
    const T = w.T || {};
    let n = 0, ws = 0, ss = 0, fs = 0, ms = 0, ps = 0;
    try {
      for (const r of [5, 14, 30]) {
        const wt = r === 5 ? 1.4 : r === 14 ? 1 : 0.6;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + r * 0.37;
          const x = L.x + Math.cos(a) * r, y = L.y + Math.sin(a) * r;
          n += wt;
          const id = w.terrainAt?.(x, y);
          if (w.isWater?.(x, y)) {
            ws += wt;
            if (T.SEA != null && id === T.SEA) ss += wt;
          }
          if (T.FOREST != null && id === T.FOREST) fs += wt;
          if ((T.MOUNTAIN != null && id === T.MOUNTAIN) || (T.ROCK != null && id === T.ROCK)) ms += wt;
          if (T.PADDY != null && id === T.PADDY) ps += wt;
        }
      }
    } catch {
      return;
    }
    E.water = clamp((ws / n) * 2.2, 0, 1);
    E.sea = ws ? ss / ws : 0;
    E.forest = clamp((fs / n) * 1.8, 0, 1);
    E.mountain = clamp((ms / n) * 1.8, 0, 1);
    E.paddy = clamp((ps / n) * 2, 0, 1);
    let town = 0;
    const places = w.places;
    if (places && typeof places === 'object') {
      for (const k in places) {
        const pl = places[k];
        const wt = TOWN_W[pl?.kind];
        if (!wt || !Number.isFinite(pl.x)) continue;
        const R = pl.radius || 80;
        const d = Math.hypot(pl.x - L.x, pl.y - L.y);
        if (d < R * 1.3) town = Math.max(town, wt * clamp(1.3 - d / R, 0, 1));
      }
    }
    E.town = clamp(town, 0, 1);
    let people = 0;
    try {
      people = g.query(L.x, L.y, 22, (e) => e.kind === 'human' && e.state !== 'dead' && !e.isPlayer).length;
    } catch {
      /* 없음 */
    }
    E.crowd = clamp((people - 2) / 10, 0, 1);
  }

  _updateAmbient(paused) {
    const L = this._ambL;
    if (!L) return;
    const g = this.game, E = this._env, now = this.ctx.currentTime;
    const tm = g.sys.time;
    const light = Number.isFinite(tm?.light) ? tm.light : 1;
    const night = 1 - light;
    const wx = tm?.weather;
    const rain = Number.isFinite(tm?.fx?.rain) ? clamp(tm.fx.rain, 0, 1) : wx === 'storm' ? 1 : wx === 'rain' ? 0.6 : 0;
    const windS = tm?.wind?.strength ?? 0.35;
    const T = { wind: 0, water: 0, sea: 0, rain, crowd: 0, insects: 0, birds: 0, frogs: 0, owl: 0 };
    const mode = this.ambientMode;
    if (mode === 'auto') {
      T.wind = clamp(0.12 + windS * 0.55 + E.mountain * 0.25 + E.sea * E.water * 0.2 - E.town * 0.15, 0, 1) * (1 - 0.3 * E.forest);
      T.water = E.water;
      T.sea = E.sea;
      T.crowd = clamp(E.town * 0.6 + E.crowd * 0.6, 0, 1) * (1 - night * 0.75) * (1 - rain * 0.5);
      const rural = (1 - E.town * 0.8) * (1 - rain * 0.85);
      T.insects = clamp((night - 0.5) * 2, 0, 1) * rural * (1 - E.sea * E.water * 0.6);
      T.birds = light > 0.55 ? (0.25 + E.forest * 0.75) * (1 - E.town * 0.6) * (1 - rain) : 0;
      T.frogs = clamp((night - 0.4) * 2, 0, 1) * E.paddy * (1 - rain * 0.3);
      T.owl = clamp((night - 0.6) * 2.5, 0, 1) * (0.3 + E.forest * 0.7) * rural;
    } else if (mode === 'off') {
      T.rain = 0;
    } else {
      const k = AMB_KIND[mode];
      if (k === 'sea') {
        T.water = 0.85;
        T.sea = 1;
      } else if (k) T[k] = 0.85;
    }
    const duck = paused ? 0.45 : 1;
    this._amb = { ...T, birds: T.birds * duck, frogs: T.frogs * duck, owl: T.owl * duck };
    const set = (param, v, tc = 1) => param.setTargetAtTime(v, now, tc);
    const t = this._t;
    // 바람: 돌풍
    const gust = 0.5 + 0.3 * Math.sin(t * 0.37) + 0.2 * Math.sin(t * 0.13 + 1.7);
    set(L.wind.g.gain, T.wind * 0.45 * (0.6 + gust * 0.6) * duck, 1.2);
    set(L.wind.f.frequency, 260 + windS * 520 + gust * 220, 0.8);
    // 물: 바다는 7~8초 주기로 밀려오는 파도, 강은 고른 물살
    const swell = 0.5 + 0.5 * Math.sin((t * TAU) / 7.6);
    const sea = T.sea;
    set(L.water.g.gain, T.water * ((1 - sea) * 0.42 + sea * (0.2 + 0.42 * swell)) * duck, 0.6);
    set(L.water.f.frequency, (1 - sea) * 650 + sea * (380 + 650 * swell), 0.6);
    set(L.water.g2.gain, (1 - sea) * (0.25 + Math.random() * 0.3) + sea * 0.12, 0.15);
    // 비
    set(L.rain.g.gain, T.rain * 0.5 * duck, 1.5);
    // 장터: 말소리 대역을 마구 출렁여 웅성임
    set(L.crowd.g.gain, T.crowd * 0.5 * duck, 1);
    set(L.crowd.gA.gain, 0.25 + Math.random() * 0.75, 0.08);
    set(L.crowd.gB.gain, 0.15 + Math.random() * 0.65, 0.08);
    // 풀벌레
    set(L.insects.g.gain, T.insects * 0.045 * duck, 1.5);
  }

  _ambVoice(vol, pan) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = vol;
    let tail = g;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(this.ambBus);
    return g;
  }

  /** 새·소쩍새·개구리 같은 띄엄띄엄 나는 소리 */
  _critters(rdt) {
    const T = this._amb;
    if (!T || this._muted) return;
    const now = this.ctx.currentTime;
    if (T.birds > 0.05 && (this._birdT -= rdt) <= 0) {
      this._birdT = rr(1.2, 5) / (0.4 + T.birds);
      const r = Math.random();
      const kind = r < 0.22 ? 'cuckoo' : r < 0.4 ? 'whistle' : 'tweet';
      this.chirp(this._ambVoice(rr(0.06, 0.13) * T.birds * (kind === 'cuckoo' ? 0.7 : 1), rr(-0.8, 0.8)), now + 0.02, kind, rr(0.92, 1.08));
    }
    if (T.owl > 0.05 && (this._owlT -= rdt) <= 0) {
      // 소쩍 소쩍
      this._owlT = rr(9, 22);
      const d = this._ambVoice(0.07 * T.owl, rr(-0.7, 0.7));
      const n = 2 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) {
        const tt = now + 0.02 + k * 0.95;
        this.tone(d, tt, { f: 1180, f1: 1150, dur: 0.12, vol: 0.5, a: 0.01 });
        this.tone(d, tt + 0.2, { f: 1020, f1: 980, dur: 0.22, vol: 0.55, a: 0.015, hold: 0.06 });
      }
    }
    if (T.frogs > 0.05 && (this._frogT -= rdt) <= 0) {
      // 개굴개굴
      this._frogT = rr(0.25, 1.6) / (0.3 + T.frogs);
      const c = this.ctx, d = this._ambVoice(0.05 * T.frogs, rr(-0.9, 0.9));
      const n = 2 + Math.floor(Math.random() * 3), f0 = rr(180, 320);
      for (let i = 0; i < n; i++) {
        const tt = now + 0.02 + i * rr(0.09, 0.14);
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(f0, tt);
        o.frequency.linearRampToValueAtTime(f0 * 1.25, tt + 0.06);
        const bp = this.biquad('bandpass', 1100, 4);
        const gg = c.createGain();
        gg.gain.setValueAtTime(0.0001, tt);
        gg.gain.linearRampToValueAtTime(0.5, tt + 0.005);
        gg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.07);
        o.connect(bp);
        bp.connect(gg);
        gg.connect(d);
        o.start(tt);
        o.stop(tt + 0.1);
      }
    }
  }

  // ------------------------------------------------------------ 발소리·발굽·탈것

  _footsteps() {
    const p = this.game.player;
    if (!p || p.vehicle || p.state !== 'normal' || !this.auto.steps) {
      this._stepK = null;
      return;
    }
    const k = Math.floor((p.walkPhase || 0) / Math.PI);
    if (this._stepK === null || k === this._stepK) {
      this._stepK = k;
      return;
    }
    this._stepK = k;
    if ((p.speedNow || 0) < 0.4) return;
    if (p.swimming) {
      if (k % 2 === 0) this.play('splash', { volume: 0.16, pitch: 1.4 });
      return;
    }
    const vol = p.crouching ? 0.22 : p.gait === 'sprint' ? 0.75 : p.gait === 'run' ? 0.55 : 0.4;
    this.play('step', { volume: vol, surface: this._surface(p.x, p.y), pitch: rr(0.9, 1.1) });
  }

  _vehicleSounds() {
    const p = this.game.player;
    const v = p?.vehicle;
    const now = this.ctx.currentTime;
    if (!v) {
      this._hoofT = this._railT = 0;
      return;
    }
    const sp = Math.abs(Number.isFinite(v.speed) ? v.speed : Math.hypot(v.vx || 0, v.vy || 0));
    if (this.auto.hooves && (HORSES.has(v.vtype) || v.moveMode === 'horse')) {
      if (sp < 0.35) this._hoofT = 0;
      else {
        // 평보(4박) · 속보(2박) · 습보(다그닥 3박)
        let P, offs, vol;
        if (sp < 2.4) {
          P = clamp(1.3 - sp * 0.18, 0.85, 1.25);
          offs = [0, 0.25, 0.5, 0.75];
          vol = 0.32;
        } else if (sp < 5.5) {
          P = clamp(0.78 - (sp - 2.4) * 0.05, 0.58, 0.78);
          offs = [0, 0.5];
          vol = 0.45;
        } else {
          P = clamp(0.6 - (sp - 5.5) * 0.025, 0.4, 0.6);
          offs = [0, 0.16, 0.32];
          vol = 0.55;
        }
        if (this._hoofT < now) this._hoofT = now + 0.03;
        if (this._hoofT < now + 0.15) {
          const surface = this._surface(v.x, v.y);
          for (const o of offs) this.play('hoof', { at: this._hoofT + o * P, surface, volume: vol * rr(0.85, 1.1), pitch: rr(0.92, 1.08) });
          this._hoofT += P;
        }
      }
    }
    if (this.auto.rail && v.moveMode === 'rail') {
      if (sp < 1) this._railT = 0;
      else {
        if (this._railT < now) this._railT = now + 0.05;
        if (this._railT < now + 0.15) {
          this.play('rail_clack', { at: this._railT, volume: clamp(sp / 12, 0.25, 0.7), pitch: v.vtype === 'tram' ? 1.2 : 1 });
          this._railT += clamp(13 / sp, 0.3, 3);
        }
      }
    }
    if (this.auto.oar && v.vtype === 'rowboat' && v.driver === p && sp > 0.3) {
      if ((this._oarT -= 1 / 60) <= 0) {
        this._oarT = clamp(2.2 - sp * 0.4, 1, 2);
        this.play('oar', { volume: 0.45 });
      }
    }
  }

  // ------------------------------------------------------------ 배경음

  _pickTrack() {
    const g = this.game;
    if (g.state !== 'play') return 'title';
    if ((g.sys.wanted?.level ?? 0) > 0 || g.realTime < this._combatUntil) return 'wanted';
    if (g.sys.time?.isNight?.()) return 'night';
    if (this._env.town > 0.5) return 'town';
    return 'day';
  }

  _autoMusic(rdt) {
    if (this.musicMode === 'manual') {
      this._setTrack(this._manualTrack);
      return;
    }
    if (this._hold) {
      this._setTrack(null);
      return;
    }
    const want = this._pickTrack();
    if (want === this.track) {
      this._candidate = null;
      return;
    }
    if (want === 'wanted' || this.track == null) {
      this._setTrack(want);
      return;
    }
    if (this._candidate !== want) {
      this._candidate = want;
      this._candidateT = 0;
    }
    if ((this._candidateT += rdt) > 4) this._setTrack(want);
  }

  _setTrack(id) {
    const c = this.ctx;
    if (!c || id === this.track) return;
    this.track = id;
    this._candidate = null;
    const now = c.currentTime;
    for (const pl of this._players) {
      if (pl.stopAt) continue;
      const gp = pl.out.gain;
      gp.cancelScheduledValues(now);
      gp.setValueAtTime(Math.max(0.0001, gp.value), now);
      gp.linearRampToValueAtTime(0.0001, now + FADE);
      pl.stopAt = now + FADE;
    }
    const def = id && TRACKS[id];
    if (!def) return;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.linearRampToValueAtTime(1, now + FADE);
    out.connect(this.musicDuck);
    this._players.push({ id, def, jd: JANGDAN[def.jd], out, nextT: now + 0.15, step: 0, cycle: 0, deg: Math.round((def.lo + def.hi) / 2), fdeg: def.lo + 5, rest: 0, stopAt: 0 });
  }

  _scheduleMusic() {
    const c = this.ctx, now = c.currentTime, ahead = now + 0.2;
    const slow = (this.game.timeScale ?? 1) < 0.85 ? 1.8 : 1; // 호안 땐 장단도 늘어진다
    for (let i = this._players.length - 1; i >= 0; i--) {
      const pl = this._players[i];
      if (pl.stopAt && now > pl.stopAt + 3.5) {
        try {
          pl.out.disconnect();
        } catch {
          /* 이미 끊김 */
        }
        this._players.splice(i, 1);
        continue;
      }
      if (pl.nextT < now - 0.3) pl.nextT = now + 0.05;
      let guard = 0;
      while (pl.nextT < ahead && guard++ < 16) {
        if (!this._muted && (!pl.stopAt || pl.nextT < pl.stopAt)) this._musicStep(pl, pl.nextT);
        pl.nextT += pl.def.slot * slow;
      }
    }
  }

  _musicStep(pl, t) {
    const d = pl.def, pat = pl.jd.pat, n = pat.length, beat = pl.jd.beat;
    const i = pl.step % n;
    const strong = i % beat === 0;
    const out = pl.out;
    const tok = pat[i];
    if (tok && d.drum > 0) {
      if (!d.sparse || Math.random() < d.sparse) this.janggu(out, t, tok, d.drum * (i === 0 ? 1 : 0.8));
    } else if (d.drum > 0 && !d.sparse && Math.random() < 0.05) this.janggu(out, t, 'g', d.drum * 0.6); // 즉흥 꾸밈
    const phrasePos = pl.cycle % 4;
    if (i === 0 && phrasePos === 0 && pl.cycle > 0) {
      // 악구 첫 박: 으뜸음에 내려앉아 길게 농현
      pl.deg = nearestTonic(pl.deg, d.lo, d.hi);
      this.pluck(out, t, noteFreq(d.scale, pl.deg), { dur: 2.6, vol: d.pluck, orn: 'vib', bright: d.bright });
      if (d.bass) this.pluck(out, t + 0.02, noteFreq(d.scale, pl.deg - 5), { dur: 2.8, vol: d.pluck * d.bass, bright: 0.6 });
      pl.rest = beat - 1;
    } else if (pl.rest > 0) pl.rest--;
    else {
      let prob = d.mel * (strong ? 1.5 : 0.65);
      if (phrasePos === 3 && i >= n - beat) prob *= 0.3; // 악구 끝 숨 고르기
      if (Math.random() < prob) {
        let step;
        if (d.repeat && Math.random() < d.repeat) step = 0;
        else if (phrasePos === 3) step = Math.sign(nearestTonic(pl.deg, d.lo, d.hi) - pl.deg) || (Math.random() < 0.5 ? -1 : 1);
        else step = STEPS[Math.floor(Math.random() * STEPS.length)];
        let nd = pl.deg + step;
        if (nd < d.lo) nd = d.lo + 1;
        if (nd > d.hi) nd = d.hi - 1;
        pl.deg = nd;
        this.pluck(out, t, noteFreq(d.scale, nd), {
          dur: strong ? rr(1.5, 2.2) : rr(0.9, 1.4),
          vol: d.pluck * (strong ? 1 : 0.72) * rr(0.85, 1.05),
          orn: ornamentFor(d.scale, nd, strong),
          bright: d.bright,
        });
        if (strong && Math.random() < 0.18) this.pluck(out, t + 0.03, noteFreq(d.scale, nd - 5), { dur: 1.6, vol: d.pluck * 0.4, bright: 0.7 });
      }
    }
    // 대금: 장단 첫 박에 가끔 길게
    if (d.flute && i === 0 && Math.random() < d.flute) {
      let fd = pl.fdeg + STEPS[Math.floor(Math.random() * STEPS.length)];
      fd = clamp(fd, d.lo + 3, d.hi + 3);
      pl.fdeg = fd;
      this.flute(out, t, noteFreq(d.scale, fd), { dur: d.slot * n * rr(1.1, 2), vol: d.fluteVol ?? 0.11 });
    }
    pl.step++;
    if (i === n - 1) pl.cycle++;
  }
}

export function install(game) {
  const audio = new AudioSystem(game);
  game.registerSystem(audio);
  audio._bindEvents();
  return audio;
}
