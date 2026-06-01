from pydantic import BaseModel
from typing import Literal


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    persona_id: Literal["baegil", "charoi", "haseorim", "kimdaha"]
    text: str
    history: list[Message] = []
    mode: Literal["together", "coaching"] = "together"


class ChatResponse(BaseModel):
    persona_id: str
    content: str
