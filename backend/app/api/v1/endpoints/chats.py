import json
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db, AsyncSessionLocal
from app.models.api_log import ApiLog
from app.models.dialogue import Dialogue, SpeakerType
from app.models.session import Session
from app.models.user import User
from app.models.world import World
from app.models.character import Character
from app.services.chat_context import (
    redis_client,
    get_context, init_context_if_empty,
    append_history, update_state,
    key_memos,
    PROMPT_HISTORY_LIMIT, DB_SYNC_INTERVAL,
)
from app.services.llm_router import calc_cost, PRIMARY_MODEL
from app.services import llm
from app.services import memory
from app.services import consistency
from app.core.personas import get_author_prompt
from app.services.tts import synthesize, extract_first_sentence
import base64
from app.prompts import (
    parse_ai_response, CRITICAL_OUTPUT_RULE, INPUT_RULES, OUTPUT_RULES,
    WRITER_STYLE_RULE, ASSISTANT_SUGGEST_SYSTEM, STUCK_HELP_SYSTEM,
    build_multi_npc_prompt, VOICE_PROFILE_SYSTEM, build_voice_suggest_prompt,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ── 세계관·등장인물 DB 조회 ────────────────────────────────────
async def _build_world_context(chat_id: str, db: AsyncSession) -> str:
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
    if session.story_summary:
        parts.append(f"[지금까지의 줄거리]\n{session.story_summary}")
    return "\n".join(parts)


# ── 메시지 빌더 ────────────────────────────────────────────────
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
        memo_texts = [m["text"] if isinstance(m, dict) else str(m) for m in context["memos"]]
        memo_lines = "\n".join(f"- {t}" for t in memo_texts)
        context_parts.append(f"[작가 메모 — 반드시 반영할 것]\n{memo_lines}")
    if relevant_memories:
        mem_lines = "\n".join(f"- {m}" for m in relevant_memories)
        context_parts.append(f"[관련 기억] (과거 대화에서 검색됨)\n{mem_lines}")
    if context["state"]:
        context_parts.append(f"[현재 상태]\n{context['state']}")

    recent_history = context["history"][:PROMPT_HISTORY_LIMIT]
    for h in reversed(recent_history):
        role = "user" if h["role"] == "user" else "assistant"
        messages.append({"role": role, "content": h["content"]})

    prefix = "\n\n".join(context_parts)
    user_content = f"{prefix}\n\n사용자 입력: {user_input}" if prefix else (
        user_input or "(오프닝 서술을 시작해주세요)"
    )
    messages.append({"role": "user", "content": user_content})
    return messages


# ── API ───────────────────────────────────────────────────────
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
        chat_id, body.initial_state, body.initial_characters, body.initial_summary,
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
            dialogue = Dialogue(
                session_id=session_uuid,
                speaker_type=SpeakerType.USER,
                content=body.content,
                turn_order=count_result.scalar(),
            )
            db.add(dialogue)
            await db.flush()
            message_id = str(dialogue.id)
    except Exception:
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
    use_rag: bool = True,
    check_consistency: bool = False,
    db: AsyncSession = Depends(get_db),
):
    message_id = f"msg_{uuid.uuid4().hex[:8]}"
    context = await get_context(chat_id, db)
    if context["history"] and context["history"][0].get("role") == "user":
        context["history"] = context["history"][1:]
    if not world_context:
        world_context = await _build_world_context(chat_id, db)

    relevant_memories: list[str] = []
    if use_rag:
        try:
            relevant_memories = await memory.retrieve_relevant(chat_id, db, content)
            if relevant_memories:
                logger.info("관련 기억 %d건 - chat_id=%s", len(relevant_memories), chat_id)
        except Exception as e:
            logger.warning("기억 검색 실패: %s", e)

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

            logger.info("┌─ PROMPT (%d messages) ─────────────────────────────", len(messages))
            for i, m in enumerate(messages):
                body_text = m["content"]
                if len(body_text) > 400:
                    body_text = body_text[:400] + f"\n... (총 {len(m['content'])}자)"
                logger.info("│ [%d] %s:\n%s", i, m["role"].upper(), body_text)
            logger.info("└───────────────────────────────────────────────────")

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

            logger.info("┌─ RAW RESPONSE (prompt=%d / completion=%d) ─", prompt_tokens, completion_tokens)
            logger.info("│ %s", raw)
            logger.info("└───────────────────────────────────────────────────")

            parsed        = parse_ai_response(raw)
            narration     = parsed["narration"]
            dialogue      = parsed["dialogue"]
            state_changes = parsed["state_changes"]
            internal_note = parsed["internal_note"]

            logger.info("PARSED │ narration=%s │ dialogue=%s │ state=%s",
                        narration[:60], dialogue[:60], state_changes)

            if internal_note:
                await update_state(chat_id, internal_note)

            parts = [narration] if narration else []
            if dialogue:
                parts.append(f'"{dialogue}"')
            reply_text = "\n\n".join(parts)

            consistency_result = {"consistent": True, "violations": []}
            if check_consistency:
                facts = world_context
                if relevant_memories:
                    facts += "\n[관련 기억]\n" + "\n".join(f"- {m}" for m in relevant_memories)
                consistency_result = await consistency.check(facts, reply_text)

            turn = await append_history(chat_id, "ai", reply_text)

            try:
                session_uuid = uuid.UUID(chat_id)
                async with AsyncSessionLocal() as save_session:
                    session_result = await save_session.execute(
                        select(Session).where(Session.id == session_uuid)
                    )
