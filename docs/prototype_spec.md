# 조선 1899 — 프로토타입 구현 명세 (prototype_spec.md)

> 대상: 2차 구현을 맡은 프로그래머(사람·NPC, 탈것, 파밍, 전투, 수배, 미션, 월드).
> 이 문서는 **확정값만** 담는다. 기획 의도와 배경은 `docs/GDD.md`, 모듈 이름·API는 `docs/ARCHITECTURE.md`가 정본이다.
> 충돌 규칙: 이름·API는 ARCHITECTURE, 수치·내용은 이 문서. 이 문서 안에서 표와 본문이 다르면 **표**가 이긴다.
> 범위: 프롤로그 미션 4개 + 1장 미션 8개, 지도 1장(경기: 한성~한강~제물포, 3600×2400 m).

---

## 0. 공통 규약

### 0.1 단위·좌표

| 항목 | 규칙 |
|---|---|
| 길이 | 1 = 1 m. 원점 좌상단, x = 동쪽, y = 남쪽, 북쪽이 화면 위 |
| 각도 | 라디안. 0 = 동쪽, +는 시계방향(화면에서 아래로). 탈것 로컬 좌표는 +x 앞, +y 오른쪽 |
| 속도·가속 | m/s, m/s². 회전 rad/s |
| 시간 | 게임 하루 = 실시간 48분(`time.minutesPerDay = 48`). **게임 1시간 = 120실초, 게임 1분 = 2실초**. 이 문서의 "실초"는 실시간 초, "게임 시각"은 게임 시계 |
| 돈 | `inventory.money`는 **전(錢) 정수**. 1원 = 100전. 화면 표시는 `formatMoney`: 10전 이상이면 "N냥 M전"(1냥 = 10전), 10전 미만은 "M전". 이 냥 환산은 **[각색]**이며 도감 '돈' 항목에 고정 문구로 밝힌다(본 문서 G.6) |
| 바람 | `time.wind = {angle, strength}`. angle은 바람이 **불어 가는** 방향, strength 0~1. 풍속(m/s) = strength × 12 |
| 물살 | `world.flowAt(x,y)` 값의 담당은 지도(A.4). 조수 `time.tide` 공식의 담당은 time 시스템 하나(G.5) |
| 표기 | [고증 id] 검증된 사실 / **[각색]** 사실을 게임용으로 바꿈 / **[창작]** 근거 없음 / **[전승]** 확인 안 된 일화 / **[통설]** 사실 목록 밖이지만 널리 알려진 것 |

### 0.2 날짜(달력) 규칙

| 항목 | 규칙 |
|---|---|
| 기준 | `game.flags.date` = 'YYYY-MM-DD'. 새 게임은 `'1899-05-17'`(음력 4월 8일, 초파일) 07:00 |
| 날짜가 바뀌는 때 | ① 자정이 지날 때 하루를 더한다. ② 미션이 `date`를 가지고 있고 현재 날짜보다 늦으면, 미션 시작 때 그 날짜·시각으로 건너뛴다(페이드 + 날짜 카드 "N일 뒤"). ③ 미션 아웃트로가 `advanceTo`를 가지면 그 날짜로 건너뛴다 |
| 날짜 상한(본편 보호) | 다음 본편 미션이 아직 시작되지 않았다면, 자정이 지나도 날짜는 **그 미션 날짜의 전날**을 넘지 않는다(시각만 흐른다). `ch1_done` 뒤에는 상한이 없다 |
| 날짜 플래그 | 날짜가 바뀔 때마다 아래 표를 검사해 켠다. 꺼지는 것은 없다 |

| 플래그 | 날짜 | 효과 |
|---|---|---|
| `tram_running` | 05-17 | 전차 운행(C.6) |
| `tram_festival` | 05-17 하루만 | 전차 d 612~800 구간 최고 3.0 m/s, 종로 연등·군중 |
| `rail_construction` | 05-17 ~ 09-17 | 철로 공사 중. 노량진~소사(d 20~1146)는 침목만 그리고, 소사~제물포는 레일까지 그린다. 열차 없음 |
| `drought` | 05-17 ~ 06-11 | 비 가중치 0(가뭄) [각색, tram-08 가뭄 소문] |
| `rail_trial` | 06-17 | 전 구간 레일. 시운전 열차(C.7) [각색, rail-03 기관차 도착 6/17] |
| `rail_open` | 09-18 | 경인선 정기 운행(C.7), `railcamp` 정착지 제거 |
| `steamer_reduced` | 09-18 | 증기선 격일 운항(C.8) |
| `tram_resumed` | 09-28 | 전차 재개, 운전수는 미국인(C.6). 낯선 이 S1 해금 [tram-07, tram-08 '9월 말'] |

미션이 켜는 플래그(`prologue_done`, `tram_suspended`, `deokgu_joined`, `yu_joined`, `rifle_unlocked`, `news_constitution`, `ch1_done` 등)는 H절 미션 표에 있다.

### 0.3 ARCHITECTURE 계약에 추가하는 것 (기존 이름·인자는 그대로 둔다)

| 대상 | 추가 내용 |
|---|---|
| Human faction | `company`(철도·전기 회사 경비), `bounty`(현상금 사냥꾼), `pirate`(한강 수적), `guild`(보부상). 강조색은 B.3 |
| Human/NPC def | `essential: true` — 체력이 0이 되면 죽지 않고 `down` 15초 뒤 일어나 도주한다. 대상: 오장헌, 마천복, 유선녀, 최만득, 덕구, 이시중, 구만석, 방칠성, 현덕만, 다카다(M12 선택 전까지), 엄순례. `fleeAt: 0~1`(체력 비율이 이 값 이하가 되면 도주) |
| missions step | `mount{vtype?, moveMode?, role?:'driver'\|'passenger'}`, `kill{tag?, faction?, species?, n, lethal?:false}`(lethal 생략 = `down`과 `dead` 모두 셈), `collect{itemId, n}`, `escort`는 대상 NPC가 탈것에 타 있어도 탈것 위치로 판정, `survive{seconds, keepAlive?:[npcId]}`, `buy{itemId, shop?}` |
| missions step 공통 옵션 | `onStart:{set?:{time, weather, wind, timeScale}, fade?:{text, teleport?:{player:[x,y], npcs:{id:[x,y]}, vehicles?}}, spawn?:[...], say?:[{speaker,text}]}`, `when:{flag, eq}`(분기 단계: 조건이 거짓이면 건너뜀), `timeout:{seconds, then:'skip'\|'fail', flag?}`, `alt:{type, ...}`(대안 완료 조건) |
| missions 미션 공통 | `date`, `time`, `weather`, `wind`, `chain:true`(앞 미션이 끝나면 바로 시작), `checkpoint`(단계 번호 → 실패·사망 시 그 단계부터 재시작), `retry:'nextDay'`(열차를 놓치면 다음 날 같은 시각으로) |
| rewards | `money, items, honor, xp:{tree:n}, flags:[], pardon:true`(현상금 0), `wanted:{level, bounty}`(스크립트 수배), `advanceTo:'YYYY-MM-DD HH:MM'` |
| wanted | 범죄 kind에 `jailbreak`(현상 150, 2단계, 미션 전용), `arson`(현상 100, 2단계) 추가. `set(level, bountyAdd, reason)`. 수배 지역 4개(G.3) |
| time | `tide`(0~1, G.5), `date` 접근자, `forceWeather(w, hours)`, `forceWind(angle, strength, hours)` |
| vehicles | `forceArrival(line, stopId, withinSec)`(M02), `requestStop(line, stopId)`, `slowZones`, `sightLimit`(C.7), `fastForward(mult)`(승객 빨리감기) |
| world | `MAP.sands`, `MAP.reeds`(지형 REED = 20, `T_COUNT` = 21), `walls[].closed`(옹성), `gates[].locked`, `regions[].wanted`, `zones[].ref` |
| 이벤트 | `horse:down {horse}`, `train:robbery {phase}`, `tram:service {on}`, `calendar:date {date}` |
| input | `crouch`에서 `ControlLeft`를 뺀다(C만). Ctrl+W로 탭이 닫히는 사고 방지 |

### 0.4 2차 구현 분량 예산

현재 `js/` 약 16,900줄(코어·지도·UI·소리). 남은 구현은 **8,000줄 이하**로 한다.

| 영역 | 예산(줄) | 영역 | 예산(줄) |
|---|---|---|---|
| 사람·NPC 두뇌·군중 | 1,300 | 수배·평판 | 450 |
| 동물·사냥 | 600 | 아이템·상점·제작 | 900 |
| 탈것 4클래스 + 노선 | 1,950 | 스킬 데이터 | 250 |
| 전투·호안 | 900 | 미션 엔진 | 600 |
| 미션·NPC 데이터 | 1,000 | **합계** | **7,950** |

- 탈것은 클래스 4개로 묶는다: **말**(pony, jeju_horse), **배**(rowboat, sailboat, steamer), **선로 차량**(tram, train), **메는·끄는 탈것**(gama, rickshaw, oxcart). 종류 차이는 C.1 표의 수치로만 낸다.
- 중복 파일이 있으면 지운다(예전 `world_dev.js` 류).
- 모바일: 렌더 캐시 상한 tier0 24, tier1 20(데스크톱은 48·40).

### 0.5 프로토타입에서 빼는 것(F = 풀 버전)

자전거, 서양마, 사인교·초헌·남여, 전차·기차 직접 운전, 운전수 끌어내리기, 열차 지붕 이동·연결기 분리·금고 열기, 돛대 부러짐, 증기선 운전, 조수에 따른 지형 변화, 장마 범람, 계절 재굽기, 전망대 지도 공개, 전차 연장선(`tram_ext`), 말 유대 3·4단계·솔질·청결·길들이기·견마꾼·말 죽음, 게이지 심지(배고픔·피로), 스킬 24개, 변장, 생포·결박, 현상 게시판(무악재 범은 S3 미션으로 대신), 탈옥, 지역별 현상금 분리, 전당포·질옥 되사기, 환전, 정미소, 객주 창고, 위조 백동화, 산삼, 표범·곰·담비·수달·대륙사슴, 횃불·창·편곤(플레이어용), 낚시, 폭풍·눈, 낯선 이 S2·S4·S6·S1 2·3부, 길거리 사건 5개(H.4 끝 표), 엔딩 판정.

---

## A. 지도

### A.1 월드

| 항목 | 값 |
|---|---|
| 크기 | 3600 × 2400 m, 지형 격자 `cell` 2 m |
| 새 게임 위치 | `spawn` (2707, 1600): 노량진 나루길 위, 노량진나루 남쪽 41 m |
| 압축 | 지도 전체 약 1/12. 한양도성 동서 1/4, 경인선 1/16, 강길 1/21 [각색, dist-01] |
| 이동 감각 | 동서 3,600 m = 제주마 구보(6.5 m/s) 9.2분, 달리기(3.8 m/s) 15.8분 |
| 지도 가장자리 | 60 m 안쪽은 한지 바탕으로 번져 사라진다(VOID). 북한산 바위 띠(y < 80)와 관악산 남쪽(y > 2350)은 지나갈 수 없다 |

### A.2 지형 enum (`world.T`)

숫자는 이동 속도 배율, 0은 통행 불가. 은신 배율은 NPC가 플레이어를 알아보는 거리에 곱한다(작을수록 숨기 좋음). 공통 보정: 밤 ×0.6, 비 ×0.8, 안개 ×0.5, 웅크리기 ×0.7.

| id | 키 | 이름 | foot | horse | wheel | boat | swim | 은신 | 발소리 | 효과 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | VOID | 지도 밖 | 0 | 0 | 0 | 0 | 0 | – | – | 벽 |
| 1 | SEA | 바다 | 0 | 0 | 0 | 1 | 1 | – | splash | 깊은 물 |
| 2 | RIVER | 강 | 0 | 0 | 0 | 1 | 1 | – | splash | 깊은 물, `flowAt`으로 떠내려감 |
| 3 | SHALLOW | 얕은 물 | 0.55 | 0.6 | 0 | 0.7 | 1 | 1.0 | water | 화승총 불발 +0.15. 증기선은 좌초(통과 불가) |
| 4 | MUD | 갯벌 | 0.5 | 0.45 | 0 | 0 | 0 | 1.2 | mud | 발자국 60초 |
| 5 | SAND | 모래·모래톱 | 0.85 | 0.8 | 0.6 | 0 | 0 | 1.2 | sand | 발자국 |
| 6 | GRASS | 풀밭 | 1 | 1 | 0.75 | 0 | 0 | 1.0 | grass | 기본 땅 |
| 7 | FIELD | 밭 | 0.85 | 0.8 | 0.6 | 0 | 0 | 0.9 | dirt | 발자국 |
| 8 | PADDY | 논 | 0.6 | 0.55 | 0 | 0 | 0 | 0.85 | mud | 둑(폭 1 m)은 GRASS |
| 9 | FOREST | 숲 | 0.8 | 0.6 | 0 | 0 | 0 | 0.6 | leaves | 시야 차단, 싸리 채집 |
| 10 | MOUNTAIN | 산비탈 | 0.65 | 0.5 | 0 | 0 | 0 | 0.8 | gravel | 기력 소모 ×1.5 |
| 11 | ROCK | 바위·벼랑 | 0 | 0 | 0 | 0 | 0 | – | – | 벽, 총소리 메아리 |
| 12 | ROAD | 길 | 1.05 | 1.1 | 1.0 | 0 | 0 | 1.1 | dirt | 비 오면 바퀴 ×0.85 |
| 13 | MAIN_ROAD | 큰길 | 1.05 | 1.15 | 1.1 | 0 | 0 | 1.15 | dirt | 군중 밀도 높음 |
| 14 | STREET | 거리 | 1.05 | 1.0 | 1.05 | 0 | 0 | 1.1 | dirt | 성안. 양쪽 돌 배수로 [geo-07] |
| 15 | YARD | 마당 | 1 | 0.9 | 0.9 | 0 | 0 | 1.0 | dirt | 주민이 "남의 집이오" 반응 |
| 16 | WALL | 성벽 | 0 | 0 | 0 | 0 | 0 | – | – | 문으로만 통과 |
| 17 | BRIDGE | 다리 | 1.05 | 1.05 | 1.0 | 0(밑으로 통과) | 0 | 1.1 | wood | |
| 18 | RAIL | 철로 | 0.9 | 0.8 | 0.5 | 0 | 0 | 1.1 | gravel | 달리는 열차에 부딪히면 즉사(C.7) |
| 19 | PIER | 부두·나루 | 1 | 0.9 | 0.9 | 0.5(가장자리) | 0 | 1.0 | wood | 탑승 지점 |
| 20 | **REED** (추가) | 갈대밭 | 0.6 | 0.5 | 0 | 0.4 | 0 | **0.45** | reed | 고라니·꿩 출현, 배 숨김 |

탈것별 보정(`vehicle.terrainMul`)은 C.2.

### A.3 지도 데이터

검증을 마친 좌표다(A.5). `mapdata.js`의 기존 임시 지도를 **통째로** 이것으로 바꾼다. 경운궁 문은 '대안문'(1906년 대한문 개칭 전)이다 [geo-05].

