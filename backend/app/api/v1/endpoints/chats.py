import re
import json
import uuid
import logging

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from app.core.config import settings
from app.core.personas import get_author_prompt, AUTHOR_ID_MAP, reaction_tone
from app.core.reactions import EMOTIONS, pick_reaction  # F-AS-05 작가 리액션 (머지 때 빠졌던 import 복구)
from app.database import get_db, AsyncSessionLocal
from app.models.api_log import ApiLog
from app.models.dialogue import Dialogue, SpeakerType
from app.models.session import Session
from app.models.world import World
from app.models.character import Character
from app.models.user import User
from app.services.llm_router import calc_cost, PRIMARY_MODEL
from app.services import llm
from app.services import memory
from app.services import consistency  # 설정 일관성 검수 (F-QC-01)
from app.services.tts import synthesize, extract_first_sentence
import base64
from app.prompts import (
    parse_ai_response, CRITICAL_OUTPUT_RULE, INPUT_RULES, OUTPUT_RULES,
    WRITER_STYLE_RULE, ASSISTANT_SUGGEST_SYSTEM, STUCK_HELP_SYSTEM,
    build_multi_npc_prompt,
)

router = APIRouter()
logger = logging.getLogger(__name__)

redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)

RECENT_DIALOGUE_LIMIT = 20   # Redis에 유지하는 최근 대화 수
PROMPT_HISTORY_LIMIT = 10    # 프롬프트에 verbatim으로 넣는 최근 대화 수 (그 이전은 요약+RAG가 커버 → 토큰 절약)
DB_SYNC_INTERVAL = 5

PHASE_ORDER = ["도입부", "전개", "절정", "결말"]

# 토큰 스트리밍 중 부분 JSON에서 narration 값만 추출(닫는 따옴표 전까지, 이스케이프 간이 처리).
_NARR_KEY = re.compile(r'"narration"\s*:\s*"')

def _partial_narration(buf: str) -> str:
    m = _NARR_KEY.search(buf)
    if not m:
        return ""
    rest = buf[m.end():]
    out, i, n = [], 0, len(rest)
    while i < n:
        c = rest[i]
        if c == "\\" and i + 1 < n:
            out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\", "/": "/"}.get(rest[i + 1], rest[i + 1]))
            i += 2
            continue
        if c == '"':
            break
        out.append(c)
        i += 1
    return "".join(out)

def _advance_phase(current: str, suggested: str) -> str:
    """LLM이 제안한 phase가 현재보다 앞이면 전진, 뒤(역행)면 현재 유지."""
    try:
        return PHASE_ORDER[max(PHASE_ORDER.index(current), PHASE_ORDER.index(suggested))]
    except ValueError:
        return current or "도입부"


# ── Redis 키 규칙 ──────────────────────────────────────────
def key_history(chat_id: str) -> str:
    return f"session:{chat_id}:history"

def key_state(chat_id: str) -> str:
    return f"session:{chat_id}:state"

def key_characters(chat_id: str) -> str:
    return f"session:{chat_id}:characters"

def key_summary(chat_id: str) -> str:
    return f"session:{chat_id}:summary"
# 작가 리액션(F-AS-05) 직전 반응 추적 키 — chat_context엔 없어 chats.py 전용 정의
def key_last_reaction(chat_id: str) -> str:
    return f"session:{chat_id}:last_reaction"
# 장르 가드 — 사용자가 '판타지로 도입'을 승인하면 이 키를 세팅(이후 턴은 장르 밖 감지 끔)
def key_genre_open(chat_id: str) -> str:
    return f"session:{chat_id}:genre_open"


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
        protagonist = next((c for c in chars if c.id == session.protagonist_id), None)
        ai_chars = [c for c in chars if c.is_ai_controlled and c.id != session.protagonist_id]

        if protagonist:
            parts.append(
                f"[사용자 조종 인물 — AI가 절대 대신 서술하지 않음]\n"
                f"- {protagonist.name} ({getattr(protagonist.role, 'value', protagonist.role)}): {protagonist.personality}\n"
                f"※ 이 인물의 행동·대사·내면은 사용자 입력이 전부입니다. AI는 이 인물의 관점으로 생각하거나 반응을 대신 쓰지 않습니다."
            )
        if ai_chars:
            lines = "\n".join(
                f"- {c.name} ({getattr(c.role, 'value', c.role)}): {c.personality}" for c in ai_chars
            )
            names = ", ".join(c.name for c in ai_chars)
            parts.append(
                f"[AI 서술 인물 — 이 인물들의 반응·대사를 생성]\n{lines}\n"
                f"※ 이 인물들이 **지금 장면에 함께 있을 때만** speaker에 그 이름({names} 중 하나)을 쓴다. "
                f"인물이 떠났거나·자리에 없거나·주인공이 혼자인 장면이면 speaker·dialogue를 빈 문자열로 두고 나레이션만 출력."
            )
        elif not protagonist and chars:
            lines = "\n".join(
                f"- {c.name} ({getattr(c.role, 'value', c.role)}): {c.personality}" for c in chars
            )
            parts.append(f"[등장인물]\n{lines}")
        directive_lines = [
            f"- {c.name}: {c.prompt.strip()}" for c in chars if getattr(c, 'prompt', None) and c.prompt.strip()
        ]
        if directive_lines:
            parts.append("[캐릭터 행동 지시문 — 반드시 따를 것]\n" + "\n".join(directive_lines))
    if session.story_summary:
        parts.append(f"[지금까지의 줄거리]\n{session.story_summary}")
    return "\n".join(parts)

