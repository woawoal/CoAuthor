"""삽화 이미지 생성 서비스.

2가지 모드:
  1. 직접 입력: 사용자 장면 설명 → LLM 정제·필터 → DALL-E 3
  2. AI 추천:  소설 내용 → LLM 장면 후보 4종 → 사용자 선택 → DALL-E 3

DALL-E 3 호출은 동기 OpenAI 클라이언트를 asyncio.to_thread로 감싼다.
LLM 호출 실패 시 대화 흐름을 막지 않도록 예외를 흡수한다.
"""
import asyncio
import json
import logging

from app.core.config import settings
from app.services import llm

logger = logging.getLogger(__name__)

# ── 스타일·분위기·비율 매핑 ─────────────────────────────────────────────
STYLE_MAP = {
    "webtoon":    "Korean webtoon illustration style, web novel cover art, vibrant anime art, detailed character design",
    "watercolor": "soft watercolor illustration, dreamy and gentle, pastel tones, delicate brushstrokes",
    "ink":        "black and white ink illustration, manga style, clean expressive lines, high contrast",
    "realistic":  "semi-realistic digital illustration, cinematic lighting, detailed environment",
    "pastel":     "soft pastel aesthetic illustration, kawaii style, gentle warm tones",
}

MOOD_MAP = {
    "warm":     "warm golden lighting, cozy and inviting atmosphere",
    "dark":     "dark dramatic atmosphere, moody deep shadows, suspenseful",
    "dreamy":   "ethereal dreamy atmosphere, soft diffused light, misty",
    "tense":    "tense dramatic lighting, high contrast, suspenseful mood",
    "romantic": "romantic soft lighting, tender intimate moment, warm pink tones",
}


TYPE_LABEL = {
    "dramatic":     "핵심 장면",
    "emotional":    "감정 장면",
    "foreshadowing": "복선 장면",
    "fanservice":   "팬서비스 장면",
}

# ── 프롬프트 ────────────────────────────────────────────────────────────
_SCENE_RECOMMEND_SYSTEM = """\
당신은 웹소설 삽화 연출 전문가입니다.
소설 내용을 읽고 삽화로 만들기 좋은 장면 4개를 아래 유형으로 각 1개씩 추천하세요.

유형:
- dramatic     : 이야기의 핵심 사건·전환점
- emotional    : 인물의 감정이 가장 강하게 드러나는 장면
- foreshadowing: 복선·이스터에그가 담긴 장면
- fanservice   : 독자가 좋아할 관계성·설렘·긴장감이 있는 장면

JSON 형식으로만 응답하세요:
{
  "scenes": [
    {"type":"dramatic","label":"핵심 장면","description":"2~3문장 설명","visual":"시각적 묘사 힌트"},
    {"type":"emotional","label":"감정 장면","description":"...","visual":"..."},
    {"type":"foreshadowing","label":"복선 장면","description":"...","visual":"..."},
    {"type":"fanservice","label":"팬서비스 장면","description":"...","visual":"..."}
  ]
}"""

_FILTER_REFINE_SYSTEM = """\
당신은 한국 웹소설 앱의 삽화 프롬프트 검수 전문가입니다.
사용자가 입력한 장면 설명을 검토한 뒤 DALL-E 3용 영어 프롬프트로 정제하세요.

검토 기준:
1. 웹소설 삽화로 적합한가?
2. 선정적·폭력적·혐오 표현이 있는가?
3. 소설 내용·분위기와 너무 동떨어졌는가?
4. 장난성/저품질 요청인가?

JSON 형식으로만 응답하세요:
{
  "status": "appropriate" | "refine_needed" | "inappropriate",
  "refined_prompt": "DALL-E 3용 영어 프롬프트 (appropriate·refine_needed)",
  "suggestion": "한국어 수정 제안 (refine_needed인 경우, 없으면 null)",
  "block_reason": "거절 이유 (inappropriate인 경우, 없으면 null)"
}

- appropriate   : 그대로 생성 가능
- refine_needed : 내용을 순화·조정 후 생성 (대체 제안 포함)
- inappropriate : 생성 불가 (선정적·폭력·혐오 등)"""


# ── 핵심 함수 ────────────────────────────────────────────────────────────
async def recommend_scenes(novel_content: str, world_context: str) -> dict:
    """소설 내용에서 삽화 후보 장면 4개 추출."""
    excerpt = novel_content[:3000]
    user_msg = f"[세계관]\n{world_context}\n\n[소설 내용]\n{excerpt}"
    try:
        raw = await llm.generate(
            _SCENE_RECOMMEND_SYSTEM,
            [{"role": "user", "parts": [{"text": user_msg}]}],
            json_mode=True,
        )
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.warning("장면 추천 실패: %s", e)
        return {"scenes": []}


async def filter_and_refine(
    scene_desc: str,
    genre: str,
    style: str,
    mood: str,
) -> dict:
    """사용자 입력 필터 + DALL-E 프롬프트 정제."""
    style_hint = STYLE_MAP.get(style, STYLE_MAP["webtoon"])
    mood_hint  = MOOD_MAP.get(mood, "")
    user_msg = (
        f"장르: {genre}\n"
        f"사용자 입력 장면: {scene_desc}\n"
        f"원하는 스타일: {style_hint}\n"
        f"원하는 분위기: {mood_hint}"
    )
    try:
        raw = await llm.generate(
            _FILTER_REFINE_SYSTEM,
            [{"role": "user", "parts": [{"text": user_msg}]}],
            json_mode=True,
        )
        data = json.loads(raw) if isinstance(raw, str) else raw
        if data.get("status") in ("appropriate", "refine_needed") and data.get("refined_prompt"):
            extra = ", ".join(filter(None, [style_hint, mood_hint]))
            data["refined_prompt"] = f"{data['refined_prompt']}, {extra}".strip(", ")
        return data
    except Exception as e:
        logger.warning("프롬프트 정제 실패(폴백): %s", e)
        return {
            "status": "appropriate",
            "refined_prompt": f"{scene_desc}, {STYLE_MAP['webtoon']}",
            "suggestion": None,
            "block_reason": None,
        }


_FAL_SIZE_MAP = {
    "1:1":  "square_hd",       # 1024×1024
    "9:16": "portrait_16_9",   # 576×1024
    "16:9": "landscape_16_9",  # 1024×576
}

_FAL_ENDPOINT = "https://fal.run/fal-ai/flux/dev"


async def generate_image(prompt: str, ratio: str = "1:1") -> str:
    """FLUX.1-dev(fal.ai)로 이미지를 생성하고 URL을 반환."""
    if not settings.FAL_KEY:
        raise RuntimeError("FAL_KEY 환경변수가 설정되지 않았습니다.")

    import httpx
    size = _FAL_SIZE_MAP.get(ratio, "square_hd")
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            _FAL_ENDPOINT,
            headers={"Authorization": f"Key {settings.FAL_KEY}"},
            json={
                "prompt": prompt,
                "image_size": size,
                "num_inference_steps": 28,
                "guidance_scale": 3.5,
                "num_images": 1,
                "enable_safety_checker": True,
                "output_format": "jpeg",
            },
        )
        resp.raise_for_status()
        data = resp.json()
    return data["images"][0]["url"]
