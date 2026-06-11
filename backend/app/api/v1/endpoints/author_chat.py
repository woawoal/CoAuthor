"""작가 AI 채팅 엔드포인트 — 오른쪽 패널 메타 대화"""
import json
import uuid
import logging
import re as _re

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.session import Session
from app.models.world import World
from app.models.character import Character
from app.services.chat_context import (
    redis_client,
    get_author_history, append_author_history, get_prev_user_questions,
    key_memos,
)
from app.services import llm, memory
from app.prompts.author import build_author_messages

router = APIRouter()
logger = logging.getLogger(__name__)


async def _get_story_context(chat_id: str, db: AsyncSession) -> tuple[str, str]:
    """세계관 문자열 + 현재 줄거리 요약 반환."""
    try:
        sid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        return "", ""

    session = (await db.execute(select(Session).where(Session.id == sid))).scalar_one_or_none()
    if not session:
        return "", ""

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

    world_context  = "\n".join(parts)
    story_summary  = session.story_summary or ""
    return world_context, story_summary


async def _get_memos(chat_id: str) -> list:
    raw = await redis_client.get(key_memos(chat_id))
    if not raw:
        return []
    try:
        return json.loads(raw)
    except Exception:
        return []


# ── 스키마 ────────────────────────────────────────────────────
class AuthorMessageRequest(BaseModel):
    content: str
    author_id: str = "baekya"


class AuthorMessageResponse(BaseModel):
    messageId: str
    content: str


# ── 엔드포인트 ────────────────────────────────────────────────
@router.post("/{chat_id}/author/message")
async def send_author_message(
    chat_id: str,
    body: AuthorMessageRequest,
    db: AsyncSession = Depends(get_db),
) -> AuthorMessageResponse:
    """
    작가 AI에게 메시지를 보내고 응답을 받는다.
    - 세계관·줄거리·메모를 컨텍스트로 주입
    - RAG로 관련 사건 회상
    - 일반 텍스트 응답 (JSON 아님)
    """
    world_context, story_summary = await _get_story_context(chat_id, db)
    memos          = await _get_memos(chat_id)
    author_history = await get_author_history(chat_id, body.author_id)

    # 첫 대화(작가 전환)일 때만 다른 작가와 나눈 사용자 질문 수집
    prev_questions: list[str] = []
    if not author_history:
        prev_questions = await get_prev_user_questions(chat_id, exclude_author=body.author_id)

    # RAG: 사용자 입력과 관련된 과거 대화 검색
    relevant: list[str] = []
    try:
        relevant = await memory.retrieve_relevant(chat_id, db, body.content)
    except Exception as e:
        logger.warning("작가채팅 RAG 실패: %s", e)

    # RAG 결과를 story_summary에 보강
    context_summary = story_summary
    if relevant:
        context_summary += "\n\n[관련 사건 (RAG)]\n" + "\n".join(f"- {r}" for r in relevant)

    messages = build_author_messages(
        author_id=body.author_id,
        world_context=world_context,
        story_summary=context_summary,
        memos=memos,
        author_history=author_history,
        prev_questions=prev_questions,
        user_input=body.content,
    )

    logger.info("작가채팅 요청 - chat_id=%s author=%s", chat_id, body.author_id)

    # llm.generate 는 contents 형식을 기대 (system 제외)
    system_prompt = messages[0]["content"]
    contents = [
        {"role": "user" if m["role"] == "user" else "model",
         "parts": [{"text": m["content"]}]}
        for m in messages[1:]
    ]

    raw = await llm.generate(system_prompt, contents, json_mode=False)
    reply = (raw or "").strip()

    # 히스토리 저장
    await append_author_history(chat_id, body.author_id, "user", body.content)
    await append_author_history(chat_id, body.author_id, "ai", reply)

    logger.info("작가채팅 응답 - chat_id=%s: %s", chat_id, reply[:80])

    return AuthorMessageResponse(
        messageId=f"amsg_{uuid.uuid4().hex[:8]}",
        content=reply,
    )


@router.get("/{chat_id}/author/history")
async def get_author_chat_history(
    chat_id: str,
    author_id: str = Query(default="baekya"),
):
    """작가 AI 채팅 히스토리 조회."""
    history = await get_author_history(chat_id, author_id)
    return {"history": list(reversed(history))}
