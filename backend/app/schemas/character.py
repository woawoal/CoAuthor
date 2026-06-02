import uuid
from datetime import datetime
from pydantic import BaseModel
from app.models.character import CharacterRole


class CharacterCreate(BaseModel):
    name: str
    role: CharacterRole
    personality: str = ""
    background: str = ""
    appearance: str = ""
    is_ai_controlled: bool = True
    system_prompt: str = ""


class CharacterUpdate(BaseModel):
    name: str | None = None
    role: CharacterRole | None = None
    personality: str | None = None
    background: str | None = None
    appearance: str | None = None
    is_ai_controlled: bool | None = None
    system_prompt: str | None = None


class CharacterResponse(BaseModel):
    id: uuid.UUID
    world_id: uuid.UUID
    name: str
    role: CharacterRole
    personality: str
    background: str
    appearance: str
    is_ai_controlled: bool
    system_prompt: str
    created_at: datetime

    model_config = {"from_attributes": True}
