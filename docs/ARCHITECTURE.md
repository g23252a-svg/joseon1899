# 조선 1899 — 코드 구조와 모듈 계약

브라우저 2D 탑다운 게임. HTML5 Canvas 2D + 순수 ES 모듈. 외부 라이브러리·이미지·사운드 파일 없음.
게임 내용(지도 좌표, 아이템, 스킬, 미션 등)의 확정값은 `docs/prototype_spec.md`, 전체 기획은 `docs/GDD.md`.
**이 문서는 모듈 사이의 약속이다. 여기 적힌 이름·인자·반환값을 바꾸지 말 것.** 더 필요한 것은 추가만 한다.

## 0. 실행·검증

- 브라우저: `index.html` (아티팩트 게시 규칙상 `<!doctype>/<html>/<head>/<body>` 태그 없이 `<title>`·`<style>`·본문만 있음). 개발 서버가 뼈대를 씌워 준다.
- 헤드리스 스모크 테스트: `node tools/smoke.mjs [--ticks=3000] [--only=systems/inventory.js,ui/index.js] [--verbose]`
  - 가짜 DOM 위에서 월드 생성 → 모듈 install → 3000틱 무작위 플레이 → 렌더 호출. `console.error` 가 하나라도 나오면 실패.
  - 자기 모듈을 고친 뒤 **반드시** 돌린다. 다른 에이전트가 작업 중인 모듈 때문에 깨지면 `--only=` 로 자기 것만 확인.
- 문법 확인: `node --check js/…/file.js`
- 금지: `alert/confirm/prompt`(아티팩트에서 동작 안 함), 외부 fetch, `eval`, 전역 CSS 파일(스타일은 JS 로 `<style>` 주입), 이미지 파일.
- `localStorage` 접근은 항상 try/catch.
- 다른 시스템 호출은 항상 옵셔널 체이닝: `game.sys.audio?.play('gun')`. 상대 모듈이 아직 없어도 게임이 돌아야 한다.

## 1. 폴더와 담당

```
index.html                 페이지(타이틀·로딩 DOM), 폰트 링크          [코어]
js/main.js                 부팅 순서, MODULES 목록                       [코어]
js/engine/                 game, entity, physics, input, camera, util, events [코어 — 수정 금지, 버그는 보고]
js/engine/palette.js       색·글꼴 상수                                  [코어]
js/engine/audio.js         WebAudio 합성 효과음·배경음                     [분위기]
js/entities/human.js       사람 공통(이동·그리기·좌석)                     [코어 — 사람 담당이 그리기 개선 가능]
js/entities/player.js      플레이어 입력·상호작용                          [코어]
js/entities/npc.js         NPC 두뇌(brain)들, game.sys.npcs              [사람]
js/entities/animals.js     동물 클래스·AI·그리기, game.sys.animals        [사람]
js/systems/spawner.js      인구 배치·주변 생성/정리                         [사람]
js/vehicles/vehicle.js     탈것 기본 클래스                                [코어]
js/vehicles/*.js           말·배·돛배·증기선·가마·인력거·자전거·소달구지·전차·기차 [탈것]
js/vehicles/index.js       install, game.sys.vehicles, 노선 운행             [탈것]
js/world/                  지도 데이터, 지형 격자, 렌더링, 건물, 길찾기      [월드]
js/systems/items.js        아이템 정의 데이터 + itemDef()                    [파밍]
js/systems/inventory.js    소지품·돈, game.sys.inventory                    [파밍]
js/systems/loot.js         시체 뒤지기, 상자, 채집물, 가죽 벗기기             [파밍]
js/systems/crafting.js     제작, game.sys.crafting                          [파밍]
js/systems/shops.js        상점·시세, game.sys.shops                        [파밍]
js/systems/skills.js       스킬 계통·경험치·보정치, game.sys.skills          [전투]
js/systems/stats.js        체력·기력·호안 게이지와 심지(core), game.sys.stats [전투]
js/systems/combat.js       무기·사격·근접·투사체·호안, game.sys.combat        [전투]
js/systems/wanted.js       범죄·목격·수배·현상금·의(義) 평판·사망과 부활       [전투]
js/systems/missions.js     미션 엔진·목표 판정·표식·일지, game.sys.missions   [미션]
js/data/story.js           미션·대사 데이터                                 [미션]
js/data/npcs.js            이름 있는 인물 정의                              [미션]
js/systems/time.js         시각·낮밤·날씨·바람, 조명 오버레이                 [분위기]
js/systems/save.js         저장/불러오기                                    [분위기]
js/ui/                     HUD, 메뉴, 지도, 대화창, 타이틀, 터치 조작         [UI]
tools/                     smoke 테스트                                     [코어]
```

