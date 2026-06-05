import asyncio
import json
import logging
from typing import AsyncGenerator

import google.generativeai as genai

from app.core.config import settings
from app.core.personas import PERSONA_PROMPTS, get_author_prompt
from app.models.character import Character
from app.services.cache import CacheService

logger = logging.getLogger(__name__)

# ── Gemini 초기화 ──────────────────────────────────────────────
genai.configure(api_key=settings.GEMINI_API_KEY)

PRIMARY_MODEL  = "gemini-2.5-flash"
FALLBACK_MODEL = "gemini-1.5-flash"

_COACHING_SUFFIX = (
    "\n\n당신은 지금 코칭 모드입니다. "
    "사용자가 작성한 글을 읽고 당신의 장르 철학에 맞는 구체적인 피드백을 주세요. "
    "잘된 점보다 개선점을 먼저, 수정 방향은 명확하게. "
    "대신 써주지 말고 방향만 짚어주세요."
)

_NOVEL_SYSTEM = (
    "당신은 대화를 소설 문체로 변환하는 편집자입니다. "
    "대화 흐름을 유지하면서 지문·묘사·감정선을 추가해 소설 한 장면으로 완성하세요. "
    "3인칭 전지적 시점을 기본으로 합니다."
)

cache_svc = CacheService()


# ── 내부 유틸 ──────────────────────────────────────────────────

def _to_gemini_contents(history: list[dict], user_message: str) -> list[dict]:
    """대화 히스토리를 Gemini contents 포맷으로 변환."""
    contents = []
    for msg in history:
        role = "user" if msg.get("role") == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})
    contents.append({"role": "user", "parts": [{"text": user_message}]})
    return contents


def _make_model(system_prompt: str, model_name: str) -> genai.GenerativeModel:
    return genai.GenerativeModel(
        model_name=model_name,
        system_instruction=system_prompt,
    )


async def _generate(system_prompt: str, contents: list[dict]) -> str:
    """단발성 Gemini 호출. PRIMARY → FALLBACK 자동 전환."""
    for model_id in (PRIMARY_MODEL, FALLBACK_MODEL):
        try:
            model = _make_model(system_prompt, model_id)
            resp = await asyncio.to_thread(model.generate_content, contents)
            return resp.text
        except Exception as e:
            logger.warning("[Gemini:%s] 실패: %s", model_id, e)
            if model_id == FALLBACK_MODEL:
                raise
    raise RuntimeError("Gemini 호출 전체 실패")


async def _stream_gemini(
    system_prompt: str,
    contents: list[dict],
) -> AsyncGenerator[str, None]:
    """스트리밍 Gemini 호출. PRIMARY → FALLBACK 자동 전환. 텍스트 청크만 yield."""
    for model_id in (PRIMARY_MODEL, FALLBACK_MODEL):
        try:
            model = _make_model(system_prompt, model_id)
            response = await asyncio.to_thread(
                lambda m=model: m.generate_content(contents, stream=True)
            )
            for chunk in response:
                if chunk.text:
                    yield chunk.text
            return
        except Exception as e:
            logger.warning("[stream_gemini:%s] 실패: %s", model_id, e)
            if model_id == FALLBACK_MODEL:
                raise

