import logging
from typing import AsyncGenerator
from motor.motor_asyncio import AsyncIOMotorDatabase
from app.models.character import Character
from app.services.rag_service import search_similar

logger = logging.getLogger(__name__)


def _build_prompt(
    character: Character,
    dialogue_history: list[dict],
    user_message: str,
    rag_context: list[dict],
) -> str:
    system = character.system_prompt or ""

    if rag_context:
        context_lines = "\n".join(
            f"[{c['speaker_type']}] {c['content']}" for c in rag_context
        )
        system += f"\n\n[관련 과거 대화]\n{context_lines}"

    history_lines = "\n".join(
        f"[{h['speaker']}] {h['content']}" for h in dialogue_history[-10:]
    )

    return f"{system}\n\n[대화 기록]\n{history_lines}\n\n[사용자] {user_message}"


class LLMRouter:
    async def stream_character_response(
        self,
        character: Character,
        dialogue_history: list[dict],
        user_message: str,
        session_id: str,
        mongo: AsyncIOMotorDatabase,
    ) -> AsyncGenerator[str, None]:
        rag_context = await search_similar(user_message, session_id, mongo)
        prompt = _build_prompt(character, dialogue_history, user_message, rag_context)

        logger.info(
            "LLM 요청 - 캐릭터: %s, RAG 컨텍스트: %d개",
            character.name,
            len(rag_context),
        )
        logger.debug("프롬프트:\n%s", prompt)

        # TODO: PERSO API / Ollama 연결
        yield f"data: [{character.name}] (AI 응답 스트리밍 예정)\n\n"
        yield "data: [DONE]\n\n"

    async def generate_novel(
        self,
        world_description: str,
        dialogue_history: list[dict],
    ) -> str:
        logger.info("소설 생성 요청 - 대화 %d개", len(dialogue_history))
        # TODO: AI 엔진 연결 후 구현
        return "(소설 생성 예정)"