```js
// js/world/mapdata.js 에 그대로 옮길 확정 데이터 (좌표 m, x=동, y=남)
export const MAP = {
  size: { w: 3600, h: 2400 }, cell: 2, spawn: { x: 2707, y: 1600 },
  // 바다(짝홀 규칙: 0번 본바다, 1번 월미도, 2번 소월미도는 섬)
  sea: [
    [[-60,-60],[660,-60],[650,0],[620,90],[585,170],[560,234],[440,406],[420,560],[400,760],[380,960],[350,1150],[320,1300],[290,1400],[262,1470],[246,1550],[250,1630],[280,1700],[340,1750],[430,1775],[530,1785],[610,1810],[640,1880],[610,1980],[550,2080],[500,2200],[470,2300],[460,2460],[-60,2460]],
    [[175,1520],[166,1548],[143,1568],[110,1575],[78,1568],[54,1548],[45,1520],[54,1493],[78,1472],[110,1465],[143,1472],[166,1493]],
    [[82,1640],[76,1656],[60,1662],[44,1656],[38,1640],[44,1624],[60,1618],[76,1624]],
  ],
  mudflats: [
    [[440,410],[420,560],[400,760],[380,960],[350,1150],[320,1300],[290,1400],[245,1385],[272,1290],[302,1140],[332,955],[352,760],[372,560],[392,420]],
    [[262,1470],[246,1550],[250,1630],[238,1628],[234,1550],[250,1475]],
    [[175,1520],[190,1505],[198,1530],[185,1560],[166,1548]],
    [[530,1785],[610,1810],[640,1880],[610,1980],[572,1960],[578,1880],[545,1818]],
    [[560,234],[585,170],[620,90],[650,0],[612,0],[580,90],[545,170],[520,212]],
  ],
  sands: [   // (추가) SAND. 0 여의도, 1 밤섬, 2 하류 모래톱 1(좌초), 3 하구 모래톱 2
    [[2200,1478],[2340,1504],[2500,1530],[2600,1548],[2630,1550],[2590,1583],[2450,1605],[2300,1603],[2225,1572],[2197,1515]],
    [[2205,1436],[2240,1428],[2278,1436],[2245,1446]],
    [[1640,1130],[1700,1150],[1690,1168],[1630,1150]],
    [[700,520],[760,540],[750,560],[690,545]],
  ],
  reeds: [   // (추가) REED
    [[900,700],[1100,820],[1080,860],[880,745]],
    [[1400,1000],[1600,1150],[1580,1185],[1380,1040]],
    [[2210,1540],[2280,1590],[2260,1600],[2200,1560]],
  ],
  rivers: [  // points 는 상류→하류, widths 는 꼭짓점별 깊은 물 폭, shallow 는 양쪽 얕은 물 폭
    { id:'han', name:'한강', hanja:'漢江', shallow:8, width:260,
      points:[[3600,1400],[3460,1440],[3300,1480],[3150,1505],[2980,1515],[2820,1520],[2660,1505],[2500,1480],[2340,1455],[2180,1420],[2040,1360],[1900,1280],[1760,1180],[1620,1060],[1480,950],[1330,850],[1180,760],[1030,670],[880,580],[740,490],[610,400],[500,320],[400,250],[300,200]],
      widths:[110,110,105,100,100,100,95,90,90,90,95,100,105,110,115,120,130,140,150,165,185,210,240,260] },
    { id:'jungnang', name:'중랑천', hanja:'中浪川', shallow:5, width:14,
      points:[[3575,0],[3570,300],[3575,600],[3560,900],[3550,1060],[3540,1250],[3525,1380]],
      widths:[10,10,10,10,12,12,14] },
    { id:'anyang', name:'안양천', hanja:'安養川', shallow:5, width:6,
      points:[[2120,2400],[2140,2200],[2120,2000],[2150,1850],[2170,1720],[2190,1600],[2190,1530]],
      widths:[6,6,6,6,6,6,6] },
    { id:'cheonggye', name:'청계천', hanja:'淸溪川', shallow:3, width:5,
      points:[[2520,450],[2575,590],[2630,700],[2680,800],[2760,830],[2840,832],[3000,836],[3150,842],[3245,848],[3330,880],[3420,960],[3550,1060]],
      widths:[1,1,2,2,2,2,2,2,2,3,4,5] },
    { id:'saetgang', name:'샛강', shallow:8, width:0,
      points:[[2640,1540],[2580,1590],[2450,1615],[2300,1612],[2220,1580],[2190,1520],[2182,1468]],
      widths:[0,0,0,0,0,0,0] },
  ],
  ponds: [ [[2650,430],[2690,430],[2690,466],[2650,466]] ],   // 경회루 연못
  mountains: [
    {id:'bukhan',name:'북한산',hanja:'三角山',x:2550,y:-60,r:320,height:1,rock:0.8},
    {id:'bugak',name:'북악산',hanja:'白岳',x:2720,y:290,r:115,height:0.8,rock:0.4},
    {id:'inwang',name:'인왕산',hanja:'仁王山',x:2330,y:510,r:125,height:0.8,rock:0.85},
    {id:'namsan',name:'남산',hanja:'木覓山',x:2870,y:1150,r:150,height:0.7,rock:0.2},
    {id:'gwanak',name:'관악산',hanja:'冠岳山',x:2650,y:2130,r:280,height:1,rock:0.85},
    {id:'gyeyang',name:'계양산',hanja:'桂陽山',x:900,y:1130,r:170,height:0.8,rock:0.4},
    {id:'naksan',name:'낙산',hanja:'駱山',x:3240,y:600,r:70,height:0.35,rock:0.1},
    {id:'ansan',name:'안산',hanja:'毋岳',x:2160,y:520,r:85,height:0.55,rock:0.5},
    {id:'eungbong',name:'응봉산',hanja:'鷹峰山',x:400,y:1500,r:42,height:0.25,rock:0.1},
    {id:'wolmi',name:'월미산',hanja:'月尾山',x:110,y:1515,r:45,height:0.35,rock:0.2},
    {id:'suri',name:'수리산',hanja:'修理山',x:1480,y:2300,r:200,height:0.8,rock:0.45},
    {id:'solgogae',name:'솔고개',hanja:'松峴',x:1600,y:1860,r:80,height:0.35,rock:0.05},
  ],
  forests: [
    {id:'f_bukhan',x:2500,y:80,r:320,density:0.75,pine:0.75},
    {id:'f_bugak',x:2720,y:300,r:115,density:0.6,pine:0.85},
    {id:'f_inwang',x:2330,y:510,r:130,density:0.45,pine:0.9},
    {id:'f_ansan',x:2160,y:520,r:90,density:0.6,pine:0.8},
    {id:'f_namsan',x:2870,y:1150,r:130,density:0.7,pine:0.95},
    {id:'f_naksan',x:3240,y:600,r:70,density:0.35,pine:0.6},
    {id:'f_gwanak',x:2650,y:2130,r:320,density:0.7,pine:0.6},
    {id:'f_gwanak_e',x:3300,y:2150,r:220,density:0.65,pine:0.4},
    {id:'f_gyeyang',x:900,y:1130,r:210,density:0.75,pine:0.5},
    {id:'f_goyang',density:0.7,pine:0.5, poly:[[680,0],[2120,0],[2120,250],[1950,420],[1650,520],[1350,520],[1050,420],[800,250]] },
    {id:'f_hongneung',x:3520,y:560,r:55,density:0.6,pine:0.95},
    {id:'f_wolmi',x:110,y:1520,r:55,density:0.6,pine:0.9},
    {id:'f_eungbong',x:400,y:1500,r:40,density:0.35,pine:0.5},
    {id:'f_grove_oryu',x:1700,y:2150,r:160,density:0.6,pine:0.5},
    {id:'f_grove_sosa',x:1050,y:1950,r:120,density:0.55,pine:0.6},
    {id:'f_suri',x:1480,y:2300,r:200,density:0.8,pine:0.55},
    {id:'f_solgogae',x:1600,y:1860,r:75,density:0.7,pine:0.95},
  ],
  fields: [
    { id:'p_bupyeong', kind:'paddy', poly:[[650,1250],[1050,1330],[1250,1450],[1350,1640],[1200,1690],[900,1680],[720,1600],[620,1450]] },
    { id:'p_oryu', kind:'paddy', poly:[[1690,1818],[1900,1812],[2050,1850],[2000,2000],[1700,2050],[1680,1950]] },
    { id:'p_gimpo', kind:'paddy', poly:[[470,620],[740,660],[950,780],[1100,900],[1080,980],[880,960],[690,880],[480,780]] },
    { id:'p_goyang', kind:'paddy', poly:[[1120,620],[1400,600],[1620,780],[1780,960],[1700,1010],[1500,860],[1280,720]] },
    { id:'p_salgoji', kind:'paddy', poly:[[3280,1150],[3500,1180],[3500,1330],[3300,1340]] },
    { id:'d_wangsimni', kind:'field', poly:[[3330,900],[3500,890],[3510,1000],[3340,1060]] },
    { id:'d_ahyeon', kind:'field', poly:[[2350,1150],[2470,1150],[2560,1300],[2420,1320]] },
    { id:'d_cn_veg', kind:'field', poly:[[740,1550],[830,1545],[840,1640],[750,1650]] },
    { id:'d_noryang', kind:'field', poly:[[2480,1760],[2650,1700],[2690,1800],[2500,1820]] },
    { id:'d_goyang', kind:'field', poly:[[1820,700],[2000,720],[2050,900],[1880,880]] },
  ],
  walls: [
    { id:'hanseong_wall', name:'한양도성', thickness:4,
      points:[[2290,760],[2300,660],[2340,560],[2400,470],[2490,380],[2600,330],[2720,300],[2840,330],[2970,360],[3080,390],[3150,430],[3210,500],[3235,590],[3250,680],[3255,760],[3240,870],[3205,970],[3175,1030],[3090,1090],[2980,1125],[2870,1135],[2760,1120],[2660,1100],[2560,1085],[2480,1045],[2415,990],[2350,890]],
      gates:[
        {id:'sungnyemun',name:'숭례문',hanja:'崇禮門',x:2560,y:1085,w:10},
        {id:'heunginjimun',name:'흥인지문',hanja:'興仁之門',x:3255,y:760,w:10},
        {id:'donuimun',name:'돈의문',hanja:'敦義門',x:2290,y:760,w:9},
        {id:'sukjeongmun',name:'숙정문',hanja:'肅靖門',x:2840,y:330,w:6,locked:true},
        {id:'hyehwamun',name:'혜화문',hanja:'惠化門',x:3150,y:430,w:7},
        {id:'gwanghuimun',name:'광희문',hanja:'光熙門',x:3175,y:1030,w:7},
        {id:'souimun',name:'소의문',hanja:'昭義門',x:2415,y:990,w:7},
        {id:'changuimun',name:'창의문',hanja:'彰義門',x:2490,y:380,w:6}
      ] },
    { id:'ongseong', name:'흥인지문 옹성', thickness:4, closed:false,
      points:[[3255,784],[3261.2,783.2],[3267,780.8],[3272,777],[3275.8,772],[3278.2,766.2],[3279,760],[3278.2,753.8],[3275.8,748]],
      gates:[] },
    { id:'gyeongbok_wall', name:'경복궁 궁장', thickness:3,
      points:[[2640,400],[2800,400],[2800,590],[2640,590]],
      gates:[
        {id:'gwanghwamun',name:'광화문',hanja:'光化門',x:2720,y:590,w:9},
        {id:'sinmumun',name:'신무문',hanja:'神武門',x:2720,y:400,w:6},
        {id:'geonchunmun',name:'건춘문',hanja:'建春門',x:2800,y:480,w:6},
        {id:'yeongchumun',name:'영추문',hanja:'迎秋門',x:2640,y:480,w:6}
      ] },
    { id:'gyeongun_wall', name:'경운궁 궁장', thickness:3,
      points:[[2560,830],[2670,830],[2670,920],[2560,920]],
      gates:[
        {id:'daeanmun',name:'대안문',hanja:'大安門',x:2670,y:875,w:7},
        {id:'inhwamun',name:'인화문',hanja:'仁化門',x:2615,y:920,w:7}
      ] },
    { id:'changdeok_wall', name:'창덕궁 궁장', thickness:3,
      points:[[2950,450],[3090,450],[3090,590],[2950,590]],
      gates:[
        {id:'donhwamun',name:'돈화문',hanja:'敦化門',x:3010,y:590,w:8}
      ] },
    { id:'gyeonghui_wall', name:'경희궁 궁장', thickness:3,
      points:[[2380,690],[2480,690],[2480,770],[2380,770]],
      gates:[
        {id:'heunghwamun',name:'흥화문',hanja:'興化門',x:2465,y:770,w:6}
      ] },
  ],
  roads: [
    { id:'sinmunro', name:'신문로', kind:'main', width:12, points:[[2290,762],[2380,780],[2480,785],[2600,785],[2720,787]] },
    { id:'yukjo', name:'육조거리', kind:'main', width:22, points:[[2720,592],[2720,787]] },
    { id:'jongno', name:'종로', kind:'main', width:14, points:[[2720,787],[2860,790],[3000,791],[3080,792],[3200,775],[3255,761]] },
    { id:'namdaemunro', name:'남대문로', kind:'main', width:12, points:[[2860,795],[2810,870],[2730,950],[2640,1020],[2560,1085]] },
    { id:'taepyeongno', name:'태평로', kind:'road', width:10, points:[[2720,790],[2700,860],[2680,930],[2620,1030],[2565,1080]] },
    { id:'guriegae', name:'구리개길', kind:'street', width:6, points:[[2800,880],[2950,885],[3100,900]] },
    { id:'jingogae', name:'진고개길', kind:'street', width:6, points:[[2700,990],[2850,1010],[3000,1030]] },
    { id:'jeongdong', name:'정동길', kind:'street', width:6, points:[[2330,786],[2400,850],[2470,920],[2540,935],[2665,950]] },
    { id:'bukchon', name:'북촌길', kind:'street', width:5, points:[[2830,790],[2845,650],[2870,500],[2850,340]] },
    { id:'donhwamunro', name:'돈화문로', kind:'street', width:8, points:[[3010,791],[3010,592]] },
    { id:'baeogae', name:'배오개길', kind:'street', width:6, points:[[3080,792],[3100,900],[3150,990],[3175,1030]] },
    { id:'seochon', name:'서촌길', kind:'street', width:5, points:[[2600,785],[2560,650],[2530,520],[2490,385]] },
    { id:'sinmunro_out', name:'서대문 밖 길', kind:'main', width:10, points:[[2120,772],[2200,764],[2290,762]] },
    { id:'uiju', name:'의주로', kind:'road', width:8, points:[[2290,760],[2230,720],[2215,690],[2250,540],[2230,400],[2200,200],[2180,0]] },
    { id:'souimun_mapo', name:'마포길', kind:'road', width:8, points:[[2415,990],[2440,1060],[2500,1120],[2420,1200],[2380,1260],[2350,1330],[2340,1400]] },
    { id:'sungnye_chilpae', name:'칠패길', kind:'main', width:10, points:[[2560,1085],[2530,1110],[2500,1120]] },
    { id:'yongsan', name:'용산길', kind:'road', width:9, points:[[2560,1085],[2600,1180],[2680,1290],[2750,1380],[2760,1455]] },
    { id:'mapo_yongsan', name:'강변길', kind:'road', width:6, points:[[2340,1400],[2450,1412],[2600,1430],[2760,1455]] },
    { id:'mapo_yanghwa', name:'양화 강변길', kind:'road', width:6, points:[[2340,1400],[2200,1360],[2080,1300],[2035,1285]] },
    { id:'gwanghui_hangang', name:'광희문 밖 길', kind:'road', width:7, points:[[3175,1030],[3230,1150],[3300,1260],[3380,1340],[3440,1382]] },
    { id:'ongseong_pass', name:'옹성 안길', kind:'street', width:7, points:[[3255,761],[3264,757],[3269,746],[3274,735],[3292,729]] },
    { id:'cheongnyang', name:'청량리길', kind:'main', width:10, points:[[3292,729],[3330,745],[3400,700],[3470,650],[3530,610]] },
    { id:'wangsimni', name:'왕십리길', kind:'road', width:6, points:[[3312,737],[3318,876],[3360,1100],[3400,1250],[3380,1340]] },
    { id:'hyehwa_out', name:'혜화문 밖 길', kind:'road', width:6, points:[[3150,430],[3200,330],[3250,180],[3280,0]] },
    { id:'sukjeong', name:'숙정문 산길', kind:'path', width:2.5, points:[[2840,330],[2830,200],[2800,60]] },
    { id:'changui', name:'창의문 산길', kind:'path', width:3, points:[[2490,380],[2440,280],[2400,150]] },
    { id:'noryang_station', name:'노량진 나루길', kind:'road', width:7, points:[[2730,1572],[2690,1620],[2600,1680],[2500,1705],[2425,1712]] },
    { id:'station_link', name:'정거장길', kind:'road', width:6, points:[[2425,1712],[2340,1690],[2300,1662]] },
    { id:'yeouido_path', name:'여의도 모래길', kind:'path', width:3, points:[[2340,1505],[2336,1600]] },
    { id:'gyeongin_old', name:'경인 옛길', kind:'road', width:7, points:[[2333,1626],[2300,1660],[2200,1700],[2100,1720],[1850,1725],[1650,1730],[1450,1725],[1280,1715],[1100,1700],[950,1680],[820,1650],[720,1625],[630,1610],[560,1612],[490,1615]] },
    { id:'yanghwa_s', name:'양화 남안길', kind:'path', width:5, points:[[2058,1434],[2080,1550],[2100,1718]] },
    { id:'hangang_s', name:'과천길', kind:'road', width:6, points:[[3445,1515],[3400,1650],[3300,1850],[3200,2050],[3150,2400]] },
    { id:'gwanak_path', name:'관악산 길', kind:'path', width:3, points:[[2690,1620],[2620,1800],[2520,1950],[2420,2100],[2395,2175]] },
    { id:'gyeyang_path', name:'계양산 길', kind:'path', width:3, points:[[1280,1715],[1210,1500],[1130,1300],[1080,1050],[1010,895]] },
    { id:'bupyeong_n', name:'부평 들길', kind:'path', width:4, points:[[720,1625],[700,1450],[650,1200],[600,900],[560,660]] },
    { id:'camp_path', name:'산채 오솔길', kind:'path', width:3, points:[[1556,1728],[1530,1790],[1515,1850],[1505,1990],[1500,2120]] },
    { id:'jm1', kind:'street', width:6, points:[[255,1556],[500,1556]] },
    { id:'jm2', kind:'street', width:6, points:[[380,1615],[490,1615]] },
    { id:'jm3', kind:'street', width:6, points:[[440,1440],[440,1700]] },
    { id:'jm4', kind:'street', width:6, points:[[500,1440],[500,1700],[450,1770]] },
    { id:'jm5', kind:'street', width:5, points:[[300,1440],[300,1555]] },
  ],
  bridges: [
    { id:'br_hyejeong', name:'혜정교', points:[[2665,785],[2680,785]], width:12 },
    { id:'br_mojeon', name:'모전교', points:[[2716,804],[2711,820]], width:10 },
    { id:'br_gwangtong', name:'광통교', points:[[2840,825],[2830,840]], width:12 },
    { id:'br_supyo', name:'수표교', points:[[3088,831],[3090,847]], width:6 },
    { id:'br_yeongdo', name:'영도교', points:[[3317,866],[3320,886]], width:6 },
    { id:'br_seop', name:'샛강 섶다리', points:[[2335,1598],[2333,1628]], width:3 },
    { id:'br_anyang', name:'안양천 나무다리', points:[[2186,1702],[2158,1708]], width:7 },
    { id:'br_anyang_rail', name:'안양천 철교', points:[[2180,1756],[2150,1759]], width:4 },
    { id:'br_gyeonghoeru', name:'경회루 돌다리', points:[[2681,448],[2692,448]], width:4 },
  ],
  ferries: [ // a·b = 양쪽 부두 끝 물 위 점. period = 운항 간격(게임 분)
    {id:'ferry_mapo',name:'마포나루',a:{x:2340,y:1418},b:{x:2340,y:1494},period:20,kind:'po'},
    {id:'ferry_noryang',name:'용산나루–노량진나루',a:{x:2760,y:1474},b:{x:2730,y:1554},period:8,kind:'jin'},
    {id:'ferry_yanghwa',name:'양화진',a:{x:2035,y:1310},b:{x:2058,y:1410},period:15,kind:'jin'},
    {id:'ferry_hangang',name:'한강진–사평나루',a:{x:3440,y:1400},b:{x:3445,y:1491},period:8,kind:'jin'},
    {id:'ferry_wolmi',name:'월미도 삯배',a:{x:233,y:1522},b:{x:198,y:1520},period:30,kind:'private'},
  ],
  lines: [
    { id:'train', name:'경인선', kind:'rail',   // 길이 2115.4 m
      points:[[2420,1734],[2300,1745],[2165,1757],[2000,1772],[1850,1785],[1650,1790],[1560,1808],[1450,1788],[1280,1780],[1100,1760],[950,1738],[800,1712],[650,1690],[520,1680],[420,1672],[320,1652]],
      stops:[
        { id:'noryangjin', name:'노량진', x:2400, y:1735.8, d:20.1 },
        { id:'oryu', name:'오류동', x:1850, y:1785, d:572.3, request:true },
        { id:'sosa', name:'소사', x:1280, y:1780, d:1146.1 },
        { id:'chukhyeon', name:'축현', x:650, y:1690, d:1782.7 },
        { id:'jemulpo', name:'인천(제물포)', x:330, y:1654, d:2105.2 },
      ] },
    { id:'tram', name:'전차 (경교–홍릉)', kind:'rail',   // 길이 1345.5 m
      points:[[2250,762],[2290,762],[2380,780],[2480,785],[2600,785],[2720,787],[2860,790],[3000,791],[3080,792],[3200,775],[3255,761],[3264,757],[3269,746],[3274,735],[3292,729],[3330,745],[3400,700],[3470,650],[3530,610]],
      stops:[
        { id:'gyeonggyo', name:'경교', x:2250, y:762, d:0.0 },
        { id:'jongno', name:'종로', x:2860, y:790, d:612.0 },
        { id:'dongdaemun', name:'동대문', x:3224.9, y:768.7, d:978.9 },
        { id:'bojewon', name:'보제원', x:3400, y:700, d:1187.4 },
        { id:'cheongnyang', name:'청량리(홍릉)', x:3519.8, y:616.8, d:1333.3 },
      ] },
    { id:'steamer', name:'한강 증기선', kind:'water',   // 길이 4311.8 m
      points:[[2760,1480],[2660,1500],[2500,1478],[2340,1440],[2180,1420],[2040,1360],[1900,1280],[1760,1180],[1620,1060],[1480,950],[1330,850],[1180,760],[1030,670],[880,580],[740,490],[610,400],[480,330],[370,395],[320,560],[300,760],[290,960],[262,1150],[235,1300],[212,1420],[212,1520],[222,1600],[250,1690],[320,1760],[400,1810],[450,1845]],
      stops:[
        { id:'yongsan', name:'용산나루', x:2760, y:1480, d:0.0 },
        { id:'mapo', name:'마포나루', x:2340, y:1440, d:427.9 },
        { id:'jemulpo_port', name:'제물포 부두', x:450, y:1845, d:4311.8 },
      ] },
  ],
  settlements: [
    { id:'bukchon', name:'북촌', kind:'town', x:2875, y:600, r:70, houses:110, style:'hanok', alleys:true, seed:101 },
    { id:'seochon', name:'서촌', kind:'town', x:2555, y:590, r:80, houses:90, style:'mixed', alleys:true, seed:102 },
    { id:'jongno_st', name:'종로 상가', kind:'town', x:2960, y:805, r:110, houses:120, style:'hanok', alleys:true, seed:103 },
    { id:'namchon', name:'남촌', kind:'town', x:3040, y:990, r:120, houses:200, style:'mixed', alleys:true, seed:104 },
    { id:'baeogae_d', name:'배오개·동대문 안', kind:'town', x:3165, y:880, r:80, houses:120, style:'choga', alleys:true, seed:105 },
    { id:'dongchon', name:'동촌', kind:'town', x:3160, y:640, r:70, houses:70, style:'choga', alleys:true, seed:106 },
    { id:'jeongdong_d', name:'정동', kind:'town', x:2470, y:900, r:80, houses:14, style:'western', seed:107 },
    { id:'jingogae_d', name:'진고개', kind:'town', x:2800, y:1050, r:70, houses:40, style:'jp_wood', alleys:true, seed:108 },
    { id:'nammun_in', name:'남대문 안', kind:'town', x:2640, y:990, r:60, houses:50, style:'mixed', alleys:true, seed:109 },
    { id:'seodaemun_out', name:'서대문 밖(경교)', kind:'village', x:2190, y:800, r:60, houses:30, style:'choga', seed:110 },
    { id:'dongdaemun_out', name:'동대문 밖', kind:'village', x:3330, y:830, r:60, houses:30, style:'choga', seed:111 },
    { id:'mapo', name:'마포(삼개)', kind:'town', x:2330, y:1345, r:70, houses:36, style:'mixed', seed:112 },
    { id:'yongsan', name:'용산', kind:'village', x:2780, y:1405, r:65, houses:26, style:'mixed', seed:113 },
    { id:'noryangjin', name:'노량진', kind:'village', x:2720, y:1625, r:55, houses:18, style:'choga', seed:114 },
    { id:'cheongnyang', name:'청량리(보제원)', kind:'village', x:3440, y:690, r:55, houses:14, style:'choga', seed:115 },
    { id:'origol', name:'오리골(오류동) 주막거리', kind:'village', x:1850, y:1745, r:60, houses:16, style:'choga', seed:116 },
    { id:'solgogae', name:'솔고개', kind:'village', x:1560, y:1728, r:45, houses:8, style:'choga', seed:117 },
    { id:'sosa', name:'소사', kind:'village', x:1280, y:1740, r:70, houses:22, style:'choga', seed:118 },
    { id:'bupyeong', name:'부평', kind:'village', x:940, y:1705, r:45, houses:14, style:'choga', seed:119 },
    { id:'jm_korean', name:'제물포 조선인 마을', kind:'port', x:630, y:1610, r:65, houses:45, style:'choga', seed:120 },
    { id:'jm_jp', name:'일본 조계', kind:'town', x:440, y:1610, r:50, houses:30, style:'jp_wood', seed:121 },
    { id:'jm_cn', name:'청국 조계', kind:'town', x:315, y:1590, r:40, houses:20, style:'cn_brick', seed:122 },
    { id:'jm_intl', name:'각국 조계', kind:'town', x:500, y:1495, r:55, houses:14, style:'western', seed:123 },
    { id:'wolmi_v', name:'월미도 어촌', kind:'village', x:140, y:1548, r:18, houses:6, style:'choga', seed:124 },
    { id:'hwalbin', name:'수리산 산채', kind:'camp', x:1500, y:2140, r:35, houses:4, style:'camp', seed:125 },
    { id:'hideout_hwajeok', name:'불여우패 소굴', kind:'camp', x:2390, y:2190, r:35, houses:5, style:'camp', seed:126 },
    { id:'pirate_den', name:'수적 굴', kind:'camp', x:1010, y:880, r:30, houses:3, style:'camp', seed:127 },
    { id:'railcamp', name:'경인선 공사장', kind:'camp', x:2400, y:1690, r:30, houses:4, style:'camp', seed:128 },
  ],
  buildings: [   // angle 은 모두 0 (독립문만 -0.46). 문은 엔진이 가장 가까운 길 쪽에 낸다
    { id:'gov_uijeongbu', kind:'office', name:'의정부', x:2752, y:612, w:30, h:26, angle:0 },
    { id:'gov_hanseongbu', kind:'office', name:'한성부', x:2752, y:646, w:30, h:26, angle:0 },
    { id:'gov_naebu', kind:'office', name:'내부', x:2752, y:680, w:30, h:26, angle:0 },
    { id:'gov_takji', kind:'office', name:'탁지부', x:2752, y:714, w:30, h:26, angle:0 },
    { id:'gov_nongsang', kind:'office', name:'농상공부', x:2752, y:748, w:30, h:26, angle:0 },
    { id:'gov_jungchu', kind:'office', name:'중추원', x:2688, y:612, w:30, h:26, angle:0 },
    { id:'gov_gunbu', kind:'office', name:'군부', x:2688, y:646, w:30, h:26, angle:0 },
    { id:'gov_beopbu', kind:'office', name:'법부', x:2688, y:680, w:30, h:26, angle:0 },
    { id:'gov_gyeongmu', kind:'police', name:'경무청', x:2688, y:714, w:30, h:26, angle:0, shop:'office_gyeongmu' },
    { id:'gyeongmu_jail', kind:'jail', name:'경무청 옥사', x:2655, y:712, w:12, h:10, angle:0 },
    { id:'gov_hakbu', kind:'office', name:'학부', x:2688, y:748, w:30, h:26, angle:0 },
    { id:'ps_jung', kind:'police', name:'중서 경무서', x:2790, y:808, w:14, h:10, angle:0 },
    { id:'ps_dong', kind:'police', name:'동서 경무서', x:3140, y:762, w:14, h:10, angle:0 },
    { id:'ps_seo', kind:'police', name:'서서 경무서', x:2335, y:812, w:14, h:10, angle:0 },
    { id:'ps_nam', kind:'police', name:'남서 경무서', x:2620, y:1060, w:14, h:10, angle:0 },
    { id:'ps_buk', kind:'police', name:'북서 경무서', x:2900, y:640, w:14, h:10, angle:0 },
    { id:'post_hanseong', kind:'office', name:'한성 우체사', x:2845, y:860, w:14, h:10, angle:0 },
    { id:'jejungwon', kind:'hospital', name:'제중원', x:3000, y:875, w:16, h:12, angle:0 },
    { id:'hwangudan', kind:'altar', name:'환구단', x:2735, y:895, w:28, h:28, angle:0 },
    { id:'hwanggungu', kind:'pavilion', name:'황궁우(공사 중)', x:2742, y:862, w:12, h:12, angle:0 },
    { id:'geunjeongjeon', kind:'palace', name:'근정전', x:2720, y:500, w:36, h:24, angle:0 },
    { id:'gyeonghoeru', kind:'pavilion', name:'경회루', x:2670, y:448, w:22, h:17, angle:0 },
    { id:'hamnyeongjeon', kind:'palace', name:'함녕전', x:2640, y:880, w:22, h:12, angle:0 },
    { id:'junmyeongdang', kind:'palace', name:'준명당', x:2595, y:860, w:16, h:10, angle:0 },
    { id:'injeongjeon', kind:'palace', name:'인정전', x:3020, y:520, w:30, h:20, angle:0 },
    { id:'sungjeongjeon', kind:'palace', name:'숭정전', x:2430, y:725, w:24, h:16, angle:0 },
    { id:'hwanghakjeong', kind:'pavilion', name:'황학정', x:2400, y:705, w:8, h:6, angle:0 },
    { id:'bosingak', kind:'pavilion', name:'보신각', x:2860, y:771, w:10, h:10, angle:0 },
    { id:'yuk_seon', kind:'market', name:'선전', x:2900, y:770, w:34, h:10, angle:0 },
    { id:'yuk_myeonpo', kind:'market', name:'면포전', x:2940, y:770, w:34, h:10, angle:0, shop:'market_jongno' },
    { id:'yuk_myeonju', kind:'market', name:'면주전', x:2980, y:770, w:34, h:10, angle:0 },
    { id:'yuk_ji', kind:'market', name:'지전', x:2900, y:808, w:34, h:10, angle:0 },
    { id:'yuk_jeopo', kind:'market', name:'저포전', x:2940, y:808, w:34, h:10, angle:0 },
    { id:'yuk_eomul', kind:'market', name:'어물전', x:2980, y:808, w:34, h:10, angle:0 },
    { id:'imbang_jongno', kind:'office', name:'보부상 임방(종로)', x:3050, y:770, w:14, h:10, angle:0 },
    { id:'pawn_jongno', kind:'pawnshop', name:'종로 전당포', x:3020, y:808, w:12, h:9, angle:0 },
    { id:'herb_guri1', kind:'herbalist', name:'구리개 약방', x:2880, y:873, w:12, h:8, angle:0, shop:'yakbang_guri' },
    { id:'herb_guri2', kind:'herbalist', name:'구리개 약방 둘째', x:2960, y:897, w:12, h:8, angle:0 },
    { id:'smith_baeogae', kind:'smithy', name:'배오개 대장간', x:3120, y:812, w:10, h:8, angle:0, shop:'smith_baeogae' },
    { id:'stable_dongdaemun', kind:'stable', name:'동대문 안 마방', x:3160, y:808, w:16, h:10, angle:0, shop:'stable_dongdaemun' },
    { id:'hanseong_elec', kind:'office', name:'한성전기회사', x:2790, y:770, w:18, h:10, angle:0 },
    { id:'power_plant', kind:'depot', name:'동대문 발전소', x:3215, y:800, w:30, h:20, angle:0 },
    { id:'tram_depot', kind:'depot', name:'전차 차고', x:3215, y:740, w:30, h:14, angle:0 },
    { id:'chilpae_stalls', kind:'market', name:'칠패 난전', x:2550, y:1145, w:40, h:14, angle:0, shop:'market_chilpae' },
    { id:'market_nammun', kind:'market', name:'남대문 안 장', x:2650, y:1070, w:30, h:14, angle:0 },
    { id:'leg_ru', kind:'legation', name:'아라사 공사관', x:2400, y:810, w:22, h:16, angle:0, style:'western' },
    { id:'leg_uk', kind:'legation', name:'영국 공사관', x:2620, y:808, w:30, h:16, angle:0, style:'western' },
    { id:'leg_us', kind:'legation', name:'미국 공사관', x:2525, y:870, w:24, h:16, angle:0, style:'western' },
    { id:'leg_fr', kind:'legation', name:'프랑스 공사관', x:2385, y:905, w:26, h:18, angle:0, style:'western' },
    { id:'cons_de', kind:'legation', name:'독일 영사관', x:2470, y:1000, w:18, h:12, angle:0, style:'western' },
    { id:'diplo_club', kind:'legation', name:'외교관구락부', x:2470, y:870, w:16, h:10, angle:0, style:'western' },
    { id:'church_jeongdong', kind:'church', name:'정동 예배당', x:2510, y:965, w:14, h:24, angle:0, style:'western' },
    { id:'paichai', kind:'school', name:'배재학당', x:2560, y:985, w:22, h:12, angle:0, style:'western' },
    { id:'ewha', kind:'school', name:'이화학당', x:2440, y:950, w:20, h:14, angle:0, style:'western' },
    { id:'sibyeongwon', kind:'hospital', name:'시병원', x:2600, y:965, w:14, h:10, angle:0, style:'western' },
    { id:'gun_jeongdong', kind:'gunshop', name:'정동 서양 상회', x:2380, y:800, w:12, h:9, angle:0, shop:'gun_jeongdong', style:'western' },
    { id:'myeongdong', kind:'church', name:'종현 성당', x:2930, y:990, w:20, h:44, angle:0, style:'western' },
    { id:'cons_jp', kind:'legation', name:'일본 영사관', x:2690, y:1050, w:26, h:18, angle:0, style:'jp_wood' },
    { id:'gun_jingogae', kind:'gunshop', name:'진고개 일본 상점', x:2860, y:1025, w:12, h:9, angle:0, shop:'gun_jingogae', style:'jp_wood' },
    { id:'pawn_jingogae', kind:'pawnshop', name:'진고개 질옥', x:2780, y:1012, w:12, h:8, angle:0, style:'jp_wood' },
    { id:'independence_gate', kind:'gate_monument', name:'독립문', x:2220, y:705, w:9, h:4, angle:-0.46, noSolid:true, tags:['arch'] },
    { id:'jumak_gyeonggyo', kind:'jumak', name:'경교 주막', x:2215, y:782, w:12, h:8, angle:0, shop:'jumak_gyeonggyo' },
    { id:'stable_seodaemun', kind:'stable', name:'서대문 밖 마방', x:2160, y:790, w:16, h:10, angle:0, shop:'stable_seodaemun' },
    { id:'jumak_muak', kind:'jumak', name:'무악재 주막', x:2205, y:640, w:10, h:7, angle:0, shop:'jumak_muak' },
    { id:'hongneung', kind:'pavilion', name:'홍릉 정자각', x:3520, y:585, w:10, h:8, angle:0 },
    { id:'jumak_cheongnyang', kind:'jumak', name:'청량리 주막', x:3435, y:695, w:10, h:8, angle:0, shop:'jumak_cheongnyang' },
    { id:'mapo_yeogak', kind:'market', name:'마포 여각', x:2300, y:1365, w:18, h:12, angle:0, shop:'market_mapo' },
    { id:'mapo_jumak', kind:'jumak', name:'마포 주막', x:2265, y:1360, w:12, h:8, angle:0, shop:'jumak_mapo' },
    { id:'mapo_salt', kind:'warehouse', name:'마포 염창', x:2395, y:1380, w:20, h:10, angle:0 },
    { id:'mapo_smith', kind:'smithy', name:'마포 대장간', x:2330, y:1330, w:10, h:8, angle:0 },
    { id:'mapo_stable', kind:'stable', name:'마포 마방', x:2385, y:1345, w:16, h:10, angle:0, shop:'stable_mapo' },
    { id:'mapo_imbang', kind:'office', name:'보부상 임방(마포)', x:2300, y:1345, w:14, h:10, angle:0 },
    { id:'gwangheungchang', kind:'warehouse', name:'광흥창', x:2140, y:1300, w:30, h:12, angle:0 },
    { id:'yanghwa_jin', kind:'office', name:'양화진 진영', x:1985, y:1250, w:18, h:12, angle:0 },
    { id:'byeolyeongchang', kind:'warehouse', name:'별영창', x:2820, y:1425, w:36, h:14, angle:0 },
    { id:'manrichang', kind:'warehouse', name:'만리창', x:2700, y:1395, w:30, h:12, angle:0 },
    { id:'noryang_jumak', kind:'jumak', name:'노량진 주막', x:2700, y:1640, w:10, h:7, angle:0, shop:'jumak_noryang' },
    { id:'noryang_stable', kind:'stable', name:'노량진 마방', x:2660, y:1660, w:16, h:10, angle:0, shop:'stable_noryang' },
    { id:'office_noryangjin', kind:'office', name:'노량진 진 관아', x:2760, y:1640, w:18, h:12, angle:0, shop:'office_noryangjin' },
    { id:'jumak_origol1', kind:'jumak', name:'오리골 주막', x:1830, y:1712, w:10, h:7, angle:0, shop:'jumak_origol' },
    { id:'jumak_origol2', kind:'jumak', name:'오리골 주막 둘째', x:1872, y:1712, w:10, h:7, angle:0 },
    { id:'jumak_origol3', kind:'jumak', name:'오리골 주막 셋째', x:1850, y:1740, w:10, h:7, angle:0 },
    { id:'jumak_solgogae', kind:'jumak', name:'솔고개 주막', x:1560, y:1712, w:12, h:8, angle:0, shop:'jumak_solgogae' },
    { id:'jumak_sosa1', kind:'jumak', name:'소사 주막', x:1255, y:1703, w:10, h:7, angle:0, shop:'jumak_sosa' },
    { id:'jumak_sosa2', kind:'jumak', name:'소사 주막 둘째', x:1300, y:1703, w:10, h:7, angle:0 },
    { id:'herb_sosa', kind:'herbalist', name:'소사 약방', x:1240, y:1735, w:10, h:7, angle:0, shop:'yakbang_sosa' },
    { id:'smith_sosa', kind:'smithy', name:'소사 대장간', x:1310, y:1740, w:10, h:8, angle:0, shop:'smith_sosa' },
    { id:'stable_sosa', kind:'stable', name:'소사 마방', x:1340, y:1702, w:16, h:10, angle:0, shop:'stable_sosa' },
    { id:'office_bupyeong', kind:'office', name:'부평 관아', x:930, y:1690, w:16, h:10, angle:0, shop:'office_bupyeong' },
    { id:'st_noryangjin', kind:'station', name:'노량진 가설 정거장', x:2400, y:1722, w:24, h:9, angle:0, shop:'ticket_noryangjin' },
    { id:'st_oryu', kind:'station', name:'오류동 정거장', x:1850, y:1775, w:14, h:7, angle:0, shop:'ticket_oryu' },
    { id:'st_sosa', kind:'station', name:'소사 정거장', x:1280, y:1770, w:16, h:8, angle:0, shop:'ticket_sosa' },
    { id:'st_chukhyeon', kind:'station', name:'축현 정거장', x:650, y:1680, w:16, h:8, angle:0, shop:'ticket_chukhyeon' },
    { id:'st_jemulpo', kind:'station', name:'인천 정거장', x:335, y:1640, w:22, h:9, angle:0, shop:'ticket_jemulpo' },
    { id:'customs', kind:'customs', name:'인천 해관', x:440, y:1712, w:20, h:12, angle:0, style:'western' },
    { id:'hotel_daebul', kind:'hotel', name:'대불호텔', x:420, y:1645, w:16, h:14, angle:0, shop:'hotel_daebul', style:'western' },
    { id:'cons_jp_jm', kind:'legation', name:'일본 영사관(제물포)', x:460, y:1580, w:22, h:14, angle:0, style:'jp_wood' },
    { id:'pawn_jm', kind:'pawnshop', name:'일본 질옥', x:480, y:1640, w:10, h:8, angle:0, style:'jp_wood' },
    { id:'inn_steward', kind:'hotel', name:'스튜어드 여관', x:355, y:1612, w:12, h:9, angle:0, style:'cn_brick' },
    { id:'cons_cn', kind:'legation', name:'청국 이사부', x:300, y:1575, w:18, h:12, angle:0, style:'cn_brick' },
    { id:'herb_cn', kind:'herbalist', name:'청국 약재상', x:330, y:1600, w:10, h:8, angle:0, shop:'yakbang_cn', style:'cn_brick' },
    { id:'vcons_uk', kind:'legation', name:'영국 부영사관', x:282, y:1475, w:18, h:12, angle:0, style:'western' },
    { id:'gun_jm', kind:'gunshop', name:'제물포 서양 상회', x:520, y:1470, w:14, h:10, angle:0, shop:'gun_jemulpo', style:'western' },
    { id:'teahouse_jp', kind:'pavilion', name:'일본 찻집', x:585, y:1450, w:12, h:10, angle:0, style:'jp_wood' },
    { id:'naeri_church', kind:'church', name:'내리교회', x:610, y:1575, w:12, h:18, angle:0 },
    { id:'gamniseo', kind:'office', name:'인천감리서', x:670, y:1560, w:22, h:14, angle:0, shop:'office_gamniseo' },
    { id:'post_incheon', kind:'office', name:'인천 우체사', x:600, y:1640, w:10, h:8, angle:0 },
    { id:'gaekju_jm', kind:'market', name:'제물포 객주', x:660, y:1642, w:16, h:9, angle:0, shop:'market_jemulpo' },
    { id:'stable_jm', kind:'stable', name:'제물포 마방', x:700, y:1600, w:16, h:10, angle:0, shop:'stable_jemulpo' },
    { id:'jumak_jm', kind:'jumak', name:'제물포 주막', x:650, y:1598, w:10, h:8, angle:0, shop:'jumak_jemulpo' },
    { id:'smith_jm', kind:'smithy', name:'제물포 대장간', x:690, y:1645, w:10, h:8, angle:0, shop:'smith_jemulpo' },
    { id:'jeonhwanguk', kind:'office', name:'전환국', x:760, y:1505, w:26, h:18, angle:0 },
    { id:'rice_mill', kind:'warehouse', name:'정미소', x:550, y:1750, w:24, h:14, angle:0, style:'western' },
    { id:'coal_jp', kind:'warehouse', name:'일본 석탄고', x:110, y:1490, w:24, h:12, angle:0 },
    { id:'coal_ru', kind:'warehouse', name:'러시아 석탄고', x:90, y:1545, w:26, h:12, angle:0 },
    { id:'hwalbin_hall', kind:'camp_hall', name:'산채 대청', x:1500, y:2132, w:12, h:8, angle:0 },
    { id:'hwalbin_tower', kind:'hut', name:'산채 망루', x:1528, y:2108, w:4, h:4, angle:0 },
    { id:'hwajeok_hall', kind:'camp_hall', name:'불여우패 소굴', x:2390, y:2190, w:12, h:8, angle:0 },
    { id:'hwajeok_tower', kind:'hut', name:'소굴 망루', x:2415, y:2160, w:4, h:4, angle:0 },
    { id:'pirate_cave', kind:'camp_hall', name:'수적 굴', x:1010, y:880, w:10, h:8, angle:0 },
    { id:'pier_mapo', kind:'pier', name:'마포 부두', x:2340, y:1406, w:8, h:20, angle:0 },
    { id:'pier_yeouido', kind:'pier', name:'여의도 나루', x:2340, y:1500, w:8, h:16, angle:0 },
    { id:'pier_yongsan', kind:'pier', name:'용산나루', x:2760, y:1463, w:8, h:20, angle:0 },
    { id:'pier_noryang', kind:'pier', name:'노량진나루', x:2730, y:1562, w:8, h:20, angle:0 },
    { id:'pier_yanghwa_n', kind:'pier', name:'양화진 부두', x:2035, y:1298, w:8, h:20, angle:0 },
    { id:'pier_yanghwa_s', kind:'pier', name:'양화 남안 부두', x:2058, y:1422, w:8, h:20, angle:0 },
    { id:'pier_hangang_n', kind:'pier', name:'한강진 부두', x:3440, y:1388, w:8, h:20, angle:0 },
    { id:'pier_hangang_s', kind:'pier', name:'사평 부두', x:3445, y:1503, w:8, h:20, angle:0 },
    { id:'pier_yeomchang', kind:'pier', name:'염창 둔치 말뚝', x:1810, y:1287, w:6, h:10, angle:0 },
    { id:'pier_jemulpo', kind:'pier', name:'제물포 잔교', x:450, y:1810, w:12, h:76, angle:0 },
    { id:'pier_wolmi', kind:'pier', name:'월미도 선착장', x:185, y:1520, w:24, h:7, angle:0 },
    { id:'pier_wolmi_jm', kind:'pier', name:'제물포 월미 삯배터', x:246, y:1522, w:20, h:6, angle:0 },
  ],
  places: [
    { id:'spawn', name:'노량진 나루길', kind:'spot', x:2707, y:1600, radius:10 },   // 새 게임 시작
    { id:'respawn_hanseong', name:'제중원 앞', kind:'respawn', x:3000, y:889, radius:15 },
    { id:'respawn_mapo', name:'마포나루 앞', kind:'respawn', x:2340, y:1390, radius:15 },
    { id:'respawn_noryang', name:'노량진 주막 앞', kind:'respawn', x:2715, y:1652, radius:15 },
    { id:'respawn_origol', name:'오리골 주막 앞', kind:'respawn', x:1850, y:1728, radius:15 },
    { id:'respawn_sosa', name:'소사 장터', kind:'respawn', x:1280, y:1728, radius:15 },
    { id:'respawn_jemulpo', name:'인천 해관 앞', kind:'respawn', x:440, y:1730, radius:15 },
    { id:'respawn_cheongnyang', name:'청량리 주막 앞', kind:'respawn', x:3435, y:708, radius:15 },
    { id:'respawn_camp', name:'산채 모닥불', kind:'respawn', x:1500, y:2152, radius:10 },   // prologue_done 후
    { id:'naru_noryang', name:'노량진나루', kind:'ferry', x:2730, y:1572, radius:20 },   // ferry_noryang 남쪽
    { id:'naru_yongsan', name:'용산나루', kind:'ferry', x:2760, y:1452, radius:20 },   // ferry_noryang 북쪽
    { id:'naru_mapo', name:'마포나루', kind:'ferry', x:2340, y:1394, radius:20 },
    { id:'naru_yeouido', name:'여의도 나루', kind:'ferry', x:2340, y:1508, radius:15 },
    { id:'naru_yanghwa', name:'양화진', kind:'ferry', x:2035, y:1286, radius:15 },
    { id:'naru_yanghwa_s', name:'양화 남안', kind:'ferry', x:2058, y:1434, radius:15 },
    { id:'naru_hangang', name:'한강진', kind:'ferry', x:3440, y:1376, radius:15 },
    { id:'naru_sapyeong', name:'사평나루', kind:'ferry', x:3445, y:1515, radius:15 },
    { id:'naru_wolmi_jm', name:'월미 삯배터', kind:'ferry', x:258, y:1522, radius:10 },
    { id:'naru_wolmi', name:'월미도 선착장', kind:'ferry', x:172, y:1520, radius:10 },
    { id:'landing_yeomchang', name:'염창 둔치', kind:'ferry', x:1810, y:1300, radius:20 },   // M08 하선
    { id:'market_jongno', name:'종로 시전', kind:'market', x:2940, y:790, radius:60 },
    { id:'market_baeogae', name:'배오개장', kind:'market', x:3100, y:815, radius:35 },
    { id:'market_chilpae', name:'칠패장', kind:'market', x:2530, y:1140, radius:35 },
    { id:'market_mapo', name:'마포 새우젓·소금장', kind:'market', x:2350, y:1385, radius:30 },
    { id:'market_jemulpo', name:'제물포 장터', kind:'market', x:640, y:1625, radius:35 },
    { id:'market_sosa', name:'소사장', kind:'market', x:1280, y:1728, radius:25 },   // 1·6일장
    { id:'vp_namsan', name:'남산 봉수대 터', kind:'viewpoint', x:2875, y:1120, radius:20 },
    { id:'vp_inwang', name:'인왕산 치마바위', kind:'viewpoint', x:2335, y:515, radius:15 },
    { id:'vp_eungbong', name:'각국공원', kind:'viewpoint', x:400, y:1500, radius:20 },
    { id:'vp_gyeyang', name:'계양산 정상', kind:'viewpoint', x:900, y:1125, radius:15 },
    { id:'vp_gwanak', name:'관악산 정상', kind:'viewpoint', x:2650, y:2120, radius:15 },
    { id:'jongno_board', name:'종로 타는 곳 표석', kind:'tram_stop', x:2860, y:798, radius:10 },   // 전차 종로 정류 d=612
    { id:'dongdaemun_board', name:'동대문 타는 곳 표석', kind:'tram_stop', x:3225, y:778, radius:10 },   // d=979
    { id:'bosingak_front', name:'보신각 앞', kind:'spot', x:2860, y:782, radius:8 },
    { id:'lm_fire_1899', name:'종로 2가 (전차 사고 현장)', kind:'landmark', x:2975, y:791, radius:25 },   // 5/26 이후 불탄 전차
    { id:'sungnyemun_in', name:'숭례문 안쪽', kind:'spot', x:2575, y:1068, radius:12 },   // M02·M04
    { id:'gyeongmu_back', name:'경무청 뒷골목', kind:'spot', x:2667, y:714, radius:6 },   // 옥사와 경무청 사이 12m 골목
    { id:'gyeongmu_horses', name:'말 세 필 매는 곳', kind:'spot', x:2660, y:742, radius:6 },   // M03 말 생성
    { id:'gyeongmu_alley_mouth', name:'경무청 골목 어귀', kind:'spot', x:2667, y:730, radius:5 },   // M03
    { id:'gama_stand_jongno', name:'종로 가마꾼 대기소', kind:'spot', x:2830, y:812, radius:8 },
    { id:'chilpae_gama', name:'칠패 보교 대기', kind:'spot', x:2515, y:1118, radius:8 },   // M02
    { id:'pickpocket_run', name:'소매치기 도주 시작', kind:'spot', x:2885, y:790, radius:5 },   // M02
    { id:'m05_hunt', name:'계양산 사냥 자리', kind:'spot', x:910, y:1240, radius:80 },   // M05
    { id:'m05_deer', name:'노루 무리', kind:'spot', x:930, y:1200, radius:15 },   // M05 노루 2
    { id:'m05_pheasant', name:'꿩 자리', kind:'spot', x:880, y:1265, radius:15 },   // M05 꿩 3
    { id:'deokgu_m01', name:'덕구와 먹구름', kind:'spot', x:2770, y:1440, radius:6 },   // M01
    { id:'ambush_m07', name:'진창 매복', kind:'spot', x:1450, y:1726, radius:25 },   // M07
    { id:'yeomchang_horses', name:'염창 둔치 말', kind:'spot', x:1815, y:1312, radius:6 },   // M08 바우와 조랑말 2
    { id:'sail_target', name:'염창 둔치 물가', kind:'spot', x:1810, y:1276, radius:22 },   // M08 돛배 도착 판정
    { id:'yeogak_back', name:'마포 여각 뒷방', kind:'spot', x:2300, y:1378, radius:6 },   // 유선녀·밤 장물아비
    { id:'solgogae_jumak_front', name:'솔고개 주막 앞', kind:'spot', x:1560, y:1720, radius:10 },
    { id:'cut_solgogae', name:'솔고개 굽잇길', kind:'spot', x:1560, y:1808, radius:15 },   // 철로 d=864.1
    { id:'logs_pile', name:'벌목 더미', kind:'spot', x:1590, y:1832, radius:6 },   // 통나무 2개
    { id:'log_target', name:'통나무 놓는 곳', kind:'spot', x:1575, y:1805, radius:5 },   // 철로 d=848.8
    { id:'camp_crossing', name:'산채 건널목', kind:'spot', x:1527, y:1802, radius:6 },   // camp_path × 철로
    { id:'gama_stand_sosa', name:'소사 가마꾼 대기소', kind:'spot', x:1300, y:1723, radius:8 },
    { id:'checkpoint_bupyeong', name:'부평 관아 앞 검문', kind:'spot', x:945, y:1678, radius:20 },
    { id:'chukhyeon_road', name:'축현 옛길', kind:'spot', x:650, y:1613, radius:10 },   // M09 페이드 도착
    { id:'hotel_door', name:'대불호텔 문 앞', kind:'spot', x:420, y:1634, radius:8 },
    { id:'customs_wharf', name:'해관 앞 부두', kind:'spot', x:440, y:1732, radius:20 },
    { id:'pier_jemulpo_head', name:'제물포 잔교 머리', kind:'spot', x:450, y:1842, radius:8 },   // 증기선 승선
    { id:'freight_jemulpo', name:'인천역 화물 하치장', kind:'spot', x:370, y:1680, radius:12 },   // 화차 1량 정차
    { id:'aground_1', name:'모래톱 좌초 지점', kind:'spot', x:1673, y:1105, radius:30 },   // 증기선 d=1190(용산 기준)
    { id:'muakjae', name:'무악재', kind:'spot', x:2236, y:600, radius:20 },
    { id:'torn_jige', name:'찢긴 지게', kind:'spot', x:2256, y:588, radius:4 },   // S3
    { id:'tiger_muak_spawn', name:'범 나타나는 곳', kind:'spot', x:2295, y:600, radius:10 },   // S3
    { id:'widow_hong_home', name:'홍씨 집', kind:'spot', x:2185, y:815, radius:8 },   // S3
    { id:'camp_fire', name:'산채 모닥불', kind:'spot', x:1500, y:2152, radius:3 },
    { id:'camp_pot', name:'노 서방 솥', kind:'spot', x:1488, y:2146, radius:2 },
    { id:'camp_hitch', name:'산채 말뚝', kind:'spot', x:1522, y:2142, radius:4 },
  ],
  zones: [   // ref = 다른 필드의 다각형을 그대로 쓴다. data 는 C·E절 표
    { id:'hunt_gyeyang', kind:'hunting', name:'계양산', x:900, y:1130, r:220 },   // level1 roe_deer .45, pheasant .35, fox .20 / 최대 6
    { id:'hunt_suri', kind:'hunting', name:'수리산', x:1480, y:2320, r:180 },   // level1 roe_deer .40, pheasant .30, fox .15, boar .15 / 최대 6
    { id:'hunt_reedbank', kind:'hunting', name:'한강 하류 갈대밭', poly:[[820,640],[1200,860],[1650,1150],[1900,1330],[1880,1370],[1620,1200],[1150,920],[780,700]] },   // level1 water_deer .65, pheasant .35 / 최대 6
    { id:'hunt_yeouido', kind:'hunting', name:'여의도 모래섬', ref:'sands[0]' },   // level1 water_deer 1.0 / 최대 3
    { id:'hunt_goyang', kind:'hunting', name:'고양 숲', ref:'forests.f_goyang' },   // level2 roe_deer .35, boar .20, fox .15, pheasant .20, wolf .10(밤 .30) / 최대 8
    { id:'hunt_gwanak', kind:'hunting', name:'관악산', x:2650, y:2130, r:300 },   // level2 roe_deer .30, boar .25, fox .15, wolf .30(무리 3~4) / 최대 8
    { id:'hunt_bukhan', kind:'hunting', name:'북한산 기슭', poly:[[1950,0],[3150,0],[3150,250],[2600,310],[2200,330],[1950,250]] },   // level3 boar .35, roe_deer .35, wolf .25, tiger .05(밤) / 최대 7
    { id:'hunt_inwang', kind:'hunting', name:'인왕·무악재', poly:[[2080,420],[2400,420],[2420,560],[2330,690],[2200,700],[2090,600]] },   // level3 roe_deer .40, boar .30, pheasant .25, tiger .05(밤, 하루 1마리) / 최대 5
    { id:'herb_gyeyang', kind:'herb', name:'계양산 골짜기', x:960, y:1040, r:60 },   // h_galgeun 6, h_ssuk 6
    { id:'herb_suri', kind:'herb', name:'수리산 골짜기', x:1470, y:2280, r:110 },   // h_galgeun 4, h_omija 4, h_dangwi 3
    { id:'herb_namsan', kind:'herb', name:'남산 남사면', x:2930, y:1185, r:45 },   // h_doraji 4, h_ssuk 4
    { id:'herb_riverside', kind:'herb', name:'양화 강언덕', x:2080, y:1270, r:40 },   // h_ssuk 6
    { id:'herb_gwanak', kind:'herb', name:'관악산 북사면', x:2600, y:1900, r:70 },   // h_dangwi 4, h_doraji 4
    { id:'herb_bukhan', kind:'herb', name:'북한산 골짜기', x:2350, y:120, r:60 },   // h_omija 5, h_dangwi 4
    { id:'restricted_gyeongbok', kind:'restricted', name:'경복궁', ref:'walls.gyeongbok_wall' },   // army 2 순찰
    { id:'restricted_gyeongun', kind:'restricted', name:'경운궁', ref:'walls.gyeongun_wall' },   // army 4 경비
    { id:'restricted_changdeok', kind:'restricted', name:'창덕궁', ref:'walls.changdeok_wall' },   // army 2
    { id:'restricted_gyeonghui', kind:'restricted', name:'경희궁', ref:'walls.gyeonghui_wall' },   // army 2
    { id:'restricted_hongneung', kind:'restricted', name:'홍릉', x:3520, y:560, r:50 },   // army 2
    { id:'restricted_customs', kind:'restricted', name:'인천 해관', x:440, y:1712, r:16 },   // foreign 2
    { id:'restricted_coal_jp', kind:'restricted', name:'일본 석탄고', x:110, y:1490, r:25 },   // foreign 2
    { id:'restricted_coal_ru', kind:'restricted', name:'러시아 석탄고', x:90, y:1545, r:25 },   // foreign 2
    { id:'restricted_power', kind:'restricted', name:'동대문 발전소', x:3215, y:800, r:25 },   // company 2
    { id:'danger_road_w', kind:'danger', name:'경인 옛길 서쪽', rect:[1000,1680,1480,1760] },   // 노상강도·횃불 행렬 가중치 ×2
    { id:'danger_road_e', kind:'danger', name:'경인 옛길 동쪽', rect:[1640,1690,2100,1770] },   // 노상강도·횃불 행렬 가중치 ×2
    { id:'danger_river', kind:'danger', name:'한강 하류 수적', x:1300, y:860, r:300 },   // 수적 쪽배(F 자유 사건; P는 M10 스크립트만)
  ],
  regions: [  // 앞쪽 우선. wanted = 수배 지역(G절). 어디에도 안 들면 「경기 들판」(gyeongin), 강 칸 「한강」(gyeonggang), 바다 칸 「서해」(jemulpo)
    { id:'gyeongbok', name:'경복궁', ref:'walls.gyeongbok_wall', wanted:'hanseong' },
    { id:'gyeongun', name:'경운궁', ref:'walls.gyeongun_wall', wanted:'hanseong' },
    { id:'changdeok', name:'창덕궁', ref:'walls.changdeok_wall', wanted:'hanseong' },
    { id:'gyeonghui', name:'경희궁', ref:'walls.gyeonghui_wall', wanted:'hanseong' },
    { id:'jeongdong', name:'정동', x:2480, y:900, r:110, wanted:'hanseong' },
    { id:'yukjo', name:'육조거리', poly:[[2665,592],[2775,592],[2775,770],[2665,770]], wanted:'hanseong' },
    { id:'jongno', name:'종로', poly:[[2720,760],[3255,740],[3255,800],[2720,815]], wanted:'hanseong' },
    { id:'bukchon', name:'북촌', x:2875, y:620, r:110, wanted:'hanseong' },
    { id:'seochon', name:'서촌', x:2555, y:600, r:100, wanted:'hanseong' },
    { id:'jingogae', name:'진고개', x:2810, y:1050, r:80, wanted:'hanseong' },
    { id:'baeogae', name:'배오개', x:3150, y:860, r:90, wanted:'hanseong' },
    { id:'namchon', name:'남촌', x:3030, y:980, r:140, wanted:'hanseong' },
    { id:'namsan', name:'남산', x:2870, y:1150, r:150, wanted:'hanseong' },
    { id:'hanseong_in', name:'한성 성안', ref:'walls.hanseong_wall', wanted:'hanseong' },
    { id:'seodaemun_out', name:'서대문 밖', x:2190, y:790, r:120, wanted:'hanseong' },
    { id:'muakjae', name:'무악재', x:2250, y:560, r:80, wanted:'hanseong' },
    { id:'dongdaemun_out', name:'동대문 밖·왕십리', x:3380, y:950, r:170, wanted:'hanseong' },
    { id:'cheongnyang', name:'청량리·홍릉', x:3470, y:650, r:110, wanted:'hanseong' },
    { id:'chilpae', name:'칠패', x:2520, y:1150, r:90, wanted:'hanseong' },
    { id:'mapo', name:'마포', x:2330, y:1370, r:110, wanted:'gyeonggang' },
    { id:'yongsan', name:'용산', x:2780, y:1420, r:110, wanted:'gyeonggang' },
    { id:'yeouido', name:'여의도', ref:'sands[0]', wanted:'gyeonggang' },
    { id:'noryangjin', name:'노량진', x:2620, y:1680, r:150, wanted:'gyeonggang' },
    { id:'yanghwa', name:'양화진', x:2040, y:1300, r:90, wanted:'gyeonggang' },
    { id:'hangangjin', name:'한강진', x:3440, y:1440, r:100, wanted:'gyeonggang' },
    { id:'solgogae', name:'솔고개', x:1560, y:1740, r:110, wanted:'gyeongin' },
    { id:'hwalbin', name:'수리산 산채', x:1500, y:2140, r:120, wanted:'gyeongin' },
    { id:'origol', name:'오리골', x:1850, y:1745, r:120, wanted:'gyeongin' },
    { id:'sosa', name:'소사', x:1280, y:1740, r:130, wanted:'gyeongin' },
    { id:'bupyeong', name:'부평', x:940, y:1705, r:120, wanted:'gyeongin' },
    { id:'bupyeong_field', name:'부평 들', x:950, y:1500, r:300, wanted:'gyeongin' },
    { id:'jm_cn', name:'청국 조계', poly:[[255,1555],[370,1555],[370,1625],[252,1625]], wanted:'jemulpo' },
    { id:'jm_jp', name:'일본 조계', poly:[[380,1560],[500,1560],[500,1660],[380,1660]], wanted:'jemulpo' },
    { id:'jm_intl_w', name:'각국 조계', poly:[[285,1420],[360,1420],[360,1550],[250,1550],[264,1470]], wanted:'jemulpo' },
    { id:'jm_intl_e', name:'각국 조계', poly:[[440,1440],[560,1440],[560,1560],[440,1560]], wanted:'jemulpo' },
    { id:'jemulpo', name:'제물포', x:520, y:1620, r:260, wanted:'jemulpo' },
    { id:'wolmi', name:'월미도', x:110, y:1520, r:80, wanted:'jemulpo' },
    { id:'gyeyang', name:'계양산', x:900, y:1130, r:220, wanted:'gyeongin' },
    { id:'gwanak', name:'관악산', x:2650, y:2130, r:300, wanted:'gyeongin' },
    { id:'inwang', name:'인왕산', x:2330, y:510, r:130, wanted:'hanseong' },
    { id:'bukhan', name:'북한산', x:2550, y:-60, r:330, wanted:'hanseong' },
    { id:'goyang', name:'고양 숲', ref:'forests.f_goyang', wanted:'gyeongin' },
    { id:'suri', name:'수리산', x:1480, y:2300, r:200, wanted:'gyeongin' },
  ],
};
```

