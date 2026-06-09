import logging
import uuid
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.session import Session, SessionStatus
from app.models.dialogue import Dialogue
from app.models.novel import Novel, NovelStatus
from app.schemas.novel import NovelUpdate, NovelResponse

router = APIRouter()
logger = logging.getLogger(__name__)


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
    """세션의 대화 로그를 소설 초안으로 변환 (LLM 연결 전 플레이스홀더)"""
    session_result = await db.execute(select(Session).where(Session.id == session_id))
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if session.status != SessionStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="완료된 세션만 소설로 변환할 수 있습니다.")

    existing = await db.execute(select(Novel).where(Novel.session_id == session_id))
    existing_novel = existing.scalar_one_or_none()
    if existing_novel:
        return existing_novel

    dialogues_result = await db.execute(
        select(Dialogue)
        .where(Dialogue.session_id == session_id)
        .order_by(Dialogue.turn_order)
    )
    dialogues = dialogues_result.scalars().all()

    # TODO: LLM으로 소설 변환 구현
    placeholder_content = "\n\n".join(
        f"{'(주인공)' if not d.character_id else '(조연)'}: {d.content}"
        for d in dialogues
    )

    novel = Novel(
        session_id=session_id,
        title="제목 없음",
        content=placeholder_content,
        status=NovelStatus.DRAFT,
    )
    db.add(novel)
    await db.flush()
    await db.refresh(novel)
    logger.info("소설 초안 생성: %s (session=%s)", novel.id, session_id)
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
