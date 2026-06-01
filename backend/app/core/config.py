from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    PERSO_API_KEY: str = ""
    FALLBACK_LLM_API_KEY: str = ""  # GPT-4o-mini or Claude Haiku

    DATABASE_URL: str = "sqlite:///./coauthor.db"
    REDIS_URL: str = "redis://localhost:6379"
    CACHE_TTL: int = 3600

    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173"]

    class Config:
        env_file = ".env"


settings = Settings()
