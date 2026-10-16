// 먹 그림 아이콘: 아이템(약초·가죽·고기·탄환·총·칼·엽전·병·열쇠 …), 지도 표식, 플레이어 화살표.
// 모두 Canvas 2D 로 그린다. 좌표는 0~1 단위 상자 안에서 그린 뒤 크기만큼 늘린다.

import { FONT, PAL } from '../engine/palette.js';
import { mixHex, rgba } from '../engine/util.js';
import { dpr } from './dom.js';

const INK = PAL.ink;

/** 기본 도형별 바탕색 */
export const SHAPE_COLOR = {
  leaf: PAL.treeLight,
  root: PAL.roofThatch,
  mushroom: PAL.brick,
  pelt: PAL.timber,
  meat: mixHex(PAL.blood, PAL.seal, 0.5),
  fish: PAL.river,
  bullet: PAL.gold,
  gun: PAL.timber,
  pistol: PAL.ink2,
  blade: PAL.wallStone,
  bow: PAL.timber,
  arrow: PAL.timber,
  coin: PAL.gold,
  bottle: PAL.sea,
  key: PAL.gold,
  bundle: PAL.forest,
  scroll: PAL.paperDeep,
  rice: PAL.white,
  gem: PAL.dancheongGreen,
  feather: PAL.white,
  stone: PAL.rock,
  pouch: PAL.brick,
  box: PAL.timber,
  cloth: PAL.seaDeep,
};

export const SHAPES = Object.keys(SHAPE_COLOR);

const ALIAS = {
  herb: 'leaf', grass: 'leaf', plant: 'leaf', ginseng: 'root', insam: 'root',
  hide: 'pelt', skin: 'pelt', fur: 'pelt', steak: 'meat', food: 'rice', bowl: 'rice', bread: 'rice',
  ammo: 'bullet', cartridge: 'bullet', shot: 'bullet', rifle: 'gun', musket: 'gun', matchlock: 'gun',
  revolver: 'pistol', sword: 'blade', knife: 'blade', dagger: 'blade', money: 'coin', yeopjeon: 'coin',
  potion: 'bottle', medicine: 'bottle', tonic: 'bottle', wine: 'bottle', flask: 'bottle', gourd: 'bottle',
  letter: 'scroll', document: 'scroll', paper: 'scroll', map: 'scroll', ring: 'gem', jewel: 'gem', jade: 'gem',
  ore: 'stone', rock: 'stone', iron: 'stone', bag: 'pouch', purse: 'pouch', chest: 'box', crate: 'box',
  fabric: 'cloth', silk: 'cloth',
};

const has = (s, re) => re.test(s);

/** 아이템 정의 → 도형 이름 */
export function shapeOf(def = {}) {
  const want = def.icon?.shape;
  if (want && SHAPE_COLOR[want]) return want;
  if (want && ALIAS[want]) return ALIAS[want];
  const s = `${def.id || ''} ${def.name || ''}`.toLowerCase();
  switch (def.cat) {
    case 'weapon':
      if (has(s, /bow|활/)) return 'bow';
      if (has(s, /arrow|화살/)) return 'arrow';
      if (has(s, /knife|sword|blade|dagger|단도|칼|검|환도|도끼|창/)) return 'blade';
      if (has(s, /pistol|revolver|권총|육혈포|단총/)) return 'pistol';
      return 'gun';
    case 'ammo':
      return has(s, /arrow|화살/) ? 'arrow' : 'bullet';
    case 'herb':
      if (has(s, /ginseng|삼/)) return 'root';
      if (has(s, /mushroom|버섯|영지/)) return 'mushroom';
      return 'leaf';
    case 'meat':
      return has(s, /fish|생선|물고기|붕어|잉어/) ? 'fish' : 'meat';
    case 'pelt':
      return has(s, /feather|깃/) ? 'feather' : 'pelt';
    case 'valuable':
      if (has(s, /coin|엽전|돈|銭|전$/)) return 'coin';
      if (has(s, /letter|서찰|편지|문서|증서|지도/)) return 'scroll';
      return 'gem';
    case 'quest':
      if (has(s, /key|열쇠/)) return 'key';
      if (has(s, /box|함|궤/)) return 'box';
      return 'scroll';
    case 'consumable':
      if (has(s, /fish|생선|물고기/)) return 'fish';
      if (has(s, /bottle|술|약|탕|potion|tonic|물/)) return 'bottle';
      return 'rice';
    case 'material':
      if (has(s, /feather|깃/)) return 'feather';
      if (has(s, /stone|ore|광석|돌|철|쇠|화약/)) return 'stone';
      if (has(s, /cloth|천|베|비단|무명/)) return 'cloth';
      return 'bundle';
    default:
      for (const k of SHAPES) if (s.includes(k)) return k;
      for (const k in ALIAS) if (s.includes(k)) return ALIAS[k];
      return 'bundle';
  }
}

