"""
LLM-as-Judge: 페르소나 일관성 자동 평가
평가 기준: 목표 평균 4.0 / 5.0 이상
"""
from dataclasses import dataclass


@dataclass
class JudgeResult:
    persona_id: str
    score: float  # 1~5
    reason: str


JUDGE_PROMPT_TEMPLATE = """
당신은 소설 장르 전문가입니다. 아래 텍스트가 지정된 페르소나의 특성을 얼마나 잘 반영하는지 1~5점으로 평가하세요.

페르소나: {persona_name} ({genre})
페르소나 철학: "{philosophy}"

생성된 텍스트:
{text}

평가 기준:
- 5점: 페르소나 문체·철학이 완벽하게 반영됨
- 4점: 대부분 일관성 있음, 사소한 이탈
- 3점: 평균적, 페르소나 특성 희미
- 2점: 일관성 부족, 다른 장르와 혼동
- 1점: 페르소나와 전혀 무관

JSON 형식으로만 응답하세요: {{"score": <숫자>, "reason": "<이유>"}}
"""


async def judge_persona_consistency(
    persona_id: str,
    generated_text: str,
    llm_client,  # PERSO API 또는 대체 LLM 클라이언트
) -> JudgeResult:
    from app.core.personas import PERSONAS
    persona = PERSONAS[persona_id]

    prompt = JUDGE_PROMPT_TEMPLATE.format(
        persona_name=persona.name,
        genre=persona.genre,
        philosophy=persona.philosophy,
        text=generated_text,
    )

    # TODO: 실제 LLM 호출로 교체
    return JudgeResult(persona_id=persona_id, score=0.0, reason="미구현")
