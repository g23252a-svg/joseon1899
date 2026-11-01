// 전투 화면과 일기토 화면
import { h, clear, bar } from './dom.js';
import { modal, ask, sleep } from './modal.js';
import { portrait } from './portrait.js';
import { audio } from './audio.js';
import { fmt, josa, pp } from '../core/util.js';
import { regionBase, SEASONS, eff } from '../core/state.js';
import {
  TACTICS, tacticsFor, aiTactic, resolveRound, champion, aiAcceptDuel, createDuel, applyDuel, refuseDuel, autoBattle, activeOffs,
  schemeChance, DUEL_ACTS, duelStep, aiDuelAction, autoDuel,
} from '../core/battle.js';

const TERRAIN = { plain: '평야', river: '강가', mountain: '산지', coast: '해안', island: '섬', sea: '바다' };
const HANJA = { charge: '突', volley: '射', hold: '守', scheme: '計', duel: '鬪', retreat: '退' };

// 플레이어가 끼는 전투. 끝나면 resolve.
export function runBattle(S, B) {
  return new Promise((resolve) => {
    const me = B.atk.fid === S.player ? 'atk' : 'def';
    const foe = me === 'atk' ? 'def' : 'atk';
    let auto = !!S.settings.autoBattle;
    let busyRound = false;
    const canvas = h('canvas#bcanvas');
    const left = h('div.army'), right = h('div.army');
    const tacs = h('div.tacs');
    const logEl = h('div.blog');
    const head = h('div.row', { style: { justifyContent: 'space-between' } });
    const anim = { flash: 0, tA: null, tD: null, t0: 0, dA: 0, dD: 0 };
    const autoBox = h('label.switch', h('input', { type: 'checkbox', checked: auto || null, onchange: (e) => { auto = e.target.checked; S.settings.autoBattle = auto; if (auto) step(); } }), '자동 진행');
    const skipBtn = h('button.btn.small', { onclick: () => { audio.play('click'); autoBattle(S, B); refresh(); finish(); } }, '끝까지 맡기기');
    const m = modal({
      title: battleTitle(S, B), cls: 'battle full', closable: false,
      body: [head, h('div.bf', { style: { marginTop: '8px' } }, left, h('div.mid', { style: { position: 'relative' } }, canvas), right), h('div', { style: { marginTop: '10px' } }, tacs), h('div.box', { style: { marginTop: '10px' } }, h('h3', '전황'), logEl)],
      footer: [autoBox, skipBtn],
    });
    audio.play('drums');
    function sideCol(side) {
      const s = B[side];
      const f = s.fid ? S.factions[s.fid] : null;
      const color = f ? f.color : '#8a8274';
      const offs = s.officers.map((id) => S.officers[id] || B.temp[id]).filter(Boolean);
      return [
        h('div.hd', h('span.crest', { style: { background: color, width: '28px', height: '28px', fontSize: '15px' } }, f ? f.crest : '守'), f ? f.name + ' 군' : (S.regions[B.to].rebels ? '민란군' : '토호 수비대'), side === me ? h('span.badge.r', '아군') : null),
        h('div.offs', offs.map((o) => h('img', { src: portrait(o, 46), alt: o.name, title: `${o.name} 통${o.lea} 무${o.str} 지${o.int}`, class: s.out.includes(o.id) ? 'out' : '' }))),
        h('div', { style: { fontSize: '12px', color: 'var(--ink-2)' } }, offs.map((o) => o.name).join(' · ')),
        h('div.gauge', h('span', '병력'), bar(s.troops, s.troops0, color), h('span.v', fmt(s.troops))),
        h('div.gauge', h('span', '사기'), bar(s.morale, 100, s.morale < 30 ? '#a8322a' : '#a8842a'), h('span.v', Math.round(s.morale))),
        h('div.gauge', h('span', '훈련'), bar(s.training, 100, '#4a453d'), h('span.v', Math.round(s.training))),
      ];
    }
    function refresh() {
      clear(left).append(...sideCol('atk'));
      clear(right).append(...sideCol('def'));
      clear(head).append(
        h('div.tags', h('span.tag', `${Math.min(B.round + 1, B.maxRounds)}일째 / ${B.maxRounds}일`), h('span.tag', TERRAIN[B.terrain] || B.terrain), h('span.tag', SEASONS[B.season]), B.siege ? h('span.tag.w', `성곽 ${Math.round(B.wall)} / ${Math.round(B.wall0)}`) : null, B.naval ? h('span.tag.b', '해전') : null),
        h('div', { style: { fontSize: '12.5px', color: 'var(--ink-3)' } }, me === 'atk' ? '공격' : '수비'),
      );
      clear(logEl).append(...B.log.slice(-14).map((l) => h('div', { class: l.kind === 'duel' ? 'duel' : '' }, `${l.r ? l.r + '일 ' : ''}${l.text}`)));
      clear(tacs);
      for (const t of tacticsFor(S, B, me)) {
        let extra = '';
        if (t.id === 'scheme' && t.ok) extra = ` (${Math.round(schemeChance(S, B, me, null) * 100)}%)`;
        tacs.append(h('button.tac', { disabled: !t.ok || B.over || busyRound || null, title: t.ok ? t.desc : t.why, onclick: () => choose(t.id) },
          h('span.hz', HANJA[t.id]), h('span.nm', t.name + extra), h('span.ds', t.ok ? t.desc.split('.')[0] : t.why)));
      }
      drawField();
    }
    async function choose(tid) {
      if (busyRound || B.over) return;
      busyRound = true;
      audio.play('click');
      refresh();
      const ai = aiTactic(S, B, foe);
      if (tid === 'duel' || (ai === 'duel' && tid !== 'retreat')) {
        const chSide = tid === 'duel' ? me : foe;
        const ch = champion(S, B, chSide);
        let accepted;
        if (chSide === me) accepted = ai === 'duel' || aiAcceptDuel(S, B, foe, ch);
        else accepted = await ask('일기토 신청', `적장 ${ch.name}(무력 ${eff(ch).str})${pp(ch.name, '이/가')} 일기토를 청한다!\n받으면 우리 장수 ${josa(champion(S, B, me)?.name, '이/가')} 나선다.\n거절하면 사기가 떨어진다.`, '받는다', '피한다');
        if (accepted) {
          const myC = champion(S, B, me), foeC = champion(S, B, foe);
          const D = chSide === me ? createDuel(S, myC, foeC) : createDuel(S, foeC, myC);
          await runDuel(S, D, chSide === me ? 'a' : 'b', `${regionBase(B.to).name} 일기토`);
          applyDuel(S, B, chSide, D);
        } else refuseDuel(S, B, chSide);
      } else {
        const tA = me === 'atk' ? tid : ai, tD = me === 'atk' ? ai : tid;
        resolveRound(S, B, tA, tD);
        const last = B.log[B.log.length - 1];
        anim.tA = tA; anim.tD = tD; anim.t0 = performance.now(); anim.dA = last?.dA || 0; anim.dD = last?.dD || 0;
        audio.play(tA === 'charge' || tD === 'charge' ? 'clash' : 'hit');
        animate();
        await sleep(auto ? 420 : 650);
      }
      busyRound = false;
      refresh();
      if (B.over) return finish();
      if (auto) step();
    }
    function step() { if (!busyRound && !B.over && auto) setTimeout(() => choose(aiTactic(S, B, me)), 250); }
    function finish() {
      refresh();
      const won = B.winner === me;
      audio.play(won ? 'win' : 'lose');
      const reason = { rout: '적이 무너졌다', destroyed: '적이 전멸했다', timeout: me === 'def' ? '적이 지쳐 물러났다' : '성을 끝내 떨구지 못했다', retreat: '한쪽이 물러났다' }[B.reason] || '';
      const atkLoss = B.atk.troops0 - B.atk.troops, defLoss = B.def.troops0 - B.def.troops;
      const ov = h('div.bres', h('div', { style: { textAlign: 'center' } },
        h('div.big.' + (won ? 'win' : 'lose'), won ? '승리' : '패배'),
        h('p', { style: { fontSize: '16px' } }, reason),
        h('p', `공격측 손실 ${fmt(atkLoss)} · 수비측 손실 ${fmt(defLoss)}`),
        h('button.btn.primary', { style: { marginTop: '8px', padding: '10px 26px', fontSize: '16px' }, onclick: () => { m.close(); resolve(); } }, '확인')));
      m.el.querySelector('.mid').append(ov);
      clear(m.foot);
    }
    // 전장 그림
    function drawField() {
      const g = canvas.getContext('2d');
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(200, rect.width), hh = Math.max(150, rect.height);
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = Math.min(1, (performance.now() - anim.t0) / 700);
      // 바탕
      const sky = g.createLinearGradient(0, 0, 0, hh);
      if (B.naval) { sky.addColorStop(0, '#d9dfd6'); sky.addColorStop(0.45, '#cbd5d0'); sky.addColorStop(1, '#9fb3b0'); }
      else { sky.addColorStop(0, '#efe6d2'); sky.addColorStop(0.5, '#e6dbc2'); sky.addColorStop(1, '#d4c4a0'); }
      g.fillStyle = sky; g.fillRect(0, 0, w, hh);
      // 먼 산
      g.fillStyle = 'rgba(29,27,24,0.12)';
      g.beginPath(); g.moveTo(0, hh * 0.45);
      for (let x = 0; x <= w; x += 20) g.lineTo(x, hh * 0.42 - Math.abs(Math.sin(x * 0.013 + B.round * 0.1)) * hh * 0.18 - (B.terrain === 'mountain' ? 25 : 0));
      g.lineTo(w, hh * 0.5); g.lineTo(0, hh * 0.5); g.fill();
      // 성벽
      if (B.siege) {
        const wh = 26 * (B.wall / Math.max(1, B.wall0 || 1)) + 6;
        g.fillStyle = '#8a7e66'; g.fillRect(w * 0.7, hh * 0.62 - wh, 10, wh + hh * 0.3);
        g.fillStyle = '#4a453d';
        for (let y = hh * 0.62 - wh; y < hh; y += 9) g.fillRect(w * 0.7, y, 10, 1);
        for (let k = 0; k < 4; k++) g.fillRect(w * 0.7 - 2, hh * 0.62 - wh - 6 + 0, 4, 6), g.fillRect(w * 0.7 + 8, hh * 0.62 - wh - 6, 4, 6);
      }
      // 군대: 병력 비례 깃발·창
      const drawArmy = (side, x0, dir) => {
        const s = B[side];
        const f = s.fid ? S.factions[s.fid] : null;
        const color = f ? f.color : '#8a8274';
        const n = Math.max(1, Math.round(Math.sqrt(s.troops / 120)));
        const cols = Math.ceil(Math.sqrt(n * 1.6));
        let push = 0;
        const tac = side === 'atk' ? anim.tA : anim.tD;
        if (tac === 'charge') push = Math.sin(t * Math.PI) * 30;
        if (tac === 'retreat') push = -t * 20;
        for (let i = 0; i < n; i++) {
          const c = i % cols, r = Math.floor(i / cols);
          const x = x0 + dir * (c * 9 + push) + ((r % 2) * 4 * dir);
          const y = hh * 0.6 + r * 9;
          if (y > hh - 6) continue;
          if (B.naval) { g.fillStyle = '#4a3a2a'; g.fillRect(x - 6, y + 2, 12, 3); }
          g.strokeStyle = '#1d1b18'; g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x, y - 6); g.stroke();
          g.fillStyle = color; g.fillRect(x + (dir > 0 ? 0 : -5), y - 6, 5, 4);
        }
        // 대장기
        g.strokeStyle = '#1d1b18'; g.lineWidth = 2;
        const fx = x0 - dir * 10;
        g.beginPath(); g.moveTo(fx, hh * 0.6 + 10); g.lineTo(fx, hh * 0.32); g.stroke();
        g.fillStyle = color; g.beginPath(); g.moveTo(fx, hh * 0.32); g.lineTo(fx + dir * 26, hh * 0.35); g.lineTo(fx, hh * 0.41); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#fff'; g.font = '14px "Song Myung", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(f ? f.crest : '守', fx + dir * 9, hh * 0.36);
      };
      drawArmy('atk', w * 0.12, 1);
      drawArmy('def', w * 0.88, -1);
      // 화살·불·충돌
      if (anim.t0 && t < 1) {
        const tac = [anim.tA, anim.tD];
        tac.forEach((tc, i) => {
          const from = i === 0 ? w * 0.25 : w * 0.75, to = i === 0 ? w * 0.75 : w * 0.25;
          if (tc === 'volley') {
            g.strokeStyle = 'rgba(29,27,24,0.7)'; g.lineWidth = 1;
            for (let k = 0; k < 14; k++) {
              const p = Math.min(1, t * 1.3 - k * 0.03);
              if (p <= 0) continue;
              const x = from + (to - from) * p, y = hh * 0.55 - Math.sin(p * Math.PI) * hh * 0.25 + (k % 5) * 4;
              g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sign(to - from) * 8, y + 2); g.stroke();
            }
          }
          if (tc === 'scheme') {
            g.fillStyle = `rgba(200, 80, 40, ${0.5 * (1 - t)})`;
            for (let k = 0; k < 8; k++) { g.beginPath(); g.arc(to + Math.sin(k * 2.1) * 30, hh * 0.62 + Math.cos(k * 1.7) * 14, 10 + t * 14, 0, Math.PI * 2); g.fill(); }
          }
          if (tc === 'hold') { g.strokeStyle = `rgba(47, 74, 92, ${0.7 * (1 - t)})`; g.lineWidth = 3; g.beginPath(); g.arc(i === 0 ? w * 0.18 : w * 0.82, hh * 0.65, 34 + t * 6, -1.2, 1.2 * (i === 0 ? 1 : 1)); g.stroke(); }
        });
        if (anim.tA === 'charge' || anim.tD === 'charge') {
          g.fillStyle = `rgba(168, 50, 42, ${0.6 * Math.sin(t * Math.PI)})`;
          g.font = `${30 + t * 20}px "Nanum Brush Script", cursive`; g.textAlign = 'center';
          g.fillText('와아아!', w / 2, hh * 0.3);
        }
        // 피해 숫자
        g.font = '700 14px "Gowun Batang", serif'; g.fillStyle = `rgba(168,50,42,${1 - t})`;
        if (anim.dD) g.fillText('-' + fmt(anim.dD), w * 0.82, hh * 0.5 - t * 18);
        if (anim.dA) g.fillText('-' + fmt(anim.dA), w * 0.18, hh * 0.5 - t * 18);
      }
    }
    function animate() {
      drawField();
      if (performance.now() - anim.t0 < 750 && m.el.isConnected) requestAnimationFrame(animate);
    }
    refresh();
    if (auto) step();
  });
}
function battleTitle(S, B) {
  const a = S.factions[B.atk.fid];
  if (B.naval) return `${regionBase(B.from).name} 앞바다 해전`;
  return `${regionBase(B.to).name} 전투 — ${a.name} 군의 ${B.siege ? '공성' : '공격'}`;
}

