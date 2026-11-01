// 코드로 그리는 수묵 초상. look(신분) + seed(얼굴 변주). 캔버스 → dataURL 캐시.
import { hash } from '../core/util.js';
const cache = new Map();
const INK = '#1d1b18';

export function portrait(o, w = 96) {
  const key = `${o.id}|${o.look}|${o.seed}|${w}`;
  if (cache.has(key)) return cache.get(key);
  const hgt = Math.round(w * 1.18);
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr);
  const g = c.getContext('2d');
  g.scale(dpr * (w / 96), dpr * (w / 96));
  try { draw(g, o); } catch (e) { /* 그리기 실패해도 빈 칸 */ }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

const rnd = (seed, n) => hash((seed >>> 0) * 31 + n * 7919);
function draw(g, o) {
  const s = o.seed || 1;
  const r = (n) => rnd(s, n);
  const look = o.look || 'civil';
  // 바탕: 한지 + 옅은 먹 번짐
  g.fillStyle = '#efe6d2'; g.fillRect(0, 0, 96, 114);
  const grd = g.createRadialGradient(48, 46, 8, 48, 50, 70);
  grd.addColorStop(0, 'rgba(255,255,255,0.0)'); grd.addColorStop(1, 'rgba(120,100,70,0.22)');
  g.fillStyle = grd; g.fillRect(0, 0, 96, 114);
  if (look === 'tiger') return tiger(g);
  const female = look === 'woman';
  const skin = ['#e9cba3', '#e2bd92', '#dcb48a', '#eed3b0'][Math.floor(r(1) * 4)];
  const fw = 30 + r(2) * 6, fh = 36 + r(3) * 5;
  const cx = 48, cy = 50;
  // 옷
  const robe = robeColor(look, r);
  g.fillStyle = robe;
  g.beginPath();
  g.moveTo(8, 114); g.quadraticCurveTo(14, 82, 48, 78); g.quadraticCurveTo(82, 82, 88, 114); g.closePath(); g.fill();
  g.strokeStyle = INK; g.lineWidth = 1.6; g.stroke();
  // 깃·장식
  if (look === 'king') { // 곤룡포 보(補)
    g.fillStyle = '#c9a227'; g.beginPath(); g.arc(48, 99, 9, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#7a5a10'; g.lineWidth = 1; g.stroke();
    g.strokeStyle = '#7a5a10'; g.beginPath(); g.arc(48, 99, 5, 0.3, 5.5); g.stroke();
  } else if (look === 'civil') { // 흉배
    g.fillStyle = 'rgba(255,240,200,0.75)'; g.fillRect(38, 92, 20, 16); g.strokeStyle = '#7a5a10'; g.lineWidth = 0.8; g.strokeRect(38, 92, 20, 16);
    g.beginPath(); g.moveTo(42, 104); g.quadraticCurveTo(48, 94, 54, 104); g.stroke();
  } else if (look === 'military' || look === 'ming' || look === 'wae') { // 갑옷 비늘
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.8;
    for (let y = 88; y < 114; y += 5) for (let x = 16 + ((y / 5) % 2) * 3; x < 82; x += 6) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI); g.stroke(); }
  } else if (look === 'monk') { // 가사
    g.fillStyle = '#8a4b2a'; g.beginPath(); g.moveTo(20, 114); g.lineTo(60, 80); g.lineTo(72, 86); g.lineTo(40, 114); g.closePath(); g.fill();
  } else if (look === 'modern') { // 양복 깃·넥타이
    g.fillStyle = '#f7f1e3'; g.beginPath(); g.moveTo(40, 80); g.lineTo(48, 98); g.lineTo(56, 80); g.closePath(); g.fill();
    g.fillStyle = '#7a221c'; g.beginPath(); g.moveTo(46, 84); g.lineTo(50, 84); g.lineTo(51, 100); g.lineTo(48, 104); g.lineTo(45, 100); g.closePath(); g.fill();
  }
  // 깃(동정)
  if (!['modern', 'wae', 'military', 'ming'].includes(look)) {
    g.strokeStyle = '#f7f1e3'; g.lineWidth = 4; g.beginPath(); g.moveTo(36, 80); g.lineTo(48, 96); g.lineTo(60, 80); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(34, 81); g.lineTo(48, 98); g.lineTo(62, 81); g.stroke();
  }
  // 목
  g.fillStyle = skin; g.fillRect(cx - 7, cy + fh / 2 - 6, 14, 14);
  // 머리(뒤): 여인의 쪽, 상투
  if (female) {
    g.fillStyle = '#1d1b18'; g.beginPath(); g.ellipse(cx, cy - 6, fw / 2 + 4, fh / 2 + 2, 0, Math.PI, 0); g.fill();
    g.beginPath(); g.ellipse(cx, cy + fh / 2 - 2, 9, 7, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c9a227'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx - 16, cy + fh / 2 - 3); g.lineTo(cx + 16, cy + fh / 2 - 1); g.stroke();
  }
  // 얼굴
  g.fillStyle = skin;
  g.beginPath(); g.ellipse(cx, cy, fw / 2, fh / 2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(29,27,24,0.75)'; g.lineWidth = 1.2; g.stroke();
  // 귀
  g.fillStyle = skin; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * (fw / 2 + 1), cy + 2, 3, 5, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
  // 눈썹(무력이 높으면 짙게)
  const strong = Math.min(1, (o.str || 50) / 100);
  const angry = r(5) < 0.4 || look === 'wae' || (o.str || 0) > 85;
  g.strokeStyle = INK; g.lineCap = 'round';
  g.lineWidth = 1.4 + strong * 2.2;
  for (const sx of [-1, 1]) {
    g.beginPath();
    const ex = cx + sx * 8;
    g.moveTo(ex - sx * 6, cy - 7 + (angry ? 2 : 0)); g.quadraticCurveTo(ex, cy - 10, ex + sx * 6, cy - 8 - (angry ? 2 : 0));
    g.stroke();
  }
  // 눈
  g.lineWidth = 1.6;
  const eyeW = 4 + r(6) * 2;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * 8;
    g.beginPath(); g.moveTo(ex - eyeW, cy - 2); g.quadraticCurveTo(ex, cy - 4.5, ex + eyeW, cy - 2); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(ex + sx * 0.5, cy - 2.3, 1.4, 0, Math.PI * 2); g.fill();
  }
  // 코·입
  g.lineWidth = 1; g.strokeStyle = 'rgba(29,27,24,0.7)';
  g.beginPath(); g.moveTo(cx, cy - 1); g.lineTo(cx - 2, cy + 7); g.lineTo(cx + 2, cy + 8); g.stroke();
  g.beginPath(); g.moveTo(cx - 5, cy + 13); g.quadraticCurveTo(cx, cy + (r(7) < 0.5 ? 14.5 : 12.5), cx + 5, cy + 13); g.stroke();
  if (female) { g.fillStyle = 'rgba(200,70,60,0.5)'; g.beginPath(); g.ellipse(cx, cy + 13, 3, 1.4, 0, 0, Math.PI * 2); g.fill(); for (const sx of [-1, 1]) { g.fillStyle = 'rgba(220,120,110,0.22)'; g.beginPath(); g.arc(cx + sx * 10, cy + 6, 4, 0, Math.PI * 2); g.fill(); } }
  // 수염
  if (!female && look !== 'modern' && !(look === 'monk' && r(8) < 0.5)) {
    const bs = look === 'king' ? 2 : look === 'wae' ? Math.floor(r(9) * 2) : Math.floor(r(9) * 4);
    g.strokeStyle = INK; g.fillStyle = 'rgba(29,27,24,0.85)';
    if (bs >= 1) { g.lineWidth = 1.6; for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(cx + sx * 1.5, cy + 10.5); g.quadraticCurveTo(cx + sx * 7, cy + 10, cx + sx * 9, cy + 14); g.stroke(); } }
    if (bs >= 2) { g.beginPath(); g.moveTo(cx - 4, cy + 16); g.quadraticCurveTo(cx, cy + 30 + r(10) * 10, cx + 4, cy + 16); g.closePath(); g.fill(); }
    if (bs >= 3) { g.beginPath(); g.moveTo(cx - fw / 2 + 2, cy + 4); g.quadraticCurveTo(cx - fw / 2 + 4, cy + 22, cx, cy + 26); g.quadraticCurveTo(cx + fw / 2 - 4, cy + 22, cx + fw / 2 - 2, cy + 4); g.quadraticCurveTo(cx, cy + 18, cx - fw / 2 + 2, cy + 4); g.fill(); }
  }
  // 모자
  hat(g, look, cx, cy, fw, fh, r);
  // 테두리 먹선
  g.strokeStyle = 'rgba(29,27,24,0.25)'; g.lineWidth = 2; g.strokeRect(1, 1, 94, 112);
}

