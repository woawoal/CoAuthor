"""소설 MOS 샘플 추출기 — 블라인드 A/B 평가용 10편 생성.

동일 대화 입력 5개를 각각:
  - 우리:      generate_novel(persona_id, use_style=True)   ← 페르소나 + 문체 RAG
  - 베이스라인: generate_novel(persona_id="", use_style=False) ← 같은 Gemini, 페르소나·문체층 제거
로 변환 → 10편을 **블라인드 라벨(샘플 1~10)로 셔플**해 평가지(mos_samples.md)에 출력하고,
정답키(어느 게 우리/베이스라인인지)는 평가자에게 안 주는 별도 파일(mos_answer_key.csv)에 저장.

평가자는 mos_samples.md만 보고 4축(몰입·문체개성·캐릭터일관성·완성도)을 1~5로 채점.
집계 후 정답키로 조건별 평균을 낸다.

실행: backend 폴더에서  python -m scripts.mos_sample_prep   (conda nodevelture, Vertex 키)
"""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import random
import asyncio
from pathlib import Path

from app.services.llm_router import LLMRouter

OUT_DIR = Path(__file__).resolve().parent.parent / "data"

# 입력 대화 5개 (작가별 1편씩 + 1편 추가). 짧은 채팅 로그 → 소설로 변환됨.
SCENARIOS = [
    {
        "id": "S1",
        "persona_id": "hanyeoreum",
        "genre": "로맨스",
        "world": "비 오는 날의 동네 카페. 주인공 '나'는 오래전 헤어진 첫사랑 민준을 우연히 마주친다.",
        "dialogue": [
            {"role": "user", "content": "우산을 접고 카페 문을 연다. 구석 자리에 익숙한 옆모습이 보인다. \"...설마.\""},
            {"role": "assistant", "content": "빗소리에 묻혀 그가 천천히 고개를 들었다. 민준이었다. 그의 눈이 잠시 흔들렸다."},
            {"role": "user", "content": "심장이 내려앉는다. 모른 척 지나칠까 하다가, 결국 그 앞에 선다. \"오랜만이야.\""},
        ],
    },
    {
        "id": "S2",
        "persona_id": "baekya",
        "genre": "호러·미스터리",
        "world": "낡은 빌라 301호. 주인공은 한 번도 열린 적 없던 옆방에서 밤마다 소리를 듣는다.",
        "dialogue": [
            {"role": "user", "content": "새벽 세 시. 또 그 소리가 들린다. 옆방, 분명 비어 있는 그 방에서. 나는 벽에 귀를 댄다."},
            {"role": "assistant", "content": "긁는 소리였다. 손톱 같기도, 아니기도 한. 벽 너머의 무언가가, 내가 귀를 댄 그 자리를 정확히 알고 있는 것처럼 멈췄다."},
            {"role": "user", "content": "숨을 죽인다. \"...누구세요.\" 목소리가 떨린다."},
        ],
    },
    {
        "id": "S3",
        "persona_id": "charoun",
        "genre": "본격 추리",
        "world": "연쇄 실종 사건을 쫓는 형사 주인공. 세 번째 피해자의 방에서 단서를 발견한다.",
        "dialogue": [
            {"role": "user", "content": "피해자의 책상 서랍을 연다. 맨 아래, 영수증 한 장이 깔려 있다. 날짜는 실종 당일."},
            {"role": "assistant", "content": "그 영수증엔 세 사람분의 커피값이 찍혀 있었다. 혼자 살던 피해자가, 실종 당일 누군가 둘과 마주 앉았다는 뜻이다."},
            {"role": "user", "content": "\"세 명...\" 나는 영수증을 증거봉투에 넣으며 중얼거린다. \"넌 혼자가 아니었구나.\""},
        ],
    },
    {
        "id": "S4",
        "persona_id": "kimdohyeon",
        "genre": "일상·에세이",
        "world": "야근 후 퇴근길. 특별한 사건은 없고, 주인공은 편의점 앞 벤치에 잠시 앉는다.",
        "dialogue": [
            {"role": "user", "content": "버스를 놓쳤다. 굳이 다음 버스를 기다리지 않고 편의점 앞 벤치에 앉는다. 캔커피 하나를 딴다."},
            {"role": "assistant", "content": "미지근한 커피였다. 길 건너 간판들이 하나씩 꺼지고 있었다. 딱히 슬프지도, 기쁘지도 않은 밤이었다."},
            {"role": "user", "content": "휴대폰을 꺼냈다가 다시 넣는다. 연락할 사람이 떠오르지 않아서가 아니라, 그냥 오늘은 아무 말도 하고 싶지 않아서."},
        ],
    },
    {
        "id": "S5",
        "persona_id": "hanyeoreum",
        "genre": "로맨스",
        "world": "같은 회사 동료인 두 사람. 야근하다 둘만 사무실에 남았다.",
        "dialogue": [
            {"role": "user", "content": "사무실엔 우리 둘뿐이다. 키보드 소리만 들린다. 그가 내 자리로 의자를 굴려 온다. \"이거 같이 봐줄 수 있어요?\""},
            {"role": "assistant", "content": "모니터를 함께 들여다보는 사이, 어깨가 닿았다. 그는 떨어지지 않았고, 나도 비키지 않았다. 화면의 글자가 눈에 들어오지 않았다."},
            {"role": "user", "content": "고개를 돌리자 생각보다 가까운 거리에 그의 얼굴이 있다. \"...뭐, 뭐 보고 있었죠?\" 괜히 말을 더듬는다."},
        ],
    },
]


