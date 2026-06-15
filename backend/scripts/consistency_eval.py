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
# tier: '명백'=직접 충돌 / '미묘'=시간선·인원수·관계·추론이 필요한 간접 모순
# 각 facts 아래: 모순 1 + (헷갈릴 수 있는) 정상 1 대조쌍
CASES = [
    # ── 명백 (직접 충돌) ──────────────────────────────────────
    {
        "tier": "명백",
        "facts": "민준은 잠입 수사 중인 형사다. 카페에서 알바생으로 위장 중이다.",
        "items": [
            {"text": "민준은 사실 병원에서 일하는 외과 의사였다.", "label": "모순"},
            {"text": "민준은 주문서를 받아들고 무뚝뚝하게 고개를 끄덕였다.", "label": "정상"},
        ],
    },
    {
        "tier": "명백",
        "facts": "유나는 3년 전 화재로 동생을 잃었고, 그 뒤로 불을 몹시 무서워한다.",
        "items": [
            {"text": "유나는 모닥불 앞에서 환하게 웃으며 맨손으로 불씨를 집어 들었다.", "label": "모순"},
            {"text": "유나는 촛불이 흔들리자 자기도 모르게 손을 움츠렸다.", "label": "정상"},
        ],
    },
    {
        "tier": "명백",
        "facts": "이 마을에는 전기가 들어오지 않는다. 사람들은 밤이면 호롱불을 켠다.",
        "items": [
            {"text": "그는 벽의 전등 스위치를 올려 형광등을 환하게 켰다.", "label": "모순"},
            {"text": "그는 호롱불 심지를 돋우어 어두운 방을 밝혔다.", "label": "정상"},
        ],
    },
    {
        "tier": "명백",
        "facts": "이 왕국에는 마법이 존재하지 않는다. 모든 일은 오직 인간의 힘으로 해결된다.",
        "items": [
            {"text": "마법사가 주문을 외우자 굳게 닫힌 성문이 저절로 활짝 열렸다.", "label": "모순"},
            {"text": "병사 여럿이 도르래에 매달려 무거운 성문을 힘겹게 끌어 올렸다.", "label": "정상"},
        ],
    },
    # ── 미묘 (간접·추론 필요) ─────────────────────────────────
    {
        "tier": "미묘",
        "facts": "수아는 오전 9시에 출근했고, 점심시간이 되어서야 김 부장을 처음 만났다.",
        "items": [
            # 첫 만남이 점심인데 출근 직후 9시에 이미 동행 → 시간선 모순
            {"text": "출근하자마자 9시, 수아는 김 부장과 나란히 엘리베이터에 올랐다.", "label": "모순"},
            {"text": "점심을 먹고 자리로 돌아온 수아는 그제야 김 부장의 이름을 외웠다.", "label": "정상"},
        ],
    },
    {
        "tier": "미묘",
        "facts": "그 집의 형제는 셋뿐이다. 첫째 도윤, 둘째 도현, 막내 도경.",
        "items": [
            # 넷째 등장 → 인원수 모순
            {"text": "넷째 도진이 형들 사이를 비집고 들어와 투정을 부렸다.", "label": "모순"},
            {"text": "막내 도경은 두 형의 눈치를 번갈아 살폈다.", "label": "정상"},
        ],
    },
    {
        "tier": "미묘",
        "facts": "노인은 두 눈을 잃어 앞을 전혀 보지 못한다. 평생 소리와 손끝으로 세상을 읽었다.",
        "items": [
            # 앞을 못 보는데 '색'을 알아봄 → 시각 능력 모순(간접)
            {"text": "노인은 멀리서 다가오는 손녀의 빨간 외투를 한눈에 알아보고 손을 흔들었다.", "label": "모순"},
            {"text": "노인은 익숙한 발소리만으로 손녀가 온 것을 알고 손을 흔들었다.", "label": "정상"},
        ],
    },
    {
        "tier": "미묘",
        "facts": "민호와 세진은 이혼한 지 5년 된 남남이다. 서로 연락도 끊고 지낸다.",
        "items": [
            # 이혼한 남남인데 '남편/아내'로 묘사 → 관계 모순(간접)
            {"text": "남편 민호는 아내 세진에게 아침상을 차려주며 다정하게 웃었다.", "label": "모순"},
            {"text": "민호는 길에서 세진을 마주치고도 모른 척 발걸음을 옮겼다.", "label": "정상"},
        ],
    },
    {
        "tier": "미묘",
        "facts": "이 도시는 해가 진 뒤 외출이 법으로 금지돼 있다. 밤거리는 늘 텅 비어 있다.",
        "items": [
            # 야간 외출 금지인데 한밤 광장이 북적 → 규칙 모순(추론)
            {"text": "한밤중, 광장은 산책 나온 시민들로 북적이며 웃음소리가 가득했다.", "label": "모순"},
            {"text": "해가 떨어지자 거리의 사람들이 서둘러 집 안으로 사라졌다.", "label": "정상"},
        ],
    },
    {
        "tier": "미묘",
        "facts": "지훈은 어릴 때 사고로 오른팔을 잃어, 의수를 쓰고 한 손으로 생활한다.",
        "items": [
            # 한 손인데 '두 손으로' → 신체 설정 모순(간접)
            {"text": "지훈은 두 손으로 무거운 상자를 번쩍 들어 가슴에 꼭 끌어안았다.", "label": "모순"},
            {"text": "지훈은 의수로 상자를 받치고 성한 손으로 균형을 잡으며 옮겼다.", "label": "정상"},
        ],
    },
]

