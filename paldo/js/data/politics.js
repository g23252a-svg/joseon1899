// 정치: 세력 집단(붕당·계층)과 법령. 빅토리아식 '지지도·영향력' 모델을 단순화했다.
// 지지도(-100~100)는 매 턴 목표치로 다가가고, 영향력(%)은 법령·기술로 바뀐다.
export const IGS = {
  sarim: { name: '사림', hanja: '士林', color: '#3f5f7a', desc: '성리학을 받드는 지방 선비들. 서원과 상소로 조정을 움직인다.',
    good: '學 +10%', bad: '상소가 빗발친다: 名 감소, 장수 충성 하락' },
  hunchuk: { name: '훈척', hanja: '勳戚', color: '#7a3b5a', desc: '공신과 왕실 외척. 권세와 특권을 지키려 한다.',
    good: '정통성 +1/턴', bad: '반정 음모: 정통성 하락, 장수 이탈 위험' },
  muban: { name: '무반', hanja: '武班', color: '#8a4b2a', desc: '무과 출신 장수와 군영. 군비와 전공을 바란다.',
    good: '모든 고을 훈련 +2/턴', bad: '군란: 훈련도 하락, 병력 이탈' },
  sangin: { name: '상인', hanja: '商人', color: '#a07a1a', desc: '경강상인·송상·보부상. 자유로운 장사를 원한다.',
    good: '錢 +10%', bad: '철시(가게를 닫음): 錢 -20%' },
  nongmin: { name: '농민', hanja: '農民', color: '#5a7a2a', desc: '나라의 근본. 세금과 군역이 가벼워지길 바란다.',
    good: '米 +10%, 민심 +', bad: '민란 위험이 크게 오른다' },
  gaehwa: { name: '개화파', hanja: '開化派', color: '#2a6a7a', desc: '바다 건너 문물을 배워 나라를 바꾸자는 젊은 관료들.',
    good: '學 +10%, 錢 +5%', bad: '정변 음모: 정통성 하락', req: 'gaehang' },
};

