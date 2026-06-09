"""Gemini 모델 생성 + 키 순환/모델 폴백 추상화.

USE_VERTEX=true  → Vertex AI (GCP). 인증은 ADC. 키 순환 없음(모델 폴백만).
USE_VERTEX=false → AI Studio API 키. 무료키 2개 + 모델 2개를 조합 순환.

호출부(llm_router, chats)는:
  - attempt_specs(primary, fallback) 로 [(api_key, model_name)] 시도 순서를 받고
  - 각 (key, model)로 make_model(...) 해서 generate_content. 429면 다음 조합으로.
"""
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def api_keys() -> list[str]:
    """설정된 AI Studio 키 목록(빈 값 제외, 순서대로)."""
    keys = [settings.GEMINI_API_KEY, settings.GEMINI_API_KEY_2]
    return [k for k in keys if k]


def attempt_specs(primary: str, fallback: str) -> list[tuple]:
    """시도 순서 [(api_key, model_name)].

    AI Studio: 모델(PRIMARY→FALLBACK) × 키(1→2) 조합. 좋은 모델을 두 키로 먼저 시도.
    Vertex   : 키 개념 없음 → [(None, 모델)].
    """
    models = [m for m in (primary, fallback) if m]
    if settings.USE_VERTEX:
        return [(None, m) for m in models]
    keys = api_keys() or [settings.GEMINI_API_KEY]
    return [(k, m) for m in models for k in keys]


if settings.USE_VERTEX:
    import vertexai
    from vertexai.generative_models import GenerativeModel as _VertexModel

    vertexai.init(
        project=settings.GOOGLE_CLOUD_PROJECT,
        location=settings.GOOGLE_CLOUD_LOCATION,
    )
    logger.info("Gemini 백엔드: Vertex AI (project=%s)", settings.GOOGLE_CLOUD_PROJECT)

    def make_model(model_name: str, system_instruction: str | None = None, api_key: str | None = None):
        return _VertexModel(model_name, system_instruction=system_instruction)

else:
    import google.generativeai as genai

    genai.configure(api_key=settings.GEMINI_API_KEY)
    logger.info("Gemini 백엔드: AI Studio (키 %d개 순환)", len(api_keys()))

    def make_model(model_name: str, system_instruction: str | None = None, api_key: str | None = None):
        if api_key:
            genai.configure(api_key=api_key)  # 키 순환 (genai 전역 설정)
        return genai.GenerativeModel(model_name, system_instruction=system_instruction)
