import uuid
from datetime import datetime
from pydantic import BaseModel
from app.models.session import SessionStatus


class SessionCreate(BaseModel):
    world_id: uuid.UUID
    user_id: uuid.UUID       # 임시: 인증 구현 전 직접 전달
    protagonist_id: uuid.UUID


class SessionResponse(BaseModel):
    id: uuid.UUID
    world_id: uuid.UUID
    user_id: uuid.UUID
    protagonist_id: uuid.UUID
    status: SessionStatus
    started_at: datetime
    ended_at: datetime | None

    model_config = {"from_attributes": True}


class SessionListItem(BaseModel):
    id: uuid.UUID
    world_id: uuid.UUID
    world_title: str
    status: SessionStatus
    started_at: datetime
    ended_at: datetime | None
