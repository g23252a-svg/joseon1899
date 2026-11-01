// 건물·위업·특산물·특기·보물
// eff 키: goldMul riceMul sciMul(비율) / gold rice sci pres(턴당 정수) / commMax agriMax defMax / loyal(민심 목표치)
//         recruitMul trainBonus growth plague drought defBonus naval rebel rail
export const BUILDINGS = {
  market: { name: '장시', hanja: '場市', cost: 450, turns: 2, desc: '닷새마다 서는 장. 상업 상한 +150, 錢 +15%', eff: { commMax: 150, goldMul: 0.15 } },
  reservoir: { name: '저수지', hanja: '貯水池', cost: 450, turns: 2, req: 'nongsa', desc: '보와 제언. 농업 상한 +150, 米 +15%, 가뭄 피해 절반', eff: { agriMax: 150, riceMul: 0.15, drought: 0.5 } },
  hyanggyo: { name: '향교', hanja: '鄕校', cost: 400, turns: 2, desc: '고을의 관학. 學 +3, 민심 +3', eff: { sci: 3, loyal: 3 } },
  seowon: { name: '서원', hanja: '書院', cost: 700, turns: 3, req: 'gabin', desc: '선비가 모이는 사학. 學 +6, 名 +1, 사림 지지 +', eff: { sci: 6, pres: 1 }, ig: { sarim: 2 } },
  barracks: { name: '병영', hanja: '兵營', cost: 600, turns: 2, desc: '징병량 +30%, 매 턴 훈련 +2', eff: { recruitMul: 0.3, trainBonus: 2 } },
  beacon: { name: '봉수대', hanja: '烽燧臺', cost: 300, turns: 1, desc: '횃불과 연기로 위급을 알린다. 수비 전투력 +10%', eff: { defBonus: 0.1 } },
  navalbase: { name: '수군진', hanja: '水軍鎭', cost: 750, turns: 3, req: 'panok', coastal: true, desc: '판옥선을 매어 두는 진. 수전 +30%, 수비 +10%', eff: { naval: 0.3, defBonus: 0.1 } },
  clinic: { name: '의원', hanja: '醫院', cost: 450, turns: 2, req: 'euibang', desc: '인구 증가 +30%, 역병 피해 절반', eff: { growth: 0.3, plague: 0.5 } },
  mine: { name: '광산', hanja: '鑛山', cost: 600, turns: 2, resReq: ['철', '금'], desc: '철·금이 나는 고을에만. 錢 +60', eff: { gold: 60 } },
  workshop: { name: '공방', hanja: '工房', cost: 750, turns: 3, req: 'silhak', desc: '장인의 작업장. 錢 +10%, 이 고을 출진 부대 전투력 +5%', eff: { goldMul: 0.1, power: 0.05 } },
  arsenal: { name: '기기창', hanja: '機器廠', cost: 1350, turns: 3, req: 'sinsik', desc: '근대식 무기 공장. 錢 +40, 출진 부대 전투력 +10%', eff: { gold: 40, power: 0.1 } },
  telegraph: { name: '전신국', hanja: '電信局', cost: 900, turns: 2, req: 'jeonsin', desc: '민심 +5, 민란 위험 절반', eff: { loyal: 5, rebel: 0.5 } },
  school: { name: '신식학교', hanja: '學校', cost: 1200, turns: 3, req: 'hakgyo', desc: '學 +12', eff: { sci: 12 } },
  station: { name: '철도역', hanja: '鐵道驛', cost: 1500, turns: 4, req: 'cheoldo', desc: '錢 +15%. 역이 있는 고을끼리 병력·장수를 한 번에 옮긴다', eff: { goldMul: 0.15, rail: 1 } },
};

export const WONDERS = {
  gyeongbok: { name: '경복궁', hanja: '景福宮', cost: 6000, turns: 8, capital: true, desc: '큰 복을 누리라는 법궁. 도읍에만. 정통성 +20, 名 +5/턴', eff: { pres: 5, legit: 20 } },
  jongmyo: { name: '종묘', hanja: '宗廟', cost: 4000, turns: 6, desc: '역대 임금의 신위를 모신 사당. 정통성 +10, 모든 장수 충성 +5', eff: { legit: 10, loyaltyAll: 5, pres: 2 } },
  jiphyeon: { name: '집현전', hanja: '集賢殿', cost: 4400, turns: 6, desc: '학사들이 모여 연구하는 곳. 學 +20%, 名 +2/턴', eff: { sciMul: 0.2, pres: 2 } },
  tripitaka: { name: '팔만대장경판전', hanja: '藏經板殿', cost: 5000, turns: 7, req: 'gabin', desc: '팔만 장 경판을 지키는 해인사 장경판전. 名 +4/턴, 모든 고을 민심 +3', eff: { pres: 4, loyalAll: 3 } },
  seonggyun: { name: '성균관', hanja: '成均館', cost: 4800, turns: 6, req: 'gyeongguk', desc: '나라의 최고 학부. 學 +10/턴, 과거 급제자 능력 +10', eff: { sci: 10, pres: 2, exam: 10 } },
  namhan: { name: '남한산성', hanja: '南漢山城', cost: 5000, turns: 6, req: 'bigyeok', desc: '험한 산 위의 행궁. 도읍 수비 +40%', eff: { capDef: 0.4, pres: 2 } },
  hwaseong: { name: '수원 화성', hanja: '華城', cost: 7000, turns: 8, req: 'geojung', region: 'suwon', desc: '거중기로 쌓은 계획 성곽. 수원에만. 이 고을 성곽 999, 名 +6/턴', eff: { pres: 6, fort: 999 } },
  dongnimmun: { name: '독립문', hanja: '獨立門', cost: 5000, turns: 5, req: 'gaehang', desc: '자주독립의 뜻을 새긴 문. 정통성 +15, 名 +6/턴', eff: { pres: 6, legit: 15 } },
};

