<!-- markdownlint-disable MD024 -->
# jyj 개발일지

---

## 2026-06-09

### 작업 내역

#### RAG 3종 구축 (핵심 차별점 — "ChatGPT와 뭐가 다르냐"의 답)

- **세계관 일관성 RAG (F-CH-10)** — 강사님 16:00 "RAG 없으면 차별점 없다"에 정면 대응
  - 누적 요약: `services/memory.py` — N턴마다 이전 요약+최근 대화만 증분 요약해 `story_summary`에 누적(토큰 절약)
  - 세계관·등장인물 주입: `chats.py _build_world_context` — 세션→세계관·캐릭터·줄거리를 프롬프트에 자동 주입
  - **의미 검색**: `llm.embed`(Gemini `gemini-embedding-001`) + `memory.retrieve_relevant`(코사인 top-K) — 오래된 대화를 검색해 보강. **6턴 전 비밀("민준=잠입 형사")을 정확히 회상** 검증
- **설정 일관성 검수 (F-QC-01)** — `services/consistency.py`. 확립된 설정·기억과 새 응답을 LLM(JSON 모드)으로 대조해 모순 탐지. **형사↔의사 모순 탐지 / 정상 통과** 검증
- **문체 RAG (F-NV-08)** — `services/style.py` + `data/style_samples.json`(작가당 12개). 장면과 가까운 작가 문체 예시를 few-shot으로 주입. `use_style` 토글 + 3회 평균 채점 시 **ON > OFF(+1.0점)** 검증

#### 채팅 응답 안정화 (가은님 구조화 버전 머지 대응)

