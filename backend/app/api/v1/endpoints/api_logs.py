import uuid
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, Date

from app.database import get_db
from app.models.api_log import ApiLog
from app.schemas.api_log import ApiLogResponse, ApiLogSummary

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[ApiLogResponse])
async def list_logs(
    session_id: uuid.UUID | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """호출 로그 목록 조회 (session_id로 필터 가능)"""
    query = select(ApiLog).order_by(ApiLog.created_at.desc()).limit(limit)
    if session_id:
        query = query.where(ApiLog.session_id == session_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/summary", response_model=list[ApiLogSummary])
async def get_summary(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
):
    """일별 토큰 사용량 및 비용 요약 (보고서용)"""
    since = datetime.utcnow() - timedelta(days=days)
    result = await db.execute(
        select(
            cast(ApiLog.created_at, Date).label("date"),
            func.count(ApiLog.id).label("total_calls"),
            func.coalesce(func.sum(ApiLog.prompt_tokens), 0).label("total_prompt_tokens"),
            func.coalesce(func.sum(ApiLog.completion_tokens), 0).label("total_completion_tokens"),
            func.coalesce(func.sum(ApiLog.total_cost), 0.0).label("total_cost"),
        )
        .where(ApiLog.created_at >= since)
        .group_by(cast(ApiLog.created_at, Date))
        .order_by(cast(ApiLog.created_at, Date).desc())
    )
    rows = result.all()
    return [
        ApiLogSummary(
            date=str(row.date),
            total_calls=row.total_calls,
            total_prompt_tokens=row.total_prompt_tokens,
            total_completion_tokens=row.total_completion_tokens,
            total_cost=round(row.total_cost, 8),
        )
        for row in rows
    ]


@router.get("/total")
async def get_total(db: AsyncSession = Depends(get_db)):
    """전체 누적 토큰 사용량 및 비용"""
    result = await db.execute(
        select(
            func.count(ApiLog.id).label("total_calls"),
            func.coalesce(func.sum(ApiLog.prompt_tokens), 0).label("total_prompt_tokens"),
            func.coalesce(func.sum(ApiLog.completion_tokens), 0).label("total_completion_tokens"),
            func.coalesce(func.sum(ApiLog.total_cost), 0.0).label("total_cost"),
        )
    )
    row = result.one()
    return {
        "total_calls": row.total_calls,
        "total_prompt_tokens": row.total_prompt_tokens,
        "total_completion_tokens": row.total_completion_tokens,
        "total_tokens": row.total_prompt_tokens + row.total_completion_tokens,
        "total_cost_usd": round(row.total_cost, 6),
    }
