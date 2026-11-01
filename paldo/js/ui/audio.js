// WebAudio 합성 효과음. 첫 클릭 때 unlock(). 실패해도 게임은 돈다.
import { store } from './dom.js';
let ctx = null, master = null;
let muted = store.get('paldo.mute') === '1';
export const audio = {
  get muted() { return muted; },
  toggle() { muted = !muted; store.set('paldo.mute', muted ? '1' : '0'); return muted; },
  unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch { ctx = null; }
  },
  play(name) {
    if (muted || !ctx) return;
    try { (SFX[name] || SFX.click)(); } catch { /* 무시 */ }
  },
};
function tone(freq, dur, type = 'sine', vol = 0.3, when = 0, glide) {
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, vol = 0.3, when = 0, hp = 800, lp = 6000) {
  const t = ctx.currentTime + when;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f1 = ctx.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(master);
  s.start(t);
}
const PENTA = [262, 294, 330, 392, 440, 523, 587, 659];
const SFX = {
  click: () => tone(880, 0.07, 'triangle', 0.12),
  pluck: () => { tone(392, 0.4, 'triangle', 0.2); tone(784, 0.25, 'sine', 0.05); },
  gong: () => { tone(110, 2.2, 'sine', 0.35); tone(166, 1.8, 'sine', 0.15); tone(232, 1.2, 'sine', 0.07); },
  drum: () => { tone(70, 0.35, 'sine', 0.5, 0, 40); noise(0.12, 0.25, 0, 100, 1200); },
  drums: () => { for (let i = 0; i < 4; i++) { tone(68, 0.3, 'sine', 0.45, i * 0.22, 40); noise(0.1, 0.2, i * 0.22, 100, 1000); } },
  clash: () => { noise(0.18, 0.35, 0, 2500, 9000); tone(1800, 0.15, 'square', 0.04, 0, 900); },
  hit: () => { noise(0.1, 0.4, 0, 400, 3000); tone(140, 0.12, 'sine', 0.3, 0, 60); },
  win: () => { [0, 2, 4, 5, 7].forEach((n, i) => tone(PENTA[n], 0.5, 'triangle', 0.2, i * 0.13)); tone(110, 1.5, 'sine', 0.2, 0.7); },
  lose: () => { [5, 4, 2, 1, 0].forEach((n, i) => tone(PENTA[n] / 2, 0.6, 'sine', 0.18, i * 0.18)); },
  good: () => { tone(523, 0.18, 'triangle', 0.15); tone(784, 0.3, 'triangle', 0.12, 0.1); },
  bad: () => { tone(220, 0.35, 'sawtooth', 0.06, 0, 160); },
  turn: () => { tone(196, 0.9, 'triangle', 0.15); tone(294, 0.9, 'triangle', 0.08, 0.15); },
};
