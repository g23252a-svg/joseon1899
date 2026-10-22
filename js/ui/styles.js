// UI 스타일: 한지 바탕·먹 테두리·붉은 낙관. <style> 요소로 주입한다(별도 CSS 파일 없음).
// 질감은 inline SVG(data URI) — feTurbulence 노이즈와 붓 테두리(굵기 불균일) 를 코드로 만든다.

import { FONT, PAL } from '../engine/palette.js';
import { mixHex, mulberry32, rgba } from '../engine/util.js';

const svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** 한지 잔티 (고운 노이즈) */
const NOISE = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 0.30 0 0 0 0 0.24 0 0 0 0 0.15 0 0 0 0.55 -0.18'/></filter>` +
    `<rect width='180' height='180' filter='url(#n)'/></svg>`
);
/** 닥나무 섬유 결 (가로로 긴 무늬) */
const FIBER = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='f' x='0' y='0' width='100%' height='100%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.006 0.07' numOctaves='3' seed='3' stitchTiles='stitch'/>` +
    `<feColorMatrix values='0 0 0 0 0.42 0 0 0 0 0.35 0 0 0 0 0.22 0 0 0 0.5 -0.3'/></filter>` +
    `<rect width='320' height='320' filter='url(#f)'/></svg>`
);
/** 비단 장황 무늬 (두루마리 테두리) */
const SILK = svgUrl(
  `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'>` +
    `<path d='M0 12 Q6 6 12 12 T24 12' fill='none' stroke='${rgba(PAL.paper, 0.09)}' stroke-width='1'/>` +
    `<path d='M0 0 L24 24' stroke='${rgba(PAL.ink, 0.08)}' stroke-width='0.6'/></svg>`
);

/**
 * 굵기가 고르지 않은 붓 테두리 SVG (100×100, border-image-slice 10 용).
 * 각 변은 시작이 굵고 끝이 가늘며, 모서리에서 붓이 조금 삐져나간다.
 */
function brushFrame(seed, color = PAL.ink, thick = 1) {
  const R = mulberry32(seed);
  const N = 100, K = 14;
  const outer = [], inner = [];
  const sides = [
    { p: (u) => [u * N, 0], n: [0, 1] },
    { p: (u) => [N, u * N], n: [-1, 0] },
    { p: (u) => [N - u * N, N], n: [0, -1] },
    { p: (u) => [0, N - u * N], n: [1, 0] },
  ];
  for (const s of sides) {
    const ph = R() * 6.28, start = 6.2 + R() * 2.4, end = 3.4 + R() * 1.4;
    for (let k = 0; k < K; k++) {
      const u = 0.035 + (k / (K - 1)) * 0.93;
      const [bx, by] = s.p(u);
      const o = 0.4 + R() * 1.1;
      const t = (start + (end - start) * u + Math.sin(u * 9 + ph) * 0.9) * thick;
      outer.push([bx + s.n[0] * o, by + s.n[1] * o]);
      inner.push([bx + s.n[0] * Math.min(9.4, o + t), by + s.n[1] * Math.min(9.4, o + t)]);
    }
  }
  const path = (pts) => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L') + ' Z';
  // 마른 붓 자국: 안쪽에 옅은 가는 선
  const dry = `<path d='M3 ${(5 + R() * 2).toFixed(1)} L${(60 + R() * 30).toFixed(1)} ${(4 + R() * 2).toFixed(1)}' stroke='${color}' stroke-opacity='0.25' stroke-width='0.6' fill='none'/>`;
  return svgUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'>` +
      `<path fill='${color}' fill-rule='evenodd' d='${path(outer)} ${path(inner)}'/>${dry}</svg>`
  );
}

