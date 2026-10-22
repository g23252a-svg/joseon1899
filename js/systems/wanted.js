// 수배·평판·사망 [전투] — 범죄·목격·신고·수배 단계·출동·현상금·의(義)·사망과 부활 (스펙 G.3·G.4·G.6).
//   game.sys.wanted: level bounty honor honorTier() addHonor(d, reason) report(crime) clear(reason) payBounty() isWanted() set(level, bountyAdd, reason)
//   계약 밖: pardon() surrender() arrest() bribe() bribeCost() shouldShoot() regionId(x, y) respawnPoint(x, y) lastSeen pursuers reports resisting
//   범죄는 'crime' 이벤트 + 스스로 찾은 것(플레이어가 사람을 죽이면 murder, 때리거나 기절시키면 assault, 남의 말을 해치면 animal_cruelty;
//     이것도 'crime' 으로 내보낸다). crime 선택 필드: bounty·level·honor 덮어쓰기, target:'shop'|'train', scripted, instant.
//   목격: npcs.witnesses(x, y, offender, {kind, victim}) → Human[] 또는 시야(낮 22·밤 10 m × 날씨, 110°, 가림). 목격자에 data.witness 를 달고
//     가까운 순검까지 3.8 m/s(없으면 25실초) 뒤 신고. 1.5초 겨누면 위협, E 로 입막음 20전.
//   출동: npcs.spawnGroup(kind, x, y, n, {role, faction?, target, hostile, pursuer, wanted, tags:['pursuer'], mounted?}).
//   사망: 2초 암전 → 가까운 respawn(미션은 missions.respawnPoint?.()) → 돈 10%(최대 300, 미션 중 없음) → 수배 0 → 'player:respawn'.

import { angleWrap, clamp, rand } from '../engine/util.js';

export const CRIMES = {
  fare_evasion: { bounty: 5, level: 1, honor: -1, witness: true },
  trespass: { bounty: 10, level: 1, honor: -1, witness: true },
  looting: { bounty: 20, level: 1, honor: -1, witness: true },
  theft: { bounty: 30, level: 1, honor: -2, witness: true },
  animal_cruelty: { bounty: 30, level: 1, honor: -2, witness: true },
  assault: { bounty: 50, level: 1, honor: -3, witness: true },
  arson: { bounty: 100, level: 2, honor: 0, witness: true },
  jailbreak: { bounty: 150, level: 2, honor: 0, witness: false },
  robbery: { bounty: 150, level: 2, honor: -4, witness: true },
  murder: { bounty: 300, level: 2, honor: -10, witness: true },
};
export const WANTED_LEVELS = {
  1: { name: '신고됨', arrive: 60, reinforce: null, max: 2, search: 150, lose: 30, shootOnSight: false },
  2: { name: '추격', arrive: 30, reinforce: [2, 60], max: 8, search: 250, lose: 45, shootOnSight: false },
  3: { name: '총순 순찰조·현상금', arrive: 30, reinforce: [3, 60], max: 12, search: 400, lose: 75, shootOnSight: true },
  4: { name: '시위대·진위대', arrive: 45, reinforce: [4, 60], max: 16, search: 600, lose: 120, shootOnSight: true },
};
const CRIME_NAME = { fare_evasion: '무임승차', trespass: '무단 침입', looting: '시체 뒤지기', theft: '도둑질', animal_cruelty: '짐승 학대', assault: '폭행', arson: '방화', jailbreak: '파옥', robbery: '강도', murder: '살인' };
// 출동조 [spawnGroup kind, 수, role, 덧붙임], 단계 0~4
const P = (n, role, x) => ['police', n, role, x];
const BH = (n) => ['hunters', n, 'bounty_hunter', { faction: 'bounty' }];
const ARMY = [['soldiers', 8, 'soldier']];
const MIL = { faction: 'civilian' };
const RESPONSE = {
  hanseong: [[], [P(2, 'sungeom')], [P(4, 'sungeom')], [P(1, 'chongsun'), P(6, 'sungeom'), P(2, 'sungeom', { mounted: 'jeju_horse' })], [...ARMY, BH(4)]],
  gyeonggang: [[], [['soldiers', 1, 'gwanbyeong'], P(1, 'sungeom')], [['soldiers', 2, 'gwanbyeong'], P(2, 'sungeom')], [P(1, 'chongsun'), P(4, 'sungeom')], ARMY],
  gyeongin: [[], [P(2, 'militia', MIL)], [P(4, 'militia', MIL)], [BH(6)], ARMY],
  jemulpo: [[], [P(2, 'jogye_police')], [P(4, 'jogye_police')], [P(4, 'sungeom'), P(4, 'jogye_police')], ARMY],
};
const ARRIVE_MUL = { gyeonggang: 1.5, gyeongin: 2 };
const LAW = new Set(['police', 'army']);
const ARMED_FOE = new Set(['company', 'bounty', 'pirate']);
const NOT_CIVIL = new Set(['gang', 'rival', 'police', 'army', 'bounty', 'pirate']);
const OFFICE_IDS = new Set(['gov_gyeongmu', 'office_noryangjin', 'office_bupyeong', 'gamniseo']);
const HONOR_CAP = { salve: 6, horse: 2 }; // 하루 한도
const VIS = { cloudy: 0.95, rain: 0.75, storm: 0.6, fog: 0.45, snow: 0.7 };
const HORSEY = new Set(['horse', 'pony', 'jeju_horse', 'western_horse', 'oxcart']);
const SHOUT = ['사람 살려!', '순검! 순검 나리!', '저놈 잡아라!', '아이고, 사람 잡네!'];
const armed = (h) => !!h.weapon && (typeof h.weapon === 'string' ? h.weapon !== 'fist' : h.weapon.kind !== 'fist');
const isLaw = (e) => e.kind === 'human' && !e.isPlayer && LAW.has(e.faction) && e.state === 'normal';

