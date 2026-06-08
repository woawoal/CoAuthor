import json
import logging
import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db, AsyncSessionLocal
from app.models.session import Session, SessionStatus
from app.models.character import Character
from app.models.dialogue import Dialogue, SpeakerType
from app.models.api_log import ApiLog
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
        log_usage: dict | None = None

        async for sse_line in llm_router.stream_character_response(
            character=character,
            dialogue_history=history,
            user_message=body.content,
        ):
            # event: log 는 클라이언트에 전달하지 않고 나중에 ApiLog 저장에 사용
            if sse_line.startswith("event: log\n"):
                try:
                    data_line = sse_line.strip().split("\n")[1]
                    log_usage = json.loads(data_line.replace("data: ", "", 1))
                except Exception as e:
                    logger.warning("[api_log] 파싱 실패: %s", e)
                continue

            if sse_line.startswith("data:"):
                try:
                    payload = json.loads(sse_line[5:].strip())
                    if payload.get("text"):
                        ai_chunks.append(payload["text"])
                except Exception:
                    pass
            yield sse_line

        # 스트리밍 완료 후 독립 세션으로 DB 저장 (StreamingResponse 내부에서는 Depends 세션 commit이 보장 안 됨)
        if ai_chunks or log_usage:
            try:
                async with AsyncSessionLocal() as save_session:
                    if ai_chunks:
                        ai_dialogue = Dialogue(
                            session_id=session_id,
                            speaker_type=SpeakerType.CHARACTER,
                            character_id=body.character_id,
                            content="".join(ai_chunks),
                            turn_order=turn_count + 1,
                        )
                        save_session.add(ai_dialogue)
                        logger.info("[dialogues] AI 응답 저장 완료 — session=%s turn=%d", session_id, turn_count + 1)

                    if log_usage:
                        api_log = ApiLog(
                            session_id=session_id,
                            endpoint=f"POST /sessions/{session_id}/dialogues/stream",
                            model_used=log_usage["model"],
                            prompt_tokens=log_usage["prompt_tokens"],
                            completion_tokens=log_usage["completion_tokens"],
                            total_cost=log_usage["cost"],
                        )
                        save_session.add(api_log)
                        logger.info(
                            "[api_log] 저장 — model=%s prompt=%d completion=%d cost=%.8f",
                            log_usage["model"], log_usage["prompt_tokens"], log_usage["completion_tokens"], log_usage["cost"],
                        )

                    await save_session.commit()
            except Exception as e:
                logger.error("[dialogues/api_log] 저장 실패: %s", e)

    return StreamingResponse(generate(), media_type="text/event-stream")
