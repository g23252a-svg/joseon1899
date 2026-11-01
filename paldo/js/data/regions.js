// 고을(지역) 32곳. 좌표는 경위도(대략), 인구는 천 명 단위.
// agri 농업 / comm 상업 / def 성곽 — 현재값, *Max 는 기본 상한(건물로 늘어남)
// terrain: plain 평야 · river 강 · mountain 산 · coast 해안 · island 섬 (전투 보정)
// res: 특산물 — data/buildings.js 의 RESOURCES 참고
// trade: 교역 거점(의주 책문, 동래 왜관, 회령 개시, 개항장)
export const PROVINCES = {
  gyeonggi: { name: '경기', hanja: '京畿' },
  chungcheong: { name: '충청', hanja: '忠淸' },
  jeolla: { name: '전라', hanja: '全羅' },
  gyeongsang: { name: '경상', hanja: '慶尙' },
  gangwon: { name: '강원', hanja: '江原' },
  hwanghae: { name: '황해', hanja: '黃海' },
  pyeongan: { name: '평안', hanja: '平安' },
  hamgyeong: { name: '함경', hanja: '咸鏡' },
};

const R = (id, name, hanja, prov, lon, lat, pop, agri, comm, def, agriMax, commMax, defMax, terrain, coastal, res, extra = {}) => ({
  id, name, hanja, prov, lon, lat, pop, agri, comm, def, agriMax, commMax, defMax, terrain, coastal, res, ...extra,
});

