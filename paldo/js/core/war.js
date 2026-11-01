// 전투 진행을 묶는다: 플레이어가 끼면 UI(hooks.battle)에 맡기고, 아니면 자동 전투
import { autoBattle, applyBattle, resolveCaptive, aiCaptiveDecision } from './battle.js';
import { log } from './state.js';

export async function fightBattle(S, B, hooks) {
  const playerIn = B.atk.fid === S.player || B.def.fid === S.player;
  if (playerIn && hooks?.battle) await hooks.battle(B);
  if (!B.over) autoBattle(S, B);
  const res = applyBattle(S, B);
  if (playerIn && hooks?.battleResult) await hooks.battleResult(B, res);
  await handleCaptives(S, res.captives, hooks);
  return res;
}

export async function handleCaptives(S, ids, hooks) {
  for (const id of ids) {
    const o = S.officers[id];
    if (!o || o.status !== 'captive') continue;
    const captor = o.captor;
    if (!captor || !S.factions[captor]) { o.status = 'free'; o.faction = null; continue; }
    if (captor === S.player && hooks?.captive) {
      await hooks.captive(o);
      if (o.status === 'captive') resolveCaptive(S, captor, id, 'release');
      continue;
    }
    let d = aiCaptiveDecision(S, captor, o);
    if (d === 'hire') {
      const r = resolveCaptive(S, captor, id, 'hire');
      if (r.ok) {
        if (o.faction === captor && hooks?.notify && captor !== S.player) {
          // 플레이어 장수가 넘어갔으면 알림
        }
        continue;
      }
      d = Math.random() < (S.factions[captor].personality?.aggr || 0.5) * 0.2 ? 'execute' : 'release';
    }
    const was = o.faction;
    const r = resolveCaptive(S, captor, id, d);
    if (was === S.player && hooks?.notify) hooks.notify(`${o.name}: ${r.text}`, d === 'execute' ? 'bad' : 'info');
  }
}
export { log };
