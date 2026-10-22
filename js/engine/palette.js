// 수묵채색 팔레트와 글꼴. 모든 그리기 코드는 여기 색을 쓴다.
// 원칙: 한지 바탕 + 먹(농·중·담) + 아주 옅은 채색. 채도 높은 색은 단청·낙관·피처럼 '찍는' 곳에만.

export const PAL = {
  // 바탕
  paper: '#efe6d2', // 한지
  paperDeep: '#e2d5b8',
  paperShade: '#d4c4a2',
  // 먹
  ink: '#1d1b18', // 농묵
  ink2: '#4a453d', // 중묵
  ink3: '#8a8272', // 담묵
  inkWash: 'rgba(29,27,24,0.12)',
  // 물
  sea: '#7d9aa3', // 쪽빛 바다
  seaDeep: '#5f7f8b',
  river: '#8fb0b3',
  shallow: '#b5cbc4',
  mud: '#b9ab8e', // 갯벌
  sand: '#e1d3ad',
  // 땅
  grass: '#cdd2a6',
  meadow: '#c3ca98',
  forest: '#9fae84',
  treeDark: '#5f6f4e',
  treeLight: '#8a9b6c',
  pine: '#4f6248', // 소나무
  mountain: '#bdb393',
  rock: '#9a9384',
  paddy: '#c2cf98', // 논 (여름)
  paddyWater: '#a9c2b0',
  dike: '#a7a27c', // 논둑
  field: '#d6c89c', // 밭
  furrow: '#b9a97a',
  // 길·마을
  road: '#ddcfac',
  mainRoad: '#d6c59e',
  street: '#dacbaa',
  yard: '#e0d4b4',
  rail: '#5a524a',
  sleeper: '#7b6a55',
  // 건물
  wallStone: '#a9a294',
  wallTop: '#8a8478',
  roofTile: '#4e5a5e', // 기와 회청
  roofTileEdge: '#2f383b',
  roofThatch: '#c2a874', // 초가
  roofThatchEdge: '#8d7448',
  timber: '#7a5a3c',
  brick: '#9b5b47', // 양관 벽돌
  whiteWall: '#ece5d3',
  // 사람·옷
  white: '#efeadf',
  // 강조 (찍듯이)
  seal: '#a8322a', // 낙관·단청 적
  dancheongGreen: '#3f7a63',
  gold: '#b08d3c',
  blood: '#7a1e16',
  // 밤·날씨
  night: '#1b2a3a',
  dusk: '#c46a3a',
  rain: 'rgba(90,110,120,0.35)',
  fog: 'rgba(230,226,215,0.5)',
  // 스펙 B.2 추가 키
  lantern: '#f2b85b',
  dawn: '#e8c9a0',
  paddyRipe: '#cfc77e',
  reed: '#b8b089',
  slate: '#6c6f73',
  jpRoof: '#3e4447',
  cnBrick: '#7c7a76',
  sail: '#d4a64a',
  tiger: '#c98a3c',
  uniform: '#2b2d33',
  armyCoat: '#2c3550',
  jade: '#d8e3dc',
  jangot: '#6b8a5e',
  peddlerHat: '#c9b27a',
  tram: '#7a3b2e',
  coach1: '#2f3a5a',
  coach2: '#9a7a3a',
  coach3: '#6b5a48',
  ragged: '#8a7f62', // 해진 회갈 (수적·화적 옷)
};

/** 스펙 B.3: 세력은 작은 강조(띠·두건·완장)와 미니맵 점으로만 구분한다. 적대 표시는 색이 아니라 머리 위 붉은 낙관. */
export const FACTION_COLOR = {
  army: '#a8322a',
  police: '#b08d3c',
  guild: '#7a913b',
  hunter: '#427f39',
  pirate: '#317752',
  company: '#2e757a',
  gang: '#3c679f',
  foreign: '#5c5095',
  bounty: '#70447e',
  rival: '#8d356d',
  civilian: null,
};

export const FONT = {
  body: '"Gowun Batang", "Batang", "AppleMyungjo", serif',
  display: '"Song Myung", "Gowun Batang", "Batang", serif',
  brush: '"Nanum Brush Script", "Song Myung", cursive',
};
