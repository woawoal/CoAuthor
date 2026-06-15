# pge 개발일지

---

## 2026-06-15

### 오늘 한 일

**주인공 대사 추천 기능 완성 (protagonist_dialogue)**
- 목표: `@박지훈: 박지훈이 대답했다` 입력 시 AI가 박지훈 대사 추천 + 오유리 반응을 한 번에 생성
- `story.py` `OUTPUT_RULES` JSON 스키마에 `protagonist_dialogue` 필드 추가 → AI가 필드를 인지하게 됨
- `chats.py` `_build_messages()`:
  - `is_protagonist_speaker` 조기 계산 (protagonist_rule 빌드 전)
  - 주인공 발화 턴: `protagonist_rule`을 "protagonist_dialogue에 대사 생성, speaker는 AI 캐릭터" 지시로 분기
  - `[화자 지정]` 컨텍스트 주인공 발화 턴에서 스킵 (충돌 방지)
- outer scope `_is_protagonist_speaker` 변수 추출 (generate 클로저에서 재사용)
- 폴백 보정: AI가 `protagonist_dialogue` 대신 `dialogue`에 넣었을 때 자동 이관 (`reply_speaker` 비어있는 경우)
- `reply_payload`에 `protagonist_dialogue` 필드 추가
- `chatApi.js` reply 이벤트에서 `speaker`, `protagonist_dialogue` 수신 추가
- `ui.jsx` `onMessage` 콜백에서 `protagonist_dialogue` 상태 반영
- `Bubble` 컴포넌트: `protagonist_dialogue` 있을 때 주인공 오른쪽 + AI 왼쪽 두 버블을 Fragment로 렌더
- `speakerIsProtagonist` fallback 유지 (AI 오응답 방어)

### 이슈 / 논의

- AI가 `protagonist_dialogue` 대신 `speaker: "박지훈"` + `dialogue`에 응답 → 시스템 프롬프트-유저 프롬프트 충돌이 원인, protagonist_rule 분기로 해결
- `@태그` 없이 "박지훈이 대답했다" 텍스트만으로 자동 감지 논의 → 오탐 우려 + 사용 빈도 낮아 일단 `@태그` 방식 유지
- 하드코딩 여부 확인: protagonist_name은 world_context에서 동적 추출 (`_extract_protagonist_name`) → 문제없음

---

## 2026-06-14

### 오늘 한 일

**Redis 다운 → 채팅 API 500 오류 해결**
- 증상: 모든 채팅 엔드포인트 500 에러
- 원인: Docker Desktop 재시작 후 Redis 컨테이너 자동 종료 (exited)
- 해결: `docker start redis`, 재발 방지로 `docker update --restart always redis` 권장

**참여형 → 집필형 전환 시 대화 내용 미반영 이슈 분석**
- 실제 원인: Redis 다운으로 대화 이력 저장 실패 (위 Redis 이슈와 동일)
- 추가 발견: 스트리밍 중 모드 전환 버튼 비활성화 안 됨 (race condition 가능성, 추후 개선 대상)

**소설 변환 내용 확장 방지**
- 문제: 참여형→집필형 변환 시 AI가 대화에 없는 새 장면·사건을 추가 생성
- `personas.py` `build_novel_system()` 프롬프트 수정:
  - "대화 로그에 있는 내용만 변환, 새로운 사건·묘사 추가 금지" 명시
  - 변환 규칙 5개로 구체화 (대화 내용만 / 의미 변경 금지 / 대사 유지 / 초안 수준)

**대화 블록 사이 줄바꿈 추가**
- `llm_router.py` 소설 변환 블록 구분자 `"\n"` → `"\n\n"` 변경 (사용자/AI 발화 블록 분리)

**집필형 → 참여형 전환 시 원고 블록 조건부 숨기기**
- 이전 채팅 이력이 있을 때 원고(importedNarration) 블록 표시 안 함
- `ui.jsx`: `{importedNarration && !loadingHistory && messages.length === 0 && (...)}`

**@등장인물 태그 — 말풍선 좌우 분리**
- `@조연B` 입력 시 `isSideChar: true` → 왼쪽 캐릭터 버블 + 이름 뱃지
- `@박지훈`(주인공) 입력 시 `isSideChar: false` → 오른쪽 유저 버블
  - `isSideChar = !!activeSpeaker && activeSpeaker.name !== protagonistName` 로 주인공 제외
- `sendMessage` 호출에 `speaker` 파라미터 추가 (백엔드 화자 지정용)
- `Bubble` 컴포넌트 `protagonistName` prop 추가, 3분기 렌더링 구조로 재설계

