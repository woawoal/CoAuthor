"""오탈자/맞춤법 교정 코어 (검출 + 검증).

설계 원칙:
- **판정은 LLM이 아니라 F-QC-02(네이버 맞춤법기)** 가 한다 → 환각(멀쩡한 걸 틀렸다고) 차단.
- F-QC-02는 '교정문(문자열)'만 주므로, **원문 vs 교정문 char-level diff** 로 실제 바뀐 구간만 오류쌍으로 추출.
- confusion 소사전은 '검출'이 아니라 **유형 분류/코칭 라벨**용 (되/돼·안/않 등 자주 헷갈리는 것).
- 자동 수정은 하지 않는다 — 호출부가 '제안'만 하고 최종 결정은 사용자(작가가 일부러 쓴 사투리/문체 보호).

반환 오류쌍: {"original": 틀린어절, "corrected": 맞는어절, "type": "맞춤법|띄어쓰기|오타|되/돼|..."}
"""
from __future__ import annotations

import asyncio
import difflib
import logging

from f_qc_02_spell_checker import check_korean_grammar

logger = logging.getLogger(__name__)

# 자주 틀리는 한국어 혼동쌍 → 유형 라벨. (검출이 아니라 분류·코칭용)
# key는 '틀린 표기에 포함되는 조각', value=(올바른 예, 유형 라벨).
CONFUSION: dict[str, tuple[str, str]] = {
    "됬": ("됐", "되/돼"),
    "되요": ("돼요", "되/돼"),
    "되써": ("됐어", "되/돼"),
    "안되": ("안 돼", "되/돼"),
    "않돼": ("안 돼", "안/않"),
    "어떻해": ("어떡해", "어떻게/어떡해"),
    "어떡게": ("어떻게", "어떻게/어떡해"),
    "왠일": ("웬일", "왠/웬"),
    "웬지": ("왠지", "왠/웬"),
    "몇일": ("며칠", "며칠"),
    "금새": ("금세", "금세/금새"),
    "오랫만": ("오랜만", "오랜만/오랫만"),
    "희안": ("희한", "희한"),
    "역활": ("역할", "역할/역활"),
    "낳는": ("낫는", "낫다/낳다"),
    "낳아": ("나아", "낫다/낳다"),
    "들어나": ("드러나", "드러나다"),
    "할께": ("할게", "ㄹ게/ㄹ께"),
    "갈께": ("갈게", "ㄹ게/ㄹ께"),
    "로써": ("로서", "로서/로써"),
    "던지": ("든지", "든지/던지"),
    "맞추": ("맞히", "맞추다/맞히다"),
    "바램": ("바람", "바람/바램"),
}


def _classify(original: str, corrected: str) -> str:
    """오류 유형 추정. 띄어쓰기 > 혼동쌍 > 맞춤법 순."""
    if original.replace(" ", "") == corrected.replace(" ", ""):
        return "띄어쓰기"
    for wrong, (_right, kind) in CONFUSION.items():
        if wrong in original:
            return kind
    return "맞춤법"


def _diff_errors(original: str, corrected: str) -> list[dict]:
    """원문 vs 교정문 **어절(공백 분리) 단위 diff** → 바뀐 어절을 통째로 오류쌍으로 반환.

    어절 단위라 `마춤법 → 맞춤법`처럼 단어 전체로 읽히고, 네이버가 띄어쓰기를 바꿔
    한 어절이 둘로 갈려도(`안되요 → 안 돼요`) 자연스럽게 묶인다.
    """
    ow, cw = original.split(), corrected.split()
    sm = difflib.SequenceMatcher(None, ow, cw, autojunk=False)
    errors: list[dict] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        o_words, c_words = ow[i1:i2], cw[j1:j2]
        if tag == "replace" and len(o_words) == len(c_words):
            # 어절 수가 1:1 → 단어별 개별 오류로 분리 (연속 교정도 따로따로)
            for o_w, c_w in zip(o_words, c_words):
                if o_w != c_w:
                    errors.append({"original": o_w, "corrected": c_w, "type": _classify(o_w, c_w)})
        else:
            # 어절 수가 다름(띄어쓰기로 갈림·합쳐짐) → 묶어서 한 오류로
            o, c = " ".join(o_words).strip(), " ".join(c_words).strip()
            if o and c and o != c:
                errors.append({"original": o, "corrected": c, "type": _classify(o, c)})
    return errors


async def proofread(text: str) -> list[dict]:
    """text의 맞춤법/오탈자 오류쌍 리스트를 반환. 오류 없거나 검사 실패 시 [].

    F-QC-02는 동기(requests) → 이벤트 루프 안 막게 thread로 실행.
    """
    text = (text or "").strip()
    if not text:
        return []
    try:
        corrected = await asyncio.to_thread(check_korean_grammar, text)
    except Exception as e:  # noqa: BLE001 - 검사 실패는 '오류 없음'으로 흡수(흐름 안 막음)
        logger.warning("맞춤법 검사 실패(교정 생략): %s", e)
        return []
    if not corrected or corrected.strip() == text:
        return []
    return _diff_errors(text, corrected)


# ── 개인 오답노트(error_profile) 누적/매칭 ────────────────────
# profile 형태: { "<틀린표기>": {"corrected": str, "type": str, "count": int} }

def update_profile(profile: dict | None, errors: list[dict]) -> tuple[dict, list[dict]]:
    """errors를 profile에 누적하고, 각 error에 frequent 플래그(이전 count>=2)를 붙여 반환.

    반환: (갱신된 profile, frequent 플래그 달린 errors)
    """
    profile = dict(profile or {})
    flagged: list[dict] = []
    for err in errors:
        key = err["original"]
        entry = profile.get(key) or {"corrected": err["corrected"], "type": err["type"], "count": 0}
        prev = entry.get("count", 0)
        entry["count"] = prev + 1
        entry["corrected"] = err["corrected"]
        entry["type"] = err["type"]
        profile[key] = entry
        flagged.append({**err, "frequent": prev >= 2, "count": entry["count"]})
    return profile, flagged


def notebook(profile: dict | None, limit: int = 50) -> list[dict]:
    """error_profile → 자주 틀리는 순으로 정렬된 오답노트 리스트."""
    items = [
        {"original": k, "corrected": v.get("corrected", ""), "type": v.get("type", ""), "count": v.get("count", 0)}
        for k, v in (profile or {}).items()
    ]
    items.sort(key=lambda x: x["count"], reverse=True)
    return items[:limit]
