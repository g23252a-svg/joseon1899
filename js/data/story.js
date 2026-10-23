// 미션·대사 데이터 (스펙 H, 0.2, K). 엔진은 systems/missions.js.
// 대사 줄은 '화자: 내용' 문자열로 쓰고 L() 이 {speaker, text} 로 바꾼다. '(…)' 로 시작하면 자막.
// step: {type, text, …판정 인자, say, choice, chat, hint, trig, waves, miss, onStart, onDone, when, timeout, alt, start(g,M), done(g,M), tick(g,M,dt)}
//   say: 대화 단계는 말을 걸 때, 다른 단계는 시작할 때 보여 준다(멈춤). chat: 멈추지 않는 대사. hint: 조작 안내 토스트.
//   trig: [{x,y,r | test(g,M), delay, say, choice, fx, run(g,M)}] 단계 안의 한 번짜리 사건. waves: [[초|fn, spawn[] | fn(g,M)]]
//   miss: {at, retry, pos, step} 열차 놓침 → 다음 날 retry 시각에 step 부터(retry:'nextDay').
// fx: {money, honor, items:[[id,n]], remove:[[id,n]], flags:[..], set:{k:v}, xp:{tree:n}, crime, wanted:[lv,bounty,reason]}

const L = (...a) =>
  a.flat().map((s) => {
    const i = s.indexOf(': ');
    return s[0] !== '(' && i > 0 && i <= 12 ? { speaker: s.slice(0, i), text: s.slice(i + 2) } : { speaker: '', text: s };
  });
const has = (g, id) => (g.sys.inventory?.count?.(id) ?? 0) > 0;

// 날짜 플래그 (§0.2). [flag, 시작, 끝?]. 끝이 있으면 그 뒤로 꺼진다.
export const DATE_FLAGS = [
  ['tram_running', '1899-05-17'],
  ['tram_festival', '1899-05-17', '1899-05-17'],
  ['rail_construction', '1899-05-17', '1899-09-17'],
  ['drought', '1899-05-17', '1899-06-11'],
  ['rail_trial', '1899-06-17', '1899-09-17'],
  ['rail_open', '1899-09-18'],
  ['steamer_reduced', '1899-09-18'],
  ['tram_resumed', '1899-09-28'],
];
// world.setMapState 로 넘기는 플래그 (A.6)
export const MAP_FLAGS = ['rail_construction', 'rail_trial', 'rail_open', 'tram_suspended', 'tram_resumed'];
export const START_DATE = '1899-05-17';

const ROW = (vt, x, y, a, o = {}) => ({ vehicle: vt, x, y, angle: a, ...o });
const GUARD = (x, y, o = {}) => ({ role: 'sungeom', faction: 'police', name: '순검', x, y, brain: 'guard', weapon: 'w_club', ...o });
const RIVAL = (x, y, o = {}) => ({ role: 'bandit', faction: 'rival', name: '화적', x, y, brain: 'bandit', tag: 'm07_rival', ...o });
const PIRATE = (o = {}) => ({ role: 'bandit', faction: 'pirate', name: '수적', brain: 'bandit', look: { coat: '#8a7f62' }, ...o });