## 2. 좌표·단위·그리기 규칙

- 1 단위 = 1미터. 원점 좌상단, x=동, y=남. 각도는 라디안, 0 = 동쪽, +는 시계방향(화면 y 아래).
- 속도 m/s, 시간 초. 게임 시간 `game.time` 은 호안 감속이 반영된 초.
- 엔티티 `draw(ctx, game)` 가 불릴 때 ctx 는 **월드 좌표**로 변환되어 있다(1 = 1m). 선 굵기도 미터(보통 0.03~0.06).
- 화면 좌표로 그리려면 `game.camera.applyScreen(ctx)` 후 그리고, `save/restore` 로 원복. 월드→화면은 `camera.worldToScreen`.
- 층 `LAYER`: GROUND 0(지형) · DECAL 10(철로·길 표시) · LOW 20(시체·채집물·상자) · ENTITY 30(사람·동물·탈것, y순) · HIGH 40(지붕·수관) · SKY 50(날씨·연기) · OVERLAY 60.
- 화풍: 수묵채색. 한지 바탕 + 먹선 + 옅은 채색. 색은 `js/engine/palette.js` 에서 가져온다. 먹선은 `PAL.ink`.
- 성능 예산: 업데이트 4ms/틱 이하, 렌더 8ms/프레임 이하(데스크톱). 지형은 청크로 미리 그려 캐시. 화면 밖 엔티티는 그리지 않는다(코어가 처리).

## 3. 코어 API (engine/*)

```js
import { game, LAYER } from '../engine/game.js';
game.events.on(name, fn) / game.emit(name, payload) / game.on(name, fn)
game.add(entity) → entity            game.remove(entity)
game.query(x, y, r, pred?) → Entity[]    game.nearest(x, y, r, pred?)    game.queryRect(x0,y0,x1,y1)
game.byId(id)    game.findByTag(tag)
game.registerSystem({ name, order, init(game), update(dt, realDt, game), lateUpdate(dt, realDt, game),
                      updatePaused(realDt, game), onStart(game), serialize(), deserialize(data) })
game.addRenderer(layer, (ctx, game, viewBounds) => {}, order)   // 월드 좌표
game.addScreenRenderer((ctx, game, dt) => {}, order)            // 화면 좌표(CSS px)
game.addInteractionProvider((actor, target|null, game) => [{key:'interact'|'enter', label, priority, run(actor, game)}])
game.pause(reason) / game.resume(reason) / game.paused      // 메뉴·대화 중 정지
game.state  'loading' | 'title' | 'play'          game.beginPlay()  // 타이틀에서 시작
game.timeScale  (호안 등)     game.time    game.realTime    game.flags {}  (이야기 플래그)
game.player  (Player)        game.world   game.camera   game.input   game.prompt {interact, enter}
game.notify(text, kind)  → 'notify' 이벤트      game.sfx(name, opts) → audio.play
game.hour  (0~24)
```

- `Entity` (engine/entity.js): `id, kind, x, y, angle, vx, vy, radius, mass, tags:Set, alive, solid, static, layer, name, hp, maxHp, data{}`.
  메서드 `update(dt, game)`, `draw(ctx, game)`, `getInteractions(actor, game)`, `damage(amount, info, game)`, `die(info, game)`, `onCollide(other, impact, game)`, `onAdded/onRemoved(game)`.
  선택: `interactDistance(actor)`, `interactRange`, `moveMode`, `hidden`, `drawBias`, `ignoreCollision(other)`.
  `static: true` 엔티티(채집물·상자 등)는 update 가 불리지 않고 정적 해시에 들어간다. 위치를 바꾸려면 `game.moveStatic(e,x,y)`.
