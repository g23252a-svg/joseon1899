// 부팅: 월드 생성 → 각 모듈 install → 루프 시작 → 타이틀.
// 새 모듈은 MODULES 목록에 추가한다. 각 모듈은 `export function install(game)` 를 가진다.

import { game } from './engine/game.js';
import { createWorld } from './world/world.js';
import { Player } from './entities/player.js';

// 기능 모듈 (없는 파일은 건너뛴다 — 개발 중 부분 실행용)
const MODULES = [
  './engine/audio.js',
  './systems/time.js',
  './systems/inventory.js',
  './systems/skills.js',
  './systems/stats.js',
  './systems/combat.js',
  './systems/wanted.js',
  './systems/loot.js',
  './systems/crafting.js',
  './systems/shops.js',
  './entities/npc.js',
  './entities/animals.js',
  './vehicles/index.js',
  './systems/spawner.js',
  './systems/missions.js',
  './systems/save.js',
  './ui/index.js',
];

const loadingEl = document.getElementById('loading');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
function progress(p, text) {
  if (loadingBar) loadingBar.style.width = `${Math.round(p * 100)}%`;
  if (text && loadingText) loadingText.textContent = text;
}

async function boot() {
  const canvas = document.getElementById('game');
  game.init(canvas);
  progress(0.02, '지도를 펼치는 중');
  await createWorld(game, (p, t) => progress(0.05 + p * 0.65, t));

  progress(0.72, '사람들을 불러 모으는 중');
  for (const path of MODULES) {
    try {
      const mod = await import(path);
      await mod.install?.(game);
    } catch (err) {
      console.warn(`[boot] ${path} 건너뜀:`, err.message);
      if (!String(err.message).includes('Failed to fetch') && !String(err.message).includes('Cannot find module') && !String(err.message).includes('404')) console.error(err);
    }
  }

  const sp = game.world.spawn || { x: 100, y: 100 };
  game.player = game.add(new Player({ x: sp.x, y: sp.y }));
  game.camera.snap(sp.x, sp.y);

  progress(0.95, '먹을 가는 중');
  await game.start();
  progress(1, '');
  if (loadingEl) loadingEl.hidden = true;

  // UI 모듈이 타이틀 화면을 띄운다. 없으면 바로 시작.
  if (game.sys.ui?.showTitle) game.sys.ui.showTitle();
  else game.beginPlay();
}

boot().catch((err) => {
  console.error(err);
  if (loadingText) loadingText.textContent = '불러오기 실패: ' + err.message;
});
