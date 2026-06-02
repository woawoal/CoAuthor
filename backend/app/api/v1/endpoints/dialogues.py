import logging
import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import get_db
from app.models.session import Session, SessionStatus
from app.models.dialogue import Dialogue, SpeakerType
from app.models.character import Character
from app.schemas.dialogue import DialogueStreamRequest, DialogueResponse

router = APIRouter()
logger = logging.getLogger(__name__)


async def _get_active_session(session_id: uuid.UUID, db: AsyncSession) -> Session:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if session.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="활성화된 세션이 아닙니다.")
    return session


@router.get("/", response_model=list[DialogueResponse])
async def list_dialogues(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Dialogue)
        .where(Dialogue.session_id == session_id)
        .order_by(Dialogue.turn_order)
    )
    return result.scalars().all()


@router.post("/stream")
async def stream_dialogue(
    session_id: uuid.UUID,
    body: DialogueStreamRequest,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """사용자 발화를 저장하고 AI 캐릭터 응답을 SSE로 스트리밍"""
    await _get_active_session(session_id, db)

    char_result = await db.execute(select(Character).where(Character.id == body.character_id))
    character = char_result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")

    turn_result = await db.execute(
        select(func.count(Dialogue.id)).where(Dialogue.session_id == session_id)
    )
    turn_count = turn_result.scalar() or 0

    # 사용자 발화 저장
    user_dialogue = Dialogue(
        session_id=session_id,
        speaker_type=SpeakerType.USER,
        character_id=None,
        content=body.content,
        turn_order=turn_count,
    )
    db.add(user_dialogue)
    await db.flush()

    async def generate():
        # TODO: LLM 연결 후 실제 스트리밍 구현
        ai_content = f"[{character.name}] (AI 응답 스트리밍 예정)"
        yield f"data: {ai_content}\n\n"

        ai_dialogue = Dialogue(
            session_id=session_id,
            speaker_type=SpeakerType.CHARACTER,
            character_id=character.id,
            content=ai_content,
            turn_order=turn_count + 1,
        )
        db.add(ai_dialogue)
        await db.commit()

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
