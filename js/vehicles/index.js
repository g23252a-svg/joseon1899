// 탈것 시스템 game.sys.vehicles: 생성·초기 배치, 노선 운행(전차·경인선·증기선·나루), 내 말·마방, 빨리감기·빠른 이동, 정리·저장
// (스펙 C 전부, ARCHITECTURE §5·§10). 공개 API:
//   spawn(vtype, x, y, angle, opts) · playerHorse · callHorse() · setPlayerHorse(v) · lines · nextDeparture(lineId, stopId) · rideTo(lineId, stopId)
//   forceArrival(line, stopId, withinSec) · requestStop(line, stopId) · slowZones · sightLimit · fastForward(mult)
//   (계약 밖 추가) nearestStable(x, y, r) · horses · waiveFares · markSkip() · riderOffers(player) · canFastTravel() · waitNext(lineId, stopId)
import { Horse, josa } from './horse.js';
import { Boat, FerryService, SteamerService } from './boat.js';
import { Consist, RailCar, SLOW_ZONES, TrainService, TramService, trainFare } from './rail.js';
import { Carried } from './carried.js';
import { absHour, ask, crime, flagOn, hourNow, makeCrew, pay, pushOutRect, tickLocks, updateDodgers, wantedLevel } from './common.js';
import { approach, clamp, closestOnPolyline, rand } from '../engine/util.js';

const HORSES = { horse: 'jeju_horse', jeju_horse: 'jeju_horse', pony: 'pony', western_horse: 'jeju_horse' }; // 서양마는 F → 제주마
const CARRIED = { gama: 'gama', bokyo: 'gama', rickshaw: 'rickshaw', oxcart: 'oxcart', bicycle: 'rickshaw' }; // 자전거는 F → 인력거
const CAR = { freight: 'wagon', wagon: 'wagon', coach: 'coach3', coach1: 'coach1', coach3: 'coach3' };
const AVG = { tram: 2.2, train: 10.6, steamer: 4.6 }; // 빠른 이동 평균 속도 (m/s)
const toH = (sec, g) => (sec * 24) / ((g.sys.time?.minutesPerDay || 48) * 60); // 실초 → 게임시

class Vehicles {
  constructor(game) {
    Object.assign(this, { name: 'vehicles', order: 15, game, playerHorse: null, horses: [], rental: null, ff: 1, spaceT: 0, skipFx: 0, lastHurt: -99 });
    Object.assign(this, { tram: null, train: null, steamer: null, ferries: [], scripted: [], stables: [], slowZones: SLOW_ZONES, placed: false, tick: 0 });
  }
  get sightLimit() {
    return this.train?.sightLimit ?? 60;
  }
  set sightLimit(v) {
    if (this.train) this.train.sightLimit = v;
  }
  /** 미션이 삯을 대신 내 줄 때 (npc_pays_fare) */
  get waiveFares() {
    return !!this.game.flags.npc_pays_fare;
  }
  get lines() {
    const L = this.game.world?.lines || {}, out = {};
    const cars = { tram: () => this.tram?.trams.map((c) => c.lead) || [], train: () => this.train?.c?.cars || [], steamer: () => this.steamer?.boats || [] };
    for (const id in L) out[id] = { ...L[id], vehicles: cars[id]?.() || [] };
    return out;
  }