class LLMRouter:

    # 캐릭터 모드 스트리밍 (v1 dialogues 엔드포인트용)

    async def stream_character_response(
        self,
        character: Character,
        dialogue_history: list[dict],
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """
        dialogues.py 에서 호출.
        character.prompt 를 시스템 프롬프트로 사용, Gemini 스트리밍.
        """
        system_prompt = character.prompt or ""

        logger.info("[stream_character] 캐릭터=%s", character.name)

        contents = _to_gemini_contents(dialogue_history[-10:], user_message)

        try:
            async for text_chunk in _stream_gemini(system_prompt, contents):
                payload = json.dumps(
                    {"character": character.name, "text": text_chunk, "done": False},
                    ensure_ascii=False,
                )
                yield f"data: {payload}\n\n"
        except Exception as e:
            err = json.dumps({"error": str(e)}, ensure_ascii=False)
            yield f"event: error\ndata: {err}\n\n"
            return

        yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"

    # 작가/등장인물 모드 스트리밍 (chats.py 연동)

    async def stream(
        self,
        persona_id: str,
        text: str,
        history: list[dict] | None = None,
        world_context: str = "",
        mode: str = "author",
    ) -> AsyncGenerator[str, None]:
        """
        /api/chats/{id}/stream 에서 호출.
        캐시 히트 시 즉시 반환, 미스 시 Gemini 스트리밍.
        """
        history = history or []
        cache_key = {"persona_id": persona_id, "text": text, "mode": mode}

        cached = await cache_svc.get("stream", cache_key)
        if cached:
            logger.debug("[CACHE HIT] stream persona=%s", persona_id)
            yield f"data: {json.dumps({'text': cached, 'done': False}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"
            return

        system_prompt = get_author_prompt(
            persona_id=persona_id,
            world_context=world_context,
            mode=mode,
        )
        contents = _to_gemini_contents(history, text)
        full_chunks: list[str] = []

        try:
            async for text_chunk in _stream_gemini(system_prompt, contents):
                full_chunks.append(text_chunk)
                payload = json.dumps(
                    {"text": text_chunk, "done": False}, ensure_ascii=False
                )
                yield f"data: {payload}\n\n"
        except Exception as e:
            err = json.dumps({"error": str(e)}, ensure_ascii=False)
            yield f"event: error\ndata: {err}\n\n"
            return

        yield f"data: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"

        if full_chunks:
            await cache_svc.set("stream", cache_key, "".join(full_chunks))

    # 코칭 모드

    async def coach(self, persona_id: str, user_text: str) -> str:

        cache_key = {"persona_id": persona_id, "text": user_text, "mode": "coaching"}
        cached = await cache_svc.get("coach", cache_key)
        if cached:
            return cached

        base = PERSONA_PROMPTS.get(persona_id)
        if not base:
            raise ValueError(f"알 수 없는 페르소나: {persona_id}")

        contents = [{"role": "user", "parts": [{"text": user_text}]}]
        result = await _generate(base + _COACHING_SUFFIX, contents)
        await cache_svc.set("coach", cache_key, result)
        return result

    # 장르 비교 모드

    async def generate_all_personas(self, text: str) -> dict[str, str]:

        async def _one(pid: str) -> tuple[str, str]:
            cache_key = {"persona_id": pid, "text": text, "mode": "compare"}
            cached = await cache_svc.get("compare", cache_key)
            if cached:
                return pid, cached

            system_prompt = get_author_prompt(persona_id=pid, world_context="", mode="author")
            contents = [{"role": "user", "parts": [{"text": text}]}]
            result = await _generate(system_prompt, contents)
            await cache_svc.set("compare", cache_key, result)
            return pid, result

        pairs = await asyncio.gather(
            *[_one(pid) for pid in PERSONA_PROMPTS],
            return_exceptions=True,
        )

        results: dict[str, str] = {}
        for item in pairs:
            if isinstance(item, Exception):
                logger.error("[compare] 생성 실패: %s", item)
            else:
                pid, out = item
                results[pid] = out
        return results

    # 대화 → 소설 변환

    async def generate_novel(
        self,
        dialogue_history: list[dict],
        world_description: str = "",
    ) -> str:
        """대화 히스토리를 소설 한 장면으로 변환."""
        if not dialogue_history:
            return ""

        system_prompt = _NOVEL_SYSTEM
        if world_description:
            system_prompt += f"\n\n[세계관]\n{world_description}"

        block = "\n".join(
            f"{'사용자' if m.get('role') == 'user' else '작가'}: {m['content']}"
            for m in dialogue_history
        )
        contents = [{
            "role": "user",
            "parts": [{"text": f"아래 대화를 소설 장면으로 변환해주세요:\n\n{block}"}],
        }]
        return await _generate(system_prompt, contents)
