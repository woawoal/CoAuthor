"""소설 품질 평가 (LLM-as-judge) — F-EV-06 근거 리포트의 측정 도구.

세계관·작가 성향을 기준으로 소설을 4개 축(세계관 일관성·캐릭터 일관성·문체 뚜렷함·
완성도)에서 1~5점으로 채점한다. "맨손 작성 vs 우리 서비스" 정량 비교의 측정부.

채점 루브릭(프롬프트)은 동완님이 튜닝할 수 있게 상수로 분리.
"""
import re
import json
import logging

from app.services import llm

logger = logging.getLogger(__name__)

_DIMS = ["world_consistency", "character_consistency", "style_distinct", "completeness"]
_DIM_LABEL = {
    "world_consistency": "세계관 일관성",
    "character_consistency": "캐릭터 일관성",
    "style_distinct": "작가 문체 뚜렷함",
    "completeness": "완성도",
}

EVAL_SYSTEM = """\
[소설 품질 평가자]
[세계관]과 [작가 성향]을 기준으로 [소설]을 냉정하게 평가한다. 각 항목 1~5점(정수):
- world_consistency: 세계관·설정과 일관적인가
- character_consistency: 등장인물 성격이 유지되는가
- style_distinct: 해당 작가의 고유 문체가 뚜렷한가
- completeness: 장면으로서의 흐름·묘사 완성도

후하게 주지 말고 근거 있게 채점한다. 반드시 valid JSON만 출력:
{"world_consistency":4,"character_consistency":4,"style_distinct":3,"completeness":4,"comment":"한 줄 총평"}"""


def _empty(comment: str = "평가 실패") -> dict:
    out = {k: 0 for k in _DIMS}
    out["comment"] = comment
    out["total"] = 0
    return out


async def score_novel(novel_text: str, world_desc: str = "", persona_desc: str = "") -> dict:
    """소설 텍스트를 4개 축으로 채점. 반환: {dim:1~5, comment, total}."""
    if not (novel_text or "").strip():
        return _empty("빈 텍스트")

    prompt = f"[세계관]\n{world_desc}\n\n[작가 성향]\n{persona_desc}\n\n[소설]\n{novel_text}"
    try:
        raw = await llm.generate(
            EVAL_SYSTEM,
            [{"role": "user", "parts": [{"text": prompt}]}],
            json_mode=True,
        )
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=re.MULTILINE)
        data = json.loads(cleaned)
        out = {}
        for k in _DIMS:
            try:
                out[k] = max(0, min(5, int(data.get(k, 0) or 0)))
            except (ValueError, TypeError):
                out[k] = 0
        out["comment"] = str(data.get("comment", ""))[:120]
        out["total"] = sum(out[k] for k in _DIMS)
        return out
    except Exception as e:  # noqa: BLE001
        logger.warning("소설 평가 실패: %s", e)
        return _empty()