REPEATS = 2
BAR = "=" * 64


def _line(tag, dh, dt, ph, pt):
    dr = 100 * dh / dt if dt else 0
    pr = 100 * ph / pt if pt else 0
    ac = 100 * (dh + ph) / (dt + pt) if (dt + pt) else 0
    return (f"  [{tag}] 모순탐지 {dh}/{dt}({dr:.0f}%) · "
            f"정상통과 {ph}/{pt}({pr:.0f}%) · 정확도 {dh+ph}/{dt+pt}({ac:.0f}%)")


async def main():
    tiers = sorted({c["tier"] for c in CASES})
    print(BAR)
    print(" 설정 모순 탐지(F-QC-01) 정량 평가 — 난이도별")
    print(f" {len(CASES)} 대조쌍 × 각 {REPEATS}회 · 난이도 {tiers} · 검수기=Vertex Gemini")
    print(BAR)

    # tier -> [det_hit, det_tot, pass_hit, pass_tot]
    agg = {t: [0, 0, 0, 0] for t in tiers}

    for case in CASES:
        facts, tier = case["facts"], case["tier"]
        print(f"\n[{tier}] {facts}")
        for item in case["items"]:
            label = item["label"]
            flagged = 0
            for _ in range(REPEATS):
                r = await consistency.check(facts, item["text"])
                if not r["consistent"]:
                    flagged += 1
            if label == "모순":
                agg[tier][0] += flagged
                agg[tier][1] += REPEATS
                mark = "✅탐지" if flagged >= (REPEATS + 1) // 2 else "❌놓침"
            else:
                agg[tier][2] += (REPEATS - flagged)
                agg[tier][3] += REPEATS
                mark = "✅통과" if flagged == 0 else f"⚠️오탐({flagged}/{REPEATS})"
            print(f"   [{label}] {mark:<12} ← {item['text'][:34]}")

    print(f"\n{BAR}")
    print(" 난이도별 / 종합  (모순탐지=recall · 정상통과=specificity)")
    print(BAR)
    total = [0, 0, 0, 0]
    for t in tiers:
        dh, dt, ph, pt = agg[t]
        total = [total[i] + agg[t][i] for i in range(4)]
        print(_line(t, dh, dt, ph, pt))
    print("  " + "-" * 58)
    print(_line("종합", *total))
    print(BAR)


if __name__ == "__main__":
    asyncio.run(main())