class Wanted {
  constructor(game) {
    Object.assign(this, { name: 'wanted', order: 30, game, CRIMES, WANTED_LEVELS, level: 0, bounty: 0, honor: 0, lastSeen: { x: 0, y: 0 }, pursuers: [], reports: [], resisting: false, lastCrimeDay: -1 });
    Object.assign(this, { _daily: { day: -1 }, _spawnT: 0, _squad: false, _loseT: 0, _seeT: 0, _seen: false, _recogT: 0, _scan: 0, _death: null, _seq: null, _offices: null, _abuse: [] });
  }

  // ------------------------------------------------------------ 조회
  isWanted() { return this.level > 0; }
  honorTier() { const h = this.honor; return h >= 60 ? 'noble' : h >= 20 ? 'decent' : h > -20 ? 'neutral' : h > -60 ? 'rough' : 'outlaw'; }
  shouldShoot() { return !!WANTED_LEVELS[this.level]?.shootOnSight || this.resisting; }
  bribeCost() { return Math.round(50 + this.bounty * 0.5); }
  _day() { return this.game.sys.time?.day ?? Math.floor(this.game.time / 2880); }
  _fmt(n) { return this.game.sys.shops?.formatMoney?.(n) ?? `${n}전`; }
  _emit() { this.game.emit('wanted:change', { level: this.level, bounty: this.bounty }); }
  _sightR() { const t = this.game.sys.time; return (t?.isNight?.() ? 10 : 22) * (VIS[t?.weather] ?? 1); }
  _lawSees(R = 30) { const p = this.game.player; return !!this.game.nearest(p.x, p.y, R, (e) => isLaw(e) && this._sees(e, p)); }
  regionId(x, y) {
    const W = this.game.world, r = W?.regionAt?.(x, y);
    const w = r?.wanted ?? (r?.id && W?.map?.regions?.find?.((q) => q.id === r.id)?.wanted);
    if (w) return w;
    if (r?.id === 'sea' || x < 720) return 'jemulpo';
    if (String(r?.id || '').startsWith('river_')) return 'gyeonggang';
    return x > 2150 && y < 1250 ? 'hanseong' : 'gyeongin';
  }
  _pay(n) {
    const inv = this.game.sys.inventory;
    if (!inv || inv.spendMoney?.(n)) return true;
    return this.game.notify('돈이 모자란다', 'warn'), false;
  }
  /** o 가 t 를 보는가: npcs.perceive 가 있으면 그것, 없으면 거리·시야각 110°·가림 */
  _sees(o, t, R = this._sightR()) {
    const v = this.game.sys.npcs?.perceive?.(o, t);
    if (v != null) return typeof v === 'number' ? v >= 0.5 : !!v;
    const dx = t.x - o.x, dy = t.y - o.y, d = Math.hypot(dx, dy);
    if (d > R || (d > 2.5 && Math.abs(angleWrap(Math.atan2(dy, dx) - o.angle)) > 0.96)) return false;
    return this.game.sys.combat?.lineOfSight?.(o.x, o.y, t.x, t.y) ?? true;
  }