- 피해 info: `{ source: Entity|null, weapon: id, kind: 'bullet'|'arrow'|'melee'|'fist'|'trample'|'fall'|'animal'|'fire'|'drown', x, y, headshot: bool }`.
- `physics.js`: `moveCircle(world, e, dx, dy, mode, r?)`, `canStand(world, x, y, r, mode)`, `terrainBlocked`, `solidAt`.
  mode: `foot | swim | horse | wheel | boat | rail | ghost`.
- `util.js`: clamp, lerp, damp, angleWrap, angleApproach, approach, dist, RNG/rand, hash2, valueNoise, fbm, polyline 도구(polylineCumulative, pointAtDistance, closestOnPolyline), pointInPolygon, circleVsRect, rgba, mixHex, sijin(hour).
- `input`: `down(action)`, `pressed(action)`, `consume(action)`, `axis()`, `mouse {sx,sy,wx,wy,down[],pressed[]}`, `mouseDown(btn)`, `mousePressed(btn)`, `setVirtual(action, bool)`, `setVirtualAxis(x,y)`, `enabled`.
  action: up/down/left/right, sprint(Shift), brake(Space), crouch(C), enter(F), interact(E), hoan(Q), reload(R), weaponWheel(Tab), weaponNext(2)/weaponPrev(1), holster(X), whistle(H), inventory(I), skills(K), map(M), journal(J), pause(Esc/P), confirm(Enter), zoomIn/zoomOut(+/-). 마우스: 왼쪽=발사/공격, 오른쪽=조준.
- `Human` (entities/human.js): `role, faction, name, look, stamina/maxStamina, speedWalk/Run/Sprint, moveX/moveY, gait 'walk'|'run'|'sprint', crouching, aiming, aimAngle, state 'normal'|'down'|'dead', swimming, vehicle, seatIndex, seatPose, brain, weapon, carry, speech, dialog, shop, home, isPlayer`.
  `knockDown(dx,dy,power,time)`, `damage`, `die`, `revive(hp)`, `say(text, sec)`, `drawBody(ctx, phase, pose)`, `drawSeated(ctx, game, pose)`.
  보정 배수(다른 시스템이 설정): `speedMul, staminaDrainMul, staminaRegenMul, damageTakenMul`.
  faction: `civilian | police | army | gang(플레이어 무리) | rival(화적) | foreign | hunter`.
  role 예: `villager, woman, yangban, merchant, sungeom(순검), soldier, bandit, gang, foreigner, porter, monk, player`.
  NPC 두뇌 `brain`: `{ update(human, dt, game), drive?(vehicle, human, dt, game), onRobbed?(human, robber, game), onDamaged?(human, info, game) }`.
- `Player` (entities/player.js): `isPlayer=true, controlLocked, walkMode`. F/E 상호작용은 Player 가 처리하고 결과를 `game.prompt` 에 둔다(HUD 표시용).
- `Vehicle` (vehicles/vehicle.js): `vtype, displayName, seats[{x,y,role:'driver'|'passenger',pose,facing,occupant}], moveMode, length, width,
  maxSpeed, sprintSpeed, reverseSpeed, accel, decel, brakeDecel, turnRate, turnRefSpeed, turnInPlace, grip, speed, ctl{throttle,steer,sprint,brake},
  owner, stealable, playerCanDrive, fare, cameraZoom, wrecked`.
  `enter(human, game, seat?)`, `exit(human, game, {force})`, `steal(actor, game)`, `boardPassenger(actor, game, seat)`, `driver`, `occupants`, `hasPlayer`,
  덮어쓰기: `physics(dt, game)`, `playerControls(input, dt, game)`, `autopilot(dt, game)`, `drawVehicle(ctx, game)`, `drawOver`, `canExit(human, game)`, `getRiderInteractions(player, game)`, `onEnter/onExit`.

