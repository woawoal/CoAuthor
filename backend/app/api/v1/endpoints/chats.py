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
from app.database import get_db, AsyncSessionLocal
from app.models.api_log import ApiLog
from app.models.dialogue import Dialogue, SpeakerType
from app.models.session import Session
from app.models.world import World
from app.models.character import Character
from app.services.llm_router import calc_cost, PRIMARY_MODEL
from app.services import llm
from app.services import memory
from app.services import consistency  # 설정 일관성 검수 (F-QC-01)
from app.core.personas import get_author_prompt
from app.prompts import (
    parse_ai_response, CRITICAL_OUTPUT_RULE, INPUT_RULES, OUTPUT_RULES,
    WRITER_STYLE_RULE, ASSISTANT_SUGGEST_SYSTEM,
)

router = APIRouter()
logger = logging.getLogger(__name__)

redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

RECENT_DIALOGUE_LIMIT = 20   # Redis에 유지하는 최근 대화 수
PROMPT_HISTORY_LIMIT = 10    # 프롬프트에 verbatim으로 넣는 최근 대화 수 (그 이전은 요약+RAG가 커버 → 토큰 절약)
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

def key_memos(chat_id: str) -> str:
    return f"session:{chat_id}:memos"


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
    memos = await redis_client.lrange(key_memos(chat_id), 0, -1)
    return {
        "history":    history,
        "state":      state,
        "characters": characters,
        "summary":    summary,
        "memos":      memos,
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
    relevant_memories: list[str] | None = None,
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
    if context.get("memos"):
        memo_lines = "\n".join(f"- {m}" for m in context["memos"])
        context_parts.append(f"[작가 메모 — 반드시 반영할 것]\n{memo_lines}")
    if relevant_memories:
        mem_lines = "\n".join(f"- {m}" for m in relevant_memories)
        context_parts.append(f"[관련 기억] (과거 대화에서 검색됨, 일관성 유지에 활용)\n{mem_lines}")
    if context["state"]:
        context_parts.append(f"[현재 상태]\n{context['state']}")

    # 토큰 절약: 최근 PROMPT_HISTORY_LIMIT개만 verbatim 주입 (그 이전은 요약/RAG가 커버)
    recent_history = context["history"][:PROMPT_HISTORY_LIMIT]
    for h in reversed(recent_history):
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


async def _build_world_context(chat_id: str, db: AsyncSession) -> str:
    """chat_id(세션)로 세계관·등장인물을 DB에서 조회해 프롬프트용 문자열로 구성."""
    try:
        sid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        return ""
    session = (await db.execute(select(Session).where(Session.id == sid))).scalar_one_or_none()
    if not session:
        return ""
    world = (await db.execute(select(World).where(World.id == session.world_id))).scalar_one_or_none()
    chars = (await db.execute(select(Character).where(Character.world_id == session.world_id))).scalars().all()
    parts = []
    if world:
        for label, val in (("제목", world.title), ("장르", world.genre),
                           ("배경", world.setting), ("요약", world.description), ("규칙", world.rules)):
            if val:
                parts.append(f"{label}: {val}")
    if chars:
        lines = "\n".join(
            f"- {c.name} ({getattr(c.role, 'value', c.role)}): {c.personality}" for c in chars
        )
        parts.append(f"[등장인물]\n{lines}")
    # RAG-lite: 누적된 줄거리 요약(장기 기억)을 주입해 긴 대화에서도 일관성 유지
    if session.story_summary:
        parts.append(f"[지금까지의 줄거리]\n{session.story_summary}")
    return "\n".join(parts)


@router.get("/{chat_id}/stream")
async def stream_response(
    chat_id: str,
    content: str = "",
    character_id: str = "baekya",
    world_context: str = "",
    mode: str = "author",
    use_rag: bool = True,
    check_consistency: bool = False,
    db: AsyncSession = Depends(get_db),
):
    message_id = f"msg_{uuid.uuid4().hex[:8]}"
    context = await get_context(chat_id, db)
    # send_message가 이미 현재 사용자 메시지를 history에 저장했으므로 제거
    if context["history"] and context["history"][0].get("role") == "user":
        context["history"] = context["history"][1:]
    # 프론트가 world_context를 안 보내면 세션에서 세계관·등장인물을 직접 조회해 주입
    if not world_context:
        world_context = await _build_world_context(chat_id, db)

    # RAG: 현재 입력과 관련된 '오래된' 과거 대화를 검색해 보강 (요약이 놓친 구체 사건)
    # use_rag=false 면 검색을 건너뛴다(시연/디버깅용 대조).
    relevant_memories: list[str] = []
    if use_rag:
        try:
            relevant_memories = await memory.retrieve_relevant(chat_id, db, content)
            if relevant_memories:
                logger.info("관련 기억 %d건 검색 - chat_id=%s: %s",
                            len(relevant_memories), chat_id, [m[:30] for m in relevant_memories])
        except Exception as e:
            logger.warning("기억 검색 실패(보강 생략): %s", e)

    async def generate():
        try:
            messages = build_messages(
                persona_id=character_id,
                world_context=world_context,
                mode=mode,
                context=context,
                user_input=content,
                relevant_memories=relevant_memories,
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
            raw = await llm.generate(system_prompt, contents, usage_out=usage, json_mode=True)
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

            # F-QC-01: 일관성 검수(옵션) — 새 응답이 확립된 설정·기억과 모순되는지
            consistency_result = {"consistent": True, "violations": []}
            if check_consistency:
                facts = world_context
                if relevant_memories:
                    facts += "\n[관련 기억]\n" + "\n".join(f"- {m}" for m in relevant_memories)
                consistency_result = await consistency.check(facts, reply_text)
                if not consistency_result["consistent"]:
                    logger.info("⚠️ 일관성 위반 %d건 - chat_id=%s: %s",
                                len(consistency_result["violations"]), chat_id,
                                consistency_result["violations"])

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

            # RAG-lite: N턴마다 누적 요약 갱신 (이전 요약 + 최근 대화만 재요약 → 토큰 절약)
            if turn % DB_SYNC_INTERVAL == 0:
                recent_turns = list(reversed(context["history"])) + [
                    {"role": "user", "content": content},
                    {"role": "ai", "content": reply_text},
                ]
                try:
                    async with AsyncSessionLocal() as mem_session:
                        await memory.refresh_session_summary(chat_id, mem_session, recent_turns)
                except Exception as e:  # 요약 실패는 대화 흐름을 막지 않는다
                    logger.warning("요약 갱신 실패: %s", e)

            reply_payload = json.dumps(
                {"messageId": message_id, "narration": narration, "dialogue": dialogue,
                 "memories": relevant_memories, "consistency": consistency_result},
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


class SuggestRequest(BaseModel):
    character_id: str = "baekya"
    world_context: str = ""


@router.post("/{chat_id}/suggestions")
async def get_suggestions(
    chat_id: str,
    body: SuggestRequest,
    db: AsyncSession = Depends(get_db),
):
    context = await get_context(chat_id, db)
    if not context["history"]:
        return {"suggestions": ["안녕하세요.", "시작해볼까요?", "어떤 이야기를 쓸까요?"]}

    world_context = body.world_context or await _build_world_context(chat_id, db)

    recent = list(reversed(context["history"]))[-6:]
    history_text = "\n".join(
        f"{'주인공' if h['role'] == 'user' else '작가AI'}: {h['content'][:80]}"
        for h in recent
    )

    system_prompt = (
        "당신은 인터랙티브 소설에서 사용자(주인공)가 다음에 할 말이나 행동을 추천해주는 어시스턴트입니다.\n"
        "반드시 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요."
    )
    user_prompt = (
        f"[세계관]\n{world_context}\n\n"
        f"[최근 대화]\n{history_text}\n\n"
        "위 대화 흐름을 보고 주인공이 다음에 할 수 있는 말이나 행동 3가지를 추천해주세요.\n"
        "각 추천은 짧고 자연스러운 한국어 한 문장(20자 이내)이어야 합니다.\n"
        '{"suggestions": ["추천1", "추천2", "추천3"]}'
    )

    contents = [{"role": "user", "parts": [{"text": user_prompt}]}]
    try:
        raw = await llm.generate(system_prompt, contents)
        raw = raw.strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:-1])
        data = json.loads(raw)
        suggestions = data.get("suggestions", [])[:3]
        if len(suggestions) == 3:
            return {"suggestions": suggestions}
    except Exception as e:
        logger.warning("추천 생성 실패: %s", e)

    return {"suggestions": ["계속해볼까요?", "잠깐 기다려요.", "다른 방법이 있을 것 같아요."]}


# ── 작가 메모 (F-CH-11) ────────────────────────────────────
class MemoRequest(BaseModel):
    note: str


@router.post("/{chat_id}/memo", status_code=201)
async def add_memo(chat_id: str, body: MemoRequest):
    """작가 메모 추가 → 이후 AI 응답 프롬프트에 [작가 메모]로 주입된다."""
    note = (body.note or "").strip()
    if not note:
        return {"status": "empty", "memos": await redis_client.lrange(key_memos(chat_id), 0, -1)}
    await redis_client.rpush(key_memos(chat_id), note)
    memos = await redis_client.lrange(key_memos(chat_id), 0, -1)
    logger.info("작가 메모 추가 - chat_id=%s (총 %d개)", chat_id, len(memos))
    return {"status": "added", "memos": memos}


@router.get("/{chat_id}/memos")
async def list_memos(chat_id: str):
    """현재 세션의 작가 메모 목록."""
    return {"memos": await redis_client.lrange(key_memos(chat_id), 0, -1)}


# ── AI 어시스턴트: 다음 전개 제안 (F-AS-01~03) ─────────────
@router.get("/{chat_id}/suggest")
async def suggest_next(
    chat_id: str,
    world_context: str = "",
    db: AsyncSession = Depends(get_db),
):
    """막혔을 때 다음 전개(주인공 행동/대사) 후보 3개를 제안. 입력이 없을 때 '유도'용."""
    context = await get_context(chat_id, db)
    if not world_context:
        world_context = await _build_world_context(chat_id, db)

    parts = []
    if world_context:
        parts.append(f"[세계관]\n{world_context}")
    if context["history"]:
        recent = "\n".join(
            f"{'사용자' if h['role'] == 'user' else 'AI'}: {h['content']}"
            for h in reversed(context["history"][:6])
        )
        parts.append(f"[최근 대화]\n{recent}")
    user_msg = "\n\n".join(parts) or "(아직 대화가 없습니다. 도입 상황에서 시작할 행동을 제안하세요.)"

    try:
        raw = await llm.generate(
            ASSISTANT_SUGGEST_SYSTEM,
            [{"role": "user", "parts": [{"text": user_msg}]}],
        )
        import re as _re
        cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=_re.MULTILINE)
        data = json.loads(cleaned)
        suggestions = [s for s in (data.get("suggestions") or []) if isinstance(s, str) and s.strip()][:3]
    except Exception as e:
        logger.warning("제안 생성 실패 - chat_id=%s: %s", chat_id, e)
        suggestions = []
    return {"suggestions": suggestions}


@router.delete("/{chat_id}/memo/{index}")
async def delete_memo(chat_id: str, index: int):
    """index번째 메모 삭제 (Redis 리스트에서 제거)."""
    memos = await redis_client.lrange(key_memos(chat_id), 0, -1)
    if 0 <= index < len(memos):
        target = memos[index]
        await redis_client.lrem(key_memos(chat_id), 1, target)
    return {"memos": await redis_client.lrange(key_memos(chat_id), 0, -1)}
