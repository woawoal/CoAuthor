<!-- markdownlint-disable MD022 MD032 MD031 MD036 MD060 MD040 -->
# NodeVelture 프로젝트 현황

> 최종 갱신: 2026-06-08 (1주차 마무리 / 2주차 진입)
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
| 프론트엔드 | React 19 + Vite + react-router-dom | 메인/세계관/채팅 페이지 구현 중 |
| 백엔드 | FastAPI (Python 3.11, conda) | v1 API 골격 완성 |
| AI 엔진 | **Gemini 2.5 Flash** (실연동) | 폴백: gemini-1.5-flash |
| DB | **PostgreSQL only** + SQLAlchemy + Alembic | 통일 완료 (MongoDB 제거) |
| 캐시/세션 | Redis (도커 ↔ Upstash 클라우드 토글) | 프롬프트 컨텍스트 관리 동작 |
| 자체 모델 | Qwen2.5 (파인튜닝 예정) | 스텁만 존재 |
| 평가 | LLM-as-Judge (Gemini) | 구현됨 |
| 배포 | Render / Railway (예정) | 미착수 |

> ✅ **저장소 단일화 완료**: 기존 PostgreSQL/MongoDB/Redis 3중 구조 → **PostgreSQL(원본) + Redis(프롬프트 캐시)**로 정리됨 (강사님 6/5 스크럼 피드백 반영).

---

## 3. 분야별 현황 & 다음 할 일

### 🟦 백엔드 (jyj · 가연님)

**현재**
- v1 CRUD API 완성: users / worlds / characters / sessions / dialogues / novels / authors / chats (PostgreSQL)
- 채팅 본류(`api/v1/endpoints/chats.py`): Redis 컨텍스트 + Gemini 스트리밍 + 대화 PG 저장 (SSE `event: token`)
- `services/llm_router.py`: Gemini 폴백(PRIMARY→FALLBACK)·캐싱 + `stream`/`coach`/`compare`/`generate_novel` 구현
- 작가 정보 API(`authors.py`): authors.json / questions.json 제공
- 인프라: docker-compose(pg+redis), Redis 도커↔Upstash 토글, Alembic, ngrok 공유, conda 통일

**다음 할 일 (2주차)**
- [ ] **chats.py ↔ LLMRouter 통합** + SSE 포맷 통일 (현재 chats.py는 LLMRouter 미사용·인라인 Gemini, 포맷 `event:token` vs `data:` 이원화)
- [ ] **소설 변환 실연결** — `novels.py` 플레이스홀더 → `LLMRouter.generate_novel`
- [ ] 전역 에러 핸들링 미들웨어
- [ ] API Log 미들웨어 (ApiLog 모델 미연결 — 토큰/비용/캐시히트율 기록)
- [ ] 정리: `sync_to_db` 빈 스텁, `main.py`의 미사용 `import app.database as db`
- [ ] (후순위) JWT 인증, 배포(Dockerfile/Render)

### 🟩 프론트엔드 (가은님 · 건혁님)

**현재**
- React+Vite 라우팅(main/worldview/chat), `/write`는 주석 처리
- 메인페이지, 작가 4인 디자인·자기소개 영상·아이콘/로고
- 세계관 페이지를 "작가와 대화형"으로 전환 중 (백야 완료, 나머지 3인 예정)
- 채팅 UI: 말풍선, 작가 메모 사이드패널, SSE 실시간 렌더, DB 세계관/캐릭터 연동
- API 클라이언트 3종(chatApi/worldviewApi/authorsApi), Vite 프록시(CORS 우회 + ngrok 헤더)

**다음 할 일 (2주차)**
- [ ] 나머지 작가 3인 세계관 페이지 대화형 적용 + 작가별 테마 색상
- [ ] 작가 선택 → 세계관 설정 → 채팅 전체 플로우 연결
- [ ] 알림/컨펌 공통 컴포넌트
- [ ] 소설 변환 결과(3단계) 화면
- [ ] 백엔드와 E2E 통합 테스트 (스트리밍·CORS)

### 🟪 AI 엔지니어 (동완님-프롬프트 · 유득님-모델)

**현재**
- 페르소나 프롬프트 4종 완성도 높음(`core/personas.py`) — WORLD/CHARACTER RULE + GUARD RAIL + FEW-SHOT, 실사용 중
- LLM-as-Judge 구현(`model/evaluation/llm_judge.py`) — Gemini로 페르소나 일관성 채점 (목표 평균 4.0)
- 파인튜닝(`model/finetune/train.py`) — Qwen2.5-1.5B 타겟, Trainer 미구현 스텁
- ✅ 런타임 프롬프트 3종을 `core/personas.py`로 통합 (1-1 세계관 / 1-2 대화 / 1-3 초안) + 죽은 `model/prompts/system_prompts.py` 정리 — [프롬프트 설계](프롬프트_설계.md)

**다음 할 일 (2주차)**
- [ ] **🔥 세계관 일관성 RAG (장기 기억)** — 차별점 (메모·이전 설정을 검색·주입해 일관성 유지, 제미나이 설정붕괴 보완 / RAG-lite 우선)
- [ ] 등장인물 모드 프롬프트 강화 (조연 여러 명 동시 반응)
- [ ] 소설 변환 전용 프롬프트 품질
- [ ] LLM-as-Judge로 4명 프롬프트 일관성 측정 → 개선 루프
- [ ] (유득님) 모델 학습 필요성 재검토 — 강사님 "상용 API OK"로 완화돼 자체모델 우선순위 하락 가능
- [x] system_prompts.py 깨진 참조 정리 + 런타임 프롬프트 personas.py로 통합 (완료)

---

## 4. 핵심 리스크 (분야 가로지름)

| 리스크 | 내용 | 대응 |
|--------|------|------|
| **RAG 부재** | 차별점 "세계관 일관성 RAG(장기 기억)"가 MongoDB 제거로 사라짐. 발표 차별점인데 구현 없음 | RAG-lite 우선, 여유 시 pgvector |
| **채팅 경로 이원화** | chats.py(인라인 Gemini) vs LLMRouter, SSE 포맷도 `event:token`/`data:`로 다름 | 통합 + 포맷 통일 |
| **Gemini API 키 형식** | `AIzaSy...` 형식 확인 필요 (pge 일지) | 키 유효성 점검 |
| **자체 모델 미착수** | train.py 스텁, 강사님 API 허용으로 우선순위 하락 | 발표 비중 결정 필요 |

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
- 기획서: [docs/planning/NodeVelture.md](planning/NodeVelture.md)
- 페르소나 카드: [docs/personas/persona_cards.md](personas/persona_cards.md)
- 강사님 스크럼 기록: [docs/dev-logs/scrum.md](dev-logs/scrum.md)
- 백엔드 상세: [backend/docs/](../backend/docs/) (architecture / api / models / setup / coding-rules)
- 백엔드 실행 가이드: [backend/docs/setup.md](../backend/docs/setup.md)
- 개발일지: [docs/dev-logs/](dev-logs/)
