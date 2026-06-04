import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
from app.api.v1.router import router as v1_router
from app.api.chats import router as chats_router
import app.database as db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.mongo_client = AsyncIOMotorClient(settings.MONGODB_URL)
    logger.info("MongoDB 연결 완료: %s", settings.MONGODB_URL)
    yield
    db.mongo_client.close()
    logger.info("MongoDB 연결 종료")


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)
app.include_router(chats_router, prefix="/api/chats", tags=["chats"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}
