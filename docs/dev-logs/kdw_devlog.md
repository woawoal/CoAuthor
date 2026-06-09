
# 2025-06-08

## 오늘 한 일

- 페르소나 프롬프트 E2E 테스트 완료
  - 서버 로컬 실행 (`uvicorn`) + Swagger UI 동작 확인
  - `test_personas.py` 작성 — 4명 장르 비교 + 가드레일 테스트
  - 백야/차로운/한여름/김도현 전원 페르소나 톤 검증 완료
  - 가드레일 3케이스 전원 통과 (장르 이탈, 페르소나 파괴 시도)

- `backend/app/core/personas.py` 프롬프트 3종 통합
  - `build_world_prompt(persona_id)` 신규 구현
    - 주연/조연/엑스트라 구분 조언, 작가별 시각 반영, 친근한 톤
  - `get_author_prompt()` 보강
    - `mode="character"` 추가 — 세계관 속 등장인물로 대화
    - 입력 형식 규칙 3종 적용: `"대사"` / `'속마음'` / `*서술*`
    - 성격(character_personality) 기반 동적 반응, 고정 예시 제거
  - `build_novel_system(persona_id, world_context)` 신규 구현
    - 작가별 문체 주입 (novel_style)
    - 대사/속마음/서술 구분 규칙 포함
    - 초안 완성 후 세계관 추가 제안 블록 (중요도 높음/보통만 제안)
  - `_AUTHOR_PERSONALITY` 내부 딕셔너리 추가 — 성격/worldview_focus/novel_style 작가별 분리
  - 기존 `PERSONA_PROMPTS` / `get_author_prompt(mode="author")` 동작 유지

- 프롬프트 설계 문서(`docs/프롬프트_설계.md`) 검토 및 반영
  - `build_novel_system()`에 `persona_id` 파라미터 추가 (팀 합의)
  - `model/prompts/` 는 학습/실험 전용으로 분리 확인

## 이슈 / 막힌 점

- `google.generativeai` deprecated 경고 발생
  - `FutureWarning: All support for the google.generativeai package has ended`
  - `google.genai` 패키지로 교체 필요 — 데모 이후 작업 예정
- 가드레일 테스트 1차 시도 시 캐시 충돌로 응답 없음
  - 동일 session_id 재사용으로 Redis 히트 → 세션 ID 분리로 해결

## 내일 할 일

- `google.generativeai` → `google.genai` 패키지 교체
- 1-2 character 모드 E2E 테스트
- LLM-as-Judge 평가 루프 연동
- 소설 초안 변환 E2E 테스트 (`build_novel_system` 실제 호출)

---

# 2025-06-05

## 오늘 한 일

- `llm_router.py` 구현 완료
  - Gemini 2.5 Flash 실제 호출 연결 (협업/코칭/비교/소설변환 4개 모드)
  - PRIMARY → FALLBACK(gemini-1.5-flash) 자동 전환 로직
  - Redis 캐시 연동 (namespace별 분리)
  - `ContextManager` 연결 — RAG + 요약본 자동 주입

- `core/personas.py` 풀 프롬프트 버전으로 교체
  - 기존 단순 설명 → WORLD RULE + CHARACTER RULE + GUARD RAIL + FEW-SHOT 구조
  - `get_author_prompt()` 작가/등장인물 모드 분기 추가

- `api/v1/endpoints/dialogues.py` LLMRouter 실제 연결
  - 사용자 발화 저장 → RAG 검색 → Gemini 스트리밍 → AI 응답 MongoDB 저장
  - end-to-end 파이프라인 완성

- `schemas/coaching.py` 페르소나 ID 오타 수정
  - `baegil` → `baekya`, `charoi` → `charoun` 등 4개 전부 수정

- `model/evaluation/llm_judge.py` 구현 완료
  - Gemini 기반 LLM-as-Judge 단일/배치 평가 파이프라인
  - JSON 파싱 방어 (`re.sub` 방식), score 범위 검증(1~5), few-shot 채점 예시 추가
  - `datetime.utcnow()` deprecated → `datetime.now(timezone.utc)` 수정

- `model/prompts/system_prompts.py` 완성
  - 페르소나별 few-shot 예시 코드 내장 (작가당 5개, 모드별 분리)
  - 인메모리 캐시로 중복 프롬프트 조립 방지
  - `build_system_prompt(persona_id, mode, world_context)` 인터페이스 확정

- `services/context_manager.py` 신규 구현
  - 10턴마다 Gemini로 자동 요약 생성 → Redis 저장 (TTL 1시간)
  - 최근 10턴 히스토리 캐시 (TTL 10분)
  - `get_context()` — 요약 + 히스토리 + RAG 한번에 조합해서 반환

## 이슈 / 막힌 점

- `llm_router.py`의 `CacheService.get/set` 시그니처(namespace 인자 방식)가 기존 `cache.py` 구현과 맞는지 가연님 확인 필요
- `llm_judge.py`가 `backend/` 외부(`model/`)에 위치해 `app.core.config` import 시 CLI 실행할 때 sys.path 수동 설정 필요 — 추후 패키지 구조 정리 예정
- PERSO API 공식 문서가 외부 공개 안 됨 — API 키 수령 후 엔드포인트 확인 필요 (`perso_client.py` 주석 처리 중)

## 내일 할 일

- A/B 실험 스크립트 작성 (PERSO 단독 vs Gemini 하이브리드 비교)
- 테스트 시나리오 10~20개 작성 (일상/장르특화/엣지케이스/위험)
- `perso_personas.py` PERSO API 등록 테스트 (API 키 수령 시)
- `ContextManager` 단위 테스트 작성
