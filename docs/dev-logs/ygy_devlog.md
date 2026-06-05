# 가연 개발 로그

---

## 2026-06-04

### 작업 내용

#### 1. DB 이중 구조 설계 및 구현

강사님 피드백 + 팀 회의 결과로 DB 이중 구조 도입 결정.

| DB | 저장 데이터 |
|----|------------|
| PostgreSQL | User, World, Character, Session, Novel, ApiLog |
| MongoDB | Dialogue (대화 로그 + RAG 벡터 임베딩) |
| Redis | 응답 캐싱 (CacheService) |

**이유:** Dialogue는 채팅 로그라 쓰기가 매우 빈번하고, RAG 벡터 임베딩을 함께 저장해야 해서 MongoDB가 적합. PostgreSQL은 관계형 데이터 유지.

---

#### 2. MongoDB 인프라 세팅

- `docker-compose.yml` — MongoDB 서비스 및 볼륨 추가
- `requirements.txt` — `motor`, `sentence-transformers` 추가
- `core/config.py` — `MONGODB_URL`, `MONGODB_DB_NAME` 환경변수 추가
- `database.py` — Motor 클라이언트(`mongo_client`) 및 `get_mongo_db()` 의존성 추가
- `main.py` — FastAPI `lifespan`으로 앱 시작 시 MongoDB 자동 연결/종료 관리
- `.env.example` — MongoDB 환경변수 예시 추가

---

#### 3. Dialogue PostgreSQL → MongoDB 이전

- `models/dialogue.py` — SQLAlchemy ORM 모델 제거, Pydantic `DialogueDocument`로 교체. `embedding` 필드(RAG용 벡터) 추가
- `models/session.py` — `dialogues` relationship 제거 (Dialogue가 MongoDB로 이전됨)
- `models/__init__.py` — `Dialogue` import 제거
- `schemas/dialogue.py` — ID 타입 `uuid.UUID` → `str` 변경 (MongoDB 호환), `from_attributes` 제거
- `endpoints/dialogues.py` — SQLAlchemy 쿼리 전체 Motor 쿼리로 전환. 대화 저장 시 임베딩 자동 생성
- `endpoints/novels.py` — 대화 로그 조회를 PostgreSQL → MongoDB로 변경

---

#### 4. RAG 서비스 구현

`services/rag_service.py` 신규 작성.

**핵심 기능 2가지:**
- `save_with_embedding()` — 대화 저장 시 `sentence-transformers`로 텍스트 벡터 생성 후 MongoDB에 함께 저장
- `search_similar()` — 새 메시지 입력 시 과거 대화 중 의미상 유사한 것 top-k 검색 (Python 코사인 유사도, MongoDB Atlas 없이 동작)

**임베딩 모델:** `paraphrase-multilingual-MiniLM-L12-v2` (한국어 지원, 로컬 실행)

---

#### 5. LLMRouter PromptBuilder + RAG 연결

`services/llm_router.py` 업데이트.

- `_build_prompt()` 함수 추가 — 페르소나 시스템 프롬프트 + RAG 컨텍스트 + 대화 히스토리 조합
- `stream_character_response()` 호출 시 RAG 검색 결과 자동 프롬프트 주입
- 실제 AI 호출 부분은 TODO (PERSO API / Ollama 연결 예정)

---

#### 6. Alembic 초기 Migration 생성

```bash
alembic revision --autogenerate -m "init"
alembic upgrade head
```

PostgreSQL에 6개 테이블 생성 (users, worlds, characters, sessions, novels, api_logs). `dialogues` 테이블은 MongoDB로 이전했으므로 제외.

---

#### 7. DB 모델 수정

팀 요구사항 반영:

**Character 모델**
- `background`, `appearance` 제거 → `prompt` 필드 하나로 통합
- `system_prompt` → `prompt`로 이름 변경
- `user_id` 추가 (String 타입, users 테이블 FK 없음 — 기기별 랜덤 식별자)
- `dialogues` relationship 제거

**User 모델**
- `email`, `hashed_password` → nullable (로그인 기능 추후 구현 예정)

