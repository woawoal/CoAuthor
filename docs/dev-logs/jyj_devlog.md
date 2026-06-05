<!-- markdownlint-disable MD024 -->
# jyj 개발일지

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
