"""
services/tts.py
----------------
F-AV-02 첫 문장 낭독 — OpenAI TTS 연동.

- 모델: tts-1 (빠름, 일반 품질)
- narration 첫 문장만 추출해서 음성 생성
- 엔드포인트: GET /chats/{chat_id}/tts?text=...

작가별 음성:
    백야      → onyx  (낮고 차분)
    차로운    → echo  (명료하고 또렷)
    한여름    → nova  (따뜻하고 부드러움)
    김도현    → fable (잔잔하고 자연스러움)
"""

import re
from openai import AsyncOpenAI
from app.core.config import settings

_client = None


def _get_client():
    """OpenAI 클라이언트 lazy 초기화. 키 없으면 None(=TTS 스킵).
    모듈 import 시 클라이언트를 만들지 않아야 키 미설정 환경(CI·타엔진 팀원)에서도 앱이 뜬다."""
    global _client
    if _client is None and settings.OPENAI_API_KEY:
        _client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _client

# 작가별 음성 매핑
_VOICE_MAP = {
    "baekya":     "onyx",
    "charoun":    "echo",
    "hanyeoreum": "nova",
    "kimdohyeon": "fable",
}

# author_id(int) → persona_id(str)
_AUTHOR_ID_MAP = {
    1: "baekya",
    2: "charoun",
    3: "hanyeoreum",
    4: "kimdohyeon",
}

DEFAULT_VOICE = "alloy"


def extract_first_sentence(narration: str) -> str:
    """narration에서 첫 문장만 추출."""
    if not narration:
        return ""
    # 마침표·느낌표·물음표 기준으로 첫 문장 추출
    match = re.search(r"[^.!?]*[.!?]", narration.strip())
    if match:
        return match.group(0).strip()
    # 마침표 없으면 전체 반환 (최대 100자)
    return narration.strip()[:100]


async def synthesize(text: str, author_id: int) -> bytes:
    """
    텍스트를 음성으로 변환.

    Args:
        text: 낭독할 텍스트 (narration 첫 문장)
        author_id: 1~4 (작가 ID)

    Returns:
        mp3 bytes
    """
    client = _get_client()
    if client is None:
        return b""  # OPENAI_API_KEY 미설정 → 음성 없이 진행

    persona_id = _AUTHOR_ID_MAP.get(author_id, "")
    voice = _VOICE_MAP.get(persona_id, DEFAULT_VOICE)

    response = await client.audio.speech.create(
        model="tts-1",
        voice=voice,
        input=text,
        response_format="mp3",
    )
    return response.content
