import logging
import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from motor.motor_asyncio import AsyncIOMotorDatabase
from app.database import get_db, get_mongo_db
from app.models.session import Session, SessionStatus
from app.models.character import Character
from app.models.dialogue import DialogueDocument, SpeakerType
from app.schemas.dialogue import DialogueStreamRequest, DialogueResponse
from app.services.rag_service import save_with_embedding

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
async def list_dialogues(
    session_id: uuid.UUID,
    mongo: AsyncIOMotorDatabase = Depends(get_mongo_db),
):
    cursor = mongo["dialogues"].find(
        {"session_id": str(session_id)},
        {"_id": 0},
        sort=[("turn_order", 1)],
    )
    docs = await cursor.to_list(length=None)
    return [DialogueResponse(**doc) for doc in docs]


@router.post("/stream")
async def stream_dialogue(
    session_id: uuid.UUID,
    body: DialogueStreamRequest,
    db: AsyncSession = Depends(get_db),
    mongo: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> StreamingResponse:
    """사용자 발화를 저장하고 AI 캐릭터 응답을 SSE로 스트리밍"""
    await _get_active_session(session_id, db)

    char_result = await db.execute(select(Character).where(Character.id == body.character_id))
    character = char_result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")

    turn_count = await mongo["dialogues"].count_documents({"session_id": str(session_id)})

    # 사용자 발화 MongoDB에 저장 (임베딩 포함)
    user_doc = DialogueDocument(
        session_id=str(session_id),
        speaker_type=SpeakerType.USER,
        content=body.content,
        turn_order=turn_count,
    )
    await save_with_embedding(user_doc, mongo)

    async def generate():
        # TODO: LLMRouter 연결 후 실제 스트리밍 구현
        ai_content = f"[{character.name}] (AI 응답 스트리밍 예정)"
        yield f"data: {ai_content}\n\n"

        ai_doc = DialogueDocument(
            session_id=str(session_id),
            speaker_type=SpeakerType.CHARACTER,
            character_id=str(body.character_id),
            content=ai_content,
            turn_order=turn_count + 1,
        )
        await save_with_embedding(ai_doc, mongo)
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
