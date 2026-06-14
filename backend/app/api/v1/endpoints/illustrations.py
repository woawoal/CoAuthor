"""삽화 이미지 생성 엔드포인트.

GET  /sessions/{session_id}/illustrations/recommend  → 장면 후보 4개
POST /sessions/{session_id}/illustrations/generate   → 이미지 URL
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.novel import Novel
from app.models.session import Session
from app.models.world import World
from app.services import illustration as svc

router = APIRouter()


# ── 장면 추천 ─────────────────────────────────────────────────────────
@router.get("/{session_id}/illustrations/recommend")
async def recommend_scenes(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    session = (
        await db.execute(select(Session).where(Session.id == session_id))
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    novel = (
        await db.execute(select(Novel).where(Novel.session_id == session_id))
    ).scalar_one_or_none()
    if not novel or not novel.content:
        raise HTTPException(404, "소설 내용이 없습니다.")

    world = (
        await db.execute(select(World).where(World.id == session.world_id))
    ).scalar_one_or_none()
    world_context = ""
    if world:
        parts = []
        if world.title:       parts.append(f"제목: {world.title}")
        if world.genre:       parts.append(f"장르: {world.genre}")
        if world.description: parts.append(f"배경: {world.description}")
        world_context = "\n".join(parts)

    result = await svc.recommend_scenes(novel.content, world_context)
    return result


# ── 이미지 생성 ───────────────────────────────────────────────────────
class GenerateRequest(BaseModel):
    scene_description: str
    style: str = "webtoon"   # webtoon | watercolor | ink | realistic | pastel
    mood: str = "warm"       # warm | dark | dreamy | tense | romantic
    ratio: str = "1:1"       # 1:1 | 16:9 | 9:16
    skip_filter: bool = False  # True면 필터 단계 건너뜀(추천 모드에서 이미 정제된 경우)


class GenerateResponse(BaseModel):
    status: str           # appropriate | refine_needed | inappropriate | generated
    image_url: str | None = None
    refined_prompt: str | None = None
    suggestion: str | None = None
    block_reason: str | None = None


@router.post("/{session_id}/illustrations/generate", response_model=GenerateResponse)
async def generate_illustration(
    session_id: str,
    body: GenerateRequest,
    db: AsyncSession = Depends(get_db),
):
    session = (
        await db.execute(select(Session).where(Session.id == session_id))
    ).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "세션을 찾을 수 없습니다.")

    world = (
        await db.execute(select(World).where(World.id == session.world_id))
    ).scalar_one_or_none()
    genre = world.genre if world else ""

    if body.skip_filter:
        filter_result = {
            "status": "appropriate",
            "refined_prompt": body.scene_description,
            "suggestion": None,
            "block_reason": None,
        }
    else:
        filter_result = await svc.filter_and_refine(
            body.scene_description, genre, body.style, body.mood
        )

    status = filter_result.get("status", "appropriate")

    if status == "inappropriate":
        return GenerateResponse(
            status="inappropriate",
            block_reason=filter_result.get("block_reason"),
            suggestion=filter_result.get("suggestion"),
        )

    refined = filter_result.get("refined_prompt") or body.scene_description
    if not body.skip_filter:
        from app.services.illustration import STYLE_MAP, MOOD_MAP
        style_hint = STYLE_MAP.get(body.style, STYLE_MAP["webtoon"])
        mood_hint  = MOOD_MAP.get(body.mood, "")
        extra = ", ".join(filter(None, [style_hint, mood_hint]))
        if extra and extra not in refined:
            refined = f"{refined}, {extra}"

    try:
        image_url = await svc.generate_image(refined, body.ratio)
    except Exception as e:
        raise HTTPException(502, f"이미지 생성 실패: {e}") from e

    return GenerateResponse(
        status="generated",
        image_url=image_url,
        refined_prompt=refined,
        suggestion=filter_result.get("suggestion"),
    )
