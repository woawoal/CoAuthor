from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.llm_router import LLMRouter
from app.services.cache import CacheService

router = APIRouter()
llm_router = LLMRouter()
cache = CacheService()


@router.post("/stream")
async def chat_stream(req: ChatRequest):
    """함께 쓰기 모드 - 페르소나와 스트리밍 대화"""
    cached = await cache.get(req)
    if cached:
        return StreamingResponse(iter([cached]), media_type="text/event-stream")

    return StreamingResponse(
        llm_router.stream(req),
        media_type="text/event-stream",
    )
