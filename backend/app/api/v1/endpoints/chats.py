import json
import uuid
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.config import settings
from app.core.personas import get_author_prompt
from app.database import get_db, AsyncSessionLocal
from app.models.api_log import ApiLog
from app.models.dialogue import Dialogue, SpeakerType
from app.models.session import Session
from app.services.llm_router import calc_cost, PRIMARY_MODEL
from app.services import llm
from app.prompts import parse_ai_response, CRITICAL_OUTPUT_RULE, INPUT_RULES, OUTPUT_RULES, WRITER_STYLE_RULE

router = APIRouter()
logger = logging.getLogger(__name__)

redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

RECENT_DIALOGUE_LIMIT = 20
DB_SYNC_INTERVAL = 5


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


# ── Redis 조회 헬퍼 (DB fallback 포함) ────────────────────
async def get_context(chat_id: str, db: AsyncSession) -> dict:
    history_raw = await redis_client.lrange(key_history(chat_id), 0, RECENT_DIALOGUE_LIMIT - 1)
    state      = await redis_client.get(key_state(chat_id))
    characters = await redis_client.get(key_characters(chat_id)) or ""
    summary    = await redis_client.get(key_summary(chat_id))

    if state is None or summary is None:
        try:
            session_uuid = uuid.UUID(chat_id)
            session_result = await db.execute(select(Session).where(Session.id == session_uuid))
            session = session_result.scalar_one_or_none()
            if session:
                if state is None:
                    state = session.current_state or ""
                    if state:
                        await redis_client.set(key_state(chat_id), state)
                        logger.info("Redis state 복원 - chat_id=%s", chat_id)
                if summary is None:
                    summary = session.story_summary or ""
                    if summary:
                        await redis_client.set(key_summary(chat_id), summary)
                        logger.info("Redis summary 복원 - chat_id=%s", chat_id)
        except (ValueError, Exception) as e:
            logger.warning("DB fallback 실패 - chat_id=%s: %s", chat_id, e)

    state   = state   or ""
    summary = summary or ""

    if not history_raw:
        try:
            session_uuid = uuid.UUID(chat_id)
            rows = await db.execute(
                select(Dialogue)
                .where(Dialogue.session_id == session_uuid)
                .order_by(Dialogue.turn_order.desc())
                .limit(RECENT_DIALOGUE_LIMIT)
            )
            dialogues = list(reversed(rows.scalars().all()))
            if dialogues:
                for d in dialogues:
                    role = "user" if d.speaker_type == SpeakerType.USER else "ai"
                    entry = json.dumps({"role": role, "content": d.content}, ensure_ascii=False)
                    await redis_client.rpush(key_history(chat_id), entry)
                await redis_client.ltrim(key_history(chat_id), 0, RECENT_DIALOGUE_LIMIT - 1)
                history_raw = await redis_client.lrange(key_history(chat_id), 0, RECENT_DIALOGUE_LIMIT - 1)
                logger.info("Redis history 복원 - chat_id=%s (%d개)", chat_id, len(dialogues))
        except (ValueError, Exception) as e:
            logger.warning("history DB fallback 실패 - chat_id=%s: %s", chat_id, e)

    history = [json.loads(item) for item in history_raw]
    return {
        "history":    history,
        "state":      state,
        "characters": characters,
        "summary":    summary,
    }


async def init_context_if_empty(chat_id: str, state: str, characters: str, summary: str):
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
    state   = await redis_client.get(key_state(chat_id))   or ""
    summary = await redis_client.get(key_summary(chat_id)) or ""
    try:
        session_uuid = uuid.UUID(chat_id)
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Session).where(Session.id == session_uuid))
            session = result.scalar_one_or_none()
            if session:
                session.current_state = state
                session.story_summary = summary
                await db.commit()
                logger.info("DB 동기화 완료 - chat_id=%s", chat_id)
    except (ValueError, Exception) as e:
        logger.error("DB 동기화 실패 - chat_id=%s: %s", chat_id, e)


# ── 메시지 빌더 ────────────────────────────────────────────
def build_messages(
    persona_id: str,
    world_context: str,
    mode: str,
    context: dict,
    user_input: str,
) -> list[dict]:
    author_rules = get_author_prompt(
        persona_id=persona_id,
        world_context=world_context,
        mode=mode,
    )
    system = "\n\n".join([
        CRITICAL_OUTPUT_RULE,
        OUTPUT_RULES,
        INPUT_RULES,
        WRITER_STYLE_RULE,
        author_rules,
    ])
    messages: list[dict] = [{"role": "system", "content": system}]

    context_parts = []
    if context["characters"]:
        context_parts.append(f"[주요 등장인물]\n{context['characters']}")
    if context["summary"]:
        context_parts.append(f"[사건 요약]\n{context['summary']}")
    if context["state"]:
        context_parts.append(f"[현재 상태]\n{context['state']}")

    for h in reversed(context["history"]):
        role = "user" if h["role"] == "user" else "assistant"
        messages.append({"role": role, "content": h["content"]})

    prefix = "\n\n".join(context_parts)
    if prefix:
        user_content = f"{prefix}\n\n사용자 입력: {user_input}"
    else:
        user_content = user_input or "(오프닝 서술을 시작해주세요)"

    messages.append({"role": "user", "content": user_content})
    return messages


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
    db: AsyncSession = Depends(get_db),
):
    await init_context_if_empty(
        chat_id,
        body.initial_state,
        body.initial_characters,
        body.initial_summary,
    )

    turn = await append_history(chat_id, "user", body.content)

    message_id = f"msg_{uuid.uuid4().hex[:8]}"
    try:
        session_uuid = uuid.UUID(chat_id)
        session_result = await db.execute(select(Session).where(Session.id == session_uuid))
        if session_result.scalar_one_or_none():
            count_result = await db.execute(
                select(func.count()).select_from(Dialogue).where(Dialogue.session_id == session_uuid)
            )
            turn_count = count_result.scalar()
            dialogue = Dialogue(
                session_id=session_uuid,
                speaker_type=SpeakerType.USER,
                content=body.content,
                turn_order=turn_count,
            )
            db.add(dialogue)
            await db.flush()
            message_id = str(dialogue.id)
    except (ValueError, Exception):
        pass

    logger.info("메시지 수신 - chat_id=%s turn=%d", chat_id, turn)
    return {"messageId": message_id, "status": "queued", "turn": turn}


