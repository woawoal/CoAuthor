from fastapi import APIRouter
from app.schemas.coaching import CoachingRequest, CoachingResponse
from app.services.llm_router import LLMRouter

router = APIRouter()
llm_router = LLMRouter()


@router.post("/", response_model=CoachingResponse)
async def get_coaching(req: CoachingRequest):
    """코칭 모드 - 사용자 작성 글에 대한 장르 전문 피드백"""
    feedback = await llm_router.coach(req.persona_id, req.user_text)
    return CoachingResponse(feedback=feedback)
