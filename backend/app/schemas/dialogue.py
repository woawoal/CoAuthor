import uuid
from datetime import datetime
from pydantic import BaseModel
from app.models.dialogue import SpeakerType


class DialogueStreamRequest(BaseModel):
    content: str            # 사용자 발화
    character_id: uuid.UUID  # 응답할 AI 캐릭터 ID


class DialogueResponse(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    speaker_type: SpeakerType
    character_id: uuid.UUID | None
    content: str
    turn_order: int
    created_at: datetime

    model_config = {"from_attributes": True}
