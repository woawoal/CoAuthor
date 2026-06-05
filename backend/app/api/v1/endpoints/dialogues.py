import logging
import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.session import Session, SessionStatus
from app.models.character import Character
from app.models.dialogue import Dialogue, SpeakerType
from app.schemas.dialogue import DialogueStreamRequest, DialogueResponse
from app.services.llm_router import LLMRouter

router = APIRouter()
logger = logging.getLogger(__name__)
llm_router = LLMRouter()


async def _get_active_session(session_id: uuid.UUID, db: AsyncSession) -> Session:
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if session.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="활성화된 세션이 아닙니다.")
    return session


@router.get("/", response_model=list[DialogueResponse])
async def list_dialogues(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
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
    """사용자 발화 저장 → 대화 히스토리 조회 → Gemini 스트리밍 → AI 응답 저장"""
    await _get_active_session(session_id, db)

    char_result = await db.execute(select(Character).where(Character.id == body.character_id))
    character = char_result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")

    count_result = await db.execute(
        select(func.count()).select_from(Dialogue).where(Dialogue.session_id == session_id)
    )
    turn_count = count_result.scalar()

    # 사용자 발화 저장
    user_dialogue = Dialogue(
        session_id=session_id,
        speaker_type=SpeakerType.USER,
        content=body.content,
        turn_order=turn_count,
    )
    db.add(user_dialogue)
    await db.flush()

    # 최근 20개 히스토리 조회
    history_result = await db.execute(
        select(Dialogue)
        .where(Dialogue.session_id == session_id)
        .order_by(Dialogue.turn_order.desc())
        .limit(20)
    )
    recent = list(reversed(history_result.scalars().all()))
    history = [
        {
            "role": "user" if d.speaker_type == SpeakerType.USER else "assistant",
            "content": d.content,
        }
        for d in recent
    ]

    async def generate():
        ai_chunks: list[str] = []

        async for sse_line in llm_router.stream_character_response(
            character=character,
            dialogue_history=history,
            user_message=body.content,
        ):
            if sse_line.startswith("data:"):
                import json as _json
                try:
                    payload = _json.loads(sse_line[5:].strip())
                    if payload.get("text"):
                        ai_chunks.append(payload["text"])
                except Exception:
                    pass
            yield sse_line

        if ai_chunks:
            ai_dialogue = Dialogue(
                session_id=session_id,
                speaker_type=SpeakerType.CHARACTER,
                character_id=body.character_id,
                content="".join(ai_chunks),
                turn_order=turn_count + 1,
            )
            db.add(ai_dialogue)
            await db.flush()
            logger.info("[dialogues] AI 응답 저장 완료 — session=%s turn=%d", session_id, turn_count + 1)

    return StreamingResponse(generate(), media_type="text/event-stream")