  // ------------------------------------------------------------ 시스템 훅
  init(game) {
    const w = game.world, L = w?.lines || {};
    if (L.tram) this.tram = new TramService(game, L.tram);
    if (L.train) this.train = new TrainService(game, L.train);
    if (L.steamer) this.steamer = new SteamerService(game, L.steamer);
    this.ferries = (w?.ferries || []).map((f) => new FerryService(f));
    this.stables = (w?.buildings || []).filter((b) => b.kind === 'stable').map((b) => ({ id: b.id, name: b.name || '마방', x: b.door?.x ?? b.x, y: b.door?.y ?? b.y }));
    game.addInteractionProvider((a, t, g) => (t || !a.isPlayer ? null : this.offers(a, g)));
    game.addScreenRenderer((ctx, g, dt) => this.drawFx(ctx, g, dt), 40);
    game.on('shot', (e) => this.onShot(e));
    game.on('damage', (e) => e?.target === game.player && (this.lastHurt = game.time) && this.fastForward(1));
  }
  onStart(game) {
    if (!this.placed) this.placeAll(game);
  }
  update(dt, realDt, game) {
    if (!game.player) return;
    if (!this.placed) this.placeAll(game);
    tickLocks(game, dt);
    updateDodgers(game, dt);
    this.runServices(dt, game);
    if (this.ff > 1) this.fastStep(dt, game);
    this.playerInput(dt, game);
    const a = absHour(game), j = a - (this.lastAbs ?? a);
    if ((j > 0.05 || j < -0.01) && !this.skipping) this.resync(game); // 시간 건너뛰기·불러오기
    this.lastAbs = a;
    this.skipping = false;
    if ((this.tick -= dt) <= 0) (this.tick = 1), this.periodic(game);
  }
  lateUpdate(dt, realDt, game) {
    const p = game.player;
    if (p) for (const v of game.query(p.x, p.y, 60, (e) => e.kind === 'vehicle' && e.length > 4 && !e.hidden && e.solid)) pushOutRect(game, v); // 긴 몸통
  }
  runServices(dt, game) {
    for (const s of [this.tram, this.train, this.steamer, ...this.ferries]) s?.update(dt, game);
    this.runScripted(dt, game);
  }
  resync(game) {
    if (this.train?.c && !this.train.c.playerCar) this.train.resync(game);
    if (this.steamer?.boats.length && !this.steamer.boats.some((b) => b.hasPlayer)) this.steamer.resync(game);
  }
  /** 빨리감기: 시계와 노선 차량만 mult 배로 (사건이 생기면 풀린다) */
  fastStep(dt, game) {
    const v = game.player.vehicle;
    if (!v || !(v.vtype === 'steamer' || v.consist)) return this.fastForward(1);
    const extra = dt * (this.ff - 1);
    game.sys.time?.skip?.(toH(extra, game));
    for (let t = extra; t > 1e-6; t -= 0.25) this.runServices(Math.min(0.25, t), game);
    this.lastAbs = absHour(game);
  }
  playerInput(dt, game) {
    const inp = game.input, p = game.player;
    if (p.state !== 'normal' || p.controlLocked) return;
    if (inp.pressed('whistle')) inp.consume('whistle'), p.vehicle || this.callHorse();
    const v = p.vehicle, pas = v && v.driver !== p && (v.vtype === 'steamer' || v.vtype === 'train');
    if (!pas || !inp.down('brake')) return void (this.spaceT = 0);
    if ((this.spaceT += dt) < 1 || this.spaceT - dt >= 1) return;
    if (v.vtype === 'train') this.canFastTravel() && this.train?.skip(game); // 다음 정차지로
    else this.fastForward(this.ff > 1 ? 1 : 8);
  }
  periodic(game) {
    const p = game.player, pp = this._pp, H = this.playerHorse;
    this._pp = { x: p.x, y: p.y };
    if (H && !H.alive) this.playerHorse = this.horses.find((h) => h.alive) || null;
    // 600 m 넘게 떨어진 채 순간이동·빠른 이동하면 말은 가까운 마방에 맡겨진다 (C.4)
    if (pp && H?.alive && !H.stabled && !H.hasPlayer && Math.hypot(p.x - pp.x, p.y - pp.y) > 100 && Math.hypot(H.x - p.x, H.y - p.y) > 600) {
      const st = this.nearestStable(p.x, p.y);
      if (st) H.stableAt(st, game), game.notify(`${H.displayName}${josa(H.displayName, '은', '는')} ${st.name}에 맡겨 두었소`);
    }
    this.stolenCheck(game);
    this.tramState(game);
    this.cleanup(game);
  }