<<<<<<< HEAD
                    session = session_result.scalar_one_or_none()

                    if session:
                        count_result = await save_session.execute(
                            select(func.count()).select_from(Dialogue)
                            .where(Dialogue.session_id == session_uuid)
                        )
                        save_session.add(Dialogue(
                            session_id=session_uuid,
                            speaker_type=SpeakerType.CHARACTER,
                            content=reply_text,
                            turn_order=count_result.scalar(),
                        ))
                        save_session.add(ApiLog(
                            session_id=session_uuid,
                            user_id=session.user_id,
                            endpoint=f"GET /chats/{chat_id}/stream",
                            model_used=PRIMARY_MODEL,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            total_cost=calc_cost(PRIMARY_MODEL, prompt_tokens, completion_tokens),
                        ))
                        await save_session.commit()
            except Exception as e:
                logger.warning("대화/토큰 로그 저장 실패: %s", e)

            if turn % DB_SYNC_INTERVAL == 0:
                recent_turns = list(reversed(context["history"])) + [
                    {"role": "user", "content": content},
                    {"role": "ai", "content": reply_text},
                ]
                try:
                    async with AsyncSessionLocal() as mem_session:
                        await memory.refresh_session_summary(chat_id, mem_session, recent_turns)
                except Exception as e:
                    logger.warning("요약 갱신 실패: %s", e)

            # reply(텍스트) 먼저 즉시 전달 — TTS 변환을 기다리지 않는다
            reply_payload = json.dumps(
                {"messageId": message_id, "narration": narration, "dialogue": dialogue,
                 "memories": relevant_memories, "consistency": consistency_result},
                ensure_ascii=False,
            )
            yield f"event: reply\ndata: {reply_payload}\n\n"

            # F-AV-02: TTS — narration 첫 문장을 음성으로 변환해 별도 event:audio로 전달
            # 텍스트는 위에서 이미 나갔으므로 음성 변환(1~2s) 지연이 텍스트를 막지 않는다.
            try:
                first_sentence = extract_first_sentence(narration)
                if first_sentence:
                    # author_id: character_id(str) → int 변환
                    _id_map = {"baekya": 1, "charoun": 2, "hanyeoreum": 3, "kimdohyeon": 4}
                    author_id = _id_map.get(character_id, 1)
                    audio_bytes = await synthesize(first_sentence, author_id)
                    if audio_bytes:  # 키 없거나 빈 결과면 음성 스킵
                        audio_payload = json.dumps(
                            {"messageId": message_id, "audio": base64.b64encode(audio_bytes).decode()},
                            ensure_ascii=False,
                        )
                        yield f"event: audio\ndata: {audio_payload}\n\n"
            except Exception as e:
                logger.warning("TTS 변환 실패 (음성 없이 진행): %s", e)

        except Exception as e:
            logger.error("스트림 오류: %s", e)
            yield f"event: error\ndata: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
        finally:
            yield f"event: done\ndata: {json.dumps({'messageId': message_id}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.patch("/{chat_id}/state")
async def update_chat_state(chat_id: str, new_state: str):
    await update_state(chat_id, new_state)
    return {"status": "updated"}


# ── 대사 추천 ──────────────────────────────────────────────────
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
    world_context = body.world_context or await _build_world_context(chat_id, db)

    recent = list(reversed(context["history"]))[-6:] if context["history"] else []
    history_section = (
        "[최근 대화]\n" + "\n".join(
            f"{'주인공' if h['role'] == 'user' else '작가AI'}: {h['content'][:80]}"
            for h in recent
        ) + "\n\n"
    ) if recent else ""

    user_prompt = (
        f"[세계관]\n{world_context}\n\n"
        f"{history_section}"
        "세계관과 대화 흐름을 바탕으로 주인공이 지금 직접 말할 수 있는 대사 3가지를 추천해주세요.\n"
        "반드시 주인공 1인칭 시점의 실제 대사여야 합니다. '~해보자', '~확인하자' 같은 행동 지시문 절대 금지.\n"
        '반드시 JSON만 출력: {"suggestions": ["대사1", "대사2", "대사3"]}'
    )

    contents = [{"role": "user", "parts": [{"text": user_prompt}]}]
    try:
        import re as _re
        raw = await llm.generate(ASSISTANT_SUGGEST_SYSTEM, contents)
        cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=_re.MULTILINE)
        data = json.loads(cleaned)
        suggestions = [s for s in (data.get("suggestions") or []) if isinstance(s, str) and s.strip()][:3]
        if len(suggestions) == 3:
            return {"suggestions": suggestions}
    except Exception as e:
        logger.warning("추천 생성 실패: %s", e)

    return {"suggestions": []}