def key_turn(chat_id: str) -> str:
    return f"session:{chat_id}:turn"

def key_memos(chat_id: str) -> str:
    return f"session:{chat_id}:memos"

def key_phase(chat_id: str) -> str:
    return f"session:{chat_id}:phase"

async def _read_memos(chat_id: str) -> list:
    """memos 키를 저장 방식에 관계없이 안전하게 list로 읽는다.
    save_memos(PUT)는 SET(JSON 문자열), 옛 add_memo(POST)는 Redis LIST로 저장하므로
    한쪽 타입으로만 읽으면 WRONGTYPE 500이 난다 → 키 타입을 보고 분기."""
    k = key_memos(chat_id)
    try:
        if await redis_client.type(k) == "list":
            return await redis_client.lrange(k, 0, -1)
        raw = await redis_client.get(k)
        return json.loads(raw) if raw else []
    except Exception as e:
        logger.warning("memos 읽기 실패(빈 목록) - chat_id=%s: %s", chat_id, e)
        return []


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
    memos = await _read_memos(chat_id)
    phase = await redis_client.get(key_phase(chat_id)) or "도입부"
    return {
        "history":    history,
        "state":      state,
        "characters": characters,
        "summary":    summary,
        "memos":      memos,
        "phase":      phase,
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
def _extract_protagonist_name(world_context: str) -> str:
    """world_context에서 [사용자 조종 인물] 이름 추출.

    줄 형식: `- {이름} ({역할}): {성격}` → 이름은 ' (' 또는 ':' 앞까지 전체(공백 포함).
    """
    import re
    m = re.search(r'\[사용자 조종 인물[^\]]*\]\s*\n-\s*(.+?)\s*(?:\(|:)', world_context)
    return m.group(1).strip() if m else ""


def _extract_ai_char_names(world_context: str) -> list[str]:
    """world_context에서 [AI 서술 인물] 이름 목록 추출(멀티워드 이름 보존, 예: '편의점 점장')."""
    import re
    m = re.search(r'\[AI 서술 인물[^\]]*\]\n((?:- .+\n?)+)', world_context)
    if not m:
        return []
    return [n.strip() for n in re.findall(r'^-\s*(.+?)\s*(?:\(|:)', m.group(1), re.MULTILINE)]


def _resolve_speaker(raw: str, ai_names: list[str], protagonist_name: str) -> str:
    """[L1] 출력 화자를 등록된 AI 인물로 강제 보정(모델이 흔들려도 화면 화자는 항상 유효).

    - 빈 값 / 주인공 이름 → ''(나레이션). 주인공 대사는 AI 출력이 아니다.
    - 목록의 정식 이름으로 정규화(공백 무시 매칭 — '박 영감'→'박영감').
    - 등록 안 된 이름(환각·즉석 새 인물) → AI 인물이 유일하면 그 인물, 아니면 ''.
    """
    s = (raw or "").strip()
    if not s:
        return ""
    norm = lambda x: (x or "").replace(" ", "")
    if protagonist_name and norm(s) == norm(protagonist_name):
        return protagonist_name  # 혼자 장면 독백용 — 프론트에서 주인공 버블로 처리
    for name in ai_names:
        if norm(s) == norm(name):
            return name
    return ai_names[0] if len(ai_names) == 1 else ""


def build_messages(
    persona_id: str,
    world_context: str,
    mode: str,
    context: dict,
    user_input: str,
    relevant_memories: list[str] | None = None,
    speaker: str = "",
    genre_open: bool = False,
) -> list[dict]:
    author_rules = get_author_prompt(
        persona_id=persona_id,
        world_context=world_context,
        mode=mode,
    )

    # 주인공(사용자 캐릭터)을 world_context에서 추출해 최상단 규칙으로 주입
    protagonist_name        = _extract_protagonist_name(world_context)
    ai_char_names           = _extract_ai_char_names(world_context)
    ai_names_str            = "·".join(ai_char_names) if ai_char_names else "등록된 AI 인물"
    is_protagonist_speaker  = bool(speaker and protagonist_name and speaker == protagonist_name)
    _SOLO_SIGNALS = ("혼자", "홀로", "텅 빈", "텅빈", "아무도 없", "혼잣말", "독백", "적막")
    _is_solo = (not speaker) and any(s in (user_input or "") for s in _SOLO_SIGNALS)
    if _is_solo:
        _prot = f"({protagonist_name})" if protagonist_name else ""
        protagonist_rule = (
            f"[최우선 규칙 — 혼자 있는 장면]\n"
            f"이번 턴은 주인공{_prot}이 **혼자 있는 장면**이다.\n"
            f"AI는 **어떤 등장인물도 등장시키거나 말하게 하지 않는다.** speaker와 dialogue를 반드시 빈 문자열(\"\")로 둔다.\n"
            f"주인공의 고독·내면·공간(빛·소리·냄새)을 narration으로만 작성한다.\n"
            f"절대 금지: 등록 인물({ai_names_str})을 장면에 끌어들이거나 대사를 만드는 것."
        )
    elif is_protagonist_speaker:
        protagonist_rule = (
            f"[최우선 규칙 — 역할 구분]\n"
            f"이 채팅에서 사용자는 {protagonist_name} 역할을 연기합니다.\n"
            f"이번 턴: {protagonist_name}의 대사 방향만 지시됨. 아직 실제 대사는 결정되지 않음.\n"
            f"[지시] {protagonist_name}이 자연스럽게 할 법한 대사를 `protagonist_dialogue` 필드에 생성하세요.\n"
            f"그 대사에 반응하는 {ai_names_str}의 나레이션·대사를 narration/speaker/dialogue 필드에 생성하세요.\n"
            f"절대 금지: speaker 필드에 {protagonist_name}을 넣는 것 — speaker는 {ai_names_str} 중 하나여야 합니다.\n"
            f"절대 금지: dialogue 필드에 {protagonist_name}의 대사를 넣는 것."
        )
    elif protagonist_name:
        protagonist_rule = (
            f"[최우선 규칙 — 역할 구분]\n"
            f"이 채팅에서 사용자는 {protagonist_name} 역할을 직접 연기합니다.\n"
            f"조연({ai_names_str})이 있는 장면: AI는 조연의 반응·대사만 생성합니다. speaker는 조연 이름.\n"
            f"★ {protagonist_name}이 혼자인 장면: speaker={protagonist_name}, dialogue=독백·내면 한 문장 허용.\n"
            f"절대 금지: {protagonist_name}의 내면·감정·생각을 narration에 서술하는 것.\n"
            f"절대 금지: 조연이 있는 장면에서 speaker에 {protagonist_name}을 넣는 것."
        )
    else:
        protagonist_rule = ""

    # [L2] 화자 고정 — speaker는 등록 인물 enum 안에서만, 새 인물 임의 등장 금지
    if ai_char_names:
        _names = ", ".join(ai_char_names)
        speaker_rule = (
            f"[화자 고정 규칙 — 엄수]\n"
            f"speaker 필드는 반드시 다음 등장인물 중 정확히 하나이거나 빈 문자열(나레이션만)이어야 한다: {_names}.\n"
            f"이 목록에 없는 이름을 speaker에 넣지 말 것.\n"
            f"등록된 등장인물 외의 새 인물을 임의로 등장시키지 말 것 — 스쳐가는 인물이 필요하면 "
            f"narration으로만 묘사하고 speaker에는 쓰지 말 것."
        )
    else:
        speaker_rule = ""

    system = "\n\n".join(filter(None, [
        CRITICAL_OUTPUT_RULE,
        protagonist_rule,
        speaker_rule,
        OUTPUT_RULES,
        INPUT_RULES,
        WRITER_STYLE_RULE,
        author_rules,
    ]))
    messages: list[dict] = [{"role": "system", "content": system}]

    context_parts = []
    # 혼자 장면이면 등장인물 목록을 프롬프트에서 빼서 모델이 끌어들일 인물이 없게 한다
    if context["characters"] and not _is_solo:
        context_parts.append(f"[주요 등장인물]\n{context['characters']}")
    if context["summary"]:
        context_parts.append(f"[사건 요약]\n{context['summary']}")
    if context.get("memos"):
        memo_lines = "\n".join(f"- {m.get('text', '') if isinstance(m, dict) else m}" for m in context["memos"])
        context_parts.append(f"[작가 메모 — 반드시 반영할 것]\n{memo_lines}")
    if relevant_memories:
        mem_lines = "\n".join(f"- {m}" for m in relevant_memories)
        context_parts.append(f"[관련 기억] (과거 대화에서 검색됨, 일관성 유지에 활용)\n{mem_lines}")
    if context["state"]:
        context_parts.append(f"[현재 상태]\n{context['state']}")
    if context.get("phase"):
        context_parts.append(f"[현재 스토리 단계]\n{context['phase']}\n(story_phase는 이 단계 이상만 출력 가능)")
    if genre_open:
        # 사용자가 장르 확장을 허용함 → 장르 가드 끔(out_of_genre 항상 false)
        context_parts.append("[장르 확장 허용됨] 사용자가 장르 밖 요소 도입을 승인함 — out_of_genre는 항상 false로 둔다.")

    # @등장인물: 조연 시점 서사 지시 (주인공/solo 발화 턴은 protagonist_rule에서 처리하므로 스킵)
    if speaker and not is_protagonist_speaker:
        context_parts.append(
            f"[화자 지정] 이번 사용자 입력은 등장인물 '{speaker}'의 대사/행동이다. "
            f"주인공이 아니라 '{speaker}'의 시점에서 그 인물의 서사를 전개하고, "
            f"'{speaker}'의 감정·동기·말투를 살려 장면을 풀어라."
        )

    # 토큰 절약: 최근 PROMPT_HISTORY_LIMIT개만 verbatim 주입 (그 이전은 요약/RAG가 커버)
    recent_history = context["history"][:PROMPT_HISTORY_LIMIT]
    for h in reversed(recent_history):
        role = "user" if h["role"] == "user" else "assistant"
        messages.append({"role": role, "content": h["content"]})

    prefix = "\n\n".join(context_parts)
    ai_label = "·".join(ai_char_names) if ai_char_names else "AI 캐릭터"
    prot_label = protagonist_name or "사용자 캐릭터"
    speaker_prefix = f"{speaker}: " if speaker else ""
    if _is_solo:
        reaction_instruction = (
            f"[{prot_label}의 행동·대사 — 이미 화면에 표시됨. dialogue에 복사 금지]\n"
            f"{user_input}\n\n"
            f"[★최우선 지시 — 혼자 장면] 지금은 **주인공이 혼자 있는 장면**이다. "
            f"{ai_label} 등 **어떤 등장인물도 장면에 등장시키거나 말하게 하지 마라.** "
            f"speaker와 dialogue를 **반드시 빈 문자열(\"\")** 로 두고, 주인공의 고독·내면·공간(빛·소리·냄새)만 "
            f"narration으로 이어가라. 인물을 새로 끌어들이면 규칙 위반이다."
        )
    elif is_protagonist_speaker:
        reaction_instruction = (
            f"[{prot_label}의 행동 방향 — 아직 대사는 결정되지 않음]\n"
            f"{user_input}\n\n"
            f"[지시]\n"
            f"1. 위 상황에서 {speaker}가 자연스럽게 할 법한 대사를 `protagonist_dialogue` 필드에 한 문장으로 생성하세요.\n"
            f"2. 그 대사에 반응하는 {ai_label}의 새로운 대사·행동을 narration/speaker/dialogue 필드에 출력하세요.\n"
            f"`protagonist_dialogue`는 따옴표 없이, {speaker}의 말투로 자연스럽게."
        )
    else:
        reaction_instruction = (
            f"[{prot_label}의 행동·대사 — 이미 화면에 표시됨. 여기 있는 대사를 dialogue 필드에 절대 복사하지 말 것]\n"
            f"{speaker_prefix}{user_input}\n\n"
            f"[지시] 위 내용에 이어지는 장면을 JSON으로 출력하세요. "
            f"{ai_label}이 지금 장면에 함께 있으면 그 인물의 새 대사·행동을 생성하고, "
            f"떠났거나·자리에 없거나·주인공이 혼자인 장면이면 speaker·dialogue를 빈 문자열로 두고 나레이션만 출력하세요."
        )
    if prefix:
        user_content = f"{prefix}\n\n{reaction_instruction}"
    else:
        user_content = reaction_instruction if user_input else "(오프닝 서술을 시작해주세요)"

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
    speaker: str = ""


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
                speaker=body.speaker or None,
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
    speaker: str = "",
    use_rag: bool = True,
    check_consistency: bool = False,
    db: AsyncSession = Depends(get_db),
):
    import time as _time
    _t0 = _time.perf_counter()
    message_id = f"msg_{uuid.uuid4().hex[:8]}"
    context = await get_context(chat_id, db)
    _t_ctx = _time.perf_counter()
    # send_message가 이미 현재 사용자 메시지를 history에 저장했으므로 제거
    # history는 lpush로 저장되어 최신순 정렬 → index 0이 가장 최근 메시지
    if context["history"] and context["history"][0].get("role") == "user":
        context["history"] = context["history"][1:]
    # 세계관 수정 즉시 반영 — 항상 서버 DB에서 재구성(프론트 전송값은 무시).
    # 화자 추출 정규식(_extract_*)이 서버 포맷에만 매칭되므로 서버 권위가 정확.
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
    _t_rag = _time.perf_counter()
    logger.info("[TTFB] context=%.2fs · retrieval=%.2fs", _t_ctx - _t0, _t_rag - _t_ctx)

    # [L1] 출력 화자 검증용 — 등록 인물/주인공 이름을 한 번만 추출(generate 클로저에서 사용)
    _valid_ai_names        = _extract_ai_char_names(world_context)
    _prot_name             = _extract_protagonist_name(world_context)
    _is_protagonist_speaker = bool(speaker and _prot_name and speaker == _prot_name)
    # 장르 가드: 사용자가 이미 장르 확장을 승인했으면 감지 끔
    _genre_open            = bool(await redis_client.get(key_genre_open(chat_id)))

    async def generate():
        try:
            messages = build_messages(
                persona_id=character_id,
                world_context=world_context,
                mode=mode,
                context=context,
                user_input=content,
                relevant_memories=relevant_memories,
                speaker=speaker,
                genre_open=_genre_open,
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
            _t_gen0 = _time.perf_counter()
            # 토큰 스트리밍: 부분 응답에서 narration을 추출해 delta로 즉시 흘림(체감 TTFB↓).
            buf, _last_narr, _first = "", "", True
            async for _piece in llm.stream(system_prompt, contents, usage_out=usage, json_mode=True):
                buf += _piece
                if _first:
                    logger.info("[TTFB] first-token=%.2fs", _time.perf_counter() - _t_gen0)
                    _first = False
                _narr = _partial_narration(buf)
                if _narr and _narr != _last_narr:
                    _last_narr = _narr
                    yield f"event: delta\ndata: {json.dumps({'narration': _narr}, ensure_ascii=False)}\n\n"
            raw = buf
            logger.info("[TTFB] full-generation=%.2fs", _time.perf_counter() - _t_gen0)
            prompt_tokens     = usage[0]["prompt_tokens"]     if usage else 0
            completion_tokens = usage[0]["completion_tokens"] if usage else 0

            # ── 원본 응답 로그 ──────────────────────────────────────
            logger.info("┌─ RAW RESPONSE (tokens: prompt=%d / completion=%d) ─", prompt_tokens, completion_tokens)
            logger.info("│ %s", raw)
            logger.info("└───────────────────────────────────────────────────")

            parsed = parse_ai_response(raw)
            narration            = parsed["narration"]
            # [L1] AI가 정한 화자를 등록 인물로 강제 보정(흔들림 방지). 입력 speaker와 별개 변수.
            reply_speaker        = _resolve_speaker(parsed.get("speaker", ""), _valid_ai_names, _prot_name)
            dialogue             = parsed["dialogue"]
            protagonist_dialogue = parsed.get("protagonist_dialogue", "")
            state_changes        = parsed["state_changes"]
            internal_note        = parsed["internal_note"]
            suggested_phase      = parsed.get("story_phase", "")
            # 장르 가드: 이미 확장 승인된 세션이면 플래그 무시
            out_of_genre         = bool(parsed.get("out_of_genre")) and not _genre_open
            genre_note           = parsed.get("genre_note", "") if out_of_genre else ""

            # [폴백] 주인공 발화 턴인데 AI가 protagonist_dialogue 대신 speaker=주인공+dialogue에 넣은 경우 보정
            if _is_protagonist_speaker and not protagonist_dialogue and dialogue and not reply_speaker:
                protagonist_dialogue = dialogue
                dialogue = ""

            # [나레이션 일관성 강제] AI가 나레이션에 "혼자/아무도 없" 등을 쓰고도
            # 조연을 speaker로 내보내는 모순을 코드 레벨에서 차단
            _SOLO_NARR = ("혼자", "홀로", "텅 빈", "텅빈", "아무도 없", "혼잣말", "독백", "적막")
            if narration and any(sig in narration for sig in _SOLO_NARR):
                if reply_speaker and reply_speaker in _valid_ai_names:
                    logger.info(
                        "나레이션 솔로 신호 → 조연 speaker 강제 제거 (was=%s)", reply_speaker
                    )
                    reply_speaker = ""
                    dialogue = ""

            # story_phase: LLM 제안을 역행 방지 로직으로 적용
            current_phase = await redis_client.get(key_phase(chat_id)) or "도입부"
            new_phase = _advance_phase(current_phase, suggested_phase) if suggested_phase else current_phase
            if new_phase != current_phase:
                await redis_client.set(key_phase(chat_id), new_phase)
                logger.info("스토리 단계 전환 - chat_id=%s: %s → %s", chat_id, current_phase, new_phase)

            logger.info(
                "PARSED │ narration=%s │ dialogue=%s │ state=%s │ phase=%s │ note=%s",
                narration[:60], dialogue[:60], state_changes, new_phase, internal_note,
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

            # ── 응답을 '먼저' 내보낸다 — DB 영구저장·요약은 reply 뒤로 미뤄 TTFB에서 제외 ──
            # DB Dialogue id를 미리 생성해 reply messageId와 실제 저장 레코드를 일치시킨다.
            ai_msg_id = uuid.uuid4()
            message_id = str(ai_msg_id)
            reply_payload = json.dumps(
                {
                    "messageId":            message_id,
                    "narration":            narration,
                    "speaker":              reply_speaker,
                    "dialogue":             dialogue,
                    "protagonist_dialogue": protagonist_dialogue,
                    "state_changes":        state_changes,
                    "turn":                 turn,
                    "story_phase":          new_phase,
                    "memories":             relevant_memories,
                    "consistency":          consistency_result,
                    "out_of_genre":         out_of_genre,
                    "genre_note":           genre_note,
                },
                ensure_ascii=False,
            )
            logger.info("[TTFB] total_to_reply=%.2fs (저장·요약 제외)", _time.perf_counter() - _t0)
            yield f"event: reply\ndata: {reply_payload}\n\n"

            # ── 사용자에겐 이미 응답 전송 완료. 이하 영구저장/요약은 응답 지연에 무관 ──
            try:
                session_uuid = uuid.UUID(chat_id)
                async with AsyncSessionLocal() as save_session:
                    session_result = await save_session.execute(
                        select(Session).where(Session.id == session_uuid)
                    )
                    session = session_result.scalar_one_or_none()

                    if session:
                        count_result = await save_session.execute(
                            select(func.count()).select_from(Dialogue).where(Dialogue.session_id == session_uuid)
                        )
                        turn_count = count_result.scalar()
                        ai_dialogue = Dialogue(
                            id=ai_msg_id,
                            session_id=session_uuid,
                            speaker_type=SpeakerType.CHARACTER,
                            speaker=reply_speaker or None,
                            content=reply_text,
                            turn_order=turn_count,
                        )
                        save_session.add(ai_dialogue)

                        api_log = ApiLog(
                            session_id=session_uuid,
                            user_id=session.user_id,
                            endpoint=f"GET /chats/{chat_id}/stream",
                            model_used=PRIMARY_MODEL,
                            prompt_tokens=prompt_tokens,
                            completion_tokens=completion_tokens,
                            total_cost=calc_cost(PRIMARY_MODEL, prompt_tokens, completion_tokens),
                        )
                        save_session.add(api_log)
                        await save_session.commit()
            except Exception as e:
                logger.warning("대화/토큰 로그 저장 실패: %s", e)

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

            # F-AV-02: TTS — narration 첫 문장을 음성으로 변환해 별도 event:audio로 전달
            # 텍스트는 위에서 이미 나갔으므로 음성 변환(1~2s) 지연이 텍스트를 막지 않는다.
            try:
                first_sentence = extract_first_sentence(narration)
                if first_sentence:
                    # author_id: character_id(str) → int 변환
                    _str_to_int = {v: k for k, v in AUTHOR_ID_MAP.items()}
                    author_id = _str_to_int.get(character_id, 1)
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

    # 세계관 수정 즉시 반영 — 항상 서버 DB에서 재구성(body.world_context 무시)
    world_context = await _build_world_context(chat_id, db)

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


# ── 말투 기반 입력 추천 (F-VM: 💡 말투 추천) ──────────────────
class VoiceSuggestRequest(BaseModel):
    npc_dialogue: str = ""
    genre: str = ""


@router.post("/{chat_id}/voice-suggest")
async def voice_suggest(
    chat_id: str,
    body: VoiceSuggestRequest,
    db: AsyncSession = Depends(get_db),
):
    """사용자 말투 프로파일(F-VM) 기반으로 주인공의 다음 대사를 '내 말투'로 추천.
    프로파일이 없거나 실패하면 빈 결과 → 프론트가 일반 추천으로 폴백한다."""
    try:
        session_uuid = uuid.UUID(chat_id)
    except ValueError:
        return {"suggestions": []}

    result = await db.execute(select(Session).where(Session.id == session_uuid))
    session = result.scalar_one_or_none()
    if not session:
        return {"suggestions": []}

    user_result = await db.execute(select(User).where(User.id == session.user_id))
    user = user_result.scalar_one_or_none()
    profile = user.voice_profile if user else None
    if not profile:
        return {"suggestions": []}   # 말투 프로파일 없음 → 프론트 폴백

    system_prompt = (
        "당신은 인터랙티브 소설에서 사용자(주인공)가 다음에 할 대사를, "
        "사용자 본인의 '말투 프로파일'에 맞춰 추천하는 어시스턴트입니다.\n"
        "그 말투의 어미·호흡·어휘·존댓말/반말을 그대로 흉내 내세요.\n"
        "반드시 JSON 형식으로만 응답하고 다른 텍스트는 절대 포함하지 마세요."
    )
    user_prompt = (
        f"[사용자 말투 프로파일]\n{json.dumps(profile, ensure_ascii=False)}\n\n"
        f"[장르]\n{body.genre or '일반'}\n\n"
        f"[직전 상대(NPC) 대사]\n{body.npc_dialogue or '(없음)'}\n\n"
        "위 대사에 이어 주인공이 할 수 있는 대사 3가지를 '사용자 말투'로 추천하세요.\n"
        "각 추천은 짧고 자연스러운 한국어 한 문장(25자 이내)이어야 합니다.\n"
        '{"suggestions": ["추천1", "추천2", "추천3"]}'
    )

    contents = [{"role": "user", "parts": [{"text": user_prompt}]}]
    try:
        raw = (await llm.generate(system_prompt, contents)).strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:-1])
        data = json.loads(raw)
        suggestions = [s for s in data.get("suggestions", []) if isinstance(s, str)][:3]
        if suggestions:
            return {"suggestions": suggestions}
    except Exception as e:
        logger.warning("말투 기반 추천 생성 실패 - chat_id=%s: %s", chat_id, e)

    return {"suggestions": []}   # 실패 → 프론트 폴백


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
    return {"memos": await _read_memos(chat_id)}


