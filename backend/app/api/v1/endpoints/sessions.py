import logging
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.session import Session, SessionStatus
from app.schemas.session import SessionCreate, SessionResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/", response_model=SessionResponse, status_code=201)
async def create_session(body: SessionCreate, db: AsyncSession = Depends(get_db)):
    session = Session(**body.model_dump())
    db.add(session)
    await db.flush()
    await db.refresh(session)
    logger.info("세션 시작: %s (user=%s, world=%s)", session.id, body.user_id, body.world_id)
    return session


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    return session


@router.patch("/{session_id}/complete", response_model=SessionResponse)
async def complete_session(session_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다.")
    if session.status == SessionStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="이미 완료된 세션입니다.")

    session.status = SessionStatus.COMPLETED
    session.ended_at = datetime.utcnow()
    await db.flush()
    await db.refresh(session)
    logger.info("세션 완료: %s", session_id)
    return session
