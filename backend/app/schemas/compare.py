from pydantic import BaseModel


class CompareRequest(BaseModel):
    text: str


class CompareResponse(BaseModel):
    results: dict[str, str]  # persona_id -> generated text
