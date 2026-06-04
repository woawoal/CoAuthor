# 아키텍처

## 레이어 구조

```
┌──────────────────────────────────────────────┐
│               API Layer                      │
│   app/api/v1/endpoints/  ← HTTP 요청 처리     │
│   app/api/v1/router.py   ← 라우터 등록         │
├──────────────────────────────────────────────┤
│               Schema Layer                   │
│   app/schemas/  ← 입력 검증 / 출력 직렬화      │
├──────────────────────────────────────────────┤
│               Service Layer                  │
│   app/services/cache.py      ← Redis 캐시     │
│   app/services/llm_router.py ← AI 호출        │
├──────────────────────────────────────────────┤
│               Model Layer                    │
│   app/models/  ← SQLAlchemy ORM 모델          │
├──────────────────────────────────────────────┤
│               Infrastructure                 │
│   PostgreSQL 15  │  Redis 7  │  AI Engine    │
└──────────────────────────────────────────────┘
```

---

## 폴더별 역할

### `app/main.py`
- FastAPI 앱 인스턴스 생성
- CORS 미들웨어 등록
- v1 라우터 마운트
- 로깅 설정

### `app/database.py`
- `create_async_engine` 으로 PostgreSQL 비동기 연결
- `AsyncSession` 팩토리 생성
- `get_db` 의존성 함수 — 엔드포인트마다 DB 세션을 자동으로 열고 닫음
- `Base` — 모든 모델이 상속하는 SQLAlchemy DeclarativeBase

### `app/core/config.py`
- `pydantic-settings` 기반 환경변수 관리
- `.env` 파일을 읽어 `settings` 싱글턴 객체로 제공
- 주요 항목: `DATABASE_URL`, `REDIS_URL`, `AI_API_KEY`, `SECRET_KEY`

### `app/models/`
- SQLAlchemy 2.0 스타일의 ORM 모델
- `Mapped[타입]` + `mapped_column()` 사용
- `Base`를 상속해 자동으로 테이블 생성 대상이 됨
- `app/models/__init__.py` 에서 전체 임포트 → Alembic이 자동 감지

### `app/schemas/`
- Pydantic v2 기반 입출력 스키마
- `XXXCreate` : 생성 요청 body
- `XXXUpdate` : 수정 요청 body (모든 필드 Optional)
- `XXXResponse` : API 응답 형식 (`model_config = {"from_attributes": True}` 필수)

### `app/api/v1/`
- `router.py` : 모든 엔드포인트를 `/api/v1` prefix로 통합
- `endpoints/` : 도메인별 라우터 파일 (users, worlds, characters, sessions, dialogues, novels)

### `app/services/`
- `cache.py` : Redis 비동기 TTL 캐시. `namespace:hash` 키 구조
- `llm_router.py` : AI 엔진 호출 추상화. PERSO API → Ollama 폴백 순서로 연결 예정

### `app/prompts/`
- AI에게 전달할 시스템 프롬프트 템플릿 보관 예정
- 캐릭터 역할별 프롬프트, 소설 변환 프롬프트 등

### `migrations/`
- Alembic 마이그레이션 파일 관리
- `env.py` : 비동기 엔진 기반 마이그레이션 실행
- `versions/` : 자동 생성된 마이그레이션 파일들

---

## 요청 처리 흐름 상세

### 일반 CRUD 요청 (예: 세계관 생성)

```
POST /api/v1/worlds
        │
        ▼
router.py → worlds.py:create_world()
        │
        ▼
schemas/world.py:WorldCreate  ← 입력값 자동 검증
        │  (실패 시 422 자동 반환)
        ▼
get_db() → AsyncSession 생성
        │
        ▼
models/world.py:World 인스턴스 생성
        │
        ▼
db.add() → db.flush() → db.refresh()
        │
        ▼
schemas/world.py:WorldResponse  ← 응답 직렬화
        │
        ▼
200/201 JSON 응답
```

### 대화 스트리밍 요청 (SSE)

```
POST /api/v1/sessions/{id}/dialogues/stream
        │
        ▼
dialogues.py:stream_dialogue()
        │
        ├─ 세션 상태 검증 (ACTIVE 여부)
        ├─ 캐릭터 존재 확인
        ├─ 사용자 발화 DB 저장
        │
        ▼
StreamingResponse(generate(), media_type="text/event-stream")
        │
        ├─ LLMRouter.stream_character_response()  ← AI 호출
        ├─ 청크 단위로 yield "data: ...\n\n"
        ├─ AI 응답 완성 → DB 저장
        └─ yield "data: [DONE]\n\n"
```

---

## AI 엔진 연동 구조 (예정)

```
LLMRouter
    │
    ├─ PERSO API 호출 시도
    │       └─ 성공 → 스트리밍 응답 반환
    │
    └─ 실패 (타임아웃 / 오류)
            └─ Ollama (로컬) 폴백 호출
```

프롬프트 구성:
```
시스템 프롬프트 = 세계관 설명 + 캐릭터 system_prompt 필드
대화 히스토리  = 이전 Dialogue 목록 (turn_order 순)
사용자 메시지  = 현재 입력
```