export function colorOf(def = {}, shape = shapeOf(def)) {
  return def.icon?.color || SHAPE_COLOR[shape] || PAL.ink3;
}

// ---------------------------------------------------------------- 도형 (0~1 단위)

function fs(ctx, fill, lw = 0.045) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}
function line(ctx, x0, y0, x1, y1, lw = 0.035, color = INK) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.stroke();
}
function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
function poly(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}
/** 점들을 지나는 부드러운 닫힌 곡선 */
function smooth(ctx, pts) {
  const n = pts.length;
  ctx.beginPath();
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    m = mid(p, q);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

const DRAW = {
  leaf(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(0.2, 0.8);
    ctx.bezierCurveTo(0.1, 0.42, 0.42, 0.12, 0.86, 0.14);
    ctx.bezierCurveTo(0.88, 0.56, 0.58, 0.88, 0.2, 0.8);
    fs(ctx, c);
    ctx.beginPath();
    ctx.moveTo(0.2, 0.8);
    ctx.quadraticCurveTo(0.48, 0.5, 0.8, 0.2);
    ctx.lineWidth = 0.03;
    ctx.stroke();
    for (const t of [0.35, 0.5, 0.65]) {
      const x = 0.2 + t * 0.6, y = 0.8 - t * 0.6;
      line(ctx, x, y, x - 0.1, y - 0.1, 0.022);
      line(ctx, x, y, x + 0.1, y + 0.08, 0.022);
    }
    line(ctx, 0.2, 0.8, 0.1, 0.92, 0.045);
  },
  root(ctx, c) {
    // 인삼: 몸통 + 잔뿌리 + 잎
    ctx.beginPath();
    ctx.moveTo(0.46, 0.3);
    ctx.bezierCurveTo(0.62, 0.32, 0.64, 0.56, 0.56, 0.68);
    ctx.bezierCurveTo(0.5, 0.76, 0.42, 0.74, 0.4, 0.62);
    ctx.bezierCurveTo(0.36, 0.48, 0.36, 0.34, 0.46, 0.3);
    fs(ctx, c);
    line(ctx, 0.44, 0.7, 0.32, 0.9, 0.03);
    line(ctx, 0.54, 0.7, 0.66, 0.9, 0.03);
    line(ctx, 0.5, 0.74, 0.5, 0.94, 0.025);
    line(ctx, 0.48, 0.3, 0.5, 0.12, 0.03);
    for (const [x, y, r] of [[0.36, 0.12, -0.6], [0.64, 0.12, 0.6], [0.5, 0.06, 0]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r);
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.05, 0.1, 0, 0, Math.PI * 2);
      fs(ctx, PAL.treeLight, 0.025);
      ctx.restore();
    }
    ctx.fillStyle = PAL.seal;
    circle(ctx, 0.5, 0.1, 0.03);
    ctx.fill();
  },
  mushroom(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(0.14, 0.52);
    ctx.bezierCurveTo(0.16, 0.18, 0.84, 0.18, 0.86, 0.52);
    ctx.quadraticCurveTo(0.5, 0.6, 0.14, 0.52);
    fs(ctx, c);
    ctx.beginPath();
    ctx.moveTo(0.42, 0.56);
    ctx.lineTo(0.38, 0.88);
    ctx.quadraticCurveTo(0.5, 0.94, 0.62, 0.88);
    ctx.lineTo(0.58, 0.56);
    fs(ctx, PAL.white);
    ctx.fillStyle = rgba(PAL.paper, 0.85);
    for (const [x, y] of [[0.34, 0.38], [0.52, 0.3], [0.66, 0.42]]) {
      circle(ctx, x, y, 0.04);
      ctx.fill();
    }
  },
  pelt(ctx, c) {
    smooth(ctx, [
      [0.5, 0.07], [0.6, 0.2], [0.88, 0.14], [0.72, 0.34], [0.76, 0.64], [0.92, 0.86], [0.64, 0.78],
      [0.5, 0.95], [0.36, 0.78], [0.08, 0.86], [0.24, 0.64], [0.28, 0.34], [0.12, 0.14], [0.4, 0.2],
    ]);
    fs(ctx, c);
    ctx.setLineDash([0.05, 0.05]);
    line(ctx, 0.5, 0.26, 0.5, 0.8, 0.025, rgba(INK, 0.6));
    ctx.setLineDash([]);
  },
  meat(ctx, c) {
    line(ctx, 0.46, 0.54, 0.2, 0.8, 0.09, INK);
    line(ctx, 0.46, 0.54, 0.2, 0.8, 0.05, PAL.white);
    for (const [x, y] of [[0.14, 0.78], [0.22, 0.88]]) {
      circle(ctx, x, y, 0.06);
      fs(ctx, PAL.white, 0.035);
    }
    ctx.save();
    ctx.translate(0.6, 0.4);
    ctx.rotate(-0.75);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.3, 0.22, 0, 0, Math.PI * 2);
    fs(ctx, c);
    ctx.beginPath();
    ctx.ellipse(-0.04, 0.03, 0.16, 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(PAL.white, 0.35);
    ctx.fill();
    ctx.restore();
  },
  fish(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(0.1, 0.5);
    ctx.bezierCurveTo(0.26, 0.24, 0.58, 0.22, 0.74, 0.5);
    ctx.bezierCurveTo(0.58, 0.78, 0.26, 0.76, 0.1, 0.5);
    fs(ctx, c);
    poly(ctx, [[0.72, 0.5], [0.92, 0.32], [0.88, 0.5], [0.92, 0.68]]);
    fs(ctx, c);
    ctx.fillStyle = INK;
    circle(ctx, 0.24, 0.46, 0.03);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0.36, 0.5, 0.1, -1, 1);
    ctx.lineWidth = 0.025;
    ctx.stroke();
  },
  bullet(ctx, c) {
    for (let i = 0; i < 3; i++) {
      const x = 0.2 + i * 0.22, y0 = 0.36 + (i === 1 ? -0.06 : 0);
      ctx.beginPath();
      ctx.moveTo(x, y0 + 0.08);
      ctx.quadraticCurveTo(x + 0.07, y0 - 0.12, x + 0.14, y0 + 0.08);
      fs(ctx, PAL.ink2, 0.03);
      ctx.beginPath();
      ctx.rect(x, y0 + 0.08, 0.14, 0.42);
      fs(ctx, c, 0.035);
      line(ctx, x, y0 + 0.44, x + 0.14, y0 + 0.44, 0.025);
    }
  },
  gun(ctx, c) {
    ctx.save();
    ctx.translate(0.5, 0.5);
    ctx.rotate(-Math.PI / 4);
    poly(ctx, [[-0.47, -0.01], [-0.2, -0.06], [-0.2, 0.06], [-0.44, 0.15]]);
    fs(ctx, c);
    ctx.beginPath();
    ctx.rect(-0.21, -0.06, 0.24, 0.1);
    fs(ctx, c);
    ctx.beginPath();
    ctx.rect(0.02, -0.045, 0.45, 0.045);
    fs(ctx, PAL.ink2, 0.03);
    ctx.beginPath();
    ctx.arc(-0.08, 0.06, 0.05, 0, Math.PI);
    ctx.lineWidth = 0.025;
    ctx.stroke();
    ctx.fillStyle = PAL.seal;
    ctx.fillRect(-0.16, -0.08, 0.04, 0.02); // 화승 끈
    ctx.restore();
  },
  pistol(ctx, c) {
    ctx.save();
    ctx.translate(0.48, 0.46);
    ctx.beginPath();
    ctx.rect(-0.08, -0.17, 0.48, 0.1);
    fs(ctx, c, 0.035);
    poly(ctx, [[-0.26, -0.2], [-0.02, -0.2], [0.0, 0.0], [-0.26, 0.0]]);
    fs(ctx, c);
    poly(ctx, [[-0.26, -0.02], [-0.08, -0.02], [-0.02, 0.36], [-0.24, 0.38]]);
    fs(ctx, PAL.timber);
    circle(ctx, -0.12, -0.1, 0.07);
    fs(ctx, PAL.ink3, 0.03);
    ctx.beginPath();
    ctx.arc(-0.02, 0.03, 0.06, 0, Math.PI);
    ctx.lineWidth = 0.025;
    ctx.stroke();
    ctx.restore();
  },
  blade(ctx, c) {
    ctx.save();
    ctx.translate(0.5, 0.5);
    ctx.rotate(-Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(-0.12, -0.045);
    ctx.lineTo(0.36, -0.06);
    ctx.quadraticCurveTo(0.48, -0.04, 0.47, 0.02);
    ctx.lineTo(-0.12, 0.04);
    ctx.closePath();
    fs(ctx, c);
    line(ctx, -0.1, -0.01, 0.38, -0.025, 0.012, rgba(PAL.white, 0.9));
    ctx.beginPath();
    ctx.ellipse(-0.14, 0, 0.035, 0.11, 0, 0, Math.PI * 2);
    fs(ctx, PAL.gold, 0.03);
    ctx.beginPath();
    ctx.rect(-0.44, -0.04, 0.28, 0.08);
    fs(ctx, PAL.ink2, 0.03);
    for (let x = -0.4; x < -0.18; x += 0.06) line(ctx, x, -0.04, x + 0.03, 0.04, 0.015, PAL.paper);
    ctx.fillStyle = PAL.seal;
    circle(ctx, -0.47, 0, 0.03);
    ctx.fill();
    ctx.restore();
  },
  bow(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(0.34, 0.08);
    ctx.bezierCurveTo(0.62, 0.14, 0.82, 0.36, 0.6, 0.5);
    ctx.bezierCurveTo(0.82, 0.64, 0.62, 0.86, 0.34, 0.92);
    ctx.lineWidth = 0.1;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 0.055;
    ctx.strokeStyle = c;
    ctx.stroke();
    line(ctx, 0.34, 0.08, 0.34, 0.92, 0.016);
    ctx.fillStyle = PAL.seal;
    ctx.fillRect(0.6, 0.46, 0.06, 0.08);
  },
  arrow(ctx, c) {
    line(ctx, 0.18, 0.82, 0.8, 0.2, 0.04, INK);
    line(ctx, 0.18, 0.82, 0.8, 0.2, 0.02, c);
    poly(ctx, [[0.86, 0.14], [0.7, 0.2], [0.8, 0.3]]);
    fs(ctx, PAL.ink2, 0.025);
    for (const o of [0, 0.06]) {
      poly(ctx, [[0.18 + o, 0.82 - o], [0.12 + o, 0.7 - o], [0.24 + o, 0.76 - o]]);
      fs(ctx, PAL.white, 0.02);
      poly(ctx, [[0.18 + o, 0.82 - o], [0.3 + o, 0.88 - o], [0.24 + o, 0.76 - o]]);
      fs(ctx, PAL.white, 0.02);
    }
  },
  coin(ctx, c) {
    circle(ctx, 0.5, 0.5, 0.36);
    fs(ctx, c, 0.05);
    circle(ctx, 0.5, 0.5, 0.29);
    ctx.lineWidth = 0.02;
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(0.42, 0.42, 0.16, 0.16);
    fs(ctx, PAL.paper, 0.035);
    // 상평통보 네 글자 자리
    for (const [x, y, w, h] of [[0.47, 0.26, 0.06, 0.1], [0.47, 0.64, 0.06, 0.1], [0.26, 0.47, 0.1, 0.06], [0.64, 0.47, 0.1, 0.06]]) {
      ctx.fillStyle = rgba(INK, 0.7);
      ctx.fillRect(x, y, w, h);
    }
  },
  bottle(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(0.44, 0.12);
    ctx.lineTo(0.56, 0.12);
    ctx.lineTo(0.56, 0.2);
    ctx.bezierCurveTo(0.7, 0.22, 0.7, 0.4, 0.6, 0.45);
    ctx.bezierCurveTo(0.86, 0.52, 0.86, 0.92, 0.5, 0.92);
    ctx.bezierCurveTo(0.14, 0.92, 0.14, 0.52, 0.4, 0.45);
    ctx.bezierCurveTo(0.3, 0.4, 0.3, 0.22, 0.44, 0.2);
    ctx.closePath();
    fs(ctx, c);
    ctx.beginPath();
    ctx.rect(0.43, 0.05, 0.14, 0.08);
    fs(ctx, PAL.timber, 0.03);
    line(ctx, 0.38, 0.46, 0.62, 0.46, 0.04, PAL.seal);
    ctx.beginPath();
    ctx.ellipse(0.4, 0.7, 0.05, 0.1, 0.3, 0, Math.PI * 2);
    ctx.fillStyle = rgba(PAL.white, 0.4);
    ctx.fill();
  },
  key(ctx, c) {
    circle(ctx, 0.3, 0.3, 0.16);
    fs(ctx, c, 0.045);
    circle(ctx, 0.3, 0.3, 0.07);
    fs(ctx, PAL.paper, 0.03);
    line(ctx, 0.41, 0.41, 0.82, 0.82, 0.1, INK);
    line(ctx, 0.41, 0.41, 0.82, 0.82, 0.055, c);
    for (const t of [0.66, 0.78]) {
      const x = t, y = t;
      line(ctx, x, y, x + 0.1, y - 0.1, 0.05, INK);
    }
  },
  bundle(ctx, c) {
    smooth(ctx, [[0.16, 0.5], [0.22, 0.86], [0.5, 0.92], [0.8, 0.86], [0.86, 0.5], [0.66, 0.36], [0.5, 0.4], [0.34, 0.36]]);
    fs(ctx, c);
    poly(ctx, [[0.5, 0.4], [0.32, 0.14], [0.46, 0.2], [0.5, 0.36]]);
    fs(ctx, c, 0.035);
    poly(ctx, [[0.5, 0.4], [0.7, 0.12], [0.56, 0.22], [0.52, 0.36]]);
    fs(ctx, c, 0.035);
    circle(ctx, 0.5, 0.4, 0.05);
    fs(ctx, mixHex(c, INK, 0.3), 0.03);
    // 보자기 무늬
    ctx.strokeStyle = rgba(PAL.paper, 0.7);
    ctx.lineWidth = 0.025;
    for (const [x, y] of [[0.34, 0.66], [0.6, 0.72], [0.5, 0.56]]) {
      circle(ctx, x, y, 0.05);
      ctx.stroke();
    }
  },
  scroll(ctx, c) {
    ctx.beginPath();
    ctx.rect(0.22, 0.2, 0.56, 0.6);
    fs(ctx, c);
    for (const y of [0.14, 0.8]) {
      ctx.beginPath();
      ctx.rect(0.16, y, 0.68, 0.07);
      fs(ctx, PAL.timber, 0.03);
    }
    for (let x = 0.66; x > 0.3; x -= 0.1) line(ctx, x, 0.28, x, 0.28 + 0.36 + (x * 37) % 0.12, 0.022, rgba(INK, 0.75));
    ctx.fillStyle = PAL.seal;
    ctx.fillRect(0.28, 0.62, 0.08, 0.08);
  },
  rice(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(0.16, 0.5);
    ctx.bezierCurveTo(0.24, 0.24, 0.76, 0.24, 0.84, 0.5);
    ctx.closePath();
    fs(ctx, c);
    ctx.beginPath();
    ctx.moveTo(0.12, 0.5);
    ctx.lineTo(0.88, 0.5);
    ctx.bezierCurveTo(0.84, 0.76, 0.66, 0.84, 0.5, 0.84);
    ctx.bezierCurveTo(0.34, 0.84, 0.16, 0.76, 0.12, 0.5);
    fs(ctx, PAL.roofTile);
    line(ctx, 0.2, 0.6, 0.8, 0.6, 0.02, rgba(PAL.paper, 0.6));
    ctx.beginPath();
    ctx.rect(0.4, 0.84, 0.2, 0.06);
    fs(ctx, PAL.roofTile, 0.03);
    line(ctx, 0.6, 0.12, 0.86, 0.4, 0.03);
    line(ctx, 0.68, 0.1, 0.9, 0.36, 0.03);
  },
  gem(ctx, c) {
    circle(ctx, 0.5, 0.52, 0.28);
    ctx.lineWidth = 0.18;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 0.12;
    ctx.strokeStyle = c;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.5, 0.52, 0.28, -2.4, -1.6);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = rgba(PAL.white, 0.8);
    ctx.stroke();
  },
  feather(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(0.18, 0.86);
    ctx.bezierCurveTo(0.2, 0.5, 0.48, 0.18, 0.84, 0.12);
    ctx.bezierCurveTo(0.82, 0.46, 0.58, 0.76, 0.24, 0.8);
    ctx.closePath();
    fs(ctx, c);
    ctx.beginPath();
    ctx.moveTo(0.12, 0.92);
    ctx.quadraticCurveTo(0.42, 0.56, 0.82, 0.14);
    ctx.lineWidth = 0.03;
    ctx.stroke();
    for (const t of [0.4, 0.55, 0.7]) line(ctx, 0.12 + t * 0.7, 0.92 - t * 0.78, 0.2 + t * 0.7, 0.96 - t * 0.7, 0.018);
  },
  stone(ctx, c) {
    poly(ctx, [[0.2, 0.62], [0.3, 0.32], [0.56, 0.2], [0.8, 0.36], [0.84, 0.64], [0.6, 0.82], [0.32, 0.8]]);
    fs(ctx, c);
    poly(ctx, [[0.3, 0.32], [0.48, 0.48], [0.56, 0.2]], false);
    ctx.lineWidth = 0.025;
    ctx.stroke();
    poly(ctx, [[0.48, 0.48], [0.6, 0.82]], false);
    ctx.stroke();
    poly(ctx, [[0.48, 0.48], [0.84, 0.64]], false);
    ctx.stroke();
  },
  pouch(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(0.36, 0.34);
    ctx.bezierCurveTo(0.08, 0.5, 0.14, 0.9, 0.5, 0.9);
    ctx.bezierCurveTo(0.86, 0.9, 0.92, 0.5, 0.64, 0.34);
    ctx.closePath();
    fs(ctx, c);
    poly(ctx, [[0.36, 0.34], [0.3, 0.14], [0.5, 0.24], [0.7, 0.14], [0.64, 0.34]]);
    fs(ctx, c, 0.035);
    line(ctx, 0.34, 0.36, 0.66, 0.36, 0.04, PAL.gold);
    circle(ctx, 0.5, 0.62, 0.1);
    ctx.strokeStyle = PAL.gold;
    ctx.lineWidth = 0.03;
    ctx.stroke();
  },
  box(ctx, c) {
    ctx.beginPath();
    ctx.rect(0.14, 0.36, 0.72, 0.48);
    fs(ctx, c);
    ctx.beginPath();
    ctx.rect(0.12, 0.24, 0.76, 0.14);
    fs(ctx, mixHex(c, INK, 0.2));
    ctx.beginPath();
    ctx.rect(0.44, 0.34, 0.12, 0.14);
    fs(ctx, PAL.gold, 0.03);
    for (const x of [0.22, 0.78]) line(ctx, x, 0.38, x, 0.82, 0.03, rgba(INK, 0.6));
  },
  cloth(ctx, c) {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.rect(0.16 + i * 0.03, 0.62 - i * 0.18, 0.68, 0.18);
      fs(ctx, i === 1 ? PAL.paperDeep : c);
    }
    line(ctx, 0.3, 0.32, 0.7, 0.32, 0.02, rgba(PAL.paper, 0.7));
  },
};