# ── 작가 메모 (Redis GET/PUT) ──────────────────────────────────
class MemosBody(BaseModel):
    memos: list = []


@router.get("/{chat_id}/memos")
async def list_memos(chat_id: str):
    raw = await redis_client.get(key_memos(chat_id))
    if not raw:
        return {"memos": []}
    try:
        return {"memos": json.loads(raw)}
    except Exception:
        return {"memos": []}


class StuckRequest(BaseModel):
    world_context: str = ""


class NpcInfo(BaseModel):
    name: str
    personality: str = ""
    relationship: str = ""


class NpcReactRequest(BaseModel):
    world_context: str = ""
    npcs: list[NpcInfo]
    recent_dialogue: str = ""


@router.post("/{chat_id}/stuck")
async def stuck_help(
    chat_id: str,
    body: StuckRequest,
    db: AsyncSession = Depends(get_db),
):
    """창작이 막혔을 때 힌트 3개 제공 (F-AS-02)."""
    context = await get_context(chat_id, db)
    world_context = body.world_context or await _build_world_context(chat_id, db)

    parts = []
    if world_context:
        parts.append(f"[세계관]\n{world_context}")
    if context["history"]:
        recent = "\n".join(
            f"{'사용자' if h['role'] == 'user' else 'AI'}: {h['content']}"
            for h in reversed(context["history"][:6])
        )
        parts.append(f"[최근 대화]\n{recent}")
    user_msg = "\n\n".join(parts) or "(아직 대화가 없습니다. 도입 상황에서 막혔다고 가정하세요.)"

    try:
        raw = await llm.generate(
            STUCK_HELP_SYSTEM,
            [{"role": "user", "parts": [{"text": user_msg}]}],
        )
        import re as _re
        cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=_re.MULTILINE)
        data = json.loads(cleaned)
        return {"situation": data.get("situation", ""), "hints": data.get("hints", [])}
    except Exception as e:
        logger.warning("막힘 도우미 실패 - chat_id=%s: %s", chat_id, e)
        return {"situation": "", "hints": []}


@router.post("/{chat_id}/npc-react")
async def npc_react(
    chat_id: str,
    body: NpcReactRequest,
    db: AsyncSession = Depends(get_db),
):
    """조연 NPC들의 다중 반응 생성 (F-CH-09)."""
    world_context = body.world_context or await _build_world_context(chat_id, db)

    recent_dialogue = body.recent_dialogue
    if not recent_dialogue:
        context = await get_context(chat_id, db)
        if context["history"]:
            recent_dialogue = "\n".join(
                f"{'사용자' if h['role'] == 'user' else 'AI'}: {h['content']}"
                for h in reversed(context["history"][:4])
            )

    npcs_list = [n.model_dump() for n in body.npcs]
    system_prompt = build_multi_npc_prompt(world_context, npcs_list, recent_dialogue)

    try:
        raw = await llm.generate(
            system_prompt,
            [{"role": "user", "parts": [{"text": "위 조연들의 반응을 JSON으로 출력하세요."}]}],
        )
        import re as _re
        cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=_re.MULTILINE)
        data = json.loads(cleaned)
        return {
            "narration": data.get("narration", ""),
            "responses": data.get("responses", []),
            "state_changes": data.get("state_changes", {"trust_delta": 0, "event": None}),
        }
    except Exception as e:
        logger.warning("NPC 반응 생성 실패 - chat_id=%s: %s", chat_id, e)
        return {"narration": "", "responses": [], "state_changes": {"trust_delta": 0, "event": None}}


class VoiceProfileRequest(BaseModel):
    user_samples: list[str] = []      # 자유 입력 문장
    guide_answers: list[str] = []     # 가이드 문장에 대한 사용자 답변
    optional_context: str = ""        # 원하는 말투 방향 (선택)