### A.4 노선·물길 부가 데이터

**경인선** (`lines.train`, 길이 2,115.4 m, d는 노량진 쪽 끝 (2420,1734)에서 잰 거리. 노량진 → 제물포가 d 증가 = **하행**, 제물포 → 노량진 = **상행**)

| 항목 | d (m) | 좌표 | 비고 |
|---|---|---|---|
| 노량진 가설 정거장 정차점 | 20.1 | (2400, 1735.8) | 동쪽 종점. 지금의 영등포 자리 임시역 [rail-02, rail-08] |
| 안양천 철교 | 256 | (2165, 1757) | `br_anyang_rail` |
| 오류동 정차점 | 572.3 | (1850, 1785) | **요청 정차**(시각표에 없음) [rail-02] |
| 산채 건널목 | 897.7 | (1527, 1802) | `camp_path` 횡단 |
| **솔고개 굽이**(`cut_solgogae`) | 864.1 | (1560, 1808) | 솔고개(언덕) 북쪽 기슭을 깎은 굽이 |
| 통나무 놓는 곳(`log_target`) | 848.8 | (1575, 1805) | M12 |
| **서행 구간** | 804.1 ~ 924.1 | – | 최고 8.0 m/s, `sightLimit` 60 m(곡선·절개지 시야 제한) |
| 소사 정차점 | 1146.1 | (1280, 1780) | 정규 정차 |
| 축현 정차점 | 1782.7 | (650, 1690) | 정규 정차 |
| 건널목 jm4 / jm3 | 1933.1 / 1993.3 | (500,1678.4) / (440,1673.6) | 제물포 조계 신작로 |
| 인천 화물 하치장 | 2060.8 (선로에서 남쪽 17.7 m) | (370, 1680) | 측선 끝, 화차 1량이 늘 서 있다 |
| 인천(제물포) 정차점 | 2105.2 | (330, 1654) | 서쪽 종점 |

- 부평·우각동 역은 압축 때문에 뺀다 **[각색]**(1899 시각표의 부평역 생략을 도감에 밝힘). 부평은 마을과 관아만 있다.
- 궤간 그림 1.435 m **[통설·각색]**, 침목 2.4 × 0.25 m를 0.7 m마다. 승강장은 정차점 기준 선로 북쪽 띠(선로 중심에서 2.8~6.3 m, 길이 50 m)로 엔진이 자동 생성한다.

**전차** (`lines.tram`, 길이 1,345.5 m, 단선 [tram-02]. d는 경교 종점에서)

| 항목 | d (m) | 비고 |
|---|---|---|
| 경교 종점 | 0 | 서문 바로 밖 [tram-02]. 교행 측선 |
| 흥화문 앞 | 216.9 | 교행 측선. 1898년 기공식 자리 [tram-02] |
| 종로 | 612.0 | 요금 구간 경계, 교행 측선. 표석 `jongno_board` (2860,798) |
| 종로 2가 | 727.0 | 5/26 사고 현장 `lm_fire_1899` |
| 배오개 | 832.0 | 교행 측선 |
| 동대문(성안) | 978.9 | 요금 구간 경계, 교행 측선, 차고·발전소 분기 |
| 흥인지문 홍예 | 1009.9 | 성벽이 온전한 문 밑을 지난다 [tram-10] |
| 옹성 북쪽 출구 | 1043.9 | 옹성 열린 쪽(북쪽)으로 빠진다 |
| 보제원 | 1187.4 | 요금 구간 경계, 교행 측선 [tram-05] |
| 청량리(홍릉) 종점 | 1333.3 | 교행 측선 |

- 1899년 전차에는 고정 정류장이 없었다 [tram-06]. 정류장 5곳은 **요금 구간 표석**이며, 전차는 어디서든 손을 든 사람 앞에 선다(C.6).
- 가선(직류 600V [tram-10])은 선로 위 HIGH 층 선 하나, 가선주는 30 m마다 한쪽에. 옹성 안 굽이는 탈것 회전 제한 없이 폴리라인을 따른다.

**한강 증기선** (`lines.steamer`, 길이 4,311.8 m, d는 용산나루에서)

| 항목 | d (m) | 비고 |
|---|---|---|
| 용산나루 | 0 | 상류 종점. `pier_yongsan` 끝에서 4 m |
| 마포나루 | 427.9 | `pier_mapo` 남쪽 끝에서 22 m. 승선은 부두 끝 25 m 안에서 F |
| 양화진 앞 | 741.5 | P에서는 서지 않는다 |
| **좌초 지점**(`aground_1`) | 1189.7 | (1673, 1105). 모래톱 1에서 20 m |
| 바다 시작 | 2604 | 이후 1,708 m는 바다(물살 0, 조류 ±0.4는 F) |
| 제물포 부두 | 4311.8 | `pier_jemulpo` 머리 |

**물살** (`world.flowAt`, 하류 방향 단위벡터 × 값) [각색]

| 조건 | 강 중앙(깊은 물) | 얕은 물 | 지류(안양천·중랑천·청계천·샛강) |
|---|---|---|---|
| 평시(P는 늘 평시) | 0.5 m/s | 0.2 m/s | 0.3 m/s |
| 장마(F) | 1.2 m/s | 0.4 m/s | 0.6 m/s |

나룻배 운행 중지 문턱은 강 중앙 물살 **1.1 m/s 초과**(P에서는 일어나지 않음).

**나루** (`ferries`, 운항 간격은 관선 수를 빈도로 바꾼 것 [각색, river-02])

| id | 북쪽(a) | 남쪽(b) | 폭 | 간격(게임 분) | 성격 | 근거 |
|---|---|---|---|---|---|---|
| ferry_mapo | 마포 부두 (2340,1418) | 여의도 나루 (2340,1494) | 76 m | 20 | 포(浦), 상업 | river-03 |
| ferry_noryang | 용산나루 (2760,1474) | 노량진나루 (2730,1554) | 85 m | 8 | 진(津), 관선, 기차 환승 | river-02, rail-08 |
| ferry_yanghwa | 양화진 (2035,1310) | 양화 남안 (2058,1410) | 103 m | 15 | 진, 진영 검문 | river-02 |
| ferry_hangang | 한강진 (3440,1400) | 사평나루 (3445,1491) | 91 m | 8 | 진 | river-02 |
| ferry_wolmi | 제물포 삯배터 (233,1522) | 월미도 (198,1520) | 35 m | 30 | 민간 삯배 | [창작] |

### A.5 검증 결과 (스크립트로 확인)

| 검사 | 결과 |
|---|---|
| 역 5곳이 철로 위에 있는가 | 모두 선로 위(오차 0.2 m 이하). d는 A.4 |
| 전차 정류점 5곳 | 모두 선로 위(오차 0.4 m 이하) |
| 성문 8곳이 성벽 위에 있는가 | 모두 성곽 폴리라인의 꼭짓점 |
| 궁궐 문 7곳 | 모두 궁장 위 |
| 나루 a·b | 모두 물 위(강은 깊은 물 경계 안쪽, 월미는 바다). 부두 10곳은 한쪽 끝이 뭍(여의도는 모래)이고 다른 끝이 물 |
| 증기선 항로 | 4 m 간격 표본 전부가 깊은 물(강폭 노이즈를 감안해 강 중심에서 반폭의 0.8 이내) 또는 바다. 갯벌·모래톱과 닿지 않는다 |
| 길·철로의 물 건넘 | 모두 다리 위(혜정교·모전교·광통교·수표교·영도교·안양천 나무다리·안양천 철교). 청계천은 얕아 걸어 건넌다 |
| 이름 있는 건물 132채 | 서로, 길, 철로, 성벽과 겹치지 않음(독립문은 길 위의 아치라 `noSolid`) |
| 옹성 | 옹성 안길 가장자리와 옹성 벽 사이 여유 1.75 m, 전차 중심선과 옹성 벽 7 m 이상 |
| 철로 건널목 | 산채 건널목, 제물포 jm3·jm4 세 곳 |

### A.6 지도 상태 변화

| 플래그 | 지도 변화 |
|---|---|
| `rail_construction` | 노량진~소사 침목만, 노량진 역사는 골조(지붕 알파 0.4), `railcamp` 정착지와 인부 NPC 6명 |
| `rail_trial` | 전 구간 레일, 역사 완성, `railcamp` 유지 |
| `rail_open` | `railcamp` 제거, 역 매표소 영업 |
| `tram_suspended` | 종로 2가 (2975,791)에 불탄 전차 잔해(M06 선택이 crowd가 아니어도 군중이 태운다), 나머지 전차는 동대문 차고 앞 측선에 선다 |
| `tram_resumed` | 잔해 치움. 운행 재개 |


---

## B. 팔레트·글꼴·그리는 법

### B.1 핵심 팔레트 (`PAL`, `js/engine/palette.js` 값 그대로 확정)

| 키 | hex | 쓰임 | 키 | hex | 쓰임 |
|---|---|---|---|---|---|
| paper | #efe6d2 | 한지 바탕 | roofTile | #4e5a5e | 기와 |
| paperDeep | #e2d5b8 | 한지 그늘, UI 테두리 | roofThatch | #c2a874 | 초가 |
| ink | #1d1b18 | 농묵: 외곽선, 갓 | timber | #7a5a3c | 목재 |
| ink2 | #4a453d | 중묵: 준법, 물결 | brick | #9b5b47 | 양관 벽돌 |
| ink3 | #8a8272 | 담묵: 먼 산, 바큇자국 | whiteWall | #ece5d3 | 흰 벽 |
| seaDeep | #5f7f8b | 바다 | white | #efeadf | 흰옷 |
| river | #8fb0b3 | 강 | seal | #a8322a | 단청 적, 낙관, 수배 |
| shallow | #b5cbc4 | 얕은 물 | dancheongGreen | #3f7a63 | 단청 녹 |
| mud | #b9ab8e | 갯벌 | gold | #b08d3c | 순검 단추, 금장 |
| sand | #e1d3ad | 모래 | blood | #7a1e16 | 피(먹과 섞어 알파 0.35) |
| paddy / paddyWater | #c2cf98 / #a9c2b0 | 논(6~8월) / 물 댄 논(5월) | night | #1b2a3a | 밤 곱하기 |
| pine | #4f6248 | 소나무 | dusk | #c46a3a | 저녁 |
| road / mainRoad / street | #ddcfac / #d6c59e / #dacbaa | 길 | rail / sleeper | #5a524a / #7b6a55 | 레일 / 침목 |

### B.2 추가 키 (palette.js에 추가)

| 키 | hex | 쓰임 |
|---|---|---|
| lantern | #f2b85b | 등불·횃불·화덕 빛 |
| dawn | #e8c9a0 | 새벽 덧칠 |
| paddyRipe | #cfc77e | 9월 익는 벼 |
| reed | #b8b089 | 갈대밭 바탕 |
| slate | #6c6f73 | 양관 지붕, 군함 |
| jpRoof | #3e4447 | 일본식 지붕 |
| cnBrick | #7c7a76 | 청국 벽돌 |
| sail | #d4a64a | 황포 돛 |
| tiger | #c98a3c | 범 바탕 |
| uniform | #2b2d33 | 순검 제복 |
| armyCoat | #2c3550 | 시위대 군복 |
| jade | #d8e3dc | 옥색 도포 |
| jangot | #6b8a5e | 장옷 |
| peddlerHat | #c9b27a | 보부상 패랭이 |
| tram | #7a3b2e | 전차 차체(적갈, 하나로 확정) [각색] |
| coach1 / coach2 / coach3 | #2f3a5a / #9a7a3a / #6b5a48 | 객차 1등(남색+금선) / 2등(황갈) / 3등(갈색) [각색] |

### B.3 세력 강조색 (색상각 30° 이상 간격, 검증함)

세력은 옷 전체가 아니라 **작은 강조(띠·두건·완장)와 미니맵 점**으로만 구분한다. 적대 상태는 색이 아니라 **머리 위 붉은 사각 낙관 0.3 m**로 보인다(색맹 대응).

| faction | 강조색 | 색상각 | 옷 | 머리 표지 |
|---|---|---|---|---|
| army | #a8322a (seal) | 4° | armyCoat | 군모 + 붉은 띠 |
| police | #b08d3c (gold) | 42° | uniform + 금 단추 | 제모. **상투 60% / 단발 40%** 섞음(이시중은 단발) [life-01] |
| guild | #7a913b | 76° | 흰옷 | 패랭이 + 양옆 솜뭉치 [pol-07] |
| hunter | #427f39 | 112° | timber 조끼 | 상투, 화승 불씨 점 |
| pirate | #317752 | 148° | 해진 회갈 #8a7f62 | 수건 |
| company | #2e757a | 184° | 짙은 감청 | 조선인 경비는 상투+전립, 일본인 경비는 모자(문화 표지 하나만) |
| gang | #3c679f | 214° | 흰옷·갈색 | 두건 |
| foreign | #5c5095 | 250° | 양복 #3b3530 / 하오리 #34405a / 장포 #3a3f4a | 서양 모자 / 일본식 깃 / 변발 중 **하나만** |
| bounty | #70447e | 286° | 짙은 갈색 | 삿갓 |
| rival | #8d356d | 322° | 해진 회갈 #8a7f62 | 머리띠 |
| civilian | 없음 | – | white / jade(양반) / jangot(여성) | 갓·상투·장옷 |

플레이어(한길)는 gang 색에 쪽빛 두루마기 끝선을 2 px 굵게 그려 늘 구분한다.

### B.4 글꼴 (`FONT`, 확정)

| 키 | 글꼴 | 용도 | 크기(CSS px) |
|---|---|---|---|
| body | Gowun Batang 400/700 | 대사, 목표, 메뉴, 숫자 | 15~18 |
| display | Song Myung | 타이틀, 장 제목, 지역 배너, 낙관 글자 | 28~64 |
| brush | Nanum Brush Script | 신문 제호, 격문, 편지 | 22~32 |

한자 글리프가 없으면 Batang으로 폴백. 다른 한글 글꼴은 더 넣지 않는다.

### B.5 그리는 법 요약

