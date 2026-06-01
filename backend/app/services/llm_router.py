"""
하이브리드 라우터:
  - 단순 이어쓰기 → 자체 파인튜닝 모델
  - 복잡한 피드백  → PERSO API
  - PERSO 초과 시  → 대체 LLM (폴백)
"""
import asyncio
from typing import AsyncGenerator
from app.core.personas import PERSONAS
from app.schemas.chat import ChatRequest


class LLMRouter:
    async def stream(self, req: ChatRequest) -> AsyncGenerator[str, None]:
        persona = PERSONAS.get(req.persona_id)
        if not persona:
            raise ValueError(f"Unknown persona: {req.persona_id}")
        # TODO: PERSO API 스트리밍 연결
        yield f"data: (페르소나 {persona.name} 스트리밍 예정)\n\n"

    async def generate_all_personas(self, text: str) -> dict[str, str]:
        tasks = {
            pid: self._generate_single(pid, text)
            for pid in PERSONAS
        }
        results = await asyncio.gather(*tasks.values())
        return dict(zip(tasks.keys(), results))

    async def _generate_single(self, persona_id: str, text: str) -> str:
        # TODO: 실제 API 호출로 교체
        persona = PERSONAS[persona_id]
        return f"[{persona.name}] {text} (생성 예정)"

    async def coach(self, persona_id: str, user_text: str) -> str:
        # TODO: 코칭 전용 프롬프트 구성 후 API 호출
        persona = PERSONAS.get(persona_id)
        if not persona:
            raise ValueError(f"Unknown persona: {persona_id}")
        return f"[{persona.name} 코칭] (피드백 생성 예정)"