# ── AI 어시스턴트: 다음 전개 제안 (F-AS-01~03) ─────────────
@router.get("/{chat_id}/suggest")
async def suggest_next(
    chat_id: str,
    world_context: str = "",
    db: AsyncSession = Depends(get_db),
):
    """막혔을 때 다음 전개(주인공 행동/대사) 후보 3개를 제안. 입력이 없을 때 '유도'용."""
    context = await get_context(chat_id, db)
    # 세계관 수정 즉시 반영 — 항상 서버 DB에서 재구성
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
    # 세계관 수정 즉시 반영 — 항상 서버 DB에서 재구성(body.world_context 무시)
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
    # 세계관 수정 즉시 반영 — 항상 서버 DB에서 재구성(body.world_context 무시)
    world_context = await _build_world_context(chat_id, db)

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


@router.delete("/{chat_id}/memo/{index}")
async def delete_memo(chat_id: str, index: int):
    """index번째 메모 삭제 (Redis 리스트에서 제거)."""
    memos = await redis_client.lrange(key_memos(chat_id), 0, -1)
    if 0 <= index < len(memos):
        target = memos[index]
        await redis_client.lrem(key_memos(chat_id), 1, target)
    return {"memos": await redis_client.lrange(key_memos(chat_id), 0, -1)}


