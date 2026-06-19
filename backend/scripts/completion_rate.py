"""완료율 측정 — 세션 상태 집계로 Task Completion Rate 산출 (+ 참여도 필터).

정량 평가표의 '완료율(세션 정상종료)' 행을 채운다.
  완료율(%) = completed / (active + paused + completed) × 100

문제: 개발 중 만든 '테스트 세션'(세계관만 만들고 몇 턴 치다 버린 것)이 분모를 키워
      완료율을 끌어내린다. 그래서 **사용자가 실제로 친 턴 수(USER dialogue 수)** 로
      참여 임계값을 두고 **'진짜 유저 흐름' 완료율**을 함께 보고한다(보정값).
      ※ 임계값으로 거르는 건 휴리스틱이다 — 'dev 계정'을 따로 표시하지 않으므로
        '몰입한 테스트 세션'도 포함될 수 있다. 그래도 raw보다 실사용에 가깝다.

실행: backend 폴더에서  python -m scripts.completion_rate     (conda nodevelture, .env DB)
"""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import asyncio
from collections import Counter

from sqlalchemy import select, func

from app.database import AsyncSessionLocal
import app.models  # noqa: F401  (전체 모델 등록 — 관계 해석용)
from app.models.session import Session
from app.models.dialogue import Dialogue, SpeakerType


async def main():
    async with AsyncSessionLocal() as s:
        # 세션별 (상태, 사용자가 친 USER 턴 수)
        user_turns = (
            select(Dialogue.session_id, func.count(Dialogue.id).label("ut"))
            .where(Dialogue.speaker_type == SpeakerType.USER)
            .group_by(Dialogue.session_id)
            .subquery()
        )
        rows = (await s.execute(
            select(Session.status, func.coalesce(user_turns.c.ut, 0))
            .select_from(Session)
            .join(user_turns, user_turns.c.session_id == Session.id, isouter=True)
        )).all()

    sessions = [(str(getattr(st, "value", st)), int(ut or 0)) for st, ut in rows]
    total = len(sessions)
    dist = Counter(st for st, _ in sessions)

    def rate_at(min_turns: int):
        pool = [(st, ut) for st, ut in sessions if ut >= min_turns]
        comp = sum(1 for st, _ in pool if st == "completed")
        n = len(pool)
        return comp, n, (comp / n * 100 if n else 0.0)

    print("=" * 60)
    print(" 세션 완료율 (Task Completion Rate)")
    print("=" * 60)
    print(f"  상태 분포: active={dist.get('active', 0)} · paused={dist.get('paused', 0)} · completed={dist.get('completed', 0)}  (total={total})")
    print(f"  0턴(생성만 하고 안 씀): {sum(1 for _, ut in sessions if ut == 0)}건")
    print()
    print("  참여 임계값별 완료율 (USER 턴 수 ≥ k 인 세션만):")
    print(f"  {'기준':<22}{'completed/n':>14}{'완료율':>10}")
    print("  " + "-" * 46)
    for k, label in [(0, "전체(raw)"), (1, "≥1턴(시작이라도)"), (3, "≥3턴(실제 참여)"), (5, "≥5턴(몰입)"), (10, "≥10턴(깊게)")]:
        comp, n, r = rate_at(k)
        print(f"  {label:<22}{f'{comp}/{n}':>14}{f'{r:.1f}%':>10}")
    print("  " + "-" * 46)
    print("  ※ 목표 ≥80%. raw는 테스트 세션이 끌어내림 → ≥3턴(실제 참여)이 실사용에 가까운 보정값.")
    print("  ※ 휴리스틱(턴 수)일 뿐 dev 계정 분리는 아님 — 한계 함께 공개.")
    if total == 0:
        print("\n※ 세션이 없습니다. 데모 세션을 몇 개 만든 뒤 다시 측정하세요.")


if __name__ == "__main__":
    asyncio.run(main())
