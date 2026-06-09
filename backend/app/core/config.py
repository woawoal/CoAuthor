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

    # AI 엔진
    AI_API_KEY: str = ""
    AI_API_BASE_URL: str = ""
    GEMINI_API_KEY: str = ""
    # 모델은 .env로 교체 가능 (무료 쿼터는 모델당 20req/day → 소진 시 미사용 모델로 스왑)
    GEMINI_MODEL: str = "gemini-2.0-flash-lite"
    GEMINI_FALLBACK_MODEL: str = "gemini-2.0-flash"

    # CORS
    ALLOWED_ORIGINS: List[str] = ["*"]

    # 보안
    SECRET_KEY: str = "change-me-in-production"

    class Config:
        env_file = str(_ENV_FILE)


settings = Settings()