export const MISSIONS = [
  // ───────────────────────────── 프롤로그
  {
    id: 'pro01_ferry', title: '나루를 건너', chapter: 0, auto: true, start: { x: 2707, y: 1600, r: 30 }, requires: [],
    date: '1899-05-17', time: '07:00', weather: 'clear', checkpoint: [1],
    card: '사람들은 이것을 개화라 불렀다. 어떤 이들은 끝이라 불렀다.',
    intro: L('(광무 3년, 1899년 5월 17일. 음력 사월 초파일.)'),
    sum: '노량진나루에서 관선을 타고 한강을 건너, 덕구에게서 조랑말 먹구름을 받았다.',
    spawn: [
      { npc: 'sagong_noryang', x: 2730, y: 1574 },
      ROW('rowboat', 2730, 1554, -1.6, { tag: 'm01_ferry', owner: 'public', name: '관선', driverNpc: 'sagong_noryang' }),
      { npc: 'deokgu', x: 2770, y: 1440 },
      { vehicle: 'pony', x: 2774, y: 1444, angle: 0, tag: 'meokgureum', name: '먹구름', owner: 'player', keep: true, once: true },
    ],
    steps: [
      { type: 'reach', text: '노량진나루로 가라', x: 2730, y: 1572, r: 20, hint: '방향키(WASD)로 걷고 Shift 로 달린다.' },
      { type: 'talk', text: '사공에게 말을 걸어라', npcId: 'sagong_noryang', say: L('사공: 관선이라 삯은 없소. 그래도 막걸리 한 사발 값은 인정이지.'),
        choice: { q: '막걸리 값을 줄까?', opts: [{ t: '막걸리 값 1전을 준다', fx: { money: -1, honor: 1 } }, { t: '그냥 탄다' }] } },
      { type: 'mount', text: '나룻배에 올라라', vtype: 'rowboat', role: 'passenger', hint: 'F 로 배에 오른다. 사공이 노를 젓는다.', skipTp: [2760, 1450],
        done: (g, M) => M.goto(M.vehicle('m01_ferry'), 2760, 1474) },
      { type: 'reach', text: '용산나루에 내려라', x: 2760, y: 1452, r: 25,
        chat: L('한길: …한성에 무슨 구경거리라도 났소?', '사공: 전기거라나. 소도 말도 없이 쇠수레가 저 혼자 간다오.', '사공: 비가 안 오는 것도 그 탓이라던데.'),
        done: (g, M) => M.dismount(g.player) },
      { type: 'talk', text: '덕구를 만나라', npcId: 'deokgu', say: L('덕구: 아저씨가 한길 아저씨죠? 선생님이 이 말 드리래요. 이름은 먹구름!', '덕구: 수놈이라 딴 말 보면 물어요. 고삐 꽉 잡아요!') },
      { type: 'mount', text: "조랑말 '먹구름'에 올라라", moveMode: 'horse', hint: 'F 로 말에 오른다. 멀리 두었으면 H 로 휘파람을 분다.',
        done: (g, M) => M.setHorse(g.player.vehicle || M.vehicle('meokgureum')) },
    ],
    rewards: { xp: { gima: 50 } },
  },
  {
    id: 'pro02_tram', title: '전기거(電氣車)', chapter: 0, chain: true, requires: ['pro01_ferry'], start: { x: 2760, y: 1452, r: 60 },
    date: '1899-05-17', time: '11:00', fade: '오전 내내 장터를 돌다', checkpoint: [1, 4],
    sum: '오장헌과 칠패에서 만나 숭례문을 지나고, 소매치기를 쫓고, 처음으로 전차를 탔다.',
    spawn: [
      { npc: 'deokgu', follow: 4, at: 'player', dx: 3 },
      ROW('gama', 2515, 1118, -0.9, { tag: 'chilpae_gama', owner: 'public', until: 3, driver: { role: 'porter', name: '가마꾼' }, passengers: ['oh_janghun'] }),
      GUARD(2571, 1062, { tag: 'm02_gate', until: 3 }), GUARD(2580, 1064, { tag: 'm02_gate', until: 3 }),
    ],
    steps: [
      { type: 'reach', text: '칠패장에서 오장헌의 보교를 찾아라', x: 2515, y: 1118, r: 20, say: L('덕구: 선생님은 칠패에 계세요. 보교 타고 계셔요!') },
      { type: 'talk', text: '보교에 탄 오장헌에게 말을 걸어라', npcId: 'oh_janghun', say: L('오장헌: 왔느냐, 길아. 오늘 나는 홍주 오 진사니라. 너는 내 하인이고.'),
        done: (g, M) => M.stableHorse(3165, 812) },
      { type: 'escort', text: '보교를 따라 숭례문을 지나라', npcId: 'oh_janghun', x: 2575, y: 1068, r: 12,
        trig: [{ x: 2570, y: 1075, r: 22, say: L('순검: 거기 가마 멈추시오. 어느 댁 행차요?', '오장헌: 홍주 오 진사일세. 초파일 구경 나왔네. 길을 비키게.', '순검: …실례했소이다. 지나가시오.') }] },
      { type: 'reach', text: '종로 보신각 앞으로 가라', x: 2860, y: 782, r: 8,
        onStart: { fade: { text: '한 식경 뒤, 종로 운종가', teleport: { player: [2850, 800], npcs: { oh_janghun: [2862, 784], deokgu: [2846, 803] } } },
          spawn: [{ role: 'villager', faction: 'civilian', name: '구경꾼', x: 2905, y: 792, n: 40, spread: 55, brain: 'wander', tag: 'm02_crowd' }] },
        start: (g, M) => M.remove('chilpae_gama'),
        onDone: L('오장헌: 저 쇠수레를 보아라. 황제의 돈으로 깔고, 미국 사람 기술로 굴리고, 일본 사람 운전수가 몬다.', '오장헌: 백성은 구경만 하지. …이런, 쌈지가 없구나!') },
      { type: 'collect', text: '쌈지를 훔쳐 달아나는 아이를 잡아라', itemId: 'q_ssamji', n: 1, timeout: { seconds: 60, then: 'skip', flag: 'pickpocket_escaped' },
        onStart: { spawn: [{ npc: 'p2_pickpocket', x: 2885, y: 790, brain: 'flee', carry: 'q_ssamji', tag: 'p2_pickpocket' }] },
        say: L('덕구: 저 애예요! 저기 달려가요!'), hint: 'Shift 로 달려 맨손으로 넘어뜨린 뒤 E 로 쌈지를 줍는다.' },
      { type: 'talk', text: '오장헌에게 돌아가라', npcId: 'oh_janghun',
        say: (g) => L(g.flags.pickpocket_escaped ? '오장헌: 됐다. 쌈지보다 아까운 건 저 애의 처지니라.' : '오장헌: 잘했다. 쌈지보다 네 걸음을 보러 온 것이니라.',
          '오장헌: 천복이가 경무청 옥에 갇혔다. 오늘 밤, 순검들이 등불 구경꾼에 매여 있을 때 꺼낸다.'),
        done: (g, M) => { M.fx({ remove: [['q_ssamji', 1]] }); M.remove('p2_pickpocket'); M.follow('oh_janghun', 3); } },
      { type: 'mount', text: '종로 타는 곳에서 손을 들어 전차를 세우고 올라라', vtype: 'tram', role: 'passenger', skipTp: [3225, 780],
        say: L('덕구: 상등칸은 가운데, 하등칸은 앞뒤예요. 돈만 내면 누구나 상등에 앉아요!'), hint: '표석 곁 선로 4 m 안에서 E 로 손을 들면 전차가 선다.',
        start: (g) => { g.flags.npc_pays_fare = true; g.sys.vehicles?.forceArrival?.('tram', 'jongno', 20); } },
      { type: 'ride', text: '전차를 타고 동대문까지 가라', line: 'tram', from: 'jongno', to: 'dongdaemun',
        trig: [{ delay: 8, test: (g) => !!g.player.vehicle, say: L('차장: 큰 상립 쓰신 상주께선 세 곱이오!', '오장헌: 이 쇠수레 바퀴 밑에 깔리는 게 무엇인지 아느냐. 인력거꾼 밥줄이니라.') }],
        done: (g) => { g.flags.npc_pays_fare = false; } },
      { type: 'talk', text: '동대문 마방에서 말을 빌려라', npcId: 'mabang_ju', say: L('마방 주인: 조랑말은 수놈이라 저희끼리 물어뜯소. 떨어뜨려 매어 두시오.'), onDoneFx: { flags: ['horses_rented'] } },
    ],
    rewards: { xp: { gima: 50 } },
  },
  {
    id: 'pro03_jail', title: '옥문(獄門)', chapter: 0, chain: true, requires: ['pro02_tram'], start: { x: 3160, y: 808, r: 60 },
    date: '1899-05-17', time: '23:00', weather: 'clear', fade: '그날 밤', checkpoint: [1, 3],
    sum: '그날 밤 경무청 옥사에 숨어들어 마천복을 꺼냈다.',
    spawn: [
      { vehicle: 'pony', at: 'player', dx: 3, angle: 0, tag: 'm03_horse', horse: true, until: 2 },
      { npc: 'oh_janghun', at: 'player', dx: -3, follow: 6, ride: 'pony' }, { npc: 'bau', at: 'player', dx: -5, dy: 2, follow: 7, ride: 'pony' },
      GUARD(2664, 709, { tag: 'p3_guard', carry: 'q_jail_key', angle: -1.57 }),
      GUARD(2667, 700, { tag: 'p3_guard', brain: 'patrol', route: [[2667, 700], [2667, 722]] }),
      { npc: 'ma_cheonbok', x: 2663, y: 712, brain: 'idle' },
      ...[600, 650, 700, 750].map((y) => GUARD(2722, y, { brain: 'patrol', route: [[2722, 600], [2722, 760]], tag: 'm03_patrol' })),
    ],
    steps: [
      { type: 'reach', text: '경무청 서쪽 골목으로 말을 몰아라', x: 2660, y: 742, r: 10, say: L('오장헌: 피는 보지 말거라. 순검도 품삯 받는 백성이니라.') },
      { type: 'dismount', text: '말에서 내려라', done: (g, M) => { M.follow('oh_janghun', 0); M.follow('bau', 0); } },
      { type: 'reach', text: '웅크려(C) 골목 어귀로 숨어들어라', x: 2667, y: 730, r: 5, hint: 'C 로 웅크리면 발소리가 줄고 잘 들키지 않는다.' },
      { type: 'kill', text: '옥사 앞 순검 둘을 소리 없이 제압하라', tag: 'p3_guard', n: 2, hint: '뒤에서 다가가 맨손으로 제압한다. 죽이면 살인이다.',
        tick: (g, M) => { if ((g.sys.wanted?.level ?? 0) > 0 && !M.st.alarm) { M.st.alarm = 1; M.say(L('순검: 거기 누구요! 여기는 경무청 뒷마당이오!')).then(() => M.goStep(5)); } } },
      { type: 'collect', text: '쓰러진 순검을 뒤져 옥 열쇠를 찾아라', itemId: 'q_jail_key', n: 1, hint: '쓰러진 사람 곁에서 E 로 뒤진다.' },
      { type: 'talk', text: '옥문을 열고 마천복을 꺼내라', npcId: 'ma_cheonbok',
        say: L('마천복: 늦었구먼, 선생. 내 셈엔 어제 왔어야 했는데.', '마천복: 길이, 이 은혜는 장부에 적어 두마.', '바우: (호각 소리) 들켰소! 말로!'),
        done: (g, M) => { g.sfx('whistle'); M.fx({ remove: [['q_jail_key', 1]], wanted: [2, 150, 'jailbreak'] }); M.follow('ma_cheonbok', 6, 'pony'); M.follow('oh_janghun', 6); M.follow('bau', 7); } },
      { type: 'mount', text: '골목에 맨 말에 올라라', moveMode: 'horse', onStart: { spawn: [{ vehicle: 'pony', x: 2660, y: 742, angle: 1.57, tag: 'gyeongmu_horses', once: true }] } },
    ],
    rewards: { xp: { muye: 80 } },
    after: (g, M) => { g.flags.no_police_killed = M.kills('police') === 0; },
  },
  {
    id: 'pro04_escape', title: '강을 건너라', chapter: 0, chain: true, requires: ['pro03_jail'], start: { x: 2660, y: 742, r: 60 },
    date: '1899-05-17', time: '23:30', checkpoint: [1, 3, 5],
    sum: '총순 이시중의 추격을 뿌리치고 한강을 건너 수리산 산채에 닿았다.',
    spawn: [
      { npc: 'lee_sijung', x: 2720, y: 700, ride: 'jeju_horse', brain: 'police', hostile: true, weapon: 'w_revolver', until: 2 },
      { npc: 'oh_janghun', at: 'player', dx: -4, follow: 6, ride: 'pony', until: 2 }, { npc: 'ma_cheonbok', at: 'player', dx: -6, follow: 7, ride: 'pony', until: 2 },
      { npc: 'bau', at: 'player', dx: -8, follow: 8, ride: 'pony', until: 2 },
    ],
    steps: [
      { type: 'reach', text: '남대문로를 달려 숭례문을 빠져나가라', x: 2575, y: 1068, r: 15, say: L('이시중: 멈추시오! 경무청 총순 이시중이오!') },
      { type: 'reach', text: '용산나루까지 달려라', x: 2760, y: 1452, r: 20 },
      // 거룻배는 용산나루에 정박한 증기선(2750~2770, 1480)과 겹치지 않는 동쪽 물가에 둔다
      { type: 'mount', text: '말에서 내려 거룻배에 올라 노를 잡아라', vtype: 'rowboat', role: 'driver', skipTp: [2730, 1572],
        onStart: { spawn: [ROW('rowboat', 2782, 1467, 1.6, { tag: 'm04_boat', passengers: ['oh_janghun', 'ma_cheonbok'], once: true }), { npc: 'deokgu', x: 2765, y: 1452 }] },
        start: (g, M) => { M.hide('bau'); M.stableHorse(1522, 2142); }, say: L('덕구: 먹구름은 제가 아침 배로 건네 갈게요! 어서 가요!') },
      { type: 'reach', text: '노를 저어 노량진나루에 닿아라', x: 2730, y: 1572, r: 20, say: L('오장헌: 저어라, 길아. 물살 거슬러 비스듬히!'),
        hint: '방향키로 뱃머리를 돌리고 Shift 로 힘껏 젓는다.', onStart: { spawn: [{ npc: 'lee_sijung', x: 2760, y: 1446, brain: 'police', hostile: true, weapon: 'w_revolver' }] },
        done: (g, M) => M.dismount(g.player) },
      { type: 'mount', text: '윤팔이 끌고 온 말에 올라라', moveMode: 'horse', say: L('윤팔: 이쪽이오! 말 세 필 대 놨소!'),
        onStart: { spawn: [{ npc: 'yunpal', x: 2700, y: 1610, follow: 8, ride: 'pony' }, { vehicle: 'pony', x: 2703, y: 1606, angle: 0, tag: 'm04_horses', once: true }] },
        start: (g, M) => { M.hide('lee_sijung'); M.follow('oh_janghun', 6, 'pony'); M.follow('ma_cheonbok', 7, 'pony'); } },
      { type: 'custom', text: '추격을 떨쳐라', fn: (g) => !!g.player.vehicle && g.player.vehicle.moveMode === 'horse' && (g.sys.wanted?.level ?? 0) === 0 },
      { type: 'reach', text: '수리산 산채로 가라', x: 1500, y: 2140, r: 40 },
    ],
    outro: L('오장헌: 오늘 밤 우리는 한 사람도 버리지 않았다. 그것이 우리가 화적과 다른 까닭이니라.', '마천복: 경무청 서리 하나 내 셈에 들어 있구먼. 길이 얼굴은 문서에서 지워질 게여.', '한길: (속말) …그 말을 믿고 여기까지 왔지.'),
    rewards: { money: 100, xp: { gima: 100 }, pardon: true, flags: ['prologue_done'] },
    after: (g, M) => { if (g.flags.no_police_killed && M.kills('police') === 0) M.fx({ honor: 3 }); else g.flags.no_police_killed = false; },
  },
  // ───────────────────────────── 1장
  {
    id: 'ch1_01_hunt', title: '늙은 범 포수', chapter: 1, giver: 'choi_mandeuk', start: { x: 1512, y: 2150, r: 6 }, requires: ['pro04_escape'],
    date: '1899-05-21', time: '06:00', weather: 'fog', checkpoint: [1], card: '제1장 솔고개. 새 길은 누구의 것인가.',
    intro: L('최만득: 짐승은 바람을 읽어. 니 냄새가 바람 타믄 그날 사냥은 끝이여.'),
    sum: '최만득에게서 바람 읽는 법을 배우고 계양산에서 노루를 잡았다.',
    begin: (g, M) => { if (!has(g, 'w_bow')) M.fx({ items: [['w_bow', 1]] }); if ((g.sys.inventory?.count?.('a_arrow') ?? 0) < 20) M.fx({ items: [['a_arrow', 20]] }); },
    spawn: [{ npc: 'choi_mandeuk', at: 'player', dx: 3, follow: 6, ride: 'pony' }],
    steps: [
      { type: 'reach', text: '최만득과 계양산 사냥터로 가라', x: 910, y: 1240, r: 80 },
      { type: 'skin', text: '바람을 안고 노루에게 다가가 활로 잡아 가죽을 벗겨라', species: 'roe_deer', n: 1,
        say: L('최만득: 바람을 안고 가. 노루 쪽에서 니 쪽으로 불어야 혀.', '최만득: 활은 소리가 없어. 화승총은 불씨 꺼지믄 쇠막대기고.'),
        hint: 'C 로 웅크려 다가가 활을 당긴다(마우스 왼쪽). 쓰러진 짐승 곁에서 E 로 가죽을 벗긴다.',
        onStart: { spawn: [{ animal: 'roe_deer', x: 930, y: 1200, n: 2, spread: 8, tag: 'm05_deer' }, { animal: 'pheasant', x: 880, y: 1265, n: 3, spread: 8, tag: 'm05_pheasant' }] },
        start: (g, M) => { g.flags.hud_wind = true; M.follow('choi_mandeuk', 28); }, done: (g) => { g.flags.hud_wind = false; },
        onDone: L('최만득: 가죽은 결 따라 벗겨. 칼이 급하믄 값이 반이여.') },
      { type: 'kill', text: '꿩 두 마리를 잡아라', species: 'pheasant', n: 2 },
      { type: 'reach', text: '고기와 가죽을 말에 싣고 산채로 돌아가라', x: 1500, y: 2140, r: 30, start: (g, M) => M.follow('choi_mandeuk', 6),
        chat: L('최만득: 요새는 범도 줄고 포수도 줄었어. 둘 다 철길 공사 소리에 쫓겨 가는 게지.') },
      { type: 'talk', text: '노 서방에게 고기를 넘겨라', npcId: 'no_seobang', say: L('노 서방: 고기 냄새 맡으니 산채가 사람 사는 데 같구먼.'),
        choice: { q: '고기를 어떻게 할까?', opts: [{ t: '고기를 솥에 넘긴다', fx: { remove: [['m_meat', 2]], honor: 1, flags: ['camp_fed'] } }, { t: '내가 갖는다' }] } },
    ],
    rewards: { xp: { saengjon: 100 } },
  },
  {
    id: 'ch1_02_riot', title: '불타는 전차', chapter: 1, giver: 'ma_cheonbok', start: { x: 1488, y: 2140, r: 6 }, requires: ['ch1_01_hunt'],
    date: '1899-05-26', time: '14:00', weather: 'clear', checkpoint: [2],
    intro: L('마천복: 한성에 바람이 심상치 않구먼. 칠패로 가서 종로 일을 보고 오게. 덕구가 길을 알지.'),
    fade: '닷새 뒤 한낮, 숭례문 밖 칠패', tp: [2530, 1140],
    sum: '종로 2가에서 전차가 아이를 치고 성난 군중이 몰려든 날, 한길은 편을 골랐다.',
    steps: [
      { type: 'reach', text: '종로 2가로 가라', x: 2975, y: 791, r: 25,
        onDone: L('(전차가 멈췄다. 사람들이 몰려들었다. 아이 아버지가 도끼를 들고 달려들었다.)', '군중: 애가 깔렸다! 애가!', '행인: 비가 안 오는 게 다 저 쇠수레 탓이라더니!'),
        onDoneFx: { flags: ['tram_suspended'] } },
      { type: 'flag', text: '어느 편에 설지 정하라', name: 'riot_choice',
        onStart: { spawn: [
          ROW('tram', 2975, 791, 0, { tag: 'tram_riot', owner: 'public', parked: true, once: true }),
          { npc: 'motorman_jp', x: 2972, y: 786 }, { npc: 'conductor_kr', x: 2979, y: 796 }, { npc: 'deokgu', x: 2950, y: 800, follow: 4 },
          { role: 'villager', faction: 'civilian', name: '성난 군중', x: 2975, y: 800, n: 30, spread: 18, brain: 'idle', tag: 'rioter' }] },
        say: L('성난 군중: 왜인 운전수가 애를 두고 내빼려 한다!'),
        choice: { q: '어느 편에 설 것인가?', opts: [{ t: '불을 놓는다', fx: { set: { riot_choice: 'crowd' } } }, { t: '사람부터 살린다', fx: { set: { riot_choice: 'save' } } }, { t: '요금 주머니를 챙긴다', fx: { set: { riot_choice: 'loot' } } }] } },
      { type: 'act', text: '전차에 불을 붙여라', when: { flag: 'riot_choice', eq: 'crowd' }, x: 2975, y: 791, r: 6, label: '전차에 불 붙이기', secs: 3, flag: 'tram_burned',
        onDoneFx: { crime: 'arson', wanted: [2, 100, 'arson'], flags: ['rickshaw_friend'] } },
      { type: 'survive', text: '운전수와 차장을 45초 동안 지켜라', when: { flag: 'riot_choice', eq: 'save' }, seconds: 45, keepAlive: ['motorman_jp', 'conductor_kr'],
        say: L('운전수: [일본어] 아이를… 못 봤소. 정말이오.', '차장: 나도 조선 사람이오! 품 팔러 나왔을 뿐이오!'),
        waves: [0, 15, 30].map((t, i) => [t, [{ role: 'villager', faction: 'civilian', name: '성난 군중', x: 2960, y: 812, n: i < 2 ? 3 : 2, spread: 6, brain: 'bandit', hostile: true, weapon: 'w_club', tag: 'rioter' }]]) },
      { type: 'collect', text: '차장의 요금 주머니를 챙겨라', when: { flag: 'riot_choice', eq: 'loot' }, itemId: 'q_fare_bag', n: 1, at: [2980, 797], label: '요금 주머니 줍기',
        done: (g, M) => { if (has(g, 'q_fare_bag')) M.fx({ remove: [['q_fare_bag', 1]], money: 30 }); M.fx({ crime: 'theft', wanted: [1, 30, 'theft'] }); } },
      { type: 'mount', text: '버려진 인력거를 잡아라', vtype: 'rickshaw', role: 'driver',
        onStart: { spawn: [ROW('rickshaw', 2990, 800, 1.57, { tag: 'm06_rickshaw', once: true })] },
        start: (g, M) => M.board(g.flags.riot_choice === 'save' ? 'conductor_kr' : 'deokgu', M.vehicle('m06_rickshaw')) },
      { type: 'custom', text: '다친 차장을 제중원으로 옮겨라', when: { flag: 'riot_choice', eq: 'save' }, x: 3000, y: 889,
        fn: (g, M) => M.near(g.player, 3000, 889, 12), onStart: { spawn: [{ npc: 'song_aesun', x: 3000, y: 889 }] },
        onDone: L('송애순: 총상은 아니네요. 머리 다친 건 오늘 밤이 고비예요. 눕혀 주세요.'), done: (g, M) => M.dismount(M.npc('conductor_kr')) },
      { type: 'reach', text: '인력거를 끌고 칠패까지 빠져나가라', when: { flag: 'riot_choice', ne: 'save' }, x: 2530, y: 1140, r: 20 },
      { type: 'talk', text: '덕구와 이야기하라', npcId: 'deokgu', start: (g, M) => M.follow('deokgu', 4),
        say: (g) => L(g.flags.riot_choice === 'save' ? ['덕구: 아까 그 누나요, 제중원 간호원이래요. 다치면 거기로 오래요.'] : [],
          '덕구: 우리 아버지가 순검한테 끌려갔어요. 인력거꾼들 앞장섰다고…', '한길: …가자. 산에 가면 밥은 굶지 않는다.'),
        onDoneFx: { flags: ['deokgu_joined'] } },
    ],
    rewards: { xp: { cheose: 80 } },
    after: (g, M) => M.fx({ honor: { save: 5, loot: -8 }[g.flags.riot_choice] || 0 }),
  },
  {
    id: 'ch1_03_oxcart', title: '솔고개 가는 쌀', chapter: 1, giver: 'ma_cheonbok', start: { x: 1488, y: 2140, r: 6 }, requires: ['ch1_02_riot'],
    date: '1899-06-12', time: '09:00', weather: 'cloudy', checkpoint: [1, 4],
    intro: L('마천복: 쌀 두 섬, 소금 한 섬. 소달구지는 느려도 배신은 안 하지.'),
    sum: '소사에서 쌀과 소금을 실어 오다 진창에서 불여우패 방칠성과 마주쳤다.',
    begin: (g, M) => { g.flags.wet_ground = true; M.later(240, () => { g.flags.wet_ground = false; }); },
    steps: [
      { type: 'reach', text: '소사장으로 가라', x: 1280, y: 1728, r: 25 },
      { type: 'talk', text: '객주 사람에게 쌀과 소금을 받아라', npcId: 'sosa_gaekju', say: L('객주 사람: 산채 몫이오. 쌀 두 섬, 소금 한 섬. 달구지째 끌고 가시오.') },
      { type: 'mount', text: '소달구지를 몰아라', vtype: 'oxcart', role: 'driver', hint: '진흙에 빠지면 E 를 여러 번 눌러 빼낸다.',
        onStart: { spawn: [ROW('oxcart', 1270, 1735, 0, { tag: 'm07_cart', once: true, cargo: ['쌀 두 섬', '소금 한 섬'] })] } },
      { type: 'reach', text: '솔고개 쪽으로 달구지를 몰아라', x: 1450, y: 1726, r: 25,
        onStart: { spawn: [ROW('oxcart', 0, 0, 0, { at: 'player', tag: 'm07_cart', once: true, mount: true })] } },
      { type: 'kill', text: '진창에서 덮친 화적을 물리쳐라', tag: 'm07_rival', faction: 'rival', n: 4, carryFirst: 'q_rival_tag', hint: '달구지나 나무 뒤에 숨어 싸운다.',
        onStart: { spawn: [RIVAL(1470, 1700, { weapon: 'w_matchlock' }), RIVAL(1474, 1704, { weapon: 'w_club' }), RIVAL(1430, 1750, { weapon: 'w_club' }), RIVAL(1434, 1754, { weapon: 'w_matchlock' }),
          { npc: 'bang_chilseong', x: 1480, y: 1745, brain: 'bandit', hostile: true }] },
        say: L('방칠성: 돌쇠야! 오랜만이다. 이름 바꿨다고 근본이 바뀌더냐?', '한길: 그 이름으론 이제 안 불려.'),
        onDone: L('방칠성: 이 길은 불여우 길이다. 다음엔 쌀 대신 네 머리를 싣고 가마.'), done: (g, M) => M.hide('bang_chilseong') },
      { type: 'collect', text: "화적 시체에서 '불여우 목패'를 찾아라", itemId: 'q_rival_tag', n: 1 },
      { type: 'custom', text: '달구지를 솔고개 주막까지 끌고 가라', x: 1560, y: 1724,
        fn: (g, M) => { const c = M.vehicle('m07_cart'); return c ? M.near(c, 1560, 1724, 20) : M.near(g.player, 1560, 1724, 20); },
        onDone: L('엄순례: 아이고 이 화상아, 진창 조심허라 했지. 몇 해 전엔 청국 사람 달구지가 봄까지 박혀 있었어.', '엄순례: 쌀은 광에 부리고, 국밥이나 한 그릇 혀.') },
    ],
    rewards: { money: 150, xp: { sagyeok: 80 }, flags: ['solgogae_discount'] },
  },
  {
    id: 'ch1_04_gobu', title: '고부에서 온 여자', chapter: 1, giver: 'eom_sunrye', start: { x: 1560, y: 1720, r: 6 }, requires: ['ch1_03_oxcart'],
    date: '1899-06-15', time: '16:00', weather: 'clear', wind: [2.36, 0.45], checkpoint: [1, 4],
    intro: L('엄순례: 마포 여각에 전라도 여자가 숨어 있댜. 영학당이랴. 관찰부가 현상 걸었다는 말이 돌어.'),
    sum: '마포 여각에 숨은 영학당 유선녀를 구만석에게서 빼내 황포돛배로 한강을 내려왔다.',
    spawn: [{ npc: 'yu_seonnyeo', x: 2300, y: 1378, brain: 'idle', until: 3 }],
    steps: [
      { type: 'reach', text: '마포 여각 뒷방으로 가라', x: 2300, y: 1378, r: 10 },
      { type: 'talk', text: '뒷방의 여인을 찾아라', npcId: 'yu_seonnyeo', say: L('유선녀: 고부에서 왔소. 군아를 쳤고, 졌소. 그게 다요.') },
      { type: 'kill', text: '구만석 일당을 막아라', tag: 'bounty_men', n: 2,
        onStart: { spawn: [{ npc: 'gu_manseok', x: 2300, y: 1350, brain: 'bandit', hostile: true },
          ...[-3, 3].map((dx) => ({ role: 'bandit', faction: 'bounty', name: '구만석 부하', x: 2300 + dx, y: 1352, brain: 'bandit', hostile: true, weapon: 'w_club', tag: 'bounty_men' }))] },
        say: L('구만석: 전라 관찰부 현상금이오. 비켜 주면 당신은 안 쏘오.', '한길: 현상금 붙은 머리가 여기 하나 더 있는데.'),
        start: (g, M) => M.follow('yu_seonnyeo', 4), done: (g, M) => M.hide('gu_manseok') },
      { type: 'mount', text: '마포나루의 황포돛배에 올라 키를 잡아라', vtype: 'sailboat', role: 'driver', skipTp: [1812, 1300],
        onStart: { spawn: [ROW('sailboat', 2352, 1424, Math.PI, { tag: 'm08_sail', once: true, passengers: ['yu_seonnyeo'] })] },
        say: L('유선녀: 돛은 내가 잡겄소. 당신은 키나 놓치지 마시오.'), hint: 'Shift 를 짧게 눌러 돛을 올리고 Space 로 내린다. 방향키는 키다.' },
      { type: 'reach', text: '강을 내려가 염창 둔치에 배를 대라', x: 1810, y: 1276, r: 22, say: L('유선녀: 바람이 뒤에서 비껴 분께 돛 다 올리시오.'), hint: '밤섬을 피해서 간다.',
        waves: [[30, (g, M) => {
          const v = M.spawn([ROW('rowboat', 2380, 1440, Math.PI, { tag: 'gu_skiff', driver: { role: 'porter', name: '사공' }, passengers: [{ npc: 'gu_manseok', brain: 'bandit', hostile: true }] })])[0];
          M.goto(v, null, null, 22); M.chat(L('구만석: (멀리서) 강은 길고 현상은 오래 가오.'));
        }]],
        done: (g, M) => { M.dismount(g.player); M.remove('gu_skiff'); M.hide('gu_manseok'); } },
      { type: 'escort', text: '유선녀와 함께 산채로 가라', npcId: 'yu_seonnyeo', x: 1500, y: 2140, r: 40,
        onStart: { spawn: [{ vehicle: 'pony', x: 1815, y: 1312, angle: 0, tag: 'yeomchang_horses', once: true }, { npc: 'bau', x: 1818, y: 1314, follow: 7, ride: 'pony' }] },
        start: (g, M) => M.follow('yu_seonnyeo', 5, 'pony'),
        trig: [{ delay: 25, say: L('유선녀: 아부지는 갑오년에 죽었소. 나는 올해 오월에 고부 군아를 쳤고. 다음은 어딘지 모르겄소.'), chat: true }] },
    ],
    outro: L('오장헌: 영학당의 불씨가 우리 산채에 왔구나. 반갑소, 동지.', '유선녀: 동지라는 말은 싸울 때 들어도 늦지 않소.'),
    rewards: { xp: { gima: 80 }, honor: 3, flags: ['yu_joined'] },
    after: (g, M) => M.stableHorse(1522, 2142),
  },
  {
    id: 'ch1_05_gama', title: '가마 탄 양반', chapter: 1, giver: 'oh_janghun', start: { x: 1548, y: 1722, r: 6 }, requires: ['ch1_04_gobu'],
    date: '1899-08-17', time: '08:00', weather: 'clear', checkpoint: [1, 5],
    intro: L('오장헌: 오늘 나는 홍주 오 진사다. 너는 내 하인이고. 고개를 들지 말거라.'),
    sum: '오장헌을 양반 가마로 모셔 제물포 대불호텔에 갔다. 현덕만이 열차 이야기를 흘렸다.',
    spawn: [{ npc: 'oh_janghun', at: 'player', dx: 2, follow: 3, look: { coat: '#eef2ee', trim: '#2c3e50', hat: 'gat' }, until: 2 }, { npc: 'gama_bearers', x: 1300, y: 1723 }],
    steps: [
      { type: 'reach', text: '소사 가마꾼 대기소로 가라', x: 1300, y: 1723, r: 10 },
      { type: 'talk', text: '가마꾼 둘을 부려라', npcId: 'gama_bearers', say: L('가마꾼: 보교 한 채, 소사에서 제물포까지 열닷 전이오. 삯은 선불입니다요.'),
        done: (g, M) => { if (!g.sys.inventory?.spendMoney?.(15)) M.notify('돈이 모자라 오장헌이 삯을 냈다'); } },
      { type: 'escort', text: '보교를 호위해 부평 관아 앞까지 가라', npcId: 'oh_janghun', x: 945, y: 1678, r: 20,
        onStart: { spawn: [ROW('gama', 1305, 1726, Math.PI, { tag: 'm09_gama', once: true, driver: { role: 'porter', name: '가마꾼' }, passengers: ['oh_janghun'] })] },
        hint: 'Shift 로 가마꾼을 재촉할 수 있다.',
        trig: [{ x: 1255, y: 1703, r: 25, say: L('가마꾼: 나리, 주막마다 목을 축여야 다리가 갑니다요.'),
          choice: { q: '가마꾼이 주막에서 쉬자고 한다.', opts: [{ t: '팁 2전을 주고 그냥 가세', fx: { money: -2 } }, { t: '재촉한다' }] } }],
        waves: [[40, (g, M) => { M.trialTrain(); M.chat(L('오장헌: 저 쇳덩이 소리를 들어라. 다음 달이면 사람을 싣는다지.')); }]] },
      { type: 'talk', text: '관아 사령의 검문을 받아라', npcId: 'bupyeong_saryeong', say: L('사령: 어느 댁 행차시오? 요즘 길에 화적이 많아서.'),
        choice: { q: '어떻게 답할까?', opts: [{ t: '"홍주 오 진사 행차요."', say: L('사령: …지나가시오.') }, { t: '(말없이 오장헌에게 맡긴다)', say: L('오장헌: 홍주 오 진사일세. 제물포에 볼일이 있네.', '사령: …지나가시오.') }] } },
      { type: 'escort', text: '대불호텔까지 보교를 모셔라', npcId: 'oh_janghun', x: 420, y: 1634, r: 8,
        onStart: { spawn: [ROW('gama', 655, 1613, Math.PI, { tag: 'm09_gama', once: true, driver: { role: 'porter', name: '가마꾼' }, passengers: ['oh_janghun'] })],
          fade: { text: '한 시진 뒤, 축현', teleport: { player: [650, 1613], vehicles: { m09_gama: [655, 1613] } } } } },
      { type: 'talk', text: '대불호텔 앞에서 현덕만을 만나라', npcId: 'hyeon_deokman', onStart: { spawn: [{ npc: 'hyeon_deokman', x: 420, y: 1634 }] },
        start: (g, M) => { M.dismount(M.npc('oh_janghun')); M.remove('m09_gama'); },
        say: L('(한길은 문밖에 섰다. 창 너머로 오장헌과 현덕만이 악수한다.)', '현덕만: 기차는 기다려 주지 않습니다. 양반도, 화적도요.', '현덕만: 구월 스무이튿날, 제물포 오후 한 시 상행. 맨 끝 화차에 회사 보상금이 실립니다.',
          '현덕만: 양총 스무 자루는 제 인사로 받아 두시지요. 셈은 깔끔하게 하시지요.', '한길: (속말) 왜 저자가 우리한테 이걸 알려 주지?') },
      { type: 'buy', text: '제물포 서양 상회에서 양총 탄을 사라', itemId: 'a_rifle', shop: 'gun_jemulpo',
        onStart: { spawn: [{ npc: 'yu_seonnyeo', x: 520, y: 1484 }] }, trig: [{ x: 520, y: 1470, r: 10, say: L('상회 주인: [영어] 탄은 한 상자에 열 발이오.'), chat: true }],
        alt: { type: 'talk', npcId: 'yu_seonnyeo', say: L('유선녀: 안 판다고? 돈이 없다고? 내가 사 오리다.'), fx: { items: [['a_rifle', 10]] } } },
      { type: 'reach', text: '해관 앞 부두로 가라', x: 440, y: 1732, r: 20, start: (g, M) => M.follow('yu_seonnyeo', 4),
        onDone: L('유선녀: 소금 가마니에 총이라. 짠 내 덕에 해관도 손 안 대겄소.') },
    ],
    outro: L('(유선녀가 소금 가마니 다섯 짝을 내일 아침 증기선에 실어 두었다. 가마니마다 양총이 네 자루씩 들었다.)'),
    rewards: { xp: { cheose: 80 }, flags: ['rifle_unlocked'] },
  },
  {
    id: 'ch1_06_steamer', title: '모래톱', chapter: 1, chain: true, requires: ['ch1_05_gama'], start: { x: 440, y: 1732, r: 60 },
    date: '1899-08-18', time: '05:30', weather: 'clear', fade: '이튿날 새벽', checkpoint: [1, 4, 6],
    sum: '증기선이 모래톱에 얹힌 사이 수적을 물리치고 양총 가마니를 마포까지 날랐다.',
    spawn: [{ npc: 'oh_janghun', at: 'player', dx: 2, follow: 3, until: 6 }, { npc: 'yu_seonnyeo', at: 'player', dx: -2, follow: 4 }],
    steps: [
      { type: 'reach', text: '제물포 잔교 끝으로 가라', x: 450, y: 1842, r: 8, start: (g) => { g.flags.npc_pays_fare = true; } },
      { type: 'mount', text: '증기선에 올라라', vtype: 'steamer', role: 'passenger', hint: '06시에 떠난다. 부두 끝에서 F 로 오른다.', start: (g, M) => M.ensureVehicle('steamer', 450, 1845, -1.57, { line: 'steamer' }) },
      { type: 'custom', text: '강을 거슬러 올라가라', x: 1673, y: 1105,
        fn: (g, M) => g.flags.steamer_aground || (g.player.vehicle?.vtype === 'steamer' && M.near(g.player, 1673, 1105, 70)),
        start: (g) => g.sys.vehicles?.fastForward?.(8),
        trig: [{ delay: 12, say: L('선원: 모래톱이 물때마다 자리를 바꾸니 뱃길은 하늘이 정하오.'), chat: true },
          { delay: 25, test: (g) => !g.sys.vehicles?.fastForward, run: (g, M) => M.fadeSkip('배가 강을 거슬러 오른다… 한낮, 모래톱', '12:00', () => { g.flags.steamer_aground = true; }) }],
        done: (g, M) => { g.sys.vehicles?.fastForward?.(1); g.flags.steamer_aground = true; g.flags.npc_pays_fare = false; const v = g.player.vehicle; if (v?.vtype === 'steamer') { v.aground = true; v.speed = 0; } } },
      { type: 'kill', text: '배에 오르는 수적을 물리쳐라', tag: 'river_pirates', n: 4, say: L('수적: 배 세워라! 짐 내려놓으면 목숨은 붙여 준다!'), hint: '갑판의 짐 뒤에 숨어 싸운다.',
        onStart: { spawn: [-1, 1].map((s) => ROW('rowboat', 18 * s, 14, 0, { at: 'player', tag: 'pirate_boat', driver: PIRATE({ tag: 'river_pirates', weapon: 'w_club', hostile: true }),
          passengers: [PIRATE({ tag: 'river_pirates', weapon: 'w_matchlock', hostile: true })] })) } },
      { type: 'collect', text: '짐칸의 소금 가마니를 챙겨라', itemId: 'q_rifle_bales', n: 1, at: 'player', label: '소금 가마니 들기', say: L('유선녀: 가마니부터 챙기시오. 저 배는 밀물이나 기다릴 판이오.') },
      { type: 'mount', text: '지나가는 삼판에 옮겨 타라', vtype: 'rowboat', role: 'passenger', say: L('삼판 사공: 몇 시간 늦어도 마포는 마포요. 타시오.'),
        onStart: { spawn: [ROW('rowboat', 9, 6, 0, { at: 'player', tag: 'm10_sampan', once: true, driverNpc: 'sampan_sagong' })] },
        start: (g, M) => { M.remove('pirate_boat'); M.board(g.player, M.vehicle('m10_sampan')); M.board('yu_seonnyeo', M.vehicle('m10_sampan')); },
        done: (g, M) => M.goto(M.vehicle('m10_sampan'), 2342, 1418) },
      { type: 'kill', text: '따라붙는 수적 쪽배를 막아라', tag: 'pirate_skiff', n: 2, hint: '삼판 위에서 쏜다.',
        onStart: { spawn: [ROW('rowboat', -30, 10, 0, { at: 'player', tag: 'pirate_skiff_boat', chase: 18, driver: PIRATE({ tag: 'pirate_skiff', weapon: 'w_club', hostile: true }),
          passengers: [PIRATE({ tag: 'pirate_skiff', weapon: 'w_matchlock', hostile: true })] })] } },
      { type: 'reach', text: '마포나루에 내려라', x: 2340, y: 1394, r: 15,
        onStart: { fade: { text: '한 시진 뒤, 마포', teleport: { vehicles: { m10_sampan: [2342, 1418] } } }, spawn: [{ npc: 'ma_cheonbok', x: 2336, y: 1392 }] },
        start: (g, M) => { M.remove('pirate_skiff_boat'); M.dismount(g.player); } },
    ],
    outro: L('마천복: 스무 자루. 셈 맞구먼.', '신문팔이: 호외요, 호외! 대한국국제 반포요! 황제 폐하 전권이오!'),
    rewards: { money: 300, xp: { sagyeok: 100 }, flags: ['news_constitution'], remove: [['q_rifle_bales', 1]] },
  },
  {
    id: 'ch1_07_scout', title: '개통 열차', chapter: 1, giver: 'oh_janghun', start: { x: 1500, y: 2122, r: 6 }, requires: ['ch1_06_steamer'],
    date: '1899-09-19', time: '06:30', weather: 'clear', checkpoint: [1, 4], retry: 'nextDay',
    card: '1899년 9월 18일, 경인철도 개통. 노량진에서 제물포까지 화륜거가 다닌다.',
    intro: L('오장헌: 현가가 말한 화차를 미리 보아 두어라. 차비는 넉넉히 주마.'),
    sum: '개통한 경인선을 타고 인천 하치장의 회사 화차를 살폈다.',
    begin: (g, M) => M.fx({ money: 80 }),
    spawn: [{ npc: 'deokgu', at: 'player', dx: 2, follow: 3 }],
    steps: [
      { type: 'reach', text: '9시 전에 노량진 정거장으로 가라', x: 2400, y: 1728, r: 15, miss: { at: '09:01', retry: '06:30', pos: [1500, 2140], step: 0 } },
      { type: 'buy', text: '매표소에서 3등 차표를 사라', itemId: 'ticket_train_3', shop: 'ticket_noryangjin', say: L('덕구: 3등 표가 사십 전이래요. 닭 두 마리 값이에요!'),
        miss: { at: '09:01', retry: '06:30', pos: [1500, 2140], step: 0 } },
      { type: 'ride', text: '오전 9시 열차로 인천까지 가라', line: 'train', from: 'noryangjin', to: 'jemulpo', miss: { at: '09:01', retry: '06:30', pos: [1500, 2140], step: 0 },
        trig: [{ delay: 10, test: (g) => g.player.vehicle?.vtype === 'train',
          say: L('덕구: (신문을 펼치고) "기차 소리는 우레 같고… 나는 새도 미처 따르지 못한다." 독립신문에 났어요!', '한길: 새가 못 따라오면, 사람은 더 못 따라오겠군.',
            '다카다: [일본어] 이 기관차는 바다 건너 미국에서 왔소. 나는 선로를 놓았을 뿐이오.', '이시중: 하룻길이 이제 두 시간도 안 걸리오. 좋은 세상 아니오?', '이시중: 그런데 형씨는 무슨 일로 인천에 가시오?'),
          choice: { q: '이시중이 묻는다.', opts: [{ t: '"마포 소금 장수요. 값 좀 보러 가오."', fx: { set: { suspicion: 'low' } } }, { t: '"그건 알 것 없소."', fx: { set: { suspicion: 'high' } } }] } }] },
      { type: 'act', text: '화물 하치장에서 회사 화차를 살펴라', x: 370, y: 1680, r: 4, label: '화차 문 살피기', secs: 2, flag: 'boxcar_inspected',
        onStart: { spawn: [{ role: 'soldier', faction: 'company', name: '회사 경비', x: 365, y: 1672, brain: 'patrol', route: [[350, 1672], [395, 1672]], weapon: 'w_club', n: 2, spread: 4, tag: 'm11_guard' }] },
        trig: [{ x: 370, y: 1680, r: 9, say: L('경비: 구경꾼은 비키시오. 회사 화차요.'), chat: true }] },
      { type: 'ride', text: '오후 1시 열차를 타고 오류동에서 내려라', line: 'train', from: 'jemulpo', to: 'oryu', hint: '표(오류동 3등 30전)가 없으면 검표 때 벌금을 문다.',
        miss: { at: '13:01', retry: '11:00', pos: [340, 1660], step: 4 }, start: (g) => g.sys.vehicles?.requestStop?.('train', 'oryu') },
      { type: 'reach', text: '솔고개 주막까지 걸어가라', x: 1560, y: 1720, r: 10 },
      { type: 'talk', text: '엄순례에게 알려라', npcId: 'eom_sunrye', say: L('엄순례: 기차 생기고 묵어 가는 손님이 반으로 줄었어. 이 주막도 저 쇳소리에 깔리게 생겼다.') },
    ],
    rewards: { xp: { cheose: 60 } },
  },
  {
    id: 'ch1_08_robbery', title: '솔고개 열차', chapter: 1, giver: 'oh_janghun', start: { x: 1548, y: 1722, r: 6 }, requires: ['ch1_07_scout'],
    date: '1899-09-22', time: '13:00', weather: 'cloudy', checkpoint: [1, 4, 6], retry: 'nextDay',
    intro: L('오장헌: 사람은 다치게 하지 마라. 우리가 원하는 건 회사의 궤짝이니라.'),
    sum: '솔고개 굽이에서 회사 열차를 세우고 철궤를 빼앗았다. 궤 속에는 장부와 판형이 있었다.',
    spawn: [
      ...['oh_janghun', 'ma_cheonbok', 'yu_seonnyeo', 'yunpal', 'bau'].map((id, i) => ({ npc: id, at: 'player', dx: -3 - i * 1.5, dy: i % 2 ? 2 : -2, follow: 4 + i })),
      ...[0, 3, 6].map((dx) => ({ vehicle: 'pony', x: 1524 + dx, y: 1798, angle: 0, tag: 'm12_horses', once: true })),
    ],
    steps: [
      { type: 'reach', text: '솔고개 굽이로 가라', x: 1560, y: 1808, r: 15 },
      { type: 'act', text: '통나무를 선로에 놓아라', pick: { x: 1590, y: 1832, r: 4, label: '통나무 들기', secs: 2 }, x: 1575, y: 1805, r: 4, label: '통나무 놓기', secs: 1, flag: 'logs_placed',
        say: L('바우: (통나무를 어깨에 메며) 하나는 내가 놓소.'), done: (g, M) => M.logs(1575, 1805) },
      { type: 'custom', text: '숨어서 열차를 기다려라', x: 1575, y: 1805, waitTo: '14:04', miss: { at: '14:15', retry: '13:00', pos: [1560, 1800], step: 2 },
        fn: (g, M) => M.trainStopped(1575, 1805, 60) || (!g.sys.vehicles && g.hour >= 14),
        done: (g, M) => { g.sfx('train_whistle'); M.later(1.2, () => g.sfx('train_whistle')); } },
      { type: 'kill', text: '회사 경비를 제압하라', tag: 'rail_guard', n: 4,
        onStart: { spawn: (g, M) => { const p = M.linePt('train', 938); return ['w_rifle', 'w_rifle', 'w_club', 'w_club'].map((w, i) => ({ role: i % 2 ? 'foreigner' : 'soldier', faction: 'company',
          name: i % 2 ? '일본인 경비' : '회사 경비', x: p.x + (i - 1.5) * 3, y: p.y + 4, brain: 'guard', hostile: true, weapon: w, tag: 'rail_guard' })); } } },
      { type: 'collect', text: '맨 끝 화차에서 철궤를 꺼내라', itemId: 'q_strongbox', n: 1, at: 'rail:946', label: '화차 문 열기', secs: 3, say: L('유선녀: 3등칸은 건드리지 마. 저기 탄 건 우리 같은 사람들이오.'),
        trig: [{ rail: 900, r: 7, say: L('윤팔: 1등칸 양반님네 회중시계 하나쯤은 괜찮잖소?'),
            choice: { q: '윤팔이 1등칸을 털려 한다.', opts: [{ t: '턴다', fx: { honor: -4, money: 200, items: [['v_watch', 2]] } }, { t: '말린다', fx: { honor: 3 } }] } },
          { rail: 946, r: 9, delay: 4, run: (g, M) => M.spawn([{ npc: 'takada', x: M.linePt('train', 946).x + 3, y: M.linePt('train', 946).y + 4, brain: 'idle' }]),
            say: L('다카다: [일본어] 쏘지 마시오. 나는 기술자요… 그 땅이 누구 땅이었는지는 묻지 않았소.'),
            choice: { q: '다카다를 어떻게 할까?', opts: [{ t: '살려 보낸다', fx: { honor: 5, flags: ['takada_spared'] }, run: (g, M) => M.hide('takada') },
              { t: '쏜다', fx: { flags: ['takada_killed'] }, run: (g, M) => M.execute('takada') }] } }],
        done: (g, M) => g.sfx('hit') },
      { type: 'custom', text: '철궤를 싣고 추격을 떨쳐 산채로 가라', x: 1500, y: 2140, fn: (g, M) => M.near(g.player, 1500, 2140, 40) && (g.sys.wanted?.level ?? 0) === 0,
        start: (g, M) => M.fx({ crime: 'robbery', wanted: [3, 400, 'robbery'] }),
        waves: [[(g) => (g.flags.suspicion === 'high' ? 10 : 30), (g, M) => {
          const n = g.flags.suspicion === 'high' ? 4 : 3, p = g.player;
          M.spawn([{ npc: 'lee_sijung', at: 'player', dx: 70, dy: -40, ride: 'jeju_horse', brain: 'police', hostile: true },
            { role: 'sungeom', faction: 'police', name: '기마 순검', at: 'player', dx: 75, dy: -30, n, spread: 5, ride: 'jeju_horse', brain: 'police', hostile: true, weapon: 'w_revolver', tag: 'm12_posse' },
            { npc: 'gu_manseok', at: 'player', dx: -70, dy: 40, brain: 'bandit', hostile: true }]);
          M.chat(L('이시중: 철궤를 내려놓으시오! 이번엔 놓치지 않소!')); void p;
        }]] },
    ],
    outro: L('마천복: 이 궤짝… 현가 놈 도장이 찍혔구먼.', '오장헌: 범을 잡으려면 범굴에 들어가야 하느니라.', '한길: (말없이 궤 속의 장부와 판형을 본다)'),
    rewards: { money: 1000, xp: { sagyeok: 100, gima: 100 }, items: [['q_ledger', 1], ['q_plate', 1]], remove: [['q_strongbox', 1]], flags: ['ch1_done'], advanceTo: '1899-09-28 08:00' },
    after: (g, M) => M.fx({ items: [has(g, 'w_rifle') ? ['a_rifle', 20] : ['w_rifle', 1]] }),
    endCard: '(엿새 뒤. 1899년 9월 28일, 전차가 다시 달렸다.)',
    epilogue: (g, M) => L(`신문팔이: 호외요! ${g.flags.takada_killed ? '경인철도 일본인 기사 피살!' : M.kills('company', 'rail_guard') ? '경인철도 화차 습격, 조선인 경비 ○○○ 사망!' : '경인철도 화차 습격, 사상자 없어!'}`,
      '(1장 끝. 철궤 속에는 돈보다 무거운 것이 들어 있었다.)'),
  },
  // ───────────────────────────── 낯선 이 (H.3)
  {
    id: 's1_brantley_1', title: '캘리포니아에서 온 사내', stranger: true, giver: 'brantley', start: { x: 3215, y: 752, r: 6 }, unlock: 'tram_resumed',
    sum: '전차 차고의 미국인 운전수와 맨주먹으로 붙고 술 한잔을 했다.',
    steps: [
      { type: 'talk', text: '전차 차고의 미국인에게 말을 걸어라', npcId: 'brantley', say: L('브랜틀리: [영어] 여기 가을은 원래 이리 짧소?', '브랜틀리: [영어] 운전수 자리는 내 자리요. 주먹으로 따지겠다면 받아 주지.') },
      { type: 'kill', text: '맨주먹으로 붙어라 (무기를 쓰면 진다)', tag: 'brawl_brantley', n: 1, fistOnly: 'brawl_brantley',
        start: (g, M) => { const b = M.npc('brantley'); if (b) { b.tags.add('brawl_brantley'); b.maxHp = b.hp = 120; M.brain(b, 'bandit', { target: g.player, weapon: 'fist' }); } } },
      { type: 'talk', text: '브랜틀리와 술 한잔하라', npcId: 'brantley', start: (g, M) => { const b = M.npc('brantley'); if (b) { b.tags.delete('brawl_brantley'); M.brain(b, 'idle'); } },
        say: L('브랜틀리: 고맙소, 친구. …[영어] 집에선 역마차를 몰았소. 여기선 쇠수레를 몰고. 둘 다 내 것은 아니었지.') },
    ],
    rewards: { items: [['a_revolver', 12]], xp: { muye: 40 }, honor: 2, flags: ['brantley_friend'] },
  },
  {
    id: 's3_muak_tiger', title: '무악재 범', stranger: true, giver: 'widow_hong', start: { x: 2185, y: 815, r: 6 }, requires: ['ch1_01_hunt'],
    sum: '무악재에서 사람 해친 범을 잡아 홍씨의 원을 풀었다.',
    steps: [
      { type: 'talk', text: '나무꾼 과부 홍씨의 이야기를 들어라', npcId: 'widow_hong', say: L('홍씨: 우리 그이가 땔나무 지고 무악재 넘다 안 돌아왔소. 지게만…') },
      { type: 'reach', text: '무악재로 가라', x: 2236, y: 600, r: 20, onStart: { spawn: [{ npc: 'jumak_muak_ju', x: 2205, y: 646 }] },
        trig: [{ x: 2205, y: 646, r: 14, say: L('무악재 주막 주인: 해 지면 무악재 넘지 마시오. 범이 사람 눈을 먼저 봐.'), chat: true }] },
      { type: 'collect', text: '찢긴 지게를 찾아라', itemId: 'q_torn_jige', n: 1, at: [2256, 588], label: '찢긴 지게 줍기' },
      { type: 'kill', text: '사람 해친 범을 잡아라', tag: 'tiger_muak', species: 'tiger', n: 1, lethal: true, onStart: { spawn: [{ animal: 'tiger', x: 2295, y: 600, tag: 'tiger_muak' }] } },
      { type: 'skin', text: '범 가죽을 벗겨라', species: 'tiger', n: 1 },
      { type: 'talk', text: '경무청 서리에게 현상을 받아라', npcId: 'gyeongmu_clerk', say: L('서리: 사람 해친 범이라. 방문(榜文)대로 현상을 내주겠소.'),
        need: (g) => !((g.sys.wanted?.level ?? 0) > 0 || (g.sys.wanted?.bounty ?? 0) > 0), needSay: L('서리: 현상금 붙은 몸으로 현상을 받겠다고? 그 빚부터 갚고 오시오.') },
    ],
    rewards: { money: 750, honor: 5, xp: { saengjon: 80 }, remove: [['q_torn_jige', 1]] },
  },
  {
    id: 's5_literacy', title: '글눈', stranger: true, giver: 'deokgu', start: { x: 1506, y: 2160, r: 6 }, unlock: 'deokgu_joined',
    intro: L('덕구: 아저씨, 글 몰라도 신문은 사요. 제가 읽어 드릴게요.'),
    sum: '덕구에게 자모를 배우고 모닥불 가에서 처음으로 제 이름을 썼다.',
    steps: [
      { type: 'collect', text: '신문 세 장을 구해 오라', itemId: 'q_newspaper', n: 3, hint: '신문팔이 아이에게 한 장 2전에 산다.' },
      { type: 'talk', text: '덕구에게 글을 배워라', npcId: 'deokgu',
        quiz: [{ q: '덕구: 이건 무슨 글자예요? "ㄱ"', opts: ['기역', '니은', '미음'], a: 0 }, { q: '덕구: "한" 자 첫소리는 뭐예요?', opts: ['ㄱ', 'ㅎ', 'ㄴ'], a: 1 },
          { q: '덕구: "한길"은 몇 글자예요?', opts: ['한 자', '두 자', '세 자'], a: 1 }],
        quizWrong: L('덕구: 아니에요, 다시 해 봐요!'), onDone: L('덕구: 기역, 니은… 아저씨 이름은 한, 길. 두 자예요.'), onDoneFx: { remove: [['q_newspaper', 3]] } },
      { type: 'act', text: '밤에 모닥불 가에서 이름을 써 보아라', x: 1500, y: 2152, r: 3, label: '막대로 이름 쓰기', secs: 2, flag: 's5_wrote',
        need: (g) => g.hour >= 20 || g.hour < 4, needText: '밤(20시~4시)이 되면 써 보자.',
        onDone: L('한길: (땅에 막대로 \'한길\'을 쓴다) …삐뚤군.', '덕구: 그래도 아저씨 손으로 쓴 거잖아요!') },
    ],
    rewards: { honor: 2, xp: { cheose: 40 }, flags: ['can_write_name'] },
  },
];

