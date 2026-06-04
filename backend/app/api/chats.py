import json
import uuid
import logging
import google.generativeai as genai
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.core.config import settings
from app.core.personas import get_author_prompt

router = APIRouter()
logger = logging.getLogger(__name__)

genai.configure(api_key=settings.GEMINI_API_KEY)


class MessageRequest(BaseModel):
    content: str
    character_id: str  # 페르소나 ID (baekya, charoun, hanyeoreum, kimdohyeon)
    world_context: str = ""  # 세계관 정보 (선택)
    mode: str = "author"     # author(작가모드) / character(등장인물모드)


@router.post("/{chat_id}/messages", status_code=201)
async def send_message(chat_id: str, body: MessageRequest):
    """사용자 메시지 저장"""
    # TODO: DB 연결 후 메시지 저장 구현 (가연님 파트)
    message_id = f"msg_{uuid.uuid4().hex[:8]}"
    logger.info("메시지 수신 - chat_id=%s, persona=%s", chat_id, body.character_id)
    return {"messageId": message_id, "status": "queued"}


@router.get("/{chat_id}/stream")
async def stream_response(
    chat_id: str,
    content: str = "",
    character_id: str = "baekya",
    world_context: str = "",
    mode: str = "author",
):
    """Gemini API 스트리밍 응답"""
    message_id = f"msg_{uuid.uuid4().hex[:8]}"

    async def generate():
        try:
            # 페르소나 시스템 프롬프트 조합
            system_prompt = get_author_prompt(
                persona_id=character_id,
                world_context=world_context,
                mode=mode,
            )
            full_prompt = f"{system_prompt}\n\n사용자 입력: {content}"

            model = genai.GenerativeModel("gemini-2.5-flash")
            response = model.generate_content(full_prompt, stream=True)

            seq = 1
            for chunk in response:
                if chunk.text:
                    payload = json.dumps(
                        {"messageId": message_id, "seq": seq, "text": chunk.text},
                        ensure_ascii=False,
                    )
                    yield f"event: token\ndata: {payload}\n\n"
                    seq += 1

        except Exception as e:
            logger.error("Gemini API 오류: %s", e)
            error_payload = json.dumps({"error": str(e)}, ensure_ascii=False)
            yield f"event: error\ndata: {error_payload}\n\n"

        finally:
            done_payload = json.dumps({"messageId": message_id}, ensure_ascii=False)
            yield f"event: done\ndata: {done_payload}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
