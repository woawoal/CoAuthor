import hashlib
import json
from app.schemas.chat import ChatRequest


class CacheService:
    """개발 중: 메모리 dict 캐시 → 프로덕션: Redis TTL 캐시"""

    def __init__(self):
        self._store: dict[str, str] = {}

    def _key(self, req: ChatRequest) -> str:
        payload = json.dumps(
            {"persona": req.persona_id, "history": req.history, "text": req.text},
            ensure_ascii=False,
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()

    async def get(self, req: ChatRequest) -> str | None:
        return self._store.get(self._key(req))

    async def set(self, req: ChatRequest, value: str) -> None:
        self._store[self._key(req)] = value
