<!-- markdownlint-disable MD022 MD031 MD032 MD024 MD040 MD036 -->
# 서버 운영 / 트러블슈팅

서버 실행 중 발생한 에러와 해결 방법을 기록합니다.
**규칙: 새 이슈가 위로 오도록 최신순으로 쌓아 작성합니다.**
실행 방법은 [setup.md](setup.md), 전체 현황은 [../../docs/PROJECT_STATUS.md](../../docs/PROJECT_STATUS.md) 참고.

기록 형식:

```
## YYYY-MM-DD — 한 줄 증상

**증상** / **원인** / **해결** / **예방**
```

---

## 빠른 점검 체크리스트

서버가 이상하면 위에서부터 확인:

1. **DB/Redis 컨테이너 떠 있나?**
   ```powershell
   docker compose -f backend/docker-compose.yml ps
   ```
   `db`, `redis`가 `running`이 아니면 → `docker compose -f backend/docker-compose.yml up -d`
2. **conda 환경 맞나?** 프롬프트에 `(nodevelture)` 표시 / `python -m uvicorn ...`로 실행했나
3. **`.env` 바꾸고 서버 재시작했나?** (`--reload`는 `.env` 미감시)
4. **DB 테이블 있나?** `alembic upgrade head` 했는지 (빈 DB면 저장 실패)
5. **헬스체크**: `curl http://localhost:8000/health` → `{"status":"ok"}`

---

## 이슈 기록

## 2026-06-08 — DB 커넥션이 작업 도중 끊김 (ConnectionResetError / ConnectionDoesNotExistError)

**증상**
- `sessions.py`의 `complete_session`에서 `db.execute(...)` 호출 시 ASGI 예외 발생
- 핵심 메시지:
  ```
  ConnectionResetError: [WinError 10054] 현재 연결은 원격 호스트에 의해 강제로 끊겼습니다
  asyncpg.exceptions.ConnectionDoesNotExistError: connection was closed in the middle of operation
  ```

**원인**
- PostgreSQL이 커넥션을 도중에 리셋함. 두 요인이 겹침:
  1. 도커 postgres 컨테이너가 (재)시작 중이거나 WSL 엔진이 흔들려 연결이 끊김
  2. SQLAlchemy 엔진에 `pool_pre_ping`이 없어, 죽은 커넥션을 풀에서 그대로 꺼내 재사용

**해결**
- `app/database.py` 엔진에 복원력 옵션 추가:
  ```python
  engine = create_async_engine(
      settings.DATABASE_URL,
      echo=settings.DEBUG,
      pool_pre_ping=True,    # 사용 전 커넥션 생존 확인 → 죽은 커넥션 자동 교체
      pool_recycle=1800,     # 30분 지난 커넥션 재생성
  )
  ```
- 컨테이너가 내려가 있으면 함께 재기동: `docker compose -f backend/docker-compose.yml up -d`

**예방**
- 도커가 불안정하면 Redis처럼 `.env`의 `DATABASE_URL`을 클라우드 PG(Neon/Supabase)로 토글하는 것도 대안
- DB 예외가 ASGI 레벨로 그대로 노출되는 문제는 **전역 에러 핸들링 미들웨어**(2주차 예정)로 일관 응답화 필요

**⚠️ 추가 확인 (재발) — 실제 주원인은 "컨테이너 종료"**
- 같은 에러가 `pool_pre_ping` 적용 후에도 재발. 트레이스백이 `_create_connection`(새 커넥션 생성) 단계에서 터지면 풀 문제가 아니라 **postgres 컨테이너 자체가 꺼진 것**.
- 진단: `docker compose ps`가 비어 있음 + 로그 마지막에 `received fast shutdown request`.
- 해결: `docker compose up -d` 로 재기동 → `docker compose ps`에서 `db`가 `(healthy)` 확인.
- **구분법**: `_create_connection`에서 실패 → 컨테이너 죽음(`up -d`). / 재사용 커넥션 끊김 → `pool_pre_ping`이 처리.
- 컨테이너가 자꾸 꺼지면(WSL/Docker Desktop 불안정) → 클라우드 PG 토글이 근본 대안.

---

## 자주 겪는 에러 모음 (setup.md에서 발췌)

### `connection refused` — DB 연결 실패
도커 컨테이너 미기동. `docker compose ... ps` 확인 후 `up -d`.

### `uvicorn`이 엉뚱한 파이썬(3.13)으로 실행됨
`python -m uvicorn ...`로 실행 (conda 환경 일치). `(nodevelture)` 활성화 확인.

### `ModuleNotFoundError`
conda 환경 비활성 또는 패키지 미설치. `conda activate nodevelture` → `pip install -r requirements.txt`.

### Alembic `Target database is not up to date`
`alembic upgrade head`.

### 포트 충돌 (`5432`/`8000` 사용 중)
다른 포트로 실행(`--port 8001`)하거나 점유 프로세스 정리. ngrok 공유 시 포트는 jyj 서버 기준만 맞으면 됨.

### `.env` 변경이 반영 안 됨
`.env`는 `--reload` 감시 대상 아님 → 서버 직접 재시작.

### 채팅 응답 없음 (Gemini)
- `GEMINI_API_KEY` 형식 확인 (`AIzaSy...` 형태)
- Redis 미실행 시 컨텍스트 조립 실패 → 도커 redis 또는 Upstash 확인