@router.delete("/{chat_id}/messages/{message_id}", status_code=204)
async def delete_message(chat_id: str, message_id: str, db: AsyncSession = Depends(get_db)):
    """대화 메시지를 DB에서 삭제한다 (참여형에서 지운 대화가 집필형에 남지 않도록)."""
    try:
        msg_uuid = uuid.UUID(message_id)
        session_uuid = uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="잘못된 ID 형식입니다.")
    result = await db.execute(
        select(Dialogue).where(Dialogue.id == msg_uuid, Dialogue.session_id == session_uuid)
    )
    dialogue = result.scalar_one_or_none()
    if not dialogue:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다.")
    await db.execute(delete(Dialogue).where(Dialogue.id == msg_uuid))
    await db.flush()


# ── 작가 리액션 (F-AS-05) ──────────────────────────────────
# 사용자 대사 → 작가가 짧게 즉각 반응(말풍선). LLM은 '감정 라벨'만 분류하고,
# 실제 문장은 reactions.py 풀에서 꺼낸다 → 작가 톤 보장 + 빠르고 저렴.
REACTION_EMOTION_SYSTEM = (
    "다음은 인터랙티브 소설에서 사용자(주인공)가 방금 한 말/행동이다. "
    "이 순간의 감정 분위기를 아래 6개 중 하나로만 분류한다. 새 문장을 짓지 말고 분류만 한다.\n"
    "- tension: 긴장·위기·갈등\n"
    "- fear: 공포·불안\n"
    "- sadness: 슬픔·상실\n"
    "- joy: 기쁨·설렘·즐거움\n"
    "- calm: 평온·일상·잔잔함\n"
    "- resolve: 결심·각오·행동 개시\n"
    '반드시 JSON만: {"emotion": "tension|fear|sadness|joy|calm|resolve"}'
)


