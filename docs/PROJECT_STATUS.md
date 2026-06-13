<!-- markdownlint-disable MD022 MD032 MD031 MD036 MD060 MD040 -->
# NodeVelture 프로젝트 현황

> 최종 갱신: 2026-06-09 (2주차) — **핵심 경로(작가선택→세계관→채팅→소설변환→읽기) E2E 동작**
> Node + Novel + Adventure — AI와 함께 세계관을 만들고, 그 세계관 속 등장인물이 되어 소설을 완성하는 협업 창작 플랫폼

분야(백엔드 / 프론트엔드 / AI)별로 **현재 진행상황과 다음 할 일**을 정리한 문서입니다.

---

## 1. 서비스 한눈에 보기

3단계 흐름으로 동작하는 창작 플랫폼:

```
1단계 세계관 설정     → AI(작가 페르소나)와 함께 장르/배경/등장인물 잡기
2단계 대화형 창작     → 사용자=주인공 / AI=조연들, 입력에 따라 이야기 분기
3단계 소설 변환       → 대화 로그를 소설 문체로 자동 변환
```

작가 페르소나 4명: **백야**(호러·미스터리) / **차로운**(추리) / **한여름**(로맨스) / **김도현**(일상·에세이)

마감: 2026-06-19. 1주차(6/2~6/8) / 2주차(6/9~6/15) / 마지막주(6/16~6/19)

---

## 2. 기술 스택 / 아키텍처 현황

| 영역 | 채택 기술 | 상태 |
|------|-----------|------|
| 프론트엔드 | React 19 + Vite + react-router-dom | main/worldview/intro/chat/chatlist/read 6페이지 |
| 백엔드 | FastAPI (Python 3.11, conda) | v1 API 완성, E2E 동작 |
| AI 엔진 | **Groq (Llama 3.3) 기본 + Gemini 토글** | `LLM_PROVIDER`로 전환 + 모델/키 폴백 (Groq 무료 한도 넉넉) |
| DB | **PostgreSQL only** + SQLAlchemy + Alembic | 통일 완료 (MongoDB 제거) |
| 캐시/세션 | Redis (도커 ↔ Upstash 클라우드 토글) | 프롬프트 컨텍스트 관리 동작 |
| 자체 모델 | Qwen2.5 (파인튜닝 예정) | 스텁만 존재 |
| 평가 | LLM-as-Judge (Gemini) | 구현됨 |
| 배포 | Render / Railway (예정) | 미착수 |

> ✅ **저장소 단일화 완료**: 기존 PostgreSQL/MongoDB/Redis 3중 구조 → **PostgreSQL(원본) + Redis(프롬프트 캐시)**로 정리됨 (강사님 6/5 스크럼 피드백 반영).

---

## 3. 분야별 현황 & 다음 할 일

### 🟦 백엔드 (jyj · 가연님)

**현재 (대부분 완료 ✅)**
- v1 CRUD API 완성: users / worlds / characters / sessions / dialogues / novels / authors / chats / **api_logs** (PostgreSQL)
- 채팅 본류(`chats.py`): Redis 컨텍스트 + AI 스트리밍 + 대화 PG 저장 (SSE `event: token`)
- **엔진 추상화 `services/llm.py`** — Groq↔Gemini 토글 + 모델/키 폴백 (llm_router·chats 모두 위임)
- **소설 변환 실연결** — `novels.py` → `generate_novel`, **작가 문체**(author_id→persona). E2E 검증
- **author_id 세션 저장** (마이그레이션 적용) + **API Log**(토큰/비용 기록·조회)
- **DB 포트 5433 이전**(네이티브 PostgreSQL 충돌 회피) + pool_pre_ping
- **E2E 스모크**(`scripts/e2e_smoke.py`) — 9단계 전 체인 통과
- 인프라: docker-compose, Redis 도커↔Upstash 토글, Alembic, ngrok, conda

**다음 할 일**
- [ ] **메모 백엔드 주입** (F-CH-11) — 프론트 mock → 세션 컨텍스트 주입 (가은님 합의)
- [ ] **AI 오프닝** (F-CH-04) — 비용 절약 위해 세계관 텍스트 기반 무료 템플릿
- [ ] 전역 에러 핸들링 미들웨어 — **가연님 담당**
- [ ] `/users/register` bcrypt 버그 (`bcrypt==4.0.1` 핀)
- [ ] 정리: `sync_to_db` 빈 스텁
- [ ] (후순위) JWT 인증, 배포(Dockerfile/Render)

### 🟩 프론트엔드 (가은님 · 건혁님)

**현재 (전체 플로우 연결됨 ✅)**
- 6페이지: **main**(작가선택+테마) / **worldview**(세계관 폼) / intro / **chat** / **chatlist** / **read**(소설 읽기)
- 작가 4인 디자인·자기소개 영상, 작가별 테마(data-author)
- 채팅 UI: 말풍선, 메모 패널(*mock*), SSE 실시간 렌더, DB 세계관/캐릭터 연동, **대화 이어쓰기 복원**(getDialogues)
- **소설 읽기 화면**: 챕터 목차·글자크기·북마크·**txt 내보내기**·진행률
- API 클라이언트 4종(chatApi/worldviewApi/authorsApi/apiBase), Vite 프록시