  addHonor(delta, reason = '') {
    delta = Math.round(Number(delta) || 0);
    const cap = HONOR_CAP[reason];
    if (cap && delta > 0) {
      if (this._daily.day !== this._day()) this._daily = { day: this._day() };
      delta = Math.max(0, Math.min(delta, cap - (this._daily[reason] || 0)));
      this._daily[reason] = (this._daily[reason] || 0) + delta;
    }
    const prev = this.honor;
    this.honor = clamp(prev + delta, -100, 100);
    if (this.honor !== prev) this.game.emit('honor:change', { honor: this.honor, delta: this.honor - prev, reason });
    return this.honor - prev;
  }

  // ------------------------------------------------------------ 범죄·목격·신고
  report(c = {}) {
    const g = this.game, p = g.player, base = CRIMES[c?.kind];
    if (!p || !c || (!base && c.bounty == null) || (c.offender && c.offender !== p)) return false;
    const v = c.victim || null;
    const cr = { kind: c.kind, x: c.x ?? p.x, y: c.y ?? p.y, victim: v, bounty: c.bounty ?? base?.bounty ?? 0, level: c.level ?? base?.level ?? 1, honor: c.honor ?? base?.honor ?? 0, witness: c.witness ?? base?.witness ?? true };
    if (c.bounty == null) {
      if (cr.kind === 'robbery' && c.target === 'shop') cr.bounty = 250;
      if (cr.kind === 'robbery' && c.target === 'train') Object.assign(cr, { bounty: 400, level: 3, witness: false });
      if (cr.kind === 'theft' && (HORSEY.has(v?.vtype) || g.nearest(cr.x, cr.y, 2.5, (e) => e.kind === 'vehicle' && e.moveMode === 'horse'))) Object.assign(cr, { bounty: 80, honor: -3 });
    }
    // 피해자 규칙: 먼저 덤빈 자·화적·폭도 → 범죄 아님 / 무장한 회사·현상금·수적 → 살인만 / 순검·병정 → ×2, +1단계
    if (v?.kind === 'human' && !c.scripted) {
      const law = LAW.has(v.faction);
      if (v.faction === 'rival' || v.tags?.has?.('rioter') || (v.data?.aggroPlayer && !(law && this.level > 0) && !v.tags?.has?.('pursuer'))) return false;
      if (ARMED_FOE.has(v.faction) && armed(v)) {
        if (cr.kind !== 'murder') return false;
        cr.honor = -3;
      } else if (law) Object.assign(cr, { bounty: cr.bounty * 2, level: Math.min(4, cr.level + 1), honor: cr.kind === 'murder' ? -8 : cr.honor });
    }
    if (v?.tags?.has?.('rich')) cr.honor *= 0.25;
    this.addHonor(cr.honor, 'crime');
    this.lastCrimeDay = this._day();
    if (!cr.witness || c.instant) return this._commit(cr), true;
    if (this._lawSees()) {
      if (cr.kind !== 'fare_evasion' && cr.kind !== 'trespass') cr.level = Math.max(2, cr.level); // 순검·병정이 직접 봄
      return this._commit(cr), true;
    }
    const tier = this.honorTier(); // 경범죄 신고 확률 (의인 −50%, 바른 이 −25%)
    if (cr.level <= 1 && rand.next() > (tier === 'noble' ? 0.5 : tier === 'decent' ? 0.75 : 1)) return true;
    const ws = this._witnesses(cr);
    for (const w of ws.slice(0, 3)) this._addReport(cr, w);
    if (ws.length) g.notify(`누군가 ${CRIME_NAME[cr.kind] || '범죄'}을(를) 보았다 — 신고하러 간다`, 'warn');
    return true;
  }
  _witnesses(cr) {
    const g = this.game, p = g.player, npcs = g.sys.npcs;
    let list = null;
    try {
      list = npcs?.witnesses?.(cr.x, cr.y, p, { kind: cr.kind, victim: cr.victim });
    } catch {
      list = null;
    }
    if (!Array.isArray(list) || !list.length) {
      const R = this._sightR();
      list = g.query(p.x, p.y, R, (e) => e.kind === 'human' && !e.isPlayer && !NOT_CIVIL.has(e.faction) && e.state === 'normal' && this._sees(e, p, R));
    }
    if (cr.kind === 'fare_evasion') list = list.filter((h) => /conductor|driver|station|ticket|crew/.test(h.role || '') || h === cr.victim?.driver); // 차장·역무원만
    const d2 = (h) => (h.x - p.x) ** 2 + (h.y - p.y) ** 2;
    return list.filter((h) => h?.alive && h.kind === 'human' && h.state === 'normal' && !h.isPlayer).sort((a, b) => d2(a) - d2(b));
  }
  _addReport(cr, w) {
    if (this.reports.some((r) => r.w === w)) return;
    const pol = this.game.nearest(w.x, w.y, 150, (e) => isLaw(e) && e !== w);
    const t = pol ? Math.max(1.5, (Math.hypot(pol.x - w.x, pol.y - w.y) - 15) / 3.8) : 25;
    this.reports.push({ cr, w, t, aim: 0 });
    w.data.witness = { x: cr.x, y: cr.y, kind: cr.kind, police: pol?.id ?? null, until: this.game.time + t };
    w.say?.(SHOUT[Math.floor(Math.random() * SHOUT.length)], 2.5);
  }
  _silenced(w, line) {
    w.data.witness = null;
    w.say?.(line, 3);
    this.addHonor(-1, 'threat');
    this.game.sys.skills?.addXP?.('cheose', 10, 'threat');
  }
  _reportsTick(rdt) {
    const p = this.game.player;
    for (let i = this.reports.length - 1; i >= 0; i--) {
      const r = this.reports[i], w = r.w;
      let drop = r.cr.done || !w.alive || w.state !== 'normal';
      const aimed = !drop && p.aiming && armed(p) && Math.hypot(w.x - p.x, w.y - p.y) < 20 && Math.abs(angleWrap(Math.atan2(w.y - p.y, w.x - p.x) - p.aimAngle)) < 0.2;
      if (r.aim < 50) r.aim = aimed ? r.aim + rdt : 0;
      if (r.aim >= 1.5 && r.aim < 50) {
        r.aim = 99; // 위협은 한 번
        if (rand.next() < (this.game.sys.skills?.mod?.('intimidate', 0.7) ?? 0.7)) (drop = true), this._silenced(w, '아, 알겠소! 못 본 걸로 하리다!');
        else (r.t = Math.min(r.t, 2)), w.say?.('누가 겁먹을 줄 알고!', 2);
      }
      if (!drop && (r.t -= rdt) <= 0) (drop = true), (w.data.witness = null), this._commit(r.cr);
      if (drop) this.reports.splice(i, 1);
    }
  }
  _commit(cr) {
    if (cr.done) return;
    cr.done = true;
    this.bounty += Math.max(0, Math.round(cr.bounty));
    this.lastSeen = { x: cr.x, y: cr.y };
    this._setLevel(clamp(Math.max(this.level, cr.level), 1, 4));
    this.game.notify(`수배 ${this.level}단계 — ${CRIME_NAME[cr.kind] || '범죄'} · 현상금 ${this._fmt(this.bounty)}`, 'bad');
    this.game.sys.npcs?.alert?.(cr.x, cr.y, 60, 'wanted');
  }
  _derive(kind, victim) {
    const p = this.game.player;
    this.game.emit('crime', { kind, x: victim?.x ?? p.x, y: victim?.y ?? p.y, offender: p, victim });
  }
  _ownedAnimal(v) {
    return (HORSEY.has(v.vtype) || v.moveMode === 'horse') && !!v.owner && v.owner !== 'player' && v !== this.game.sys.vehicles?.playerHorse;
  }
  _onHit(e) {
    const g = this.game, p = g.player, t = e.target, s = e.source;
    if (!t || !p) return;
    if (t === p) {
      // 1~2단계에서 순검 근접에 쓰러지면 체포
      if (e.knock && s?.faction === 'police' && (this.level === 1 || this.level === 2) && (e.kind === 'melee' || e.kind === 'fist')) this.arrest();
      return;
    }
    if (s !== p) return;
    if (t.kind === 'human') {
      if (this.level > 0 && (LAW.has(t.faction) || t.tags?.has?.('pursuer'))) this.resisting = true;
      if (t.state === 'dead' || !(e.amount > 0 || e.ko) || g.time - (t.data._assaultT ?? -99) < 20) return;
      t.data._assaultT = g.time;
      this._derive('assault', t);
    } else if (t.kind === 'vehicle' && this._ownedAnimal(t) && g.time - (t.data._crueltyT ?? -99) > 30) {
      t.data._crueltyT = g.time;
      this._derive('animal_cruelty', t);
    } else if (t.kind === 'vehicle' && (t === g.sys.vehicles?.playerHorse || (t.owner === 'player' && t.moveMode === 'horse'))) {
      this._abuse = this._abuse.filter((x) => g.realTime - x < 60).concat(g.realTime); // 자기 말: 1분에 5회 넘게 때리면 의 −1
      if (this._abuse.length > 5) (this._abuse = []), this.addHonor(-1, 'horse_abuse');
    }
  }

