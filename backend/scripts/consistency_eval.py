"""설정 모순 탐지(F-QC-01) 정량 평가 — 라벨링된 세트로 분류 정확도 측정.

차별점 평가표의 '설정 모순 탐지' 행을 정량화한다. consistency_demo(질적 시연)의 수치판.

방법: (확립된 설정, 검수 대상 문장, 정답라벨) 세트를 만들고 consistency.check 를 돌려
  - 모순(라벨='모순')을 모순으로 잡는가      → 탐지율(recall)
  - 정상(라벨='정상')을 정상으로 통과시키는가  → 통과율(specificity)
  - 정상을 모순으로 잘못 잡는가              → 오탐(false alarm)
를 집계한다. 정답은 사람이 라벨링한 ground-truth(자기채점 아님 — 검수기의 분류 정확도 측정).

⚠️ 검수기는 우리(Gemini). 여기서 재는 건 "심판 우열"이 아니라 **우리 검수기가 사람 라벨과
   얼마나 일치하는가**(분류 정확도). LLM 변동성 보정 위해 각 항목 REPEATS회 반복.

실행: backend 폴더에서
    python -m scripts.consistency_eval        (conda nodevelture, LLM 키 필요)
서버·DB 불필요.
"""
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import asyncio

from app.services import consistency

# ── 라벨링된 평가 세트 (사람 정답) ────────────────────────────────
# 각 facts 아래: 명백한 모순 1 + 자연스러운 정상 1 (대조쌍)
CASES = [
    {
        "facts": "민준은 잠입 수사 중인 형사다. 카페에서 알바생으로 위장 중이다.",
        "items": [
            {"text": "민준은 사실 병원에서 일하는 외과 의사였다.", "label": "모순"},
            {"text": "민준은 주문서를 받아들고 무뚝뚝하게 고개를 끄덕였다.", "label": "정상"},
        ],
    },
    {
        "facts": "유나는 3년 전 화재로 동생을 잃었고, 그 뒤로 불을 몹시 무서워한다.",
        "items": [
            {"text": "유나는 모닥불 앞에서 환하게 웃으며 맨손으로 불씨를 집어 들었다.", "label": "모순"},
            {"text": "유나는 촛불이 흔들리자 자기도 모르게 손을 움츠렸다.", "label": "정상"},
        ],
    },
    {
        "facts": "이 마을에는 전기가 들어오지 않는다. 사람들은 밤이면 호롱불을 켠다.",
        "items": [
            {"text": "그는 벽의 전등 스위치를 올려 형광등을 환하게 켰다.", "label": "모순"},
            {"text": "그는 호롱불 심지를 돋우어 어두운 방을 밝혔다.", "label": "정상"},
        ],
    },
    {
        "facts": "이 왕국에는 마법이 존재하지 않는다. 모든 일은 오직 인간의 힘으로 해결된다.",
        "items": [
            {"text": "마법사가 주문을 외우자 굳게 닫힌 성문이 저절로 활짝 열렸다.", "label": "모순"},
            {"text": "병사 여럿이 도르래에 매달려 무거운 성문을 힘겹게 끌어 올렸다.", "label": "정상"},
        ],
    },
]

REPEATS = 2
BAR = "=" * 64


async def main():
    print(BAR)
    print(" 설정 모순 탐지(F-QC-01) 정량 평가")
    print(f" 대조쌍 {len(CASES)}세트(모순/정상 각 {len(CASES)}) × 각 {REPEATS}회 · 검수기=Vertex Gemini")
    print(BAR)

    # 집계 카운터
    det_hit = det_tot = 0     # 모순 탐지(라벨 모순을 모순으로)
    pass_hit = pass_tot = 0   # 정상 통과(라벨 정상을 정상으로)

    for case in CASES:
        facts = case["facts"]
        print(f"\n[설정] {facts}")
        for item in case["items"]:
            label = item["label"]
            flagged = 0
            for _ in range(REPEATS):
                r = await consistency.check(facts, item["text"])
                if not r["consistent"]:
                    flagged += 1
            # 판정: 모순 라벨이면 flagged 가 다수일 때 정답, 정상 라벨이면 flagged 0일 때 정답
            if label == "모순":
                det_tot += REPEATS
                det_hit += flagged
                mark = "✅탐지" if flagged >= (REPEATS + 1) // 2 else "❌놓침"
            else:
                pass_tot += REPEATS
                pass_hit += (REPEATS - flagged)
                mark = "✅통과" if flagged == 0 else f"⚠️오탐({flagged}/{REPEATS})"
            print(f"   [{label}] {mark:<12} ← {item['text'][:34]}")

    det_rate = 100 * det_hit / det_tot if det_tot else 0
    pass_rate = 100 * pass_hit / pass_tot if pass_tot else 0
    acc = 100 * (det_hit + pass_hit) / (det_tot + pass_tot) if (det_tot + pass_tot) else 0

    print(f"\n{BAR}")
    print(" 종합")
    print(BAR)
    print(f"  모순 탐지율(recall)     : {det_hit}/{det_tot}  ({det_rate:.0f}%)  — 모순을 모순으로")
    print(f"  정상 통과율(specificity): {pass_hit}/{pass_tot}  ({pass_rate:.0f}%)  — 정상을 정상으로(오탐 적을수록↑)")
    print(f"  전체 정확도(accuracy)    : {det_hit + pass_hit}/{det_tot + pass_tot}  ({acc:.0f}%)")
    print(BAR)


if __name__ == "__main__":
    asyncio.run(main())