**speaker DB 컬럼 추가**
- `dialogues` 테이블에 `speaker TEXT NULLABLE` 컬럼 추가 (`dialogue.py` 모델)
- Alembic 마이그레이션 `l2m3n4o5p6q7_add_speaker_to_dialogues.py` 생성 및 적용
- 사용자 발화: `speaker=body.speaker`, AI 발화: `speaker=reply_speaker` 저장
- 히스토리 복원 시 `d.speaker` 기반 `isSideChar` 재계산

### 이슈 / 막힌 점
- `alembic` PATH 미등록 → `.venv/Scripts/alembic upgrade head` 직접 경로로 실행
- `is_protagonist_speaker` 체크 전 `protagonist_name` 추출 순서 문제 → 코드 구조 정리로 해결

---

## 2026-06-11

### 오늘 한 일

**작가 패널 UI 재설계**
- 패널 기본 열림 상태로 변경
- 태그 바 구성: `#세계관`, `#등장인물`, `#에피소드`, `#추천`
- `< 작가명 >` 헤더 바 제거 → 이미지 위 좌측 상단 오버레이로 이동 (테두리 없음)
- 메모 버튼 태그 바 오른쪽 끝으로 이동 (`margin-left: auto`), `#메모` 태그 제거
- `#세계관` / `#등장인물`: AI 채팅 대신 인라인 카드로 토글 표시 (상호 배타적)
- `#추천` 플로우: 작가별 인사말 → 사용자 자유 입력 → 지문/씬 등 키워드 감지 시 왼쪽 채팅 패널 추천 칩 자동 생성
- 주인공/작가 이름 뱃지를 나래이션 말풍선에서 제거
- AI 답변 말풍선 위에 `작가 [이름]` 레이블 표시
- 세계관 요약 메시지 메인 채팅에서 제거

**chatlist → storylist 전체 리네임**
- `pages/chatlist/` → `pages/storylist/` (파일명·클래스명 모두 `storylist-*`로 변경)
- `App.jsx` import·라우트, `chat/ui.jsx`, `read/read.jsx`, `editor/ui.jsx`, `main/main.jsx`, `main/main.css` 참조 전부 업데이트

**에디터 페이지 신규 구현 (`/editor`)**
- 왼쪽: 원고 textarea (serif 폰트, `padding: 32px 10%`, `line-height: 1.9`)
  - 자동 저장 2초 debounce → `PUT /api/v1/sessions/{id}/novel/draft`
  - 글자 수 표시, 저장 상태 표시 (`저장됨 / 저장 중... / 저장 안됨`)
- 오른쪽: 채팅 패널과 동일한 작가 AI 패널 재사용
- 자동 피드백 ON/OFF 토글 — ON 시 타이핑 3초 후 자동으로 최근 800자 원고 작가 AI에 전달
- `worldview.jsx` 집필 시작 → `/chat` 대신 `/editor`로 이동
- 백엔드 `novels.py`에 `PUT /{session_id}/novel/draft` upsert 엔드포인트 추가

**참여형 ↔ 집필형 모드 전환**
- **집필형 → 참여형**: 에디터 헤더 `← 참여형` 버튼 → 현재 원고를 `manuscriptContent`로 `/chat`에 전달 → 채팅 상단 serif 지문 블록으로 표시 + 구분선 아래 대화 이어가기
- **참여형 → 집필형**: 채팅 헤더 `집필형 →` 버튼 → `POST /sessions/{id}/novel/convert` 호출(LLM 변환) → `/editor` 이동
- `novels.py`에 `/convert` 엔드포인트 추가 — 세션 상태 제한 없음, 기존 draft upsert

**오른쪽 패널 chat/editor 동기화**
- 채팅 페이지에 자동 피드백 ON/OFF 토글 추가
- `handleFeedback`: 최근 대화 6개를 작가 AI에 전달
- 스트리밍 종료 후 2초 debounce로 자동 트리거 (ON 상태일 때)
- `.auto-feedback-bar` 등 CSS를 `chat/ui.css`로 이동 — editor가 chat CSS를 import하므로 한 곳에서 관리

**신규 백엔드 파일**
- `endpoints/author_chat.py`: 작가 AI 채팅 전용 엔드포인트
- `prompts/author.py`, `prompts/story.py`: 작가/스토리 프롬프트 분리
- `services/chat_context.py`: Redis 헬퍼 서비스 분리 (`get_context`, `append_history`, `update_state`, `key_*`)
- `chatApi.js`: `event: audio` SSE 핸들러 추가 (base64 → Blob → Audio 재생)

