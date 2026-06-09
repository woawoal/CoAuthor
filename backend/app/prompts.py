"""
backend/prompts.py
──────────────────────────────────────────────────
프롬프트 조립 모듈.

섹션 구성:
  고정 역할         → system prompt  (_SYSTEM_CORE)
  세계관/캐릭터     → WorldInfo / CharacterInfo
  현재 상태         → SessionState
  이전 흐름         → story_summary + recent_messages
  사용자 입력       → user message
  출력 규칙         → JSON format  (_OUTPUT_RULES)

공개 API:
  build_prompt_messages(...)  → list[dict]   OpenAI messages 형식
  parse_ai_response(raw)      → (reply, state_changes, internal_note)
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field


# ── 데이터 클래스 ────────────────────────────────────────────────

@dataclass
class WorldInfo:
    title: str = ""
    description: str = ""      # 세계관 설명
    setting: str = ""          # 주요 공간/배경
    rules: str = ""            # 세계 규칙


@dataclass
class CharacterInfo:
    name: str = ""
    role: str = ""             # 예: "주연 캐릭터", "조연"
    personality: str = ""
    speech_style: str = ""     # 말투 특징
    secret: str = ""           # LLM은 알지만 사용자에게 드러내지 않는 정보


@dataclass
class SessionState:
    location: str = ""
    time_of_day: str = ""
    current_event: str = ""
    trust_level: int = 0       # 캐릭터-사용자 신뢰도
    story_phase: str = "도입부"  # 도입부 / 전개 / 클라이맥스 / 결말


# ── 고정 블록 ────────────────────────────────────────────────────

# 최상단 배치 — JSON 출력 강제 (영문으로 weight 높임)
CRITICAL_OUTPUT_RULE = """\
[Critical Output Rule]
You must output a valid JSON object only.
Do not write markdown, code blocks, or any text outside the JSON.
Novel narration goes only inside the "narration" field.
Character speech goes only inside the "dialogue" field."""

# 사용자 입력 해석 규칙
INPUT_RULES = """\
[User Input Rules]
사용자 입력에서:
- 큰따옴표("...") 안 = 사용자의 직접 대사
- 큰따옴표 밖 = 사용자의 행동, 표정, 상황 설명"""

# JSON 스키마 + 필드 규칙
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

# 작가 문체를 narration/dialogue 필드 안으로 유도
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

def _world_block(w: WorldInfo) -> str:
    if not (w.title or w.description):
        return ""
    lines = ["[World]"]
    if w.title:        lines.append(f"제목: {w.title}")
    if w.description:  lines.append(f"세계관:\n{w.description}")
    if w.setting:      lines.append(f"주요 공간:\n{w.setting}")
    if w.rules:        lines.append(f"세계 규칙:\n{w.rules}")
    return "\n".join(lines)


def _character_block(c: CharacterInfo) -> str:
    if not c.name:
        return ""
    lines = ["[Character]", "너의 역할:"]
    lines.append(f"이름: {c.name}")
    if c.role:         lines.append(f"역할: {c.role}")
    if c.personality:  lines.append(f"성격: {c.personality}")
    if c.speech_style: lines.append(f"말투: {c.speech_style}")
    if c.secret:       lines.append(f"비밀: {c.secret}")
    return "\n".join(lines)


def _state_block(s: SessionState) -> str:
    lines = ["[Session State]"]
    if s.location:      lines.append(f"현재 장소: {s.location}")
    if s.time_of_day:   lines.append(f"현재 시간대: {s.time_of_day}")
    if s.current_event: lines.append(f"현재 사건: {s.current_event}")
    lines.append(f"신뢰도: {s.trust_level}")
    lines.append(f"진행 단계: {s.story_phase}")
    return "\n".join(lines)


# ── 공개 API ─────────────────────────────────────────────────────

def build_prompt_messages(
    world: WorldInfo,
    character: CharacterInfo,
    state: SessionState,
    story_summary: str,
    recent_messages: list[dict],
    user_input: str,
) -> list[dict]:
    """
    OpenAI messages 형식으로 조립.

    반환 구조:
      [{"role": "system", "content": ...},
       {"role": "user"|"assistant", "content": ...},  # recent_messages
       {"role": "user", "content": user_input}]

    recent_messages 원소: {"role": "user"|"ai", "content": "..."}
    """
    sections = [
        CRITICAL_OUTPUT_RULE,
        OUTPUT_RULES,
        INPUT_RULES,
        WRITER_STYLE_RULE,
        _SYSTEM_CORE,
        _world_block(world),
        _character_block(character),
        _state_block(state),
        f"[Story Summary]\n{story_summary}" if story_summary else "",
    ]
    system_content = "\n\n".join(s for s in sections if s)

    messages: list[dict] = [{"role": "system", "content": system_content}]

    for msg in recent_messages:
        role = "user" if msg.get("role") == "user" else "assistant"
        messages.append({"role": role, "content": msg["content"]})

    messages.append({
        "role": "user",
        "content": user_input or "(오프닝 서술을 시작해주세요)",
    })
    return messages


def parse_ai_response(raw: str) -> dict:
    """
    LLM JSON 응답 파싱.

    반환 dict 키: narration, dialogue, state_changes, internal_note

    파싱 실패 시 raw 전체를 narration으로, 나머지는 기본값으로 반환.
    """
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