// ───────────────────────────── 길거리 사건 (H.4). check → 장소 키(쿨다운 단위) | null
const near = (g, x, y, r) => Math.hypot(g.player.x - x, g.player.y - y) <= r;
const night = (g) => g.hour >= 21 || g.hour < 4;
const CHECK_SPOTS = [[2560, 1085], [3255, 760], [2290, 760], [2415, 990], [3175, 1030], [3150, 430], [2340, 1394], [2730, 1572], [2760, 1452], [2035, 1286], [3440, 1376],
  [2400, 1722], [1850, 1775], [1280, 1770], [650, 1680], [335, 1640]];
const BULL_ROADS = { namdaemunro: [[2860, 795], [2810, 870], [2730, 950], [2640, 1020], [2560, 1085]], souimun_mapo: [[2415, 990], [2440, 1060], [2500, 1120], [2420, 1200], [2380, 1260], [2350, 1330], [2340, 1400]],
  yongsan: [[2560, 1085], [2600, 1180], [2680, 1290], [2750, 1380], [2760, 1455]] };

export const EVENTS = [
  { id: 'ev_pickpocket', every: 20, chance: 0.1,
    check: (g, M) => (g.hour >= 8 && g.hour < 18 ? M.placeAt(['market', 'ferry', 'station', 'tram_stop']) : null),
    begin: (g, M, ev) => {
      const [v, k] = M.spawn([{ role: 'villager', faction: 'civilian', name: '행인', at: 'player', dx: 9, dy: 4, brain: 'idle' },
        { role: 'villager', name: '소매치기 아이', child: true, faction: 'civilian', at: 'player', dx: 11, dy: 5, brain: 'flee', speedRun: 5, speedSprint: 5 }]);
      ev.kid = k; v?.say?.('도둑이야! 내 주머니!', 4);
    },
    tick: (g, M, ev) => {
      const k = ev.kid;
      if (k && (k.state === 'down' || k.state === 'dead') && !ev.asked) {
        ev.asked = 1;
        M.choice('아이가 떨어뜨린 주머니를 주웠다.', ['주인에게 돌려준다', '내가 갖는다', '못 본 척한다']).then((i) => {
          M.fx([{ honor: 2 }, { money: 20, honor: -2 }, {}][Math.max(0, i)] || {}); ev.end = 1; });
      }
      if (!ev.asked && (ev.t > 60 || !k || !M.near(k, g.player.x, g.player.y, 90))) { M.notify('소매치기가 골목으로 사라졌다'); return true; }
      return !!ev.end;
    } },
  { id: 'ev_torch_band', every: 120, chance: 0.05,
    check: (g, M) => (night(g) && (g.sys.wanted?.level ?? 0) === 0 && g.world?.isRoad?.(g.player.x, g.player.y) ? M.inRect([[1000, 1680, 1480, 1760], [1640, 1690, 2100, 1770]]) ?? (M.region() === 'gyeongin' ? 'gyeongin' : null) : null),
    begin: (g, M, ev) => {
      const p = g.player, a = Math.atan2(p.vy || 0.01, p.vx || 1), dx = Math.cos(a) * 120, dy = Math.sin(a) * 120;
      ev.band = M.spawn([{ role: 'bandit', faction: 'rival', name: '화적', at: 'player', dx, dy, n: 4, spread: 4, brain: 'idle', tag: 'ev_torch' },
        { role: 'porter', faction: 'civilian', name: '횃불잡이', at: 'player', dx: dx + 3, dy: dy + 3, n: 6, spread: 5, brain: 'idle', torch: true }]);
      for (const h of ev.band) M.goto(h, null, null, 10);
    },
    tick: (g, M, ev) => {
      const lead = ev.band[0];
      if (!lead || ev.t > 150) return true;
      if (!ev.asked && M.near(lead, g.player.x, g.player.y, 45)) {
        ev.asked = 1;
        M.choice('횃불 행렬이 다가온다. 화적 떼다.', ['숨는다', '싸운다', '통행세 10전을 낸다']).then((i) => {
          if (i === 2 && !g.sys.inventory?.spendMoney?.(10)) i = 1;
          for (const h of ev.band) i === 1 && h.faction === 'rival' ? M.brain(h, 'bandit', { target: g.player }) : M.goto(h, h.x - (g.player.x - h.x) * 3, h.y - (g.player.y - h.y) * 3);
          if (i !== 1) ev.t = 90;
        });
      }
      return ev.asked && ev.t > 150;
    } },
  { id: 'ev_checkpoint', every: 20, chance: 0.15,
    check: (g, M) => { const p = g.player, w = g.sys.combat?.weaponOf?.(p) || p.weapon; const armed = (w && w.kind && w.kind !== 'fist') || has(g, 'q_rifle_bales') || has(g, 'q_strongbox');
      return armed && !p.vehicle ? CHECK_SPOTS.findIndex(([x, y]) => near(g, x, y, 30)) : null; },
    begin: (g, M, ev) => { ev.cop = M.spawn([{ role: 'sungeom', faction: 'police', name: '순검', at: 'player', dx: 5, dy: 2, brain: 'idle' }])[0]; },
    tick: (g, M, ev) => {
      if (!ev.asked) {
        ev.asked = 1;
        M.say(L('순검: 무기 거두시오. 어디 가는 길이오?')).then(() => M.choice('순검이 길을 막았다.', ['무기를 넣는다', '뇌물 5전을 쥐여 준다', '달아난다'])).then((i) => {
          if (i === 0) g.sys.combat?.holster?.(g.player) ?? g.sys.combat?.equip?.(g.player, null);
          else if (i === 1 && g.sys.inventory?.spendMoney?.(5)) M.fx({ honor: -1 });
          else M.fx({ crime: 'trespass' });
          ev.t = 0; ev.end = 1;
        });
      }
      return ev.end && ev.t > 15;
    } },
  { id: 'ev_pack_bulls', every: 120, chance: 0.15,
    check: (g, M) => (g.hour >= 7 && g.hour < 18 ? Object.keys(BULL_ROADS).find((k) => M.nearLine(BULL_ROADS[k], 8)) ?? null : null),
    begin: (g, M, ev) => {
      ev.carts = M.spawn([0, 1, 2].map((i) => ROW('oxcart', 40 + i * 7, 0, Math.PI, { at: 'player', name: '짐소', driver: { role: 'porter', name: '짐소 몰이꾼' }, crowd: true })));
      for (const c of ev.carts) M.goto(c, g.player.x - 60, g.player.y, 0, 0.3);
    },
    tick: (g, M, ev) => {
      const c = ev.carts[0];
      if (!c || ev.t > 120) return true;
      if (!ev.asked && g.player.vehicle?.moveMode === 'horse' && M.near(c, g.player.x, g.player.y, 15)) {
        ev.asked = 1;
        M.choice('땔나무와 거름을 실은 짐소 행렬이 길을 막았다.', ['기다린다', '말로 밀고 간다']).then((i) => {
          if (i === 1) { M.fx({ honor: -1 }); const d = c.driver; if (d) { M.dismount(d); d.say?.('이보시오! 남의 소를!', 3); M.brain(d, 'bandit', { target: g.player, weapon: 'fist' }); } }
          ev.t = Math.max(ev.t, 90);
        });
      }
      return false;
    } },
  { id: 'ev_rail_sleeper', every: 120, chance: 0.2,
    check: (g, M) => { const mo = +String(g.flags.date || '').slice(5, 7), f = g.flags;
      return (g.hour >= 20 || g.hour < 4) && mo >= 6 && mo <= 9 && f.tram_running && (!f.tram_suspended || f.tram_resumed) && M.nearRail('tram', 60) ? 'sleeper' : null; },
    begin: (g, M, ev) => {
      const q = M.railAhead('tram', 45);
      ev.man = M.spawn([{ role: 'villager', faction: 'civilian', name: '잠든 사내', x: q.x, y: q.y, brain: 'idle' }])[0];
      ev.man?.knockDown?.(0, 0, 0, 9999);
      M.act({ ent: ev.man, label: '깨워서 길가로 옮기기', ev, run: () => { const m = ev.man; m.revive?.(m.hp || 50); m.x += 4; m.say?.('어이쿠, 고맙소. 시원해서 그만…', 3); M.fx({ honor: 1 }); ev.end = 1; } });
    },
    tick: (g, M, ev) => !!ev.end || !ev.man || !M.near(ev.man, g.player.x, g.player.y, 120) },
];

