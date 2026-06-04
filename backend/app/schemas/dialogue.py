import uuid
from datetime import datetime
from pydantic import BaseModel
from app.models.dialogue import SpeakerType


class DialogueStreamRequest(BaseModel):
    content: str
    character_id: uuid.UUID


class DialogueResponse(BaseModel):
    id: str
    session_id: str
    speaker_type: SpeakerType
    character_id: str | None
    content: str
    turn_order: int
    created_at: datetime
