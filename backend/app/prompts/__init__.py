from __future__ import annotations

import json
import re
from dataclasses import dataclass, field


@dataclass
class WorldInfo:
    title: str = ""
    description: str = ""
    setting: str = ""
    rules: str = ""


@dataclass
class CharacterInfo:
    name: str = ""
    role: str = ""
    personality: str = ""
    speech_style: str = ""
    secret: str = ""


@dataclass
class SessionState:
    location: str = ""
    time_of_day: str = ""
    current_event: str = ""
    trust_level: int = 0
    story_phase: str = "도입부"


CRITICAL_OUTPUT_RULE = """\
[Critical Output Rule]
You must output a valid JSON object only.
Do not write markdown, code blocks, or any text outside the JSON.
Novel narration goes only inside the "narration" field.
Character speech goes only inside the "dialogue" field."""

INPUT_RULES = """\
[User Input Rules]
사용자 입력에서:
- 큰따옴표("...") 안 = 사용자의 직접 대사
- 큰따옴표 밖 = 사용자의 행동, 표정, 상황 설명"""

OUTPUT_RULES = """\
[Output Schema]
{
  "narration": "장면 묘사, 행동, 감정 서술 (따옴표 없이)",
  "dialogue": "캐릭터가 실제로 말하는 대사만 (따옴표 없이)",
  "state_changes": {
    "trust_delta": 0,
    "event": null
  },
  "internal_note": "서버 저장용 요약. 사용자에게 보이지 않음"
}

- narration : 장면 묘사, 행동, 감정 서술만. 대사 없음
- dialogue  : 캐릭터 대사만. 따옴표 붙이지 않음. 대사 없으면 빈 문자열
- state_changes.trust_delta : 신뢰도 변화량 (-5 ~ +5 정수), 변화 없으면 0
- state_changes.event : 새로운 사건 시작 시 한 줄 요약, 없으면 null
- internal_note : 이번 턴의 서사 핵심을 한 줄로 (장소·상태·핵심사건)"""

WRITER_STYLE_RULE = """\
[Writer Style]
답변은 감각적인 소설 문체로 작성한다.
인물의 말투, 분위기, 장면 묘사를 유지한다.
장면 묘사와 행동 서술은 "narration" 필드에, 캐릭터 대사는 "dialogue" 필드에 분리해서 작성한다."""


def parse_ai_response(raw: str) -> dict:
    _default_state = {"trust_delta": 0, "event": None}
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
        # JSON null → None 이 그대로 넘어오면 이후 슬라이싱에서 터지므로 "" 로 강제
        return {
            "narration":     data.get("narration") or "",
            "dialogue":      data.get("dialogue") or "",
            "state_changes": data.get("state_changes") or _default_state,
            "internal_note": data.get("internal_note") or "",
        }
    except (json.JSONDecodeError, AttributeError):
        pass

    # 폴백: 깨진 JSON(값에 따옴표 누락 등)에서 narration/dialogue를 정규식으로 추출
    def _grab(field: str) -> str:
        m = re.search(
            rf'"{field}"\s*:\s*"?(.*?)"?\s*'
            rf'(?=,\s*\n?\s*"(?:narration|dialogue|state_changes|internal_note)"|\n?\s*\}})',
            cleaned, re.DOTALL,
        )
        return m.group(1).strip().strip('"').rstrip(",").strip() if m else ""

    narration, dialogue = _grab("narration"), _grab("dialogue")
    if narration or dialogue:
        return {
            "narration":     narration,
            "dialogue":      dialogue,
            "state_changes": _default_state,
            "internal_note": "",
        }
    # 최후: 원문 전체를 narration으로
    return {
        "narration":     raw,
        "dialogue":      "",
        "state_changes": _default_state,
        "internal_note": "",
    }
