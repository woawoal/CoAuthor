# pge 개발일지

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
