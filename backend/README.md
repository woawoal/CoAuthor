# NodeVelture — Backend

사용자가 AI와 함께 세계관·등장인물을 설계하고, 그 세계관 속 주인공이 되어 조연(AI)과 대화하며 이야기를 만들어가는 서비스. 대화가 끝나면 소설 초안으로 자동 변환된다.

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| 언어 | Python 3.11+ |
| 프레임워크 | FastAPI (비동기 / SSE 스트리밍) |
| ORM | SQLAlchemy 2.0 (async) + Alembic |
| DB | PostgreSQL 15 |
| 캐시 | Redis 7 |
| AI 엔진 | PERSO API (1순위) / Ollama (폴백) |
| 컨테이너 | Docker / Docker Compose |

---

## 전체 흐름

```
┌─────────────┐      HTTP / SSE       ┌──────────────────────────┐
│  Frontend   │ ────────────────────▶ │   FastAPI (port 8000)    │
└─────────────┘                       └────────────┬─────────────┘
                                                   │
                  ┌─────────────────┬──────────────┴──────────┐
                  ▼                 ▼                          ▼
        ┌──────────────┐  ┌──────────────────┐   ┌────────────────────┐
        │ PostgreSQL   │  │   Redis 캐시      │   │  AI 엔진           │
        │ (영구 저장)   │  │  (응답 캐싱)      │   │  PERSO / Ollama    │
        └──────────────┘  └──────────────────┘   └────────────────────┘
```

### 사용자 여정 → API 흐름

```
1. 회원가입/로그인
   POST /api/v1/users/register

2. 세계관 설계
   POST /api/v1/worlds                  ← 세계관 생성
   POST /api/v1/worlds/{id}/characters  ← 등장인물 추가

3. 창작 세션 시작
   POST /api/v1/sessions                ← 세션 생성 (주인공 선택)

4. 대화 (이야기 만들기)
   POST /api/v1/sessions/{id}/dialogues/stream  ← SSE 스트리밍

5. 세션 완료 → 소설 변환
   PATCH /api/v1/sessions/{id}/complete
   POST  /api/v1/sessions/{id}/novel/generate
```

---

## 빠른 시작

```bash
# 1. 가상환경 생성 및 활성화
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux

# 2. 패키지 설치
pip install -r requirements.txt

# 3. 환경변수 설정
cp .env.example .env         # .env 파일 열어서 필요 시 수정

# 4. DB / Redis 컨테이너 실행
docker-compose up -d

# 5. DB 초기화 (첫 실행 시)
alembic revision --autogenerate -m "init"
alembic upgrade head

# 6. 서버 실행
uvicorn app.main:app --reload
```

접속 확인: http://localhost:8000/docs (Swagger UI)

---

## 폴더 구조

```
backend/
├── app/
│   ├── main.py              # 앱 시작점
│   ├── database.py          # DB 엔진 / 세션
│   ├── core/config.py       # 환경변수
│   ├── models/              # DB 테이블 모델
│   ├── schemas/             # Pydantic 입출력 스키마
│   ├── api/v1/endpoints/    # API 라우터
│   ├── services/            # 비즈니스 로직 (Cache, LLM)
│   └── prompts/             # AI 프롬프트 템플릿
├── migrations/              # Alembic 마이그레이션
├── tests/                   # 테스트
├── docs/                    # 상세 문서
├── docker-compose.yml
├── alembic.ini
└── requirements.txt
```

---

## 문서

| 문서 | 내용 |
|------|------|
| [아키텍처](docs/architecture.md) | 전체 구조, 레이어, 데이터 흐름 |
| [DB 모델](docs/models.md) | 테이블 명세, ERD, 관계 설명 |
| [API 명세](docs/api.md) | 엔드포인트 요청/응답 예시 |
| [환경 설정](docs/setup.md) | 로컬 실행, Docker, Alembic |
| [코딩 규칙](docs/coding-rules.md) | 컨벤션, 규칙, 패턴 |
