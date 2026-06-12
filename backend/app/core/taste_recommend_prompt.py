"""취향저격 AI 추천 프롬프트 빌더"""

TASTE_RECOMMEND_SYSTEM = """\
너는 사용자의 소설 집필을 돕는 AI 작가 보조다.

{taste_section}

{novel_section}

{dialogue_section}

[금지 조건]
- 새로운 인물을 갑자기 등장시키지 마라.
- 사건을 급격히 해결하지 마라.
- 사용자가 쓰던 문체와 어조를 유지하라.
- 대사는 1~2문장 이내로 작성하라.
- 현재 장면의 감정선을 유지하라.

[요청]
위 정보를 바탕으로, 다음에 이어질 수 있는 문장을 3가지 방향으로 추천해라.
각 추천은 서로 다른 감정이나 분위기를 살려야 한다.
사용자 취향을 반영하되 현재 장면의 흐름을 유지하라.

[출력 형식]
반드시 아래 JSON 형식으로만 응답하세요 (다른 설명 없이):
{{
  "recommendations": [
    {{
      "type": "추천 방향 레이블 (예: 설렘 강화, 긴장감 고조, 관계 진전)",
      "narration": "말풍선 밖에 들어갈 묘사 (없으면 빈 문자열)",
      "dialogue": "말풍선 안에 들어갈 대사 (없으면 빈 문자열)",
      "reason": "이 추천을 선택한 이유를 한 줄로"
    }}
  ]
}}"""


def build_taste_section(taste_profile: dict) -> str:
    if not taste_profile:
        return "[사용자 취향]\n취향 정보 없음 (마이페이지에서 취향 설정 후 더 정확한 추천 가능)"
    lines = ["[사용자 취향]"]
    if genre := taste_profile.get("선호장르"):
        lines.append(f"- 선호 장르: {genre}")
    if keywords := taste_profile.get("선호키워드"):
        kw_str = ", ".join(keywords) if isinstance(keywords, list) else str(keywords)
        lines.append(f"- 선호 키워드: {kw_str}")
    return "\n".join(lines)


def build_novel_section(world_context: str, story_summary: str) -> str:
    lines = ["[현재 소설 정보]"]
    if world_context:
        lines.append(world_context)
    if story_summary:
        lines.append(f"\n[현재 상황]\n{story_summary[:400]}")
    if len(lines) == 1:
        lines.append("소설 정보 없음")
    return "\n".join(lines)


def build_dialogue_section(dialogues: list[dict]) -> str:
    if not dialogues:
        return "[직전 문장]\n(대화 기록 없음)"
    lines = []
    if len(dialogues) > 1:
        lines.append("[이전 대화 흐름]")
        for d in dialogues[:-1]:
            role_label = "주인공" if d["role"] == "user" else "AI"
            lines.append(f"{role_label}: {d['content'][:200]}")
        lines.append("")
    last = dialogues[-1]
    last_role = "주인공" if last["role"] == "user" else "AI"
    lines.append(f"[직전 문장]\n{last_role}: {last['content'][:300]}")
    return "\n".join(lines)
