from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import chat, compare, coaching
from app.core.config import settings

app = FastAPI(title="AI 빙의작가 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(compare.router, prefix="/api/compare", tags=["compare"])
app.include_router(coaching.router, prefix="/api/coaching", tags=["coaching"])


@app.get("/health")
async def health():
    return {"status": "ok"}