## 4. World API (js/world/world.js 의 `createWorld(game, onProgress)` 가 `game.world` 에 설정)

```js
world.size {w, h}                         // 미터
world.spawn {x, y}                        // 새 게임 시작 위치
world.terrainAt(x, y) → 지형 id(정수)      world.T {SEA, RIVER, SHALLOW, ...}  지형 enum
world.terrainInfo(id) → {id, name, ...}
world.passable(x, y, mode) → bool         world.speedMul(x, y, mode) → number
world.isWater(x, y)   world.isDeepWater(x, y)   world.isRoad(x, y)
world.querySolids(x0, y0, x1, y1, out) → [{x, y, w, h, angle, kind, blocks?: [modes]}]   // 건물·성벽 충돌 사각형
world.buildings [{id, kind, name?, x, y, w, h, angle, door:{x,y}, shop?: shopId, tags:[]}]
world.places {id: {id, name, hanja?, kind, x, y, radius, tags:[]}}   // kind: city|village|district|station|tram_stop|ferry|port|mountain|market|hideout|camp|landmark|respawn
world.zones [{id, kind, name?, poly?|{x,y,r}, data}]  // kind: forest|field|paddy|hunting|herb|fishing|restricted ...
world.randomPointInZone(zoneId|zone, mode='foot') → {x,y}|null
world.lines { tram: Line, train: Line, steamer?: Line }   // Line = {id, name, points:[[x,y]...], cum:[...], length, stops:[{id, name, d, x, y}]}
world.regionAt(x, y) → {id, name}
world.flowAt(x, y) → {x, y}               // 강물 흐름 m/s
world.findPath(x0, y0, x1, y1, mode='foot', maxNodes?) → [[x,y]...] | null   // 거친 격자 A*
world.randomPassableNear(x, y, r, mode) → {x,y}|null
world.nearestRoadPoint(x, y) → {x, y, dist}|null
world.mapCanvas, world.mapScale            // 전체 지도 저해상도 캔버스(px/m) — 지도·미니맵용
```
월드는 스스로 GROUND·DECAL·HIGH 렌더러를 등록한다(지형 청크, 철로, 지붕·성벽 문루·나무 윗부분).

## 5. 시스템 API (game.sys.*) — 다른 모듈이 부르는 공개 함수

모든 시스템은 모듈의 `export function install(game)` 에서 `game.registerSystem(...)` 한다. 아래 이름은 고정.

### game.sys.time  [분위기]
`hour`(0~24 실수), `day`, `minutesPerDay`(실시간 분, 기본 48), `isNight()`, `light`(0~1), `weather` ('clear'|'cloudy'|'rain'|'storm'|'snow'|'fog'), `wind {angle, strength}`, `setHour(h)`, `skip(hours)`, `curfew()`(인정~파루 통금 여부).
이벤트 `time:hour {hour, day}`, `weather:change {weather}`.

### game.sys.audio  [분위기]
`play(name, {x?, y?, volume?, pitch?})`, `music(trackId|null)`, `ambient(kind)`, `unlock()`(첫 클릭 때 UI 가 부름), `setVolume(master)`, `muted`.
효과음 이름(최소): `step, horse_gallop, horse_neigh, whistle, gun_matchlock, gun_rifle, gun_revolver, bow, hit, punch, death, pickup, coin, craft, door, tram_bell, train_whistle, steam, oar, splash, ui_open, ui_close, ui_click, mission_start, mission_complete, wanted, hoan_in, hoan_out, skin, gather`.

### game.sys.inventory  [파밍]
`money`(전 정수), `addMoney(n, reason)`, `spendMoney(n) → bool`, `add(itemId, n=1) → 실제 추가 수`, `remove(itemId, n=1) → bool`, `count(itemId)`, `has(itemId, n=1)`, `list() → [{id, n, def}]`, `use(itemId) → bool`(음식·약 등), `weapons() → [weaponId]`.
이벤트 `item:add {id, n}`, `item:remove {id, n}`, `money {delta, total, reason}`.
아이템 정의: `import { ITEMS, itemDef } from '../systems/items.js'` — `{id, name, cat:'material'|'consumable'|'ammo'|'weapon'|'valuable'|'quest'|'pelt'|'meat'|'herb', stack, price, desc, use?, icon?{shape,color}}`.