// 일기토. mySide: 'a' 또는 'b'(플레이어가 조종하는 쪽). 사건 일기토에도 쓴다.
export function runDuel(S, D, mySide = 'a', title = '일기토') {
  return new Promise((resolve) => {
    const foe = mySide === 'a' ? 'b' : 'a';
    let lock = false;
    const fighter = (k) => {
      const o = S.officers[D[k].id] || { id: D[k].id, look: D[k].look, seed: D[k].seed, name: D[k].name, str: D[k].str };
      return h('div.f', { id: 'df-' + k },
        h('img', { src: portrait(o, 120), alt: D[k].name }),
        h('b', { style: { fontSize: '17px' } }, D[k].name, k === mySide ? h('span.badge.r', { style: { marginLeft: '5px' } }, '아군') : null),
        h('div', { style: { fontSize: '12px', color: 'var(--ink-2)' } }, `무력 ${Math.round(D[k].str)}`),
        h('div.hp', h('i', { style: { width: D[k].hp + '%' } })),
        h('div.ki', h('i', { style: { width: D[k].ki + '%' } })),
      );
    };
    const arena = h('div.duel');
    const bang = h('div.bang');
    const acts = h('div.dacts');
    const lg = h('div.blog', { style: { maxHeight: '110px' } });
    const m = modal({ title, closable: false, wide: true, body: [arena, bang, acts, h('div.box', { style: { marginTop: '10px' } }, lg)], footer: [h('button.btn.small', { onclick: () => { autoDuel(D); render(); end(); } }, '맡기기')] });
    audio.play('gong');
    function render(hit) {
      clear(arena).append(fighter('a'), h('div.vs', '對'), fighter('b'));
      if (hit) for (const k of hit) arena.querySelector('#df-' + k)?.classList.add('hit');
      clear(acts);
      for (const id in DUEL_ACTS) {
        const A = DUEL_ACTS[id];
        const dis = lock || D.over || (id === 'special' && D[mySide].ki < 100);
        acts.append(h('button.tac', { disabled: dis || null, onclick: () => act(id), title: A.desc }, h('span.nm', A.name), h('span.ds', A.desc)));
      }
      clear(lg).append(...D.log.slice(-8).map((l) => h('div', `${l.r}합 — ${l.text}`)));
    }
    async function act(id) {
      if (lock || D.over) return;
      lock = true;
      const ai = aiDuelAction(D, foe);
      const a = mySide === 'a' ? id : ai, b = mySide === 'a' ? ai : id;
      duelStep(D, a, b);
      const last = D.log[D.log.length - 1];
      const hit = [];
      if (last.da) hit.push('a'); if (last.db) hit.push('b');
      bang.textContent = last.da || last.db ? ['쨍!', '챙!', '퍽!', '스릉!'][D.round % 4] : '휙…';
      bang.style.animation = 'none'; void bang.offsetWidth; bang.style.animation = '';
      audio.play(last.da || last.db ? 'clash' : 'click');
      render(hit);
      await sleep(380);
      lock = false;
      render();
      if (D.over) end();
    }
    function end() {
      const won = D.winner === mySide;
      const draw = !D.winner;
      audio.play(won ? 'win' : draw ? 'click' : 'lose');
      bang.textContent = draw ? '무승부' : won ? '승리!' : '패배…';
      clear(m.foot).append(h('button.btn.primary', { onclick: () => { m.close(); resolve(D); } }, '확인'));
      render();
    }
    render();
  });
}
export { activeOffs };
