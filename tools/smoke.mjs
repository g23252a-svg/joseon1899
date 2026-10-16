// 헤드리스 스모크 테스트: 월드 생성 → 모듈 install → 플레이 시작 → N 틱 시뮬레이션 + 렌더 호출.
// 콘솔 에러를 모아서 보고한다. 실패(에러 > 0)면 종료 코드 1.
//
//   node tools/smoke.mjs                      모든 모듈, 3000 틱
//   node tools/smoke.mjs --ticks=6000
//   node tools/smoke.mjs --only=systems/inventory.js,systems/loot.js   해당 모듈만 install
//   node tools/smoke.mjs --verbose            경고도 출력
//
// 시뮬레이션 동안 플레이어는 무작위로 걷고/달리고, 가끔 E·F 를 누르고, 마우스로 쏜다.

import { makeAny, win } from './fakedom.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const TICKS = Number(args.ticks || 3000);
const ONLY = args.only ? String(args.only).split(',').map((s) => './' + s.replace(/^\.?\//, '').replace(/^js\//, '')) : null;

const errors = new Map();
const warns = new Map();
const origError = console.error, origWarn = console.warn;
console.error = (...a) => {
  const msg = a.map((x) => (x instanceof Error ? x.stack?.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ');
  errors.set(msg, (errors.get(msg) || 0) + 1);
};
console.warn = (...a) => {
  const msg = a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ');
  warns.set(msg, (warns.get(msg) || 0) + 1);
};
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

const ALL = [
  './engine/audio.js',
  './systems/time.js',
  './systems/inventory.js',
  './systems/skills.js',
  './systems/combat.js',
  './systems/wanted.js',
  './systems/loot.js',
  './systems/shops.js',
  './entities/npc.js',
  './entities/animals.js',
  './vehicles/index.js',
  './systems/spawner.js',
  './systems/missions.js',
  './systems/save.js',
  './ui/index.js',
];

const t0 = Date.now();
const { game } = await import('../js/engine/game.js');
// --world=js/world/다른파일.js 로 개발 중인 월드를 시험할 수 있다
const worldPath = args.world ? '../' + String(args.world).replace(/^\.?\//, '') : '../js/world/world.js';
const { createWorld } = await import(worldPath);
const { Player } = await import('../js/entities/player.js');

const canvas = makeAny('canvas');
game.init(canvas);
const tw = Date.now();
await createWorld(game, () => {});
const worldMs = Date.now() - tw;

const loaded = [], missing = [];
for (const p of ONLY || ALL) {
  try {
    const mod = await import('../js/' + p.replace('./', ''));
    await mod.install?.(game);
    loaded.push(p);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && err.message.includes(p.replace('./', '').split('/').pop())) missing.push(p);
    else console.error(`[install ${p}]`, err);
  }
}
const sp = game.world.spawn || { x: 100, y: 100 };
game.player = game.add(new Player({ x: sp.x, y: sp.y }));
await game.start(); // requestAnimationFrame 은 가짜라 루프는 안 돈다
game.sys.ui?.hideTitle?.();
game.beginPlay();
game.pauseReasons.clear();

// 무작위 입력
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const kd = (code) => win.dispatchEvent({ type: 'keydown', code, target: {}, preventDefault() {} });
const ku = (code) => win.dispatchEvent({ type: 'keyup', code, target: {}, preventDefault() {} });
const MOVE = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
let held = [];
const ts = Date.now();
let maxEnts = 0;
for (let i = 0; i < TICKS; i++) {
  if (i % 90 === 0) {
    for (const k of held) ku(k);
    held = [MOVE[Math.floor(rnd() * 4)]];
    if (rnd() < 0.3) held.push('ShiftLeft');
    for (const k of held) kd(k);
  }
  if (i % 47 === 0) { kd('KeyE'); }
  if (i % 47 === 1) { ku('KeyE'); }
  if (i % 131 === 0) { kd('KeyF'); }
  if (i % 131 === 1) { ku('KeyF'); }
  if (i % 200 === 100) { game.input.mouse.down[2] = true; }
  if (i % 200 === 110) { game.input.mouse.down[0] = true; game.input.mouse.pressed[0] = true; }
  if (i % 200 === 112) { game.input.mouse.down[0] = false; game.input.mouse.down[2] = false; }
  if (i % 500 === 250) { kd('KeyQ'); }
  if (i % 500 === 251) { ku('KeyQ'); }
  // 메뉴가 열려 멈췄으면 닫는다
  if (game.pauseReasons.size) game.pauseReasons.clear();
  game._update(1 / 60);
  if (i % 30 === 0) game._render(1 / 60);
  maxEnts = Math.max(maxEnts, game.entities.length);
  if (i === Math.floor(TICKS / 2)) {
    // 중간에 다른 곳으로 순간이동해서 다른 지역도 돌려본다
    const pl = game.world.places || {};
    const keys = Object.keys(pl);
    if (keys.length) {
      const p = pl[keys[Math.floor(rnd() * keys.length)]];
      if (p && typeof p.x === 'number') { game.player.x = p.x; game.player.y = p.y; }
    }
  }
}
const simMs = Date.now() - ts;

console.error = origError;
console.warn = origWarn;
console.log(`world ${worldMs}ms, sim ${TICKS} ticks ${simMs}ms (${(simMs / TICKS).toFixed(2)}ms/tick), total ${Date.now() - t0}ms`);
console.log(`modules loaded: ${loaded.length} [${loaded.join(', ')}]`);
if (missing.length) console.log(`modules missing: ${missing.join(', ')}`);
console.log(`entities: now ${game.entities.length}, max ${maxEnts}; systems: ${game.systems.map((s) => s.name).join(', ')}`);
console.log(`player at (${game.player.x.toFixed(1)}, ${game.player.y.toFixed(1)}) hp ${game.player.hp} state ${game.player.state} vehicle ${game.player.vehicle?.vtype || '-'}`);
if (args.verbose && warns.size) {
  console.log(`\nWARNINGS (${warns.size}):`);
  for (const [m, n] of warns) console.log(`  x${n} ${m}`);
}
if (errors.size) {
  console.log(`\nERRORS (${errors.size} unique):`);
  for (const [m, n] of errors) console.log(`  x${n} ${m}`);
  process.exit(1);
} else console.log('\nOK: no errors');