### game.sys.loot / crafting / shops  [파밍]
- loot: `spawnContainer(x, y, tableId, opts)`, `rollTable(tableId) → [{id,n}]`, `give(entries, source)`. 시체 뒤지기·가죽 벗기기·채집·상자 열기는 interaction provider 로 제공.
- crafting: `recipes() → [{id, name, inputs:[{id,n}], output:{id,n}, skill?}]`, `canCraft(id)`, `craft(id) → bool`.
- shops: `SHOPS` 데이터, `open(shopId)`(→ `ui.openPanel('shop', shopId)`), `stock(shopId) → [{itemId, price, n}]`, `buyPrice(shopId, itemId)`, `sellPrice(shopId, itemId)`, `buy(shopId, itemId, n) → bool`, `sell(shopId, itemId, n) → bool`, `formatMoney(jeon) → '3냥 5전'`.
이벤트 `gather {itemId, n}`, `skin {animal, quality, items}`, `loot {source, items}`, `craft {recipeId}`, `buy {shopId, itemId, n, price}`, `sell {...}`.

### game.sys.skills / stats  [전투]
- skills: `TREES` 데이터, `level(treeId)`, `xp(treeId)`, `addXP(treeId, amount, reason)`, `points`, `has(skillId)`, `canLearn(skillId)`, `learn(skillId) → bool`,
  `mod(key, base=1)` → 배운 스킬이 반영된 값(예: `mod('gunDamage')`, `mod('priceSell')`, `mod('horseStamina')`, `mod('stealthNoise')`, `mod('skinQuality', 0)` 등. 키 목록은 skills.js 상단에 문서화).
  이벤트 `skill:xp {tree, amount, level}`, `skill:levelup {tree, level}`, `skill:learn {skillId}`.
- stats: `health/stamina/hoan` 각 `{value, max, core}`(core 0~100 심지), `hoan`, `useHoan(amount) → bool`, `eat(itemId)`, `rest(hours)`. 플레이어 Human 의 hp/stamina 와 동기화.

### game.sys.combat  [전투]
`WEAPONS` 데이터 `{id, name, kind:'fist'|'melee'|'gun'|'bow'|'throw', damage, range, fireInterval, reload, mag, ammo, spread, noise, color, length}`,
`equip(human, weaponId)`, `weaponOf(human)`, `fire(shooter, angle, opts) → bool`, `melee(attacker, angle)`, `npcAttack(npc, target, dt)`(NPC 두뇌가 매 틱 부름: 거리 유지·조준·사격),
`hoanActive`, `startHoan()`, `endHoan()`.
이벤트 `shot {shooter, weapon, x, y, angle, noise}`(소리 반경 → 목격·동물 도망), `hit {target, amount, source, weapon, headshot}`, `hoan:start`, `hoan:end`.

### game.sys.wanted  [전투]
`level`(0~4), `bounty`(전), `honor`(-100~100), `honorTier() → 'noble'|'decent'|'neutral'|'rough'|'outlaw'`, `addHonor(delta, reason)`, `report(crime)`, `clear(reason)`, `payBounty() → bool`, `isWanted()`.
범죄는 `game.emit('crime', {kind, x, y, offender, victim})` 로 신고된다. kind: `theft | assault | murder | robbery | trespass | fare_evasion | animal_cruelty | looting`.
이벤트 `wanted:change {level, bounty}`, `honor:change {honor, delta, reason}`, `player:respawn {x, y}`.
플레이어 사망(`player:dead`) → 화면 어둡게 → 가까운 `respawn` 장소에서 되살림 → 벌금, 수배 해제.