/** 단위 상자 아이콘을 (x,y) 에 크기 s 로 그린다. 먹 번짐을 위해 한 번 옅게 어긋나 그린다. */
export function drawIcon(ctx, shape, color, x, y, s) {
  const fn = DRAW[shape] || DRAW[ALIAS[shape]] || DRAW.bundle;
  const col = color || SHAPE_COLOR[shape] || PAL.ink3;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // 번짐 그림자
  ctx.save();
  ctx.translate(0.025, 0.03);
  ctx.globalAlpha = 0.16;
  fn(ctx, col);
  ctx.restore();
  fn(ctx, col);
  ctx.restore();
}

/** 아이템 정의로 아이콘 캔버스 만들기 (CSS 크기 size) */
export function itemIcon(def, size = 42) {
  const c = document.createElement('canvas');
  const r = dpr();
  c.width = Math.round(size * r);
  c.height = Math.round(size * r);
  c.setAttribute('aria-hidden', 'true');
  const ctx = c.getContext('2d');
  if (ctx) {
    const shape = shapeOf(def || {});
    ctx.scale(r, r);
    drawIcon(ctx, shape, colorOf(def || {}, shape), size * 0.06, size * 0.06, size * 0.88);
  }
  return c;
}

// ---------------------------------------------------------------- 지도 표식