**작가 AI 채팅 — 작가 전환 시 스타일 격리**
- 문제: 히스토리 키가 `session:{id}:author_history` 하나로 공유 → 백야→차로운 전환 시 백야 답변 턴이 그대로 차로운 conversation에 포함돼 스타일 혼재
- 해결: 히스토리 키를 작가별 분리 `session:{id}:author_history:{author_id}`
- 작가 전환(첫 대화) 시 `get_prev_user_questions()` — 다른 작가들과 나눈 **사용자 메시지만** 추출(최근 5개) → 새 작가 시스템 프롬프트 `[이전 작가와 나눈 대화 맥락]` 섹션에 주입
- 결과: 이전 상황(무엇을 논의했는지)은 전달되고, 이전 작가 답변 스타일은 차단

**토큰 사용량 최적화**
- 구조 파악: verbatim 히스토리(PROMPT_HISTORY_LIMIT) + rolling summary(SUMMARY_CHAR_BUDGET) + RAG 3-layer 구조
- 요약 주기(DB_SYNC_INTERVAL): 5턴 → **3턴** — 오래된 대화가 더 빨리 요약으로 빠짐
- verbatim 창(PROMPT_HISTORY_LIMIT): 10턴 → **6턴** — 턴당 ~40% 절감
- 요약 상한(SUMMARY_CHAR_BUDGET): 800자 → **600자** — 요약 섹션 자체 압축
- 변경 파일: `services/chat_context.py`, `services/memory.py` (chats.py는 import 구조라 무수정)

**dev 머지 및 충돌 해결**
- `origin/dev #63` (Feature/ygy — ContextManager, voice profile, world tags 등) 머지
- `chats.py` 충돌: dev가 Redis 헬퍼를 inline 재정의했으나 우리 브랜치에서 `chat_context.py`로 분리했으므로 inline 정의 제거, `HTTPException` import만 추가 반영
- `feature/pge` → origin 푸시 완료

### 이슈 / 막힌 점
- `작가 정보를 불러오지 못했습니다` 오류 → 원인: `http://localhost:8000`(FastAPI 직접)으로 접속, `http://localhost:5173`(Vite 프록시)으로 접속해야 함
- dev `#63` 머지 시 `chats.py` 충돌 — Redis 헬퍼 중복 정의 제거로 해결

---

## 2026-06-10

### 오늘 한 일

**백엔드 LLM 호출 구조 통일**
- 스트리밍 방식 결정: 청크 SSE → **전체 응답 받기 → 단일 SSE** 방식으로 통일
  - 이유: `{narration, dialogue}` JSON 구조는 청크 스트리밍과 충돌 (파싱 불가)
  - 타이핑 효과는 프론트엔드에서 처리하는 것으로 결정
- `dialogues.py`: `LLMRouter.stream_character_response()` 제거 → `llm.generate()` 직접 호출
  - `summarize_history()` 인라인 처리
  - `AsyncSessionLocal` 내부 제너레이터 제거 → `db` 의존성으로 직접 commit
  - 단일 SSE 이벤트 `{"character": ..., "text": ..., "done": true}` 로 변경
- `novels.py`: `LLMRouter.generate_novel()` 제거 → `llm.generate()` + `build_novel_system()` 직접 호출

**프롬프트 모듈 구조 정리**
- `prompts/__init__.py` 내용 → `prompts/formatter.py` 로 이동 (역할 명확화)
- `__init__.py`는 re-export만 유지 (기존 import 호환)
- 역할 분리 확정:
  - `personas.py` — 작가 정체성 (누가 말하는가, 어떤 말투인가)
  - `formatter.py` — 응답 구조 + 조립 (어떤 형식으로, 어떻게 조립하는가)
  - `chats.py` — API 흐름 (언제 호출하고 어디에 저장하는가)

**데이터 흐름 (확정)**
```
사용자 입력
  → formatter.build_messages()
      → personas.get_author_prompt()  [작가 스타일 주입]
      → 히스토리 + 컨텍스트 조립
  → llm.generate()                   [LLM 호출, 폴백/키로테이션 내부 처리]
  → formatter.parse_ai_response()    [JSON 파싱]
  → SSE event:reply {narration, dialogue}
```

**소설 읽기 페이지 — 작가 이름 버그 수정**
- 증상: `— 끝 —` 카드, 커버 뱃지, 사이드바 "AI 작가" 항목 모두 작가명 대신 **소설 제목(world.title)** 이 표시되었음
- 원인: `read.jsx`가 session을 state에 저장하지 않아 `session.author_id` 접근 불가 → `world?.title` 로 대체되어 있던 것
- 수정:
  - `AUTHOR_NAME` 맵 추가 (`{1:'백야', 2:'차로운', 3:'한여름', 4:'김도현'}`)
  - `session` 상태 추가 → `setSession(sessionData)` 저장
  - 3곳 모두 `AUTHOR_NAME[session?.author_id]` 로 교체 (커버 뱃지 / 사이드바 AI 작가 / 끝 카드)