### game.sys.npcs / animals / spawner  [사람]
- npcs: `spawn(def) → Human` (def = data/npcs.js 형식 또는 `{role, faction, x, y, brain, name?, look?, dialog?, shop?}`),
  `makeBrain(type, opts)` — type: `idle | wander | villager | merchant | guard | patrol | police | bandit | gang | follower | companion | flee | porter | driver | passenger`,
  `named(id) → Human|null`, `spawnGroup(kind, x, y, n, opts) → Human[]` (kind: police|soldiers|bandits|rivals|hunters), `alert(x, y, radius, kind)`(총소리 등에 반응).
  NPC 는 `shot`, `crime`, `damage` 이벤트에 반응(도망·신고·반격).
- animals: `SPECIES` 데이터, `spawn(speciesId, x, y) → Animal`. Animal 은 `kind='animal'`, `species`, `hp`, `state`, 죽으면 `dead=true` 로 남아 가죽 벗기기 대상.
  사냥 품질: 죽을 때 `animal.quality`(1~3) 를 정해 둔다(무기·부위·맞은 횟수).
- spawner: 이름 있는 NPC 배치(data/npcs.js), 마을 주민·행인 주변 생성/정리, 사냥터 동물 생성, 화적 무리 등 무작위 사건 위치.

### game.sys.vehicles  [탈것]
`spawn(vtype, x, y, angle, opts) → Vehicle`, vtype: `horse | pony | jeju_horse | western_horse | rowboat | sailboat | steamer | gama | rickshaw | bicycle | oxcart | tram | train`,
`playerHorse`(Vehicle|null), `callHorse()`(휘파람), `setPlayerHorse(v)`, `lines`(world.lines 참조 + 운행 차량), `nextDeparture(lineId, stopId) → 게임시각`, `rideTo(lineId, stopId)`(빠른 이동 보조).
이벤트 `vehicle:enter/exit {human, vehicle, seat, role}`, `rail:arrive {line, stop, vehicle, playerAboard}`, `rail:depart {...}`, `horse:bond {level}`, `fare {line, amount}`.

### game.sys.missions  [미션]
`MISSIONS`(data/story.js), `active`(현재 미션 상태|null), `start(id)`, `complete()`, `fail(reason)`, `objectiveText() → string`, `markers() → [{x, y, kind:'objective'|'mission'|'stranger'|'shop'|'ferry'|'station', label}]`,
`available() → [{id, title, x, y, giver}]`(시작 가능한 미션 표식), `journal() → [{id, title, status, summary}]`, `isDone(id)`.
목표(step) 판정 타입: `reach{x,y,r}`, `mount{vtype?}`, `dismount`, `ride{line, from?, to}`, `kill{tag|faction, n}`, `collect{itemId, n}`, `talk{npcId}`, `survive{seconds}`, `escort{npcId, x, y, r}`, `skin{species?, n}`, `gather{itemId?, n}`, `buy{itemId?}`, `craft{recipeId?}`, `wait{seconds}`, `flag{name}`, `custom{fn}`.
이벤트 `mission:start {id}`, `mission:step {id, step}`, `mission:complete {id, rewards}`, `mission:fail {id, reason}`.

### game.sys.ui  [UI]
`showTitle()`, `hideTitle()`, `toast(text, kind)`, `banner(title, subtitle, seconds)`, `fade(toBlack:boolean, ms) → Promise`,
`dialogue(lines:[{speaker, text, portrait?}], opts) → Promise`, `choice(question, options:[string]) → Promise<number>`,
`openPanel(name, arg)`, `closePanel()`, `panelOpen` — name: `inventory | craft | skills | map | journal | shop | pause | help`.
HUD 는 매 프레임 `game.prompt`, `game.sys.stats`, `game.sys.wanted`, `game.sys.inventory.money`, `game.sys.missions.objectiveText()`, `game.sys.time`, `world.regionAt` 을 읽는다.
'notify' 이벤트를 토스트로 보여 준다. 첫 사용자 입력에서 `game.sys.audio?.unlock()`.

### game.sys.save  [분위기]
`save(slot='auto') → bool`, `load(slot='auto') → bool`, `hasSave(slot)`, `clear(slot)`. 각 시스템의 `serialize()/deserialize(data)` 를 모은다. 플레이어 위치·체력·돈·소지품·스킬·미션·플래그·시각.

## 6. 이벤트 목록 (payload)

