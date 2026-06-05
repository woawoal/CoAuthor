import json
import uuid
import logging

import google.generativeai as genai
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.core.personas import get_author_prompt
from app.database import get_mongo_db
from app.models.dialogue import DialogueDocument, SpeakerType
from app.services.rag_service import save_with_embedding

router = APIRouter()
logger = logging.getLogger(__name__)

genai.configure(api_key=settings.GEMINI_API_KEY)

redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

RECENT_DIALOGUE_LIMIT = 20  # Redis 최근 대화 유지 수
DB_SYNC_INTERVAL = 5        # N턴마다 DB 동기화


# ── Redis 키 규칙 ──────────────────────────────────────────
def key_history(chat_id: str) -> str:
    return f"session:{chat_id}:history"

def key_state(chat_id: str) -> str:
    return f"session:{chat_id}:state"

def key_characters(chat_id: str) -> str:
    return f"session:{chat_id}:characters"

def key_summary(chat_id: str) -> str:
    return f"session:{chat_id}:summary"

def key_turn(chat_id: str) -> str:
    return f"session:{chat_id}:turn"


# ── Redis 조회 헬퍼 ────────────────────────────────────────
async def get_context(chat_id: str) -> dict:
    history_raw = await redis_client.lrange(key_history(chat_id), 0, RECENT_DIALOGUE_LIMIT - 1)
    history = [json.loads(item) for item in history_raw]

    state      = await redis_client.get(key_state(chat_id)) or ""
    characters = await redis_client.get(key_characters(chat_id)) or ""
    summary    = await redis_client.get(key_summary(chat_id)) or ""

    return {
        "history":    history,
        "state":      state,
        "characters": characters,
        "summary":    summary,
    }


async def init_context_if_empty(
    chat_id: str,
    state: str,
    characters: str,
    summary: str,
):
    if not await redis_client.exists(key_state(chat_id)) and state:
        await redis_client.set(key_state(chat_id), state)

    if not await redis_client.exists(key_characters(chat_id)) and characters:
        await redis_client.set(key_characters(chat_id), characters)

    if not await redis_client.exists(key_summary(chat_id)) and summary:
        await redis_client.set(key_summary(chat_id), summary)


# ── Redis 갱신 헬퍼 ────────────────────────────────────────
async def append_history(chat_id: str, role: str, content: str) -> int:
    entry = json.dumps({"role": role, "content": content}, ensure_ascii=False)
    await redis_client.lpush(key_history(chat_id), entry)
    await redis_client.ltrim(key_history(chat_id), 0, RECENT_DIALOGUE_LIMIT - 1)
    return int(await redis_client.incr(key_turn(chat_id)))


async def update_state(chat_id: str, new_state: str):
    await redis_client.set(key_state(chat_id), new_state)


async def sync_to_db(chat_id: str):
    logger.info("DB 동기화 실행 - chat_id=%s", chat_id)


# ── 프롬프트 조립 ─────────────────────────────────────────
def build_prompt(
    persona_id: str,
    world_context: str,
    mode: str,
    context: dict,
    user_input: str,
) -> str:
    system = get_author_prompt(
        persona_id=persona_id,
        world_context=world_context,
        mode=mode,
    )

    parts = [system]

    if context["characters"]:
        parts.append(f"[주요 등장인물]\n{context['characters']}")

    if context["summary"]:
        parts.append(f"[사건 요약]\n{context['summary']}")

    if context["state"]:
        parts.append(f"[현재 상태]\n{context['state']}")

    if context["history"]:
        history_text = "\n".join(
            f"{'사용자' if h['role'] == 'user' else 'AI'}: {h['content']}"
            for h in reversed(context["history"])
        )
        parts.append(f"[최근 대화]\n{history_text}")

    parts.append(f"사용자 입력: {user_input}")

    return "\n\n".join(parts)


# ── API ───────────────────────────────────────────────────
class MessageRequest(BaseModel):
    content: str
    character_id: str = "baekya"
    world_context: str = ""
    mode: str = "author"
    initial_state: str = ""
    initial_characters: str = ""
    initial_summary: str = ""


@router.post("/{chat_id}/messages", status_code=201)
async def send_message(
    chat_id: str,
    body: MessageRequest,
    mongo: AsyncIOMotorDatabase = Depends(get_mongo_db),
):
    await init_context_if_empty(
        chat_id,
        body.initial_state,
        body.initial_characters,
        body.initial_summary,
    )

    turn = await append_history(chat_id, "user", body.content)

    # MongoDB에 원본 로그 저장 (임베딩 포함)
    turn_count = await mongo["dialogues"].count_documents({"session_id": chat_id})
    user_doc = DialogueDocument(
        session_id=chat_id,
        speaker_type=SpeakerType.USER,
        content=body.content,
        turn_order=turn_count,
    )
    await save_with_embedding(user_doc, mongo)

    logger.info("메시지 수신 - chat_id=%s turn=%d", chat_id, turn)
    return {"messageId": user_doc.id, "status": "queued", "turn": turn}


@router.get("/{chat_id}/stream")
async def stream_response(
    chat_id: str,
    content: str = "",
    character_id: str = "baekya",
    world_context: str = "",
    mode: str = "author",
    mongo: AsyncIOMotorDatabase = Depends(get_mongo_db),
):
    message_id = f"msg_{uuid.uuid4().hex[:8]}"
    context = await get_context(chat_id)

    async def generate():
        full_response = ""
        try:
            full_prompt = build_prompt(
                persona_id=character_id,
                world_context=world_context,
                mode=mode,
                context=context,
                user_input=content,
            )

            model = genai.GenerativeModel("gemini-2.5-flash")
            response = model.generate_content(full_prompt, stream=True)

            seq = 1
            for chunk in response:
                if chunk.text:
                    full_response += chunk.text
                    payload = json.dumps(
                        {"messageId": message_id, "seq": seq, "text": chunk.text},
                        ensure_ascii=False,
                    )
                    yield f"event: token\ndata: {payload}\n\n"
                    seq += 1

            turn = await append_history(chat_id, "ai", full_response)

            # MongoDB에 AI 응답 저장 (임베딩 포함)
            turn_count = await mongo["dialogues"].count_documents({"session_id": chat_id})
            ai_doc = DialogueDocument(
                session_id=chat_id,
                speaker_type=SpeakerType.CHARACTER,
                content=full_response,
                turn_order=turn_count,
            )
            await save_with_embedding(ai_doc, mongo)
            logger.info("AI 응답 저장 완료 - chat_id=%s, turn=%d", chat_id, turn_count)

            if turn % DB_SYNC_INTERVAL == 0:
                await sync_to_db(chat_id)

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


@router.patch("/{chat_id}/state")
async def update_chat_state(chat_id: str, new_state: str):
    await update_state(chat_id, new_state)
    return {"status": "updated"}