  // ------------------------------------------------------------ 수배 단계·추격·출동
  _setLevel(lv) {
    lv = clamp(Math.round(Number(lv) || 0), 0, 4);
    const prev = this.level, p = this.game.player;
    this.level = lv;
    if (lv > prev) {
      this._squad = false;
      this._loseT = 0;
      this._spawnT = prev ? Math.min(this._spawnT, 4) : WANTED_LEVELS[lv].arrive * (lv <= 2 && p ? ARRIVE_MUL[this.regionId(p.x, p.y)] ?? 1 : 1);
    }
    if (!lv) (this.pursuers = []), (this.resisting = false);
    this._emit();
  }
  set(level, bountyAdd = 0, reason = '') {
    const p = this.game.player;
    this.bounty = Math.max(0, Math.round(this.bounty + (Number(bountyAdd) || 0)));
    if (p) this.lastSeen = { x: p.x, y: p.y };
    if (level > 0) this.lastCrimeDay = this._day();
    this._setLevel(level);
    if (level > 0 && reason) this.game.notify(`수배 ${this.level}단계 — ${CRIME_NAME[reason] || reason}`, 'bad');
  }
  clear() {
    this.reports = [];
    if (this.level > 0) this._setLevel(0);
  }
  pardon() {
    this.bounty = 0;
    this.reports = [];
    this._setLevel(0);
  }
  _dispatch(units, rid, opts = {}) {
    const g = this.game, npcs = g.sys.npcs, p = g.player;
    if (typeof npcs?.spawnGroup !== 'function') return;
    const at = this._spawnPoint(rid);
    const conc = String(g.world?.regionAt?.(p.x, p.y)?.id || '').startsWith('jm_'); // 제물포 조계 안이면 조계 순경, 밖이면 감리서 순검
    for (const [kind, n, role0, extra] of units) {
      const role = role0 === 'jogye_police' && !conc && this.level <= 2 ? 'sungeom' : role0;
      try {
        const got = npcs.spawnGroup(kind, at.x, at.y, n, { role, target: p, hostile: true, pursuer: !opts.ambush, wanted: this.level, tags: [opts.ambush ? 'bounty_ambush' : 'pursuer'], ...extra });
        if (!opts.ambush && Array.isArray(got)) for (const h of got) if (h?.tags) h.tags.add('pursuer'), this.pursuers.push(h);
      } catch (err) {
        console.warn('[wanted] spawnGroup', err?.message);
      }
    }
  }
  /** 그 지역 경무서·관아(60~450 m), 없으면 80 m 넘게 떨어진 화면 밖 길 위 */
  _spawnPoint(rid) {
    const g = this.game, p = g.player, W = g.world;
    let best = null, bd = 450;
    for (const b of W?.buildings || []) {
      if (b.kind !== 'police' && b.kind !== 'office') continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d >= 60 && d < bd && this.regionId(b.x, b.y) === rid) (bd = d), (best = b.door || b);
    }
    if (best) return best;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * 6.283, d = 95 + Math.random() * 45;
      const q = W?.nearestRoadPoint?.(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 60);
      if (q && Math.hypot(q.x - p.x, q.y - p.y) >= 80 && !g.camera?.visible?.(q.x, q.y, 3)) return q;
    }
    return { x: p.x + 100, y: p.y };
  }
  _chase(rdt) {
    const g = this.game, p = g.player, L = WANTED_LEVELS[this.level];
    this.pursuers = this.pursuers.filter((h) => h.alive && h.state !== 'dead');
    if ((this._spawnT -= rdt) <= 0) {
      const rid = this.regionId(p.x, p.y), comp = RESPONSE[rid]?.[this.level] || [];
      if (!this._squad) (this._squad = true), this._dispatch(comp, rid);
      else if (L.reinforce && comp[0] && this.pursuers.length < L.max) this._dispatch([[comp[0][0], Math.min(L.reinforce[0], L.max - this.pursuers.length), comp[0][2], comp[0][3]]], rid);
      this._spawnT = L.reinforce?.[1] ?? 60;
    }
    if ((this._seeT -= rdt) <= 0) {
      this._seeT = 0.25;
      this._seen = this.pursuers.some((h) => h.state === 'normal' && this._sees(h, p)) || this._lawSees();
      if (this._seen) this.lastSeen = { x: p.x, y: p.y };
      // 쫓는 이 앞에서 무기를 겨누면 저항 → 사격으로 바뀜
      if (!this.resisting && p.aiming && armed(p) && this.pursuers.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < 25)) this.resisting = true;
    }
    const out = Math.hypot(p.x - this.lastSeen.x, p.y - this.lastSeen.y) > L.search; // 수색 원 안에서는 느리게 잊힌다
    if (this._seen) this._loseT = 0;
    else if ((this._loseT += rdt * (out ? 1 : 0.25)) >= L.lose) this.clear(), g.notify('추격을 떨쳤다', 'good');
  }
  /** 현상금 100 이상: 순검·병정이 10 m(거친 이 이하 +2) 안에서 1.5초 보면 알아본다 */
  _recog() {
    const g = this.game, p = g.player, R = 10 + (this.honor < -19 ? 2 : 0);
    const cop = this.bounty >= 100 && g.nearest(p.x, p.y, R, (e) => isLaw(e) && this._sees(e, p, R));
    if (!cop || (this._recogT += 0.25) < 1.5) return cop || (this._recogT = 0);
    this._recogT = 0;
    this.lastSeen = { x: p.x, y: p.y };
    this._setLevel(this.bounty < 500 ? 1 : this.bounty < 1500 ? 2 : 3);
    cop.say?.('네 이놈! 현상 붙은 놈이로구나!', 3);
    g.notify('순검이 얼굴을 알아보았다', 'bad');
  }
  _newDay(day) {
    const g = this.game, p = g.player;
    if (this.bounty > 0 && this.bounty < 300 && this.lastCrimeDay < day - 1) (this.bounty = Math.floor(this.bounty * 0.9)), this._emit();
    if (this.bounty >= 1500 && p && p.state !== 'dead' && g.sys.npcs?.spawnGroup && rand.next() < 0.35) {
      this._dispatch([BH(3 + (rand.next() < 0.5 ? 1 : 0))], 'none', { ambush: true });
      g.notify('현상금 사냥꾼들이 뒤를 밟는다', 'bad');
    }
  }

  // ------------------------------------------------------------ 관아 창구: 납부·자수·뇌물·체포
  _officeList() {
    if (this._offices) return this._offices;
    const bs = this.game.world?.buildings || [];
    const list = bs.filter((b) => OFFICE_IDS.has(b.id) || String(b.shop || '').startsWith('office_'));
    return (this._offices = list.length ? list : bs.filter((b) => b.kind === 'police'));
  }
  _nearOffice(p) {
    return this._officeList().find((b) => (b.door ? Math.hypot(p.x - b.door.x, p.y - b.door.y) : Math.hypot(p.x - b.x, p.y - b.y) - Math.max(b.w || 0, b.h || 0) / 2) < 3);
  }
  _offers(actor, target) {
    if (!actor?.isPlayer || actor.vehicle || actor.state !== 'normal') return null;
    if (target) {
      const r = target.kind === 'human' && this.reports.find((q) => q.w === target && !q.cr.done && q.cr.level <= 1);
      const run = () => this._pay(20) && ((this.reports = this.reports.filter((q) => q !== r)), this._silenced(target, '험, 아무것도 못 보았소.'));
      return r ? [{ key: 'interact', label: '입막음 돈 주기 (20전)', priority: 7, run }] : null;
    }
    if (!(this.bounty > 0 || this.level > 0) || !this._nearOffice(actor)) return null;
    if (this.level === 0 && (this.game.sys.inventory?.money ?? Infinity) >= this.bounty) return [{ key: 'interact', label: `현상금 내기 (${this._fmt(this.bounty)})`, priority: 6, run: () => this.payBounty() }];
    return [{ key: 'interact', label: '자수하기', priority: 6, run: () => this.surrender() }];
  }
  payBounty() {
    if (this.level > 0) return this.game.notify('수배 중에는 현상금을 낼 수 없다', 'warn'), false;
    if (this.bounty <= 0 || !this._pay(this.bounty)) return false;
    this.game.notify(`현상금 ${this._fmt(this.bounty)}을 냈다`, 'good');
    this.bounty = 0;
    this._emit();
    return true;
  }
  /** 1단계에서만: 50 + 현상금 × 0.5. 추격 끝, 현상금 0, 의 −1 */
  bribe() {
    if (this.level !== 1 || !this._pay(this.bribeCost())) return false;
    this.bounty = 0;
    this.reports = [];
    this.addHonor(-1, 'bribe');
    this.game.sys.skills?.addXP?.('cheose', 10, 'bribe');
    this._setLevel(0);
    this.game.notify('순검의 소매에 엽전을 찔러 넣었다');
    return true;
  }
  surrender() {
    return this._blackout(() => this._punish(false));
  }
  arrest() {
    return this._blackout(() => {
      const p = this.game.player, d = (b) => Math.hypot(b.x - p.x, b.y - p.y);
      const b = this._officeList().reduce((a, q) => (!a || d(q) < d(a) ? q : a), null);
      if (b) this._place((b.door || b).x, (b.door || b).y);
      this._punish(true);
    });
  }
  /** 300 미만 태형(4시) / 1,499 까지 태형+하루+20% / 그 위 징역 사흘+50%. 체포는 남은 돈의 20% 더 */
  _punish(arrest) {
    const g = this.game, p = g.player, b = this.bounty, inv = g.sys.inventory;
    const [hours, rate0, text] = b >= 1500 ? [72, 0.5, '징역 사흘을 살았다'] : b >= 300 ? [24, 0.2, '태형을 맞고 하루 갇혔다'] : [4, 0, '태형 스무 대를 맞았다'];
    if (b < 1500 && p) p.hp = Math.max(1, p.hp - 30);
    const lost = inv?.money > 0 ? Math.floor(inv.money * (arrest ? 1 - (1 - rate0) * 0.8 : rate0)) : 0;
    if (lost > 0) inv.spendMoney?.(lost);
    g.sys.time?.skip?.(hours);
    this.pardon();
    const sub = text + (lost ? ` · 돈 ${this._fmt(lost)} 압수` : '');
    if (g.sys.ui?.banner) g.sys.ui.banner(arrest ? '체포되었다' : '자수했다', sub, 3.5);
    else g.notify(sub, 'warn');
  }
  _place(x, y) {
    const g = this.game, p = g.player;
    if (p.vehicle) p.vehicle.exit(p, g, { force: true, silent: true });
    const q = g.world?.randomPassableNear?.(x, y, 4, 'foot') || { x, y };
    Object.assign(p, { x: q.x, y: q.y, vx: 0, vy: 0, moveX: 0, moveY: 0 });
    g.camera?.snap?.(p.x, p.y);
  }
  /** 암전 → fn → 밝아짐 (실초 타이머로, Promise 를 기다리지 않는다) */
  _blackout(fn, sec = 1.2) {
    const p = this.game.player;
    if (this._seq || this._death || !p || p.state === 'dead') return false;
    this._seq = { t: sec, fn, lock: !!p.controlLocked };
    p.controlLocked = true;
    this.game.sys.ui?.fade?.(true, sec * 800);
    return true;
  }

  // ------------------------------------------------------------ 사망·부활 (G.6)
  respawnPoint(x, y) {
    const g = this.game, ms = g.sys.missions;
    const o = ms?.active ? ms.respawnPoint?.() : null;
    if (Number.isFinite(o?.x) && Number.isFinite(o?.y)) return o;
    let best = null, bd = Infinity;
    for (const pl of Object.values(g.world?.places || {})) {
      if (pl.kind !== 'respawn' || (pl.id === 'respawn_camp' && !g.flags.prologue_done)) continue;
      const d = Math.hypot(pl.x - x, pl.y - y);
      if (d < bd) (bd = d), (best = pl);
    }
    return best || { x: g.world?.spawn?.x ?? x, y: g.world?.spawn?.y ?? y };
  }
  _respawn(d) {
    const g = this.game, p = g.player, at = this.respawnPoint(d.x, d.y);
    if (p.vehicle) p.vehicle.exit(p, g, { force: true, silent: true });
    p.revive(p.maxHp);
    p.crouching = p.aiming = false;
    this._place(at.x, at.y);
    if (g.sys.stats?.refill) g.sys.stats.refill();
    else p.stamina = p.maxStamina;
    const inv = g.sys.inventory, lost = g.sys.missions?.active ? 0 : Math.min(300, Math.floor((inv?.money || 0) * 0.1));
    if (lost > 0 && inv.spendMoney?.(lost)) g.notify(`정신을 잃은 사이 돈 ${this._fmt(lost)}을 잃었다`, 'bad');
    this.clear(); // 추격만 끝, 현상금은 남는다
    g.emit('player:respawn', { x: p.x, y: p.y });
    g.sys.ui?.fade?.(false, 900);
    if (at.name) g.notify(`${at.name}에서 깨어났다`);
  }

  // ------------------------------------------------------------ 시스템
  init(g) {
    g.on('crime', (c) => this.report(c));
    g.on('player:dead', () => {
      if (g.player && !this._death) this._death = { t: 0, x: g.player.x, y: g.player.y, faded: false };
      this.reports = [];
    });
    g.on('time:day', (e) => this._newDay(Number.isFinite(e?.day) ? e.day : this._day()));
    g.on('damage', (e) => {
      const s = e.source;
      if (e.target && e.target === g.player && s?.kind === 'human' && !s.isPlayer && s.data) s.data.aggroPlayer = true; // 먼저 덤빈 자
    });
    g.on('hit', (e) => this._onHit(e));
    g.on('kill', (e) => {
      const v = e.victim;
      if (!g.player || e.killer !== g.player || v?.kind !== 'human') return;
      if (v.data?.surrendered || v.tags?.has?.('surrendered')) this.addHonor(-3, 'surrendered'); // 항복한 적을 처치
      this._derive('murder', v);
    });
    g.on('vehicle:wrecked', (e) => e.vehicle && e.info?.source === g.player && this._ownedAnimal(e.vehicle) && this._derive('animal_cruelty', e.vehicle));
    g.on('save:load', () => g.player && (this.lastSeen = { x: g.player.x, y: g.player.y }));
    g.addInteractionProvider((actor, target) => this._offers(actor, target));
  }
  update(dt, realDt, g) {
    if (g.state !== 'play') return;
    const s = this._seq, d = this._death, p = g.player;
    if (s && (s.t -= realDt) <= 0) {
      this._seq = null;
      if (p) p.controlLocked = s.lock;
      try {
        s.fn();
      } finally {
        g.sys.ui?.fade?.(false, 800);
      }
    }
    if (d && (d.t += realDt) > 0.3 && !d.faded) (d.faded = true), g.sys.ui?.fade?.(true, 1500);
    if (d && d.t >= 2.2 && p) (this._death = null), this._respawn(d);
    if (!p || p.state === 'dead') return;
    this._reportsTick(realDt);
    if (this.level > 0) this._chase(realDt);
    else if ((this._scan -= realDt) <= 0) (this._scan = 0.25), this._recog();
  }
  serialize() {
    return { level: this.level, bounty: this.bounty, honor: this.honor, lastCrimeDay: this.lastCrimeDay, daily: { ...this._daily } };
  }
  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    this.bounty = Math.max(0, Math.round(Number(d.bounty) || 0));
    this.honor = clamp(Math.round(Number(d.honor) || 0), -100, 100);
    this.lastCrimeDay = Number.isFinite(d.lastCrimeDay) ? d.lastCrimeDay : -1;
    this._daily = d.daily && typeof d.daily === 'object' ? { ...d.daily } : { day: -1 };
    Object.assign(this, { reports: [], pursuers: [], _death: null, _seq: null, resisting: false, level: 0 });
    this._setLevel(d.level);
  }
}

export function install(game) {
  return game.registerSystem(new Wanted(game));
}