| 대상 | 규칙 |
|---|---|
| 층 순서 | 담채(알파 0.35~0.6, 경계 흐림) → 먹선(농·중·담, 굵기 가변) → 먹점(알파 0.7~0.9) |
| 붓선 | `brushStroke(ctx, pts, {w0, wMid, w1, color, alpha, dry, seed})`: 법선 오프셋 다각형 채우기. 해안·강기슭 0.35/0.25/0.1 알파 0.7, 준법 0.2/0.3/0.05 알파 0.35~0.5, 건물 외곽 0.08/0.06/0.06, 인물 외곽 0.035 고정 |
| 흔들림 | 외곽선 ±0.08 m, 채색은 선보다 0.15~0.3 m 어긋나게. 모두 객체 id 시드로 고정(프레임마다 바뀌지 않음) |
| 빛 | 광원은 북서 고정. 그림자 방향 (+0.6, +0.8), 길이 = 높이 × 0.35, 색 ink 알파 0.15 |
| 고채도 | 화면 면적 3% 이하(단청, 낙관, 피, 등불) |
| 산 | 흙산 피마준(등고선 따라 3~8 m 획), 바위산 부벽준(1~2.5 m 쐐기), 능선 태점 3~7개 |
| 물 | 물결 "∽" 획: 줄 간격 5 m, 길이 2.5~4.5 m, 바다는 해안 쪽으로 0.3 m/s, 강은 `flowAt` 속도 |
| 기와 지붕 | 안허리곡 0.15 m, 추녀 0.4 m 들림, 용마루 0.35 m ink2, 기왓골 0.3 m 간격 알파 0.18, 북서 비탈 +8% 밝게 |
| 초가 | 둥근 사각(모서리 30%), 테두리 0.3 m, 용마름 지그재그, 짧은 획 60~120개 |
| 성벽 | 몸체 4 m, 여장 1.0×0.6 m를 2.2 m마다, 안쪽 그늘 1.5 m |
| 문루 | 2층 문은 지붕 두 겹, 처마 안쪽 단청 띠(녹·적 0.6 m씩) |
| jp_wood / cn_brick | 일본식: 직선 박공·곡선 없는 처마 jpRoof, 세로 간판. 청국식: 회색 벽돌, 용마루 끝 갈고리, 처마에 붉은 등 점 |
| 인물 | 몸통 타원 0.30×0.19, 머리 r 0.11, 팔 0.32 캡슐 ±25°, 발 0.09×0.13 ±0.18 m. 아이 ×0.7. 사망은 먹 번짐 웅덩이 |
| 희화화 금지 | 외국인은 문화 표지 한 가지만, 얼굴·체형·피부색을 다르게 그리지 않는다 |
| 동물 | 몸통 타원 + 머리 원 + 꼬리 획 + 다리 4획. 범: 2.0×0.6 tiger + 먹 줄무늬 9획. 고라니: 송곳니 흰 획 2개 [hunt-05] |
| 말 다리 | 위상 φ += 속도/보폭·dt. 보폭 평보 1.6, 속보 2.4, 구보 3.0, 습보 4.2 m(과하마 ×0.85). 진폭 0.12/0.20/0.30/0.38 m. 다리 위상 오프셋[LF,RF,LH,RH]: 평보 [.25,.75,0,.5], 속보 [0,.5,.5,0], 구보 [.3,.6,0,.3], 습보 [.5,.6,0,.1] |
| 탈것 | 전차: 9.0×2.1 tram색, 가운데 4.6 m 지붕 칸(상등), 앞뒤 승강대 2.2 m(하등), 집전봉 3.3 m. 기관차: 보일러 5.0×1.3, 굴뚝 r 0.3, 양옆 물탱크(탱크기관차) [rail-03]. 나룻배: 평저 8×2.4, 노 ±0.35 rad 0.9 Hz. 돛배: 9×2.4, 돛 sail 알파 0.85 + 살대 5줄 |
| 효과 | 연기 r 0.6→3 m 3초, 화승총 연기 r 2 m 4초, 총구 화염 2프레임, 입자 화면 전체 300개 상한 |
| 밤 | 0~4시 night 곱하기 0.62, 4.5~6시 night 0.3 + dawn 0.18, 17~18.5시 dusk 0.22, 19~20시 #2a2f4a 0.45. 1899년 거리에 전등 없음 [pol-10] |
| UI | 한지 패널(이중 먹 테두리), 낙관 도장 아이콘(事 미션, 商 상점, 酒 주막, 津 나루, 驛 역, 電 전차, 獵 사냥터, 藥 약초·약방, 馬 마방, 典 장물, 北 방위), 수배는 사각 낙관 4칸 |
| 금지 | 매 프레임 `createRadialGradient`, `shadowBlur`, `ctx.filter`, 루프 안 `getImageData`, 매 프레임 글자 렌더 |

### B.6 소리 (기존 `audio.js` 이름 유지, 추가분만)

| 구분 | 추가 | 규칙 |
|---|---|---|
| 곡 | `modern`(전차 안·정동·기차: 오르골풍 사인 벨과 평조 가야금이 한 마디씩 번갈아), `sorrow`(전차 방화 뒤·사망: 계면조 거문고 저음 + 대금, 장단 없음) | `port`는 F |
| 효과음 | `jing`(사인 150 Hz + 1.02배 맥놀이, 4초), `tram_motor`(톱니 80→240 Hz 속도 비례 + 가선 불꽃 0.3회/초), `tiger`(톱니 60~90 Hz + 노이즈, 트레몰로 18 Hz, 가청 400 m), `wolf`(사인 420→620→450 Hz 3초), `firecracker`(클릭 20~60개, 20~90 ms 간격) | `nabal` 등은 F |
| 폭죽 | 청국 조계에서 **사건이 있을 때만**(상점 개업·명절·배 입항, 게임 하루 1~2회) 30~60초. 상시 배경음으로 깔지 않는다 | 한 민족을 소음으로 표지하는 상투형 방지 |
| 기적 | `train_whistle`은 출발 2초 전·건널목 150 m 전. 독립신문이 우레에 비유한 소리 [rail-09] | |
| 장소 배경 | 한성 성안 crowd + 까치, 종로·전차 crowd + 종·모터(곡 modern), 강변 water + 물새, 논 frogs(6~8월), 산·숲 wind + 꿩(밤 늑대 먼 울음), 제물포 sea + 갈매기 | |

---

## C. 탈것

### C.1 탈것 수치 (P에 들어가는 전부)

`maxSpeed`는 방향키만, `sprintSpeed`는 Shift. 반지름은 지형 충돌용, 맞음 판정은 원 여러 개(`hitCircles`). 치수는 충돌 판정 기준이다.

| vtype | 이름 | 클래스 | moveMode | L×W (m) | 반지름 / 맞음 원 | 저속 단계 | maxSpeed | sprint | 후진 | accel | decel | brake (급) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pony | 과하마(짐 조랑말) | 말 | horse | 1.9×0.55 | 0.35 / 2개 ±0.5 | 평보 1.8, 속보 3.6 | 6.0 구보 | 9.5 습보 | 1.0 | 3.0 | 2.5 | 6.0 (9.0) |
| jeju_horse (`horse` 별칭) | 제주마(승용 조랑말) | 말 | horse | 2.0×0.6 | 0.38 / 2개 ±0.5 | 평보 1.9, 속보 4.0 | 6.5 | 10.8 | 1.0 | 3.4 | 2.5 | 6.0 (9.0) |
| oxcart | 소달구지 | 메는·끄는 | wheel | 5.6×1.8 | 0.9 / 3개 | – | 1.4 | 1.7 회초리 | 0.5 | 0.35 | 0.8 | 1.5 |
| gama (kind `bokyo`) | 보교 | 메는·끄는 | foot | 3.2×1.2 | 0.7 / 2개 | – | 2.2 | 2.8 재촉 | 0.4 | 0.8 | 1.5 | 2.0 |
| rickshaw | 인력거 | 메는·끄는 | wheel | 2.6×1.15 | 0.55 / 2개 | – | 플레이어 3.4 / NPC 3.2 | 4.4 / 3.8 | 0.6 | 1.6 | 1.8 | 3.5 |
| rowboat | 나룻배(평저선) | 배 | boat | 8.0×2.4 | 1.1 / 3개 | – | 1.8 (사공 1.7) | 2.4 힘껏 | 0.6 | 0.5 | 0.35 | 0.9 |
| sailboat | 황포돛배 | 배 | boat | 9.0×2.4 | 1.2 / 3개 | 노 0.9, 함께 저으면 1.2, 삿대 1.3 | 바람(C.5), 최대 4.5 | – | 0.4 | 0.25 | 0.2 | 0.5 |
| steamer | 한강 증기선 | 배 | boat | 20.0×4.2 | 2.0 / 5개 | – | 물에 대해 4.6 | – | 1.0 | 0.15 | 0.12 | 0.3 |
| tram | 전차 | 선로 | rail | 9.0×2.1 | 원 3개 r 1.05 (x −3, 0, +3) | 노치 1 = 1.5, 2 = 3.0 | 4.5 (노치 3) | 5.4 (노치 4) | – | 0.7 | 0.15 | 1.1 (비상 2.2) |
| train | 경인선 열차 | 선로 | rail | 기관차 9.13×2.64, 객차 11.0×2.6, 화차 9.0×2.6 | 칸마다 원 3개 | 서행 8.0 | 15.3 | – | – | 1.0 | 0.05 | 1.2 (비상 1.6) |

| vtype | turnRate | turnRefSpeed | turnInPlace | 습보 회전 배수 | grip | 탑승 | 짐 | HP | 기력 | 질량 kg | cameraZoom | 행인 치기 (임계 / 배수) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pony | 3.0 | 1.5 | 0.6 | 0.6 | 9 | 1 + 동승 1 (동승 시 속도 ×0.75) | 안장주머니 12칸 + 큰 짐승 1 + 작은 짐승 4 | 220 | 120 | 260 | 0.95 | 3.2 / ×1.0 |
| jeju_horse | 2.8 | 1.5 | 0.6 | 0.55 | 8 | 1 + 1 | 10칸 + 1 + 4 | 200 | 100 | 300 | 0.95 | 3.2 / ×1.0 |
| oxcart | 0.7 | 0.8 | 0.15 | – | 20 | 몰이꾼 1 + 짐칸 2 | 24칸 + 큰 짐승 4 | 350 | 소 100 | 900 | 1.0 | 넘어뜨리지 않고 1 m 밀기 |
| gama | 1.2 | 0.5 | 0.8 | – | 30 | 가마꾼 2(crew) + 손님 1 | 2칸 | 가마 120, 가마꾼 각 60 | 가마꾼 100 | 210 | 1.0 | 1 m 밀기 |
| rickshaw | 2.0 | 0.8 | 0.5 | – | 14 | 차부 1 + 손님 1 | 3칸 | 120 | 끄는 사람 기력 | 110 | 1.0 | 3.2 / ×0.6 |
| rowboat | 0.55 | 0.6 | 0.4 | – | 1.5 | 사공 1 + 8 (말 1필 = 4자리) | 6칸 | 150 | 노 젓는 사람 기력 | 600 | 0.9 | 헤엄치는 사람 1.5 / ×0.8 |
| sailboat | 0.45 | 1.2 | 0.1 | – | 1.0 | 키잡이 1 + 선원 1 + 3 | 30칸 | 300 | – | 2,500 | 0.75 | – |
| steamer | 0.15 | 2.0 | 0.05 | – | 0.8 | 승무원 4 + 승객 46 (보이는 자리 12) | 화물(배경) | 1,500 | – | 30,000 | 0.6 | – |
| tram | 선로 | – | – | – | – | 운전수 + 차장 + 40 (상등 8, 하등 32) + 매달림 4 | – | 800 | – | 6,000 | 0.85 | 2.0 / ×2.5 |
| train | 선로 | – | – | – | – | 기관사·화부·차장 2·경비 2 + 1등 8 · 2등 24 · 3등 40×2 | 화차 | 기관차 3,000, 객차 1,200 | – | 기관차 34,300 [rail-03] | 0.7 (승객 0.6) | ≥ 3.0 즉사, < 3.0 1.5 m 밀고 피해 10 |

**도보·헤엄** (코어 `Human`. ※는 코어 변경)

| 동작 | 키 | 속도 | 기력 |
|---|---|---|---|
| 걷기 | CapsLock 토글 | 1.5 | +8/s |
| 달리기 | 방향키 | 3.8 | +8/s |
| 질주 | Shift | 5.6 | −11/s |
| 웅크리기 | C 토글 | 1.0 | +8/s |
| 조준하며 이동 | 오른쪽 버튼 | ≤ 1.65 | – |
| 헤엄 | 깊은 물 자동 | 1.1 | **※ −1.0/s** |
| 빠른 헤엄 | 헤엄 중 Shift | **※ 1.6** | **※ −5/s** |
| 기력 0인 채 헤엄 | – | 0.6 | 체력 −4/s (`drown`) |
| 구르기 | Space | 0.45초에 1.8 m | −12 |

※ 이유: 한강 깊은 물 폭 90~110 m를 건널 수 있어야 한다(110 m ≈ 100초).

**좌석 배치** (로컬 좌표 +x 앞)

| vtype | 좌석 (index: role, pose, x, y) |
|---|---|
| 말 | 0 driver ride (0.05, 0) / 1 passenger ride (−0.5, 0) |
| oxcart | 0 driver sit (0, −0.5) / 1 passenger sit (−1.2, −0.4) / 2 passenger sit (−1.2, 0.4) |
| gama bokyo | 0 driver carry (1.3, 0) / 1 crew carry (−1.3, 0) / 2 passenger hidden (0, 0) |
| rickshaw | 0 driver pull (0.95, 0) / 1 passenger sit (−0.35, 0) |
| rowboat | 0 driver row (−3.3, 0) / 1~8 passenger sit, x ∈ {1.8, 0.6, −0.6, −1.8}, y = ±0.55 |
| sailboat | 0 driver stand (−3.8, 0) 키 / 1 crew row (−2.2, 0.6) / 2~4 sit (−0.8, ±0.6), (0.6, 0) |
| steamer | 0 driver stand (−2.0, 0) 조타실 / 1~3 crew / 4~15 갑판 sit 12자리. 나머지는 숫자로만 |
| tram | 0 driver (4.1, 0) / 1 crew 차장 (−4.0, 0.6) / 2~9 상등 sit x ∈ {−1.5, −0.5, 0.5, 1.5}, y = ±0.6 / 10~17 하등 sit x = ±3.3, y ∈ {−0.6, −0.2, 0.2, 0.6} / 18~21 매달림 stand `outside` (±4.4, ±1.15) |
| train | 기관차 0 driver (−3.5, 0.6), 1 crew (−3.5, −0.6) / 객차 칸마다 sit 12 + 매달림 4 (±5.2, ±1.0) / 화차 hidden 2 |

### C.2 지형별 속도 배율 (탈것별 최종값, ✗ = 통행 불가)

| 지형 | 과하마 | 제주마 | 보교 | 인력거 | 소달구지 | 나룻배 | 돛배 | 증기선 |
|---|---|---|---|---|---|---|---|---|
| SEA·RIVER | ✗ | ✗ | ✗ | ✗ | ✗ | 1.0 | 1.0 | 1.0 |
| SHALLOW | 0.6 | 0.6 | 0.45 | ✗ | ✗ | 0.7 | 0.5 (삿대) | ✗(좌초) |
| MUD | 0.5 | 0.45 | 0.4 | ✗ | ✗ | ✗ | ✗ | ✗ |
| SAND | 0.8 | 0.8 | 0.75 | 0.6 | 0.6 | ✗ | ✗ | ✗ |
| GRASS | 1.0 | 1.0 | 0.95 | 0.75 | 0.75 | ✗ | ✗ | ✗ |
| FIELD | 0.8 | 0.8 | 0.8 | 0.6 | 0.6 | ✗ | ✗ | ✗ |
| PADDY | 0.6 | 0.55 | 0.5 | ✗ | ✗ | ✗ | ✗ | ✗ |
| FOREST | 0.69 | 0.6 | 0.6 | ✗ | ✗ | ✗ | ✗ | ✗ |
| MOUNTAIN | 0.58 | 0.5 | 0.5 | ✗ | ✗ | ✗ | ✗ | ✗ |
| ROAD | 1.1 | 1.1 | 1.0 | 1.0 | 1.0 | ✗ | ✗ | ✗ |
| MAIN_ROAD | 1.15 | 1.15 | 1.0 | 1.1 | 1.1 | ✗ | ✗ | ✗ |
| STREET | 1.0 | 1.0 | 1.0 | 1.05 | 1.05 | ✗ | ✗ | ✗ |
| YARD | 0.9 | 0.9 | 0.95 | 0.9 | 0.9 | ✗ | ✗ | ✗ |
| BRIDGE | 1.05 | 1.05 | 1.0 | 1.0 | 1.0 (폭 2.5 m 미만 다리는 충돌로 막힘) | 밑으로 통과 | 밑으로 통과 | ✗ |
| RAIL | 0.8 | 0.8 | 0.8 | 0.5 | 0.5 | ✗ | ✗ | ✗ |
| PIER | 0.9 | 0.9 | 0.95 | 0.9 | 0.9 | 0.5 | 0.5 | 0.5 |
| REED | 0.55 | 0.5 | 0.45 | ✗ | ✗ | 0.4 | 0.3 | ✗ |

- 말은 깊은 물에 들어가지 않는다. 한강에는 1899년에 다리가 없으므로(철교 1900년 [rail-07]) 말과 강을 건너려면 나룻배에 태운다(말 1필 = 4자리, 사공 팁 3전).
- 비: 바퀴 탈것이 ROAD·STREET·FIELD·SAND에서 ×0.85, 말 ×0.95, 소달구지 진흙 빠짐 확률 ×2.

### C.3 공통 규칙

| 규칙 | 값 |
|---|---|
| 타기·내리기 | F. 플레이어와 가장 가까운 좌석 지점(같은 거리면 운전석 > 승객석 > 매달림). 연출 시간(조작 잠금): 말 0.6초, 인력거 0.5(승객 0.8), 소달구지 0.8, 보교 1.2, 나룻배 0.7, 돛배 1.0, 정차한 전차 0.6, 정차한 기차 1.0, 달리는 전차·기차 매달리기 0.4 / 0.8 |
| 빼앗기 | 운전석에 NPC가 있고 `stealable`이면 F로 끌어내린다(`knockDown(3, 2초)`). P에서 빼앗을 수 있는 것: 말, 나룻배, 인력거, 소달구지. 전차·기차·증기선·보교는 못 빼앗는다 |
| 빼앗기 범죄 | 주인이 보는 앞에서 매어 둔 말·배 사용 = theft(1단계). 탑승자 끌어내리기 = theft + assault(1단계, 피해자가 양반·관리·외국인이면 2단계). 목격 반경 낮 25 m, 밤 12 m |
| 달리는 탈것에서 뛰어내리기 | 3.2 m/s 초과일 때 F. 구르며 넘어짐 1.2초, 피해 = (속도 − 3) × 4. 열차 15.3 m/s면 49, 서행 8 m/s면 20. 물로 뛰어내리면 피해 ×0.25 |
| 달리는 열차·전차에 올라타기 | **누구나** 가능. 승강대 옆 2.5 m 안에서 F, 속도 차가 **기차 3.0 / 전차 2.0 m/s 이하**. 실패하면 피해 (속도차 − 3) × 4 + 5 |
| 벽 충돌 | 속도 4 초과면 `vehicle:crash`, 속도 ×0.35, 탈것 피해 (속도 − 4) × 질량등급(말 6, 수레 4, 배 10) |
| 탈것끼리 | 상대 속도 Δv ≥ 4면 양쪽 HP를 Δv × (상대 질량 / 두 질량 합) × 20만큼 깎는다 |
| 낙마 | 충돌 속도가 임계(유대 1단계 6 m/s, 2단계 7 m/s) 이상이면 떨어진다. 피해 (속도 − 임계) × 6 + 5, 넘어짐 1.5초 |
| 행인 치기 | 피해 = max(0, 속도 − 임계) × 7 × 배수(C.1), 임계 이상이면 넘어짐 1.8초. 플레이어가 운전자면 `trample` + `crime(assault)` |
| 행인 반응 | 앞 30° 부채꼴, 거리 (속도 × 1.2 + 2) m 안 행인이 낮 85% / 밤 55% 확률로 옆으로 1.8 m 비킨다. 전차 종·기적·"비키시오"(말 위 E)는 앞 25 m 안에서 100%. 선로에서 자는 사람은 종에 50%만 깬다 [tram-11] |
| 신문물 구경 | 반경 12 m NPC가 2초 멈춰 쳐다본다: 전차 30%(개통 축제 80%), 기차·증기선 40% [tram-11] |
| 카메라 | 줌 = clamp(화면 짧은 변/30, 12, 28) × clamp(1 − 속도 × 0.026, 0.45, 1) × 휠(0.35~2.2) × `cameraZoom`. 북쪽 위 고정 |
| 탈것 위 사격 | 말: 운전 중 가능, 흔들림 평보 0°·속보 +2°·구보 +4°·습보 +7°(유대 2단계 ×0.85), 화승총 장전은 정지·평보에서만. 소달구지: 정지 때만. 보교 승객: +3°(쏘면 가마꾼 70%가 가마를 내려놓고 달아남). 인력거: 승객만 +3°. 나룻배: 노 젓는 중 불가(조준하면 노가 멈춤), 승객 +2°. 돛배 키잡이: 육혈포만. 전차·기차 승객: +2°(기차 10 m/s 초과 +3°) |
| 소유 | `player` 사라지지 않음 / `stolen` 게임 2시간 '도난' 상태, 순검이 30 m 안에서 보면 50% 검문 / `public` 대여품·관선·노선 차량 / NPC id |
| 정리 | `player` 소유가 아닌 탈것은 180 m 넘게 떨어지고 화면 밖 30실초면 지운다. 노선 차량은 지우지 않는다 |
| 밤 고용 거부 | 가마꾼·인력거꾼·사공은 21~5시에 일을 거부한다. 삯 ×3이면 응한다 [land-10] |

### C.4 말

| 항목 | 규칙 |
|---|---|
| 걸음새 기력 | 평보 +12/s, 속보 +8/s, 구보 과하마 +3 / 제주마 +1, 습보 −5/s × (과하마 0.8, 제주마 1.0), 정지 +15/s. 습보 지속: 과하마 30초(약 285 m), 제주마 20초(약 216 m) [평보 1.8 m/s는 land-06, 나머지 각색] |
| 기력 0 | 습보가 풀려 구보. Shift를 계속 누르면 말이 버틴다(0.8초 고개 젓기, 속도 −30%, 1초마다 HP −2, 유대 XP −1) |
| 수말 싸움 | 과하마끼리 2.5 m 안에 3초 넘게 있으면 30%(유대 2단계 15%) 확률로 물고 찬다. 양쪽 HP −10, 놀람 1초 [land-06] |
| 총소리 놀람 | 25 m 안 총소리: 유대 1단계 35%, 2단계 25%. 앞발 들고 1.2초 조종 불가, 1단계면 그동안 20% 낙마. 범이 30 m 안이면 확률 ×2 |
| 유대(P는 1~2단계) | XP: 타고 50 m +1(하루 최대 +60), 말죽 +6, 쓰다듬기(말 옆 E, 120실초 쿨) +3, 휘파람으로 불러 타기 +1, 마방 치료 +5. 때리기·쏘기 −30. 2단계 문턱 60 XP. 오르면 `horse:bond {level}` |
| 유대 효과 | 1단계: 휘파람 반경 80 m, 낙마 임계 6 m/s / 2단계: 휘파람 150 m, 최대 기력 ×1.1, 습보 소모 ×0.95, 낙마 임계 7 m/s, 조준 흔들림 ×0.85, **뒷발차기(C)** 해금. 스킬 `gim_bond`는 휘파람 반경 ×1.5 |
| 휘파람(H 탭) | 반경 안이면 길찾기(`horse`)로 구보 7 m/s로 와서 2 m 앞에 선다. 반경 밖: "말이 너무 멀리 있습니다". 마방에 맡겼으면 "마방에서 찾으시오" |
| 뒷발차기 | C, 유대 2단계. 뒤쪽 120°·2.2 m 안 1명에 피해 35, 3 m 밀기, 쿨 4초. 사람이면 assault |
| 앞발 들기 | 멈춘 채 Space. 반경 6 m NPC가 물러선다. 쿨 5초 |
| 급정지 | 구보 이상에서 Space = 9.0 m/s², 0.3초 동안 grip 3(미끄러짐) |
| 먹이 | `f_maljuk` 말죽: 말 기력 +40, HP +20, 유대 XP +6 [land-06 끓인 죽] |
| 다침 | HP 30% 미만이면 절뚝거림(구보 ×0.6, 습보 불가). 습보 중이 아니면 HP +1/s |
| HP 0 | `horse:down`. 10초 뒤 화면에서 사라지고 **가장 가까운 마방**으로 옮겨져 HP 30%로 기다린다(토스트 "먹구름이 ○○ 마방으로 실려 갔소"). 말은 죽지 않는다(P) |
| 플레이어 말 | M01 보상 '먹구름'(pony, 수말, 적갈, 유대 1단계). 600 m 넘게 떨어진 채 빠른 이동·미션 순간이동을 하면 가장 가까운 마방에 맡겨진다. M08 끝에는 산채 말뚝으로 옮겨 둔다 |
| 마방 | 말죽 2전, 치료 20전(HP 가득), 맡기기 무료(2필), 세마(대여) 하루 30전 + 보증금 300전(24게임시 안에 아무 마방에 돌려주면 보증금 반환), 과하마 구입 2,500전, 제주마 구입 4,000전 [각색, land-06·land-07] |

### C.5 배

| 항목 | 규칙 |
|---|---|
| 나룻배 노 젓기 | 방향키로 뱃머리를 돌리며 1.8 m/s(기력 −0.8/s), Shift 2.4 m/s(−6/s), Space 노 멈춤. 땅에 대한 속도 = 물에 대한 속도 + `flowAt`. 노량진 앞 85 m는 약 50초, 물살에 약 25 m 떠내려감 |
| 플레이어가 직접 젓는 구간 | 미션에서는 **200 m 이하**로만 쓴다(M04 85 m) |
| 나루 운행 | 승객 3명 이상, 또는 첫 승객 뒤 40실초, 또는 플레이어가 E "출발하세". 관선은 공식적으로 무료, 팁 0전이면 사공 속도 ×0.85에 투덜거림, 1전 보통, 3전 ×1.15 + 소문 한 줄 [river-06]. 말·가마는 따로 한 척(팁 3전). 수배 2 이상이면 사공이 태우지 않는다(배를 훔치거나 헤엄) |
| 돛배 바람 | 풍속 W = strength × 12. 돛 각도 α = \|angleWrap(뱃머리 − wind.angle)\|. 효율 f(α): 0° 0.55, 30° 0.75, 60° 0.90, 90° 0.80, 110° 0.45, ≥120° 0, 사이는 직선 보간 [각색] |
| 돛배 속도 | 목표 = min(4.5, W × 0.8 × f(α) × 돛). **돛 3단: 0, 0.5, 1**. 돛 속도가 노보다 느리면 노(선원 0.9, 함께 저으면 1.2), 얕은 물은 삿대 1.3. 돛과 노는 더하지 않고 큰 값. 옆밀림 W × 0.03 × 돛 |
| 돛배 조작 | 방향키 = 키(속도와 무관), Shift 탭 돛 올림, Space 탭 돛 내림, Space 1초 = 돛 0 + 닻 |
| 증기선 | 플레이어는 승객만. 물에 대한 속도 4.6 m/s. 강 구간 상행 4.1 / 하행 5.1 m/s, 바다 구간 4.6 m/s. Space 1초 = 빨리감기 ×8(사건 생기면 풀림) |
| 증기선 승선 | 정박 중 부두 끝 25 m 안에서 F. 사무장이 10초 안에 뱃삯 요구, 무시하면 다음 정차지에서 하선 요구(fare_evasion) |
| 좌초 | P는 M10 스크립트만(`aground_1`). 자유 좌초 확률은 F |
| 침몰 | 나룻배 HP 0이면 10초 동안 가라앉고 탄 사람은 헤엄 |

### C.6 전차 운행

| 항목 | 값 |
|---|---|
| 차량 | 40인승 개방형. 운행 5대, 예비 3대는 동대문 차고 [tram-04]. 귀빈차는 F |
| 운행 시간 | 게임 06:00~20:00 |
| 배차 | 양 종점에서 160실초(게임 80분)마다 1대 출발. 종점 정차 30실초 뒤 `angle += π` |
| 속도 | 노치 3 순항 4.5 m/s, 노치 4 최고 5.4(시속 12마일), 정차 포함 평균 약 2.2(시속 5마일) [tram-06]. `tram_festival`(5/17)에는 d 612~800에서 최고 3.0 |
| 호출 | 선로 중심 4 m 안에서 E(손 들기 1초). 앞쪽 15~120 m에서 다가오는 전차가 승강대가 플레이어 옆에 오도록 선다. NPC도 손을 든다. 고정 정류장 없음 [tram-06] |
| 정차 | 6초 + 타고 내리는 사람 1명당 1초 |
| 칸 | 앞뒤 승강대로 타면 하등, 가운데 옆문으로 타면 상등. **칸은 신분이 아니라 요금으로 나뉜다**(평민도 상등 가능) [tram-04, eco-08] |
| 내리기 | 안에서 E "내리겠소" → 20 m 이상 앞에서 선다. 3.2 m/s 이하면 F로 그냥 내려도 구르지 않음 |
| 운전수 | 5/17~5/26: 일본인 운전수(교토 시전 경력), 조선인 차장. 9/28 이후: 미국인 운전수, 조선인 차장 [tram-07] |
| 교행 | 측선 7곳(A.4). 블록(측선 사이 단선 구간)에 반대 방향 전차가 있거나 예약돼 있으면 측선에서 기다린다. 같은 방향은 60 m 간격으로 뒤따름 |
| 장애물 | NPC 운전수는 25 m 앞 장애물에 비상제동(5.4 m/s에서 6.6 m). 종을 친다(`tram_bell`) |
| 운휴 | `tram_suspended`~`tram_resumed`: 전차가 차고 앞에 선다. 탈 수 없지만 엄폐물로 쓴다 |

**전차 요금** (구간 경계: 경교 0 / 종로 612 / 동대문 979 / 보제원 1187 / 청량리 1333) [tram-05. 구간 단가로 쓴 것은 각색]

| 지나는 구간 수 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| 하등 (1.5전 × n 반올림) | 2전 | 3전 | 5전 | 6전 |
| 상등 (3.5전 × n 반올림) | 4전 | 7전 | 11전 | 14전 |

- 큰 상립을 쓴 상주 ×3 [tram-05], 큰 짐(지게·큰 짐승) ×2 [각색].
- 지불: 탄 뒤 8실초 안에 차장이 와서 요구 → E로 구간 수(1~4) 선택. 산 구간을 넘으면 경계에서 다시 온다.
- 무임: 요구를 무시하면 "내리시오" 3번 → 다음 정차 때 하차 요구 → 버티면 차장이 밀어내고 40 m 안 순검을 부름(`fare_evasion`: 현상 5, 의 −1). 매달리기(승강대 옆 1.5 m, 속도 차 ≤ 2.0)는 5실초마다 25% 확률로 들킨다.

### C.7 경인선 운행

**편성**: 기관차(브룩스 2-6-0T [rail-03]) + 1·2등 합조 객차(1등 8 · 2등 24) + 3등 객차 2량(각 40) + 화차 1량(맨 뒤). 칸 사이 1.2 m, 전체 약 57 m. 승무원은 일본인 철도 직원이 대부분이고 조선인 견습이 섞인다 [각색]. 중간역에는 회사 경비 2명과 일본인 역무원 1명, **순검은 노량진·제물포 감리서에만** 있다 [sec-02: 1896년 지방 순검 폐지].

**주행 수치(확정)**: 최고 15.3 m/s, 가속 1.0, 상용 제동 1.2, 비상 제동 1.6, 서행 구간(d 804.1~924.1) 8.0 m/s, 정규역 정차 6실초(게임 3분), 요청역 정차 6실초. 이 조건의 계산 주행 시간 = **200.2실초 = 1시간 40분** [rail-04, rail-05].

**시각표** (게임 시각, 출발 시각은 고증 [rail-05], 중간역은 계산값)

| 편 | 인천(제물포) | 축현 | 소사 | 솔고개 굽이(통과) | 오류동(통과) | 노량진 |
|---|---|---|---|---|---|---|
| 상행 1 | 07:00 발 | 07:17 착 / 07:20 발 | 07:48 착 / 07:51 발 | 08:07 | 08:19 | **08:40 착** |
| 상행 2 | 13:00 발 | 13:17 / 13:20 | 13:48 / 13:51 | 14:07 | 14:19 | **14:40 착** |
| 하행 1 | **10:40 착** | 10:20 / 10:23 | 09:49 / 09:52 | 09:34 | 09:22 | 09:00 발 |
| 하행 2 | **16:40 착** | 16:20 / 16:23 | 15:49 / 15:52 | 15:34 | 15:22 | 15:00 발 |

- 오류동 요청 정차: 승객이 오류동을 목적지로 고르거나(표·대화) 오류동 승강장에서 손을 든 사람이 있으면 선다. 상행 2에서 서면 오류동 14:22 착 / 14:25 발, 노량진 약 14:50 착. 하행에서 서면 09:25 착 / 09:28 발, 이후 약 10분 늦는다. 늦음은 종점 대기에서 흡수한다.
- 편성 1개가 4편을 모두 돈다. 10:40~13:00, 16:40 이후는 제물포 기관고(정차점 서쪽 끝).
- 시각표는 출발 시각만 고정하고 주행은 물리로 한다. 늦으면 정차를 하한 4실초까지 줄인다.

