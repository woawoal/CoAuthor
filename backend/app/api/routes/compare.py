from fastapi import APIRouter
from app.schemas.compare import CompareRequest, CompareResponse
from app.services.llm_router import LLMRouter
from app.core.personas import PERSONAS

router = APIRouter()
llm_router = LLMRouter()


@router.post("/", response_model=CompareResponse)
async def compare_genres(req: CompareRequest):
    """장르 비교 모드 - 동일 입력으로 4개 페르소나 결과 동시 생성"""
    results = await llm_router.generate_all_personas(req.text)
    return CompareResponse(results=results)
