import json
import uuid
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)


class MessageRequest(BaseModel):
    content: str
    character_id: str  # 페르소나 ID (baekya, charoun, hanyeoreum, kimdohyeon)


@router.post("/{chat_id}/messages", status_code=201)
async def send_message(chat_id: str, body: MessageRequest):
    """사용자 메시지 전송"""
    # TODO: DB 연결 후 메시지 저장 구현 (가연님 파트)
    message_id = f"msg_{uuid.uuid4().hex[:8]}"
    logger.info("메시지 수신 - chat_id=%s, character=%s", chat_id, body.character_id)
    return {"messageId": message_id, "status": "queued"}


@router.get("/{chat_id}/stream")
async def stream_response(chat_id: str):
    """AI 응답 SSE 스트리밍"""
    message_id = f"msg_{uuid.uuid4().hex[:8]}"

    async def generate():
        # TODO: PERSO API 연결 후 실제 스트리밍 구현 (가연님 파트)
        dummy_tokens = ["골목", "길이", " 텅", " 비어", " 있었다", "."]

        for seq, token in enumerate(dummy_tokens, start=1):
            payload = json.dumps(
                {"messageId": message_id, "seq": seq, "text": token},
                ensure_ascii=False,
            )
            yield f"event: token\ndata: {payload}\n\n"

        done_payload = json.dumps({"messageId": message_id}, ensure_ascii=False)
        yield f"event: done\ndata: {done_payload}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx 버퍼링 비활성화
        },
    )
