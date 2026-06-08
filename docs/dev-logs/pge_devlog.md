# pge 개발일지

---

## 2026-06-08

### 오늘 한 일

**채팅 페이지 세계관 연동**
- chatId(session_id) → session → world_id → 세계관+캐릭터 DB 조회 흐름 구현
- 메모 패널에 세계관 요약(description/setting/rules) 토글 표시
- 등장인물 목록 DB에서 불러와 표시 (기본값은 선택한 작가명으로 통일)

**세션 기반 chat_id 연결 구조**
- `sessions` 테이블을 chat_id 허브로 활용 (world_id + user_id + protagonist_id 연결)
- worldview 저장 시 session 생성 → session_id를 chatId로 chat 페이지에 전달
- chatId → getSession → world_id 체인으로 신규 채팅/이어쓰기 진입 경로 통일

**소설 자동저장 기능**
- "채팅 종료" 버튼: `PATCH /sessions/{id}/complete` → `POST /sessions/{id}/novel/generate` 순서로 자동 저장
- `novels` 테이블에 대화 로그 원문 저장 (draft 상태, LLM 변환은 TODO)

**소설 목록 페이지 (chatlist)**
- `/chatlist` 라우트 및 페이지 신규 생성
- 세션 목록 조회 (`GET /sessions/?user_id=...`) — world_title, status 배지, 날짜 표시
- "이어쓰기 →" 버튼: chatId만으로 chat 페이지 재진입

**백엔드**
- `sessions.py`: 목록 조회 엔드포인트 추가 (`world_title` selectinload)
- `schemas/session.py`: `SessionListItem` 스키마 추가
- `config.py`: `.env` 경로를 절대경로로 수정 (uvicorn 실행 위치 무관하게 동작)

**API 경로 정리**
- `chatApi.js` / `worldviewApi.js` 모두 상대경로 `/api/v1` 로 통일 → Vite 프록시 경유, CORS 해결
- `vite.config.js`가 `VITE_API_BASE_URL` 읽어 프록시 타겟 동적 설정 (로컬/ngrok 자동 전환)

**UI 개선**
- 메모 패널 토글 버튼 소형화 (36px 높이 버튼, 호버 보라색 강조)
- 메인 페이지 "내 소설 목록 →" 버튼 추가
- HoverVideo AbortError 콘솔 노이즈 수정 (`if (err.name === 'AbortError') return`)

**dev 브랜치 머지**
- 팀원 변경사항 반영: 작가 데이터 백엔드 API 연동, worldview 스텝 대화 형식 UI, 카드 호버 전체화면 효과
- 충돌 해결: main.jsx(AbortError 수정 유지), worldview.jsx(chatId: sessionId navigate 유지)

### 이슈 / 막힌 점
- **Gemini API 키 오류**: `.env` 키 형식 오류 → 신규 발급으로 해결
- **config.py `.env` 경로**: uvicorn을 프로젝트 루트에서 실행하면 `backend/.env`를 못 찾는 문제 → 절대경로로 수정
- **worldviewApi.js 절대경로 CORS**: ngrok 원격 서버 전환 시 직접 요청으로 CORS 차단 → 상대경로로 통일
- **이어쓰기 채팅 이력 복원**: 미구현 (TODO) — session_id로 진입은 되나 이전 대화가 표시 안 됨

### 다음 할 일
- 이어쓰기 시 이전 대화 이력 복원 (`GET /sessions/{id}/dialogues` 조회 후 messages 초기값 설정)
- Gemini 응답 기반 소설 변환 구현 (현재 대화 로그 원문 저장)

---

## 2026-06-05

### 오늘 한 일
- dev 브랜치 최신화 (PostgreSQL 통합, llm_router, personas 업데이트 반영)
- `worlds.py` / `characters.py` MongoDB → PostgreSQL(SQLAlchemy) 재작성
  - dev에서 팀원 PostgreSQL 통합 완료 후 최종 dev 버전으로 교체
- CORS 설정 수정 (`config.py`)
  - 기본값 `["*"]` 으로 변경 — 팀원 간 다른 localhost 포트 충돌 해결