export function buildCSS() {
  const indigo = mixHex(PAL.seaDeep, PAL.night, 0.45);
  const silk = mixHex(PAL.roofTile, PAL.paperShade, 0.22);
  const wood = PAL.timber;
  const woodDark = mixHex(PAL.timber, PAL.ink, 0.5);
  const woodLight = mixHex(PAL.timber, PAL.roofThatch, 0.5);
  const paperA = (a) => rgba(PAL.paper, a);
  const inkA = (a) => rgba(PAL.ink, a);

  return `
#ui > .jx-root {
  --jx-paper: ${PAL.paper}; --jx-paper2: ${PAL.paperDeep}; --jx-paper3: ${PAL.paperShade};
  --jx-ink: ${PAL.ink}; --jx-ink2: ${PAL.ink2}; --jx-ink3: ${PAL.ink3};
  --jx-seal: ${PAL.seal}; --jx-gold: ${PAL.gold}; --jx-green: ${PAL.dancheongGreen}; --jx-indigo: ${indigo};
  --jx-blood: ${PAL.blood};
  --jx-body: ${FONT.body}; --jx-display: ${FONT.display}; --jx-brush: ${FONT.brush};
  --jx-noise: ${NOISE}; --jx-fiber: ${FIBER};
  --jx-frame: ${brushFrame(1899)}; --jx-frame2: ${brushFrame(37, PAL.ink, 0.8)}; --jx-frame3: ${brushFrame(5, PAL.ink, 0.62)};
  --jx-frame-seal: ${brushFrame(77, PAL.seal, 0.7)};
  --jx-halo: 0 0 2px ${paperA(1)}, 0 0 4px ${paperA(0.95)}, 0 0 9px ${paperA(0.75)};
  position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 1;
  font-family: var(--jx-body); color: var(--jx-ink); line-height: 1.45;
  -webkit-tap-highlight-color: transparent;
}
:where(.jx-root) *, :where(.jx-root) *::before, :where(.jx-root) *::after { box-sizing: border-box; }
:where(.jx-root) button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; pointer-events: auto; touch-action: manipulation; text-align: inherit; }
:where(.jx-root) button:disabled { cursor: default; opacity: 0.42; }
:where(.jx-root) :focus { outline: none; }
.jx-root :focus-visible { outline: 2px solid var(--jx-seal); outline-offset: 2px; }
:where(.jx-root) :where(h1, h2, h3, h4, p) { margin: 0; font-weight: 400; }
.jx-gone { display: none !important; }
:where(.jx-root) * { scrollbar-width: thin; scrollbar-color: ${inkA(0.4)} transparent; }
.jx-sr { position: absolute !important; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ---------- 바탕 재질 ---------- */
.jx-paper {
  background-color: var(--jx-paper);
  background-image: var(--jx-noise), var(--jx-fiber),
    radial-gradient(120% 90% at 25% 15%, ${rgba('#fffaf0', 0.5)}, transparent 60%),
    radial-gradient(90% 80% at 85% 95%, ${rgba(PAL.paperShade, 0.45)}, transparent 70%);
}
.jx-frame { border: 8px solid transparent; border-image: var(--jx-frame) 10 / 8px / 0 stretch; }
.jx-frame2 { border: 6px solid transparent; border-image: var(--jx-frame2) 10 / 6px / 0 stretch; }
.jx-halo { text-shadow: var(--jx-halo); }
.jx-display { font-family: var(--jx-display); }
.jx-brush { font-family: var(--jx-brush); }

/* ---------- 단추 ---------- */
.jx-btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 0.5em;
  min-height: 42px; padding: 4px 16px; font-size: 15px; letter-spacing: 0.04em; white-space: nowrap;
  border: 5px solid transparent; border-image: var(--jx-frame2) 10 / 5px / 0 stretch;
  background: var(--jx-paper) var(--jx-noise);
  transition: background-color 0.15s, color 0.15s, transform 0.08s;
}
.jx-btn:hover:not(:disabled) { background-color: var(--jx-paper2); }
.jx-btn:active:not(:disabled) { transform: translate(1px, 1px); }
.jx-btn.jx-primary { background-color: var(--jx-ink); color: var(--jx-paper); }
.jx-btn.jx-primary:hover:not(:disabled) { background-color: var(--jx-ink2); }
.jx-btn .jx-btn-hanja { font-family: var(--jx-display); font-size: 0.8em; color: var(--jx-ink3); letter-spacing: 0.15em; }
.jx-btn.jx-primary .jx-btn-hanja { color: ${paperA(0.6)}; }
.jx-key {
  display: inline-grid; place-items: center; min-width: 30px; height: 30px; padding: 0 7px;
  font-family: var(--jx-display); font-size: 15px; line-height: 1; color: var(--jx-ink); text-shadow: none;
  background: var(--jx-paper) var(--jx-noise);
  border: 4px solid transparent; border-image: var(--jx-frame3) 10 / 4px / 0 stretch;
  box-shadow: 2px 2px 0 ${inkA(0.55)};
}
.jx-key.jx-tkey { border-radius: 50%; border: 2px solid ${inkA(0.8)}; border-image: none; font-family: var(--jx-body); font-size: 12px; min-width: 34px; height: 34px; padding: 0 4px; box-shadow: none; background: ${inkA(0.78)}; color: var(--jx-paper); }
.jx-seal {
  display: inline-grid; place-items: center; background: var(--jx-seal); color: var(--jx-paper);
  font-family: var(--jx-display); line-height: 1;
  clip-path: polygon(3% 4%, 48% 0, 97% 3%, 100% 52%, 96% 97%, 50% 100%, 2% 96%, 0 47%);
}

/* ---------- HUD ---------- */
.jx-hud { position: absolute; inset: 0; pointer-events: none; transition: opacity 0.4s; }
.jx-hud.jx-off { opacity: 0; visibility: hidden; }
.jx-hud.jx-dim .jx-obj, .jx-hud.jx-dim .jx-prompts, .jx-hud.jx-dim .jx-veh { opacity: 0; }
.jx-tl { position: absolute; left: 14px; top: 12px; display: flex; align-items: flex-start; gap: 10px; }
.jx-cores { display: flex; gap: 2px; }
.jx-core { position: relative; width: 54px; height: 54px; }
.jx-core canvas { display: block; width: 100%; height: 100%; }
.jx-core.jx-low canvas { animation: jx-pulse 1.1s ease-in-out infinite; }
@keyframes jx-pulse { 50% { opacity: 0.55; } }
.jx-purse { display: flex; flex-direction: column; gap: 4px; padding-top: 3px; min-width: 0; }
.jx-money { position: relative; font-family: var(--jx-display); font-size: 20px; letter-spacing: 0.03em; white-space: nowrap; text-shadow: var(--jx-halo); }
.jx-money-delta { position: absolute; left: 100%; top: 2px; margin-left: 8px; font-family: var(--jx-body); font-size: 14px; white-space: nowrap; animation: jx-rise 1.6s ease-out forwards; }
.jx-money-delta.jx-minus { color: var(--jx-seal); }
.jx-money-delta.jx-plus { color: var(--jx-green); }
@keyframes jx-rise { from { opacity: 0; transform: translateY(6px); } 15% { opacity: 1; transform: none; } 75% { opacity: 1; } to { opacity: 0; transform: translateY(-10px); } }
.jx-wanted { display: flex; gap: 3px; }
.jx-stamp { width: 21px; height: 30px; font-size: 11px; writing-mode: vertical-rl; letter-spacing: 1px; transform: rotate(-4deg); box-shadow: 0 0 0 1px ${paperA(0.4)}; }
.jx-stamp:nth-child(2n) { transform: rotate(3deg); }
.jx-stamp.jx-new { animation: jx-stamp 0.5s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
@keyframes jx-stamp { from { transform: scale(2.1) rotate(-14deg); opacity: 0; } }
.jx-honor { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--jx-ink2); text-shadow: var(--jx-halo); white-space: nowrap; }
.jx-honor-mark { display: grid; place-items: center; width: 20px; height: 20px; font-family: var(--jx-display); font-size: 13px; text-shadow: none; border: 1.5px solid currentColor; background: ${paperA(0.82)}; transform: rotate(45deg); }
.jx-honor-mark > span { transform: rotate(-45deg); }
.jx-honor-track { position: relative; width: 46px; height: 3px; background: ${inkA(0.2)}; }
.jx-honor-track > i { position: absolute; top: -3px; width: 3px; height: 9px; margin-left: -1px; background: currentColor; }

.jx-tr { position: absolute; right: 14px; top: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.jx-mini { position: relative; width: 176px; height: 176px; pointer-events: auto; border-radius: 50%; }
.jx-mini canvas { display: block; width: 100%; height: 100%; }
.jx-where { text-align: right; text-shadow: var(--jx-halo); line-height: 1.25; padding-right: 4px; }
.jx-region { font-family: var(--jx-display); font-size: 18px; letter-spacing: 0.04em; }
.jx-clock { font-size: 13px; color: var(--jx-ink2); }

.jx-obj { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); max-width: min(calc(100% - 680px), 560px); display: flex; align-items: center; gap: 10px; font-size: 16px; line-height: 1.4; text-shadow: var(--jx-halo); transition: opacity 0.3s; }
.jx-obj-mark { flex: none; width: 16px; height: 16px; transform: rotate(45deg); }
.jx-obj-text { position: relative; padding-bottom: 4px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
.jx-obj-text::after { content: ''; position: absolute; left: 0; right: 8%; bottom: 0; height: 2px; background: linear-gradient(90deg, ${inkA(0.75)}, ${inkA(0.15)}); }
.jx-obj.jx-flash .jx-obj-text { animation: jx-bleed-in 0.9s ease-out; }

.jx-prompts { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 18px; max-width: calc(100% - 28px); transition: opacity 0.3s; }
.jx-prompt { display: inline-flex; align-items: center; gap: 9px; font-size: 16px; text-shadow: var(--jx-halo); pointer-events: none; white-space: nowrap; max-width: 100%; }
.jx-prompt > span:last-child { overflow: hidden; text-overflow: ellipsis; }
.jx-prompt.jx-in { animation: jx-bleed-in 0.35s ease-out; }

.jx-veh { position: absolute; right: 16px; bottom: 20px; text-align: right; text-shadow: var(--jx-halo); transition: opacity 0.3s, bottom 0.2s; }
.jx-veh-name { font-family: var(--jx-display); font-size: 15px; color: var(--jx-ink2); letter-spacing: 0.05em; }
.jx-veh-gait { font-family: var(--jx-brush); font-size: 34px; line-height: 1; }
.jx-veh-bar { margin: 6px 0 0 auto; width: 132px; height: 6px; background: ${paperA(0.75)}; box-shadow: 0 0 0 1px ${inkA(0.7)}; overflow: hidden; }
.jx-veh-bar > i { display: block; height: 100%; background: var(--jx-indigo); transform-origin: left; }
.jx-veh-bar.jx-low > i { background: var(--jx-seal); }

.jx-toasts { position: absolute; right: 14px; top: max(40%, 252px); width: min(330px, 72vw); display: flex; flex-direction: column; align-items: flex-end; gap: 6px; pointer-events: none; z-index: 3; }
.jx-toast { max-width: 100%; padding: 7px 12px 8px 14px; font-size: 15px; line-height: 1.4; background: ${paperA(0.95)} var(--jx-noise); border-left: 4px solid var(--jx-ink); box-shadow: 3px 3px 0 ${inkA(0.12)}, 0 0 0 1px ${inkA(0.12)}; animation: jx-toast-in 0.3s ease-out both; }
.jx-toast[data-kind='good'] { border-left-color: var(--jx-green); }
.jx-toast[data-kind='warn'] { border-left-color: var(--jx-gold); }
.jx-toast[data-kind='bad'] { border-left-color: var(--jx-seal); }
.jx-toast .jx-count { margin-left: 6px; color: var(--jx-ink3); font-size: 13px; }
.jx-toast.jx-out { animation: jx-toast-out 0.4s ease-in forwards; }
@keyframes jx-toast-in { from { opacity: 0; transform: translateX(24px); filter: blur(3px); } }
@keyframes jx-toast-out { to { opacity: 0; transform: translateX(16px); } }

.jx-banner { position: absolute; left: 0; right: 0; top: 27%; display: grid; justify-items: center; text-align: center; padding: 30px 16px 26px; pointer-events: none; z-index: 4; transition: opacity 0.7s; }
.jx-banner::before { content: ''; position: absolute; left: 50%; top: 50%; width: min(860px, 120vw); height: 100%; transform: translate(-50%, -50%); background: radial-gradient(closest-side, ${inkA(0.86)}, ${inkA(0.66)} 52%, ${inkA(0)} 100%); filter: blur(3px); animation: jx-wash 1.1s ease-out both; }
.jx-banner-title { position: relative; font-family: var(--jx-brush); font-size: clamp(46px, 9vw, 96px); line-height: 1.05; color: var(--jx-paper); animation: jx-bleed 1.2s ease-out both; max-width: 100%; overflow-wrap: anywhere; }
.jx-banner-sub { position: relative; margin-top: 6px; font-family: var(--jx-display); font-size: clamp(15px, 2.3vw, 20px); letter-spacing: 0.22em; color: ${paperA(0.88)}; animation: jx-bleed 1.3s 0.25s ease-out both; }
.jx-banner .jx-seal { position: relative; margin-top: 12px; width: 30px; height: 30px; font-size: 15px; animation: jx-stamp 0.5s 0.6s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.jx-banner.jx-out { opacity: 0; }
@keyframes jx-bleed { from { opacity: 0; filter: blur(12px); letter-spacing: 0.32em; } 55% { opacity: 1; } to { opacity: 1; filter: blur(0); } }
@keyframes jx-bleed-in { from { opacity: 0; filter: blur(5px); } to { opacity: 1; filter: blur(0); } }
@keyframes jx-wash { from { opacity: 0; transform: translate(-50%, -50%) scaleX(0.25); } to { opacity: 1; transform: translate(-50%, -50%) scaleX(1); } }

.jx-debug { position: absolute; left: 14px; bottom: 14px; z-index: 3; padding: 6px 10px; font: 12px/1.5 ui-monospace, Consolas, monospace; white-space: pre; background: ${paperA(0.9)}; border-left: 3px solid var(--jx-ink); pointer-events: none; }

.jx-fade { position: absolute; inset: 0; z-index: 12; background: var(--jx-ink); opacity: 0; pointer-events: none; transition-property: opacity; transition-timing-function: ease-in-out; }
.jx-fade.jx-on { pointer-events: auto; }

/* ---------- 대화창 ---------- */
.jx-dlg { position: absolute; left: 50%; bottom: max(18px, env(safe-area-inset-bottom)); transform: translateX(-50%); width: min(880px, calc(100% - 24px)); min-height: 128px; padding: 22px 28px 26px; z-index: 9; pointer-events: auto; cursor: pointer; animation: jx-dlg-in 0.25s ease-out; box-shadow: 0 10px 28px ${inkA(0.28)}; }
.jx-dlg.jx-choosing { cursor: default; }
@keyframes jx-dlg-in { from { opacity: 0; transform: translate(-50%, 14px); } }
.jx-dlg-speaker { position: absolute; top: -18px; left: 24px; padding: 6px 14px 7px; font-size: 17px; letter-spacing: 0.1em; transform: rotate(-1.5deg); box-shadow: 2px 2px 0 ${inkA(0.25)}; }
.jx-dlg-body { display: flex; gap: 16px; align-items: flex-start; }
.jx-dlg-portrait { flex: none; width: 64px; height: 64px; display: grid; place-items: center; font-family: var(--jx-display); font-size: 36px; border: 2px solid var(--jx-ink); background: ${paperA(0.6)}; }
.jx-dlg-portrait canvas { width: 100%; height: 100%; }
.jx-dlg-text { flex: 1; min-width: 0; font-size: clamp(16px, 2.1vw, 19px); line-height: 1.75; min-height: 3.5em; white-space: pre-wrap; overflow-wrap: anywhere; }
.jx-dlg-text.jx-narr { color: var(--jx-ink2); }
.jx-dlg-hint { position: absolute; right: 18px; bottom: 7px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--jx-ink3); }
.jx-dlg-hint b { font-weight: 400; color: var(--jx-seal); animation: jx-blink 1s steps(2) infinite; }
@keyframes jx-blink { 50% { opacity: 0; } }
.jx-choices { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 4px; }
.jx-choice { display: flex; align-items: center; gap: 12px; width: 100%; padding: 7px 10px; font-size: 16px; border-left: 3px solid transparent; }
.jx-choice:hover, .jx-choice.jx-hi { background: ${inkA(0.07)}; border-left-color: var(--jx-seal); }
.jx-choice:focus-visible { outline: none; }
.jx-choice.jx-hi:focus-visible { box-shadow: inset 0 0 0 1px ${rgba(PAL.seal, 0.55)}; }
.jx-choice .jx-key { min-width: 26px; height: 26px; font-size: 13px; }

/* ---------- 패널 (두루마리) ---------- */
.jx-panel-wrap { position: absolute; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center; pointer-events: auto; background: radial-gradient(ellipse at center, ${inkA(0.2)}, ${inkA(0.56)}); animation: jx-fadein 0.18s ease-out; }
@keyframes jx-fadein { from { opacity: 0; } }
.jx-panel { position: relative; display: flex; flex-direction: column; width: min(1000px, calc(100% - 72px)); height: min(700px, calc(100% - 76px)); padding: 11px; background: ${silk} ${SILK}; box-shadow: 0 18px 44px ${inkA(0.5)}, inset 0 0 0 1px ${inkA(0.5)}; animation: jx-unroll 0.28s ease-out; }
@keyframes jx-unroll { from { clip-path: inset(48% 0 48% 0); } to { clip-path: inset(-20px -30px -20px -30px); } }
.jx-panel::before, .jx-panel::after { content: ''; position: absolute; left: -20px; right: -20px; height: 15px; border-radius: 8px; background: linear-gradient(180deg, ${woodLight}, ${wood} 45%, ${woodDark}); box-shadow: 0 3px 4px ${inkA(0.35)}, inset 0 0 0 1px ${inkA(0.45)}; z-index: 1; }
.jx-panel::before { top: -10px; }
.jx-panel::after { bottom: -10px; }
.jx-panel-in { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; box-shadow: inset 0 0 0 1px ${inkA(0.35)}, inset 0 0 30px ${rgba(PAL.paperShade, 0.6)}; }
.jx-panel-head { display: flex; align-items: flex-end; gap: 10px; padding: 8px 12px 0 14px; position: relative; }
.jx-panel-head::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: 0; height: 3px; background: var(--jx-ink); clip-path: polygon(0 30%, 2% 0, 60% 25%, 100% 10%, 99% 90%, 40% 100%, 1% 80%); }
.jx-panel-title { display: flex; align-items: baseline; gap: 10px; padding: 4px 4px 10px; font-family: var(--jx-display); font-size: 24px; letter-spacing: 0.06em; min-width: 0; }
.jx-panel-title small { font-size: 13px; color: var(--jx-ink3); letter-spacing: 0.2em; }
.jx-tabs { display: flex; flex: 1; min-width: 0; gap: 2px; }
.jx-tab { position: relative; display: flex; flex-direction: column; align-items: center; padding: 4px 14px 10px; color: var(--jx-ink3); transition: color 0.15s; }
.jx-tab small { font-family: var(--jx-display); font-size: 11px; letter-spacing: 0.25em; line-height: 1.2; }
.jx-tab span { font-size: 16px; white-space: nowrap; }
.jx-tab:hover { color: var(--jx-ink2); }
.jx-tab:focus-visible { outline-offset: -4px; }
.jx-tab[aria-selected='true'] { color: var(--jx-ink); }
.jx-tab[aria-selected='true']::after { content: ''; position: absolute; left: 14%; right: 14%; bottom: 1px; height: 7px; background: var(--jx-seal); clip-path: polygon(0 55%, 6% 10%, 55% 0, 100% 30%, 97% 85%, 45% 100%, 4% 95%); z-index: 1; }
.jx-head-side { display: flex; align-items: center; gap: 10px; margin-left: auto; padding-bottom: 8px; flex: none; }
.jx-head-money { font-family: var(--jx-display); font-size: 17px; white-space: nowrap; }
.jx-close { width: 40px; height: 40px; display: grid; place-items: center; font-family: var(--jx-display); font-size: 20px; color: var(--jx-ink2); }
.jx-close:hover { color: var(--jx-seal); }
.jx-panel-body { position: relative; flex: 1; min-height: 0; overflow: auto; padding: 18px 20px; overscroll-behavior: contain; touch-action: pan-y; }
.jx-panel-body.jx-fill { overflow: hidden; }
.jx-panel-body.jx-flush { padding: 0; overflow: hidden; touch-action: none; }
.jx-view { height: 100%; }
.jx-empty { display: grid; justify-items: center; gap: 6px; padding: 52px 12px; text-align: center; color: var(--jx-ink3); }
.jx-empty b { font-family: var(--jx-brush); font-weight: 400; font-size: 54px; line-height: 1; color: ${inkA(0.28)}; }
.jx-empty strong { font-family: var(--jx-display); font-weight: 400; font-size: 19px; color: var(--jx-ink2); }
.jx-sec-h { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; padding-bottom: 3px; font-family: var(--jx-display); font-size: 16px; border-bottom: 1px solid ${inkA(0.22)}; }
.jx-sec-h small { color: var(--jx-ink3); letter-spacing: 0.2em; font-size: 12px; }
.jx-muted { color: var(--jx-ink3); font-size: 13px; }

/* 소지품 */
.jx-inv { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 20px; height: 100%; }
.jx-inv.jx-solo { grid-template-columns: minmax(0, 1fr); }
.jx-inv.jx-solo .jx-detail { display: none; }
.jx-inv-list { min-height: 0; overflow: auto; padding-right: 4px; touch-action: pan-y; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 4px 24px; }
.jx-cat { flex: 0 1 auto; min-width: 0; max-width: 100%; margin-bottom: 12px; }
.jx-cat .jx-sec-h { white-space: nowrap; }
.jx-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.jx-cell { position: relative; width: 70px; height: 70px; flex: none; display: grid; place-items: center; background: ${rgba(PAL.paperDeep, 0.55)}; box-shadow: inset 0 0 0 1px ${inkA(0.22)}; transition: background-color 0.12s; }
.jx-cell:hover { background: var(--jx-paper2); }
.jx-cell[aria-pressed='true'] { background: var(--jx-paper); box-shadow: inset 0 0 0 2px var(--jx-ink); }
.jx-cell canvas { width: 42px; height: 42px; }
.jx-cell .jx-n { position: absolute; right: 5px; bottom: 2px; font-size: 12px; }
.jx-cell .jx-eq { position: absolute; left: 4px; top: 4px; width: 14px; height: 14px; font-size: 9px; }
.jx-detail { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; padding-left: 18px; border-left: 1px solid ${inkA(0.22)}; touch-action: pan-y; }
.jx-detail-top { display: flex; gap: 12px; align-items: center; }
.jx-detail-top canvas { width: 64px; height: 64px; flex: none; background: ${rgba(PAL.paperDeep, 0.6)}; }
.jx-detail h2 { font-family: var(--jx-display); font-size: 24px; line-height: 1.2; }
.jx-desc { font-size: 15px; line-height: 1.7; }
.jx-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }

/* 제작 */
.jx-rows { display: grid; gap: 8px; }
.jx-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 9px 12px; background: ${rgba(PAL.paperDeep, 0.42)}; border-left: 3px solid ${inkA(0.25)}; }
.jx-row.jx-ok { border-left-color: var(--jx-ink); }
.jx-row canvas { width: 44px; height: 44px; }
.jx-row h4 { font-family: var(--jx-display); font-size: 17px; }
.jx-chips { display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 13px; color: var(--jx-ink2); margin-top: 2px; }
.jx-chip.jx-lack { color: var(--jx-seal); }

/* 기술 */
.jx-skills-top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 14px; }
.jx-points { font-family: var(--jx-display); font-size: 18px; }
.jx-points b { font-weight: 400; color: var(--jx-seal); font-size: 22px; }
.jx-trees { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 18px 22px; }
.jx-tree { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
.jx-tree-h { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font-family: var(--jx-display); font-size: 18px; }
.jx-tree-h small { font-family: var(--jx-body); font-size: 13px; color: var(--jx-ink2); }
.jx-xp { height: 5px; background: ${inkA(0.14)}; overflow: hidden; }
.jx-xp > i { display: block; height: 100%; background: var(--jx-ink); transform-origin: left; }
.jx-node { position: relative; display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; font-size: 14px; border: 1px dashed ${inkA(0.4)}; background: ${paperA(0.5)}; }
.jx-node + .jx-node::before { content: ''; position: absolute; left: 15px; top: -10px; width: 2px; height: 9px; background: ${inkA(0.35)}; }
.jx-node .jx-dot { flex: none; width: 10px; height: 10px; transform: rotate(45deg); border: 1.5px solid currentColor; }
.jx-node[data-st='learned'] { background: var(--jx-ink); color: var(--jx-paper); border: 1px solid var(--jx-ink); }
.jx-node[data-st='learned'] .jx-dot { background: currentColor; }
.jx-node[data-st='open'] { border: 1.5px solid var(--jx-seal); }
.jx-node[data-st='open'] .jx-dot { color: var(--jx-seal); }
.jx-node[data-st='locked'] { color: var(--jx-ink3); }
.jx-node[aria-pressed='true'] { box-shadow: 0 0 0 2px var(--jx-paper), 0 0 0 4px var(--jx-seal); }
.jx-skill-detail { position: sticky; bottom: -18px; z-index: 1; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px 20px; margin: 20px -4px 0; padding: 14px 4px 16px; border-top: 2px solid var(--jx-ink); background: var(--jx-paper) var(--jx-noise); box-shadow: 0 -10px 14px -8px ${rgba(PAL.paperShade, 0.9)}; }
.jx-skill-detail .jx-desc { margin-top: 4px; }
.jx-skill-detail > div { flex: 1 1 260px; min-width: 0; }
.jx-skill-detail h3 { font-family: var(--jx-display); font-size: 21px; }

/* 지도 */
.jx-map { position: absolute; inset: 0; cursor: grab; touch-action: none; overflow: hidden; }
.jx-map.jx-drag { cursor: grabbing; }
.jx-map canvas { display: block; width: 100%; height: 100%; }
.jx-map-ctl { position: absolute; right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; }
.jx-map-ctl .jx-btn { min-height: 40px; min-width: 40px; padding: 0 8px; font-size: 18px; }
.jx-map-ctl .jx-btn.jx-small { font-size: 13px; }
.jx-map-tip { position: absolute; left: 12px; bottom: 12px; max-width: calc(100% - 90px); padding: 5px 10px; font-size: 13px; color: var(--jx-ink2); background: ${paperA(0.86)}; box-shadow: inset 0 0 0 1px ${inkA(0.2)}; }

/* 일지 */
.jx-journal { max-width: 760px; margin: 0 auto; }
.jx-now { display: flex; gap: 14px; align-items: center; padding: 12px 16px; margin-bottom: 20px; background: ${rgba(PAL.paperDeep, 0.6)}; border-left: 4px solid var(--jx-seal); }
.jx-now .jx-seal { width: 34px; height: 34px; font-size: 17px; flex: none; }
.jx-now p { font-size: 17px; }
.jx-sec { margin-bottom: 22px; }
.jx-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 10px 2px 12px; border-bottom: 1px dashed ${inkA(0.22)}; }
.jx-entry h4 { font-family: var(--jx-display); font-size: 18px; }
.jx-entry p { grid-column: 1 / -1; font-size: 14px; line-height: 1.65; color: var(--jx-ink2); }
.jx-entry .jx-seal { width: 26px; height: 26px; font-size: 13px; }
.jx-entry.jx-done h4 { color: var(--jx-ink3); }
.jx-entry.jx-fail .jx-seal { background: var(--jx-ink3); }

/* 상점 */
.jx-shop { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; gap: 14px 22px; height: 100%; }
.jx-shop-col { min-height: 0; overflow: auto; touch-action: pan-y; }
.jx-srow { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; padding: 6px 8px; border-bottom: 1px dotted ${inkA(0.25)}; }
.jx-srow:hover { background: ${inkA(0.05)}; }
.jx-srow[aria-pressed='true'] { background: ${inkA(0.08)}; box-shadow: inset 3px 0 0 var(--jx-seal); }
.jx-srow canvas { width: 32px; height: 32px; }
.jx-srow .jx-nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jx-srow .jx-nm small { margin-left: 6px; color: var(--jx-ink3); font-size: 12px; }
.jx-price { font-family: var(--jx-display); white-space: nowrap; }
.jx-price.jx-lack { color: var(--jx-seal); }
.jx-trade { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding-top: 12px; border-top: 2px solid var(--jx-ink); min-height: 58px; }
.jx-trade-name { font-family: var(--jx-display); font-size: 18px; min-width: 0; flex: 1 1 140px; }
.jx-qty { display: flex; align-items: center; gap: 2px; }
.jx-qty .jx-btn { min-width: 38px; padding: 0; font-size: 18px; }
.jx-qty output { min-width: 38px; text-align: center; font-family: var(--jx-display); font-size: 19px; }

/* 쉬어가기 */
.jx-pause { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 32px; max-width: 780px; margin: 0 auto; }
.jx-menu { display: flex; flex-direction: column; gap: 8px; }
.jx-menu .jx-btn { justify-content: space-between; min-height: 48px; font-size: 17px; }
.jx-side { display: flex; flex-direction: column; gap: 18px; }
.jx-field { display: grid; gap: 6px; }
.jx-field label { font-family: var(--jx-display); font-size: 16px; display: flex; justify-content: space-between; }
.jx-range { flex: 1; min-width: 0; width: 100%; height: 30px; accent-color: ${PAL.ink}; pointer-events: auto; touch-action: pan-x; }
.jx-vol-row { display: flex; align-items: center; gap: 10px; }
.jx-vol-row .jx-mute { flex: none; min-height: 36px; padding: 2px 12px; font-size: 14px; }
.jx-vol-row .jx-mute[aria-pressed='true'] { color: var(--jx-seal); }
.jx-links { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
.jx-links .jx-btn { font-size: 14px; padding: 4px 8px; }

/* 도움말 */
.jx-help { max-width: 820px; margin: 0 auto; }
.jx-help table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 18px; }
.jx-help caption { text-align: left; font-family: var(--jx-display); font-size: 17px; padding: 4px 0 6px; }
.jx-help th, .jx-help td { padding: 7px 8px; text-align: left; vertical-align: top; border-bottom: 1px solid ${inkA(0.16)}; }
.jx-help th { font-weight: 400; font-family: var(--jx-display); color: var(--jx-ink2); }
.jx-help kbd { display: inline-block; min-width: 22px; margin: 1px 2px; padding: 0 6px; font: inherit; font-size: 12px; line-height: 20px; text-align: center; background: var(--jx-paper); box-shadow: inset 0 0 0 1px var(--jx-ink), 1px 1px 0 var(--jx-ink); }

/* ---------- 타이틀 ---------- */
.jx-title { position: absolute; inset: 0; z-index: 8; display: grid; grid-template-columns: minmax(0, 1fr) auto; pointer-events: auto; overflow: hidden;
  background-color: ${paperA(0.3)};
  background-image: var(--jx-noise), var(--jx-fiber), linear-gradient(90deg, ${paperA(0.05)}, ${paperA(0.35)} 40%, ${paperA(0.86)} 72%, ${paperA(0.94)}),
    radial-gradient(ellipse 60% 80% at 82% 40%, ${inkA(0.08)}, transparent 70%);
  animation: jx-fadein 0.9s ease-out both; }
.jx-title.jx-leave { transition: opacity 0.6s; opacity: 0; pointer-events: none; }
.jx-title-art { position: relative; display: flex; flex-direction: row-reverse; align-items: flex-start; gap: clamp(10px, 2vw, 30px); padding: clamp(26px, 7vh, 84px) clamp(20px, 6vw, 100px) 0 0; grid-column: 2; grid-row: 1; }
.jx-title-main { margin: 0; writing-mode: vertical-rl; text-orientation: upright; font-family: var(--jx-display); font-weight: 400; font-size: clamp(60px, 13vh, 136px); line-height: 1; letter-spacing: 0.04em; color: var(--jx-ink); animation: jx-bleed 1.6s 0.2s ease-out both; }
.jx-title-main .jx-year { font-size: 0.74em; letter-spacing: -0.02em; margin-inline-start: 0.32em; }
.jx-title-sub { margin: clamp(36px, 9vh, 110px) 0 0; writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 0; word-spacing: -0.3em; white-space: nowrap; font-family: var(--jx-brush); font-size: clamp(20px, 3.6vh, 34px); line-height: 1.1; color: var(--jx-ink2); animation: jx-bleed 1.6s 0.7s ease-out both; }
.jx-title-seal { width: 58px; height: 58px; font-size: 21px; writing-mode: vertical-rl; letter-spacing: 2px; transform: rotate(-5deg); animation: jx-stamp 0.55s 1.3s cubic-bezier(0.2, 1.5, 0.4, 1) both; }
.jx-title-menu { grid-column: 1; grid-row: 1; align-self: end; display: flex; flex-direction: column; gap: 10px; width: min(330px, calc(100% - 32px)); padding: 0 0 clamp(26px, 8vh, 84px); margin-left: clamp(16px, 6vw, 100px); animation: jx-fadein 1s 0.9s ease-out both; }
.jx-title-menu .jx-btn { justify-content: space-between; min-height: 52px; font-size: 18px; }
.jx-title-foot { margin-top: 6px; font-size: 12px; color: var(--jx-ink3); line-height: 1.6; }
.jx-title-foot:empty { display: none; }
.jx-touch-on .jx-keys-only { display: none; }

/* ---------- 터치 ---------- */
.jx-touch { position: absolute; inset: 0; z-index: 2; pointer-events: none; display: none; }
.jx-touch.jx-show { display: block; }
.jx-stick-zone { position: absolute; left: 0; bottom: 0; width: 46%; height: 58%; pointer-events: auto; touch-action: none; }
.jx-stick { position: absolute; width: 124px; height: 124px; margin: -62px 0 0 -62px; border-radius: 50%; border: 2px solid ${inkA(0.45)}; background: radial-gradient(${paperA(0.4)}, ${paperA(0.12)}); opacity: 0.55; transition: opacity 0.2s; pointer-events: none; }
.jx-stick.jx-active { opacity: 1; }
.jx-knob { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px; border-radius: 50%; background: ${inkA(0.6)}; box-shadow: inset 0 0 0 2px ${paperA(0.55)}; }
.jx-tbtns { position: absolute; right: 12px; bottom: 12px; width: 226px; height: 226px; pointer-events: none; }
.jx-tbtn { position: absolute; display: grid; place-items: center; width: 60px; height: 60px; border-radius: 50%; font-size: 13px; line-height: 1.1; text-align: center; color: var(--jx-ink); background: ${paperA(0.74)} var(--jx-noise); box-shadow: inset 0 0 0 2px ${inkA(0.7)}; pointer-events: auto; touch-action: none; -webkit-user-select: none; user-select: none; }
.jx-tbtn.jx-big { width: 80px; height: 80px; font-size: 16px; color: var(--jx-paper); background: ${inkA(0.74)} var(--jx-noise); }
.jx-tbtn.jx-held { background-color: var(--jx-ink); color: var(--jx-paper); transform: scale(0.94); }
.jx-tbtn.jx-gold { box-shadow: inset 0 0 0 2px var(--jx-gold); }
/* 터치: 상호작용 단추는 오른손 단추 무리 위에 세로로(누르기 쉽게), 탈것 표시는 왼쪽 막대 위로 */
.jx-touch-on .jx-prompts { left: auto; right: 14px; transform: none; bottom: 252px; flex-direction: column; align-items: flex-end; gap: 8px; max-width: min(60%, 320px); }
.jx-touch-on .jx-prompt { pointer-events: auto; min-height: 40px; padding: 2px 4px; }
.jx-touch-on .jx-veh { right: auto; left: 14px; bottom: 200px; text-align: left; }
.jx-touch-on .jx-veh-bar { margin-left: 0; }
.jx-touch-on .jx-debug { bottom: auto; top: 130px; }
/* 터치 + 멈추지 않는 대화(pause:false): 위로 올리고 손가락은 통과시킨다 (넘기기는 '행동' 단추·자동) */
.jx-touch-on .jx-dlg.jx-nb { top: 132px; bottom: auto; min-height: 0; padding-top: 18px; padding-bottom: 20px; pointer-events: none; cursor: default; }
.jx-touch-on .jx-dlg.jx-nb .jx-dlg-text { min-height: 0; }

/* ---------- 중간 폭: 목표 줄을 왼쪽 HUD 아래로 ---------- */
@media (max-width: 1099px) {
  .jx-obj { top: 112px; left: 14px; transform: none; max-width: calc(100% - 232px); }
}

/* ---------- 좁은 화면 ---------- */
@media (max-width: 639px) {
  .jx-tl { left: 10px; top: 10px; gap: 6px; }
  .jx-core { width: 40px; height: 40px; }
  .jx-money { font-size: 16px; }
  .jx-tr { right: 10px; top: 10px; }
  .jx-mini { width: 112px; height: 112px; }
  .jx-region { font-size: 14px; }
  .jx-clock { font-size: 12px; }
  .jx-obj { top: 100px; left: 10px; transform: none; max-width: calc(100% - 150px); font-size: 14px; gap: 8px; }
  .jx-obj-mark { width: 12px; height: 12px; }
  .jx-stamp { width: 17px; height: 25px; font-size: 9px; }
  .jx-toasts { top: 172px; right: 10px; }
  .jx-toast { font-size: 14px; padding: 6px 10px 7px 12px; }
  .jx-prompt { font-size: 14px; }
  .jx-prompts { bottom: 18px; }
  .jx-veh { right: 10px; bottom: 16px; }
  .jx-hud.jx-riding .jx-prompts { bottom: 104px; }
  .jx-touch-on .jx-hud.jx-riding .jx-prompts { bottom: 252px; }
  .jx-banner { top: 24%; }
  .jx-veh-gait { font-size: 28px; }
  .jx-panel { width: 100%; height: 100%; padding: 0; box-shadow: none; animation: none; }
  .jx-panel::before, .jx-panel::after { display: none; }
  .jx-panel-head { padding: 4px 4px 0; gap: 4px; }
  .jx-tabs { gap: 0; }
  .jx-tab { flex: 1 1 0; min-width: 0; padding: 6px 2px 10px; }
  .jx-tab small { display: none; }
  .jx-tab span { font-size: 14px; }
  .jx-head-money { display: none; }
  .jx-panel-title { font-size: 20px; }
  .jx-panel-body { padding: 14px 12px; }
  .jx-inv { display: flex; flex-direction: column; gap: 10px; }
  .jx-inv-list { flex: 1 1 auto; min-height: 96px; }
  .jx-detail { flex: 0 0 auto; }
  .jx-inv-list { gap: 2px 16px; }
  .jx-cell { width: 62px; height: 62px; }
  .jx-cell canvas { width: 38px; height: 38px; }
  .jx-detail { padding: 10px 0 0; border-left: 0; border-top: 1px solid ${inkA(0.22)}; max-height: 46%; }
  .jx-shop { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) auto; }
  .jx-pause { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .jx-help table { font-size: 13px; }
  .jx-title { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .jx-title-art { grid-column: 1; grid-row: 1; justify-content: center; padding: clamp(20px, 5vh, 40px) 16px 0; min-height: 0; overflow: hidden; }
  .jx-title-main { font-size: clamp(44px, min(8.5vh, 15vw), 96px); }
  .jx-title-sub { margin-top: clamp(24px, 6vh, 60px); font-size: clamp(18px, min(3.2vh, 6vw), 28px); }
  .jx-title-sub > span { display: block; }
  .jx-title-sub > span + span { margin-block-start: 0.25em; padding-top: 1.8em; }
  .jx-title-seal { width: 48px; height: 48px; font-size: 18px; }
  .jx-title-menu { grid-row: 2; width: auto; margin: 0 16px; padding-bottom: 22px; }
  .jx-dlg { padding: 20px 16px 26px; }
  .jx-dlg-portrait { width: 48px; height: 48px; font-size: 28px; }
}
/* 좁고 낮은 세로 화면 (작은 휴대폰): 제목이 단추에 가려 잘리지 않게 */
@media (max-width: 639px) and (max-height: 660px) {
  .jx-title-art { padding-top: 14px; }
  .jx-title-art > div { gap: 10px !important; }
  .jx-title-main { font-size: clamp(34px, 6.6vh, 60px); }
  .jx-title-seal { width: 40px; height: 40px; font-size: 15px; }
  .jx-title-sub { margin-top: 16px; font-size: clamp(15px, 2.8vh, 22px); }
  .jx-title-menu { gap: 8px; padding-bottom: 14px; }
  .jx-title-menu .jx-btn { min-height: 44px; font-size: 16px; }
}
@media (max-height: 520px) and (orientation: landscape) {
  .jx-title-art { padding-top: 18px; }
  .jx-title-main { font-size: clamp(36px, 11vh, 80px); }
  .jx-title-sub { margin-top: 24px; font-size: clamp(16px, 4.6vh, 22px); }
  .jx-title-seal { width: 44px; height: 44px; font-size: 16px; }
  .jx-title-menu .jx-btn { min-height: 42px; font-size: 16px; }
  .jx-tbtns { transform: scale(0.82); transform-origin: right bottom; }
  /* 낮은 가로 화면: HUD 를 작게 (hud.js measure 와 같은 기준) */
  .jx-tl { left: 10px; top: 10px; gap: 6px; }
  .jx-core { width: 40px; height: 40px; }
  .jx-money { font-size: 16px; }
  .jx-tr { right: 10px; top: 10px; }
  .jx-mini { width: 112px; height: 112px; }
  .jx-region { font-size: 14px; }
  .jx-clock { font-size: 12px; }
  .jx-obj { top: 96px; left: 10px; transform: none; max-width: min(calc(100% - 150px), 520px); font-size: 14px; }
  .jx-obj-text { -webkit-line-clamp: 1; }
  .jx-toasts { top: 172px; }
  /* 터치: 오른쪽은 지도와 단추로 꽉 차므로 안내 단추·알림은 가운데로, 탈것 표시는 왼쪽 막대 위 */
  .jx-touch-on .jx-prompts, .jx-touch-on .jx-hud.jx-riding .jx-prompts { left: 50%; right: auto; transform: translateX(-50%); bottom: 12px; flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: center; max-width: calc(100% - 420px); }
  .jx-touch-on .jx-veh { bottom: 190px; }
  .jx-touch-on .jx-veh-gait { font-size: 26px; }
  .jx-touch-on .jx-toasts { top: 10px; left: 250px; right: 132px; width: auto; align-items: center; }
  .jx-touch-on .jx-dlg.jx-nb { top: 24px; width: min(560px, calc(100% - 300px)); padding: 14px 16px 16px; }
}
@media (max-width: 479px) {
  .jx-tbtns { transform: scale(0.86); transform-origin: right bottom; }
  .jx-stick-zone { width: 52%; }
  .jx-touch-on .jx-prompts, .jx-touch-on .jx-hud.jx-riding .jx-prompts { bottom: 220px; }
}
@media (prefers-reduced-motion: reduce) {
  .jx-root *, .jx-root *::before, .jx-root *::after { animation: none !important; transition: none !important; }
}
`;
}

let injected = null;
export function injectStyles() {
  if (injected) return injected;
  const el = document.createElement('style');
  el.id = 'jx-ui-style';
  el.textContent = buildCSS();
  document.head?.appendChild(el);
  injected = el;
  return el;
}
