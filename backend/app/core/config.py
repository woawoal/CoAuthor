from pydantic_settings import BaseSettings
from typing import List


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

    # MongoDB
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "nodevelture"

    # AI 엔진 (추후 연결)
    AI_API_KEY: str = ""
    AI_API_BASE_URL: str = ""

    # CORS
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # 보안
    SECRET_KEY: str = "change-me-in-production"

    class Config:
        env_file = ".env"


settings = Settings()