@router.get("/{chat_id}/stream")
async def stream_response(
    chat_id: str,
    content: str = "",
    character_id: str = "baekya",
    world_context: str = "",
    mode: str = "author",
    db: AsyncSession = Depends(get_db),
):
    message_id = f"msg_{uuid.uuid4().hex[:8]}"
    context = await get_context(chat_id, db)
    # send_message가 이미 현재 사용자 메시지를 history에 저장했으므로 제거
    # (build_messages가 user_input으로 다시 추가하기 때문에 중복 방지)
    if context["history"] and context["history"][0].get("role") == "user":
        context["history"] = context["history"][1:]

    async def generate():
        try:
            messages = build_messages(
                persona_id=character_id,
                world_context=world_context,
                mode=mode,
                context=context,
                user_input=content,
            )

            # ── 전송 프롬프트 로그 ──────────────────────────────────
            logger.info("┌─ PROMPT (%d messages) ─────────────────────────────", len(messages))
            for i, m in enumerate(messages):
                role = m["role"].upper()
                body = m["content"]
                if len(body) > 400:
                    body = body[:400] + f"\n... (총 {len(m['content'])}자)"
                logger.info("│ [%d] %s:\n%s", i, role, body)
            logger.info("└───────────────────────────────────────────────────")

            # llm 모듈이 프로바이더(gemini/groq/openai) 선택, 키 로테이션, 폴백을 처리
            system_prompt = messages[0]["content"]
            contents = [
                {"role": "user" if m["role"] == "user" else "model",
                 "parts": [{"text": m["content"]}]}
                for m in messages[1:]
            ]
            usage: list = []
            raw = await llm.generate(system_prompt, contents, usage_out=usage)
            prompt_tokens     = usage[0]["prompt_tokens"]     if usage else 0
            completion_tokens = usage[0]["completion_tokens"] if usage else 0

            # ── 원본 응답 로그 ──────────────────────────────────────
            logger.info("┌─ RAW RESPONSE (tokens: prompt=%d / completion=%d) ─", prompt_tokens, completion_tokens)
            logger.info("│ %s", raw)
            logger.info("└───────────────────────────────────────────────────")

            parsed = parse_ai_response(raw)
            narration     = parsed["narration"]
            dialogue      = parsed["dialogue"]
            state_changes = parsed["state_changes"]
            internal_note = parsed["internal_note"]

            logger.info(
                "PARSED │ narration=%s │ dialogue=%s │ state=%s │ note=%s",
                narration[:60], dialogue[:60], state_changes, internal_note,
            )

            # 상태 갱신: internal_note를 현재 서사 상태로 저장
            if internal_note:
                await update_state(chat_id, internal_note)

            # DB/Redis 저장용 텍스트: narration + 대사 합산
            parts = [narration] if narration else []
            if dialogue:
                parts.append(f'"{dialogue}"')
            reply_text = "\n\n".join(parts)

            turn = await append_history(chat_id, "ai", reply_text)

            try:
                session_uuid = uuid.UUID(chat_id)
                async with AsyncSessionLocal() as save_session:
                    session_result = await save_session.execute(select(Session).where(Session.id == session_uuid))
                    if session_result.scalar_one_or_none():
                        count_result = await save_session.execute(
                            select(func.count()).select_from(Dialogue).where(Dialogue.session_id == session_uuid)
                        )
                        turn_count = count_result.scalar()
                        ai_dialogue = Dialogue(
                            session_id=session_uuid,
                            speaker_type=SpeakerType.CHARACTER,
                            content=reply_text,
                            turn_order=turn_count,
                        )
                        save_session.add(ai_dialogue)

                        api_log = ApiLog(
                            session_id=session_uuid,
                            endpoint=f"GET /chats/{chat_id}/stream",
                            model_used=PRIMARY_MODEL,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            total_cost=calc_cost(PRIMARY_MODEL, prompt_tokens, completion_tokens),
                        )
                        save_session.add(api_log)
                        await save_session.commit()
                        logger.info(
                            "AI 응답 저장 완료 - chat_id=%s prompt=%d completion=%d",
                            chat_id, prompt_tokens, completion_tokens,
                        )
            except (ValueError, Exception):
                pass

            if turn % DB_SYNC_INTERVAL == 0:
                await sync_to_db(chat_id)

            reply_payload = json.dumps(
                {"messageId": message_id, "narration": narration, "dialogue": dialogue},
                ensure_ascii=False,
            )
            yield f"event: reply\ndata: {reply_payload}\n\n"

        except Exception as e:
            logger.error("OpenAI API 오류: %s", e)
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