- `event:token` 스트리밍 → **narration/dialogue JSON 구조화**(가은님 #49)로 정합. `llm.generate(json_mode=True)`로 **유효 JSON 강제**(Groq `response_format` / Gemini `response_mime_type`)
- `parse_ai_response` 견고화 — 깨진 JSON·`null` 값 폴백 처리(슬라이싱 크래시 수정)
- **출력 한국어 강제** 프롬프트 추가 (Groq Llama 한자/일본어 누수 완화)

#### 백엔드 기능 (jyj 백로그 일괄)

- **F-CH-11** 작가 메모 백엔드 — `POST /chats/{id}/memo` → 프롬프트 `[작가 메모]` 주입 (+ 조회/삭제)
- **F-AS-01/03** 어시스턴트 — `GET /chats/{id}/suggest` 다음 전개·막힘 도움 3개 제안
- **F-SY-09** 토큰 분석 — `/api-logs`에 `by-model`·`session/{id}` 집계 추가(기존 summary·total + 세션·모델별 완성)
- **F-SY-10** 토큰 절약 — 프롬프트 verbatim 대화를 최근 10턴으로 제한(그 이전은 요약+RAG가 커버)
- **F-EV-06** 근거 리포트 측정 — `services/evaluate.py`(LLM-judge 4축 채점) + `scripts/evidence_report.py`(맨손 vs 우리)

#### 시연 · 문서

- 시연 데모 3종: `scripts/rag_demo.py`(기억) · `consistency_demo.py`(검수) · `style_demo.py`(문체 off/on 평균)
- **`docs/rag/성능지표.md`** — RAG 3종 켰을 때/껐을 때 실측 결과 (발표 근거)
- `기능정의서.md`/`업무분담.md` 상태 갱신, **scrum 16:00 강사님 피드백** 기록
- **서비스 방향 확정**: "진지한 창작 도구(척추) + 엔터테인먼트(껍데기)", 다리 = "캐릭터랑 놀듯 대화 → 진짜 내 소설"

#### 인프라

- **Neon 클라우드 DB 전환** — `.env` `DATABASE_URL`을 Neon으로(로컬은 주석 보존). `database.py _prepare_db_url`이 `postgresql://...?sslmode=require` → **asyncpg + SSL 자동 변환**
- `psycopg2-binary` 설치 (alembic 마이그레이션 sync 경로용)

### 이슈

- **Groq Llama 언어 누수** — 한자·일본어가 산발적으로 섞임. 프롬프트로 빈도는 줄지만 박멸 안 됨 → **GPT 전환이 근본 해결**(엔진은 `.env` 한 줄로 전환 가능)
- **F-EV-06 단일 회차 노이즈** — 다회 평균 필요. 짧은 시나리오는 RAG '기억' 강점이 안 드러나 맨손과 비슷하게 나옴 → 긴 시나리오+GPT 필요
- **requirements.txt psycopg2 미반영** — 가연님 dev 브랜치엔 있으나 feature/jyj엔 아직 → pull 필요
- **Neon 라이브 검증 대기** — `e2e_smoke`로 직접 확인 예정(공용 DB라 마이그레이션은 가연님 영역)

### 다음 할 일

- GPT vs Gemini 엔진 결정(가은님 비교) → 언어 누수·품질 개선
- 프론트 연결: 메모 패널·제안 버튼(가은님), 토큰 대시보드 화면(건혁님)
- Neon e2e 검증 + 필요 시 마이그레이션(가연님)
- 근거 리포트를 GPT·긴 시나리오·다회 평균으로 신뢰값 산출

---

## 2026-06-08

### 작업 내역

#### 인프라 / DB 트러블슈팅 (가장 큰 건)

- **DB 커넥션 간헐 끊김(`ConnectionResetError`/`ConnectionDoesNotExistError`) 원인 규명** — Windows 네이티브 **PostgreSQL 17**이 5432를 도커 컨테이너와 **동시 점유** → 연결이 오락가락 리셋되던 것
  - 해결: 도커 호스트 포트를 **5433**으로 이전(`docker-compose.yml`), `.env` `DATABASE_URL` 5433으로, `migrations/env.py`가 alembic.ini 하드코딩 대신 **`.env`의 DATABASE_URL을 단일 소스로** 쓰도록 수정
  - `database.py` 엔진에 `pool_pre_ping`/`pool_recycle` 추가(끊긴 커넥션 자동 복원)
- **빈 DB → `alembic upgrade head`로 테이블 8종 생성**, 프론트용 더미 유저(`00000000-…-001`) 시드
- **`setup.md` conda 기준 전면 정리** + ngrok 고정 도메인 팀 공유 가이드 / **GitHub CLI 설치**
- 서버 운영·트러블슈팅 문서 `backend/docs/server-ops.md` 신설 (DB 끊김/컨테이너 종료 진단법)

#### E2E 검증 + 소설 변환 실연결

- **백엔드 E2E 스모크 스크립트(`scripts/e2e_smoke.py`)** 작성 — 유저→세계관→캐릭터→세션→메시지→AI 스트리밍→채팅종료→소설변환 전 체인을 인프로세스(TestClient)로 검증, **9단계 전부 통과**
- **소설 변환 실연결(F-NV-02)** — `novels.py` 플레이스홀더 → `LLMRouter.generate_novel` 연결 (세계관 주입 + LLM 실패 시 폴백). 실제 소설 문체 변환 확인

#### 프롬프트 정리

- 런타임 프롬프트 3종(세계관/대화/초안)을 `core/personas.py`로 통합, 죽은 `model/prompts/system_prompts.py` 포인터화
- 이후 동완님이 personas.py를 리치 버전(character 모드·입력형식 규칙·novel_style)으로 보강 → llm_router도 새 시그니처에 맞게 정합 확인

#### 기획 / 문서

- 현황·시나리오 문서 정비: `PROJECT_STATUS.md` 최신화, **`사용자_시나리오.md`**(작가선택→세계관폼→채팅[AI가 대사/나레이션 자동구분]→채팅종료→소설변환, 사용자=주인공 고정) 확정, **`기능정의서.md`/`.html`**(발표용), **`문체모델_연동_설계.md`**, **`프롬프트_설계.md`**
- **강사님 스크럼 기록 `scrum.md`** 정리(6/1·6/2·6/4·6/5·6/8). 팀 결정 반영: **RAG = "세계관 일관성(장기 기억)"으로 재정의**(추리극 오해 기반 "캐릭터별 비밀정보 분리"는 채택 안 함), 타겟 2030 취미 창작러

### 이슈

- **Gemini 429 쿼터 소진** — 하루 테스트/시연 누적으로 무료 한도 초과. AI 생성이 폴백으로 떨어짐 → 새 키 또는 리셋 대기 필요
- **`/users/register` 깨짐** — passlib+bcrypt 버전 충돌(`password cannot be longer than 72 bytes`). 인증 후순위라 E2E에선 유저 직접 삽입으로 우회 (`bcrypt==4.0.1` 핀으로 해결 가능)
- **브랜치 사고** — 옛 로컬 `dev`(origin/dev보다 70커밋 뒤) 체크아웃으로 워킹트리가 옛 상태로 보임 + Vite가 mp4 잠금으로 체크아웃 막힘 → Vite 종료 후 `feature/jyj` 복귀, **작업 무손실**

### 다음 할 일

- **AI 오프닝**: AI 호출(비용) 대신 **세계관 setting 텍스트 기반 무료 템플릿**으로 (프론트가 표시, 백엔드 추가 호출 없음)
- **메모 → 프롬프트 주입(P0)**: 프론트(가은님) 메모가 현재 mock → 실제 전송 + 백엔드 컨텍스트 합치기 (합의 필요)
- **소설 footer 작가명**: Session에 `author_id`(persona) 저장 필요 — 현재 작가 선택이 백엔드에 미저장 (footer가 작가명 못 찾음)
- 전역 에러 핸들링 미들웨어 → **가연님** 담당
- 작가별 문체 소설 변환 주입(persona_id 연동), RAG(세계관 일관성) 검토

---

## 2026-06-05

### 작업 내역

#### 팀 PR 통합 및 검증

- `origin/dev` 머지로 팀원 작업 수신 (PR #11/#12/#13 → 이후 #14 ygh)
- 팀 PR 검증 후 머지: **#16**(worlds/characters → MongoDB 연동), **#18**(llm_router·llm_judge·personas·coaching·dialogues), **#19**(chats.py에 Redis 캐시 + MongoDB 영구저장·임베딩 결합), **#20**(README 최신화)
- 머지 검증 노하우 정립: `dev..feature` diff가 "내 작업을 삭제하는 것처럼 보이는 착시"는 옛 base에서 분기해서 생기는 것 → `git merge-tree --write-tree`로 **실제 머지 결과 트리**를 까서 보존/호환 확인
- #19로 대화 로그가 Mongo에 임베딩과 함께 적재되기 시작 (RAG 데이터 적재의 빠진 조각)

#### DB / 인프라

- **MongoDB Atlas 연결** (`.env`의 `MONGODB_URL`) — 로컬 Mongo 컨테이너 불필요
- DB 역할 정리: 정형(User/World/Character/Session/Novel) → **PostgreSQL**, 비정형(대화+임베딩) → **MongoDB**, 프롬프트 캐시 → **Redis**
- **팀 결정: PostgreSQL only로 통일** (강사님 스크럼 피드백 반영, 가연님이 연결구조 전면 수정 예정) → RAG 임베딩은 **pgvector**로 가야 함
- Docker Desktop WSL 엔진 미기동 → **Redis를 Upstash(클라우드)로 우회**, 도커 없이 해결

#### 서버 실행 환경

- conda(`nodevelture`, py3.11) 환경 확정, `python -m uvicorn`으로 환경 일치시켜 기동 (전역 py3.13 uvicorn 잘못 잡히던 문제 해결)
- `.env` 변경 시 서버 재시작 필수 확인 (`--reload`는 `.env` 미감시)

#### AI 모델 설계 검토

- 파인튜닝 베이스 모델 후보 정리(Qwen2.5-7B-Instruct 등) → 유득님께 설계 요청
- 유득님 설계서 피드백 작성: PERSO 텍스트생성 불가(→Gemini로 정정), GPU 서빙 위치 명시 필요, mode 체계 불일치(collab/coach/compare vs 코드의 author/character), persona_id 철자(kimdohyeon), 창작 태스크 캐싱 주의

#### RAG 방향 정리

- RAG = **장기 기억(일관성)**용. 3단 기억 구조(최근 대화 Redis + 누적 요약 + RAG 검색)
- 적재는 #19로 시작됨, **검색을 chats.py `build_prompt`에 연결**하는 게 다음 스텝

### 이슈

- 워킹 트리가 옛 dev 상태로 되돌아간 사고(파일 삭제·chats.py 옛버전) → HEAD는 멀쩡, `git restore`로 복구. 원인은 잘못된 checkout
- `ygh_devlog.md` 빈 파일 = ygh PR이 dev에 머지되기 *전*의 dev를 받았던 타이밍 문제 → 재머지로 해결
- `REDIS_URL`에 `REDIS_URL=` 중복 입력 → Redis scheme 에러 → 제거 후 Upstash 연결 확인
- Docker Desktop WSL 엔진 미기동 (도커 우회로 진행)

### 다음 할 일

- 가연님 PostgreSQL-only 연결구조 변경 반영 후 통합
- RAG 검색을 chats.py `build_prompt`에 연결 (+ pgvector 검토)
- 유득님 설계서 회신 반영 (PERSO→Gemini, GPU 위치, mode 통일)
- 채팅 E2E 완주 (`POST messages` → `GET stream`)
- 잔여 정리: 죽은 스텁(`routes/chat`·`coaching`·`compare`), README의 PERSO 잔여 언급

---

## 2026-06-04

### 작업 내역

#### 환경 설정

- Python 3.13 호환 문제 발견 → Python 3.11로 venv 재생성
- conda 가상환경으로 팀 통일 (conda create -n nodevelture python=3.11)
- ngrok으로 로컬 서버 외부 공유 → 프론트엔드 팀원 연결 성공

#### 백엔드 구현

- Chat API 신규 구현 (`app/api/chats.py`)
  - `POST /api/chats/{chatId}/messages` — 사용자 메시지 수신
  - `GET /api/chats/{chatId}/stream` — SSE 스트리밍 (event: token / done)

- Gemini 2.5 Flash API 연결 완료 → 실제 AI 응답 동작 확인

- `personas.py` PERSO API 프롬프트 템플릿 구조로 전환

- `.env` 파일 생성, `GEMINI_API_KEY` 추가

- `.env.example` 실제 값 제거 (구조만 표기)

#### PR 관리

- PR #5 pytest 실패 원인 분석: docs 커밋에서 main.py 등 4개 파일 실수 삭제 → 복원 커밋
- PR #8 (Chat API + Gemini 연결) 머지
- PR #10 (DB 모델 수정 - 팀회의 결과 반영) 검토 및 머지 승인

#### 팀 회의 / 설계

- 사용자 시나리오 확정: 작가 선택 → 세계관 설정 → 작가모드/등장인물모드 채팅 → 소설 변환

- DB 모델 수정 사항 정리 (가연님 전달)
  - Character: user_id 추가, background/appearance → prompt 통합
  - User: email/password nullable
  - World: rules nullable

- DB/Redis 역할 분담 설계 확정
  - DB: 원본 저장소 (세계관, 사건, 대화로그, 호감도 등)
  - Redis: 프롬프트 조립용 임시 복사본 (최근 대화, 현재 상태, 캐릭터 캐시)
  - 5턴마다 Redis → DB 자동 동기화

#### PERSO API 확인

- 문서 검토 결과: 영상 번역/더빙 API로 텍스트 생성 불가
- 채팅 기능은 Gemini 유지, PERSO는 추후 TTS 용도로 검토

### 이슈

- Python 3.13에서 asyncpg, pydantic-core 빌드 실패 → 3.11로 해결
- PR #6 머지로 main.py MongoDB 버전 충돌 발생 → git restore로 해결
- Gemini 모델명 404 오류 (gemini-pro, gemini-1.5-flash) → list_models()로 확인 후 gemini-2.5-flash로 해결
- 브랜치 보호 규칙 미설정으로 팀원이 직접 머지 → GitHub Settings에서 규칙 설정 필요

### 다음 할 일

- 프롬프트 넣어서 채팅 답변 잘 나오는지 확인 (작가 4명 각각 테스트)
- `.env.example` GEMINI_API_KEY 항목 추가
- GitHub 브랜치 보호 규칙 설정 (dev 브랜치)

---

### 앞으로 해야 할 일 (전체 로드맵)

#### 이번 주 (1순위)

- [ ] 프롬프트 품질 테스트 및 개선 (백야/차로운/한여름/김도현 각각)
- [ ] 세계관 정보를 chat API에 연결 (world_context 프론트 → 백엔드)
- [ ] 전체 흐름 동작 확인 (작가 선택 → 세계관 설정 → 채팅 → 응답)
- [ ] 에러 핸들링 미들웨어 (전역 예외 처리)
- [ ] JWT 인증 구현 (로그인) ← 나중에

#### 다음 주 (2순위)

- [ ] Redis 세션 컨텍스트 캐시 구현
  - 최근 대화 N개 캐싱
  - 현재 세션 상태 저장
  - 캐릭터 정보 캐싱
- [ ] 프롬프트 조립 함수 작성 (세계관 + 캐릭터 + 사건요약 + 최근 대화)
- [ ] 5턴마다 Redis → DB 자동 동기화
- [ ] API Log 미들웨어 (토큰/비용 기록)
- [ ] 환경변수 스위칭 (Gemini ↔ PERSO 전환 구조)
- [ ] 프론트엔드 통합 테스트

#### 마지막 주 (3순위)

- [ ] Dockerfile 작성 (앱 컨테이너화)
- [ ] Render / Railway 배포
- [ ] README 실행 방법 업데이트
- [ ] 발표 자료 백엔드 파트 정리

---

## 2026-06-01

### 작업 내역

- 프로젝트 기획서 v1.1 검토 및 README 반영
  - 페르소나 이름 수정 (백야, 차로운, 한여름, 김도현)
  - 팀원 정보 업데이트
  - 캠프명 수정 (AI휴먼 캠프)

- GitHub 레포지토리 초기 세팅
  - 전체 폴더 구조 생성 (backend / frontend / model / data / docs)
  - `.gitignore`, `README.md` 작성
  - PR 템플릿 및 GitHub Actions CI (pytest) 추가
  - feature 브랜치 6개 생성 및 원격 push (jyj, ygy, pge, ygh, kdy, syd)
  - remote URL 레포 이름 변경 반영 (NodeVelture)

- docs/planning, docs/dev-logs 디렉터리 구조 확정

### 이슈

없음

### 다음 할 일

- 1주차 작업 분배 확인 및 각자 브랜치 작업 시작
- 페르소나 시스템 프롬프트 초안 작성