**시운전 열차** (`rail_trial` ~ `rail_open` 전): 기관차 + 화차 2량, 승객 없음, 최고 8 m/s. 제물포 10:00 발 → 소사 착 → 11:00 발 → 제물포. 14:00 발 → 소사 → 15:00 발 → 제물포. 몰래 타면 `trespass`. M09는 이와 별개로 스크립트 열차를 띄운다(H).

**운임** [rail-06] (부분 구간은 거리 비례, 최소 1/4, 5전 단위 올림 [각색])

| 구간 | 1등 | 2등 | 3등 |
|---|---|---|---|
| 노량진–오류동 | 40 | 25 | 15 |
| 노량진–소사 | 85 | 45 | 25 |
| 노량진–축현 | 130 | 70 | 35 |
| **노량진–인천(전 구간)** | **150** | **80** | **40** |
| 오류동–소사 | 45 | 25 | 15 |
| 오류동–축현 | 90 | 50 | 25 |
| 오류동–인천 | 115 | 60 | 30 |
| 소사–축현 | 50 | 25 | 15 |
| 소사–인천 | 70 | 40 | 20 |
| 축현–인천 | 40 | 20 | 10 |
| 말 싣기(화차) | 20 [각색] | | |

| 항목 | 규칙 |
|---|---|
| 표 | 역 매표소(역사 건물 shop `ticket_<역>`)에서 E. 아이템 `ticket_train_1/2/3`(1회용, 구간 기록). 구간·등급을 고르는 UI |
| 검표 | 출발 뒤 20~60실초 사이 차장이 돈다. 3등 60%, 1·2등 100% |
| 무임 적발 | 해당 운임 ×2 벌금, 안 내면 다음 역에서 하차(제물포·노량진이면 순검에게 넘김: `fare_evasion`) |
| 숨기 | 화차 hidden 자리: 검표 없음, 30실초마다 15% 발견 |
| 승객 건너뛰기 | 탄 채 Space 1초 → 0.5초 어두워졌다가 다음 정차지 시각으로 이동(사건이 걸려 있으면 그 지점에서 멈춤) |
| 기적 | 출발 2초 전, 건널목 150 m 전 |
| 장애물 발견 | 낮 180 m, 밤 90 m, 안개 때 최고 10 m/s. **서행 구간은 `sightLimit` 60 m**. 발견 즉시 비상제동(1.6). 탈선은 구현하지 않는다(늘 선다) |
| 치기 | 3.0 m/s 이상이면 즉사, 미만이면 1.5 m 밀고 피해 10 |

### C.8 증기선 운항

계산 소요: 용산 → 제물포 하행 약 7.5시간, 제물포 → 용산 상행 약 8.4시간(예정 9시간 [river-09]).

| 시기 | 편 | 시각 |
|---|---|---|
| 9/17까지 매일 | 상행 | 제물포 06:00 발 → 마포 약 13:30 → 용산 약 14:25 |
| | 하행 | 용산 07:00 발 → 마포 07:45 착 / 07:55 발 → 제물포 약 14:35 |
| 9/18부터(`steamer_reduced`) | 격일 | 짝수 날 상행만, 홀수 날 하행만 [각색, river-08 격일 운항] |

뱃삯: 조선인·청국인·일본인 75전, 서양인 150전 [river-08, 센트를 전으로 1:1 환산은 각색]. 말 30전. 부분 구간(용산–마포) 10전 [각색].

### C.9 메는·끄는 탈것

| 항목 | 규칙 |
|---|---|
| 보교 고용 | 소사 가마꾼 대기소(`gama_stand_sosa`)와 종로 뒷골목(2840,815)에서 E. 삯 선불: 기본 6전 + 게임 100 m당 1전 [각색, land-05 선불]. M09는 고정 15전 |
| 보교 승객 조작 | 승객이 방향키로 방향 지시, M 지도 표식으로 목적지, Shift 재촉(30실초마다 +1전), Space 멈춤, F 내리기(내려놓기 1.0초 포함) |
| 가마꾼 기력 | 2.2 m/s −0.3/s, 재촉 −1.5/s, 멈춤 +5/s, 0이면 가마를 내려놓고 30실초 쉼 |
| 주막 들르기 | 주막 25 m 안을 지날 때 가마꾼 기력 70 미만이면 40%로 20실초 정지. E "그냥 가세"(팁 2전)로 취소 [land-05] |
| 양반 가마 | 수배 1 이하일 때만. 보교 + 양반 의복(오장헌) = 순검 의심 속도 ×0.6, 검문 면제 50%. 미션 검문은 스크립트로 통과 [land-03] |
| 인력거 승객 | 15 m 안 빈 인력거에 E. 삯 = 2전 + 게임 100 m당 0.5전(올림). 1 km 7전. 재촉 Shift(3.8 m/s, 30실초마다 1전). 도중에 뛰어내리면 fare_evasion. `rickshaw_friend` 플래그(M06 군중 편)면 한성 안 삯 ×0.5 |
| 인력거 직접 끌기 | 플레이어 기력 사용: 3.4 m/s에서 −2/s, 4.4 m/s에서 −8/s. 측면 가속 > 4.5 m/s²면 3초 전복, 승객 피해 8. 아르바이트는 F |
| 소달구지 | 방향키 조향, Shift 회초리(1.7 m/s, 소 기력 −2/s, 정지 +3/s). 진흙 빠짐: SAND(맑음) 또는 FIELD·SAND(비) 위에서 1초마다 5%. 빠지면 속도 0, 6초 안 E 연타 12회 또는 동료 30초 [land-08]. HP 0이면 바퀴 빠진 수레(`wrecked`) |

### C.10 빠른 이동 (P)

| 수단 | 규칙 |
|---|---|
| 기차 승객 | C.7 승객 건너뛰기 |
| 증기선 승객 | ×8 빨리감기 |
| 기다리기 | 역 매표소·나루·주막에서 E "다음 편까지 기다리기" → 다음 출발 10게임분 전으로 시간을 넘긴다 |
| 주막 잠 | 8게임시(G.4), 저장 |
| 제한 | 수배 1 이상, 전투 중(적대 NPC 40 m 안 또는 최근 10실초 안 피격), 미션이 막을 때는 불가 |
| 육로 자동 이동·세마 편·가마 대절 | F |


---

## D. 아이템·제작·상점

### D.1 아이템 35종 (`js/systems/items.js`)

가격은 기준가(전). 상점 판매가·매입가는 D.4 공식으로 계산한다. 먹고 마시는 데 1.0초, 조준 중에는 못 먹는다. 가격은 모두 **[각색]**이고, 기준점만 고증이다: 여인숙 한 끼 5전 [eco-07], 3등 기차 40전 [rail-06], 노동자 일당 15~40전 [econ-01, eco-08], 대불호텔 200·250전 [port-04].

| id | 이름 | cat | 중첩 | 가격 | 효과·용도 | 얻는 곳 |
|---|---|---|---|---|---|---|
| w_knife | 장도 | weapon | 1 | 30 | G.1 | 대장간, 시작 소지품 |
| w_club | 몽둥이 | weapon | 1 | 8 | G.1 | 대장간, 제작, 전리품 |
| w_hwando | 환도 | weapon | 1 | 120 | G.1 | 대장간(민간 판매는 각색), 순검 전리품 |
| w_bow | 각궁 | weapon | 1 | 60 | G.1 | M05 지급, 총포상 |
| w_matchlock | 화승총 | weapon | 1 | 150 | G.1 | 시작 소지품, 총포상, 화적 전리품 |
| w_rifle | 양총 | weapon | 1 | 900 | G.1 | M12 경비 전리품, 제물포 총포상(`rifle_unlocked` 뒤) |
| w_revolver | 육혈포 | weapon | 1 | 700 | G.1 | 정동·진고개 총포상 |
| a_arrow | 화살 | ammo | 40 | 2 | 각궁 탄 | 총포상, 잡화, 제작 |
| a_ball | 연환 | ammo | 30 | 1 | 화승총 탄 | 총포상, 제작, 전리품 |
| a_matchcord | 화승 | ammo | 10 | 2 | 화승총 점화. 1개 300실초 탄다 | 총포상, 제작 |
| a_rifle | 양총 탄 | ammo | 40 | 4 | 양총 탄 | 총포상, 전리품 |
| a_revolver | 육혈포 탄 | ammo | 36 | 3 | 육혈포 탄 | 총포상 |
| c_roast | 구운 고기 | consumable | 10 | 4 | 체력 +25 | 제작, 주막 |
| c_gukbap | 국밥 | consumable | 5 | 5 | 체력 +40, 기력 +20. 주막에서 사 먹으면 그날 잠이 무료 [eco-12] | 주막, 제작(고깃국) |
| c_makgeolli | 탁주 | consumable | 5 | 2 | 호안 +15, 기력 +10, 취기 1게임시(탄퍼짐 ×1.3). 1게임시 안에 3병째면 비틀거림 1게임시(이동 방향 ±15°) | 주막, 잡화 |
| c_salve | 고약 | consumable | 10 | 15 | 체력 +50(바르는 데 1.5초, 이동 가능) | 약방, 제작 |
| c_galgeun | 갈근탕 | consumable | 5 | 12 | 기력 가득 + 1게임시 기력 소모 ×0.7 | 약방, 제작 |
| c_cheongsim | 청심환 | consumable | 5 | 40 | 호안 가득 + 2게임시 호안 소모 ×0.8 | 약방 |
| m_meat | 날고기 | meat | 20 | 2 | 체력 +5. 구우면 구운 고기 | 사냥 |
| pelt_roe_deer | 노루 가죽 | pelt | 10 | 40 | 판매용 | 사냥 |
| pelt_water_deer | 고라니 가죽 | pelt | 10 | 25 | 판매용 | 사냥 |
| pelt_boar | 멧돼지 가죽 | pelt | 10 | 50 | 판매용 | 사냥 |
| pelt_wolf | 늑대 가죽 | pelt | 10 | 60 | 판매용 | 사냥 |
| pelt_fox | 여우 가죽 | pelt | 10 | 45 | 판매용 | 사냥 |
| pelt_tiger | 범 가죽 | pelt | 3 | 600 | 판매용(가죽 값 비율 표범 1 : 범 5 [hunt-02]) | 사냥 |
| mat_feather | 꿩 깃 | material | 40 | 1 | 화살 재료 | 꿩 |
| h_galgeun | 칡뿌리 | herb | 30 | 2 | 기력 +5. 갈근탕·화승 재료 | 채집 |
| h_ssuk | 쑥 | herb | 30 | 1 | 체력 +3. 고약 재료 | 채집 |
| h_dangwi | 참당귀 | herb | 30 | 5 | 체력 +5. 고약 재료 | 채집 |
| h_doraji | 도라지 | herb | 30 | 3 | 체력 +3, 기력 +5. 고깃국 재료 | 채집 |
| h_omija | 오미자 | herb | 30 | 4 | 기력 +10. 갈근탕 재료 | 채집 |
| mat_ssari | 싸리 | material | 30 | 1 | 화살대·몽둥이 재료 | 숲 채집, 잡화 |
| mat_powder | 화약·납알 한 봉 | material | 20 | 8 | 연환·화승 재료 | 총포상, 장물아비 |
| f_maljuk | 말죽 | consumable(말) | 10 | 2 | 말 기력 +40, 말 HP +20, 유대 XP +6. 말 3 m 안에서 사용 | 주막, 마방, 잡화 |
| v_watch | 회중시계 | valuable | 5 | 300 | 장물아비만 산다 | M12 1등칸, 전리품 |

- **가죽 품질**: `itemDef('pelt_<종>_q1~q3')`를 자동 생성. 이름 뒤 "(1성)/(2성)/(3성)", 가격 = 기준가 × 0.5 / 1.0 / 1.6.
- **감초는 채집물이 아니다**(국내 재배 실패, 수입 의존 [hunt-09]). P에서는 청국 약재상 진열 장식으로만 보인다.

**퀘스트·표 아이템** (35종에 포함하지 않음. 가격 0, 팔 수 없음, 중첩 1)

| id | 이름 | cat | 쓰는 곳 | 특성 |
|---|---|---|---|---|
| q_ssamji | 오장헌의 쌈지 | quest | M02 | |
| q_jail_key | 옥 열쇠 | quest | M03 | |
| q_fare_bag | 차장 요금 주머니 | quest | M06(돈 편) | 줍는 즉시 돈 +30으로 바뀌고 사라짐 |
| q_rival_tag | 불여우 목패 | quest | M07 | |
| q_rifle_bales | 소금 가마니(양총 20정, 가마니 5짝에 4정씩) | quest | M09·M10 | **무거운 짐** |
| q_strongbox | 회사 철궤 | quest | M12 | **무거운 짐** |
| q_ledger | 토지 매수 장부 | quest | M12 아웃트로 | 2장의 열쇠 |
| q_plate | 백동화 판형 | quest | M12 아웃트로 | 2장의 열쇠 |
| q_newspaper | 신문(독립·황성·제국) | quest | S5 | 중첩 5, 신문팔이에게 2전 [life-05] |
| q_torn_jige | 찢긴 지게 | quest | S3 | |
| ticket_train_1/2/3 | 경인선 1·2·3등 표 | ticket | C.7 | 중첩 4, 구간 기록, 1회용 |

**무거운 짐 규칙**: 동시에 1개만. 들고 걸으면 이동 ×0.6, 질주·구르기 불가. 말을 타면 안장에 실려 말 속도 ×0.8. X 길게(1초)로 내려놓고 E로 다시 든다. 죽으면 그 자리에 떨어진다.

**시작 소지품**: 돈 30전, 장도, 화승총, 연환 12, 화승 3, 구운 고기 2, 고약 1.

### D.2 제작 레시피 8종

제작은 I(소지품)에서 '제작' 탭. "불 곁" = 모닥불·주막·산채 솥 3 m 안.

| id | 결과 | 재료 | 시간 | 장소 | 필요 스킬 | 경험치 |
|---|---|---|---|---|---|---|
| rc_arrow | 화살 ×5 | 싸리 2, 꿩 깃 1 | 4초 | 어디서나 | – | 사격 +2 |
| rc_roast | 구운 고기 ×1 | 날고기 1 | 3초 | 불 곁 | – | 생존 +3 |
| rc_stew | 국밥(고깃국) ×1 | 날고기 2, 도라지 1 | 5초 | 산채 솥·주막 | – | 생존 +5 |
| rc_salve | 고약 ×1 | 쑥 2, 참당귀 1 | 4초 | 어디서나 | `sae_herbal` | 생존 +8 |
| rc_galgeun | 갈근탕 ×1 | 칡뿌리 2, 오미자 1 | 4초 | 불 곁 | `sae_herbal` | 생존 +8 |
| rc_ball | 연환 ×5 | 화약·납알 1 | 3초 | 어디서나 | – | 사격 +4 |
| rc_matchcord | 화승 ×3 | 칡뿌리 1, 화약·납알 1 | 4초 | 어디서나 | `sag_hwaseung` | 사격 +4 [각색: 칡 껍질 끈을 초석에 절인다] |
| rc_club | 몽둥이 ×1 | 싸리 3 | 5초 | 어디서나 | – | 무예 +3 |

### D.3 상점 종류 (6종 + 매표소)

| 종류 | 파는 것(가격 = 기준가 공식) | 사들이는 것(매입률 × 기준가) | 영업 | 거부 |
|---|---|---|---|---|
| jumak 주막 | 국밥, 탁주, 구운 고기, 말죽 / 잠(G.4) | 날고기 0.5, 구운 고기 0.4, 약초 0.3 | 05~24시(잠은 늘) | – |
| inn 대불호텔(jumak 변형) | 일반실 200·상등실 250(G.4), 양식 한 접시 = 구운 고기 8전 | – | 늘 | 수배 1 이상 |
| market 잡화·시전 | 싸리, 화살(3전), 말죽, 탁주 | 가죽 0.55, 날고기 0.5, 꿩 깃 0.6, 약초 0.4 | 06~20시 | – |
| market 변형: 대장간 | 장도, 몽둥이, 환도 | 근접 무기 0.35 | 06~20시 | – |
| yakbang 약방 | 고약, 갈근탕, 청심환 | 약초 0.6 | 06~21시 | outlaw |
| gunshop 총포상 | 각궁, 화살, 화승총, 연환, 화승, 화약·납알, 양총 탄, 육혈포, 육혈포 탄, (제물포만, `rifle_unlocked` 뒤) 양총 | 무기 0.4, 탄 0.4 | 08~19시 | outlaw |
| stable 마방 | 말죽 / 치료 20, 세마, 맡기기, 말 구입(동대문·제물포만) | – | 05~22시 | – |
| fence 장물아비 | 화약·납알 6전, 연환 1전 | 회중시계 0.8, 가죽 0.7, 무기 0.5, 탄 0.4 (훔친 물건도 산다) | 마포 20~04시 / 산채 늘 | – |
| ticket 매표소 | 경인선 표(C.7 운임) | – | 06:00~16:40, `rail_open` 전에는 닫힘 | – |

- **본편 미션은 거부 때문에 막히지 않는다**: 미션이 요구하는 구매(M09 양총 탄)를 거부당하면 미션 대안 경로(유선녀가 대신 산다)가 열린다.
- 세 관아·감리서(`office_*`)는 상점이 아니라 **납부·자수 창구**다(G.3).

### D.4 가격 공식

```
상점이 파는 값 = max(1, round(기준가 × tierBuy × skills.mod('priceBuy') × 상점별 배수))
상점이 사는 값 = max(1, floor(기준가 × 품질배수 × 매입률 × tierSell × skills.mod('priceSell')))
```

| honorTier | tierBuy | tierSell | 그 밖 |
|---|---|---|---|
| noble (60 이상) | 0.9 | 1.05 | 주막 잠 무료 |
| decent (20~59) | 0.95 | 1.02 | |
| neutral (−19~19) | 1.0 | 1.0 | |
| rough (−59~−20) | 1.05 | 0.98 | 순검이 알아보는 거리 +2 m |
| outlaw (−60 이하) | 1.15 | 0.9 (장물아비는 1.1) | 약방·총포상 거부 |

상점별 배수: `jumak_solgogae`는 `solgogae_discount`(M07 보상)면 ×0.9. `gun_jeongdong`의 육혈포는 `brantley_friend`(S1)면 ×0.7.

### D.5 상점 목록 (건물 id = 상점 id, NPC 상점은 표시)

| 상점 id | 종류 | 건물·NPC | 위치 |
|---|---|---|---|
| jumak_gyeonggyo | jumak | jumak_gyeonggyo | (2215,782) |
| jumak_muak | jumak | jumak_muak (밤길 범 경고 대사) | (2205,640) |
| jumak_cheongnyang | jumak | jumak_cheongnyang | (3435,695) |
| jumak_mapo | jumak | mapo_jumak | (2265,1360) |
| jumak_noryang | jumak | noryang_jumak | (2700,1640) |
| jumak_origol | jumak | jumak_origol1 | (1830,1712) |
| jumak_solgogae | jumak | jumak_solgogae, 주인 NPC 엄순례 | (1560,1712) |
| jumak_sosa | jumak | jumak_sosa1 | (1255,1703) |
| jumak_jemulpo | jumak | jumak_jm | (650,1598) |
| hotel_daebul | inn | hotel_daebul | (420,1645) |
| market_jongno | market | yuk_myeonpo | (2940,770) |
| market_chilpae | market | chilpae_stalls | (2550,1145) |
| market_mapo | market | mapo_yeogak(낮) | (2300,1365) |
| market_jemulpo | market | gaekju_jm | (660,1642) |
| smith_baeogae / smith_sosa / smith_jemulpo | market(대장간) | 같은 이름 건물 | (3120,812) / (1310,1740) / (690,1645) |
| yakbang_guri / yakbang_sosa / yakbang_cn | yakbang | herb_guri1 / herb_sosa / herb_cn | (2880,873) / (1240,1735) / (330,1600) |
| gun_jeongdong / gun_jingogae / gun_jemulpo | gunshop | 같은 이름 건물(gun_jm) | (2380,800) / (2860,1025) / (520,1470) |
| stable_dongdaemun / stable_seodaemun / stable_mapo / stable_noryang / stable_sosa / stable_jemulpo | stable | 같은 이름 건물 | (3160,808) / (2160,790) / (2385,1345) / (2660,1660) / (1340,1702) / (700,1600) |
| fence_mapo | fence | NPC `fence_mapo` (마포 여각 뒷방) | (2300,1378), 20~04시 |
| fence_camp | fence ×0.9 | NPC `ma_cheonbok` | 산채, `prologue_done` 뒤 |
| ticket_noryangjin / ticket_oryu / ticket_sosa / ticket_chukhyeon / ticket_jemulpo | ticket | 역사 건물 | A.3 |
| 신문팔이 | q_newspaper 2전 | NPC `newsboy_jongno` (2900,797), `newsboy_mapo` (2330,1390), `newsboy_jemulpo` (620,1620) | 06~18시 |

---

## E. 동물·채집·전리품

### E.1 동물 7종 (`SPECIES`)

| id | 이름 | hp | 몸 L×W (m) | 걷기 / 달아남 | 시야 낮 / 밤 | 냄새 | 성향 | 공격 | 무리 | 활동 | 크기 | 가죽 기준가 | 고기 | 부산물 | 적정 무기 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| roe_deer | 노루 | 60 | 1.1×0.35 | 1.5 / 9.0 | 35 / 20 m | 25 m | 겁 많음, 300 m 달아남 | – | 1~3 | 낮·새벽 | M | 40 | 날고기 2 | – | 각궁, 화승총 |
| water_deer | 고라니 | 45 | 0.9×0.32 | 1.4 / 8.5 | 30 / 18 | 25 | 달아남, 갈대 속으로 | – | 1~2 | 낮·밤 | M | 25 | 날고기 1 | – | 각궁 |
| pheasant | 꿩 | 10 | 0.35×0.15 | 1.0 / 7.0(날아 30 m 뒤 내려앉음) | 20 / 10 | 10 | 달아남 | – | 1~3 | 낮 | S | – | 날고기 1 | 꿩 깃 2 | 아무거나 |
| boar | 멧돼지 | 140 | 1.2×0.5 | 1.6 / 8.0 | 25 / 15 | 30 | 12 m 안이거나 맞으면 돌진 9.0 m/s | 들이받기 25 + 넘어짐 1.5초, 쿨 2.5초 | 1~3 | 낮·밤 | L | 50 | 날고기 3 | – | 화승총, 양총 |
| wolf | 늑대 | 70 | 1.1×0.35 | 1.8 / 8.5 | 30 / 30 | 35 | 낮엔 피함. 밤(20~4시)엔 3~4마리가 25 m 안 사람을 둘러싸 공격 | 물기 12, 쿨 1.2초 | 3~4 | 밤 | M | 60 | 날고기 1 | – | 각궁, 화승총, 양총 |
| fox | 여우 | 30 | 0.7×0.22 | 1.5 / 7.5 | 30 / 25 | 30 | 달아남 | – | 1 | 새벽·밤 | S | 45 | – | – | 각궁 |
| tiger | 범 | 220 | 2.0×0.6 | 2.0 / 돌진 11.0 | 40 / 40 | 40 | 30 m 안 사람에게 다가와 덮침 | 앞발 45(막기 불가) + 넘어짐 2초, 쿨 2초 | 1 | 밤 | L | 600 | 날고기 4 | – | 화승총, 양총 |

- **사람에게 가장 위험한 짐승은 늑대 무리**다(1915~16년 맹수 피해 사망 늑대 167, 범 12 [hunt-04]). 범은 지도 전체에 하루 1마리, 밤에만 북한산·인왕 구역에서 5% 가중치로. S3의 무악재 범은 스크립트.
- **냄새**: 바람이 플레이어에게서 짐승 쪽으로 불면(플레이어→짐승 방향과 `wind.angle`의 차 < 60°) 시야와 상관없이 냄새 거리 안에서 알아챈다. 그래서 사냥은 **바람을 안고**(맞바람으로) 다가간다. 스킬 `sae_tracking`이면 HUD에 바람 화살표.
- **소리**: `shot` 이벤트 소음 반경 안 짐승은 즉시 달아나거나(겁 많음) 소리 쪽으로 온다(범·멧돼지 50%).
- **감지 배수**: `animalDetect`(스킬), 웅크리기 ×0.5(시야만), 날씨 시야 배수(G.5).

**출현 규칙**: 사냥 구역마다 플레이어 250 m 안에 최대 마릿수(A.3 zones 주석)를 유지한다. 10실초마다 검사해 플레이어 60 m 밖·화면 밖 구역 칸에 만든다. 300 m 넘게 떨어지면 지운다. 종 가중치는 A.3 zones 주석. 사냥 구역 밖 숲·풀밭에는 꿩·노루만 낮게(구역 최대의 1/3).

**가죽 품질**(죽을 때 `animal.quality`를 정함)

| 조건 | 품질 |
|---|---|
| 적정 무기로 맞은 횟수 1(멧돼지·범은 2 이하) | 3성 |
| 적정 무기로 3회 이하, 또는 적정 아닌 무기 1발 | 2성 |
| 그 밖(근접 무기, 잦은 사격) | 1성 |
| 머리 명중으로 죽음 | +1 (최대 3) |
| 벗길 때 `skinQuality` 확률 | +1 (최대 3) |

가죽 벗기기: 시체에 E 길게 3초(× `skinSpeed`). 가죽·고기·부산물이 소지품으로 들어간다. 꿩은 털 뽑기 1초.

### E.2 채집물 (`gather`)

| 아이템 | 구역(A.3 zones) | 구역당 덩굴 수 | 시간 | 다시 남 |
|---|---|---|---|---|
| h_galgeun 칡뿌리 | herb_gyeyang 6, herb_suri 4 | 표 | 1.5초 | 게임 하루 |
| h_ssuk 쑥 | herb_gyeyang 6, herb_namsan 4, herb_riverside 6, 그 밖 GRASS 길가 드물게(지도 전체 40개) | 표 | 1.5초 | 게임 하루 |
| h_dangwi 참당귀 | herb_suri 3, herb_gwanak 4, herb_bukhan 4 | 표 | 1.5초 | 게임 하루 |
| h_doraji 도라지 | herb_namsan 4, herb_gwanak 4 | 표 | 1.5초 | 게임 하루 |
| h_omija 오미자 | herb_suri 4, herb_bukhan 5 | 표 | 1.5초 | 게임 하루 |
| mat_ssari 싸리 | FOREST 칸, 플레이어 120 m 안에 최대 12개 | – | 1.5초 | 게임 반나절 |

- 한 번 채집에 1개, `gatherBonus` 확률로 +1. 스킬 `sae_herbal`이면 15 m 안 덩굴이 옅게 빛난다(`herbGlow`).
- 당귀·오미자·칡은 국내 자생이 통설이나 개별 출처는 미확인이다 [hunt-09 note].

### E.3 전리품 표 (`LOOT_TABLES`)

시체 뒤지기: E 1.2초. 민간인 시체를 목격되며 뒤지면 `looting`. NPC가 든 무기는 늘 떨어뜨린다(아이템).

| id | 대상 | 내용 |
|---|---|---|
| lt_civilian | 백성·상인 | 돈 1~8 (70%), 탁주 1 (20%), 구운 고기 1 (10%) |
| lt_sungeom | 순검 | 돈 5~15, 고약 1 (30%) |
| lt_bandit | 화적(rival) | 돈 3~20, 연환 3~6 (60%), 화승 1~2 (50%), 탁주 1 (20%) |
| lt_pirate | 수적 | 돈 2~10, 연환 2~5 (50%), 화약·납알 1 (30%) |
| lt_rail_guard | 회사 경비 | 돈 10~30, 양총 탄 4~8 (양총 든 경비 100%), 고약 1 (20%) |
| lt_bounty | 현상금 사냥꾼 | 돈 10~40, 연환 4~8 (60%), 양총 탄 4~6 (30%), 고약 1 (30%) |
| lt_passenger_1st | M12 1등칸(윤팔 털이) | 미션이 지급: 돈 +200, 회중시계 2 |
| lt_passenger_3rd | 3등 승객 | 돈 0~8 |

미션 전리품은 표보다 앞선다(M03 간수의 옥 열쇠, M07 방칠성 부하의 불여우 목패).


---

## F. 스킬·경험치·게이지

### F.1 게이지 (`game.sys.stats`)

P에는 **바깥 게이지 3개만** 있다. API의 `core`(심지)는 100으로 고정하고 줄지 않는다(심지는 F).

| 게이지 | 최대 | 회복 | 소모 | 0일 때 |
|---|---|---|---|---|
| 체력 health | 100 (+`healthMax`) | 0.8/s, 마지막 피해 6실초 뒤부터 | 피해 | 사망(G.6) |
| 기력 stamina | 100 | 이동 중 8/s, 멈춤 14/s (`staminaRegenMul`), 비 오면 ×0.85 | 질주 −11/s, 구르기 −12, 강한 공격(G.2), 헤엄(C.1), 인력거 끌기 | 질주·구르기 불가 |
| 호안 hoan | 100 (+`hoanMax`) | 호안을 안 쓸 때 0.4/s. 사람 처치 +5, 머리 처치 +10, 동물 처치 +3 | 호안 중 12/s × `hoanDrain` | 호안 끝 |

**강화(buff)** `stats.buffs = [{stat, mul, until}]`: 갈근탕(기력 소모 ×0.7, 1게임시), 청심환(호안 소모 ×0.8, 2게임시), 산채 솥(`camp_fed`, 체력 회복 ×2, 1게임시), 대불호텔 상등실(체력·기력 회복 ×1.5, 2게임시).

### F.2 스킬 15개 (5계통 × 3)

계통 단(1~10)이 오를 때마다 공용 스킬 포인트 +1, 시작 2점. 15개 비용 합계 18점. P를 끝까지 하면 대략 12~16점이 모인다(고르게 된다).

| 계통 | id | 이름 | 요구 단 | 선행 | 비용 | 효과(`skills.mod` 키) | 근거 |
|---|---|---|---|---|---|---|---|
| 무예 `muye` | muye_pumbalgi | 품밟기 | 1 | – | 1 | meleeEvade +0.15 (받는 근접 공격 15% 회피) | [wpn-07] |
| | muye_hwando | 환도술 | 2 | – | 1 | bladeDamage ×1.2, meleeSpeed ×0.85 | [wpn-04, wpn-06] |
| | muye_dallyeon | 단련 | 3 | muye_pumbalgi | 2 | healthMax +20, meleeTaken ×0.85 | [창작] |
| 사격 `sagyeok` | sag_breath | 숨 고르기 | 1 | – | 1 | aimSteady ×0.6 (1초 이상 조준하면 퍼짐 ×0.6) | [창작] |
| | sag_hwaseung | 화승 다루기 | 1 | – | 1 | matchlockReload ×0.8, misfire ×0.5, matchcordBurn ×0.7. 화승 제작 해금 | [wpn-02] |
| | sag_hoan1 | 호안 수련 | 2 | sag_breath | 2 | hoanMax +25, hoanDrain ×0.8 | [창작] |
| 생존 `saengjon` | sae_skinning | 가죽 다루기 | 1 | – | 1 | skinSpeed ×0.6, skinQuality +0.25 | [창작] |
| | sae_tracking | 발자취 읽기 | 1 | – | 1 | trackRadius +40(발자국·종 이름 표시), 바람 화살표 HUD, animalDetect ×0.85 | [창작] |
| | sae_herbal | 약초 지식 | 1 | – | 1 | gatherBonus +0.5, herbGlow +15. 고약·갈근탕 제작 해금 | [창작] |
| 기마·조운 `gima` | gim_bond | 말 길들이기 | 1 | – | 1 | horseBond ×1.5, 휘파람 반경 ×1.5 | [land-06] |
| | gim_oar | 사공 | 1 | – | 1 | boatSpeed ×1.15(노 젓기), 노 젓기 기력 ×0.7 | [river-09] |
| | gim_cart | 수레꾼 | 2 | – | 1 | cartSpeed ×1.15(소달구지·인력거), cartStuck ×0.5 | [land-08] |
| 처세 `cheose` | che_haggle | 흥정 | 1 | – | 1 | priceSell ×1.1, priceBuy ×0.9 | [창작] |
| | che_quiet | 발소리 죽이기 | 1 | – | 1 | stealthNoise ×0.6, crouchSpeed ×1.2 | [창작] |
| | che_presence | 위세 | 3 | – | 2 | 목격자 위협 성공 0.7 → 0.95, 무장 NPC 항복 문턱 +10%p | [창작] |