**채팅 말풍선 UI 재설계 (dev 병합 반영)**
- narration: 말풍선 제거 → 이탤릭 텍스트(`.narration-text`)로 표시
- dialogue: 캐릭터 이름 badge + `.bubble--char` 말풍선 구조로 변경
- `.dialogue-block`, `.badge--author` CSS 추가

### 추후 정리 대상
- `LLMRouter` 클래스: `.coach()` / `.generate_all_personas()` / `.stream()` 아직 남아있음
  - `.stream()` — 더 이상 사용 안 함 (제거 대상)
  - `.coach()` / `.generate_all_personas()` — 코칭/비교 기능 엔드포인트에서 사용 중이면 유지, 아니면 제거

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

**dev 브랜치 재최신화 (2차)**
- `GIT_LFS_SKIP_SMUDGE=1` 설정 후 `feature/pge ← origin/dev` 머지 (LFS hang 방지)
- stash → merge → stash pop 순서로 진행, 충돌 없이 fast-forward 완료

**소설 읽기 페이지 (`/read/:storyId`) 구현**
- HTML 목업 기반으로 React 페이지 신규 생성 (`pages/read/read.jsx`, `read.css`)
- 기능: 사이드바 목차(TOC), 스크롤 진행률 바, 폰트 크기 조절(14-20px), 북마크 토글, txt 내보내기
- `parseChapters()`: 본문을 `\n\n` 기준 5단락씩 챕터로 분할, 자동 챕터 제목 생성
- `chatApi.js`에 `getNovel(sessionId)` 추가 (`GET /sessions/{id}/novel`)
- `chatlist.jsx`에 완료 세션 "읽기" 버튼 추가, `App.jsx`에 `/read/:storyId` 라우트 등록

**author_id 버그 수정 — 항상 백야가 표시되는 문제**
- 원인: `chatlist.handleResume`이 `authorId`를 navigate state에 미포함 → `AUTHOR_MAP[undefined]` → 기본값 백야
- 해결: `sessions` 테이블에 `author_id INTEGER` 컬럼 추가, 세션 생성 시 저장, 이어쓰기 진입 시 state로 전달
- Alembic 마이그레이션 `e1f2a3b4c5d6` 생성 및 적용 (`alembic upgrade head`)
- `worldviewApi.createWorldview`가 `authorId` 파라미터 받아 session POST body에 포함하도록 수정
- `schemas/session.py`: `SessionCreate` / `SessionResponse` / `SessionListItem`에 `author_id` 필드 추가

**이어쓰기 대화 이력 복원**
- `worldviewApi.js`에 `getDialogues(sessionId)` 추가 (`GET /sessions/{id}/dialogues/`)
- `chat/ui.jsx` 세션 로딩 useEffect에서 dialogues 조회 후 `messages` 초기값으로 복원
- `DialogueResponse.speaker_type` 기준으로 `user` / `character` 역할 분류

### 이슈 / 막힌 점
- **Gemini API 키 오류**: `.env` 키 형식 오류 → 신규 발급으로 해결
- **config.py `.env` 경로**: uvicorn을 프로젝트 루트에서 실행하면 `backend/.env`를 못 찾는 문제 → 절대경로로 수정
- **worldviewApi.js 절대경로 CORS**: ngrok 원격 서버 전환 시 직접 요청으로 CORS 차단 → 상대경로로 통일
- **채팅 페이지 항상 백야 표시**: `handleResume`에서 `authorId` 미전달 → `author_id` 컬럼 추가 + navigate state 전달로 해결
- **선택적 커밋**: `session.py`에 완성된 변경(author_id)과 미완성 변경(current_state, story_summary)이 혼재 → 미완성 부분 임시 제거 후 커밋, 재복원하는 방식으로 처리

### 다음 할 일
- Redis → DB 동기화 구현 (미완성 로컬 코드 존재)
  - `chats.py`: `get_context()` DB fallback, `sync_to_db()` (current_state/story_summary 백업)
  - `session.py` 모델에 `current_state`, `story_summary` 컬럼 추가 (마이그레이션 `d4e5f6a7b8c9` 포함)
  - state 자동감지 방법 결정 필요 (AI 응답에 `[STATE: ...]` 태그 삽입 방식 검토 중)
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