// ───────────────────────────── 도감·고정 문구 (K, G.6)
export const CODEX = [
  { id: 'money', title: '돈', text: "냥 체계에서는 1냥 = 10전 = 100푼(엽전 100닢)이고, 5냥이 1환(원)이었다. 그러니 경인선 운임 '1원 50전'의 전(1/100원)과 냥 체계의 전(1/10냥)은 값이 다르다. 이 게임은 셈을 쉽게 하려고 1원 = 10냥 = 100전으로 묶었다. [각색]" },
  { id: 'hwalbin', title: '활빈패', text: "주인공 무리는 스스로를 '경기 활빈패'라 부른다. 실제 활빈당은 1900년 2월 충남 내포에서 봉기해 1904년까지 활동한 무장 민중집단이다. 위조전과 열차 강도는 이 게임의 창작이다." },
  { id: 'scale', title: '축척', text: '지도는 실제 거리를 압축했다. 한성은 약 1/4, 경인선은 약 1/16, 한강 뱃길은 약 1/21이다.' },
  { id: 'stations', title: '경인선 역', text: '1899년 시각표의 역은 인천·축현·부평·소사·노량진이었다. 게임은 부평역을 줄이고 수시 정차역이던 오류동을 남겼다.' },
  { id: 'robbery', title: '열차 강도', text: '경인선에서 열차 강도가 실제로 일어났다는 기록은 없다. 서부극에 바치는 창작이다.' },
  { id: 'tram_open', title: '전차 개통일', text: '서울 전차는 1899년 5월에 개통했다. 세부 날짜는 5월 4일·17일·20일·26일 설이 갈린다. 게임은 초파일(5월 17일) 공개 운행을 골랐다.' },
  { id: 'tram_accident', title: '전차 사고', text: '1899년 5월 26일 무렵 종로에서 아이가 전차에 치여 숨지고, 성난 군중이 전차를 불태웠다. 게임은 아이를 그리지 않는다.' },
  { id: 'police_chase', title: '경무청 추격', text: '1896년 지방 순검이 폐지되어 경인가도에는 순검이 없었다. 총순이 한성 밖까지 쫓아오는 장면은 각색이다.' },
  { id: 'constitution', title: '대한국국제 호외', text: '대한국국제는 1899년 8월 17일 반포되었다. 이튿날 마포 거리의 호외 장면은 각색이다.' },
  { id: 'rifle', title: '양총 기종', text: "1899년 대한제국 군의 소총 기종은 자료가 엇갈린다. 게임의 '양총'은 단발 후장식 군용 소총 하나로 묶었다." },
];
