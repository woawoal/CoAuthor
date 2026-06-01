from pydantic import BaseModel
from typing import Literal


class CoachingRequest(BaseModel):
    persona_id: Literal["baegil", "charoi", "haseorim", "kimdaha"]
    user_text: str


class CoachingResponse(BaseModel):
    feedback: str
