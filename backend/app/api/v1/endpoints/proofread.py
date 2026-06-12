"""오탈자/맞춤법 교정 엔드포인트 (F-QC-02 기반).

- POST /chats/{chat_id}/proofread     : 문장 검사 → 오류쌍 + 자주틀림 플래그 + (선택)작가 톤 메모
- GET  /users/{user_id}/error-notebook : 개인 오답노트(자주 틀리는 순)

검출/검증은 services.proofread(F-QC-02 정답지 + diff), 자동 수정 X(제안만).
"""
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.session import Session
from app.models.user import User
from app.services import proofread as pf
from app.services import llm

router = APIRouter()
logger = logging.getLogger(__name__)

# 작가별 톤 — 교정 메모를 '빨간펜'이 아니라 '협업 작가의 여백 메모'처럼 띄우기 위함
AUTHOR_TONE = {
    "baekya":     "백야 — 호러/미스터리 작가. 시니컬하고 담담한 반말.",
    "charoun":    "차로운 — 본격 추리 작가. 분석적이고 또박또박한 존댓말.",
    "hanyeoreum": "한여름 — 로맨스 작가. 다정하고 살가운 말투.",
    "kimdohyeon": "김도현 — 일상/에세이 작가. 편안하고 따뜻한 말투.",
}


class ProofreadRequest(BaseModel):
    text: str
    character_id: str = "baekya"
    persona_memo: bool = True   # 작가 톤 한 줄 메모 생성 여부


async def _resolve_user(chat_id: str, db: AsyncSession) -> User | None:
    """chat_id(=session_id) → 세션 → 작성 유저. 익명/유효X면 None."""
    try:
        sid = uuid.UUID(chat_id)
    except (ValueError, TypeError):
        return None
    session = (await db.execute(select(Session).where(Session.id == sid))).scalar_one_or_none()
    if session is None or not session.user_id:
        return None
    return (await db.execute(select(User).where(User.id == session.user_id))).scalar_one_or_none()


async def _author_memo(character_id: str, errors: list[dict]) -> str:
    """작가 페르소나 톤으로 교정을 '여백 메모' 한 줄로. 오류없음/실패 시 ''."""
    if not errors:
        return ""
    tone = AUTHOR_TONE.get(character_id, AUTHOR_TONE["baekya"])
    pairs = ", ".join(f"{e['original']}→{e['corrected']}" for e in errors[:5])
    system = (
        f"너는 소설 협업 작가다. 페르소나: {tone}\n"
        "사용자(주인공)가 방금 쓴 문장의 맞춤법을 네가 '여백에 메모해주듯' 한 줄로 짚는다.\n"
        "- 잔소리·훈계 금지, 네 작가 말투로 짧고 자연스럽게 (빨간펜 선생님 X, 협업 작가 O)\n"
        "- 맞춤법 용어 나열 금지. 딱 한 문장."
    )
    prompt = f"[교정 목록] {pairs}\n위를 네 말투로 한 줄 메모로."
    try:
        text = await llm.generate(system, [{"role": "user", "parts": [{"text": prompt}]}])
        return (text or "").strip().strip('"')
    except Exception as e:  # noqa: BLE001 - 메모 실패는 교정 자체를 막지 않음
        logger.warning("작가 교정 메모 생성 실패: %s", e)
        return ""


@router.post("/chats/{chat_id}/proofread")
async def proofread_chat(
    chat_id: str,
    body: ProofreadRequest,
    db: AsyncSession = Depends(get_db),
):
    """사용자 문장 맞춤법 검사 → 오류쌍(+자주틀림) + 작가 톤 메모.

    - 판정은 F-QC-02(네이버) → diff. LLM은 메모 표현만(환각 차단).
    - 개인 error_profile 누적 → 같은 실수 재등장 시 frequent=True.
    - **자동 수정하지 않는다** — 프론트는 '제안'만 표시하고 적용/넘기기는 사용자가.
    """
    errors = await pf.proofread(body.text)

    flagged = [{**e, "frequent": False, "count": 1} for e in errors]
    user = await _resolve_user(chat_id, db)
    if user is not None and errors:
        new_profile, flagged = pf.update_profile(user.error_profile, errors)
        user.error_profile = new_profile
        await db.commit()

    memo = await _author_memo(body.character_id, errors) if body.persona_memo else ""
    return {"errors": flagged, "memo": memo, "count": len(flagged)}


@router.get("/users/{user_id}/error-notebook")
async def error_notebook(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """개인 오답노트 — 자주 틀리는 순으로 정렬."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    return {"notebook": pf.notebook(user.error_profile)}