// 법령: 각 범주에서 하나를 고른다. ig = 지지도 목표치 변화, clout = 영향력 변화, eff = 효과
export const LAWS = {
  tax: { name: '조세', hanja: '租稅', options: [
    { id: 'gongnap', name: '공납·전세', desc: '토산물을 그대로 바친다. 양반과 훈척은 좋아하나 백성이 괴롭다.', ig: { sarim: 10, hunchuk: 10, nongmin: -15, sangin: -5 }, eff: {} },
    { id: 'daedong', name: '대동법', req: 'daedong', desc: '공물을 쌀로 고르게. 錢·米 +5%', ig: { nongmin: 15, sangin: 10, sarim: -10, hunchuk: -10 }, eff: { goldMul: 0.05, riceMul: 0.05 } },
    { id: 'jise', name: '지세 개혁', req: 'gabo', desc: '땅값에 따라 돈으로 걷는다. 錢 +25%, 米 -5%', ig: { sangin: 15, gaehwa: 15, nongmin: 5, sarim: -20, hunchuk: -15 }, eff: { goldMul: 0.25, riceMul: -0.05 } },
  ] },
  army: { name: '군역', hanja: '軍役', options: [
    { id: 'yangin', name: '양인개병', desc: '모든 양인이 군역을 진다. 징병량 +20%, 징병 때 민심 하락 큼', ig: { nongmin: -15, muban: 10 }, eff: { recruitMul: 0.2, recruitLoyal: 1.3 } },
    { id: 'gyunyeok', name: '균역법', req: 'gyunyeok', desc: '군포를 반으로. 징병 민심 하락 -30%, 錢 -5%', ig: { nongmin: 15, sarim: -5 }, eff: { goldMul: -0.05, recruitLoyal: 0.7 } },
    { id: 'mobyeong', name: '모병제', req: 'sinsik', desc: '돈을 주고 직업 군인을 뽑는다. 징병 비용 ×1.5, 민심 하락 없음, 신병 훈련 +20', ig: { nongmin: 20, muban: 10, gaehwa: 10 }, eff: { recruitCost: 0.5, recruitLoyal: 0, recruitTrain: 20 } },
  ] },
  status: { name: '신분', hanja: '身分', options: [
    { id: 'strict', name: '엄격한 신분제', desc: '반상의 구별을 지킨다. 인재 탐색 -20%', ig: { sarim: 15, hunchuk: 10, nongmin: -10 }, eff: { search: -0.2 } },
    { id: 'seoeol', name: '서얼허통', req: 'silhak', desc: '서얼에게 벼슬길을 연다. 學 +5%', ig: { sarim: -5, nongmin: 5, sangin: 5 }, eff: { sciMul: 0.05 } },
    { id: 'abolish', name: '신분제 폐지', req: 'gabo', desc: '양반·상민·천민을 없앤다. 탐색 +50%, 學 +10%, 민심 +5', ig: { nongmin: 25, gaehwa: 20, sarim: -30, hunchuk: -25 }, clout: { nongmin: 10, sarim: -10 }, eff: { search: 0.5, sciMul: 0.1, loyalAll: 5 } },
  ] },
  learning: { name: '학문', hanja: '學問', options: [
    { id: 'neo', name: '성리학 정통', desc: '주자의 가르침을 받든다. 名 +10%', ig: { sarim: 15, gaehwa: -15 }, eff: { presMul: 0.1 } },
    { id: 'silhak', name: '실학 장려', req: 'silhak', desc: '이용후생의 학문. 學 +20%', ig: { sarim: -5, sangin: 5, gaehwa: 5 }, eff: { sciMul: 0.2 } },
    { id: 'west', name: '서학 수용', req: 'seohak', desc: '서양 학문을 받아들인다. 學 +40%', ig: { sarim: -25, gaehwa: 20, hunchuk: -10 }, eff: { sciMul: 0.4 } },
  ] },
  commerce: { name: '상업', hanja: '商業', options: [
    { id: 'guild', name: '시전 특권', desc: '금난전권으로 시전 상인을 보호. ', ig: { hunchuk: 10, sangin: -5 }, eff: {} },
    { id: 'tonggong', name: '신해통공', req: 'sangpyeong', desc: '난전을 허락한다. 錢 +15%', ig: { sangin: 15, hunchuk: -10 }, clout: { sangin: 5 }, eff: { goldMul: 0.15 } },
    { id: 'free', name: '자유무역', req: 'gaehang', desc: '관세만 걷고 문을 연다. 錢 +20%, 교역 +50%', ig: { sangin: 20, gaehwa: 10, nongmin: -5, sarim: -10 }, clout: { sangin: 5 }, eff: { goldMul: 0.2, trade: 0.5 } },
  ] },
  foreign: { name: '대외', hanja: '對外', options: [
    { id: 'closed', name: '쇄국', desc: '문을 걸어 잠근다. 교역 -50%, 정통성 +', ig: { sarim: 10, gaehwa: -20 }, eff: { trade: -0.5, legitDrift: 0.3 } },
    { id: 'sadae', name: '사대교린', desc: '큰 나라는 섬기고 이웃과는 사귄다.', ig: {}, eff: {} },
    { id: 'open', name: '개항', req: 'gaehang', desc: '항구를 연다. 교역 ×2, 學 +10%', ig: { sangin: 15, gaehwa: 20, sarim: -20 }, clout: { gaehwa: 10 }, eff: { trade: 1.0, sciMul: 0.1 } },
  ] },
  crown: { name: '왕권', hanja: '王權', options: [
    { id: 'sinkwon', name: '신권 중심', desc: '재상과 신하가 나라를 이끈다. 장수 충성 +3', ig: { sarim: 10, hunchuk: -5 }, eff: { loyaltyAll: 3 } },
    { id: 'tangpyeong', name: '탕평', req: 'tangpyeong', desc: '붕당을 고루 쓴다. 모든 세력 지지 +5', ig: { sarim: 5, hunchuk: 5, muban: 5, sangin: 5, nongmin: 5, gaehwa: 5 }, eff: {} },
    { id: 'absolute', name: '전제 황권', req: 'gabo', desc: '황제가 군권·입법권을 쥔다. 정통성 +, 錢 +5%', ig: { hunchuk: 15, muban: 10, sarim: -10, gaehwa: -10 }, eff: { goldMul: 0.05, legitDrift: 0.5 } },
  ] },
};

export const TAX_LEVELS = [
  { id: 0, name: '가볍게', mul: 0.8, ig: { nongmin: 12, sangin: 8 }, loyal: 6 },
  { id: 1, name: '보통', mul: 1.0, ig: {}, loyal: 0 },
  { id: 2, name: '무겁게', mul: 1.25, ig: { nongmin: -15, sangin: -10 }, loyal: -8 },
  { id: 3, name: '가혹하게', mul: 1.5, ig: { nongmin: -30, sangin: -20, sarim: -5 }, loyal: -18 },
];

export const DEFAULT_LAWS = { tax: 'gongnap', army: 'yangin', status: 'strict', learning: 'neo', commerce: 'guild', foreign: 'sadae', crown: 'sinkwon' };
export const BASE_CLOUT = { sarim: 30, hunchuk: 20, muban: 15, sangin: 10, nongmin: 25, gaehwa: 0 };
export const LAW_COST = 80; // 名