function robeColor(look, r) {
  switch (look) {
    case 'king': return '#a8322a';
    case 'civil': return ['#2f4a7c', '#3d6b4a', '#8a3a3a', '#5a4a7a'][Math.floor(r(11) * 4)];
    case 'military': return ['#3a3530', '#2f3d4a', '#4a2f2a'][Math.floor(r(11) * 3)];
    case 'scholar': return '#f2ece0';
    case 'monk': return '#8a8478';
    case 'rebel': return ['#d9cfb8', '#a89a7a', '#7a6a4a'][Math.floor(r(11) * 3)];
    case 'woman': return ['#c4607e', '#5d8a6f', '#d0a23a', '#6b7ab0'][Math.floor(r(11) * 4)];
    case 'merchant': return '#7a5a3a';
    case 'wae': return ['#2a2a2a', '#5a2a2a', '#2a3a5a'][Math.floor(r(11) * 3)];
    case 'ming': return '#8a2a2a';
    case 'modern': return '#2a2a30';
    default: return '#5a5a5a';
  }
}

function hat(g, look, cx, cy, fw, fh, r) {
  const top = cy - fh / 2;
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1.2;
  if (look === 'king') { // 익선관
    g.beginPath(); g.ellipse(cx, top + 3, fw / 2 + 2, 11, 0, Math.PI, 0); g.fill();
    g.fillRect(cx - fw / 2 - 2, top + 1, fw + 4, 6);
    for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * 9, top - 10, 6, 9, sx * 0.4, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#c9a227'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - fw / 2, top + 5); g.lineTo(cx + fw / 2, top + 5); g.stroke();
  } else if (look === 'civil') { // 사모
    g.beginPath(); g.ellipse(cx, top + 3, fw / 2 + 1, 12, 0, Math.PI, 0); g.fill();
    g.beginPath(); g.ellipse(cx, top - 6, 9, 8, 0, Math.PI, 0); g.fill();
    for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * (fw / 2 + 9), top - 2, 10, 3, 0, 0, Math.PI * 2); g.fill(); }
  } else if (look === 'scholar' || look === 'merchant') { // 갓
    g.globalAlpha = 0.9;
    g.beginPath(); g.ellipse(cx, top + 2, 34, 6, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(cx - 12, top + 1); g.lineTo(cx - 10, top - 18); g.quadraticCurveTo(cx, top - 21, cx + 10, top - 18); g.lineTo(cx + 12, top + 1); g.closePath(); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(29,27,24,0.8)'; g.lineWidth = 0.8;
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(cx + sx * (fw / 2 - 2), cy + 4); g.quadraticCurveTo(cx + sx * 8, cy + fh / 2 + 6, cx + sx * 3, cy + fh / 2 + 12); g.stroke(); }
  } else if (look === 'military') { // 전립 + 붉은 상모
    if (r(12) < 0.5) {
      g.beginPath(); g.ellipse(cx, top + 2, 30, 5, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(cx, top - 2, 15, 12, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#c4473b'; g.beginPath(); g.ellipse(cx, top - 15, 6, 4, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#c9a227'; g.lineWidth = 1; g.beginPath(); g.arc(cx, top - 6, 4, 0, Math.PI * 2); g.stroke();
    } else { // 투구
      g.fillStyle = '#4a4540'; g.beginPath(); g.ellipse(cx, top + 4, fw / 2 + 3, 15, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#2a2622'; g.fillRect(cx - fw / 2 - 3, top + 2, fw + 6, 5);
      g.strokeStyle = '#c9a227'; g.beginPath(); g.moveTo(cx, top - 11); g.lineTo(cx, top - 22); g.stroke();
      g.fillStyle = '#c4473b'; g.beginPath(); g.moveTo(cx, top - 22); g.quadraticCurveTo(cx + 9, top - 18, cx + 4, top - 8); g.lineTo(cx, top - 14); g.fill();
      for (const sx of [-1, 1]) { g.fillStyle = '#3a3530'; g.fillRect(cx + sx * (fw / 2 + 1) - (sx > 0 ? 0 : 6), top + 6, 6, 18); }
    }
  } else if (look === 'ming') {
    g.fillStyle = '#5a4a3a'; g.beginPath(); g.ellipse(cx, top + 4, fw / 2 + 4, 16, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#c9a227'; g.fillRect(cx - fw / 2 - 4, top + 1, fw + 8, 5);
    g.fillStyle = '#c4473b'; for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(cx - 3 + i, top - 12); g.lineTo(cx - 6 + i * 2, top - 26); g.lineTo(cx - 2 + i, top - 12); g.fill(); }
  } else if (look === 'wae') { // 가부토
    g.fillStyle = '#2a2622'; g.beginPath(); g.ellipse(cx, top + 4, fw / 2 + 4, 15, 0, Math.PI, 0); g.fill();
    g.beginPath(); g.moveTo(cx - fw / 2 - 12, top + 14); g.quadraticCurveTo(cx, top + 2, cx + fw / 2 + 12, top + 14); g.lineTo(cx + fw / 2 + 4, top + 4); g.lineTo(cx - fw / 2 - 4, top + 4); g.closePath(); g.fill();
    g.strokeStyle = '#c9a227'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx - 3, top - 6); g.quadraticCurveTo(cx - 14, top - 18, cx - 10, top - 28); g.stroke();
    g.beginPath(); g.moveTo(cx + 3, top - 6); g.quadraticCurveTo(cx + 14, top - 18, cx + 10, top - 28); g.stroke();
  } else if (look === 'rebel') { // 두건
    g.fillStyle = '#2a2622'; g.beginPath(); g.ellipse(cx, top + 6, fw / 2 + 1, 10, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#f2ece0'; g.fillRect(cx - fw / 2 - 1, top + 3, fw + 2, 6); g.strokeRect(cx - fw / 2 - 1, top + 3, fw + 2, 6);
    g.beginPath(); g.moveTo(cx + fw / 2, top + 6); g.lineTo(cx + fw / 2 + 10, top + 14); g.lineTo(cx + fw / 2 + 6, top + 2); g.closePath(); g.fill(); g.stroke();
  } else if (look === 'monk') {
    g.fillStyle = 'rgba(120,100,80,0.18)'; g.beginPath(); g.ellipse(cx, top + 8, fw / 2, 10, 0, Math.PI, 0); g.fill();
  } else if (look === 'modern') {
    g.fillStyle = '#1d1b18'; g.beginPath(); g.ellipse(cx, top + 6, fw / 2 + 1, 10, 0, Math.PI, 0); g.fill();
    g.beginPath(); g.moveTo(cx - fw / 2 - 1, top + 6); g.quadraticCurveTo(cx - 6, top - 2, cx + 4, top + 4); g.lineTo(cx - fw / 2 - 1, top + 12); g.fill();
  } else if (look === 'woman') {
    g.fillStyle = '#1d1b18'; g.beginPath(); g.ellipse(cx, top + 6, fw / 2 + 2, 11, 0, Math.PI, 0); g.fill();
    g.strokeStyle = '#efe6d2'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx, top - 4); g.lineTo(cx, top + 6); g.stroke();
  }
}

function tiger(g) {
  g.fillStyle = '#d9902f';
  g.beginPath(); g.ellipse(48, 58, 36, 34, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  for (const sx of [-1, 1]) { g.fillStyle = '#d9902f'; g.beginPath(); g.arc(48 + sx * 26, 28, 9, 0, Math.PI * 2); g.fill(); g.stroke(); }
  g.fillStyle = '#f7f1e3'; g.beginPath(); g.ellipse(48, 74, 18, 13, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = INK; g.lineWidth = 3;
  for (const [x, y, a] of [[30, 40, 0.5], [66, 40, -0.5], [22, 58, 0.2], [74, 58, -0.2], [48, 30, 0], [40, 34, 0.3], [56, 34, -0.3]]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 8, y + 8); g.stroke(); }
  g.fillStyle = '#c9a227'; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(48 + sx * 12, 52, 5, 4, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = INK; g.beginPath(); g.ellipse(48 + sx * 12, 52, 1.5, 3.5, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#c9a227'; }
  g.fillStyle = INK; g.beginPath(); g.moveTo(42, 66); g.lineTo(54, 66); g.lineTo(48, 72); g.fill();
}