class VoiceSuggestRequest(BaseModel):
    npc_dialogue: str
    scene_summary: str = ""
    genre: str = ""
    relationship_summary: str = ""    # 사용자-등장인물 관계
    character_profile: str = ""       # 상대 등장인물 정보
    user_intent: str = ""             # 사용자가 원하는 반응 방향
    user_emotion: str = ""            # 사용자의 현재 감정
    constraints: str = ""             # 서비스 정책 또는 장면 제한


@router.post("/{chat_id}/voice-profile")
async def analyze_voice_profile(
    chat_id: str,
    body: VoiceProfileRequest,
    db: AsyncSession = Depends(get_db),
):
    """사용자 샘플 문장 → 말투 프로파일 JSON 생성 후 User DB 저장 (Voice Mirroring)."""
    if not body.user_samples and not body.guide_answers:
        raise HTTPException(status_code=422, detail="user_samples 또는 guide_answers를 1개 이상 입력하세요.")

    # chat_id(=session_id)로 user_id 조회
    session_result = await db.execute(select(Session).where(Session.id == uuid.UUID(chat_id)))
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")

    parts = []
    if body.user_samples:
        parts.append("[자유 입력 문장]\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(body.user_samples)))
    if body.guide_answers:
        parts.append("[가이드 문장 답변]\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(body.guide_answers)))
    if body.optional_context:
        parts.append(f"[원하는 말투 방향]\n{body.optional_context}")
    user_msg = "\n\n".join(parts)

    try:
        raw = await llm.generate(
            VOICE_PROFILE_SYSTEM,
            [{"role": "user", "parts": [{"text": user_msg}]}],
        )
        import re as _re
        cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=_re.MULTILINE)
        profile = json.loads(cleaned)
    except Exception as e:
        logger.warning("말투 분석 실패 - chat_id=%s: %s", chat_id, e)
        raise HTTPException(status_code=500, detail="말투 분석 중 오류가 발생했습니다.")

    # User 테이블에 영구 저장
    user_result = await db.execute(select(User).where(User.id == session.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")
    user.voice_profile = profile
    await db.flush()

    logger.info("말투 프로파일 저장 - user_id=%s", session.user_id)
    return {"voice_profile": profile}


@router.post("/{chat_id}/voice-suggest")
async def voice_suggest(
    chat_id: str,
    body: VoiceSuggestRequest,
    db: AsyncSession = Depends(get_db),
):
    """저장된 말투 프로파일 기반으로 사용자 다음 대사 5개 추천 (Voice Mirroring)."""
    # chat_id(=session_id)로 user_id 조회 → User.voice_profile 로드
    session_result = await db.execute(select(Session).where(Session.id == uuid.UUID(chat_id)))
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")

    user_result = await db.execute(select(User).where(User.id == session.user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.voice_profile:
        raise HTTPException(status_code=404, detail="말투 프로파일이 없습니다. /voice-profile을 먼저 호출하세요.")

    voice_profile = user.voice_profile

    scene_summary = body.scene_summary
    if not scene_summary:
        context = await get_context(chat_id, db)
        if context["history"]:
            scene_summary = "\n".join(
                f"{'사용자' if h['role'] == 'user' else 'AI'}: {h['content']}"
                for h in reversed(context["history"][:4])
            )

    system_prompt = build_voice_suggest_prompt(
        voice_profile=voice_profile,
        scene_summary=scene_summary,
        npc_dialogue=body.npc_dialogue,
        genre=body.genre,
        relationship_summary=body.relationship_summary,
        character_profile=body.character_profile,
        user_intent=body.user_intent,
        user_emotion=body.user_emotion,
        constraints=body.constraints,
    )

    try:
        raw = await llm.generate(
            system_prompt,
            [{"role": "user", "parts": [{"text": "위 상황에서 사용자 대사 후보 5개를 JSON으로 출력하세요."}]}],
        )
        import re as _re
        cleaned = _re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=_re.MULTILINE)
        data = json.loads(cleaned)
        return {"suggestions": data.get("suggestions", [])}
    except Exception as e:
        logger.warning("대사 추천 실패 - chat_id=%s: %s", chat_id, e)
        return {"suggestions": []}


@router.delete("/{chat_id}/memo/{index}")
async def delete_memo(chat_id: str, index: int):
    """index번째 메모 삭제 (Redis 리스트에서 제거)."""
    memos = await redis_client.lrange(key_memos(chat_id), 0, -1)
    if 0 <= index < len(memos):
        target = memos[index]
        await redis_client.lrem(key_memos(chat_id), 1, target)
    return {"memos": await redis_client.lrange(key_memos(chat_id), 0, -1)}


@router.put("/{chat_id}/memos", status_code=200)
async def save_memos(chat_id: str, body: MemosBody):
    await redis_client.set(key_memos(chat_id), json.dumps(body.memos, ensure_ascii=False))
    return {"status": "saved", "count": len(body.memos)}