async def classify_emotion(text: str) -> str:
    """사용자 입력의 감정을 6개 라벨 중 하나로 분류(실패/예상 밖 값이면 calm)."""
    try:
        raw = await llm.generate(
            REACTION_EMOTION_SYSTEM,
            [{"role": "user", "parts": [{"text": text}]}],
        )
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=re.MULTILINE)
        emotion = json.loads(cleaned).get("emotion", "")
        return emotion if emotion in EMOTIONS else "calm"
    except Exception as e:
        logger.warning("감정 분류 실패 - %s", e)
        return "calm"


# 문맥(사용자 입력 + 작가 답변) → 작가 말투의 짧은 즉흥 리액션 1줄 + 감정.
# 고정 풀 대신 LLM이 그 장면에 맞는 한마디를 작가 목소리로 생성(TTS로 낭독됨).
def _reaction_gen_system(persona_id: str) -> str:
    return (
        f"{reaction_tone(persona_id)}\n\n"
        "지금 인터랙티브 소설을 함께 쓰는 중이다. 아래에 [주인공이 방금 한 말/행동]과 "
        "[네가 방금 이어 쓴 장면]이 주어진다. 이 흐름을 보고 작가인 네가 옆에서 혼잣말처럼 "
        "툭 던지는 짧은 반응 한 마디를 네 말투로 만들어라(소리 내어 말하는 추임새).\n"
        "규칙:\n"
        "- 25자 이내, 한 문장. 따옴표·이모지·지문 없이 말만.\n"
        "- 장면을 다시 서술하지 말 것. 새 사건을 만들지 말 것. 반응만.\n"
        "- 이 순간의 감정을 다음 6개 중 하나로 함께 분류:\n"
        "  tension(긴장·갈등) / fear(공포·불안) / sadness(슬픔·상실) / "
        "joy(기쁨·설렘) / calm(평온·일상) / resolve(결심·각오)\n"
        '반드시 JSON만: {"emotion":"...", "reaction":"..."}'
    )