`mod(key, base) = (base + Σadd) × Πmul`. 계통 단 자체 보정(L = 현재 단): 무예 meleeDamage ×(1 + 0.02(L−1)), 사격 gunSpread ×(1 − 0.02(L−1)), 생존 skinSpeed ×(1 − 0.03(L−1)), 기마 horseStamina ×(1 + 0.02(L−1)), 처세 priceSell ×(1 + 0.01(L−1)).

### F.3 경험치·레벨

```js
// 누적 경험치. XP_LEVELS[L] = L단 도달에 필요한 누적 경험치
export const XP_LEVELS = [0, 0, 100, 303, 580, 919, 1313, 1758, 2250, 2786, 3363];
export const xpForLevel = (L) => (L <= 1 ? 0 : Math.round(100 * Math.pow(L - 1, 1.6)));
export const MAX_LEVEL = 10;
```

| 계통 | 행동 | 경험치 |
|---|---|---|
| 무예 | 근접 명중(같은 대상 10회까지) / 넘어뜨림·기절 / 근접으로 사람 처치 / 잠입 처치 / 막기 성공 | +3 / +12 / +10 / +15 / +2 |
| 사격 | 원거리 명중 / 머리 명중 / 원거리로 사람 처치 / 동물 처치 S·M·L / 호안 중 처치 추가 | +2 / +6 / +8 / +5·+10·+20 / +4 |
| 생존 | 가죽 벗기기 S·M·L(3성 ×1.5) / 채집 1회 | +8·+15·+30 / +3 |
| 기마·조운 | 말 타고 100 m(질주 ×1.5) / 유대 단계 상승 / 말죽 먹이기(하루 2회) / 노 저어 80 m / 소달구지·인력거·보교 100 m / 달리는 전차·열차 오르내림 / 말 위 처치 | +1 / +40 / +5 / +1 / +1 / +8 / +10 |
| 처세 | 판매 10전마다(거래당 25까지) / 구매(하루 20까지) / 웅크려 안 들키고 30 m / 목격자 위협·뇌물 | +1 / +1 / +2 / +10 |
| 제작 | D.2 표 | |

**미션 경험치** (H절 보상에 이미 적힘)

| 미션 | 경험치 | 미션 | 경험치 |
|---|---|---|---|
| M01 | gima 50 | M07 | sagyeok 80 |
| M02 | gima 50 | M08 | gima 80 |
| M03 | muye 80 | M09 | cheose 80 |
| M04 | gima 100 | M10 | sagyeok 100 |
| M05 | saengjon 100 | M11 | cheose 60 |
| M06 | cheose 80 | M12 | sagyeok 100 + gima 100 |

---

## G. 전투·수배·평판·시간

### G.1 무기 (`WEAPONS`)

`damage`는 사람 몸통 기준(사람 기본 체력 100). `range` 최대 사거리, `effRange` 감쇠 시작, `fireInterval` 연사·휘두르기 간격(초), `reload` 장전(초), `noise` 소음 반경(m).

```js
export const WEAPONS = {
  fist:        { id:'fist',        name:'주먹',   kind:'fist',  damage:8,  range:1.2, fireInterval:0.45, reload:0, mag:0, ammo:null, spread:0, noise:8,  stamina:4, knock:0.10, peltClass:'melee', nonLethal:0.9 },
  w_knife:     { id:'w_knife',     name:'장도',   kind:'melee', damage:22, range:1.3, fireInterval:0.50, reload:0, mag:0, ammo:null, spread:0, noise:6,  stamina:5, knock:0.05, peltClass:'melee', blade:true },
  w_club:      { id:'w_club',      name:'몽둥이', kind:'melee', damage:18, range:1.8, fireInterval:0.80, reload:0, mag:0, ammo:null, spread:0, noise:10, stamina:8, knock:0.35, peltClass:'melee', blunt:true, nonLethal:0.7 },
  w_hwando:    { id:'w_hwando',    name:'환도',   kind:'melee', damage:32, range:2.0, fireInterval:0.70, reload:0, mag:0, ammo:null, spread:0, noise:10, stamina:7, knock:0.10, peltClass:'melee', blade:true },
  w_bow:       { id:'w_bow',       name:'각궁',   kind:'bow',   damage:45, range:90,  effRange:60, fireInterval:1.0, reload:0.6, mag:1, ammo:'a_arrow',    spread:0.020, noise:4,   draw:0.8, projSpeed:55, peltClass:'arrow' },
  w_matchlock: { id:'w_matchlock', name:'화승총', kind:'gun',   damage:80, range:70,  effRange:40, fireInterval:0,   reload:6.0, mag:1, ammo:'a_ball',     spread:0.060, noise:140, ignite:0.35, needs:'a_matchcord', peltClass:'ball' },
  w_rifle:     { id:'w_rifle',     name:'양총',   kind:'gun',   damage:90, range:150, effRange:90, fireInterval:0,   reload:2.0, mag:1, ammo:'a_rifle',    spread:0.015, noise:180, peltClass:'rifle' },
  w_revolver:  { id:'w_revolver',  name:'육혈포', kind:'gun',   damage:40, range:35,  effRange:20, fireInterval:0.45, reload:4.5, mag:6, ammo:'a_revolver', spread:0.040, noise:110, reloadPerRound:0.75, peltClass:'pistol' },
  // NPC 전용
  npc_rock:    { id:'npc_rock',    name:'돌',     kind:'throw', damage:8,  range:15,  fireInterval:1.5, projSpeed:18, noise:3 },   // 한강 수적 [out-05]
};
```

| 무기 | 근거·메모 |
|---|---|
| 화승총 | 화승이 타고 있어야 쏜다 [wpn-02]. 장전 6초는 [각색](기록의 '15분'은 과장 가능성). 활빈패·화적의 주력 [out-01] |
| 양총 | 단발 후장식. 기종(무라타·베르단·마우저 등)은 **[추정, wpn-01 unverifiable]**. 병정·회사 경비도 이 수치 |
| 육혈포 | 6발 회전식. 드문 고급 무기 [wpn-03]. 기종 미확인 |
| 각궁 | 소리 없는 원거리 [wpn-05] |
| 환도 | 군인·순검의 허리 실루엣 [wpn-04] |

### G.2 판정

| 항목 | 규칙 |
|---|---|
| 감쇠 | `effRange`~`range` 사이 피해가 직선으로 줄어 `range`에서 50%. 넘으면 안 맞음 |
| 머리 | 사람: 조준선이 머리(몸 중심 0.1 m 앞) 반경 0.12 m(× `headZone`, 호안 중 ×2) 안을 지나면 머리, 피해 ×2. 동물: 몸 앞쪽 30%가 머리, 피해 ×3 |
| 탄퍼짐 | 발사각 = 조준각 + 정규분포(σ = spread + 이동 가산) × 배수. 걷기 +0.03, 달리기 +0.07, 질주 중 조준 불가, 말 위 +0.05, 웅크림 ×0.75, 1초 이상 조준 ×`aimSteady`, 취기 ×1.3, 공통 ×`gunSpread` |
| 탄 | 총은 즉시 판정, 화살은 55 m/s 투사체(`range`에서 떨어짐, 떨어진 화살 E로 회수 50%) |
| 화승총 | 꺼내면 화승 1개 점화(300초 × `matchcordBurn` 역수로 탐). 넣으면 꺼지고 남은 시간 저장. 방아쇠 뒤 0.35초 점화 지연. 불발 확률 = 날씨(G.5) + 얕은 물에 서 있으면 0.15, × `misfire`. 불발이면 탄은 남는다. 연기 2초(반경 1.5 m 시야 차단) |
| 각궁 | 누르는 동안 당김, 0.8초(× `bowDraw`)에 가득. 피해 40~100% |
| 육혈포 | 빈 상태 R = 전탄 4.5초, 한 발씩 0.75초(중간에 끊기 가능) |
| 동물 한 발 확인 | 머리 한 발: 양총 270, 화승총 240 → 범(220)까지 / 활 135 → 노루·늑대·여우·고라니. 활 몸통 45 → 여우(30) |
| 근접 | 가벼운 공격(왼쪽 클릭), 강한 공격(0.6초 눌렀다 놓기: 피해 ×1.8, 넘어뜨림 +0.3, 기력 ×2), 맨손 3연타(0.8초 안, 3타 ×1.5), 막기(오른쪽 클릭: 근접 피해 −70%, 막을 때마다 기력 10, 범 공격은 못 막음) |
| 넘어뜨림 | 사람 2.0초, 플레이어 1.5초 |
| 비살상 | 주먹·몽둥이로 체력을 0으로 만들면 `nonLethal` 확률로 기절(`state='down'`) 60초. 범죄는 murder가 아니라 assault |
| 잠입 처치 | 웅크린 채 등 뒤 60°·1.5 m, 대상이 못 알아챔, E. 장도는 1.2초 만에 죽임, 맨손·몽둥이는 기절. 소음 3 m |
| 소음 반경(m) | 웅크려 걷기 2(× `stealthNoise`), 걷기 6, 달리기 12, 질주 18, 말 평보 15, 말 질주 30, 근접 타격 10, 문 8, 시체 내려놓기 6, 총·활은 무기 noise. 날씨 소리 배수를 곱함 |
| 감지 게이지 | 관찰자마다 0~1. R = 시야(낮 22 m, 밤 10 m) × 날씨 시야 배수 × (플레이어가 횃불이면 2). R 안·시야각 110°면 fill += dt × (1.5 × (1 − d/R) + 0.25) × 자세(웅크림 0.5, 걷기 1, 달리기 1.5), 아니면 −0.4/s. 1이면 발견 |
| 호안(Q) | 총·활을 든 채, 호안 20 이상. `game.timeScale = 0.3`, 조준 커서는 실시간. 머리 판정 ×2, 화승총 점화 지연 0.1초. 호안 중 왼쪽 클릭으로 표식(육혈포: min(2, 장전 탄), 단발 무기 1). Q 다시 누르거나 오른쪽 버튼을 놓으면 실시간 0.15초 간격으로 표식 사격(퍼짐 0). 표식 없이 쏘면 퍼짐 ×0.3. 끝난 뒤 3초 쿨. 이벤트 `hoan:start`/`hoan:end` |

**NPC 전투 수치** (NPC가 플레이어에게 주는 피해 ×0.6 [창작, 난이도]. NPC끼리는 그대로. 첫 사격 전 조준 0.8~1.2초, 연사 간격 = 무기 값 ×1.5)

| role | 체력 | 무기(확률) | 퍼짐 배수 | 반응(초) | 도망·항복 |
|---|---|---|---|---|---|
| villager, woman | 60 | 맨손 | – | 0.6 | 위협받으면 바로 |
| yangban, merchant | 70 | 맨손 | – | 0.6 | 바로 |
| porter 지게꾼 | 80 | 몽둥이 0.5 | – | 0.5 | 30% |
| sungeom 순검 | 100 | 환도 0.6, 몽둥이 0.4. 수배 2단계부터 4명 중 1명 육혈포 [각색] | 1.3 | 0.5 | 20%에서 항복 |
| chongsun 총순 | 130 | 육혈포 | 1.1 | 0.4 | 없음 |
| soldier 병정(시위대·진위대) | 120 | 양총 | 1.0 | 0.6 | 15% |
| gwanbyeong 나루 관병 | 110 | 화승총 | 1.4 | 0.6 | 20% |
| militia 마을 장정(경인가도) | 80 | 몽둥이 | – | 0.6 | 30% |
| jogye_police 조계 순경 | 100 | 몽둥이, 4명 중 1명 육혈포 | 1.2 | 0.5 | 20% |
| bandit 화적(rival) | 90 | 화승총 0.45, 환도 0.2, 몽둥이 0.35 | 1.6 | 0.7 | 25% |
| bandit_boss 방칠성 | 220 | 육혈포 | 1.0 | 0.4 | `essential`, 50%에서 도주 |
| bounty_hunter | 130 | 화승총 0.5, 양총 0.2, 몽둥이 0.3 | 1.0 | 0.4 | 15% (구만석은 `essential`) |
| rail_guard 회사 경비 | 110 | 양총 0.5, 몽둥이 0.5. 조선인·일본인 반반 | 1.1 | 0.5 | 20% |
| pirate 수적 | 80 | 화승총 0.4, 돌(npc_rock) 0.6 | 1.6 | 0.7 | 30% |
| foreigner | 100 | 맨손(경호원 1명 육혈포) | 1.2 | 0.6 | 바로 |

### G.3 범죄·수배

**범죄** (`game.emit('crime', {kind, x, y, offender, victim})`)

```js
export const CRIMES = {
  fare_evasion:  { bounty:5,   level:1, honor:-1,  witness:true  },  // 차장·역무원만 신고 [tram-05]
  trespass:      { bounty:10,  level:1, honor:-1,  witness:true  },  // 남의 집·관창·궁궐·시운전 열차
  looting:       { bounty:20,  level:1, honor:-1,  witness:true  },  // 민간인 시체 뒤지기
  theft:         { bounty:30,  level:1, honor:-2,  witness:true  },  // 좀도둑, 남의 말 훔치기는 bounty 80·honor -3
  animal_cruelty:{ bounty:30,  level:1, honor:-2,  witness:true  },  // 남의 말·소를 해침
  assault:       { bounty:50,  level:1, honor:-3,  witness:true  },  // 비무장 민간인 폭행·기절
  arson:         { bounty:100, level:2, honor:0,   witness:true  },  // (추가) M06 군중 편 스크립트
  jailbreak:     { bounty:150, level:2, honor:0,   witness:false },  // (추가) M03 스크립트
  robbery:       { bounty:150, level:2, honor:-4,  witness:true  },  // 상점 250, 열차 400(즉시 3단계)
  murder:        { bounty:300, level:2, honor:-10, witness:true  },  // 민간인 살해
};
```

**피해자 규칙** (위에서부터 처음 맞는 하나만 적용)

| 피해자 | 처리 |
|---|---|
| 플레이어를 먼저 공격한 자, `rival`(화적), 미션이 `rioter` 태그를 붙인 군중(M06) | 범죄가 아니다(기절·살상 모두) |
| `company`·`bounty`·`pirate`이면서 무기를 든 적대자 | murder: 현상 300 ×1, **의 −3**. 기절은 범죄 아님 |
| `police`·`army`(순검·총순·병정·관병·조계 순경) | 현상 ×2, 단계 +1. murder의 의는 −8 |
| 그 밖(민간인) | 표 그대로 |

- **이야기 선택지의 의 변동은 H절 미션 표에만 있다.** 같은 행동에 범죄 감점과 이야기 감점을 겹쳐 주지 않는다.
- `rich` 태그(의 감점 ×0.25)는 이름 있는 탐관오리·매점상 미션 표적에만 붙인다. P에는 없다.

**목격·신고**

1. 범죄를 본 민간인은 목격자가 되어 가장 가까운 순검·관아 쪽으로 3.8 m/s로 달린다.
2. 순검에게 15 m 안으로 가면 신고. 150 m 안에 순검이 없으면 25실초 뒤 소리 질러 신고.
3. 순검·병정이 직접 보면 즉시 수배(최소 2단계).
4. 막는 법: 위협(1.5초 겨누기, 성공 0.7, 위세 0.95, 의 −1) / 뇌물(20전, 1단계 범죄만, 의 −1) / 처치(새 범죄).

**수배 단계**

```js
export const WANTED_LEVELS = {
  1: { name:'신고됨',              arrive:60, reinforce:null,  max:2,  search:150, lose:30,  shootOnSight:false },
  2: { name:'추격',                arrive:30, reinforce:[2,60], max:8,  search:250, lose:45,  shootOnSight:false },
  3: { name:'총순 순찰조·현상금',  arrive:30, reinforce:[3,60], max:12, search:400, lose:75,  shootOnSight:true  },
  4: { name:'시위대·진위대',       arrive:45, reinforce:[4,60], max:16, search:600, lose:120, shootOnSight:true  },
};
// arrive: 첫 추격조 도착(실초), reinforce: [명, 초 간격], search: 마지막 목격 지점 수색 반경(m), lose: 시야·수색 원 밖에 그만큼 있으면 추격 끝(실초)
```

**지역별 출동** (`regions[].wanted`. 출동조는 그 지역 경무서·관아에서, 없으면 플레이어에서 80 m 이상 떨어진 길 위 화면 밖에서 나온다)

| 수배 지역 | 1단계 | 2단계 | 3단계 | 4단계 |
|---|---|---|---|---|
| hanseong 한성(성안·성 밖 가까운 곳) | 순검 2 (경무서 5곳) | 순검 4 | 총순 1 + 순검 6 + 기마 순검 2(제주마) | 시위대 병정 8 + 현상금 사냥꾼 4 |
| gyeonggang 경강(마포·용산·노량진·양화진·한강진) | 나루 관병 1 + 순검 1, arrive ×1.5 | 관병 2 + 순검 2, ×1.5 | 총순 순찰조 | 시위대 병정 8 |
| gyeongin 경인가도(오리골·솔고개·소사·부평·산·들) | 마을 장정 2, arrive ×2 | 장정 4, ×2 | 현상금 사냥꾼 6 | 진위대 병정 8 [각색] |
| jemulpo 제물포 | 조계 안 조계 순경 2 / 조선인 구역 감리서 순검 2 | 각 4 | 순검 4 + 조계 순경 4 | 진위대 병정 8 [각색] |

- 1899년 지방 순검은 없다(1896년 폐지 [sec-02]). 그래서 경인가도는 마을 장정과 현상금 사냥꾼이 맡는다. 경무청 총순이 경인가도까지 쫓아오는 M04·M12 장면은 미션 스크립트이며 **[각색]**이다.
- 1~2단계 순검은 체포를 먼저 시도한다. 플레이어가 무기를 꺼내 겨누거나 공격하면 사격으로 바뀐다. 1~2단계에서 순검 근접에 쓰러지면 **체포**(자수와 같은 처벌 + 소지금 20% 압수).

**현상금(하나)**: `wanted.bounty`는 지도 전체에 하나다(지역 분리는 F).

| 항목 | 규칙 |
|---|---|
| 알아봄 | 현상금 100 이상이면 순검·병정이 10 m 안에서 1.5초 보면 알아본다(rough 이하 +2 m). 알아보면 현상금에 따라 1단계(500 미만)·2단계(1,500 미만)·3단계 |
| 현상금 사냥꾼 습격 | 현상금 1,500 이상이면 24게임시마다 35% 확률로 길 위에 3~4명 |
| 납부 | 경무청(`office_gyeongmu`), 노량진 진 관아(`office_noryangjin`), 부평 관아(`office_bupyeong`), 인천감리서(`office_gamniseo`)에서 현상금 전액. 수배 중에는 못 낸다 |
| 자수 | 같은 창구. 현상 300 미만: 태형(체력 30, 4게임시 지남) / 300~1,499: 태형 + 하루 구금(24게임시, 소지금 20% 압수) / 1,500 이상: 징역(72게임시, 소지금 50%, 총은 관아 보관 200전에 찾음) [sec-04 형률명례] |
| 뇌물 | **1단계에서만**, 순검이 체포하러 다가올 때 선택지. 비용 50 + 현상금 × 0.5. 추격 끝, 현상금 0, 의 −1 |
| 시간 경과 | 현상금 300 미만이고 그날 범죄가 없었으면 게임일마다 −10%. 300 이상은 줄지 않는다 |
| 미션 사면 | 보상 `pardon:true`면 현상금 0(M04) |
| 사망 | 추격만 끝, 현상금은 남는다 |

### G.4 의(義) 평판 (−100 ~ +100, 시작 0)

| tier | 범위 | 효과 |
|---|---|---|
| noble 의인 | 60 이상 | D.4 가격, 주막 잠 무료, 경범죄 목격자 신고 확률 −50% |
| decent 바른 이 | 20~59 | D.4 가격, 경범죄 신고 −25% |
| neutral 보통 | −19~19 | – |
| rough 거친 이 | −59~−20 | D.4 가격, 순검이 알아보는 거리 +2 m |
| outlaw 무뢰배 | −60 이하 | D.4 가격, 약방·총포상 거부(본편 미션은 대안 경로), 화적이 먼저 공격하지 않음 |

| 의가 오르는 행동 | 의 | 하루 한도 |
|---|---|---|
| 낯선 이 미션 완료 | 미션 표 | – |
| 화적·맹수에게 습격당한 행인 구하기 | +5 | – |
| 항복한 적을 살려 보내기 | +3 | – |
| 다친 행인에게 고약 주기 | +3 | +6 |
| 소매치기를 잡아 물건 돌려주기(길거리 사건) | +2 | – |
| 선로에서 자는 사람 깨워 옮기기(길거리 사건) | +1 | – |
| 말 쓰다듬기·말죽 | +1 | +2 |

| 의가 깎이는 행동(범죄 외) | 의 |
|---|---|
| 항복한 적을 처치 | −3 |
| 목격자 위협·뇌물, 검문 뇌물 | −1 |
| 자기 말 학대(1분에 5회 넘게 때림) | −1 |

엔딩 판정(±40)은 F. P는 의를 가격·대사·신고 확률에만 쓴다.

**잠과 휴식** (`stats.rest(hours)`)

| 장소 | 시간 | 비용 | 효과 |
|---|---|---|---|
| 주막 | 8게임시 | 그날 그 주막에서 식사를 샀으면 무료, 아니면 5전 [eco-12] | 체력·기력 가득, 호안 +30, 저장 |
| 산채 대청 | 8게임시 | 무료(`prologue_done` 뒤) | 주막과 같음 |
| 대불호텔 | 8게임시 | 일반실 200, 상등실 250 [port-04] | 가득 + 저장. 상등실은 회복 강화 2게임시 |

### G.5 시간·날씨·조수

| 항목 | 값 |
|---|---|
| 하루 | 실시간 48분, 1게임시 = 120실초. HUD에 `util.sijin(hour)` 시진 이름 |
| 시간대 | 새벽 4~6, 낮 6~18, 저녁 18~20, 밤 20~4 |
| 밤 효과 | NPC 시야 22 → 10 m, 플레이어가 횃불이면 보이는 거리 ×2. 가마꾼·인력거꾼·사공 21~5시 거부(삯 ×3이면 응함). 길 위 NPC 밀도 ×0.3, 주막 ×1.5. 늑대 무리, 범(북한산·인왕) |
| 통금 | **끔**(`curfewEnabled = false`). 성문은 늘 열고 문마다 밤 경비 순검 2명 [각색, geo-01: 1899년 무렵 야간 폐문·통금이 없어졌다는 서술은 연도 불명]. 숙정문은 늘 잠김 |
| 거리 조명 | 없음(1899년 한성 밤거리에 전등 없음 [pol-10]). 공사관·조계 등불, 주막 창불만 |

**날씨** (P는 4종. 폭풍·눈은 F)

| 날씨 | 가중치 | 지속(게임시) | 시야 배수 | 소리 배수 | 화승총 불발 | 동물 | 이동 |
|---|---|---|---|---|---|---|---|
| clear 맑음 | 50 | 3~8 | 1.0 | 1.0 | 0 | – | – |
| cloudy 흐림 | 25 | 2~6 | 0.95 | 1.0 | 0.02 | – | – |
| rain 비 | 15 (`drought` 동안 0) | 2~5 | 0.75 | 0.6 | 0.35 | 감지 ×0.8, 출현 ×0.8 | 바퀴 ×0.85, 말 ×0.95, 진흙 빠짐 ×2, 기력 회복 ×0.85 |
| fog 안개 | 10 (4~9시에 바뀔 때 ×3) | 1~4 | 0.45 | 1.0 | 0.1 | 시야 감지 ×0.5 | 기차 최고 10 m/s |

미션이 `weather`/`wind`를 정하면 그 미션 동안 고정한다(`forceWeather`, `forceWind`).

**조수** (time 시스템 하나가 담당)

```js
// totalHours = 날짜 인덱스 × 24 + hour (자정에 끊기지 않는 누적 시각)
time.tide = 0.5 + 0.5 * Math.cos(2 * Math.PI * (totalHours - 3) / 12.42); // 0 간조, 1 만조
```

P에서 조수는 HUD 표시와 대사에만 쓴다. 갯벌 칸이 물에 잠기는 지형 변화는 F(제물포 조차 약 11 m [port-03]).

### G.6 사망·부활·돈 표시

| 항목 | 규칙 |
|---|---|
| 자유 탐험 중 사망 | 2초 어두워짐 → 가장 가까운 `respawn` 장소 → 소지금 10%(최대 300전) 잃음 → 수배 0(현상금은 남음) → 게이지 가득. 소지품은 잃지 않는다 |
| 미션 중 사망·실패 | 미션 `checkpoint` 단계부터 재시작(돈 손실 없음). 무거운 짐은 다시 든 상태 |
| 부활 장소 | 제중원 앞, 마포나루 앞, 노량진 주막 앞, 오리골 주막 앞, 소사 장터, 인천 해관 앞, 청량리 주막 앞, 산채 모닥불(`prologue_done` 뒤) |
| 돈 표시 | `formatMoney`: 150전 → "15냥", 35전 → "3냥 5전", 7전 → "7전". 도감 '돈' 항목 고정 문구: "냥 체계에서는 1냥 = 10전 = 100푼(엽전 100닢)이고, 5냥이 1환(원)이었다. 그러니 경인선 운임 '1원 50전'의 전(1/100원)과 냥 체계의 전(1/10냥)은 값이 다르다. 이 게임은 셈을 쉽게 하려고 1원 = 10냥 = 100전으로 묶었다. [각색]" [eco-01, eco-03, eco-07] |


---

## H. 미션 (프롤로그 4 + 1장 8)

### H.0 공통

| 항목 | 규칙 |
|---|---|
| 판정 표기 | `reach{x,y,r}` 플레이어 위치 / `mount{vtype?|moveMode?, role?}` / `dismount` / `ride{line, from, to}` 승객으로 from에서 타서 to에서 내림 / `kill{tag?|faction?|species?, n, lethal?}` 생략 시 기절·사망 모두 셈 / `collect{itemId, n}` / `talk{npcId}` / `survive{seconds, keepAlive?}` / `escort{npcId, x, y, r}` 대상(탈것에 탔으면 탈것) 위치 / `skin{species, n}` / `buy{itemId, shop?}` / `flag{name, eq?}` / `custom{설명}` |
| 대사 | `화자: 내용`. 말풍선 하나 최대 2줄·40자. 외국인은 `[영어]`·`[일본어]` 꼬리표 뒤 자연스러운 한국어 |
| 중립 호칭 | 중립 인물·UI·도감은 '일본 사람', '청국 사람', '서양 사람'. '왜인·청인·양인'은 적대적이거나 거친 인물(방칠성, 성난 군중)의 대사에만 |
| 수동 구간 | 플레이어가 조작하지 않는 이동(승객·호위)은 한 번에 **90실초 이하**이고 그 안에 상호작용(선택 대사·검표·습격) 하나 이상. 넘는 곳은 페이드나 빨리감기 |
| 직접 노 젓기 | 200 m 이하 |
| 평판과 본편 | 본편 미션은 의 평판·상점 거부로 막히지 않는다(대안 경로) |
| 실패 | 표시된 실패 조건이 없으면 실패하지 않는다. 사망·`keepAlive` 대상 사망 = 실패 → `checkpoint` 단계부터 |
| 이름 있는 인물 | `essential`(0.3). 플레이어가 쏴도 기절 15초 뒤 도주 |
| 미션 아이콘 | 시작 가능한 미션은 지도에 '事' 낙관, 의뢰인 머리 위 같은 표식 |

### H.1 미션 목록

| 순번 | id | 제목 | 날짜·시각 | 선행 | 시작 | 새로 배우는 것 | 보상(돈 / 경험치 / 그 밖) |
|---|---|---|---|---|---|---|---|
| M01 | `pro01_ferry` | 나루를 건너 | 1899-05-17 07:00 맑음 | – (새 게임) | spawn (2707,1600) | 걷기·달리기, 대화, 나룻배(승객), 조랑말 | 0 / gima 50 / 조랑말 '먹구름' |
| M02 | `pro02_tram` | 전기거 | 05-17 11:00 | M01 (chain) | 용산나루 (2760,1452) | 보교 호위, 검문, 소매치기 추격, 전차 호출·요금 | 0 / gima 50 |
| M03 | `pro03_jail` | 옥문 | 05-17 23:00 맑은 밤 | M02 (chain) | 동대문 안 마방 (3160,808) | 웅크려 잠입, 맨손 제압, 뒤지기 | 0 / muye 80 |
| M04 | `pro04_escape` | 강을 건너라 | 05-17 23:30 | M03 (chain) | 경무청 서쪽 골목 (2660,742) | 수배·추격·떨치기, 나룻배 직접 노 젓기 | 100 / gima 100 / 현상금 사면, `prologue_done` |
| M05 | `ch1_01_hunt` | 늙은 범 포수 | 05-21 06:00 안개 | M04 | 산채 최만득 (1512,2150) | 사냥(활·바람), 가죽 벗기기 | 0 / saengjon 100 / 각궁·화살 20 |
| M06 | `ch1_02_riot` | 불타는 전차 | 05-26 14:00 맑음(가뭄) | M05 | 산채 마천복 (1488,2140) | 도덕적 선택과 의, 군중, 인력거 | 0(돈 편 +30) / cheose 80 / 덕구 합류 |
| M07 | `ch1_03_oxcart` | 솔고개 가는 쌀 | 06-12 09:00 흐림(소나기 뒤 진창) | M06 | 산채 마천복 | 소달구지, 진창, 매복 전투, 전리품 | 150 / sagyeok 80 / 솔고개 주막 할인 |
| M08 | `ch1_04_gobu` | 고부에서 온 여자 | 06-15 16:00 맑음, 북동풍 고정 | M07 | 솔고개 주막 엄순례 (1560,1720) | 황포돛배(바람·돛), 배 위 사격, 호위 | 0 / gima 80 / 유선녀 합류 |
| M09 | `ch1_05_gama` | 가마 탄 양반 | 08-17 08:00 맑음, 무더위 | M08 | 솔고개 주막 앞 오장헌 (1548,1722) | 보교 호위·양반 위장, 조계, 총포상 | 0 / cheose 80 / `rifle_unlocked` |
| M10 | `ch1_06_steamer` | 모래톱 | 08-18 05:30 맑음, 썰물 | M09 (chain) | 해관 앞 부두 (440,1732) | 증기선, 좌초, 배 위 방어, 삼판 | 300 / sagyeok 100 / `news_constitution` |
| M11 | `ch1_07_scout` | 개통 열차 | 09-19 06:30 맑음 | M10 | 산채 오장헌 (1500,2122) | 기차·시간표·차표·검표, 정찰 | 0(차비 80 지급) / cheose 60 |
| M12 | `ch1_08_robbery` | 솔고개 열차 | 09-22 13:00 흐림 | M11 | 솔고개 주막 앞 오장헌 | 열차 강도, 무거운 짐, 3단계 수배 | 1,000 / sagyeok 100 + gima 100 / 양총, `ch1_done`, 9/28로 이동 |

**탈것 첫 체험 시점(누적 플레이 추정)**: 나룻배·조랑말 2~3분 → 보교 약 5분 → 전차 6~7분 → 직접 노 젓기 약 18분 → 인력거 약 40분 → 소달구지 약 50분 → 황포돛배 약 60분 → 시운전 열차 구경 약 70분 → 증기선 약 80분 → 기차 약 95분.

**카드 문구**

