"""
scripts/evidence_report.py
---------------------------
F-EV-06 차별점 근거 리포트 — "맨손 작성 vs 우리 서비스" 정량 비교.

강화된 점:
- BASELINE_SYSTEM 현실적으로 강화 (ChatGPT 잘 쓰는 사람 수준)
- 3회 평균으로 신뢰도 향상
- style_weakness 필드 출력 추가
- 결과를 JSON으로도 저장 (발표 자료용)

실행: backend 폴더에서
    python -m scripts.evidence_report
"""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import asyncio
import json
from datetime import datetime

from app.services import llm, evaluate
from app.services.llm_router import LLMRouter

# ── 테스트 시나리오 ────────────────────────────────────────────
# 여러 시나리오로 돌릴수록 신뢰도 올라감

SCENARIOS = [
    {
        "name": "잠입수사_카페",
        "world_desc": "제목: 잠입 수사 / 장르: 추리 / 배경: 비 오는 밤의 카페. 알바생 민준은 사실 정체를 숨긴 잠입 형사다.",
        "persona_id": "charoun",
        "persona_desc": "차로운(추리): 관찰자 시점. 감정보다 행동과 사실을 먼저 쓴다. 복선을 자연스럽게 심는다.",
        "dialogue": [
            {"role": "user", "content": "나는 비에 젖은 채 카페 문을 열고 들어선다."},
            {"role": "ai",   "content": "민준이 무뚝뚝하게 고개를 들어 나를 본다. \"어서 오세요.\""},
            {"role": "user", "content": "나는 그의 눈빛에서 뭔가 다른 것을 느끼고 자리에 앉는다."},
        ],
    },
    {
        "name": "폐건물_공포",
        "world_desc": "장르: 호러 / 배경: 2019년 서울 외곽 폐건물. 주인공은 실종된 친구를 찾아 혼자 들어간다.",
        "persona_id": "baekya",
        "persona_desc": "백야(호러): 문장은 짧고 단절적. 감정을 직접 쓰지 않고 장면과 행동만 쓴다. 여백과 침묵을 표현한다.",
        "dialogue": [
            {"role": "user", "content": "나는 손전등을 켜고 계단을 올라간다."},
            {"role": "ai",   "content": "3층에서 문이 하나 열려 있었다. 어제는 잠겨 있었다."},
            {"role": "user", "content": "나는 그 안을 들여다본다."},
        ],
    },
    {
        "name": "재회_로맨스",
        "world_desc": "장르: 로맨스 / 배경: 현대 서울. 5년 만에 우연히 마주친 첫사랑.",
        "persona_id": "hanyeoreum",
        "persona_desc": "한여름(로맨스): 인물의 신체 반응을 먼저 쓴다. 감각적 묘사로 분위기를 깔고 감정을 올린다.",
        "dialogue": [
            {"role": "user", "content": "나는 지하철에서 그 사람을 발견한다."},
            {"role": "ai",   "content": "그가 먼저 나를 봤다. 5년 전과 같은 눈이었다."},
            {"role": "user", "content": "나는 뭐라고 해야 할지 모른 채 그 앞에 서 있다."},
        ],
    },
]

# ── 맨손 베이스라인 프롬프트 ───────────────────────────────────
# 현실적으로 강화 — "소설 좀 써봤다"는 사람이 ChatGPT에 쓸 법한 수준

BASELINE_SYSTEM = """\
당신은 한국 소설을 잘 쓰는 AI입니다.
아래 대화를 읽고 소설 한 장면으로 변환해주세요.

조건:
- 한국어로만 작성
- 지문과 대사를 자연스럽게 섞어서
- 인물의 감정과 분위기가 느껴지도록
- 300자 내외로
"""

BAR = "=" * 60


def _block(dialogue: list[dict]) -> str:
    return "\n".join(
        f"{'사용자' if m['role'] == 'user' else '상대'}: {m['content']}"
        for m in dialogue
    )


