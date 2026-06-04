# NodeVelture 프로젝트 현황

> 작성일: 2026-06-04
> Node + Novel + Adventure — AI와 함께 세계관을 만들고, 그 세계관 속 등장인물이 되어 소설을 완성하는 협업 창작 플랫폼

지금까지 구축된 서비스 전체를 훑어보고, **만들어진 것 / 진행 중인 것 / 앞으로 할 것 / 내일 당장 할 것**을 정리한 문서입니다.

---

## 1. 서비스 한눈에 보기

3단계 흐름으로 동작하는 창작 플랫폼:

```
1단계 세계관 설정     → AI(작가 페르소나)와 함께 장르/배경/등장인물 잡기
2단계 대화형 창작     → 사용자=주인공 / AI=조연들, 입력에 따라 이야기 분기
3단계 소설 변환       → 대화 로그를 소설 문체로 자동 변환
```

작가 페르소나 4명: **백야**(호러·미스터리) / **차로운**(추리) / **한여름**(로맨스) / **김도현**(일상·에세이)

---

## 2. 기술 스택 / 아키텍처 현황

| 영역 | 채택 기술 | 상태 |
|------|-----------|------|
| 프론트엔드 | React 19 + Vite 8 + react-router-dom 7 | 메인 페이지 골격만 |
| 백엔드 | FastAPI (Python 3.11) | API 골격 완성 |
| AI 엔진 | **Gemini 2.5 Flash** (실연동 완료) | PERSO는 TTS 용도로 보류 |
| 관계형 DB | PostgreSQL + SQLAlchemy + Alembic | 모델/CRUD 완성 |
| 문서 DB | MongoDB (motor) | RAG 임베딩 저장용 |
| 캐시/세션 | Redis | 프롬프트 컨텍스트 관리 구현 |
| 임베딩 | sentence-transformers (multilingual MiniLM) | RAG 유사 대화 검색 |
| 배포 | Render / Railway (예정) | 미착수 |

> ⚠️ **아키텍처 정리 필요**: 현재 데이터 저장소가 PostgreSQL(`api/v1` CRUD), MongoDB(`rag_service`), Redis(`chats.py`) 3중으로 혼재합니다. DB=원본 저장소 / Redis=프롬프트 임시 복사본 역할 분담은 정해졌으나, MongoDB-RAG 라인과 Postgres 라인이 아직 통합되지 않았습니다. **역할 경계를 한 번 정리하고 가는 것이 시급합니다.**

> ⚠️ **현재 작업 트리 상태**: `backend/app/api/chats.py` 와 `docs/dev-logs/jyj_devlog.md` 가 워킹 트리에서 삭제된 상태(uncommitted)입니다. `main.py`가 `chats.py`를 import하므로 이대로면 서버가 기동되지 않습니다. 의도된 삭제가 아니라면 `git restore`로 복원 필요.

---

## 3. 지금까지 만들어진 것 ✅

### 백엔드 — API 서버
- **FastAPI 앱 구조** (`main.py`): CORS, MongoDB lifespan 연결, `/health` 헬스체크
- **v1 CRUD API** (`api/v1/`, PostgreSQL 기반)
  - users / worlds / characters / sessions / dialogues / novels 엔드포인트
  - 세션 생성·조회·완료(`PATCH /complete`) 등 라이프사이클 처리
- **Chat API** (`api/chats.py`, Redis + Gemini) — **핵심 동작부**
  - `POST /api/chats/{chatId}/messages` — 사용자 메시지 수신 → Redis 저장
  - `GET /api/chats/{chatId}/stream` — SSE 스트리밍 (`event: token / done / error`)
  - `PATCH /api/chats/{chatId}/state` — 현재 상태 수동 갱신
  - **Gemini 2.5 Flash 실연동 완료** (스트리밍 응답 동작 확인)

### 백엔드 — 데이터 / 모델
- **DB 모델 7종**: User, World, Character, Session, Dialogue, Novel, ApiLog
- **Pydantic 스키마 6종** (chat, session, dialogue, character, world, novel ...)
- **Alembic 마이그레이션** 초기 세팅 (`f74e0002f300_init`)

### 백엔드 — 서비스 레이어
- **CacheService** (`cache.py`): Redis TTL 캐시, SHA256 네임스페이스 키
- **Redis 프롬프트 컨텍스트 관리** (`chats.py`): 최근 대화(N=20)·상태·등장인물·요약을 Redis에 저장하고 프롬프트로 조립, 5턴마다 DB 동기화 훅(`sync_to_db`, 구현 예정)
- **RAGService** (`rag_service.py`): 대화 임베딩 저장 + 코사인 유사도로 과거 대화 검색 (MVP: Python 계산)
- **LLMRouter** (`llm_router.py`): 캐릭터 응답 스트리밍 / 소설 생성 인터페이스 (PERSO·Ollama 연결부는 TODO)
- **페르소나 프롬프트 템플릿** (`personas.py`): 작가 4명, 작가모드/등장인물모드 분기

### 프론트엔드
- React + Vite 프로젝트 세팅, 라우팅 골격(`App.jsx`)
- 메인 페이지(`pages/main/`), 작가 이미지 에셋, 아이콘
- Capacitor 안드로이드 빌드 스크립트(`npm run and`)

### 인프라 / 협업
- PostgreSQL + Redis docker-compose
- GitHub Actions CI (pytest), PR 템플릿, feature 브랜치 전략
- ngrok으로 로컬 서버 팀원 공유
- 백엔드 문서 5종 (architecture / api / models / setup / coding-rules)

---

## 4. 진행 중 / 부분 구현 🚧

