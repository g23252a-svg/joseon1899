// 이름 있는 인물 (스펙 I.1) + 미션이 부르는 기능 인물 (I.2 중 미션에 필요한 사람).
// 형식: ARCHITECTURE §7 + essential/fleeAt(§10) + 추가 필드
//   appear: 이 조건이 참일 때부터 보인다(그 전엔 숨김). 조건 문법은 missions.js cond(): 'flag' | '!flag' | 'done:id' | 'start:id' | 'avail:id'
//   spots:  [[조건, x, y], ...] 조건이 참인 마지막 자리로 옮긴다(화면 밖일 때 순간 이동). 없으면 x, y.
//   gone:   이 조건이 참이면 다시 숨긴다.  route: patrol 두뇌 경로.  child: 아이.  dialogAfter: [[조건, 대사]] 조건 뒤 평소 대사 추가.
// 모두 허구 인물이다.

export const NPCS = [
  { id: 'oh_janghun', name: '오장헌', hanja: '吳章憲', age: 47, role: 'gang', faction: 'gang', x: 1500, y: 2122, brain: 'idle', essential: true,
    look: { coat: '#e3ddd0', trim: '#3c679f', hat: 'gat' }, hidden: true, appear: 'prologue_done',
    spots: [['avail:ch1_05_gama', 1548, 1722], ['avail:ch1_08_robbery', 1548, 1722]],
    dialog: ['의(義)는 손해 보는 쪽에 서는 것이니라.', '율도국이 어디 섬에만 있겠느냐.'], tags: ['story'] },
  { id: 'ma_cheonbok', name: '마천복', hanja: '馬千福', age: 49, role: 'gang', faction: 'gang', x: 1488, y: 2140, brain: 'merchant', essential: true,
    look: { coat: '#b9a582', trim: '#5a4630', hat: 'paeraengi' }, shop: 'fence_camp', hidden: true, appear: 'prologue_done',
    dialog: ['셈이 맞아야 길이 열리는 법이여.', '장물은 사흘 묵히면 값이 반이구먼.'], tags: ['story'] },
  { id: 'yu_seonnyeo', name: '유선녀', hanja: '柳善女', age: 32, role: 'gang', faction: 'gang', x: 1515, y: 2140, brain: 'idle', essential: true,
    look: { coat: '#e6dfd0', trim: '#7a2e24', hat: 'headband', gender: 'f' }, hidden: true, appear: 'yu_joined',
    dialog: ['말로 배부르면 다 살았겄소.', '활줄은 비 오기 전에 갈아야 허요.'], tags: ['story'] },
  { id: 'choi_mandeuk', name: '최만득', hanja: '崔萬得', age: 66, role: 'hunter', faction: 'gang', x: 1512, y: 2150, brain: 'idle', essential: true,
    look: { coat: '#8f8466', trim: '#427f39', hat: 'headband', hair: '#9a948a' }, hidden: true, appear: 'prologue_done',
    dialog: ['철길 공사 소리 나믄 짐승이 십 리를 물러나.', '범은 사람 눈을 먼저 봐.'], tags: ['story'] },
  { id: 'deokgu', name: '덕구', hanja: '德九', age: 13, child: true, role: 'villager', faction: 'gang', x: 2770, y: 1440, brain: 'wander', essential: true,
    look: { coat: '#e9e2d0', trim: '#8a8172', hat: 'topknot' },
    spots: [['done:pro01_ferry', 2950, 800], ['deokgu_joined', 1506, 2160]],
    dialog: ['아저씨, 신문 한 장 사요! 이 전짜리!', '전기거는 손 들면 서요!'], tags: ['story'] },
  { id: 'eom_sunrye', name: '엄순례', hanja: '嚴順禮', age: 54, role: 'woman', faction: 'civilian', x: 1560, y: 1720, brain: 'merchant', essential: true,
    look: { coat: '#ece4d2', trim: '#6b5a48', hat: 'none', gender: 'f' }, shop: 'jumak_solgogae',
    dialog: ['밥값은 외상이어도 목숨값은 외상이 없다.'], dialogAfter: [['rail_open', '기차 생기고 묵는 손이 반이여.']], tags: ['story'] },
  { id: 'chilbok', name: '칠복', age: 9, child: true, role: 'villager', faction: 'civilian', x: 1572, y: 1720, brain: 'wander', wanderR: 8,
    dialog: ['국밥 나왔어유!'], tags: ['story'] },
  { id: 'lee_sijung', name: '이시중', hanja: '李時中', age: 29, role: 'chongsun', faction: 'police', x: 2715, y: 600, brain: 'patrol', essential: true,
    route: [[2715, 600], [2715, 780]], weapon: 'w_revolver', look: { coat: '#2b2d33', trim: '#b08d3c', hat: 'cap' },
    dialog: ['법대로 하겠소.', '제복은 사람을 바꾸지 않소. 사람이 제복을 입을 뿐이오.'], tags: ['story'] },
  { id: 'hyeon_deokman', name: '현덕만', hanja: '玄德萬', age: 44, role: 'merchant', faction: 'civilian', x: 420, y: 1634, brain: 'idle', essential: true,
    look: { coat: '#3d3a40', trim: '#cfc6b0', hat: 'western' }, hidden: true, appear: 'start:ch1_05_gama',
    dialog: ['세상이 바뀌는데 올라타셔야지요.', '셈은 깔끔하게 하시지요.'], tags: ['story'] },
  { id: 'gu_manseok', name: '구만석', hanja: '具萬石', age: 47, role: 'bounty_hunter', faction: 'bounty', x: 2300, y: 1350, brain: 'idle', essential: true,
    weapon: 'w_matchlock', look: { coat: '#4a4038', trim: '#70447e', hat: 'paeraengi' }, hidden: true, appear: 'never',
    dialog: ['현상금 붙은 머리만 잡소.'], tags: ['story'] },
  { id: 'bang_chilseong', name: '방칠성', hanja: '方七星', nick: '불여우', age: 39, role: 'bandit_boss', faction: 'rival', x: 2390, y: 2190, brain: 'idle', essential: true, fleeAt: 0.5,
    weapon: 'w_matchlock', look: { coat: '#6b4a3a', trim: '#8d356d', hat: 'headband' }, hidden: true, appear: 'never',
    dialog: ['돌쇠야, 이름 바꾼다고 근본이 바뀌더냐?'], tags: ['story'] },
  { id: 'brantley', name: '새뮤얼 브랜틀리', age: 36, role: 'foreigner', faction: 'foreign', x: 3215, y: 752, brain: 'idle', hp: 120,
    look: { coat: '#4a3f36', trim: '#cfc6b0', hat: 'western', hair: '#8a6a44' }, hidden: true, appear: 'tram_resumed',
    dialog: ['[영어] 여기 가을은 원래 이리 짧소?', '고맙소, 친구.'], tags: ['story'] },
  { id: 'takada', name: '다카다 겐조', age: 41, role: 'foreigner', faction: 'foreign', x: 2385, y: 1712, brain: 'idle', essential: true,
    look: { coat: '#2f3a5a', trim: '#cfc6b0', hat: 'western', hair: '#1c1a17' }, hidden: true, appear: 'takada_spared',
    dialog: ['[일본어] 선로는 곧아야 하오. 사람 일은 그렇지 않지만.'], tags: ['story'] },
  { id: 'song_aesun', name: '송애순', hanja: '宋愛順', age: 20, role: 'woman', faction: 'civilian', x: 3000, y: 889, brain: 'idle',
    look: { coat: '#f0ebe0', trim: '#6b8a5e', hat: 'jangot', gender: 'f' }, dialog: ['다친 데 있으면 숨기지 마세요.'], tags: ['story'] },
  { id: 'yunpal', name: '윤팔', hanja: '尹八', age: 24, role: 'gang', faction: 'gang', x: 1525, y: 2155, brain: 'wander', essential: true,
    weapon: 'w_matchlock', hidden: true, appear: 'prologue_done', dialog: ['총은 쏘라고 있는 거요.'], tags: ['story'] },
  { id: 'bau', name: '바우', age: 30, role: 'gang', faction: 'gang', x: 1530, y: 2135, brain: 'wander', essential: true,
    look: { coat: '#9a9078', trim: '#7a2e24', hat: 'headband' }, hidden: true, appear: 'prologue_done', dialog: ['…', '무거운 건 내가 들지.'], tags: ['story'] },
  { id: 'no_seobang', name: '노 서방', age: 52, role: 'villager', faction: 'gang', x: 1484, y: 2150, brain: 'idle',
    hidden: true, appear: 'prologue_done', dialog: ['솥이 비면 산채도 빈 거여.'], tags: ['story'] },
];