| 때 | 문구 |
|---|---|
| 타이틀 위 | 광무 3년, 1899년. 한성에 전기거가 달리고, 한강 건너 철길이 놓이고 있었다. |
| 타이틀 다음 30초 장면 | 흥인지문 홍예 밑으로 전차가 지나간다(카메라 스크립트, 위치 d 1009.9). 화면 밖에서 멀리 기적 소리(M12 열차 소리를 미리 들려줌) |
| M01 시작 | 사람들은 이것을 개화라 불렀다. 어떤 이들은 끝이라 불렀다. |
| M05 시작 | 제1장 솔고개. 새 길은 누구의 것인가. |
| M11 시작 | 1899년 9월 18일, 경인철도 개통. 노량진에서 제물포까지 화륜거가 다닌다. |
| M12 아웃트로 끝 | 1장 끝. 철궤 속에는 돈보다 무거운 것이 들어 있었다. |

---

### M01 `pro01_ferry` 나루를 건너

- 시작: 새 게임. `set{time:'07:00', weather:'clear'}`. 플레이어 (2707,1600), 소지품은 D.1 시작 소지품.
- 생성: 노량진 사공 `sagong_noryang`(2730,1574), 나룻배 `rowboat`(owner public, 관선) 노량진나루 b점 (2730,1554). 덕구와 조랑말 '먹구름'(pony, 수말) `deokgu_m01` (2770,1440).
- checkpoint: 1

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 노량진나루로 가라 | `reach{2730,1572,20}` | 이동 조작 안내(WASD·Shift). 길가에 철둑 공사 인부(`rail_construction`) |
| 2 | 사공에게 말을 걸어라 | `talk{sagong_noryang}` | 선택지: ① 막걸리 값 1전을 준다(돈 −1, 의 +1) ② 그냥 탄다 |
| 3 | 나룻배에 올라라 | `mount{vtype:'rowboat', role:'passenger'}` | F 안내. 사공이 자동으로 젓는다(약 50초). 배 위에서 사공 대화가 이어진다 |
| 4 | 용산나루에 내려라 | `reach{2760,1452,25}` | 닿으면 자동 하선 |
| 5 | 덕구를 만나라 | `talk{deokgu}` | |
| 6 | 조랑말 '먹구름'에 올라라 | `mount{moveMode:'horse'}` | 완료 시 `vehicles.setPlayerHorse(먹구름)`. 휘파람(H) 안내 |

대사

- (자막) 광무 3년, 1899년 5월 17일. 음력 사월 초파일.
- 사공: 관선이라 삯은 없소. 그래도 막걸리 한 사발 값은 인정이지.
- 한길: …한성에 무슨 구경거리라도 났소?
- 사공: 전기거라나. 소도 말도 없이 쇠수레가 저 혼자 간다오.
- 사공: 비가 안 오는 것도 그 탓이라던데. (단계 3, 배 위)
- 덕구: 아저씨가 한길 아저씨죠? 선생님이 이 말 드리래요. 이름은 먹구름!
- 덕구: 수놈이라 딴 말 보면 물어요. 고삐 꽉 잡아요!

보상: 경험치 gima 50.

---

### M02 `pro02_tram` 전기거(電氣車)

- 시작: M01 완료 즉시(chain). onStart `fade{text:'오전 내내 장터를 돌다', set time 11:00}`. `tram_festival`.
- 생성: 오장헌이 탄 보교(bokyo, 가마꾼 2) `chilpae_gama` (2515,1118). 숭례문 안쪽에 검문 순검 2(police). 종로에 연등 군중 40명(civilian), 소매치기 `p2_pickpocket` 1명(아이, 5.0 m/s, `q_ssamji` 소지)은 단계 5 시작 때 `pickpocket_run` (2885,790).
- checkpoint: 1, 4

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 칠패장에서 오장헌의 보교를 찾아라 | `reach{2515,1118,20}` | 용산길 → 숭례문 밖 칠패, 약 450 m 말 |
| 2 | 보교에 탄 오장헌에게 말을 걸어라 | `talk{oh_janghun}` | onDone: 덕구가 먹구름을 끌고 동대문 안 마방으로 간다(스크립트, 마방에 맡김). 플레이어는 걸어서 |
| 3 | 보교를 따라 숭례문을 지나라 | `escort{oh_janghun, 2575,1068, 12}` | 약 75 m. 문에서 순검이 가마를 세우고 스크립트 대화 → '양반 가마'라 통과 |
| 4 | 종로 보신각 앞으로 가라 | `reach{2860,782,8}` | onStart `fade{text:'한 식경 뒤, 종로 운종가', teleport:{player:[2850,800], npcs:{oh_janghun:[2862,784]}}}` (보교는 사라지고 오장헌은 걸어서) |
| 5 | 쌈지를 훔쳐 달아나는 아이를 잡아라 | `collect{q_ssamji, 1}` `timeout{60, then:'skip', flag:'pickpocket_escaped'}` | 아이를 맨손으로 넘어뜨리면 쌈지를 떨어뜨린다(E로 줍기). 아이에게 무기 피해를 주면 군중이 비명, 의 −3(assault). 질주·맨손 안내 |
| 6 | 오장헌에게 돌아가라 | `talk{oh_janghun}` | 놓쳤으면 다른 대사 |
| 7 | 종로 타는 곳에서 손을 들어 전차를 세우고 올라라 | `mount{vtype:'tram', role:'passenger'}` | onStart `vehicles.forceArrival('tram','jongno',20)`. 표석 (2860,798) 4 m 안에서 E(손 들기) 안내. 덕구가 있다면 칸 설명 |
| 8 | 전차를 타고 동대문까지 가라 | `ride{tram, jongno, dongdaemun}` | 약 105실초. 탄 뒤 8초에 차장의 요금 요구(구간 2 → 하등 3전·상등 7전, **오장헌이 낸다**). 상주 승객 장면 |
| 9 | 동대문 마방에서 말을 빌려라 | `talk{mabang_ju}` | 말 세 필 값은 오장헌이 낸다(플레이어 돈 변화 없음). `flag horses_rented`. 아웃트로 후 M03 |

대사

- 덕구: 선생님은 칠패에 계세요. 보교 타고 계셔요! (1)
- 오장헌: 왔느냐, 길아. 오늘 나는 홍주 오 진사니라. 너는 내 하인이고. (2)
- 순검: 거기 가마 멈추시오. 어느 댁 행차요? (3)
- 오장헌: 홍주 오 진사일세. 초파일 구경 나왔네. 길을 비키게.
- 순검: …실례했소이다. 지나가시오.
- 오장헌: 저 쇠수레를 보아라. 황제의 돈으로 깔고, 미국 사람 기술로 굴리고, 일본 사람 운전수가 몬다. (4) [tram-03, tram-07]
- 오장헌: 백성은 구경만 하지. …이런, 쌈지가 없구나!
- 덕구: 저 애예요! 저기 달려가요! (5)
- 오장헌: 잘했다. 쌈지보다 네 걸음을 보러 온 것이니라. (6, 잡음) / 됐다. 쌈지보다 아까운 건 저 애의 처지니라. (6, 놓침)
- 오장헌: 천복이가 경무청 옥에 갇혔다. 오늘 밤, 순검들이 등불 구경꾼에 매여 있을 때 꺼낸다.
- 덕구: 상등칸은 가운데, 하등칸은 앞뒤예요. 돈만 내면 누구나 상등에 앉아요! (7) [eco-08]
- 차장: 큰 상립 쓰신 상주께선 세 곱이오! (8) [tram-05]
- 오장헌: 이 쇠수레 바퀴 밑에 깔리는 게 무엇인지 아느냐. 인력거꾼 밥줄이니라. (8)
- 마방 주인: 조랑말은 수놈이라 저희끼리 물어뜯소. 떨어뜨려 매어 두시오. (9) [land-06]

보상: 경험치 gima 50.

---

### M03 `pro03_jail` 옥문(獄門)

- 시작: chain. onStart `fade{text:'그날 밤', set time 23:00}`. 오장헌·바우가 각자 말(pony)을 타고 따라온다(companion).
- 생성: 순검 2 `p3_guard`: ① 옥사 문 앞 (2664,709) 정지·북쪽 보기, 열쇠 소지 ② 골목 순찰 (2667,700)↔(2667,722). 마천복 (2663,712)(옥사 창살 문 안쪽 자리). 육조거리 순찰 순검 4(일반).
- checkpoint: 1, 3

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 경무청 서쪽 골목으로 말을 몰아라 | `reach{2660,742,10}` | 약 520 m. 밤 거리는 어둡다(전등 없음) |
| 2 | 말에서 내려라 | `dismount` | |
| 3 | 웅크려(C) 골목 어귀로 숨어들어라 | `reach{2667,730,5}` | 웅크리기·감지 게이지 안내 |
| 4 | 옥사 앞 순검 둘을 소리 없이 제압하라 | `kill{tag:'p3_guard', n:2}` | 맨손 잠입 처치(E) 안내. 죽이면 순검 살해 범죄(G.3). 들키면 호각 → 즉시 단계 6 처리로 넘어감(수배 2) |
| 5 | 쓰러진 순검을 뒤져 옥 열쇠를 찾아라 | `collect{q_jail_key, 1}` | 뒤지기(E 1.2초) 첫 안내 |
| 6 | 옥문을 열고 마천복을 꺼내라 | `talk{ma_cheonbok}` | onDone: 호각. `wanted.set` = 범죄 `jailbreak`(현상 150, 2단계) |
| 7 | 골목에 맨 말에 올라라 | `mount{moveMode:'horse'}` | 말 3필 `gyeongmu_horses` (2660,742) |

대사

- 오장헌: 피는 보지 말거라. 순검도 품삯 받는 백성이니라. (1)
- 순검: 거기 누구요! 여기는 경무청 뒷마당이오! (4, 들켰을 때)
- 마천복: 늦었구먼, 선생. 내 셈엔 어제 왔어야 했는데. (6)
- 마천복: 길이, 이 은혜는 장부에 적어 두마.
- 바우: (호각 소리) 들켰소! 말로! (6 끝)

보상: 경험치 muye 80. 이 미션에서 순검을 죽이지 않았으면 `no_police_killed = true`(M04에서 이어 셈).

---

### M04 `pro04_escape` 강을 건너라

- 시작: chain. 수배 2(한성). 미션 스크립트로 총순 **이시중**(jeju_horse, 육혈포, `essential`)이 육조거리 (2720,700)에서 따라온다(수배 출동과 별개 [각색]).
- 생성: 단계 3 시작 때 거룻배(rowboat) 용산나루 a점 (2760,1474), 오장헌·마천복이 승객으로 탄다. 단계 5 시작 때 윤팔과 조랑말 3필 (2700,1610).
- checkpoint: 1, 3, 5

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 남대문로를 달려 숭례문을 빠져나가라 | `reach{2575,1068,15}` | 약 420 m. 순검 4~8 + 이시중 |
| 2 | 용산나루까지 달려라 | `reach{2760,1452,20}` | 용산길 약 430 m |
| 3 | 말에서 내려 거룻배에 올라 노를 잡아라 | `mount{vtype:'rowboat', role:'driver'}` | 덕구가 말을 맡는다(먹구름은 아침 관선으로 → 산채 말뚝에 나타남) |
| 4 | 노를 저어 노량진나루에 닿아라 | `reach{2730,1572,20}` | 85 m(직접 젓기 ≤ 200 m). 이시중이 북쪽 기슭 (2760,1450)에서 2초마다 육혈포(퍼짐 ×1.5) |
| 5 | 윤팔이 끌고 온 말에 올라라 | `mount{moveMode:'horse'}` | |
| 6 | 추격을 떨쳐라 | `custom{플레이어가 말 위 && wanted.level === 0}` | 경강 출동(관병·순검, arrive ×1.5). 노량진 나루길·옛길 서쪽 |
| 7 | 수리산 산채로 가라 | `reach{1500,2140,40}` | 옛길 → 솔고개 → 산채 오솔길. 윤팔이 앞장(경로 표식) |

대사

- 이시중: 멈추시오! 경무청 총순 이시중이오! (1)
- 덕구: 먹구름은 제가 아침 배로 건네 갈게요! 어서 가요! (3)
- 오장헌: 저어라, 길아. 물살 거슬러 비스듬히! (4)
- 윤팔: 이쪽이오! 말 세 필 대 놨소! (5)
- 오장헌(산채): 오늘 밤 우리는 한 사람도 버리지 않았다. 그것이 우리가 화적과 다른 까닭이니라. (아웃트로)
- 마천복: 경무청 서리 하나 내 셈에 들어 있구먼. 길이 얼굴은 문서에서 지워질 게여.
- 한길(속말): …그 말을 믿고 여기까지 왔지.

보상: 돈 100(마천복의 사례), 경험치 gima 100, `pardon:true`(현상금 0), `no_police_killed`면 의 +3. 플래그 `prologue_done`: 산채 대청 잠(저장), 노 서방 솥(F.1 강화), 산채 부활, 장물 `fence_camp` 해금.

---

### M05 `ch1_01_hunt` 늙은 범 포수

- 시작: 의뢰인 최만득(산채). 날짜 05-21 06:00, 안개. 카드 "제1장 솔고개". 시작 때 각궁과 화살 20을 준다(없으면). 최만득은 자기 조랑말을 타고 따라온다(companion, 사냥 중엔 30 m 뒤에서 웅크림).
- 생성: 단계 2 시작 때 노루 2 `m05_deer` (930,1200), 꿩 3 `m05_pheasant` (880,1265). 이 미션 동안 `hunt_gyeyang`은 늑대·멧돼지 0.
- checkpoint: 1

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 최만득과 계양산 사냥터로 가라 | `reach{910,1240,80}` | 약 1.4 km(오솔길 → 옛길 서쪽 → 계양산 길). 말 타고 3~4분 |
| 2 | 바람을 안고 노루에게 다가가 활로 잡아 가죽을 벗겨라 | `skin{species:'roe_deer', n:1}` | 바람 화살표 일시 표시(스킬 없어도 이 단계만). 웅크리기·활 당기기 안내 |
| 3 | 꿩 두 마리를 잡아라 | `kill{species:'pheasant', n:2}` | |
| 4 | 고기와 가죽을 말에 싣고 산채로 돌아가라 | `reach{1500,2140,30}` | |
| 5 | 노 서방에게 고기를 넘겨라 | `talk{no_seobang}` | 선택지: ① 고기를 솥에 넘긴다(날고기 −2, 의 +1, `camp_fed`) ② 내가 갖는다 |

대사

- 최만득: 짐승은 바람을 읽어. 니 냄새가 바람 타믄 그날 사냥은 끝이여. (1)
- 최만득: 바람을 안고 가. 노루 쪽에서 니 쪽으로 불어야 혀. (2)
- 최만득: 활은 소리가 없어. 화승총은 불씨 꺼지믄 쇠막대기고.
- 최만득: 가죽은 결 따라 벗겨. 칼이 급하믄 값이 반이여. (2 끝)
- 최만득: 요새는 범도 줄고 포수도 줄었어. 둘 다 철길 공사 소리에 쫓겨 가는 게지. (4)
- 노 서방: 고기 냄새 맡으니 산채가 사람 사는 데 같구먼. (5)

보상: 경험치 saengjon 100(사냥·가죽 행동 경험치는 따로).

---

### M06 `ch1_02_riot` 불타는 전차

- 시작: 의뢰인 마천복(산채). 날짜 05-26 14:00 맑음. 의뢰 대사 뒤 `fade{text:'닷새 뒤 한낮, 숭례문 밖 칠패', teleport:{player:[2530,1140], 플레이어 말 곁에}}`.
- 생성: 단계 1 끝에 종로 2가 (2975,791)에 멈춘 전차(`tram_riot`, 운전수 `motorman_jp` 일본인, 차장 `conductor_kr` 조선인. 이 미션 동안 둘 다 `essential` 아님). 군중 30명(civilian, 태그 `rioter`), 덕구(2950,800).
- **아이는 그리지 않는다.** 군중의 등, 비명, 종소리, 자막으로만 처리한다.
- checkpoint: 2(분기 선택 뒤 다시 하면 같은 선택 유지)

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 종로 2가로 가라 | `reach{2975,791,25}` | onDone 장면(자막): "전차가 멈췄다. 사람들이 몰려들었다. 아이 아버지가 도끼를 들고 달려들었다." [tram-08, life-11]. 플래그 `tram_suspended`(전차 운휴 시작) |
| 2 | 어느 편에 설지 정하라 | `flag{riot_choice}` | `ui.choice`: ① 불을 놓는다(`crowd`) ② 사람부터 살린다(`save`) ③ 요금 주머니를 챙긴다(`loot`) |
| 3a | 전차에 불을 붙여라 | `when{riot_choice:'crowd'}` `custom{전차 앞 E 3초 → flag tram_burned}` | onDone: 범죄 `arson`(현상 100, 2단계), 플래그 `rickshaw_friend` |
| 3b | 운전수와 차장을 45초 동안 지켜라 | `when{save}` `survive{45, keepAlive:['motorman_jp','conductor_kr']}` | 군중 8명이 3·3·2명씩 덤빈다. `rioter`는 맨손 제압해도 범죄 아님. 총을 쏘면 사람 살상은 일반 규칙. 둘 중 하나가 죽으면 실패 → 단계 3b부터. 군중은 전차에 불을 붙인다(막을 수 없음) |
| 3c | 차장의 요금 주머니를 챙겨라 | `when{loot}` `collect{q_fare_bag, 1}` | 줍는 즉시 돈 +30. 목격자 스크립트로 범죄 theft(1단계) |
| 4 | 버려진 인력거를 잡아라 | `mount{vtype:'rickshaw', role:'driver'}` | 덕구 아버지의 인력거 (2990,800). save면 다친 차장이 손님으로 탄다 |
| 5a | 다친 차장을 제중원으로 옮겨라 | `when{save}` `custom{인력거가 (3000,889) r12 안, 손님 conductor_kr}` | 약 90 m. 운전수는 뒤따라 걷는다. 송애순이 문 앞에서 받는다 |
| 5b | 인력거를 끌고 칠패까지 빠져나가라 | `when{crowd 또는 loot}` `reach{2530,1140,20}` | 약 600 m, 덕구가 손님으로 탄다. 수배 중 |
| 6 | 덕구와 이야기하라 | `talk{deokgu}` | 플래그 `deokgu_joined`(덕구가 산채로). save는 송애순 소개 대사 추가 |

대사

- 군중: 애가 깔렸다! 애가! (1)
- 행인: 비가 안 오는 게 다 저 쇠수레 탓이라더니! [tram-08]
- 성난 군중: 왜인 운전수가 애를 두고 내빼려 한다! (2) [life-11: 일본인 운전수 도주 보도. 이 운전수 묘사는 각색]
- 운전수: [일본어] 아이를… 못 봤소. 정말이오. (3b)
- 차장: 나도 조선 사람이오! 품 팔러 나왔을 뿐이오! (3b)
- 송애순: 총상은 아니네요. 머리 다친 건 오늘 밤이 고비예요. 눕혀 주세요. (5a)
- 덕구: 우리 아버지가 순검한테 끌려갔어요. 인력거꾼들 앞장섰다고… (6)
- 한길: …가자. 산에 가면 밥은 굶지 않는다. (6)

보상: 경험치 cheose 80. 의: crowd 0, save +5, loot −8. 돈: loot +30(주머니).

---

### M07 `ch1_03_oxcart` 솔고개 가는 쌀

- 시작: 의뢰인 마천복(산채). 날짜 06-12 09:00 흐림. **가뭄 끝 첫 소나기 뒤**: 2게임시 동안 땅은 비 효과(바퀴 ×0.85, 진흙 빠짐 ×2).
- 생성: 단계 2 끝에 소달구지(oxcart, 쌀 두 섬·소금 한 섬 실음) (1270,1735). 단계 4 도달 때 화적 5(rival): (1470,1700)×2, (1430,1750)×2, 방칠성 (1480,1745, `bandit_boss`, `essential`, `fleeAt 0.5`).
- checkpoint: 1, 4

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 소사장으로 가라 | `reach{1280,1728,25}` | 산채에서 약 680 m |
| 2 | 객주 사람에게 쌀과 소금을 받아라 | `talk{sosa_gaekju}` | |
| 3 | 소달구지를 몰아라 | `mount{vtype:'oxcart', role:'driver'}` | 진흙 빠짐·E 연타 안내 |
| 4 | 솔고개 쪽으로 달구지를 몰아라 | `reach{1450,1726,25}` | 약 170 m |
| 5 | 진창에서 덮친 화적을 물리쳐라 | `kill{faction:'rival', n:4}` | 달구지·나무 뒤 엄폐 안내. 방칠성은 체력 50%에서 숲으로 달아남(잡을 수 없음) |
| 6 | 화적 시체에서 '불여우 목패'를 찾아라 | `collect{q_rival_tag, 1}` | 첫 번째로 쓰러진 화적이 가진다 |
| 7 | 달구지를 솔고개 주막까지 끌고 가라 | `custom{소달구지가 (1560,1724) r20 안}` | 엄순례가 맞는다 |

대사

- 마천복: 쌀 두 섬, 소금 한 섬. 소달구지는 느려도 배신은 안 하지. (1)
- 방칠성: 돌쇠야! 오랜만이다. 이름 바꿨다고 근본이 바뀌더냐? (5)
- 한길: 그 이름으론 이제 안 불려.
- 방칠성: 이 길은 불여우 길이다. 다음엔 쌀 대신 네 머리를 싣고 가마. (5, 달아나며)
- 엄순례: 아이고 이 화상아, 진창 조심허라 했지. 몇 해 전엔 청국 사람 달구지가 봄까지 박혀 있었어. (7) [land-08, 1894년 무렵 기록]
- 엄순례: 쌀은 광에 부리고, 국밥이나 한 그릇 혀.

보상: 돈 150, 경험치 sagyeok 80, 플래그 `solgogae_discount`(솔고개 주막 ×0.9).

---

### M08 `ch1_04_gobu` 고부에서 온 여자

- 시작: 의뢰인 엄순례(솔고개 주막). 날짜 06-15 16:00 맑음. **바람 고정: `wind.angle = 2.36`(북동풍, 남서쪽으로 붊), `strength = 0.45`** → 마포→염창 뱃길에서 돛 각도 약 57~75°, 효율 0.85~0.9, 약 3.7~3.9 m/s.
- 생성: 유선녀 `yeogak_back` (2300,1378). 단계 2 끝에 구만석(`bounty`, `essential`, 화승총) + 부하 2 `bounty_men`(몽둥이)이 여각 앞 (2300,1350)에서. 단계 4 때 황포돛배 (2352,1424, angle π). 단계 5 시작 30실초 뒤 구만석의 쪽배(rowboat, 구만석 + 사공) (2380,1440), 2.6 m/s로 뒤따르며 사격. 단계 6 때 바우와 조랑말 2 `yeomchang_horses` (1815,1312).
- checkpoint: 1, 4

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 마포 여각 뒷방으로 가라 | `reach{2300,1378,10}` | 옛길 → 여의도 모래길 → 마포나루 나룻배 |
| 2 | 뒷방의 여인을 찾아라 | `talk{yu_seonnyeo}` | |
| 3 | 구만석 일당을 막아라 | `kill{tag:'bounty_men', n:2}` | 구만석은 부하가 다 쓰러지거나 체력 50%면 물러난다 |
| 4 | 마포나루의 황포돛배에 올라 키를 잡아라 | `mount{vtype:'sailboat', role:'driver'}` | 유선녀가 선원 자리. 돛 3단(Shift·Space) 안내, 바람·돛 효율 HUD |
| 5 | 강을 내려가 염창 둔치에 배를 대라 | `reach{1810,1276,22}` | 약 550 m, 약 2분 30초. 구만석 쪽배는 따라오지 못하고 사격만. 밤섬 (2240,1438) 피하기 |
| 6 | 유선녀와 함께 산채로 가라 | `escort{yu_seonnyeo, 1500,2140, 40}` | 유선녀·바우는 각자 말. 약 1.1 km. 가는 동안 유선녀 대사(영학당 [out-06]) |

대사

- 엄순례: 마포 여각에 전라도 여자가 숨어 있댜. 영학당이랴. 관찰부가 현상 걸었다는 말이 돌어. (시작)
- 유선녀: 고부에서 왔소. 군아를 쳤고, 졌소. 그게 다요. (2)
- 구만석: 전라 관찰부 현상금이오. 비켜 주면 당신은 안 쏘오. (2 끝)
- 한길: 현상금 붙은 머리가 여기 하나 더 있는데.
- 유선녀: 돛은 내가 잡겄소. 당신은 키나 놓치지 마시오. (4)
- 유선녀: 바람이 뒤에서 비껴 분께 돛 다 올리시오. (5)
- 구만석: (멀리서) 강은 길고 현상은 오래 가오. (5)
- 유선녀: 아부지는 갑오년에 죽었소. 나는 올해 오월에 고부 군아를 쳤고. 다음은 어딘지 모르겄소. (6)
- 오장헌(산채): 영학당의 불씨가 우리 산채에 왔구나. 반갑소, 동지. (아웃트로)
- 유선녀: 동지라는 말은 싸울 때 들어도 늦지 않소.

보상: 경험치 gima 80, 의 +3(호위 성공), 플래그 `yu_joined`. 먹구름은 산채 말뚝으로 옮겨 둔다.

---

### M09 `ch1_05_gama` 가마 탄 양반

- 시작: 의뢰인 오장헌(솔고개 주막 앞, 양반 차림 갓·도포). 날짜 08-17 08:00 맑음. 오장헌은 걸어서 따라온다.
- 생성: 가마꾼 2 `gama_bearers` (1300,1723). 단계 2 끝에 보교(오장헌 탐). 단계 3 시작 40실초 뒤 **시운전 열차**(기관차 + 화차 2, 8 m/s)를 철로 d 1100에서 제물포 쪽으로 출발시켜 행렬 옆을 지나게 한다(기적 2회). 부평 관아 앞 사령 `bupyeong_saryeong` (945,1678). 현덕만(대불호텔 문 앞 (420,1634)). 단계 7 시작 때 유선녀가 서양 상회 앞 (520,1482)에 선다.
- checkpoint: 1, 5

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 소사 가마꾼 대기소로 가라 | `reach{1300,1723,10}` | 약 260 m |
| 2 | 가마꾼 둘을 부려라 | `talk{gama_bearers}` | 삯 15전 선불. 돈이 모자라면 오장헌이 낸다 |
| 3 | 보교를 호위해 부평 관아 앞까지 가라 | `escort{oh_janghun, 945,1678, 20}` | 약 340 m, 2.2 m/s(Shift로 가마꾼 재촉 가능). 소사 주막 앞에서 가마꾼이 쉬자고 한다(선택: 팁 2전 / 재촉). 시운전 열차가 지나간다 |
| 4 | 관아 사령의 검문을 받아라 | `talk{bupyeong_saryeong}` | 선택: ① "홍주 오 진사 행차요"(통과) ② 말없이 오장헌에게 맡긴다(통과). 둘 다 통과 [land-03] |
| 5 | 대불호텔까지 보교를 모셔라 | `escort{oh_janghun, 420,1634, 8}` | onStart `fade{text:'한 시진 뒤, 축현', teleport:{player:[650,1613], 보교 [655,1613]}}`. 약 230 m |
| 6 | 대불호텔 앞에서 현덕만을 만나라 | `talk{hyeon_deokman}` | 한길은 문밖. 창 너머로 오장헌과 현덕만이 악수하는 장면 |
| 7 | 제물포 서양 상회에서 양총 탄을 사라 | `buy{itemId:'a_rifle', shop:'gun_jemulpo'}` `alt{talk:'yu_seonnyeo'}` | 거부(outlaw)·돈 없음이면 상회 앞의 유선녀에게 말을 걸면 그가 대신 산다(양총 탄 10 지급) |
| 8 | 해관 앞 부두로 가라 | `reach{440,1732,20}` | 아웃트로: 유선녀가 소금 가마니 5짝(양총 20정)을 내일 아침 증기선에 실어 두었다 |

대사

- 오장헌: 오늘 나는 홍주 오 진사다. 너는 내 하인이고. 고개를 들지 말거라. (시작)
- 가마꾼: 나리, 주막마다 목을 축여야 다리가 갑니다요. (3) [land-05]
- 오장헌: 저 쇳덩이 소리를 들어라. 다음 달이면 사람을 싣는다지. (3, 시운전 열차)
- 사령: 어느 댁 행차시오? 요즘 길에 화적이 많아서. (4)
- 현덕만: 기차는 기다려 주지 않습니다. 양반도, 화적도요. (6)
- 현덕만: 구월 스무이튿날, 제물포 오후 한 시 상행. 맨 끝 화차에 회사 보상금이 실립니다.
- 현덕만: 양총 스무 자루는 제 인사로 받아 두시지요. 셈은 깔끔하게 하시지요.
- 한길(속말): 왜 저자가 우리한테 이걸 알려 주지?
- 상회 주인: [영어] 탄은 한 상자에 열 발이오. (7)
- 유선녀: 소금 가마니에 총이라. 짠 내 덕에 해관도 손 안 대겄소. (8)

보상: 경험치 cheose 80, 플래그 `rifle_unlocked`(제물포 서양 상회에서 양총 900전).

---

### M10 `ch1_06_steamer` 모래톱

- 시작: chain. onStart `fade{text:'이튿날 새벽', set date 08-18 05:30}`. 오장헌·유선녀 동행. 뱃삯 75전은 오장헌이 낸다.
- 생성: 증기선(일본계 회사 [river-08 각색], 06:00 발 상행). 단계 3 끝에 수적 쪽배 2척(각 수적 2, `river_pirates`, 화승총·돌). 단계 6 때 삼판(rowboat, 사공 `sampan_sagong`). 단계 7 때 수적 쪽배 1척(수적 2, `pirate_skiff`).
- checkpoint: 1, 4, 6

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 제물포 잔교 끝으로 가라 | `reach{450,1842,8}` | |
| 2 | 증기선에 올라라 | `mount{vtype:'steamer', role:'passenger'}` | 06:00 출발 |
| 3 | 강을 거슬러 올라가라 | `custom{증기선이 aground_1 (1673,1105) 도달 → flag steamer_aground}` | **빨리감기 ×8 강제**(약 90실초, 게임 약 12:00 도착). 빨리감기 중 선원 대사 1회 |
| 4 | 배에 오르는 수적을 물리쳐라 | `kill{tag:'river_pirates', n:4}` | 갑판 엄폐 |
| 5 | 짐칸의 소금 가마니를 챙겨라 | `collect{q_rifle_bales, 1}` | 무거운 짐(D.1) |
| 6 | 지나가는 삼판에 옮겨 타라 | `mount{vtype:'rowboat', role:'passenger'}` | 사공이 젓는다 [river-09] |
| 7 | 따라붙는 수적 쪽배를 막아라 | `kill{tag:'pirate_skiff', n:2}` | 삼판 위에서 사격 |
| 8 | 마포나루에 내려라 | `reach{2340,1394,15}` | onStart `fade{text:'한 시진 뒤, 마포', teleport:{삼판 → 마포 부두 남쪽 끝}}` |

대사

- 선원: 모래톱이 물때마다 자리를 바꾸니 뱃길은 하늘이 정하오. (3) [river-09]
- 수적: 배 세워라! 짐 내려놓으면 목숨은 붙여 준다! (4)
- 유선녀: 가마니부터 챙기시오. 저 배는 밀물이나 기다릴 판이오. (5)
- 삼판 사공: 몇 시간 늦어도 마포는 마포요. 타시오. (6)
- 마천복: 스무 자루. 셈 맞구먼. (8, 아웃트로)
- 신문팔이: 호외요, 호외! 대한국국제 반포요! 황제 폐하 전권이오! (아웃트로 뒤 마포 거리) [pol-03: 8/17 반포. 이튿날 마포의 호외 장면은 각색]

보상: 돈 300, 경험치 sagyeok 100, 플래그 `news_constitution`. 증기선은 밀물에 다시 떠 마포에 늦게 닿는다(배경).

---

### M11 `ch1_07_scout` 개통 열차