async def generate_reaction(persona_id: str, user_input: str, author_reply: str) -> tuple[str, str]:
    """문맥 기반 리액션 생성 → (emotion, reaction). 실패하면 ("", "")."""
    ctx = f"[주인공이 방금 한 말/행동]\n{user_input}\n\n[네가 방금 이어 쓴 장면]\n{author_reply or '(아직 없음)'}"
    try:
        raw = await llm.generate(
            _reaction_gen_system(persona_id),
            [{"role": "user", "parts": [{"text": ctx}]}],
        )
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=re.MULTILINE)
        data = json.loads(cleaned)
        emotion = data.get("emotion", "")
        reaction = (data.get("reaction") or "").strip().strip('"').strip()
        if reaction and emotion in EMOTIONS:
            return emotion, reaction[:40]
        if reaction:
            return "calm", reaction[:40]
    except Exception as e:
        logger.warning("리액션 생성 실패(폴백) - %s", e)
    return "", ""


class ReactionRequest(BaseModel):
    content: str
    character_id: str = "baekya"
    author_reply: str = ""   # 작가가 방금 이어 쓴 장면(문맥 감정 파악용)


@router.post("/{chat_id}/reaction")
async def author_reaction(chat_id: str, body: ReactionRequest):
    """작가의 짧은 리액션 말풍선 (F-AS-05).

    사용자 입력 + 작가 답변 문맥으로 감정을 잡고 그 감정에 맞는 한마디를 작가 말투로 생성.
    생성 실패 시 고정 풀(reactions.py)로 폴백 → 톤 안전망. 직전 리액션은 피해 반복 감소.
    """
    text = (body.content or "").strip()
    if not text:
        return {"reaction": "", "emotion": ""}

    last = await redis_client.get(key_last_reaction(chat_id))

    # 1순위: 문맥 기반 생성(작가 답변 포함)
    emotion, reaction = await generate_reaction(body.character_id, text, body.author_reply)
    # 폴백: 생성 실패하면 사용자+답변 문맥으로 감정만 분류 → 고정 풀에서 한마디
    if not reaction:
        emotion = await classify_emotion(f"{text}\n{body.author_reply}".strip())
        reaction = pick_reaction(body.character_id, emotion, exclude=last)

    if reaction:
        await redis_client.set(key_last_reaction(chat_id), reaction)
    logger.info("작가 리액션 - chat_id=%s emotion=%s → %s", chat_id, emotion, reaction)
    return {"reaction": reaction, "emotion": emotion}

class GenreOpenRequest(BaseModel):
    open: bool = True


@router.post("/{chat_id}/genre-open")
async def set_genre_open(chat_id: str, body: GenreOpenRequest):
    """장르 가드 — '판타지로 도입' 승인 시 이후 턴의 장르 밖 감지를 끈다(취소도 가능)."""
    if body.open:
        await redis_client.set(key_genre_open(chat_id), "1")
    else:
        await redis_client.delete(key_genre_open(chat_id))
    return {"genre_open": body.open}


class MemosBody(BaseModel):
    memos: list = []


@router.put("/{chat_id}/memos", status_code=200)
async def save_memos(chat_id: str, body: MemosBody):
    await redis_client.set(key_memos(chat_id), json.dumps(body.memos, ensure_ascii=False))
    return {"status": "saved", "count": len(body.memos)}
