"""
app/prompts/formatter.py
────────────────────────────────────────────────────────────
출력 포맷 규칙 정의 + 프롬프트 조립 + LLM 응답 파싱.

personas.py  → 응답 스타일 (작가 개성)
formatter.py → 응답 형식 (JSON 구조) + 최종 messages 배열 조립

공개 API:
  build_messages(persona_id, world_context, mode, context, user_input)
      → list[dict]
  parse_ai_response(raw)
      → dict
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass

from app.core.personas import get_author_prompt


# ── 데이터 클래스 ────────────────────────────────────────────────

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


# ── 출력 포맷 규칙 ───────────────────────────────────────────────

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

_SYSTEM_CORE = """\
너는 AI 소설 채팅 서비스의 캐릭터/스토리 진행 엔진이다.
사용자의 입력에 대해 세계관과 캐릭터 설정을 지키며 자연스럽게 응답한다.
절대 설정에 없는 사실을 마음대로 확정하지 않는다.
스토리를 한 번에 너무 많이 진행하지 말고, 사용자가 반응할 여지를 남긴다."""


# ── 섹션 빌더 (private) ──────────────────────────────────────────

def _build_system(persona_id: str, world_context: str, mode: str) -> str:
    author_rules = get_author_prompt(
        persona_id=persona_id,
        world_context=world_context,
        mode=mode,
    )
    sections = [
        CRITICAL_OUTPUT_RULE,
        OUTPUT_RULES,
        INPUT_RULES,
        WRITER_STYLE_RULE,
        _SYSTEM_CORE,
        author_rules,
    ]
    return "\n\n".join(s for s in sections if s)


def _build_context_prefix(context: dict) -> str:
    parts = []
    if context.get("characters"):
        parts.append(f"[주요 등장인물]\n{context['characters']}")
    if context.get("summary"):
        parts.append(f"[사건 요약]\n{context['summary']}")
    if context.get("state"):
        parts.append(f"[현재 상태]\n{context['state']}")
    return "\n\n".join(parts)


def _history_to_messages(history: list[dict]) -> list[dict]:
    return [
        {
            "role": "user" if h["role"] == "user" else "assistant",
            "content": h["content"],
        }
        for h in reversed(history)
    ]


# ── 공개 API ─────────────────────────────────────────────────────

def build_messages(
    persona_id: str,
    world_context: str,
    mode: str,
    context: dict,
    user_input: str,
) -> list[dict]:
    """
    context 형식: {history: list, state: str, characters: str, summary: str}
    반환: OpenAI messages 형식 list[dict]
    """
    messages: list[dict] = [
        {"role": "system", "content": _build_system(persona_id, world_context, mode)}
    ]
    messages.extend(_history_to_messages(context.get("history", [])))

    prefix = _build_context_prefix(context)
    if prefix:
        user_content = f"{prefix}\n\n사용자 입력: {user_input}"
    else:
        user_content = user_input or "(오프닝 서술을 시작해주세요)"

    messages.append({"role": "user", "content": user_content})
    return messages


def parse_ai_response(raw: str) -> dict:
    """LLM JSON 응답 파싱. 실패 시 raw 전체를 narration으로 폴백."""
    _default_state = {"trust_delta": 0, "event": None}
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
        return {
            "narration":     data.get("narration", ""),
            "dialogue":      data.get("dialogue", ""),
            "state_changes": data.get("state_changes", _default_state),
            "internal_note": data.get("internal_note", ""),
        }
    except (json.JSONDecodeError, AttributeError):
        return {
            "narration":     raw,
            "dialogue":      "",
            "state_changes": _default_state,
            "internal_note": "",
        }