  // ------------------------------------------------------------ 생성
  spawn(vtype, x, y, angle = 0, opts = {}) {
    const game = this.game, o = { ...opts, x, y, angle };
    delete o.line;
    let v = null;
    if (HORSES[vtype]) v = new Horse(HORSES[vtype], o);
    else if (vtype === 'steamer' && opts.line) return this.steamer?.boats.find((b) => b.alive && Math.hypot(b.x - x, b.y - y) < 200) || game.add(new Boat('steamer', o));
    else if (vtype === 'rowboat' || vtype === 'sailboat' || vtype === 'steamer') v = new Boat(vtype, o);
    else if (CARRIED[vtype]) v = new Carried(CARRIED[vtype], o);
    else if (vtype === 'tram') v = new RailCar('tram', o);
    else if (vtype === 'train') return this.scriptTrain(x, y, opts);
    else return null;
    v.angle = angle;
    if (opts.crowd) v.crowd = opts.crowd === true ? 0.6 : +opts.crowd || 0;
    if (opts.mission) v.mission = opts.mission;
    if (opts.parked || vtype === 'tram') v.noBoard = true;
    if (opts.burnt) v.burn?.();
    for (const it of opts.cargo || []) v.stow?.(typeof it === 'string' ? { name: it } : it, it?.kind === 'large' ? 'large' : 'item');
    this.makeRoom(v);
    return game.add(v);
  }
  /** 미션이 같은 자리에 탈것을 띄우면 배경 탈것·나루 배는 자리를 비킨다 */
  makeRoom(v) {
    const g = this.game;
    for (const e of g.query(v.x, v.y, 12, (e) => e.ambient && e.vtype === v.vtype && !e.hasPlayer)) this.discard(e);
    if (v.vtype !== 'rowboat') return;
    for (const f of this.ferries) {
      const b = f.boat;
      if (!b || b.hasPlayer || f.state !== 'wait' || Math.hypot(b.x - v.x, b.y - v.y) > 12) continue;
      f.side = f.side === 'a' ? 'b' : 'a';
      const d = f.dock(f.side);
      Object.assign(b, { x: d.x, y: d.y, angle: d.angle, speed: 0 }), b.placeOccupants();
    }
  }
  discard(v) {
    for (const s of v.seats) {
      const o = s.occupant;
      if (o?.tags?.has('crew')) o.alive = false;
      else if (o) v.exit(o, this.game, { force: true, silent: true });
    }
    v.alive = false;
  }
  /** 미션 열차 (시운전 등): 기관차 + cars. 선로 끝이나 장애물 앞에서 선다. 기관차가 지워지면 편성째 지운다 */
  scriptTrain(x, y, o) {
    const game = this.game, L = game.world?.lines?.[o.line || 'train'];
    if (!L) return null;
    const c = new Consist(game, L, ['loco', ...(o.cars || ['coach1', 'coach3']).map((k) => CAR[k] || 'wagon')], { d: o.d ?? closestOnPolyline(L.points, x, y, L.cum).d, dir: o.dir ?? 1 });
    Object.assign(c, { max: o.maxSpeed ?? 8, noBoard: !!o.trial, speed: o.speed ?? 0 });
    makeCrew(game, c.lead, 0, { name: '기관사', role: 'foreigner', faction: 'company', lookOver: { coat: '#34405a', hat: 'cap' }, brain: 'idle' });
    for (const car of c.cars) (car.persistent = false), (car.mission = o.mission || 'script');
    this.scripted.push(c);
    return c.lead;
  }
  runScripted(dt, game) {
    this.scripted = this.scripted.filter((c) => {
      if (!c.lead?.alive) return c.remove(), false;
      const dist = ((c.dir > 0 ? c.line.length - 8 : 8) - c.d) * c.dir;
      if ((c.scanT = (c.scanT || 0) - dt) <= 0) (c.scanT = 0.25), (c.obst = c.scan(game, c.lead.length / 2, 120));
      let v = Math.min(c.max, Math.sqrt(2 * 1.2 * Math.max(0, dist)));
      if (c.obst != null) v = Math.min(v, Math.sqrt(2 * 1.6 * Math.max(0, c.obst - 12)));
      c.speed = approach(c.speed, v, (v < c.speed ? 1.6 : 1) * dt);
      c.d += c.dir * c.speed * dt;
      c.place();
      return true;
    });
  }

