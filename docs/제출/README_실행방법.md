# NodeVelture — 통합 실행 방법 (제출용)

> **AI 빙의작가** — 작가 캐릭터와 놀듯 대화하면 *내 소설*이 되는 협업 창작 서비스
> AI휴먼 캠프 4기 · 1팀

이 문서는 **평가자가 바로 따라 실행**할 수 있도록 정리한 통합 실행 가이드입니다.
서비스 개요·차별점·아키텍처는 [루트 README](../../README.md), 운영/트러블슈팅은 [server-ops.md](../../backend/docs/server-ops.md)를 참고하세요.

---

## 0. 가장 빠른 길 — 배포된 라이브 데모

설치 없이 바로 확인하려면 **배포본**을 쓰세요.

| 구분 | 주소 |
|---|---|
| **프론트(웹앱)** | https://node-velture.vercel.app/ |
| **백엔드 API** | `https://nodevelture-api-958641405309.us-central1.run.app/api` |
| 헬스체크 | `GET …run.app/health` → `{"status":"ok"}` |

- 로그인: 이메일 입력 → **OTP 코드**(Neon Auth) 인증
- 데모 시연 순서는 [데모_시나리오.md](../데모_시나리오.md), 테스트케이스는 [테스트케이스_종합_심야라디오.md](테스트케이스_종합_심야라디오.md) 참고

> 로컬에서 직접 띄워 평가하려면 아래 1~3장을 따르세요.

---

## 1. 사전 준비

| 항목 | 버전/비고 |
|---|---|
| Python | **3.11** (conda 권장) |
| Node.js | **18+** |
| PostgreSQL | **Neon**(클라우드, 권장) — 또는 로컬 Docker |
| Redis | **Upstash**(클라우드) — 또는 로컬 Docker(`docker-compose`) |
| LLM | **Vertex AI(ADC)** 또는 **Gemini / Groq / OpenAI API 키** 중 하나 이상 |
| (선택) ffmpeg | CER 측정 스크립트용 |

