import logging
import uuid
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.session import Session, SessionStatus
from app.models.dialogue import Dialogue, SpeakerType
from app.models.world import World
from app.models.novel import Novel, NovelStatus
from app.schemas.novel import NovelUpdate, NovelResponse
from app.services.llm_router import LLMRouter

router = APIRouter()
logger = logging.getLogger(__name__)
llm_router = LLMRouter()

# 프론트 작가 번호(author_id) → persona 키 (frontend AUTHOR_MAP과 일치)
_AUTHOR_ID_TO_PERSONA = {1: "baekya", 2: "charoun", 3: "hanyeoreum", 4: "kimdohyeon"}


@router.get("/{session_id}/novel", response_model=NovelResponse)
async def get_novel(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Novel).where(Novel.session_id == session_id))
    novel = result.scalar_one_or_none()
    if not novel:
        raise HTTPException(status_code=404, detail="소설 초안이 없습니다.")
    return novel


@router.post("/{session_id}/novel/generate", response_model=NovelResponse, status_code=201)
async def generate_novel(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """세션의 대화 로그를 선택한 작가의 문체로 소설 초안으로 변환한다."""
    session_result = await db.execute(select(Session).where(Session.id == session_id))
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if session.status != SessionStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="완료된 세션만 소설로 변환할 수 있습니다.")

    existing = await db.execute(select(Novel).where(Novel.session_id == session_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 소설 초안이 존재합니다.")

    dialogues_result = await db.execute(
        select(Dialogue)
        .where(Dialogue.session_id == session_id)
        .order_by(Dialogue.turn_order)
    )
    dialogues = dialogues_result.scalars().all()
    if not dialogues:
        raise HTTPException(status_code=400, detail="대화 내용이 없어 소설로 변환할 수 없습니다.")

    # 대화 로그 → LLMRouter 입력 형식
    dialogue_history = [
        {
            "role": "user" if d.speaker_type == SpeakerType.USER else "assistant",
            "content": d.content,
        }
        for d in dialogues
    ]

    # 세계관 설명(있으면 변환 프롬프트에 주입)
    world_result = await db.execute(select(World).where(World.id == session.world_id))
    world = world_result.scalar_one_or_none()
    world_desc = ""
    if world:
        world_desc = "\n".join(p for p in (world.setting, world.description) if p)

    # 선택한 작가(author_id) → persona → 작가 문체로 변환
    persona_id = _AUTHOR_ID_TO_PERSONA.get(session.author_id, "")

    # LLM 소설 변환 — 실패 시 대화 로그 이어붙이기로 폴백
    try:
        content = await llm_router.generate_novel(dialogue_history, world_desc, persona_id=persona_id)
    except Exception as e:
        logger.error("소설 LLM 변환 실패, 폴백 사용 (session=%s): %s", session_id, e)
        content = ""
    if not content:
        content = "\n\n".join(d.content for d in dialogues)

    novel = Novel(
        session_id=session_id,
        title=(world.title if world and world.title else "제목 없음"),
        content=content,
        status=NovelStatus.DRAFT,
    )
    db.add(novel)
    await db.flush()
    await db.refresh(novel)
    logger.info("소설 초안 생성: %s (session=%s, %d자)", novel.id, session_id, len(content))
    return novel


@router.patch("/{session_id}/novel", response_model=NovelResponse)
async def update_novel(session_id: uuid.UUID, body: NovelUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Novel).where(Novel.session_id == session_id))
    novel = result.scalar_one_or_none()
    if not novel:
        raise HTTPException(status_code=404, detail="소설 초안이 없습니다.")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(novel, field, value)

    await db.flush()
    await db.refresh(novel)
    return novel
