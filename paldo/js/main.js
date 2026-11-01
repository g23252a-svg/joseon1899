// 부팅: 글꼴을 잠깐 기다리고 → 타이틀 → 새 게임/이어 하기
import { createApp } from './ui/app.js';
import { showTitle } from './ui/title.js';
import { store } from './ui/dom.js';
import { toast } from './ui/modal.js';
import { newGame } from './core/state.js';
import { buildGeo } from './core/geo.js';

buildGeo();
const saves = () => ['auto', 1, 2, 3].map((slot) => { try { const m = JSON.parse(store.get(`paldo.slot.${slot}.meta`) || 'null'); return m ? { slot, ...m } : null; } catch { return null; } }).filter(Boolean);
let app;
const title = () => {
  document.getElementById('app').hidden = true;
  showTitle({
    saves,
    onNew: ({ scenario, player, difficulty }) => {
      const S = newGame({ scenario, player, difficulty });
      app.start(S, { intro: true });
    },
    onContinue: (slot) => {
      if (!app.load(slot)) { toast('저장을 불러오지 못했다.', 'bad'); title(); }
    },
  });
};
app = createApp({ onTitle: title });
const fontWait = document.fonts?.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
fontWait.then(title);
window.addEventListener('error', (e) => { try { toast('오류: ' + e.message, 'bad', 8000); } catch { /* */ } });
