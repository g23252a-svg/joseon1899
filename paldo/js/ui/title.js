// 타이틀과 새 게임 고르기
import { h, clear, $, store } from './dom.js';
import { portrait } from './portrait.js';
import { audio } from './audio.js';
import { helpScreen } from './screens.js';
import { SCENARIOS } from '../data/scenarios.js';
import { OFFICER_BY_ID } from '../data/officers.js';
import { REGION_BY_ID } from '../data/regions.js';
import { DIFFICULTY } from '../core/state.js';
import { hash, strHash } from '../core/util.js';

export function showTitle({ onNew, onContinue, saves }) {
  const root = $('#title');
  root.hidden = false;
  clear(root);
  const cv = h('canvas');
  root.append(cv);
  drawBackdrop(cv);
  const onResize = () => drawBackdrop(cv);
  window.addEventListener('resize', onResize);
  const wrap = h('div.tw');
  root.append(wrap);
  const close = () => { window.removeEventListener('resize', onResize); clear(root); root.hidden = true; };

  const home = () => {
    const latest = saves().sort((a, b) => b.t - a.t)[0];
    clear(wrap).append(h('div.tbox',
      h('div.tseal', '八道', h('br'), '天下'),
      h('div.logo', '팔도천하'),
      h('div.logo-sub', '八道天下 · 조선 군웅 전략'),
      h('p', { style: { margin: 0, maxWidth: '560px', color: 'var(--ink-2)', fontSize: '14.5px' } }, '장수를 거두고, 문물을 일으키고, 붕당을 달래며 팔도를 하나로. 세종과 이성계, 이순신과 정조가 한 하늘 아래 겨룬다.'),
      h('div.tmenu',
        h('button.btn.primary', { onclick: () => { audio.unlock(); audio.play('gong'); pickScenario(); } }, '새로 시작'),
        latest ? h('button.btn', { onclick: () => { audio.unlock(); close(); onContinue(latest.slot); } }, `이어 하기 — ${latest.label}`) : null,
        saves().length > 1 ? h('button.btn', { onclick: () => pickSave() }, '저장 불러오기') : null,
        h('button.btn', { onclick: () => { audio.unlock(); helpScreen(); } }, '도움말')),
      h('p', { style: { fontSize: '12px', color: 'var(--ink-3)', margin: 0 } }, '그림·소리는 모두 코드로 만들었습니다 · 인물 능력치와 「팔도군웅전」은 가상입니다')));
  };
  const pickSave = () => {
    clear(wrap).append(h('div.tbox', h('div.logo', { style: { fontSize: '64px' } }, '불러오기'),
      h('div.tmenu', saves().sort((a, b) => b.t - a.t).map((s) => h('button.btn', { onclick: () => { close(); onContinue(s.slot); } }, `${s.slot === 'auto' ? '자동' : s.slot + '번'} — ${s.label}`)), h('button.btn', { onclick: home }, '돌아가기'))));
  };
  const pickScenario = () => {
    clear(wrap).append(h('div.tbox',
      h('div.logo', { style: { fontSize: 'clamp(54px, 10vw, 90px)' } }, '시나리오'),
      h('div.cards', Object.values(SCENARIOS).map((sc) => h('button.card', { onclick: () => { audio.play('click'); pickFaction(sc); } },
        h('h3', sc.name, h('small', { style: { fontSize: '14px', color: 'var(--ink-3)' } }, sc.hanja)),
        h('div.meta', sc.sub), h('p', sc.desc),
        h('div.meta', `세력 ${sc.factions.length} · ${sc.era ? sc.era + ' ' : ''}${sc.startYear}년 시작 · ${sc.endYear}년 끝`)))),
      h('button.btn', { onclick: home }, '돌아가기')));
  };
  const pickFaction = (sc) => {
    clear(wrap).append(h('div.tbox',
      h('div.logo', { style: { fontSize: 'clamp(48px, 9vw, 80px)' } }, '세력을 고르라'),
      h('div.meta', sc.name + ' — ' + sc.sub),
      h('div.cards', sc.factions.map((f) => {
        const ruler = OFFICER_BY_ID[f.ruler];
        const regs = typeof f.regions === 'string' ? '거의 모든 고을' : f.regions.map((r) => REGION_BY_ID[r].name).join('·');
        const offs = sc.officers.filter((o) => o[1] === f.id).length;
        return h('button.card', { onclick: () => { audio.play('click'); pickDifficulty(sc, f); } },
          h('div.fcard',
            h('img', { src: portrait({ ...ruler, seed: strHash(ruler.id) }, 64), alt: ruler.name }),
            h('div', h('h3', h('span.crest', { style: { background: f.color, width: '28px', height: '28px', fontSize: '15px' } }, f.crest), f.name),
              h('div.meta', `${regs} · 장수 ${offs} · 병력 ${Object.values(f.troops || {}).reduce((a, b) => a + b, 0).toLocaleString()}`),
              h('div.meta', '난이도 ', h('span.stars', '★'.repeat(f.diff || 2) + '☆'.repeat(5 - (f.diff || 2)))))),
          h('p', f.desc));
      })),
      h('button.btn', { onclick: pickScenario }, '돌아가기')));
  };
  const pickDifficulty = (sc, f) => {
    clear(wrap).append(h('div.tbox',
      h('div.logo', { style: { fontSize: 'clamp(48px, 9vw, 80px)' } }, f.name),
      h('div.meta', '난이도'),
      h('div.tmenu', Object.entries(DIFFICULTY).map(([k, d]) => h('button.btn' + (k === 'normal' ? '.primary' : ''), { onclick: () => { audio.play('gong'); close(); onNew({ scenario: sc.id, player: f.id, difficulty: k }); } },
        `${d.name} — ${{ easy: '컴퓨터가 느긋하다', normal: '공평하게', hard: '컴퓨터가 부유하고 사납다', legend: '각오하라' }[k]}`)),
        h('button.btn', { onclick: () => pickFaction(sc) }, '돌아가기'))));
  };
  home();
}