// 특산물: 고을을 가지고 있으면 매 턴 효과. 같은 종류 여러 개도 쌓인다.
export const RESOURCES = {
  인삼: { icon: '蔘', desc: '錢 +60, 교역 +10%', eff: { gold: 60, trade: 0.1 } },
  소금: { icon: '鹽', desc: '錢 +30, 고을 민심 +3', eff: { gold: 30, loyal: 3 } },
  철: { icon: '鐵', desc: '錢 +20, 전군 전투력 +3%(최대 3곳)', eff: { gold: 20, power: 0.03 } },
  말: { icon: '馬', desc: '돌격 +8%(최대 3곳)', eff: { charge: 0.08 } },
  목재: { icon: '木', desc: '건설비 -8%(최대 3곳), 수전 +4%', eff: { buildCost: 0.08, naval: 0.04 } },
  면포: { icon: '布', desc: '錢 +40', eff: { gold: 40 } },
  비단: { icon: '絹', desc: '錢 +45, 교역 +10%', eff: { gold: 45, trade: 0.1 } },
  어물: { icon: '魚', desc: '米 +80', eff: { rice: 80 } },
  종이: { icon: '紙', desc: '學 +3', eff: { sci: 3 } },
  약재: { icon: '藥', desc: '인구 증가 +15%, 역병 피해 -20%', eff: { growth: 0.15, plague: 0.2 } },
  유적: { icon: '蹟', desc: '名 +2', eff: { pres: 2 } },
};

// 특기 설명(효과는 각 계산식에서 참조)
export const TRAITS = {
  기병: '돌격 +25%(공성 제외)',
  궁술: '일제사격 +20%',
  화포: '일제사격 +15%, 공성 +30%',
  수군: '수전 +40%, 해안 수비 +10%',
  수성: '수비할 때 받는 피해 -20%',
  의병: '자기 땅·이웃 땅 싸움에서 사기 +10, 매복 +20%',
  매복: '계략(매복) 성공률 +20%',
  계략: '계략 성공률 +15%, 이간·유언 성공 +',
  돌격: '돌격 +20%',
  무예: '일기토 무력 +8',
  인덕: '선정 효과 +50%, 같은 고을 장수 충성 유지',
  내정: '개간·상업 효과 +30%',
  학문: '연구 효과 +50%',
  발명: '연구 효과 +30%, 발명 사건',
  축성: '축성 효과 +50%',
  외교: '외교 성공률 +20%',
  상재: '상업 효과 +40%, 교역 +5%',
  의술: '역병 피해 감소, 전투 뒤 부상병 회복',
  선동: '유언·선동 성공 +25%',
  승병: '징병해도 민심이 덜 떨어짐, 사기 +5',
  북방: '함경·평안 싸움 +15%',
  예술: '名 +2/턴',
  개혁: '법령 변경 비용 -30%, 연구 +10%',
  지리: '매복 +15%, 퇴각 손실 감소',
  선박: '수전 +20%, 수군진 공사 1턴 단축',
  의적: '탐색에서 재물을 더 찾음, 민심 +',
};

// 보물: 장수에게 하사하면 능력 + 충성 +15
export const ITEMS = {
  saingeom: { name: '사인검', hanja: '四寅劍', stat: { str: 6, cha: 3 }, desc: '인년 인월 인일 인시에 벼린 벽사의 보검.' },
  hwando: { name: '명품 환도', hanja: '環刀', stat: { str: 4 }, desc: '날이 푸르게 선 군도.' },
  gakgung: { name: '흑각궁', hanja: '黑角弓', stat: { str: 3, lea: 2 }, desc: '물소 뿔로 만든 센 활.' },
  muye: { name: '무예도보통지', hanja: '武藝圖譜通志', stat: { str: 3, lea: 3 }, desc: '스물네 가지 무예를 그림으로 풀었다.' },
  byeonghak: { name: '병학지남', hanja: '兵學指南', stat: { lea: 5 }, desc: '진법과 군령을 담은 병서.' },
  jingbi: { name: '징비록', hanja: '懲毖錄', stat: { int: 4, pol: 3 }, desc: '지난 일을 징계해 뒷근심을 삼간다.' },
  cheonsang: { name: '천상열차분야지도', hanja: '天象列次分野之圖', stat: { int: 6 }, desc: '돌에 새긴 하늘의 지도.' },
  moonjar: { name: '백자 달항아리', hanja: '白磁大壺', stat: { cha: 6 }, desc: '보름달처럼 둥근 흰 항아리.' },
  celadon: { name: '청자 상감운학문 매병', hanja: '靑磁梅甁', stat: { cha: 4, pol: 2 }, desc: '구름 사이로 학이 난다.' },
  jejuhorse: { name: '제주 명마', hanja: '濟州名馬', stat: { lea: 4, str: 1 }, desc: '하루 천 리를 달린다는 탐라마.' },
  mapae: { name: '마패', hanja: '馬牌', stat: { pol: 3, cha: 3 }, desc: '암행어사의 증표. 역마를 부린다.' },
  daedongmap: { name: '대동여지도 판목', hanja: '大東輿地圖', stat: { int: 3, lea: 3 }, desc: '산줄기와 물줄기를 한눈에.' },
  hyeonja: { name: '천자총통', hanja: '天字銃筒', stat: { lea: 3, int: 2 }, desc: '판옥선에 싣는 큰 대포.' },
};