async def run_scenario(router: LLMRouter, scenario: dict, repeat: int = 3) -> dict:
    """단일 시나리오를 repeat회 돌려서 평균 점수 반환."""
    name = scenario["name"]
    world_desc = scenario["world_desc"]
    persona_id = scenario["persona_id"]
    persona_desc = scenario["persona_desc"]
    dialogue = scenario["dialogue"]

    base_scores, ours_scores = [], []

    for i in range(repeat):
        # 맨손
        baseline = await llm.generate(
            BASELINE_SYSTEM,
            [{"role": "user", "parts": [{"text": _block(dialogue)}]}],
        )
        # 우리
        ours = await router.generate_novel(dialogue, world_desc, persona_id=persona_id)

        s_base = await evaluate.score_novel(baseline, world_desc, persona_desc)
        s_ours = await evaluate.score_novel(ours, world_desc, persona_desc)

        base_scores.append(s_base)
        ours_scores.append(s_ours)

    # 평균 계산
    def avg(scores: list[dict]) -> dict:
        result = {}
        for k in evaluate._DIMS:
            result[k] = round(sum(s[k] for s in scores) / len(scores), 2)
        result["total"] = round(sum(result[k] for k in evaluate._DIMS), 2)
        result["comment"] = scores[-1].get("comment", "")
        result["style_weakness"] = scores[-1].get("style_weakness", "")
        return result

    return {
        "name": name,
        "baseline": avg(base_scores),
        "ours": avg(ours_scores),
        "repeat": repeat,
    }


def print_result(result: dict):
    name = result["name"]
    s_base = result["baseline"]
    s_ours = result["ours"]

    print(f"\n{BAR}")
    print(f" 시나리오: {name} ({result['repeat']}회 평균)")
    print(BAR)
    print(f"{'평가 항목':<20}{'맨손':>6}{'우리':>6}{'차이':>6}")
    print("-" * 60)
    for k in evaluate._DIMS:
        diff = s_ours[k] - s_base[k]
        sign = "+" if diff > 0 else ""
        print(f"{evaluate._DIM_LABEL[k]:<18}{s_base[k]:>6}{s_ours[k]:>6}{sign}{diff:>5.1f}")
    print("-" * 60)

    total_diff = s_ours["total"] - s_base["total"]
    sign = "+" if total_diff > 0 else ""
    print(f"{'합계 (20점 만점)':<18}{s_base['total']:>6}{s_ours['total']:>6}{sign}{total_diff:>5.1f}")
    print(BAR)
    print(f"맨손 총평: {s_base['comment']}")
    print(f"우리 총평: {s_ours['comment']}")
    if s_ours.get("style_weakness"):
        print(f"문체 개선점: {s_ours['style_weakness']}")

    verdict = (
        "✅ 우리 서비스 우위" if total_diff > 0
        else ("≈ 동률" if total_diff == 0 else "⚠️ 열위 — 점검 필요")
    )
    print(f"\n판정: {verdict} (격차 {sign}{total_diff:.1f}점)")


async def main():
    router = LLMRouter()
    all_results = []

    print(BAR)
    print(" F-EV-06 차별점 근거 리포트 — 맨손 vs 우리 서비스")
    print(BAR)

    for scenario in SCENARIOS:
        result = await run_scenario(router, scenario, repeat=3)
        print_result(result)
        all_results.append(result)

    # 전체 평균
    print(f"\n{BAR}")
    print(" 전체 종합")
    print(BAR)
    for k in evaluate._DIMS:
        base_avg = round(sum(r["baseline"][k] for r in all_results) / len(all_results), 2)
        ours_avg = round(sum(r["ours"][k] for r in all_results) / len(all_results), 2)
        diff = ours_avg - base_avg
        sign = "+" if diff > 0 else ""
        print(f"{evaluate._DIM_LABEL[k]:<18}{base_avg:>6}{ours_avg:>6}{sign}{diff:>5.1f}")

    # JSON 저장 (발표 자료용)
    output_path = f"evidence_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)
    print(f"\n📄 결과 저장: {output_path}")
    print(BAR)


if __name__ == "__main__":
    asyncio.run(main())