**다음 할 일**
- [ ] 메모 실제 전송 (백엔드 주입과 연동)
- [ ] read 페이지 footer 작가명 — `world.title` → `session.author_id` 매핑(한여름 등)
- [ ] 알림/컨펌 공통 컴포넌트
- [ ] (선택) AI 오프닝 상황 표시

### 🟪 AI 엔지니어 (동완님-프롬프트)

**현재**
- **Groq(Llama 3.3) 연동** — 무료 한도 넉넉, 쿼터 스트레스 해소 (Gemini 무료 20/day 한계로 전환)
- 페르소나 프롬프트 4종(`core/personas.py`) — WORLD/CHARACTER RULE + GUARD RAIL + FEW-SHOT + 대사/속마음/서술 입력형식 규칙, 실사용
- **작가별 문체 소설 변환**(`build_novel_system`) — author_id→persona 연동
- LLM-as-Judge 구현(`model/evaluation/llm_judge.py`) — 페르소나 일관성 채점 (목표 4.0)
- 파인튜닝(`model/finetune/train.py`) — Qwen2.5-1.5B 타겟, Trainer 미구현 스텁
- ✅ 런타임 프롬프트 3종을 `core/personas.py`로 통합 (1-1 세계관 / 1-2 대화 / 1-3 초안) + 죽은 `model/prompts/system_prompts.py` 정리 — [프롬프트 설계](프롬프트_설계.md)

**다음 할 일 (2주차)**
- [ ] **🔥 세계관 일관성 RAG (장기 기억)** — 차별점 (메모·이전 설정을 검색·주입해 일관성 유지, 제미나이 설정붕괴 보완 / RAG-lite 우선)
- [ ] 등장인물 모드 프롬프트 강화 (조연 여러 명 동시 반응)
- [ ] 소설 변환 전용 프롬프트 품질
- [ ] LLM-as-Judge로 4명 프롬프트 일관성 측정 → 개선 루프
- [ ] 모델 학습 필요성 재검토 — 강사님 "상용 API OK"로 완화돼 자체모델 우선순위 하락 가능
- [x] system_prompts.py 깨진 참조 정리 + 런타임 프롬프트 personas.py로 통합 (완료)

---

## 4. 핵심 리스크 (분야 가로지름)

| 리스크 | 내용 | 대응 |
|--------|------|------|
| **RAG 부재** | 차별점 "세계관 일관성 RAG(장기 기억)" 미구현. 발표 차별점인데 코드 없음 | RAG-lite 우선, 여유 시 pgvector |
| **메모 미연결** | 프론트 메모가 mock — AI에 안 들어감. "작가 기능" 차별점 미완 | 백엔드 컨텍스트 주입 연결 (가은님 합의) |
| **자체 모델 미착수** | train.py 스텁, 강사님 API 허용으로 우선순위 하락 | 발표 비중 결정 필요 |
| **register bcrypt 버그** | passlib+bcrypt 충돌로 회원가입 막힘 (인증 후순위) | `bcrypt==4.0.1` 핀 |

> ✅ **해소됨**: AI 쿼터 지옥(Gemini 20/day → **Groq 무료**) · 채팅 경로 이원화(→ `llm.py`로 통합) · 소설 변환 스텁(→ 실연결) · DB 포트 충돌(→ 5433)

---

## 5. 발표 차별점 방어 논리 (6/8 확정)

> "ChatGPT/제미나이에 채팅하는 것과 뭐가 다른가" → 발표 때 반드시 나올 질문

1. **사용자가 1인칭 주인공으로 이야기에 들어감** — "지시하는 도구"가 아니라 "들어가는 무대"
2. **작가 페르소나와 협업 + 대화 → 소설 자동 변환** (결과물이 남음)
3. **세계관 일관성 RAG (장기 기억)** — 긴 이야기에서 설정이 안 무너짐
4. (확장) 동기부여 시스템 / 삽화 자동 생성

> ※ 6/2 스크럼의 "캐릭터별 비밀정보 분리(서로 모르는 상태)"는 추리극 오해 기반이라 채택 안 함 — [scrum.md](dev-logs/scrum.md) 참고

---

## 6. 참고 문서
- **기능정의서**: [docs/기능정의서.md](기능정의서.md) (·[발표용 html](기능정의서.html))
- **사용자 시나리오**: [docs/사용자_시나리오.md](사용자_시나리오.md)
- 프롬프트 설계: [docs/프롬프트_설계.md](프롬프트_설계.md) · 문체모델: [docs/문체모델_연동_설계.md](문체모델_연동_설계.md)
- 기획서: [docs/planning/NodeVelture.md](planning/NodeVelture.md)
- 페르소나 카드: [docs/personas/persona_cards.md](personas/persona_cards.md)
- 강사님 스크럼 기록: [docs/dev-logs/scrum.md](dev-logs/scrum.md)
- 백엔드 상세: [backend/docs/](../backend/docs/) (architecture / api / models / setup / coding-rules)
- 백엔드 실행 가이드: [backend/docs/setup.md](../backend/docs/setup.md)
- 개발일지: [docs/dev-logs/](dev-logs/)
