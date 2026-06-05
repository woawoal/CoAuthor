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
from app.services.llm_router import LLMRouter
from app.services.rag_service import save_with_embedding

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
    """사용자 발화 저장 → RAG 검색 → Gemini 스트리밍 → AI 응답 저장"""
    await _get_active_session(session_id, db)

    char_result = await db.execute(select(Character).where(Character.id == body.character_id))
    character = char_result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")

    turn_count = await mongo["dialogues"].count_documents({"session_id": str(session_id)})

    # 사용자 말 저장
    user_doc = DialogueDocument(
        session_id=str(session_id),
        speaker_type=SpeakerType.USER,
        content=body.content,
        turn_order=turn_count,
    )
    await save_with_embedding(user_doc, mongo)

    # 최근 대화 히스토리 조회
    cursor = mongo["dialogues"].find(
        {"session_id": str(session_id)},
        {"_id": 0, "speaker_type": 1, "content": 1, "turn_order": 1},
        sort=[("turn_order", -1)],
        limit=20,
    )
    recent = await cursor.to_list(length=20)
    history = [
        {
            "role": "user" if d["speaker_type"] == SpeakerType.USER else "assistant",
            "content": d["content"],
        }
        for d in reversed(recent)
    ]

    async def generate():
        ai_chunks: list[str] = []

        async for sse_line in llm_router.stream_character_response(
            character=character,
            dialogue_history=history,
            user_message=body.content,
            session_id=str(session_id),
            mongo=mongo,
        ):
            # AI 텍스트 누적
            if sse_line.startswith("data:"):
                import json as _json
                try:
                    payload = _json.loads(sse_line[5:].strip())
                    if payload.get("text"):
                        ai_chunks.append(payload["text"])
                except Exception:
                    pass
            yield sse_line

        # AI 응답 전체 MongoDB에 저장
        if ai_chunks:
            ai_doc = DialogueDocument(
                session_id=str(session_id),
                speaker_type=SpeakerType.CHARACTER,
                character_id=str(body.character_id),
                content="".join(ai_chunks),
                turn_order=turn_count + 1,
            )
            await save_with_embedding(ai_doc, mongo)
            logger.info(
                "[dialogues] AI 응답 저장 완료 — session=%s turn=%d",
                session_id, turn_count + 1,
            )

    return StreamingResponse(generate(), media_type="text/event-stream")