- 채팅 API 경로 구조 정리
  - `backend/app/api/chats.py` → `backend/app/api/v1/endpoints/chats.py` 이동
  - `main.py` 직접 등록 → `v1/router.py` 통합 등록으로 변경
  - 엔드포인트 경로: `/api/chats/...` → `/api/v1/chats/...`
- `chatApi.js` API URL 통일
  - `/api` (Vite 프록시 상대경로) → `${import.meta.env.VITE_API_BASE_URL}api/v1` (worldviewApi.js와 동일)
- MongoDB 관련 설정 제거 (dev 머지로 `config.py`에서 MongoDB 항목 삭제됨)

### 이슈 / 막힌 점
- **CORS 차단**: 팀원 ngrok 서버가 `localhost:5175` 출처를 막음 → `ALLOWED_ORIGINS=["*"]` 로 해결 (push 완료, 팀원 pull 대기 중)
- **채팅 응답 없음**: Gemini API 키 형식 오류 의심 (`AQ.Ab8...` → `AIzaSy...` 형식이어야 함), 팀원 서버의 Redis 미실행 상태 → Upstash 클라우드 Redis 사용 권장
- **저장 실패**: PostgreSQL 코드 push 완료했으나 팀원 서버 미반영 상태로 당일 테스트 미완료
- MongoDB → PostgreSQL 전환 과정에서 `worlds.py`/`characters.py` 중간에 두 차례 재작성

### 내일 할 일
- 팀원 서버 pull + 재시작 후 worldview 저장 / 채팅 응답 통합 테스트
- Gemini API 키 유효성 확인 (팀원과 공유)
- Redis 미실행 문제 → Upstash 적용 여부 결정

---

## 2026-06-04

### 오늘 한 일
- 프로젝트 루트에 conda 가상환경 구성 (Python 3.11, `.venv/`)
- 프론트엔드 구조 파악 및 페이지 추가
  - `/write` 라우트 및 페이지 골격 생성
  - `/chat` 라우트 및 채팅 UI 구현
- 채팅 UI 설계 (`pages/chat/ui.jsx`)
  - 말풍선 컴포넌트 (캐릭터/유저 구분, 이름 뱃지)
  - 작가 메모 사이드 패널 (슬라이드 토글 — `<` / `>` 버튼)
  - SSE 스트리밍 수신 및 실시간 렌더링
  - 대사(`"..."`) 앞뒤 자동 줄바꿈 포맷팅
- API 클라이언트 구성 (`src/lib/chatApi.js`)
  - `sendMessage` / `connectChatStream` 분리
  - `VITE_API_BASE_URL` 환경변수로 백엔드 교체 대응
- Vite 프록시 설정 (`vite.config.js`)
  - CORS 우회 — 브라우저 요청을 Vite가 백엔드로 중계
  - ngrok 브라우저 경고 헤더(`ngrok-skip-browser-warning`) 자동 추가
- 백엔드 연동 테스트
  - ngrok URL 연결 → FastAPI SSE 스트리밍 수신 확인
  - Gemini 2.5 Flash 임시 연결 테스트 (응답 정상 수신)
- 개인 문서 관리 (`frontend/pge_doc/`, gitignore 처리)
  - `project-spec.md` — 레포 실제 구성 기준으로 스펙 정리
  - `issue.md` — 프론트/백엔드 페르소나 이름 불일치 이슈 기록
  - `gemini-test-snippet.py` — Gemini 테스트 코드 보관

### 이슈 / 막힌 점
- ~~프론트-백엔드 페르소나 이름 불일치~~ → **해결** (2026-06-04): 프론트 기준 확정 — 백야·차로운·한여름·김도현, 백엔드 반영 완료
- ngrok free tier 브라우저 경고로 인해 SSE Content-Type이 `text/plain`으로 오는 현상 → Vite 프록시 헤더 추가로 해결
- FastAPI 로컬 실행 시 `asyncpg` / `sentence-transformers` 미설치 → 필요 패키지만 선별 설치로 해결

### 내일 할 일
- 채팅 UI 고도화 (작가 선택 → 채팅 페이지 연결 플로우)
- 기본 흐름 구현
  1. 사용자 입력
  2. DB 최근 대화 조회
  3. 프롬프트 생성
  4. Gemini 호출
  5. 응답 저장
