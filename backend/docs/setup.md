# 환경 설정 가이드

## 사전 준비

| 항목 | 버전 | 확인 명령어 |
|------|------|------------|
| Python | 3.11+ | `python --version` |
| Docker Desktop | 최신 | `docker --version` |
| Git | - | `git --version` |

---

## 로컬 개발 환경 세팅

### 1. 저장소 클론
```bash
git clone {repo-url}
cd NodeVelture/backend
```

### 2. 가상환경 생성 및 활성화
```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Mac / Linux
source venv/bin/activate
```

> 활성화되면 터미널에 `(venv)` 표시가 나타남

### 3. 패키지 설치
```bash
pip install -r requirements.txt
```

### 4. 환경변수 설정
```bash
cp .env.example .env
```

`.env` 파일 열어서 필요한 값 수정:
```env
DATABASE_URL=postgresql+asyncpg://nodevelture:nodevelture@localhost:5432/nodevelture
REDIS_URL=redis://localhost:6379
CACHE_TTL=3600
AI_API_KEY=발급받은_키_입력
AI_API_BASE_URL=
SECRET_KEY=로컬개발용_랜덤문자열
DEBUG=true
```

---

## Docker 사용법

Docker는 PostgreSQL과 Redis를 내 PC에 직접 설치하지 않고 컨테이너로 실행하는 방법입니다.

### 컨테이너 시작
```bash
docker-compose up -d
```
> `-d` 옵션 : 백그라운드 실행 (터미널이 잠기지 않음)

### 컨테이너 상태 확인
```bash
docker-compose ps
```
```
NAME       STATUS    PORTS
db         running   0.0.0.0:5432->5432/tcp
redis      running   0.0.0.0:6379->6379/tcp
```

### 컨테이너 로그 보기
```bash
docker-compose logs db      # PostgreSQL 로그
docker-compose logs redis   # Redis 로그
docker-compose logs -f      # 전체 로그 실시간
```

### 컨테이너 중지 / 재시작
```bash
docker-compose stop         # 중지 (데이터 유지)
docker-compose start        # 재시작
docker-compose restart      # 재시작 (stop + start)
```

### 컨테이너 완전 삭제
```bash
docker-compose down         # 컨테이너만 삭제 (데이터 볼륨 유지)
docker-compose down -v      # 컨테이너 + 데이터 볼륨 전부 삭제
```
> `-v` 옵션은 DB 데이터도 전부 삭제되므로 주의

---

## Alembic 마이그레이션

모델(`app/models/`)을 변경할 때마다 마이그레이션을 생성하고 적용해야 DB에 반영됩니다.

### 처음 실행 (초기 테이블 생성)
```bash
alembic revision --autogenerate -m "init"
alembic upgrade head
```

### 모델 변경 후 마이그레이션 흐름
```bash
# 1. app/models/ 에서 모델 수정

# 2. 변경사항 감지 → 마이그레이션 파일 자동 생성
alembic revision --autogenerate -m "변경 내용 설명"
# 예: alembic revision --autogenerate -m "add user profile image"

# 3. 생성된 파일 확인 (migrations/versions/ 폴더)
# 내용이 맞는지 반드시 눈으로 확인 후 적용!

# 4. DB에 적용
alembic upgrade head
```

### 자주 쓰는 Alembic 명령어
```bash
alembic upgrade head        # 최신 버전으로 업그레이드
alembic downgrade -1        # 한 단계 롤백
alembic current             # 현재 DB 마이그레이션 버전 확인
alembic history             # 전체 마이그레이션 이력 조회
```

---

## 서버 실행

```bash
# 개발 모드 (코드 변경 시 자동 재시작)
uvicorn app.main:app --reload

# 특정 포트 지정
uvicorn app.main:app --reload --port 8001

# 외부 접속 허용
uvicorn app.main:app --reload --host 0.0.0.0
```

| 주소 | 내용 |
|------|------|
| `http://localhost:8000` | API 서버 |
| `http://localhost:8000/docs` | Swagger UI (API 테스트) |
| `http://localhost:8000/redoc` | ReDoc 문서 |
| `http://localhost:8000/health` | 헬스체크 |

---

## 자주 겪는 문제

### `connection refused` (DB 연결 실패)
```bash
# Docker 컨테이너가 실행 중인지 확인
docker-compose ps

# 컨테이너가 없으면 시작
docker-compose up -d
```

### `ModuleNotFoundError`
```bash
# 가상환경이 활성화되어 있는지 확인
# 터미널에 (venv) 표시가 없으면 활성화 필요
venv\Scripts\activate  # Windows
```

### Alembic `Target database is not up to date`
```bash
alembic upgrade head
```

### 포트 충돌 (`5432` 이미 사용 중)
- 로컬에 PostgreSQL이 이미 설치되어 있는 경우
- `docker-compose.yml` 에서 포트를 변경하거나 로컬 PostgreSQL을 중지
