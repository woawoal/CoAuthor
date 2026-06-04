from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum
import uuid


class SpeakerType(str, Enum):
    USER = "user"
    CHARACTER = "character"


class DialogueDocument(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    speaker_type: SpeakerType
    character_id: str | None = None
    content: str
    turn_order: int
    embedding: list[float] | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