// 먹으로 그린 겹겹 산과 붉은 해
function drawBackdrop(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth, hh = window.innerHeight;
  cv.width = w * dpr; cv.height = hh * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, hh);
  sky.addColorStop(0, '#f3ecdc'); sky.addColorStop(1, '#e4d8bd');
  g.fillStyle = sky; g.fillRect(0, 0, w, hh);
  g.fillStyle = 'rgba(168, 50, 42, 0.85)';
  g.beginPath(); g.arc(w * 0.78, hh * 0.24, Math.min(w, hh) * 0.07, 0, Math.PI * 2); g.fill();
  for (let layer = 0; layer < 5; layer++) {
    const base = hh * (0.5 + layer * 0.11);
    const amp = hh * (0.2 - layer * 0.025);
    const alpha = 0.1 + layer * 0.13;
    g.fillStyle = `rgba(29, 27, 24, ${alpha})`;
    g.beginPath(); g.moveTo(0, hh);
    for (let x = 0; x <= w + 10; x += 8) {
      const n = Math.sin(x * 0.004 + layer * 2.1) * 0.5 + Math.sin(x * 0.011 + layer) * 0.3 + (hash(Math.floor(x / 40) + layer * 999) - 0.5) * 0.25;
      g.lineTo(x, base - Math.max(0, n + 0.3) * amp);
    }
    g.lineTo(w, hh); g.closePath(); g.fill();
    // 안개
    const mist = g.createLinearGradient(0, base - amp * 0.2, 0, base + 40);
    mist.addColorStop(0, 'rgba(243, 236, 220, 0)'); mist.addColorStop(1, 'rgba(243, 236, 220, 0.85)');
    g.fillStyle = mist; g.fillRect(0, base - amp * 0.2, w, amp * 0.2 + 60);
  }
  // 소나무 한 그루
  g.strokeStyle = 'rgba(29,27,24,0.85)'; g.lineWidth = 6; g.lineCap = 'round';
  const tx = w * 0.12, ty = hh * 0.98;
  g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + 30, hh * 0.75, tx - 10, hh * 0.58); g.stroke();
  g.fillStyle = 'rgba(29,27,24,0.75)';
  for (const [dx, dy, r] of [[-10, 0.58, 40], [30, 0.66, 32], [-40, 0.7, 28], [10, 0.52, 26]]) { g.beginPath(); g.ellipse(tx + dx, hh * dy, r * 1.6, r * 0.45, -0.1, 0, Math.PI * 2); g.fill(); }
}