  /** 초기 배치: 마방 말, 가마꾼 대기소 보교, 인력거, 장터 소달구지. 나루·노선 차량은 각 운행이 띄운다 */
  placeAll(game) {
    this.placed = true;
    const w = game.world, P = w?.places || {};
    if (!w?.randomPassableNear) return;
    const at = (id, x, y) => (P[id] ? { x: P[id].x, y: P[id].y } : x != null ? { x, y } : null);
    const put = (vt, q, mode, o = {}) => {
      const s = q && w.randomPassableNear(q.x, q.y, o.r ?? 6, mode);
      if (!s) return null;
      const v = this.spawn(vt, s.x, s.y, rand.range(-Math.PI, Math.PI), { owner: o.owner ?? 'public' });
      v.persistent = v.ambient = true;
      for (const [i, nm] of o.crew || []) {
        const h = makeCrew(game, v, i, { name: nm, role: 'porter', brain: 'idle' });
        if (vt === 'gama') h.maxHp = h.hp = 60;
      }
      return v;
    };
    for (const st of this.stables) put('pony', st, 'horse', { owner: st.id, r: 9 }); // 매어 둔 말 (타면 theft)
    const bearers = [[0, '가마꾼'], [1, '가마꾼']];
    put('gama', at('gama_stand_sosa', 1300, 1723), 'foot', { crew: bearers });
    put('gama', at('gama_stand_jongno', 2840, 815), 'foot', { crew: bearers });
    for (const q of [at('jongno_board', 2860, 798), at('sungnyemun_in'), at('customs_wharf')]) put('rickshaw', q, 'wheel', { crew: [[0, '인력거꾼']], r: 10 });
    for (const id of ['market_sosa', 'market_mapo']) put('oxcart', at(id), 'wheel', { owner: 'cart_owner', r: 16 });
  }