async def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    router = LLMRouter()

    async def gen(sc):
        ours = await router.generate_novel(sc["dialogue"], sc["world"], sc["persona_id"], use_style=True)
        base = await router.generate_novel(sc["dialogue"], sc["world"], "", use_style=False)
        return sc, ours, base

    print("=" * 60)
    print(" MOS 소설 샘플 생성 중 (5 시나리오 × 2 조건 = 10편)…")
    print("=" * 60)
    results = await asyncio.gather(*(gen(sc) for sc in SCENARIOS))

    # (조건, 시나리오, 텍스트) 풀 → 블라인드 셔플
    pool = []
    for sc, ours, base in results:
        pool.append(("ours", sc["id"], sc["persona_id"], sc["genre"], ours))
        pool.append(("base", sc["id"], sc["persona_id"], sc["genre"], base))
    random.shuffle(pool)

    # 평가지(블라인드) + 정답키
    samples_md = ["<!-- markdownlint-disable -->",
                  "# MOS 평가지 — 소설 결과물 (블라인드)", "",
                  "> 아래 10편을 읽고 각 편을 4축으로 **1~5점** 채점하세요(구글폼에 입력).",
                  "> 1=매우 나쁨 · 3=보통 · 5=매우 좋음. **어느 게 어떤 시스템인지는 모릅니다(블라인드).**", "",
                  "**채점 4축**: ① 몰입도 ② 문체 개성(작가다움) ③ 캐릭터 일관성 ④ 완성도", "",
                  "---", ""]
    key_csv = ["sample_no,condition,scenario,persona,genre"]

    for i, (cond, sid, persona, genre, text) in enumerate(pool, 1):
        samples_md.append(f"## 샘플 {i:02d}")
        samples_md.append("")
        samples_md.append(text.strip() if text else "(생성 실패)")
        samples_md.append("")
        samples_md.append("→ 몰입 [ ] · 문체 [ ] · 캐릭터 [ ] · 완성도 [ ]")
        samples_md.append("")
        samples_md.append("---")
        samples_md.append("")
        key_csv.append(f"{i:02d},{cond},{sid},{persona},{genre}")

    (OUT_DIR / "mos_samples.md").write_text("\n".join(samples_md), encoding="utf-8")
    (OUT_DIR / "mos_answer_key.csv").write_text("\n".join(key_csv), encoding="utf-8")

    print(f"✅ 평가지 : {OUT_DIR / 'mos_samples.md'}  (평가자에게 배포)")
    print(f"🔒 정답키 : {OUT_DIR / 'mos_answer_key.csv'}  (평가자에게 주지 말 것 — 집계용)")
    print("   조건 분포:", {c: sum(1 for p in pool if p[0] == c) for c in ('ours', 'base')})


if __name__ == "__main__":
    asyncio.run(main())
