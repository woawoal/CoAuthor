<!-- markdownlint-disable MD024 -->
# jyj 개발일지

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

- Redis 세션 컨텍스트 캐시 구현
- 프롬프트 조립 함수 작성 (세계관 + 캐릭터 + 사건요약 + 최근 대화)
- `chats.py` DB/Redis 연동 업데이트
- `.env.example` GEMINI_API_KEY 항목 추가
- GitHub 브랜치 보호 규칙 설정 (dev 브랜치)

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
