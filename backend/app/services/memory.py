"""대화 기억 (RAG-lite).

긴 대화에서 캐릭터·사건·설정을 까먹지 않도록 이전 대화를 누적 요약(rolling
summary)해 둔다. 이 요약을 프롬프트에 주입하면, 최근 N턴만 보던 모델이
"세계관 일관성(장기 기억)"을 유지한다. 진짜 벡터 검색(pgvector) 전 단계.

토큰 절약: 매번 전체 대화를 다시 넣지 않고 **이전 요약 + 최근 묶음**만
요약해 갱신한다(증분). 요약은 session.story_summary(Text)에 누적 저장.

이 모듈은 chats.py 구조와 독립적이다 — 호출부는 한 줄(refresh_session_summary)만
부르면 되므로, chats.py가 어느 버전으로 머지되든 충돌하지 않는다.
"""
import uuid
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import llm
from app.models.session import Session

logger = logging.getLogger(__name__)

# 요약이 무한정 길어지지 않도록 상한(문자). 넘으면 모델이 압축하도록 유도.
SUMMARY_CHAR_BUDGET = 800

_SUMMARY_SYSTEM = (
    "너는 소설 협업 대화의 '기억 관리자'다. 이어지는 창작 대화가 길어져도 "
    "캐릭터·설정·사건을 잊지 않도록, 핵심만 간결한 한국어 개조식으로 정리한다.\n"
    "다음 항목 위주로 적되, 해당 없으면 생략한다:\n"
    "- 등장인물의 현재 상태·감정·관계 변화\n"
    "- 지금까지 일어난 주요 사건(시간 순)\n"
    "- 새로 드러난 세계관/설정/규칙\n"
    "- 미해결 갈등·떡밥\n"
    f"전체 {SUMMARY_CHAR_BUDGET}자 이내로 압축한다. 대사를 그대로 옮기지 말고 사실만 요약한다."
)


def _turns_to_text(turns: list[dict]) -> str:
    lines = []
    for t in turns:
        role = "사용자" if t.get("role") == "user" else "AI"
        content = (t.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines)


async def summarize(prior_summary: str, turns: list[dict]) -> str:
    """이전 요약 + 최근 대화 묶음 → 갱신된 누적 요약 문자열.

    LLM 실패 시 이전 요약을 그대로 반환(요약 갱신은 부가 기능이므로 대화를 막지 않음).
    """
    recent = _turns_to_text(turns)
    if not recent:
        return prior_summary

    prompt_parts = []
    if prior_summary:
        prompt_parts.append(f"[지금까지의 요약]\n{prior_summary}")
    prompt_parts.append(f"[새 대화]\n{recent}")
    prompt_parts.append("위 요약과 새 대화를 합쳐, 갱신된 누적 요약을 만들어라.")
    prompt = "\n\n".join(prompt_parts)

    try:
        text = await llm.generate(
            _SUMMARY_SYSTEM,
            [{"role": "user", "parts": [{"text": prompt}]}],
        )
        return (text or "").strip() or prior_summary
    except Exception as e:  # noqa: BLE001 - 요약 실패는 대화를 막지 않는다
        logger.warning("요약 생성 실패(이전 요약 유지): %s", e)
        return prior_summary


async def refresh_session_summary(
    chat_id: str,
    db: AsyncSession,
    recent_turns: list[dict],
) -> str | None:
    """세션의 story_summary를 최근 대화로 갱신해 저장하고, 갱신된 요약을 반환.

    chat_id가 유효한 세션 UUID가 아니거나 세션이 없으면 조용히 None.
    """
    try:
        sid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        return None

    session = (await db.execute(select(Session).where(Session.id == sid))).scalar_one_or_none()
    if session is None:
        return None

    new_summary = await summarize(session.story_summary or "", recent_turns)
    if new_summary and new_summary != session.story_summary:
        session.story_summary = new_summary
        await db.commit()
        logger.info("story_summary 갱신 - chat_id=%s len=%d", chat_id, len(new_summary))
    return new_summary