// 미션이 부르는 기능 인물 (I.2). spawner 가 같은 id 로 이미 두었으면 그것을 쓰고, 없으면 미션이 이 정의로 만든다.
export const EXTRAS = [
  { id: 'sagong_noryang', name: '노량진 사공', role: 'porter', faction: 'civilian', x: 2730, y: 1574, brain: 'idle', dialog: ['관선이라 삯은 없소.'] },
  { id: 'mabang_ju', name: '마방 주인', role: 'merchant', faction: 'civilian', x: 3160, y: 800, brain: 'merchant', shop: 'stable_dongdaemun', dialog: ['수놈끼리 붙이면 물어뜯소.'] },
  { id: 'sosa_gaekju', name: '소사 객주 사람', role: 'merchant', faction: 'civilian', x: 1265, y: 1722, brain: 'idle', dialog: ['쌀은 제값에 받아 가시오.'] },
  { id: 'gama_bearers', name: '가마꾼 우두머리', role: 'porter', faction: 'civilian', x: 1300, y: 1723, brain: 'idle', dialog: ['나리, 주막마다 목을 축여야 다리가 갑니다요.'] },
  { id: 'bupyeong_saryeong', name: '부평 관아 사령', role: 'sungeom', faction: 'police', x: 945, y: 1678, brain: 'guard', look: { coat: '#4a4a52', hat: 'gat' }, dialog: ['요즘 길에 화적이 많아서.'] },
  { id: 'gyeongmu_clerk', name: '경무청 서리', role: 'yangban', faction: 'civilian', x: 2706, y: 722, brain: 'idle', dialog: ['현상금 일이면 여기서 보시오.'] },
  { id: 'widow_hong', name: '과부 홍씨', role: 'woman', faction: 'civilian', x: 2185, y: 815, brain: 'idle', dialog: ['지게만 돌아왔소…'] },
  { id: 'motorman_jp', name: '전차 운전수', role: 'foreigner', faction: 'foreign', x: 2975, y: 788, brain: 'idle', look: { coat: '#2b2d33', hat: 'cap' }, dialog: ['[일본어] 비키시오.'] },
  { id: 'conductor_kr', name: '전차 차장', role: 'villager', faction: 'civilian', x: 2978, y: 794, brain: 'idle', look: { coat: '#2f3a5a', hat: 'cap' }, dialog: ['표 사시오!'] },
  { id: 'sampan_sagong', name: '삼판 사공', role: 'porter', faction: 'civilian', x: 1690, y: 1110, brain: 'driver', dialog: ['마포는 마포요.'] },
  { id: 'p2_pickpocket', name: '소매치기 아이', child: true, role: 'villager', faction: 'civilian', x: 2885, y: 790, brain: 'flee', speedRun: 5.0, speedSprint: 5.0, dialog: ['…'] },
  { id: 'jumak_muak_ju', name: '무악재 주막 주인', role: 'villager', faction: 'civilian', x: 2205, y: 646, brain: 'idle', dialog: ['해 지면 무악재 넘지 마시오. 범이 사람 눈을 먼저 봐.'] },
];

export const NPC_DEFS = Object.fromEntries([...NPCS, ...EXTRAS].map((d) => [d.id, d]));
