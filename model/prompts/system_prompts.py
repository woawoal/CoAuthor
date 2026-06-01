"""
페르소나별 시스템 프롬프트 및 few-shot 예시 관리
실제 예시는 data/few_shot/ 디렉터리에서 로드
"""

FEW_SHOT_TEMPLATE = """
--- 예시 {n} ---
사용자: {user}
{persona_name}: {assistant}
"""


def build_system_prompt(persona_id: str, few_shot_examples: list[dict]) -> str:
    from app.core.personas import PERSONAS
    persona = PERSONAS[persona_id]

    examples = "\n".join(
        FEW_SHOT_TEMPLATE.format(
            n=i + 1,
            user=ex["user"],
            persona_name=persona.name,
            assistant=ex["assistant"],
        )
        for i, ex in enumerate(few_shot_examples)
    )

    return f"{persona.system_prompt}\n\n아래는 대화 예시입니다:\n{examples}"