  // ------------------------------------------------------------ 내 말·마방 (C.4)
  callHorse() {
    const g = this.game, p = g.player, h = this.playerHorse;
    g.sfx('whistle', { x: p.x, y: p.y });
    if (!h?.alive) return g.notify('부를 말이 없습니다', 'warn'), false;
    return h.whistleTo(p, g);
  }
  setPlayerHorse(v) {
    if (!v) return;
    Object.assign(v, { owner: 'player', persistent: true, ambient: false });
    if (!this.horses.includes(v)) this.horses.push(v);
    this.playerHorse = v;
  }
  nearestStable(x, y, r = Infinity) {
    let best = null, bd = r;
    for (const s of this.stables) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) (bd = d), (best = s);
    }
    return best;
  }
  stableMenu(st, game) {
    const H = this.playerHorse, R = this.rental, near = (h) => h?.alive && !h.stabled && !h.down && !h.hasPlayer && Math.hypot(h.x - st.x, h.y - st.y) < 20;
    const opts = [], acts = [], add = (t, f) => (opts.push(t), acts.push(f));
    const buy = (n, f) => () => (pay(game, n, 'stable') ? f() : game.notify('돈이 모자랍니다', 'warn'));
    for (const h of this.horses) if (h.alive && h.stabled === st.id) add(`${h.displayName} 데려가기`, () => this.takeOut(h, st));
    if (near(H) && this.horses.filter((h) => h.stabled === st.id).length < 2) add(`${H.displayName} 맡기기 (무료)`, () => H.stableAt(st, game));
    if (near(H) && H.hp < H.maxHp) add('말 치료 (20전)', buy(20, () => ((H.hp = H.maxHp), H.addBond(5, game))));
    if (R && near(R.horse)) add('세마 돌려주기', () => this.returnRental());
    else if (!R) add('세마 빌리기 (하루 30전 + 보증금 300전)', buy(330, () => this.rent(st)));
    add('과하마 사기 (2,500전)', buy(2500, () => this.buyHorse('pony', st)));
    add('제주마 사기 (4,000전)', buy(4000, () => this.buyHorse('jeju_horse', st)));
    add('그만두기', () => {});
    ask(game, `${st.name}: 무엇을 하시려오? (말죽 2전은 '들어가기'에서)`, opts).then((i) => acts[i]?.());
  }
  spotNear(st) {
    return this.game.world?.randomPassableNear?.(st.x, st.y, 7, 'horse') || { x: st.x, y: st.y };
  }
  takeOut(h, st) {
    const q = this.spotNear(st);
    h.unstable(q.x, q.y, 0);
    h.hp = Math.max(h.hp, h.maxHp * 0.3);
    this.playerHorse = h;
  }
  buyHorse(vt, st) {
    const q = this.spotNear(st), h = this.spawn(vt, q.x, q.y, 0, { owner: 'player' });
    this.setPlayerHorse(h);
    this.game.notify(`${h.displayName}${josa(h.displayName, '을', '를')}샀다`, 'good');
  }
  rent(st) {
    const q = this.spotNear(st), h = this.spawn('pony', q.x, q.y, 0, { owner: 'rental', name: '세마' });
    h.persistent = true;
    this.rental = { horse: h, until: absHour(this.game) + 24 };
    this.game.notify('세마를 빌렸다. 하루 안에 아무 마방에나 돌려주면 보증금을 돌려준다');
  }
  returnRental() {
    const g = this.game, R = this.rental;
    this.rental = null;
    this.discard(R.horse);
    if (absHour(g) <= R.until) g.sys.inventory?.addMoney?.(300, 'deposit'), g.notify('보증금 300전을 돌려받았다', 'good');
    else g.notify('기한이 지나 보증금은 돌려받지 못했다', 'warn');
  }

  // ------------------------------------------------------------ 상호작용 (장소)
  offers(a, game) {
    const out = [], add = (it) => it && out.push(it);
    add(this.tram?.offer(a, game));
    add(this.steamer?.offer(a, game));
    if (a.vehicle || game.sys.loot?.carried) return out;
    const st = this.nearestStable(a.x, a.y, 5);
    if (st) add({ key: 'enter', label: `${st.name} 일 보기`, priority: 2, d: 1, run: () => this.stableMenu(st, game) });
    add(this.waitOffer(a, game));
    return out;
  }
  /** 말 탄 채 나루에서: 말을 배에 싣고 건너기 (horse.js getRiderInteractions 가 부른다) */
  riderOffers(p) {
    return this.ferries.map((f) => f.horseOffer(p, this.game)).filter(Boolean);
  }
  /** 역·증기선 나루에서 E "다음 편까지 기다리기" (C.10) */
  waitOffer(a, game) {
    for (const [id, svc] of [['train', this.train?.mode !== 'none' && this.train], ['steamer', this.steamer]]) {
      const L = svc && game.world.lines[id];
      const s = L?.stops.find((s) => Math.hypot((s.sx ?? s.x) - a.x, (s.sy ?? s.y) - a.y) < 25);
      if (!s) continue;
      const busy = id === 'train' ? svc.c?.at === s.id && svc.c.state !== 'idle' : svc.boats.some((b) => b.sv.at === s.id && b.sv.state !== 'run');
      if (!busy) return { key: 'interact', label: `다음 ${id === 'train' ? '열차' : '증기선'}까지 기다리기`, priority: 1, d: 3, run: () => this.waitNext(id, s.id) };
    }
    return null;
  }
  waitNext(lineId, stopId) {
    const g = this.game, dep = this.nextDeparture(lineId, stopId);
    if (dep == null || !this.canFastTravel()) return false;
    const hrs = (((dep - 1 / 6 - hourNow(g)) % 24) + 24) % 24;
    if (hrs < 0.05) return g.notify('곧 떠납니다'), false;
    const go = () => (g.sys.time?.skip?.(hrs), g.sys.ui?.fade?.(false, 400));
    const f = g.sys.ui?.fade?.(true, 400);
    f?.then ? f.then(go) : go();
    return true;
  }
  /** C.10 제한: 수배 1 이상, 싸우는 중(적대 40 m 안 또는 10초 안 피격), 미션이 막을 때 */
  canFastTravel() {
    const g = this.game, p = g.player;
    const fight = g.time - this.lastHurt < 10 || g.query(p.x, p.y, 40, (e) => e.kind === 'human' && e.state === 'normal' && (e.hostile || e.tags?.has('hostile') || e.brain?.mode === 'fight')).length > 0;
    const why = wantedLevel(g) >= 1 ? '수배 중에는' : fight ? '싸우는 중에는' : g.flags.no_fast_travel ? '지금은' : null;
    if (why) g.notify(`${why} 시간을 건너뛸 수 없습니다`, 'warn');
    return !why;
  }

  // ------------------------------------------------------------ 노선 API
  nextDeparture(lineId, stopId) {
    const g = this.game, h = hourNow(g);
    if (lineId === 'train') return this.train?.nextDeparture(stopId, g) ?? null;
    if (lineId === 'steamer') {
      const S = this.steamer, list = [];
      if (!S) return null;
      if (S.runFrom('jemulpo_port', g)) list.push(...({ jemulpo_port: [6], mapo: [13.5] }[stopId] || []));
      if (S.runFrom('yongsan', g)) list.push(...({ yongsan: [7], mapo: [7.92] }[stopId] || []));
      list.sort((a, b) => a - b);
      return list.find((t) => t >= h) ?? list[0] ?? null;
    }
    const T = this.tram;
    if (lineId !== 'tram' || !T?.serviceOn(g)) return null;
    if (h < 6 || h >= 20) return 6;
    const sd = T.sd(stopId);
    let best = Infinity;
    for (const c of T.trams) {
      if (c.parked) continue;
      const dd = (sd - c.d) * c.dir, end = c.dir > 0 ? T.line.length : 0;
      best = Math.min(best, dd >= 0 ? dd : Math.abs(end - c.d) + Math.abs(end - sd) + 66);
    }
    return h + (best < Infinity ? toH(best / AVG.tram, g) : 80 / 60);
  }
  /** 빠른 이동 보조: 그 노선을 타고 stopId 까지 간 것으로 친다 (탄 채이거나 타는 곳 40 m 안) */
  rideTo(lineId, stopId) {
    const g = this.game, p = g.player, L = g.world?.lines?.[lineId], st = L?.stops.find((s) => s.id === stopId);
    if (!p || !st || !this.canFastTravel()) return false;
    const v = p.vehicle, T = this.train;
    if (lineId === 'train' && T?.c && v?.consist === T.c) {
      for (let k = 0; k < 6 && T.c.at !== stopId && T.skip(g); k++);
      return true;
    }
    const cp = closestOnPolyline(L.points, p.x, p.y, L.cum);
    if (!v && cp.dist > 40) return g.notify('타는 곳에서만 갈 수 있습니다', 'warn'), false;
    const from = L.stops.reduce((b, s) => (Math.abs(s.d - cp.d) < Math.abs(b.d - cp.d) ? s : b), L.stops[0]);
    const fare = lineId === 'tram' ? 3 : lineId === 'steamer' ? (Math.abs(st.d - from.d) < 500 ? 10 : 75) : g.sys.shops?.useTicket?.(from.id, stopId, 3) ? 0 : trainFare(from.id, stopId, 3);
    if (!this.waiveFares && !pay(g, fare, lineId)) return g.notify('돈이 모자랍니다', 'warn'), false;
    if (v) v.exit(p, g, { force: true, silent: true });
    const secs = Math.abs(st.d - cp.d) / (AVG[lineId] || 3);
    const go = () => {
      const q = g.world.randomPassableNear?.(st.sx ?? st.x, st.sy ?? st.y, 8, 'foot') || st;
      Object.assign(p, { x: q.x, y: q.y, vx: 0, vy: 0 });
      g.camera.snap(q.x, q.y);
      g.sys.time?.skip?.(toH(secs, g));
      g.emit('rail:arrive', { line: lineId, stop: stopId, vehicle: null, playerAboard: true });
      g.sys.ui?.fade?.(false, 400);
    };
    const f = g.sys.ui?.fade?.(true, 400);
    f?.then ? f.then(go) : go();
    return true;
  }
  forceArrival(line, stopId, withinSec = 20) {
    const g = this.game, T = this.train;
    if (line === 'tram') return this.tram?.forceArrival(stopId, withinSec, g) ?? false;
    if (line !== 'train' || !T?.c) return false;
    const c = T.c, sd = T.leadAt(stopId, c.dir), back = c.max * withinSec * 0.5;
    Object.assign(c, { d: clamp(sd - c.dir * back, 5, T.line.length - 5), state: 'run', speed: c.max * 0.6, stops: [stopId, ...c.stops.filter((s) => s !== stopId && (T.sd(s) - sd) * c.dir > 0)] });
    c.place();
    return true;
  }
  requestStop(line, stopId) {
    if (line === 'train' && this.train) return this.train.req.add(stopId), true;
    const T = this.tram;
    if (line !== 'tram' || !T) return false;
    const sd = T.sd(stopId), c = T.trams.filter((c) => !c.parked && (sd - c.d) * c.dir > 15).sort((a, b) => Math.abs(sd - a.d) - Math.abs(sd - b.d))[0];
    if (c) c.stopAt = sd;
    return !!c;
  }
  fastForward(mult = 1) {
    const m = Math.max(1, +mult || 1);
    if (m === this.ff) return;
    this.ff = m;
    if (m > 1) this.game.notify(`빨리감기 ×${m} (Space 를 1초 누르면 멈춘다)`);
  }
  markSkip() {
    this.skipFx = 0.5;
    this.skipping = true;
  }

  // ------------------------------------------------------------ 주기 점검
  onShot(e) {
    const g = this.game, s = e?.shooter;
    if (s?.vehicle?.vtype === 'gama' && s.vehicle.driver !== s) s.vehicle.scare(g);
    if (!Number.isFinite(e?.x)) return;
    for (const h of g.query(e.x, e.y, 25, (v) => v.kind === 'vehicle' && v.hearShot)) h.hearShot(e.x, e.y, g);
    if (g.player && Math.hypot(e.x - g.player.x, e.y - g.player.y) < 60) this.fastForward(1);
  }
  /** 훔친 탈것: 게임 2시간 '도난', 순검이 30 m 안에서 보면 50% 검문 (C.3) */
  stolenCheck(game) {
    const p = game.player, v = p.vehicle;
    if (v?.owner !== 'stolen') return;
    v.stolenAt ??= game.time;
    if (game.time - v.stolenAt > 240) return void (v.owner = null);
    const cop = game.query(p.x, p.y, 30, (e) => e.kind === 'human' && e.faction === 'police' && e.state === 'normal').length > 0;
    if (cop && !v._cop && rand.chance(0.5)) game.notify('순검이 훔친 탈것을 알아보았다!', 'bad'), crime(game, 'theft', p.x, p.y, p, v);
    v._cop = cop;
  }
  /** 전차 운휴·재개 이벤트, 종로 2가 불탄 전차 잔해 (A.6) */
  tramState(game) {
    const on = this.tram?.serviceOn(game) ?? false, F = game.flags;
    if (this.tramOn != null && on !== this.tramOn) game.emit('tram:service', { on });
    this.tramOn = on;
    const riot = game.findByTag('tram_riot')[0], wreck = game.findByTag('tram_wreck')[0], sus = F.tram_suspended && !flagOn(game, 'tram_resumed');
    if (riot && F.tram_burned && !riot.burnt) riot.burn();
    if (!sus) return void (wreck && (wreck.alive = false));
    if (wreck || riot || game.sys.missions?.active || !this.tram) return;
    const q = game.world.places?.lm_fire_1899 || { x: 2975, y: 791 }, L = this.tram.line, cp = closestOnPolyline(L.points, q.x, q.y, L.cum);
    const v = this.spawn('tram', cp.x, cp.y, cp.angle, { parked: true });
    Object.assign(v, { burnt: true, persistent: true });
    v.tags.add('tram_wreck');
  }
  /** 정리 (C.3): 주인 없는 탈것은 180 m 넘게 떨어지고 화면 밖 30실초면 지운다 */
  cleanup(game) {
    const p = game.player;
    for (const v of game.entities) {
      if (v.kind !== 'vehicle' || !v.alive || v.persistent || v.ambient || v.mission || v.consist || v.tags.size || v.owner === 'player' || v.hasPlayer) continue;
      if (v.seats.some((s) => s.occupant && !s.occupant.tags?.has('crew'))) continue;
      v.offT = Math.hypot(v.x - p.x, v.y - p.y) > 180 && !game.camera.visible(v.x, v.y, 10) ? (v.offT || 0) + 1 : 0;
      if (v.offT >= 30) this.discard(v);
    }
  }
  drawFx(ctx, game, dt) {
    if (this.skipFx <= 0) return;
    this.skipFx -= dt || 1 / 60;
    ctx.fillStyle = `rgba(12,10,9,${clamp(this.skipFx * 2, 0, 1)})`;
    ctx.fillRect(0, 0, game.camera.viewW, game.camera.viewH);
  }

  // ------------------------------------------------------------ 저장 (내 말들)
  serialize() {
    return { horses: this.horses.filter((h) => h.alive && h.save).map((h) => ({ ...h.save(), tags: [...h.tags], active: h === this.playerHorse })) };
  }
  deserialize(d) {
    const g = this.game;
    for (const h of this.horses) this.discard(h);
    this.horses = [];
    this.playerHorse = null;
    for (const s of d?.horses || []) {
      const h = this.spawn(s.vtype, s.x, s.y, s.angle || 0, { owner: 'player', name: s.name, coat: s.coat, stallion: s.stallion });
      if (!h) continue;
      Object.assign(h, { hp: s.hp ?? h.hp, stamina: s.stamina ?? h.stamina, bond: s.bond ?? 1, bondXp: s.bondXp ?? 0, persistent: true });
      for (const t of s.tags || []) h.tags.add(t);
      for (const k of ['items', 'small', 'large']) h.cargo[k] = (s.cargo?.[k] || []).slice(0, h.cargo.cap[k]);
      const st = s.stabled && (this.stables.find((x) => x.id === s.stabled) || this.nearestStable(s.x, s.y));
      if (st) h.stableAt(st, g);
      this.horses.push(h);
      if (s.active || !this.playerHorse) this.playerHorse = h;
    }
    this.lastAbs = null;
    this.resync(g);
  }
}

export function install(game) {
  const sys = new Vehicles(game);
  game.registerSystem(sys);
  return sys;
}
