"""LLM 호출 추상화 — Gemini(AI Studio/Vertex) ↔ Groq 토글 + 모델/키 폴백.

호출부(llm_router, chats)는 입력을 Gemini-style contents로 통일해서 넘기고,
이 모듈이 provider에 맞게 변환·호출한다.

  generate(system_prompt, contents) -> str
  stream(system_prompt, contents, usage_out=None) -> AsyncGenerator[str]

contents 형식: [{"role": "user"|"model", "parts": [{"text": "..."}]}]
usage_out: 리스트를 넘기면 완료 후 {"model","prompt_tokens","completion_tokens"} append.
"""
import asyncio
import logging
from typing import AsyncGenerator

from app.core.config import settings

logger = logging.getLogger(__name__)

PROVIDER = (settings.LLM_PROVIDER or "gemini").lower()


def _to_openai_messages(system_prompt: str, contents: list[dict]) -> list[dict]:
    """Gemini-style contents → OpenAI(role/content) messages."""
    msgs: list[dict] = []
    if system_prompt:
        msgs.append({"role": "system", "content": system_prompt})
    for c in contents:
        role = "assistant" if c.get("role") == "model" else (c.get("role") or "user")
        text = "".join(p.get("text", "") for p in c.get("parts", []))
        msgs.append({"role": role, "content": text})
    return msgs


# ── Groq ────────────────────────────────────────────────────────
if PROVIDER == "groq":
    from groq import Groq

    _client = Groq(api_key=settings.GROQ_API_KEY)
    _MODELS = [m for m in (settings.GROQ_MODEL, settings.GROQ_FALLBACK_MODEL) if m]
    logger.info("LLM 백엔드: Groq (model=%s)", settings.GROQ_MODEL)

    async def generate(system_prompt: str, contents: list[dict]) -> str:
        messages = _to_openai_messages(system_prompt, contents)
        last = None
        for i, m in enumerate(_MODELS):
            try:
                resp = await asyncio.to_thread(
                    lambda mm=m: _client.chat.completions.create(model=mm, messages=messages)
                )
                return resp.choices[0].message.content or ""
            except Exception as e:
                last = e
                logger.warning("[groq gen %d/%d %s] 실패: %s", i + 1, len(_MODELS), m, e)
        raise last or RuntimeError("Groq 생성 실패")

    async def stream(system_prompt: str, contents: list[dict], usage_out: list | None = None) -> AsyncGenerator[str, None]:
        messages = _to_openai_messages(system_prompt, contents)
        for i, m in enumerate(_MODELS):
            try:
                s = await asyncio.to_thread(
                    lambda mm=m: _client.chat.completions.create(
                        model=mm, messages=messages, stream=True,
                    )
                )
                pt = ct = 0
                for chunk in s:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content
                    if getattr(chunk, "usage", None):
                        pt = chunk.usage.prompt_tokens or 0
                        ct = chunk.usage.completion_tokens or 0
                if usage_out is not None:
                    usage_out.append({"model": m, "prompt_tokens": pt, "completion_tokens": ct})
                return
            except Exception as e:
                logger.warning("[groq stream %d/%d %s] 실패: %s", i + 1, len(_MODELS), m, e)
                if i == len(_MODELS) - 1:
                    raise

# ── Gemini (AI Studio/Vertex) ───────────────────────────────────
else:
    from app.services.gemini import make_model, attempt_specs

    _PRIMARY = settings.GEMINI_MODEL
    _FALLBACK = settings.GEMINI_FALLBACK_MODEL

    async def generate(system_prompt: str, contents: list[dict]) -> str:
        specs = attempt_specs(_PRIMARY, _FALLBACK)
        for i, (api_key, model_id) in enumerate(specs):
            try:
                model = make_model(model_id, system_instruction=system_prompt, api_key=api_key)
                resp = await asyncio.to_thread(model.generate_content, contents)
                return resp.text
            except Exception as e:
                logger.warning("[gemini gen %d/%d %s] 실패: %s", i + 1, len(specs), model_id, e)
                if i == len(specs) - 1:
                    raise
        raise RuntimeError("Gemini 생성 실패")

    async def stream(system_prompt: str, contents: list[dict], usage_out: list | None = None) -> AsyncGenerator[str, None]:
        specs = attempt_specs(_PRIMARY, _FALLBACK)
        for i, (api_key, model_id) in enumerate(specs):
            try:
                model = make_model(model_id, system_instruction=system_prompt, api_key=api_key)
                response = await asyncio.to_thread(
                    lambda m=model: m.generate_content(contents, stream=True)
                )
                for chunk in response:
                    if chunk.text:
                        yield chunk.text
                if usage_out is not None:
                    try:
                        meta = response.usage_metadata
                        usage_out.append({
                            "model": model_id,
                            "prompt_tokens": getattr(meta, "prompt_token_count", 0) or 0,
                            "completion_tokens": getattr(meta, "candidates_token_count", 0) or 0,
                        })
                    except Exception:
                        usage_out.append({"model": model_id, "prompt_tokens": 0, "completion_tokens": 0})
                return
            except Exception as e:
                logger.warning("[gemini stream %d/%d %s] 실패: %s", i + 1, len(specs), model_id, e)
                if i == len(specs) - 1:
                    raise