| 항목 | 현재 상태 | 남은 일 |
|------|-----------|---------|
| SSE 스트리밍 | Gemini로 실동작 | 작가모드/등장인물모드 분기, 에러 처리 다듬기 |
| Redis ↔ DB 동기화 | `sync_to_db` 훅만 존재 | 가연님 DB 연동 후 실제 사건요약·호감도 동기화 |
| RAG 검색 | MongoDB 임베딩 저장·검색 동작 | chats.py 채팅 흐름과 통합되지 않음 |
| LLMRouter | 인터페이스만 | 엔진 스위칭(Gemini↔폴백) 실연결 |
| 프론트 ↔ 백엔드 | API 스펙 합의됨 | 실제 호출/스트리밍 통합 테스트 |
| 소설 변환 | `generate_novel` 스텁 | 변환 전용 프롬프트 + 엔드포인트 구현 |

---

## 5. 앞으로 할 것 (전체 로드맵)

### 이번 주 (6/2~6/8) — 전체 흐름 동작 확인 우선
- [ ] 프롬프트 품질 테스트 및 개선 (백야 / 차로운 / 한여름 / 김도현 각각)
- [ ] 세계관 정보(`world_context`)를 프론트 → chat API로 연결
- [ ] **전체 흐름 E2E 확인**: 작가 선택 → 세계관 설정 → 채팅 → AI 응답
- [ ] 에러 핸들링 미들웨어 (전역 예외 처리, 일관된 에러 응답)

### 다음 주 (6/9~6/15) — 채팅 핵심 + 운영
- [ ] 작가모드 / 등장인물모드 응답 분기 완성
- [ ] Redis → DB 5턴 동기화 실구현 (가연님 DB 연동)
- [ ] RAG(과거 대화 검색)를 채팅 프롬프트에 통합
- [ ] API Log 미들웨어 (토큰 수 / 비용 / 엔드포인트 자동 기록)
- [ ] 환경변수 기반 엔진 스위칭 (Gemini ↔ 폴백)
- [ ] 프론트엔드 통합 테스트 (CORS / 실호출 / 스트리밍)
- [ ] JWT 인증 (로그인, 토큰 발급·검증) — 후순위

### 마지막 주 (6/16~6/19) — 소설 변환 + 배포 + 발표
- [ ] **소설 변환 기능** (대화 로그 → 소설 문체, 변환 전용 프롬프트)
- [ ] 비용 모니터링 / 로그 조회 엔드포인트
- [ ] Dockerfile 작성 + docker-compose에 앱 컨테이너 추가
- [ ] Render / Railway 실배포 + 프로덕션 환경변수
- [ ] README 실행 방법 업데이트, 발표 자료 백엔드 파트 정리
- [ ] 평가 리포트 (페르소나 일관성, 캐릭터 구분도 등) + 시연 영상

---

## 6. 🔥 내일 당장 해야 할 것 (6/5)

> 원칙: **"전체 흐름이 한 번 끝까지 도는 것"**을 최우선으로. 인증·배포보다 동작 확인이 먼저.

1. **[복구] 워킹 트리 정리** — 삭제 상태인 `chats.py` / `jyj_devlog.md`가 의도된 건지 확인하고, 아니면 `git restore`로 복원. 서버가 뜨는 상태부터 만들기.
2. **[테스트] 작가 4명 프롬프트 품질 확인** — 백야 / 차로운 / 한여름 / 김도현 각각에 같은 입력을 넣어 페르소나 톤이 구분되는지 직접 비교. 어색하면 `personas.py` 문구 수정.
3. **[연결] 세계관 정보 연동** — 프론트에서 받은 `world_context`가 `build_prompt`까지 실제로 흘러 들어가는지 확인 (현재 요청 파라미터로는 받지만 프론트 연결 미확인).
4. **[E2E] 전체 흐름 1회 완주** — 작가 선택 → 세계관 입력 → `POST messages` → `GET stream`으로 Gemini 응답까지 한 번 끝까지 돌려보기. 막히는 지점 기록.
5. **[정리] 저장소 역할 경계 결정** — PostgreSQL / MongoDB / Redis 3중 구조 중 MVP에서 실제로 쓸 라인을 정리 (특히 RAG의 MongoDB 라인을 유지할지 결정). 팀(가연님)과 합의.
6. **[설정] GitHub dev 브랜치 보호 규칙** — 직접 머지 방지 규칙 설정 (이전 일지 미완료 항목).

---

## 7. 알려진 이슈 / 리스크

| 이슈 | 비고 |
|------|------|
| 워킹 트리에서 핵심 파일(`chats.py`) 삭제 상태 | 서버 기동 불가 — 우선 복구 |
| 저장소 3중 구조 (Postgres/Mongo/Redis) 미통합 | 역할 경계 정리 필요 |
| PERSO API는 텍스트 생성 불가 (영상 번역/더빙용) | 채팅은 Gemini 유지, PERSO는 TTS 후보 |
| Python 3.13 빌드 실패 (asyncpg, pydantic-core) | Python 3.11 / conda 환경으로 통일 완료 |
| RAG 유사도 Python 계산 (MongoDB Atlas 미사용) | 데이터 늘면 성능 한계 — MVP 한정 |

---

## 8. 참고 문서
- 기획서: [docs/planning/NodeVelture.md](planning/NodeVelture.md)
- 페르소나 카드: [docs/personas/persona_cards.md](personas/persona_cards.md)
- 백엔드 상세: [backend/docs/](../backend/docs/) (architecture / api / models / setup / coding-rules)
- 백엔드 TODO: [backend/docs/todo.md](../backend/docs/todo.md)
- 개발일지: [docs/dev-logs/](dev-logs/)
