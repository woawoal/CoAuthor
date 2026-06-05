from pydantic import BaseModel
from typing import Literal


class CoachingRequest(BaseModel):
    persona_id: Literal["baekya", "charoun", "hanyeoreum", "kimdohyeon"]
    user_text: str


class CoachingResponse(BaseModel):
    feedback: str