> DB/Redis는 클라우드 한 줄(URL)만 넣으면 가장 간단합니다. 로컬로 쓰려면 [4장](#4-로컬-dbredis-docker)을 보세요.

---

## 2. 백엔드 실행 (FastAPI · 포트 8000)

```bash
conda create -n nodevelture python=3.11 -y
conda activate nodevelture

cd backend
pip install -r requirements.txt
# (OpenAI 폴백까지 쓰려면) pip install -r requirements-openai.txt

cp .env.example .env          # 값 채우기 (아래 표 참고)
alembic upgrade head          # DB 테이블 마이그레이션
python -m uvicorn app.main:app --reload    # http://localhost:8000
```

### `backend/.env` 핵심 키

```dotenv
# ── DB / 캐시 ──
DATABASE_URL=postgresql://<user>:<pw>@<neon-host>/neondb?sslmode=require
REDIS_URL=redis://localhost:6379            # 또는 rediss://<upstash-url>
CACHE_TTL=3600

# ── LLM 엔진 ──
# (A) Vertex AI 사용 시 — 키 불필요, ADC 인증
USE_VERTEX=true
GOOGLE_CLOUD_PROJECT=<gcp-project-id>
GOOGLE_CLOUD_LOCATION=us-central1
# (B) API 키 사용 시 — 체인 앞에서부터 시도, 소진/실패 시 자동 승계
LLM_PROVIDER_CHAIN=groq,gemini              # 예) gemini / openai,gemini
GEMINI_API_KEY=AIzaSy...                     # aistudio.google.com
GROQ_API_KEY=gsk_...                          # console.groq.com
OPENAI_API_KEY=sk-...                         # 체인에 openai 넣을 때만

# 모델 (필요 시 교체)
GEMINI_MODEL=gemini-2.0-flash-lite
GROQ_MODEL=llama-3.3-70b-versatile

# 기타
SECRET_KEY=change-me-in-production
ALLOWED_ORIGINS=["*"]
DEBUG=false

# (선택) TTS — 작가 음성 낭독/나레이션 생성용 (ElevenLabs)
ELEVENLABS_API_KEY_1=                          # 차로운·한여름
ELEVENLABS_API_KEY_2=                          # 백야·김도현
```

> Vertex(ADC) 인증은 `gcloud auth application-default login` 후 사용. 자세한 트러블슈팅은 [server-ops.md](../../backend/docs/server-ops.md).

---

## 3. 프론트엔드 실행 (React + Vite · 포트 5173)

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

### `frontend/.env`

```dotenv
# 로컬 백엔드로 붙일 때
VITE_API_BASE_URL=http://localhost:8000/api
# 배포 백엔드로 붙일 때(설치 없이 프론트만 로컬)
# VITE_API_BASE_URL=https://nodevelture-api-958641405309.us-central1.run.app/api

VITE_NEON_AUTH_URL=https://<neon-auth-endpoint>/neondb/auth
```

> 브라우저에서 `http://localhost:5173` 접속 → 이메일 OTP 로그인 → 작가 선택부터 시연.

---

## 4. 로컬 DB/Redis (Docker)

클라우드 대신 로컬로 띄우려면 루트의 `docker-compose.yml` 사용:

```bash
docker compose up -d redis    # Redis (기본 활성)
# PostgreSQL을 로컬로 쓰려면 docker-compose.yml의 db 블록 주석 해제 후
# docker compose up -d
```

로컬 DB 사용 시 `.env`:
```dotenv
DATABASE_URL=postgresql+asyncpg://nodevelture:nodevelture@127.0.0.1:5433/nodevelture
REDIS_URL=redis://localhost:6379
```

---

## 5. 정량 평가 재현 (선택)

발표 정량근거([발표_정량근거](../발표_정량근거.md))의 수치를 직접 재현할 수 있습니다. `backend/` 폴더에서:

```bash
python -m scripts.rag_recall_eval      # 기억 RAG top-K 재현율
python -m scripts.consistency_eval     # 검수(모순 탐지) 정확도
python -m scripts.persona_eval         # 작가 페르소나 구분도
python -m scripts.completion_rate      # 세션 완료율
python -m scripts.ttfb_eval            # TTFB(첫 토큰 체감 지연)
python -m scripts.cer_eval             # 작가 TTS 낭독 CER (whisper+jiwer+ffmpeg 필요)
python -m scripts.evidence_report      # 근거 종합 리포트(JSON)
python -m scripts.e2e_smoke            # 핵심 흐름 스모크
```

> CER은 `pip install openai-whisper jiwer` + ffmpeg 필요. ElevenLabs 키가 있어야 음성 생성.

---

## 6. 시연 영상용 — 김도현 TTS 나레이션 생성 (선택)

[데모_시나리오.md](../데모_시나리오.md) §8 나레이션 대본을 김도현 음성 mp3로 출력:

```bash
cd backend
# .env 에 ELEVENLABS_API_KEY_2 설정 필요 (김도현=키2)
OUT_DIR=../docs/시연_나레이션 python -m scripts.tts_narration
```
→ `narration_0_오프닝.mp3` … `narration_9_클로징.mp3` 생성. 영상 편집기에서 화면과 싱크.

---

## 7. 트러블슈팅 빠른 참조

| 증상 | 확인 |
|---|---|
| 로그인 후 작품 목록이 빈 채 | Neon Auth 허용 도메인에 접속 도메인(`localhost`/`*.vercel.app`) 등록됐는지 |
| 백엔드 500 / DB 연결 실패 | `DATABASE_URL` SSL 옵션, `alembic upgrade head` 수행 여부 |
| LLM 응답 없음 / 429 | `LLM_PROVIDER_CHAIN`과 키 설정, 무료 쿼터 소진 시 자동 폴백 동작 |
| TTS 음성 없음(204) | 작가별 `ELEVENLABS_API_KEY_1/2` 매핑(차로운·한여름=키1 / 백야·김도현=키2) |
| 배포 후 프론트가 백엔드 못 찾음 | `VITE_API_BASE_URL`을 Cloud Run `…/api` 주소로 교체 |

자세한 내용: [server-ops.md](../../backend/docs/server-ops.md) · [setup.md](../../backend/docs/setup.md)

---

## 제출 문서 인덱스 (`docs/제출/`)

- [1팀_NodeVelture_기획서.md](1팀_NodeVelture_기획서.md) — 현행 기획서
- [팀_회고서.md](팀_회고서.md) · [팀_자체평가서.md](팀_자체평가서.md)
- [페르소나_카드.md](페르소나_카드.md) — 작가 4인 페르소나
- [테스트케이스_종합_심야라디오.md](테스트케이스_종합_심야라디오.md) · [테스트케이스_김도현_스트레스.md](테스트케이스_김도현_스트레스.md)
- [MOS_평가가이드.md](MOS_평가가이드.md) · [호출로그_요약.md](호출로그_요약.md)
- 자기평가서: [윤정](자기평가서_윤정.md) · [가연](자기평가서_가연.md) · [가은](자기평가서_가은.md) · [건혁](자기평가서_건혁.md)