**World 모델**
- `rules` → nullable (선택 입력)

스키마(character, user, world)도 모델 변경사항 반영.

---

### 데이터 흐름 (현재 구조)

```
사용자 메시지
  → PostgreSQL에서 Session/Character 유효성 검증
  → 사용자 발화를 MongoDB에 저장 (텍스트 + 임베딩 벡터)
  → 과거 대화에서 유사한 내용 검색 (RAG)
  → 페르소나 프롬프트 + RAG 컨텍스트 + 대화 히스토리 조합
  → LLM 호출 (TODO: PERSO API / Ollama)
  → AI 응답을 MongoDB에 저장 (텍스트 + 임베딩 벡터)
  → SSE 스트리밍으로 프론트에 전달
```

---

### 남은 작업

- [x] `chats.py` DB 연결 (메시지 MongoDB 저장, 대화 히스토리 프롬프트 주입)
- [ ] Alembic migration 재생성 (모델 수정사항 반영)
- [ ] Redis 캐싱 구현 (최근 N개 대화, 캐릭터 정보, 호감도)
- [ ] ContextManager 구현 (10턴 초과 시 요약)
- [ ] 토큰 한도 관리
- [ ] NovelConverter (대화 → 소설 변환)
- [ ] Guardrail (연령대별 콘텐츠 필터)
- [ ] DB 시드 데이터 (페르소나 4개 기본 캐릭터)

---

## 2026-06-05

### 작업 내용

#### 1. chats.py DB 연결 (팀장님 TODO 파트 구현)

`api/chats.py`의 `send_message`, `stream_response` 두 함수에 MongoDB 연결 추가.

**`send_message` 변경사항**
- 기존: 랜덤 ID만 반환, 저장 없음
- 변경: MongoDB turn 수 조회 → `DialogueDocument` 생성 → `save_with_embedding()`으로 임베딩 포함 저장 → 저장된 ID 반환

**`stream_response` 변경사항**
- 기존: 히스토리 없이 매번 새로 Gemini 호출
- 변경:
  1. MongoDB에서 최근 10개 대화 조회
  2. 대화 히스토리 텍스트 조합
  3. 시스템 프롬프트 + 히스토리 + 사용자 입력 합쳐서 Gemini 호출
  4. 스트리밍하면서 응답 텍스트 수집
  5. 완료 후 AI 응답 MongoDB에 저장 (임베딩 포함)

---

#### 2. 동작 확인 (로컬 테스트)

- `POST /api/chats/test-ygy/messages` → 201 응답, MongoDB `dialogues` 컬렉션에 `speaker_type: 'user'` + 임베딩 저장 확인
- `GET /api/chats/test-ygy/stream` → 백야 페르소나로 SSE 스트리밍 응답 확인, MongoDB에 `speaker_type: 'character'` + 임베딩 저장 확인

---

### 데이터 흐름 (현재 구조)

```
사용자 메시지 전송 (POST /api/chats/{chat_id}/messages)
  → MongoDB에 사용자 발화 저장 (텍스트 + 임베딩 벡터)

AI 응답 요청 (GET /api/chats/{chat_id}/stream)
  → MongoDB에서 최근 10개 대화 히스토리 조회
  → 페르소나 시스템 프롬프트 + 히스토리 조합
  → Gemini 2.5 Flash 호출
  → SSE 스트리밍으로 프론트에 전달
  → 완료 후 AI 응답 MongoDB에 저장 (텍스트 + 임베딩 벡터)
```

---

### 남은 작업

- [ ] Alembic migration 재생성 (Character/User/World 모델 수정사항 반영)
- [ ] Redis 캐싱 구현 (최근 N개 대화, 캐릭터 정보, 호감도)
- [ ] ContextManager 구현 (10턴 초과 시 요약)
- [ ] 토큰 한도 관리
- [ ] NovelConverter (대화 → 소설 변환)
- [ ] Guardrail (연령대별 콘텐츠 필터)
- [ ] DB 시드 데이터 (페르소나 4개 기본 캐릭터)
