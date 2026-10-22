// 확정 지도 데이터 (prototype_spec.md A.3 그대로 + A.4 노선·물길 부가 데이터). 좌표 m, x=동, y=남.
// 엔진(terrain/structures/render/nav/world)은 ARCHITECTURE §9 형식과 §10 추가 필드만 안다.

export const MAP = {
  size: { w: 3600, h: 2400 }, cell: 2, spawn: { x: 2707, y: 1600 },
  // (A.1) 가장자리 60 m 띠는 엔진이 한지로 번지게 하고 막는다. 바위 띠: 북한산 y < 80, 관악산 남쪽 y > 2350
  edgeRock: [ { side:'n', d:80, x0:1950, x1:3150 }, { side:'s', d:50, x0:2300, x1:3000 } ],
  // (A.4) 물살 m/s: 한강 깊은 물·얕은 물, 지류. 장마(F)·나룻배 중지 문턱은 기록만
  flow: { main:'han', deep:0.5, shallow:0.2, tributary:0.3, monsoon:{ deep:1.2, shallow:0.4, tributary:0.6 }, ferryStop:1.1 },
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
      // (A.4) d 는 노량진 쪽 끝에서. d 증가 = 하행(노량진→제물포)
      down:'노량진→제물포', gauge:1.435, sleeper:{ len:2.4, w:0.25, gap:0.7 },
      platform:{ off0:2.8, off1:6.3, len:50 },   // 정차점 기준 선로 북쪽 띠 (엔진이 자동 생성)
      slow:[ { d0:804.1, d1:924.1, max:8.0, sightLimit:60 } ],   // 솔고개 굽이 서행
      crossings:[ { id:'camp_crossing', d:897.7, x:1527, y:1802 }, { id:'jm4', d:1933.1, x:500, y:1678.4 }, { id:'jm3', d:1993.3, x:440, y:1673.6 } ],
      marks:[ { id:'br_anyang_rail', d:256, x:2165, y:1757 }, { id:'log_target', d:848.8, x:1575, y:1805 }, { id:'cut_solgogae', d:864.1, x:1560, y:1808 }, { id:'freight_jemulpo', d:2060.8, x:370, y:1680, off:17.7 } ],
      points:[[2420,1734],[2300,1745],[2165,1757],[2000,1772],[1850,1785],[1650,1790],[1560,1808],[1450,1788],[1280,1780],[1100,1760],[950,1738],[800,1712],[650,1690],[520,1680],[420,1672],[320,1652]],
      stops:[
        { id:'noryangjin', name:'노량진', x:2400, y:1735.8, d:20.1 },
        { id:'oryu', name:'오류동', x:1850, y:1785, d:572.3, request:true },
        { id:'sosa', name:'소사', x:1280, y:1780, d:1146.1 },
        { id:'chukhyeon', name:'축현', x:650, y:1690, d:1782.7 },
        { id:'jemulpo', name:'인천(제물포)', x:330, y:1654, d:2105.2 },
      ] },
    { id:'tram', name:'전차 (경교–홍릉)', kind:'rail',   // 길이 1345.5 m
      // (A.4) 단선. 정류 5곳은 요금 구간 표석이고 어디서든 손 든 사람 앞에 선다
      single:true, flagStop:true, catenary:{ poleGap:30, volt:600 },
      sidings:[0, 216.9, 612.0, 832.0, 978.9, 1187.4, 1333.3],   // 교행 측선
      fareBounds:[612.0, 978.9, 1187.4],
      marks:[ { id:'heunghwamun_front', d:216.9 }, { id:'jongno2ga', d:727.0, x:2975, y:791 }, { id:'baeogae', d:832.0 }, { id:'heunginjimun_arch', d:1009.9 }, { id:'ongseong_exit', d:1043.9 } ],
      points:[[2250,762],[2290,762],[2380,780],[2480,785],[2600,785],[2720,787],[2860,790],[3000,791],[3080,792],[3200,775],[3255,761],[3264,757],[3269,746],[3274,735],[3292,729],[3330,745],[3400,700],[3470,650],[3530,610]],
      stops:[
        { id:'gyeonggyo', name:'경교', x:2250, y:762, d:0.0 },
        { id:'jongno', name:'종로', x:2860, y:790, d:612.0 },
        { id:'dongdaemun', name:'동대문', x:3224.9, y:768.7, d:978.9 },
        { id:'bojewon', name:'보제원', x:3400, y:700, d:1187.4 },
        { id:'cheongnyang', name:'청량리(홍릉)', x:3519.8, y:616.8, d:1333.3 },
      ] },
    { id:'steamer', name:'한강 증기선', kind:'water',   // 길이 4311.8 m
      // (A.4) d 는 용산나루에서. 엔진은 항로 둘레 6 m 를 깊은 물로 남긴다
      marks:[ { id:'yanghwa_front', d:741.5, noStop:true }, { id:'aground_1', d:1189.7, x:1673, y:1105 }, { id:'sea_start', d:2604 } ],
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
    { id:'coal_jp', kind:'warehouse', name:'일본 석탄고', x:110, y:1490, w:24, h:12, angle:0, style:'western' },   // (추가) style: 지붕 양식
    { id:'coal_ru', kind:'warehouse', name:'러시아 석탄고', x:90, y:1545, w:26, h:12, angle:0, style:'western' },
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
  // (A.6) 지도 상태 변화: world.setMapState(flag, on) 이 쓴다
  mapStates: {
    construction: { line:'train', d0:20.1, d1:1146.1, frame:'st_noryangjin' },   // rail_construction 이고 rail_trial·rail_open 전: 침목만, 역사 골조
    camp: 'railcamp',                                                         // rail_open 전까지 공사장
    wreck: { place:'lm_fire_1899', line:'tram', w:9.0, h:2.1 },              // tram_suspended 이고 tram_resumed 전: 불탄 전차
  },
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