const MARK_GLYPH = { mission: '事', stranger: '?', shop: '商', ferry: '津', station: '驛', port: '浦', tram_stop: '電', market: '市', hideout: '巢', camp: '營', respawn: '醫' };

/** 지도·미니맵 표식. s 는 CSS px 크기 */
export function drawMarker(ctx, kind, x, y, s = 14, t = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (kind === 'objective') {
    const pulse = 1 + Math.sin(t * 4) * 0.08;
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = rgba(PAL.paper, 0.9);
    ctx.fillRect(-s * 0.5 * pulse, -s * 0.5 * pulse, s * pulse, s * pulse);
    ctx.lineWidth = Math.max(1.5, s * 0.16);
    ctx.strokeStyle = PAL.seal;
    ctx.strokeRect(-s * 0.42 * pulse, -s * 0.42 * pulse, s * 0.84 * pulse, s * 0.84 * pulse);
    ctx.fillStyle = PAL.seal;
    ctx.fillRect(-s * 0.16, -s * 0.16, s * 0.32, s * 0.32);
  } else if (kind === 'waypoint') {
    // 먹 붓끝 모양 길잡이 핀
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-s * 0.55, -s * 0.7, -s * 0.45, -s * 1.3, 0, -s * 1.3);
    ctx.bezierCurveTo(s * 0.45, -s * 1.3, s * 0.55, -s * 0.7, 0, 0);
    ctx.fillStyle = PAL.ink;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(PAL.paper, 0.9);
    ctx.stroke();
    ctx.fillStyle = PAL.paper;
    ctx.beginPath();
    ctx.arc(0, -s * 0.88, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const g = MARK_GLYPH[kind] || '·';
    const seal = kind === 'mission' || kind === 'stranger';
    ctx.fillStyle = seal ? (kind === 'stranger' ? PAL.ink2 : PAL.seal) : rgba(PAL.paper, 0.92);
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.lineWidth = Math.max(1, s * 0.09);
    ctx.strokeStyle = seal ? rgba(PAL.paper, 0.85) : PAL.ink;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = seal ? PAL.paper : PAL.ink;
    ctx.font = `${Math.round(s * 0.74)}px ${FONT.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g, 0, s * 0.04);
  }
  ctx.restore();
}

/** 북쪽 위 고정 지도에서 플레이어 화살표(먹 삼각) */
export function drawPlayerArrow(ctx, x, y, angle, s = 10) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(s, 0);
  ctx.lineTo(-s * 0.7, -s * 0.62);
  ctx.quadraticCurveTo(-s * 0.35, 0, -s * 0.7, s * 0.62);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = rgba(PAL.paper, 0.95);
  ctx.stroke();
  ctx.fillStyle = PAL.ink;
  ctx.fill();
  ctx.restore();
}

const VEH_GLYPH = {
  horse: '馬', pony: '馬', jeju_horse: '馬', western_horse: '馬',
  rowboat: '舟', sailboat: '帆', steamer: '船', gama: '轎', rickshaw: '車', bicycle: '輪', oxcart: '牛', tram: '電', train: '汽',
};
export function vehicleGlyph(vtype) {
  return VEH_GLYPH[vtype] || '車';
}

/** 탈것 아이콘: 둥근 먹 원 + 한자 + 진행 방향 눈금 */
export function drawVehicleMark(ctx, x, y, angle, vtype, s = 11) {
  ctx.save();
  ctx.translate(x, y);
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(s * 1.55, 0);
  ctx.lineTo(s * 0.9, -s * 0.42);
  ctx.lineTo(s * 0.9, s * 0.42);
  ctx.closePath();
  ctx.fillStyle = PAL.ink;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, s, 0, Math.PI * 2);
  ctx.fillStyle = PAL.ink;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(PAL.paper, 0.9);
  ctx.stroke();
  ctx.fillStyle = PAL.paper;
  ctx.font = `${Math.round(s * 1.15)}px ${FONT.display}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(vehicleGlyph(vtype), 0, s * 0.06);
  ctx.restore();
}