| 이벤트 | payload | 보내는 곳 |
|---|---|---|
| `game:start` | {} | 코어 |
| `notify` | {text, kind:'info'|'warn'|'good'|'bad'} | 누구나 |
| `damage` | {target, amount, source, weapon, kind, x, y, headshot} | Entity.damage |
| `kill` | {victim, killer, info} | Entity.die |
| `player:dead` / `player:respawn` | {info} / {x,y} | player / wanted |
| `crime` | {kind, x, y, offender, victim} | 누구나 |
| `shot` | {shooter, weapon, x, y, angle, noise} | combat |
| `hit` | {target, amount, source, weapon, headshot} | combat |
| `trample` | {vehicle, victim, driver} | vehicle |
| `vehicle:enter` / `vehicle:exit` | {human, vehicle, seat, role} | vehicle |
| `vehicle:crash` / `vehicle:wrecked` | {vehicle, speed} | vehicle |
| `rail:arrive` / `rail:depart` | {line, stop, vehicle, playerAboard} | vehicles |
| `item:add` / `item:remove` | {id, n} | inventory |
| `money` | {delta, total, reason} | inventory |
| `gather` / `skin` / `loot` / `craft` / `buy` / `sell` | 위 참고 | 파밍 |
| `skill:xp` / `skill:levelup` / `skill:learn` | 위 참고 | skills |
| `wanted:change` / `honor:change` | 위 참고 | wanted |
| `hoan:start` / `hoan:end` | {} | combat |
| `talk` | {npc} | npcs (E 로 말 걸 때) |
| `mission:*` | 위 참고 | missions |
| `time:hour` / `weather:change` | 위 참고 | time |
| `ui:panel` | {name, open} | ui |

## 7. 데이터 형식

`js/data/npcs.js`:
```js
export const NPCS = [
  { id: 'npc_id', name: '이름', hanja: '漢字', role: 'gang', faction: 'gang', x: 0, y: 0,
    brain: 'idle'|'wander'|'merchant'|'guard'|'patrol'|'companion', look: {coat:'#..'}?,
    dialog: ['평소 대사1', '대사2'], shop: 'shopId'?, tags: ['story'], hidden?: bool /* 미션이 등장시킬 때까지 숨김 */ },
];
```
`js/data/story.js`:
```js
export const MISSIONS = [
  { id, title, chapter, giver: npcId, start: {x, y, r}, requires: [missionId], intro: [{speaker, text}],
    steps: [{ text: '목표 문구', type: 'reach', x, y, r, onStart?: [{speaker,text}], onDone?: [{speaker,text}], spawn?: [...]}],
    rewards: { money, items: [{id, n}], honor, xp: {tree: n} }, outro: [{speaker, text}] },
];
```

## 8. 작업 규칙(에이전트 공통)

