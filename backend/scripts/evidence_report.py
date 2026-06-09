"""차별점 근거 리포트 (F-EV-06) — "맨손 작성 vs 우리 서비스" 정량 비교.

같은 상황을 두 방식으로 소설화해 LLM-judge로 채점한다:
  - 맨손(baseline): 페르소나·세계관·RAG·문체 없이 그냥 "소설로 써줘" (ChatGPT에 던지기)
  - 우리(ours)    : 작가 페르소나 + 세계관 + 문체 RAG 파이프라인

발표용 근거. 강사님 "맨손 대비 낫다는 근거를 보여라"에 대한 정량 답.

실행: backend 폴더에서
    python -m scripts.evidence_report   (conda nodevelture 환경, LLM 키 필요)
"""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import asyncio

from app.services import llm, evaluate
from app.services.llm_router import LLMRouter

WORLD_DESC = "제목: 잠입 수사 / 장르: 추리 / 배경: 비 오는 밤의 카페. 알바생 민준은 사실 정체를 숨긴 잠입 형사다."
PERSONA_ID = "hanyeoreum"
PERSONA_DESC = "한여름(로맨스): 인물의 신체 반응(심장·호흡·시선·손끝)을 먼저 쓰고 감각적 묘사로 감정을 올린다. 여운을 남긴다."

DIALOGUE = [
    {"role": "user", "content": "나는 비에 젖은 채 카페 문을 열고 들어선다."},
    {"role": "ai", "content": "민준이 무뚝뚝하게 고개를 들어 나를 본다. \"어서 오세요.\""},
    {"role": "user", "content": "나는 그의 눈빛에서 뭔가 다른 것을 느끼고 자리에 앉는다."},
]

BASELINE_SYSTEM = "당신은 소설가입니다. 아래 대화를 짧은 소설 한 장면으로 바꿔 주세요. 한국어로만."

BAR = "=" * 60


def _block(dialogue):
    return "\n".join(f"{'사용자' if m['role']=='user' else '상대'}: {m['content']}" for m in dialogue)


async def main():
    router = LLMRouter()
    print(BAR)
    print(" 차별점 근거 리포트 (F-EV-06) — 맨손 vs 우리")
    print(BAR)

    # 1) 맨손: 구조 없이 그냥 변환
    baseline = await llm.generate(
        BASELINE_SYSTEM,
        [{"role": "user", "parts": [{"text": _block(DIALOGUE)}]}],
    )
    # 2) 우리: 페르소나 + 세계관 + 문체 RAG
    ours = await router.generate_novel(DIALOGUE, WORLD_DESC, persona_id=PERSONA_ID)

    print("\n[맨손 결과]\n  " + (baseline or "").strip().replace("\n", "\n  ")[:300])
    print("\n[우리 결과]\n  " + (ours or "").strip().replace("\n", "\n  ")[:300])

    # 3) 동일 기준으로 채점
    s_base = await evaluate.score_novel(baseline, WORLD_DESC, PERSONA_DESC)
    s_ours = await evaluate.score_novel(ours, WORLD_DESC, PERSONA_DESC)

    print("\n" + BAR)
    print(f"{'평가 항목':<18}{'맨손':>6}{'우리':>6}")
    print("-" * 60)
    for k in evaluate._DIMS:
        print(f"{evaluate._DIM_LABEL[k]:<16}{s_base[k]:>6}{s_ours[k]:>6}")
    print("-" * 60)
    print(f"{'합계 (20점 만점)':<16}{s_base['total']:>6}{s_ours['total']:>6}")
    print(BAR)
    print(f"맨손 총평: {s_base['comment']}")
    print(f"우리 총평: {s_ours['comment']}")
    diff = s_ours["total"] - s_base["total"]
    verdict = "✅ 우리 서비스 우위" if diff > 0 else ("≈ 동률" if diff == 0 else "⚠️ 열위 — 점검 필요")
    print(f"\n판정: {verdict} (격차 {diff:+d}점)")
    print(BAR)


if __name__ == "__main__":
    asyncio.run(main())
