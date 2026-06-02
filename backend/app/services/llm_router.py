"""
LLM 라우터 — AI 엔진 연동 예정
현재는 스텁 구현으로, 추후 실제 LLM API로 교체
"""
import logging
from typing import AsyncGenerator
from app.models.character import Character

logger = logging.getLogger(__name__)


class LLMRouter:
    async def stream_character_response(
        self,
        character: Character,
        dialogue_history: list[dict],
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """캐릭터 시스템 프롬프트 기반 응답 스트리밍"""
        # TODO: AI 엔진 연결 후 구현
        logger.info("LLM 스트리밍 요청 - 캐릭터: %s", character.name)
        yield f"data: [{character.name}] (AI 응답 스트리밍 예정)\n\n"
        yield "data: [DONE]\n\n"

    async def generate_novel(
        self,
        world_description: str,
        dialogue_history: list[dict],
    ) -> str:
        """대화 로그를 소설 초안으로 변환"""
        # TODO: AI 엔진 연결 후 구현
        logger.info("소설 생성 요청 - 대화 %d개", len(dialogue_history))
        return "(소설 생성 예정)"