1. 자기 담당 파일만 만든다/고친다. 코어 파일(engine/*, human.js, player.js, vehicle.js, main.js, index.html, tools/*)은 고치지 않는다. 코어 버그나 필요한 API 는 최종 보고에 적는다(우회 가능하면 우회).
2. 확정값은 `docs/prototype_spec.md` 를 따른다. 스펙과 이 문서가 충돌하면 이름·API 는 이 문서, 수치·내용은 스펙.
3. 화면 문구는 한국어. 주석은 한국어 짧게.
4. 끝내기 전에 `node tools/smoke.mjs --only=<내 모듈들>` 과 전체 `node tools/smoke.mjs` 를 돌려 에러가 없게 한다(남이 만든 모듈 에러는 보고만).

## 9. 지도 데이터 형식 (js/world/mapdata.js) 과 지형 enum

지도는 **데이터(mapdata.js)** 와 **엔진(terrain/render/structures/nav)** 을 분리한다. 엔진은 아래 형식만 알면 된다.
스펙(prototype_spec.md A)의 좌표는 나중에 이 형식으로 옮겨 넣는다.

```js
export const MAP = {
  size: { w, h },                 // 미터
  cell: 2,                        // 지형 격자 크기(m)
  spawn: { x, y },
  sea: [poly, ...],               // 바다 다각형들 (poly = [[x,y], ...])
  mudflats: [poly, ...],          // 갯벌·모래톱
  rivers: [{ id, name, points: [[x,y],...], width, shallow: 6 }],  // width: 깊은 물 폭, shallow: 양쪽 얕은 물 폭
  ponds: [poly, ...],
  mountains: [{ id, name, hanja?, x, y, r, height: 0..1, rock: 0..1 }],
  forests: [{ id, poly?, x?, y?, r?, density: 0..1, pine: 0..1 }],
  fields: [{ id, kind: 'paddy'|'field', poly }],
  walls: [{ id, name, points: [[x,y],...] /*닫힌 고리*/, thickness: 4,
            gates: [{ id, name, hanja?, x, y, w: 8 }] }],            // 대문 자리는 성벽이 끊기고 문루(HIGH 층)를 그린다
  roads: [{ id, name?, kind: 'main'|'road'|'path'|'street', points, width }],
  bridges: [{ id, points, width }],
  lines: [{ id: 'tram'|'train'|'steamer', name, kind: 'rail'|'water', points, stops: [{ id, name, x, y }] }],
  settlements: [{ id, name, kind: 'city'|'town'|'village'|'port'|'camp', x, y, r, houses, style: 'hanok'|'choga'|'mixed'|'western', seed }],
  buildings: [{ id, kind, name?, x, y, w, h, angle, shop?, tags? }],   // 이름 있는 건물(관아·역사·주막·상점 등). 나머지 집은 settlements 로 절차 생성
  places: [{ id, name, hanja?, kind, x, y, radius, tags? }],
  zones: [{ id, kind, name?, poly?, x?, y?, r?, data? }],             // hunting|herb|restricted|camp 등
  regions: [{ id, name, poly?, x?, y?, r? }],                          // HUD 지역 이름 (앞쪽이 우선)
};
```

지형 enum (`world.T`, js/world/terrain.js 에서 export):

| id | 이름 | foot | horse | wheel | boat | 비고 |
|---|---|---|---|---|---|---|
| SEA | 바다 | ✗(헤엄) | ✗ | ✗ | ✓ | 깊은 물 |
| RIVER | 강 | ✗(헤엄) | ✗ | ✗ | ✓ | 깊은 물, flowAt |
| SHALLOW | 얕은 물 | 0.55 | 0.6 | ✗ | ✓ | |
| MUD | 갯벌 | 0.5 | 0.45 | ✗ | ✗ | |
| SAND | 모래 | 0.85 | 0.8 | 0.6 | ✗ | |
| GRASS | 풀밭 | 1 | 1 | 0.75 | ✗ | |
| FIELD | 밭 | 0.85 | 0.8 | 0.6 | ✗ | |
| PADDY | 논 | 0.6 | 0.55 | ✗ | ✗ | |
| FOREST | 숲 | 0.8 | 0.6 | ✗ | ✗ | |
| MOUNTAIN | 산비탈 | 0.65 | 0.5 | ✗ | ✗ | |
| ROCK | 바위·벼랑 | ✗ | ✗ | ✗ | ✗ | |
| ROAD | 길 | 1.05 | 1.1 | 1.0 | ✗ | |
| MAIN_ROAD | 큰길 | 1.05 | 1.15 | 1.1 | ✗ | |
| STREET | 거리 | 1.05 | 1.0 | 1.05 | ✗ | 성안·마을 안 |
| YARD | 마당 | 1 | 0.9 | 0.9 | ✗ | |
| WALL | 성벽 | ✗ | ✗ | ✗ | ✗ | |
| BRIDGE | 다리 | 1.05 | 1.05 | 1.0 | ✗(아래로 배 통과 가능) | |
| RAIL | 철로 | 0.9 | 0.8 | 0.5 | ✗ | rail 모드 차량용 |
| PIER | 부두·나루 | 1 | 0.9 | 0.9 | ✓(가장자리) | |

`swim` 모드는 SEA·RIVER·SHALLOW 에서만 가능, `rail` 모드는 어디든(노선 차량은 폴리라인을 따라감), `ghost` 는 무시.
