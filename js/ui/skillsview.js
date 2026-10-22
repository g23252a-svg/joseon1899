// 기술 화면: game.sys.skills.TREES 를 계통별 열로. 노드(배움/익힐 수 있음/잠김), 경험치 막대, 점수, [배우기].
// TREES 형식이 아직 확정되지 않아 배열/객체, skills|nodes|perks 모두 받아들인다.

import { clamp01, emptyNote, h, keepFocus, safe } from './dom.js';

function nodeList(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? [...raw] : Object.keys(raw).map((k) => ({ id: k, ...raw[k] }));
  return arr.filter((n) => n && n.id != null);
}

export function treesOf(sk) {
  const T = sk?.TREES;
  if (!T) return [];
  const arr = Array.isArray(T) ? T : Object.keys(T).map((k) => ({ id: k, ...T[k] }));
  return arr
    .filter((t) => t && t.id != null)
    .map((t) => {
      const nodes = nodeList(t.skills ?? t.nodes ?? t.perks ?? t.list);
      const rank = (n) => Number(n.tier ?? n.level ?? n.req?.level ?? n.requiresLevel ?? 0) || 0;
      const idx = new Map(nodes.map((n, i) => [n, i]));
      nodes.sort((a, b) => rank(a) - rank(b) || idx.get(a) - idx.get(b));
      return { id: t.id, name: t.name ?? t.title ?? String(t.id), hanja: t.hanja ?? '', desc: t.desc ?? '', nodes };
    });
}

function progressOf(sk, treeId) {
  for (const fn of ['progress', 'levelProgress']) {
    const p = safe(() => sk[fn]?.(treeId), null);
    if (typeof p === 'number' && isFinite(p)) return clamp01(p);
  }
  const lv = Number(safe(() => sk.level?.(treeId), 0)) || 0;
  const xp = Number(safe(() => sk.xp?.(treeId), 0)) || 0;
  if (typeof sk.xpForLevel === 'function') {
    const a = Number(safe(() => sk.xpForLevel(lv), 0)) || 0;
    const b = Number(safe(() => sk.xpForLevel(lv + 1), 0)) || 0;
    if (b > a) return clamp01((xp - a) / (b - a));
  }
  const L = sk.XP_LEVELS ?? sk.LEVELS;
  if (Array.isArray(L) && typeof L[lv + 1] === 'number') {
    const a = Number(L[lv]) || 0, b = L[lv + 1];
    if (b > a) return clamp01((xp - a) / (b - a));
  }
  return clamp01((xp % 100) / 100);
}

function reqText(n, tree, trees) {
  const out = [];
  const lv = n.level ?? n.req?.level ?? n.requiresLevel;
  if (lv) out.push(`${tree.name} ${lv}단`);
  let r = n.requires ?? n.req?.skills ?? n.prereq;
  if (typeof r === 'string') r = [r];
  if (Array.isArray(r)) {
    for (const raw of r) {
      // 선행 기술이 {id} 객체로 와도 이름을 찾는다 ('[object Object]' 방지)
      const id = raw && typeof raw === 'object' ? raw.id : raw;
      if (id == null) continue;
      let name = String(id);
      for (const t of trees) {
        const f = t.nodes.find((x) => x.id === id);
        if (f) name = f.name ?? f.title ?? id;
      }
      out.push(name);
    }
  }
  return out.join(', ');
}

export function createSkillsView(c) {
  const { game } = c;
  const el = h('div');
  let sel = null;

  function status(sk, id) {
    if (safe(() => sk.has?.(id), false)) return 'learned';
    if (safe(() => sk.canLearn?.(id), false)) return 'open';
    return 'locked';
  }

  // 노드를 누르면 화면을 다시 그리므로 포커스를 같은 노드(배운 뒤에는 고른 노드)로 돌려준다
  const refresh = () => keepFocus(el, render, '.jx-node[aria-pressed="true"]');

  function render() {
    el.textContent = '';
    const sk = game.sys.skills;
    const trees = treesOf(sk);
    if (!sk || !trees.length) {
      el.append(emptyNote('藝', '아직 익힐 기술이 없습니다', '기술 체계가 준비되면 사냥·싸움·말타기 같은 계통이 여기에 나옵니다.'));
      return;
    }
    const pts = Number(sk.points) || 0;
    el.append(
      h(
        'div',
        { class: 'jx-skills-top' },
        h('div', { class: 'jx-points' }, '익힐 수 있는 점수 ', h('b', { text: String(pts) })),
        h('div', { class: 'jx-muted', text: '일을 하면 그 계통의 솜씨가 늘고, 단이 오르면 점수를 얻습니다.' })
      )
    );
    const grid = h('div', { class: 'jx-trees' });
    let selNode = null, selTree = null;
    for (const t of trees) {
      const lv = Number(safe(() => sk.level?.(t.id), 0)) || 0;
      const pr = progressOf(sk, t.id);
      const fill = h('i', { style: { transform: `scaleX(${pr.toFixed(3)})` } });
      const col = h(
        'section',
        { class: 'jx-tree', 'aria-label': `${t.name} ${lv}단` },
        h('div', { class: 'jx-tree-h' }, h('span', { text: t.name + (t.hanja ? ` ${t.hanja}` : '') }), h('small', { text: `${lv}단` })),
        h('div', { class: 'jx-xp', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pr * 100)), 'aria-label': `${t.name} 솜씨` }, fill)
      );
      for (const n of t.nodes) {
        const st = status(sk, n.id);
        if (!sel && st === 'open') sel = n.id;
        if (n.id === sel) {
          selNode = n;
          selTree = t;
        }
        col.append(
          h(
            'button',
            {
              class: 'jx-node',
              type: 'button',
              'data-fk': `n:${n.id}`,
              'data-st': st,
              'aria-pressed': n.id === sel ? 'true' : 'false',
              'aria-label': `${n.name ?? n.id}, ${st === 'learned' ? '익힘' : st === 'open' ? '익힐 수 있음' : '잠김'}`,
              onclick: () => {
                sel = n.id;
                refresh();
              },
            },
            h('span', { class: 'jx-dot', 'aria-hidden': 'true' }),
            h('span', { text: n.name ?? n.title ?? n.id })
          )
        );
      }
      grid.append(col);
    }
    el.append(grid);

    // 고른 기술 설명
    if (!selNode) {
      selTree = trees[0];
      selNode = selTree.nodes[0];
      sel = selNode?.id ?? null;
    }
    if (selNode) {
      const st = status(sk, selNode.id);
      const req = reqText(selNode, selTree, trees);
      const cost = selNode.cost ?? 1;
      const btn = h('button', {
        class: 'jx-btn jx-primary',
        type: 'button',
        text: st === 'learned' ? '이미 익힘' : '배우기',
        'data-fk': 'learn',
        disabled: st !== 'open',
        onclick: () => {
          const ok = safe(() => sk.learn?.(selNode.id), false);
          if (!ok) c.toast('아직 익힐 수 없습니다', 'warn');
          refresh();
        },
      });
      el.append(
        h(
          'div',
          { class: 'jx-skill-detail', 'aria-live': 'polite' },
          h(
            'div',
            null,
            h('h3', { text: selNode.name ?? selNode.id }),
            h('p', { class: 'jx-muted', text: `${selTree.name} · 점수 ${cost}${req ? ` · 필요: ${req}` : ''}` }),
            selNode.desc || selNode.description ? h('p', { class: 'jx-desc', text: selNode.desc ?? selNode.description }) : null
          ),
          btn
        )
      );
    }
  }

  return { el, mount: refresh, refresh };
}