export const REGIONS = [
  R('hanseong', '한성', '漢城', 'gyeonggi', 126.98, 37.57, 200, 260, 520, 600, 500, 999, 999, 'river', false, ['비단'], { desc: '도성. 사대문 안에 육조와 시전이 늘어선 나라의 심장.' }),
  R('gaeseong', '개성', '開城', 'gyeonggi', 126.55, 37.97, 120, 220, 480, 400, 450, 900, 800, 'plain', false, ['인삼'], { desc: '고려의 옛 도읍. 송상(松商)과 인삼으로 이름난 상업 도시.' }),
  R('suwon', '수원', '水原', 'gyeonggi', 126.98, 37.22, 110, 320, 260, 300, 600, 650, 999, 'plain', true, [], { trade: 'port', desc: '도성 남쪽의 관문. 바다 쪽 제물포 포구를 끼고 있다.' }),
  R('chungju', '충주', '忠州', 'chungcheong', 127.93, 36.99, 110, 300, 200, 300, 600, 500, 800, 'river', false, ['철'], { desc: '남한강 수운의 중심. 영남대로가 지나는 길목.' }),
  R('cheongju', '청주', '淸州', 'chungcheong', 127.49, 36.64, 100, 330, 180, 250, 600, 450, 700, 'plain', false, ['종이'], { desc: '내륙의 너른 들. 금속활자 직지를 찍은 고장.' }),
  R('gongju', '공주', '公州', 'chungcheong', 127.12, 36.46, 100, 300, 200, 350, 600, 500, 800, 'river', false, [], { desc: '금강을 낀 충청 감영. 공산성이 굳건하다.' }),
  R('hongju', '홍주', '洪州', 'chungcheong', 126.66, 36.6, 90, 300, 180, 200, 600, 500, 700, 'coast', true, ['소금'], { desc: '내포의 중심. 서해의 소금과 어물이 모인다.' }),
  R('jeonju', '전주', '全州', 'jeolla', 127.15, 35.82, 140, 420, 300, 350, 800, 650, 800, 'plain', false, ['종이'], { desc: '전라 감영, 왕실의 본향. 호남평야의 곡창.' }),
  R('namwon', '남원', '南原', 'jeolla', 127.39, 35.42, 90, 330, 160, 300, 600, 450, 800, 'mountain', false, ['목재'], { desc: '지리산 자락의 요충. 교룡산성이 지킨다.' }),
  R('naju', '나주', '羅州', 'jeolla', 126.71, 35.03, 130, 450, 220, 250, 850, 550, 700, 'river', true, ['면포'], { desc: '영산강 하류의 큰 고을. 서남해 바닷길을 쥐고 있다.' }),
  R('suncheon', '순천', '順天', 'jeolla', 127.49, 34.95, 90, 300, 200, 300, 550, 550, 800, 'coast', true, ['어물'], { desc: '남해 바다의 관문. 전라좌수영이 가까운 수군의 고장.' }),
  R('jeju', '제주', '濟州', 'jeolla', 126.53, 33.42, 50, 120, 120, 250, 300, 350, 600, 'island', true, ['말'], { desc: '바다 건너 탐라. 국마를 기르는 목장의 섬.' }),
  R('sangju', '상주', '尙州', 'gyeongsang', 128.16, 36.41, 110, 380, 200, 250, 700, 450, 700, 'plain', false, [], { desc: '경상도의 옛 감영. 낙동강 상류의 너른 들.' }),
  R('andong', '안동', '安東', 'gyeongsang', 128.73, 36.57, 100, 300, 180, 250, 550, 450, 700, 'mountain', false, ['종이'], { desc: '선비의 고장. 서원과 종가가 많다.' }),
  R('daegu', '대구', '大邱', 'gyeongsang', 128.6, 35.87, 120, 350, 300, 300, 650, 650, 800, 'plain', false, ['약재'], { desc: '경상 감영과 약령시. 영남의 한가운데.' }),
  R('gyeongju', '경주', '慶州', 'gyeongsang', 129.22, 35.86, 100, 300, 240, 250, 550, 550, 700, 'plain', true, ['유적'], { desc: '천년 신라의 서울. 옛 유적이 명망을 높인다.' }),
  R('jinju', '진주', '晉州', 'gyeongsang', 128.08, 35.18, 110, 350, 250, 450, 650, 550, 900, 'river', true, ['비단'], { desc: '남강 벼랑 위의 진주성. 영남 서부의 방패.' }),
  R('dongnae', '동래', '東萊', 'gyeongsang', 129.08, 35.2, 80, 200, 300, 350, 400, 700, 800, 'coast', true, ['어물'], { trade: 'wae', desc: '부산포와 왜관. 바다 건너 일본과 마주한 관문.' }),
  R('wonju', '원주', '原州', 'gangwon', 127.95, 37.34, 80, 250, 160, 250, 450, 400, 700, 'mountain', false, ['목재'], { desc: '강원 감영. 치악산 아래 영동과 영서를 잇는다.' }),
  R('chuncheon', '춘천', '春川', 'gangwon', 127.73, 37.88, 70, 220, 140, 250, 400, 350, 700, 'mountain', false, ['목재'], { desc: '소양강과 북한강이 만나는 산골 분지.' }),
  R('gangneung', '강릉', '江陵', 'gangwon', 128.9, 37.75, 80, 220, 180, 250, 400, 450, 700, 'coast', true, ['어물'], { desc: '대관령 너머 동해의 큰 고을. 경포대의 달.' }),
  R('hoeyang', '회양', '淮陽', 'gangwon', 127.62, 38.7, 50, 150, 100, 250, 300, 300, 700, 'mountain', false, ['약재'], { desc: '금강산 어귀. 철령을 넘어 북관으로 가는 길.' }),
  R('haeju', '해주', '海州', 'hwanghae', 125.72, 38.04, 90, 320, 200, 250, 600, 500, 700, 'coast', true, ['소금'], { desc: '황해 감영. 구월산을 등지고 서해를 바라본다.' }),
  R('hwangju', '황주', '黃州', 'hwanghae', 125.85, 38.62, 80, 300, 160, 250, 600, 400, 700, 'plain', false, ['철'], { desc: '재령평야의 곡창, 평양으로 가는 길목.' }),
  R('pyongyang', '평양', '平壤', 'pyeongan', 125.75, 39.03, 160, 330, 420, 500, 600, 850, 900, 'river', false, ['면포'], { desc: '대동강의 서경. 북방 제일의 대도회.' }),
  R('anju', '안주', '安州', 'pyeongan', 125.66, 39.6, 90, 280, 220, 350, 500, 500, 800, 'river', false, [], { desc: '청천강 가의 병영. 서북 방어의 요충.' }),
  R('uiju', '의주', '義州', 'pyeongan', 124.6, 40.2, 70, 200, 300, 400, 400, 700, 800, 'coast', true, [], { trade: 'chaek', desc: '압록강 건너 대륙으로 가는 문. 책문후시가 열린다.' }),
  R('ganggye', '강계', '江界', 'pyeongan', 126.6, 40.97, 50, 150, 140, 300, 300, 350, 700, 'mountain', false, ['인삼'], { desc: '깊은 산골. 강계 산삼과 북방 진보(鎭堡).' }),
  R('hamheung', '함흥', '咸興', 'hamgyeong', 127.53, 39.92, 110, 300, 220, 350, 550, 500, 800, 'coast', true, ['어물'], { trade: 'port2', desc: '함경 감영. 태조의 고향, 동해의 원산 포구를 끼고 있다.' }),
  R('gapsan', '갑산', '甲山', 'hamgyeong', 128.3, 41.07, 40, 120, 100, 300, 250, 300, 700, 'mountain', false, ['철'], { desc: '개마고원의 험지. 귀양지로 이름난 오지.' }),
  R('gilju', '길주', '吉州', 'hamgyeong', 129.33, 40.96, 50, 150, 120, 300, 300, 300, 700, 'coast', true, ['말'], { desc: '북관의 길목. 마천령 너머 동해안.' }),
  R('hoeryeong', '회령', '會寧', 'hamgyeong', 129.75, 42.42, 40, 140, 120, 400, 300, 300, 800, 'river', false, ['말'], { trade: 'buk', desc: '두만강 가의 육진. 북관 개시가 열린다.' }),
];

export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

// 바다 건너 잇는 길(지도 인접 계산에 더해진다)
export const SEA_LINKS = [
  ['jeju', 'naju'],
  ['jeju', 'suncheon'],
];
// 보로노이가 놓치는 육로(동해안 길, 압록강 길)
export const LAND_LINKS = [
  ['gangneung', 'hoeyang'],
  ['uiju', 'ganggye'],
];
