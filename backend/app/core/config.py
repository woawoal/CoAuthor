from pathlib import Path
from pydantic_settings import BaseSettings
from typing import List

_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    # 앱
    APP_NAME: str = "NodeVelture API"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # 데이터베이스
    DATABASE_URL: str = "postgresql+asyncpg://nodevelture:nodevelture@localhost:5432/nodevelture"

    # Redis
    REDIS_URL: str = "redis://localhost:6379"
    CACHE_TTL: int = 3600

    # AI 엔진 — .env의 LLM_PROVIDER 로 전환 (gemini | groq)
    LLM_PROVIDER: str = "gemini"
    AI_API_KEY: str = ""
    AI_API_BASE_URL: str = ""
    GEMINI_API_KEY: str = ""
    GEMINI_API_KEY_2: str = ""   # 무료키 2개 순환용 (429 시 키 전환)
    # 모델은 .env로 교체 가능 (무료 쿼터는 모델당 20req/day → 소진 시 미사용 모델로 스왑)
    GEMINI_MODEL: str = "gemini-2.0-flash-lite"
    GEMINI_FALLBACK_MODEL: str = "gemini-2.0-flash"

    # Vertex AI (GCP $300 크레딧) — USE_VERTEX=true 면 AI Studio 키 대신 Vertex 사용
    # 인증은 ADC(gcloud auth application-default login)로 처리, 서비스계정 키 불필요
    USE_VERTEX: bool = False
    GOOGLE_CLOUD_PROJECT: str = ""
    GOOGLE_CLOUD_LOCATION: str = "us-central1"

    # Groq (무료 한도 넉넉) — LLM_PROVIDER=groq 일 때 사용
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    GROQ_FALLBACK_MODEL: str = "llama-3.1-8b-instant"

    # 정교 파이프라인 — 프로바이더 체인 + n개 키 순환 + 429 쿨다운 + 백오프
    LLM_PROVIDER_CHAIN: str = ""        # 예 "groq,gemini" (비면 LLM_PROVIDER 단일 사용)
    GEMINI_API_KEYS: str = ""           # 콤마구분 n개 (GEMINI_API_KEY/_2와 병합)
    GROQ_API_KEYS: str = ""             # 콤마구분 n개 (GROQ_API_KEY와 병합)
    LLM_KEY_COOLDOWN_SEC: int = 600     # 429난 (키×모델) 스킵 시간(초)
    LLM_MAX_TRANSIENT_RETRY: int = 2    # 일시 오류(5xx/타임아웃) 재시도 횟수

    # CORS
    ALLOWED_ORIGINS: List[str] = ["*"]

    # 보안
    SECRET_KEY: str = "change-me-in-production"

    class Config:
        env_file = str(_ENV_FILE)


settings = Settings()
