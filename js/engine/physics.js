// 이동·충돌. 지형(world.passable)과 건물(world.querySolids)에 대한 원 충돌,
// 그리고 엔티티끼리의 밀어내기.

import { circleVsRect } from './util.js';

const SAMPLE_DIRS = [];
for (let i = 0; i < 8; i++) SAMPLE_DIRS.push([Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)]);

/** 반지름 r 원이 (x,y) 에서 mode 로 통행 불가능한가 (지형만) */
export function terrainBlocked(world, x, y, r, mode) {
  if (!world.passable(x, y, mode)) return true;
  const rr = r * 0.92;
  for (const d of SAMPLE_DIRS) if (!world.passable(x + d[0] * rr, y + d[1] * rr, mode)) return true;
  return false;
}

const _solids = [];
/** 건물 등 고정 사각형과 겹치면 밀어낸다 */
export function pushOutOfSolids(world, e, r, mode) {
  if (!world.querySolids) return false;
  let moved = false;
  for (let iter = 0; iter < 3; iter++) {
    _solids.length = 0;
    world.querySolids(e.x - r - 1, e.y - r - 1, e.x + r + 1, e.y + r + 1, _solids);
    let any = false;
    for (const s of _solids) {
      if (s.blocks && !s.blocks.includes(mode)) continue;
      const hit = circleVsRect(e.x, e.y, r, s);
      if (hit) {
        e.x += hit.nx * hit.depth;
        e.y += hit.ny * hit.depth;
        any = moved = true;
      }
    }
    if (!any) break;
  }
  return moved;
}

/** (x,y) 의 반지름 r 원이 건물과 겹치는가 */
export function solidAt(world, x, y, r, mode) {
  if (!world.querySolids) return false;
  _solids.length = 0;
  world.querySolids(x - r, y - r, x + r, y + r, _solids);
  for (const s of _solids) {
    if (s.blocks && !s.blocks.includes(mode)) continue;
    if (circleVsRect(x, y, r, s)) return true;
  }
  return false;
}

/**
 * 엔티티를 (dx, dy) 만큼 옮긴다. 축 분리 미끄러짐.
 * mode: 'foot' | 'swim' | 'horse' | 'wheel' | 'boat' | 'rail' | 'ghost'
 * 반환: {hitX, hitY, hit}
 */
export function moveCircle(world, e, dx, dy, mode = 'foot', r = e.radius) {
  if (mode === 'ghost' || !world) {
    e.x += dx;
    e.y += dy;
    return { hitX: false, hitY: false, hit: false };
  }
  const len = Math.hypot(dx, dy);
  const stepLen = Math.max(0.15, r * 0.7);
  const steps = Math.max(1, Math.ceil(len / stepLen));
  const sx = dx / steps, sy = dy / steps;
  // 이미 막힌 곳에 있으면(물에 빠진 채 생성 등) 자유롭게 빠져나오게 한다
  const stuck = terrainBlocked(world, e.x, e.y, r, mode);
  let hitX = false, hitY = false;
  for (let i = 0; i < steps; i++) {
    if (sx) {
      const nx = e.x + sx;
      if (stuck || !terrainBlocked(world, nx, e.y, r, mode)) e.x = nx;
      else hitX = true;
    }
    if (sy) {
      const ny = e.y + sy;
      if (stuck || !terrainBlocked(world, e.x, ny, r, mode)) e.y = ny;
      else hitY = true;
    }
  }
  const px = e.x, py = e.y;
  if (pushOutOfSolids(world, e, r, mode)) {
    // 건물에서 밀려난 위치가 지형상 막혔으면 되돌린다
    if (!stuck && terrainBlocked(world, e.x, e.y, r, mode)) {
      e.x = px;
      e.y = py;
    }
    hitX = hitX || Math.abs(e.x - px) > 1e-4;
    hitY = hitY || Math.abs(e.y - py) > 1e-4;
  }
  return { hitX, hitY, hit: hitX || hitY };
}

/** 엔티티가 지금 서 있는 곳의 통행 모드 (탈것 내리기 위치 찾기 등) */
export function canStand(world, x, y, r = 0.35, mode = 'foot') {
  return !terrainBlocked(world, x, y, r, mode) && !solidAt(world, x, y, r, mode);
}

/** 서로 겹친 동적 엔티티를 질량비로 밀어내고 onCollide 를 부른다 */
export function resolveDynamic(game) {
  const ents = game.entities;
  const hash = game.dynHash;
  const near = [];
  for (const a of ents) {
    if (!a.alive || !a.solid || a.static) continue;
    near.length = 0;
    hash.queryRect(a.x - a.radius - 2, a.y - a.radius - 2, a.x + a.radius + 2, a.y + a.radius + 2, near);
    for (const b of near) {
      if (b === a || !b.alive || !b.solid || b.static) continue;
      if (a.id >= b.id) continue; // 쌍마다 한 번 (id 는 문자열이지만 일관된 순서면 충분)
      if (a.vehicle === b || b.vehicle === a) continue;
      if (a.ignoreCollision?.(b) || b.ignoreCollision?.(a)) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 < 1e-10) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, ny = dy / d;
      const overlap = rr - d;
      const ma = a.mass === Infinity ? 1e9 : a.mass;
      const mb = b.mass === Infinity ? 1e9 : b.mass;
      const ta = mb / (ma + mb), tb = ma / (ma + mb);
      const ax = a.x, ay = a.y, bx = b.x, by = b.y;
      a.x -= nx * overlap * ta;
      a.y -= ny * overlap * ta;
      b.x += nx * overlap * tb;
      b.y += ny * overlap * tb;
      const w = game.world;
      if (w) {
        if (a.mass !== Infinity && terrainBlocked(w, a.x, a.y, a.radius, a.moveMode || 'foot') && !terrainBlocked(w, ax, ay, a.radius, a.moveMode || 'foot')) {
          a.x = ax;
          a.y = ay;
        }
        if (b.mass !== Infinity && terrainBlocked(w, b.x, b.y, b.radius, b.moveMode || 'foot') && !terrainBlocked(w, bx, by, b.radius, b.moveMode || 'foot')) {
          b.x = bx;
          b.y = by;
        }
      }
      const impact = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // 접근 속도
      if (impact > 0.5) {
        a.onCollide(b, impact, game);
        b.onCollide(a, impact, game);
      }
    }
  }
}