- 시작: 의뢰인 오장헌(산채). 날짜 09-19 06:30 맑음. 카드 "1899년 9월 18일, 경인철도 개통". 시작 때 돈 +80(차비). 덕구 동행(걸어서, 기차는 같은 칸).
- 생성: 열차 승객으로 다카다(`takada`, 1·2등 합조 객차)와 이시중(`lee_sijung`, 사복, 3등칸). 인천 화물 하치장 (370,1680)에 화차 1량과 회사 경비 2(`company`) 순찰.
- `retry:'nextDay'`: 9:00 열차를 놓치거나 13:00 열차를 놓치면 "열차를 놓쳤다" → 다음 날 06:30 산채(또는 11:00 제물포)에서 해당 단계부터.
- checkpoint: 1, 4

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 9시 전에 노량진 정거장으로 가라 | `reach{2400,1728,15}` | 약 1.3 km, 조랑말 구보 약 3.6분(게임 약 08:18 도착) |
| 2 | 매표소에서 3등 차표를 사라 | `buy{itemId:'ticket_train_3', shop:'ticket_noryangjin'}` | 전 구간 40전 |
| 3 | 오전 9시 열차로 인천까지 가라 | `ride{train, noryangjin, jemulpo}` | 같은 칸 대화(아래). 선택에 따라 `suspicion` = 'low'/'high'. 소사 뒤 승객 건너뛰기 가능 |
| 4 | 화물 하치장에서 회사 화차를 살펴라 | `flag{boxcar_inspected}` | 화차 문에 E 2초. 경비가 8 m 안에서 보면 "구경꾼은 비키시오"로 5 m 밀려남(범죄 아님), 다시 시도 |
| 5 | 오후 1시 열차를 타고 오류동에서 내려라 | `ride{train, jemulpo, oryu}` | 표(오류동 3등 30전) 필요, 없으면 검표 벌금. 오류동 요청 정차. 14:07 무렵 솔고개 굽이를 지날 때 카메라가 차창 밖을 보여 준다 |
| 6 | 솔고개 주막까지 걸어가라 | `reach{1560,1720,10}` | 오류동에서 약 300 m |
| 7 | 엄순례에게 알려라 | `talk{eom_sunrye}` | |

대사

- 덕구: 3등 표가 사십 전이래요. 닭 두 마리 값이에요! (2) [rail-06]
- 덕구: (신문을 펼치고) "기차 소리는 우레 같고… 나는 새도 미처 따르지 못한다." 독립신문에 났어요! (3) [rail-09, 독립신문 1899.9.19]
- 한길: 새가 못 따라오면, 사람은 더 못 따라오겠군.
- 다카다: [일본어] 이 기관차는 바다 건너 미국에서 왔소. 나는 선로를 놓았을 뿐이오. (3) [rail-03]
- 이시중: 하룻길이 이제 두 시간도 안 걸리오. 좋은 세상 아니오? (3) [rail-04]
- 이시중: 그런데 형씨는 무슨 일로 인천에 가시오?
  - 선택 ① "마포 소금 장수요. 값 좀 보러 가오." → `suspicion:'low'`
  - 선택 ② "그건 알 것 없소." → `suspicion:'high'`
- 경비: 구경꾼은 비키시오. 회사 화차요. (4)
- 엄순례: 기차 생기고 묵어 가는 손님이 반으로 줄었어. 이 주막도 저 쇳소리에 깔리게 생겼다. (7)

보상: 경험치 cheose 60.

---

### M12 `ch1_08_robbery` 솔고개 열차

- 시작: 의뢰인 오장헌(솔고개 주막 앞). 날짜 09-22 13:00 흐림. 동행: 오장헌, 마천복, 유선녀, 윤팔, 바우(모두 `essential`).
- 생성: 벌목 더미 `logs_pile` (1590,1832)에 통나무 2. 산채 건널목 (1527,1802) 옆에 조랑말 3(바우가 매어 둠). 대상 열차 = **상행 2(13:00 인천 발)**, 이날 화차에 철궤, 경비 4(`rail_guard`, 조선인 2·일본인 2, 양총 2·몽둥이 2). 다카다는 1·2등 합조 객차.
- `retry:'nextDay'`: 열차가 서지 않고 굽이를 지나가면 다음 날 13:00 같은 단계부터.
- checkpoint: 1, 4, 6

| # | 목표 문구 | 판정 | 메모 |
|---|---|---|---|
| 1 | 솔고개 굽이로 가라 | `reach{1560,1808,15}` | 96 m |
| 2 | 통나무를 선로에 놓아라 | `flag{logs_placed}` | 더미에서 E 2초로 통나무를 들고(무거운 짐) `log_target` (1575,1805) 4 m 안에서 E. 하나는 플레이어, 하나는 바우가 놓는다. 둘 다 놓이면 플래그 |
| 3 | 숨어서 열차를 기다려라 | `custom{상행 2 열차가 log_target 60 m 안에서 속도 < 0.5}` | E "숨어서 기다리기"로 14:04까지 시간을 넘길 수 있다. 열차는 서행 구간(8 m/s)에서 시야 60 m에 통나무를 보고 비상제동 → 약 40 m 앞(d ≈ 889)에 선다. 기적 2회 |
| 4 | 회사 경비를 제압하라 | `kill{tag:'rail_guard', n:4}` | 경비는 기절도 셈. 죽이면 G.3 무장 적대자 규칙(의 −3, 현상 300) |
| 5 | 맨 끝 화차에서 철궤를 꺼내라 | `collect{q_strongbox, 1}` | 화차 문 E 3초(바우가 자물쇠를 부숨). 이 단계 동안 선택 사건(아래) |
| 6 | 철궤를 싣고 추격을 떨쳐 산채로 가라 | `custom{플레이어가 (1500,2140) r40 안 && wanted.level === 0}` | 단계 5 끝에 범죄 robbery(열차, 현상 400, **3단계**). 경인가도 3단계 = 현상금 사냥꾼 6 + 스크립트로 이시중과 기마 순검 3(`suspicion:'high'`면 4명, 20실초 빨리) + 구만석 [각색]. 철궤는 무거운 짐(말 ×0.8) |

**단계 5 선택 사건**

| 사건 | 발생 | 선택 → 결과 |
|---|---|---|
| ① 윤팔의 1등칸 털이 | 플레이어가 객차 승강대에 들어서면 | 턴다: 의 −4, 돈 +200, 회중시계 2 / 말린다: 의 +3 |
| ② 다카다 | 화차 앞에 다카다가 나온다 | 살려 보낸다: 의 +5, `takada_spared` / 쏜다: 민간인 살해(G.3: 의 −10, 현상 300), 다음 날 신문 기사 |
| ③ 3등칸 승객 | 플레이어가 승객을 해치면 | 일반 범죄 규칙(G.3)만 |

대사

- 오장헌: 사람은 다치게 하지 마라. 우리가 원하는 건 회사의 궤짝이니라. (1)
- 바우: (통나무를 어깨에 메며) 하나는 내가 놓소. (2)
- 윤팔: 1등칸 양반님네 회중시계 하나쯤은 괜찮잖소? (5-①)
- 유선녀: 3등칸은 건드리지 마. 저기 탄 건 우리 같은 사람들이오. (5)
- 다카다: [일본어] 쏘지 마시오. 나는 기술자요… 그 땅이 누구 땅이었는지는 묻지 않았소. (5-②)
- 이시중: 철궤를 내려놓으시오! 이번엔 놓치지 않소! (6)
- (아웃트로, 산채) 마천복: 이 궤짝… 현가 놈 도장이 찍혔구먼.
- 오장헌: 범을 잡으려면 범굴에 들어가야 하느니라.
- 한길: (말없이 궤 속의 장부와 판형을 본다)
- (카드) 엿새 뒤. 1899년 9월 28일, 전차가 다시 달렸다.

**아웃트로 신문 기사(조건별, 다음 신문팔이 대사)**: 경비가 죽었으면 "경인철도 화차 습격, 조선인 경비 ○○○ 사망" / 다카다가 죽었으면 "일본인 기사 피살" / 아무도 안 죽었으면 "경인철도 화차 습격, 사상자 없어".

보상: 돈 1,000(한길 몫), 양총 1(이미 있으면 양총 탄 20), 경험치 sagyeok 100 + gima 100, 아이템 `q_ledger`·`q_plate`, 플래그 `ch1_done`, `advanceTo:'1899-09-28 08:00'`(→ `tram_resumed`, S1 해금).

---

### H.2 이야기 선택 의 변동 (이 표에 없는 것은 G.3·G.4 일반 규칙)

| 미션 | 선택 | 의 | 기타 |
|---|---|---|---|
| M01 | 사공에게 막걸리 값 1전 | +1 | 돈 −1 |
| M04 | 프롤로그 순검 사망 0 | +3 | `no_police_killed` |
| M05 | 고기를 산채 솥에 넘김 | +1 | 날고기 −2 |
| M06 | 군중 편(불을 놓음) | 0 | `arson` 수배 2, `rickshaw_friend`(한성 인력거 삯 ×0.5) |
| M06 | 사람 편(운전수·차장 지킴) | +5 | 송애순 소개 |
| M06 | 돈 편(요금 주머니) | −8 | 돈 +30, theft 수배 1 |
| M08 | 유선녀 호위 성공 | +3 | |
| M12 | 윤팔 털이: 턴다 / 말린다 | −4 / +3 | 턴다: 돈 +200, 회중시계 2 |
| M12 | 다카다를 살려 보냄 | +5 | `takada_spared` |

### H.3 낯선 이 퀘스트 (P 3개)

**S1 `s1_brantley_1` 캘리포니아에서 온 사내 (1부)** [tram-07. 상투를 쏜 일화는 전승이라 P에 넣지 않고 2부(F)에서 증언으로만]

| 항목 | 값 |
|---|---|
| 해금 | `tram_resumed`(9/28) |
| 의뢰인·위치 | 새뮤얼 브랜틀리 `brantley`, 전차 차고 앞 (3215,752) |
| 단계 | 1 `talk{brantley}` "전차 차고의 미국인에게 말을 걸어라" → 2 `kill{tag:'brawl_brantley', n:1}` "맨주먹으로 붙어라"(**무기를 쓰면 실패**, 맨손만. 브랜틀리 체력 120, 기절하면 완료) → 3 `talk{brantley}` "브랜틀리와 술 한잔하라" |
| 대사 | 브랜틀리: [영어] 여기 가을은 원래 이리 짧소? / 브랜틀리: [영어] 운전수 자리는 내 자리요. 주먹으로 따지겠다면 받아 주지. / (패배 후) 브랜틀리: 고맙소, 친구. …[영어] 집에선 역마차를 몰았소. 여기선 쇠수레를 몰고. 둘 다 내 것은 아니었지. |
| 보상 | 육혈포 탄 12, 경험치 muye 40, 의 +2, 플래그 `brantley_friend`(정동 서양 상회 육혈포 ×0.7) |

**S3 `s3_muak_tiger` 무악재 범** [hunt-02, geo-08, sec-05]

| 항목 | 값 |
|---|---|
| 해금 | `ch1_01_hunt` 완료 |
| 의뢰인·위치 | 나무꾼 과부 홍씨 `widow_hong`, 서대문 밖 홍씨 집 (2185,815) |
| 단계 | 1 `talk{widow_hong}` → 2 `reach{2236,600,20}` "무악재로 가라" → 3 `collect{q_torn_jige, 1}` "찢긴 지게를 찾아라"(2256,588) → 4 `kill{tag:'tiger_muak', n:1}` "사람 해친 범을 잡아라"(단계 4 시작 때 범 1마리 (2295,600), 시각과 무관) → 5 `skin{species:'tiger', n:1}` → 6 `talk{gyeongmu_clerk}` "경무청 서리에게 현상을 받아라"(수배 중이거나 현상금이 남아 있으면 먼저 납부하라는 안내) |
| 대사 | 홍씨: 우리 그이가 땔나무 지고 무악재 넘다 안 돌아왔소. 지게만… / 무악재 주막 주인: 해 지면 무악재 넘지 마시오. 범이 사람 눈을 먼저 봐. / 서리: 사람 해친 범이라. 방문(榜文)대로 현상을 내주겠소. |
| 보상 | 돈 750(사람 해친 중호 현상 [각색, sec-05 착호 포상 비율]), 범 가죽은 플레이어 것, 의 +5, 경험치 saengjon 80 |

**S5 `s5_literacy` 글눈 (3단계)** [life-05]

| 항목 | 값 |
|---|---|
| 해금 | `deokgu_joined` |
| 의뢰인·위치 | 덕구, 산채 (1506,2160) |
| 단계 | 1 `collect{q_newspaper, 3}` "신문 세 장을 구해 오라"(신문팔이 2전) → 2 `talk{deokgu}` "덕구에게 글을 배워라"(선택지 퀴즈 3문항: 자모 맞히기, 틀려도 다시) → 3 `custom{20~4시에 산채 모닥불 (1500,2152) 3 m 안에서 E}` "밤에 모닥불 가에서 이름을 써 보아라" |
| 대사 | 덕구: 아저씨, 글 몰라도 신문은 사요. 제가 읽어 드릴게요. / 덕구: 기역, 니은… 아저씨 이름은 한, 길. 두 자예요. / 한길: (땅에 막대로 '한길'을 쓴다) …삐뚤군. / 덕구: 그래도 아저씨 손으로 쓴 거잖아요! |
| 보상 | 플래그 `can_write_name`(일지 요약이 그림에서 글로 바뀜), 의 +2, 경험치 cheose 40 |

### H.4 길거리 사건 (P 5개)

사건마다 같은 장소 쿨다운 게임 하루, 전체에서 동시에 1개. 미션 중에는 일어나지 않는다.

| id | 사건 | 발생 조건 | 내용 | 선택 → 결과 | 근거 |
|---|---|---|---|---|---|
| ev_pickpocket | 소매치기 | 장터·나루·역 places 반경 안, 8~18시, 10분(게임)마다 10% | 아이가 행인의 주머니를 털고 5.0 m/s로 달아남 | 잡아(맨손 넘어뜨림) 돌려준다: 의 +2 / 가로챈다: 돈 +20, 의 −2(범죄 아님) / 무시 | [창작] |
| ev_torch_band | 횃불 행렬 | 21~4시, `danger_road_w`·`danger_road_e` 또는 경인가도 지역 길 위, 수배 0, 그 밤 30% | 120 m 앞에 횃불 10여 개(화적 4 + 횃불잡이) | 숨는다(60실초 뒤 지나감) / 싸운다(rival 4) / 통행세 10전 | [out-04] |
| ev_checkpoint | 순검 검문 | 성문·나루·역 30 m 안에서 무기를 꺼냈거나 무거운 짐을 들었을 때, 15% | 순검: "무기 거두시오. 어디 가는 길이오?" | 무기를 넣는다 → 통과 / 뇌물 5전(의 −1) / 달아난다(trespass, 수배 1) | [sec-02] |
| ev_pack_bulls | 짐소 행렬 | 마포길·남대문로·용산길, 낮, 게임 1시간마다 15% | 땔나무·분뇨를 실은 짐소 6마리가 1.2 m/s로 길을 막음 | 기다린다(30실초) / 말로 밀고 간다: 의 −1, 소몰이꾼과 맨손 시비 | [river-03, land-08] |
| ev_rail_sleeper | 선로에서 자는 사람 | 20~4시, 6~9월, 전차 운행 중, 전차 선로 위 | 더위에 선로에서 잠든 사내 | 깨워서 옮긴다: 의 +1 / 무시: 전차가 종을 치고 급정거(다치지 않음) | [tram-11] |

**F로 미룬 사건**: 떨어진 신발(tram-11), 조랑말 싸움(land-06), 보부상 행렬(pol-07), 선로변 화재(rail-09), 상여 행렬(geo-01).


---

## I. NPC

### I.1 이름 있는 인물 (`js/data/npcs.js`)

모두 허구 인물이다. `ess` = `essential`. 위치가 시기에 따라 바뀌면 화살표로 적었다(조건이 되면 순간 이동, 화면 밖일 때).

| id | 이름 | role / faction | 위치 | brain | ess | 상점 | 등장 | 평소 대사 |
|---|---|---|---|---|---|---|---|---|
| `oh_janghun` | 오장헌(吳章憲), 47 | gang / gang | M02 칠패 보교 → 산채 대청 앞 (1500,2122). M09·M12 시작 전엔 솔고개 주막 앞 (1548,1722) | idle | ○ | – | M02 | "의(義)는 손해 보는 쪽에 서는 것이니라." / "율도국이 어디 섬에만 있겠느냐." |
| `ma_cheonbok` | 마천복(馬千福), 49 | gang / gang | 옥사 창살 문 (2663,712) → 산채 (1488,2140) | merchant | ○ | `fence_camp` (`prologue_done` 뒤) | M03 | "셈이 맞아야 길이 열리는 법이여." / "장물은 사흘 묵히면 값이 반이구먼." |
| `yu_seonnyeo` | 유선녀(柳善女), 32 | gang / gang | 마포 여각 뒷방 (2300,1378), 숨김 → 산채 (1515,2140) | idle | ○ | – | M08 | "말로 배부르면 다 살았겄소." / "활줄은 비 오기 전에 갈아야 허요." |
| `choi_mandeuk` | 최만득(崔萬得), 66 | hunter / gang | 산채 (1512,2150) | idle | ○ | – | M05 | "철길 공사 소리 나믄 짐승이 십 리를 물러나." / "범은 사람 눈을 먼저 봐." |
| `deokgu` | 덕구(德九), 13 | villager(아이) / gang | 용산나루 (2770,1440) → 종로 신문팔이 (2950,800, wander) → `deokgu_joined` 뒤 산채 (1506,2160) | wander | ○ | 신문 2전 | M01 | "아저씨, 신문 한 장 사요! 이 전짜리!" / "전기거는 손 들면 서요!" |
| `eom_sunrye` | 엄순례(嚴順禮), 54 | woman / civilian | 솔고개 주막 (1560,1720) | merchant | ○ | `jumak_solgogae` | 새 게임(이야기상 첫 만남은 M07) | "밥값은 외상이어도 목숨값은 외상이 없다." / (`rail_open` 뒤) "기차 생기고 묵는 손이 반이여." |
| `chilbok` | 칠복, 9 | villager(아이) / civilian | 솔고개 주막 (1572,1720) | wander(주막 반경 8 m) | – | – | 새 게임 | "국밥 나왔어유!" |
| `lee_sijung` | 이시중(李時中), 29, 총순 | chongsun / police | 육조거리 순찰 (2715,600)↔(2715,780) | patrol | ○ | – | M04 | "법대로 하겠소." / "제복은 사람을 바꾸지 않소. 사람이 제복을 입을 뿐이오." |
| `hyeon_deokman` | 현덕만(玄德萬), 44, 거간 | merchant / civilian | 대불호텔 문 앞 (420,1634), 숨김(M09에 나타남) | idle | ○ | – | M09 | "세상이 바뀌는데 올라타셔야지요." / "셈은 깔끔하게 하시지요." |
| `gu_manseok` | 구만석(具萬石), 47, 현상금 사냥꾼 | bounty_hunter / bounty | 숨김(M08·M12 스크립트) | – | ○ | – | M08 | "현상금 붙은 머리만 잡소." |
| `bang_chilseong` | 방칠성(方七星) '불여우', 39 | bandit_boss / rival | 불여우패 소굴 (2390,2190), 숨김 | – | ○ | – | M07 | "돌쇠야, 이름 바꾼다고 근본이 바뀌더냐?" |
| `brantley` | 새뮤얼 브랜틀리, 36, 전차 운전수 | foreigner / foreign | 전차 차고 앞 (3215,752), `tram_resumed` 뒤 | idle | – | – | S1 | "[영어] 여기 가을은 원래 이리 짧소?" / "고맙소, 친구." |
| `takada` | 다카다 겐조, 41, 경인철도 기술자 | foreigner / foreign | M11·M12 열차 → `takada_spared`면 노량진 정거장 (2385,1712) | idle | ○(M12 선택 전) | – | M11 | "[일본어] 선로는 곧아야 하오. 사람 일은 그렇지 않지만." |
| `song_aesun` | 송애순(宋愛順), 20, 제중원 간호 보조 [각색] | woman / civilian | 제중원 앞 (3000,889). 바깥에선 장옷, 제중원 안에서만 벗는다 [life-03] | idle | – | – | 새 게임 | "다친 데 있으면 숨기지 마세요." |
| `yunpal` | 윤팔(尹八), 24 | gang / gang | 산채 (1525,2155) | wander | ○ | – | M04 | "총은 쏘라고 있는 거요." |
| `bau` | 바우, 30 | gang / gang | 산채 (1530,2135) | wander | ○ | – | M03 | "…" / "무거운 건 내가 들지." |
| `no_seobang` | 노 서방, 52 | villager / gang | 산채 솥 (1484,2150) | idle | – | – | M04 | "솥이 비면 산채도 빈 거여." |

### I.2 기능·미션 인물

| id | 이름·역할 | 위치 | brain | 비고 |
|---|---|---|---|---|
| `sagong_noryang` | 노량진 사공 | (2730,1574) | idle | ferry_noryang 남쪽 관선. "관선이라 삯은 없소." |
| `mabang_ju` | 동대문 마방 주인 | (3160,800) | merchant | `stable_dongdaemun`. "수놈끼리 붙이면 물어뜯소." |
| `sosa_gaekju` | 소사 객주 사람 | (1265,1722) | idle | M07 |
| `gama_bearers` | 소사 가마꾼 우두머리(+1명) | `gama_stand_sosa` (1300,1723) | idle | 보교 고용 창구. "나리, 주막마다 목을 축여야 다리가 갑니다요." |
| `bupyeong_saryeong` | 부평 관아 사령 [각색: 지방 순검 대신 관아 하인] | (945,1678) | guard | M09 검문 |
| `gyeongmu_clerk` | 경무청 서리 | (2706,722) | idle | 현상 납부·자수·S3 현상 지급 |
| `noryang_clerk` | 노량진 진 관아 이속 | (2760,1652) | idle | 납부·자수 |
| `bupyeong_clerk` | 부평 관아 이속 | (930,1700) | idle | 납부·자수 |
| `gamniseo_clerk` | 인천감리서 서리 | (670,1575) | idle | 납부·자수 |
| `fence_mapo` | 마포 장물아비 | (2300,1378), 20~04시 | merchant | `fence_mapo` |
| `newsboy_jongno` / `newsboy_mapo` / `newsboy_jemulpo` | 신문팔이 아이 | (2900,797) / (2330,1390) / (620,1620) | wander | 신문 2전. `news_constitution` 뒤 호외 대사 |
| `widow_hong` | 나무꾼 과부 홍씨 | (2185,815) | idle | S3 |
| `motorman_jp` / `conductor_kr` | 전차 운전수(일본인) / 차장(조선인) | M06 생성 | – | M06 |
| `sampan_sagong` | 삼판 사공 | M10 생성 | driver | M10 |
| `p2_pickpocket` | 소매치기 아이 | M02 생성 | flee | 쓰러뜨리면 쌈지를 떨어뜨림 |
| 상점 주인 | 상점 건물마다 1명 | 문 앞 2 m | merchant | D.5 |
| 역무원 | 역마다 일본인 역무원 1(매표) | 역사 문 앞 | idle | `rail_open` 뒤 |
| 차장 | 전차·열차마다 | 차 안 | – | 요금·검표 |

### I.3 인구 배치 (spawner)

| 대상 | 규칙 |
|---|---|
| 행인 | 정착지 town: 집 2채당 1명(플레이어 120 m 안 최대 40), village: 3채당 1명(최대 15), 큰길 위 100 m마다 1명. 밤 ×0.3, 주막 주변 ×1.5 |
| 순검 | 경무서 5곳에 각 2명(경무서 반경 150 m 순찰), 육조거리 2명, 성문마다 밤 2명. 제모 밑 상투 60%·단발 40% |
| 시위대 | 경운궁 문 앞 4, 경복궁 2(순찰), 창덕궁·경희궁 각 2. `restricted` 구역 안에 들어가면 경고 후 trespass |
| 경강 | 노량진나루 관병 2, 양화진 진영 관병 3 |
| 제물포 | 조계 순경 4(각국·일본 조계 순찰), 감리서 순검 2, 해관 서양인 감시원 1 |
| 회사 경비 | `rail_open` 뒤 노량진·인천 정거장 각 4, 오류동·소사·축현 각 2. 동대문 발전소 2 |
| 공사 인부 | `rail_construction` 동안 `railcamp`와 노량진~소사 선로 위 6명 |
| 외국인 | 정동 공사관 거리 6, 제물포 조계 10. 문화 표지 하나만(B.3) |
| 보부상 | 경인 옛길 낮에 2인 1조가 오간다(guild, 시비 걸지 않으면 중립) |
| 짐소·지게꾼 | 마포·용산·남대문로에 짐소 몰이꾼, 제물포 조선인 마을에 지게꾼 [port-03, land-08] |

---

## J. 조작

action 이름과 키는 `js/engine/input.js` 그대로(`event.code` 기준이라 한글 입력기가 켜져 있어도 동작). **`crouch`에서 ControlLeft를 뺀다**(Ctrl+W 사고 방지).

| 키 (action) | 걸어서 | 말 | 땅 탈것(인력거·소달구지) | 배(나룻배·돛배) | 승객(보교·인력거·전차·기차·증기선) |
|---|---|---|---|---|---|
| WASD·방향키 | 화면 기준 8방향 이동 | 누른 방향으로 고개를 돌리며 구보, 뒤쪽은 감속·뒷걸음 | 누른 방향으로 조향하며 전진, 뒤쪽은 제동 뒤 후진 | 뱃머리 돌리기(나룻배는 노, 돛배는 키) | 보교: 가마꾼에게 방향 지시 |
| Shift (sprint) | 질주(누름) | 습보(누름) | 힘껏 / 회초리 | 나룻배 힘껏, 돛배 탭 = 돛 올림 | 보교·인력거 재촉(삯 추가) |
| Space (brake) | 구르기 | 제동, 멈춘 채면 앞발 들기, 구보 이상이면 급정지 | 급제동 | 노 멈춤, 돛배 탭 = 돛 내림, 1초 = 돛 0 + 닻 | **1초 길게: 기차 다음 정차지까지 / 증기선 ×8** |
| F (enter) | 가장 가까운 좌석: 타기·빼앗기·동승 | 내리기(3.2 m/s 초과면 뛰어내리기), 옆 열차·전차로 갈아타기 | 내리기 | 내리기(부두·얕은 물) / 물로 뛰어들기 | 내리기 |
| E (interact) | 대화, 줍기, 뒤지기(1.2초), 가죽 벗기기(3초), 채집, 전차 손 들기, 요금, 말 쓰다듬기·말죽, 기다리기 | 말 위 대화, 대상 없으면 "비키시오" | 손님 태우기 | 사공에게 "출발하세" | 요금 내기, "내리겠소" |
| C (crouch) | 웅크리기 토글 | 뒷발차기(유대 2) | – | – | – |
| CapsLock | 걷기 고정 | 평보 고정 | 최고속도 50% | – | – |
| H (whistle) | 말 부르기 | 같음 | 같음 | 같음 | 같음 |
| Q (hoan) | 호안 | 가능 | 승객일 때만 | 노 젓는 중 불가 | 가능 |
| R (reload) | 장전 | 화승총은 정지·평보에서만 | 승객만 | 노 젓는 중 불가 | 가능 |
| Tab (weaponWheel) | 무기 바퀴(누름) | 같음 | 같음 | 같음 | 같음 |
| 1 / 2 | 이전 / 다음 무기 | 같음 | 같음 | 같음 | 같음 |
| X (holster) | 무기 넣기. **1초 길게: 무거운 짐 내려놓기** | 같음 | – | – | – |
| I / K / M / J | 소지품·제작 / 스킬 / 지도(표식) / 일지 | 같음 | 같음 | 같음 | 같음 |
| Esc·P / Enter / + − 휠 | 일시정지 / 확인 / 줌(0.35~2.2) | | | | |
| 마우스 왼쪽 | 사격·공격(누르고 0.6초 = 강한 공격, 활은 당김) | 사격 | 승객만 | C.3 | 사격 |
| 마우스 오른쪽 | 조준(누름), 근접 무기면 막기 | 조준(조향은 방향키) | 승객만 | 조준하면 노가 멈춤 | 조준 |

**터치**(`ui/touch.js`): 왼쪽 가상 조이스틱(반만 밀면 걷기·속보), 오른쪽 버튼 F(타기)·E(상호작용)·Shift(질주·습보)·Space(제동·구르기)·H(휘파람)·조준/발사. 길게 누르기 판정은 0.6초.

---

## K. 도감·화면 고정 문구 (각색 고지)

| 항목 | 문구 |
|---|---|
| 돈 | G.6 문구 |
| 활빈패 | "주인공 무리는 스스로를 '경기 활빈패'라 부른다. 실제 활빈당은 1900년 2월 충남 내포에서 봉기해 1904년까지 활동한 무장 민중집단이다. 위조전과 열차 강도는 이 게임의 창작이다." [out-01, out-03] |
| 축척 | "지도는 실제 거리를 압축했다. 한성은 약 1/4, 경인선은 약 1/16, 한강 뱃길은 약 1/21이다." |
| 경인선 역 | "1899년 시각표의 역은 인천·축현·부평·소사·노량진이었다. 게임은 부평역을 줄이고 수시 정차역이던 오류동을 남겼다." [rail-02] |
| 열차 강도 | "경인선에서 열차 강도가 실제로 일어났다는 기록은 없다. 서부극에 바치는 창작이다." |
| 전차 개통일 | "서울 전차는 1899년 5월에 개통했다. 세부 날짜는 5월 4일·17일·20일·26일 설이 갈린다. 게임은 초파일(5월 17일) 공개 운행을 골랐다." [tram-01] |
| 전차 사고 | "1899년 5월 26일 무렵 종로에서 아이가 전차에 치여 숨지고, 성난 군중이 전차를 불태웠다. 게임은 아이를 그리지 않는다." [tram-08, life-11] |
| 경무청 추격 | "1896년 지방 순검이 폐지되어 경인가도에는 순검이 없었다. 총순이 한성 밖까지 쫓아오는 장면은 각색이다." [sec-02] |
| 대한국국제 호외 | "대한국국제는 1899년 8월 17일 반포되었다. 이튿날 마포 거리의 호외 장면은 각색이다." [pol-03] |
| 양총 기종 | "1899년 대한제국 군의 소총 기종은 자료가 엇갈린다. 게임의 '양총'은 단발 후장식 군용 소총 하나로 묶었다." [wpn-01 확인 불가] |

---

## 부록: 이 문서가 정한 주요 확정값 한눈에

| 항목 | 값 |
|---|---|
| 월드 | 3600 × 2400 m, spawn (2707,1600) |
| 산채 | 수리산 북사면 (1500,2140). 화적 소굴 = 관악산 서쪽 골짜기 (2390,2190). 수적 굴 = 계양산 북쪽 (1010,880) |
| 솔고개 | 마을 (1560,1728), 주막 (1560,1712), 굽이 (1560,1808, 경인선 d 864.1, 서행 8 m/s, 시야 60 m) |
| 경인선 | 2,115 m, 5역, 1시간 40분(200실초), 상행 07:00·13:00 / 하행 09:00·15:00, 1등 150·2등 80·3등 40전 |
| 전차 | 1,346 m, 단선, 160실초 배차, 하등 2~6전·상등 4~14전, 5/26~9/27 운휴 |
| 증기선 | 4,312 m, 물에 대해 4.6 m/s, 뱃삯 75전(서양인 150) |
| 미션 날짜 | 5/17(M01~M04), 5/21, 5/26, 6/12, 6/15, 8/17, 8/18, 9/19, 9/22 → 9/28 |
| 탈것 | 조랑말 2종, 나룻배, 황포돛배, 증기선(승객), 보교, 인력거, 소달구지, 전차(승객), 기차(승객) |
| 경제 | 시작 30전, 본편 보상 합 1,550전 + 미션 중 선택 수입, 국밥 5전, 양총 900전 |
| 아이템·제작·상점 | 35종, 8개, 6종 + 매표소 |
| 스킬 | 15개(5계통 × 3), 비용 합 18점 |
| 동물 | 7종, 범은 하루 1마리 밤에만 |
| 수배 | 4단계, 현상금 하나, 수배 지역 4곳, 납부처 4곳 |
