# 조선 1899

1899년 대한제국(광무 3년)을 무대로 한 2D 탑다운 오픈월드 게임 프로토타입입니다.
레드 데드 리뎀션 2와 GTA에서 영감을 받았고, 수묵채색 화풍의 그래픽은 모두 코드로 그립니다(이미지·사운드 파일 없음).

> 개발 중입니다. 지금은 엔진 코어와 일부 모듈만 들어 있습니다.

## 실행

```bash
node tools/devserver.cjs . 5173
```

브라우저에서 http://localhost:5173 을 엽니다.

## 헤드리스 테스트

```bash
node tools/smoke.mjs --ticks=3000
```

## 문서

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — 모듈 구조와 API 계약
- docs/GDD.md, docs/prototype_spec.md — 기획서와 구현 명세(작성 중)

---

## 팔도천하 — 조선 군웅 전략 (`paldo/`)

같은 저장소에 들어 있는 두 번째 게임. 삼국지식 장수 경영 + 문명식 문물 나무·위업 + 빅토리아식 세력 집단·법령을 엮은 턴제 전략 게임이다.
가상 시나리오 「팔도군웅전」(세종·이성계·이순신·정조·홍경래…)과 역사 시나리오 「임진년」(1592~1598)이 있다.

```bash
node tools/devserver.cjs . 5173
# → http://localhost:5173/paldo/index.html
```

자세한 내용은 [paldo/README.md](paldo/README.md), 기획은 [paldo/docs/GDD.md](paldo/docs/GDD.md).
