"""단발 나레이션 한 줄을 김도현(또는 지정 작가) 음성 mp3로 — 파일명=대사.

TEXT 만 바꿔서 다시 실행하면 됨. 출력: docs/시연_나레이션/문장별/
실행: backend 폴더에서  python -m scripts.tts_one
"""
import sys
import re
import asyncio
from pathlib import Path
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
from app.services import tts

# ── 여기만 바꿔서 재실행 ───────────────────────────────
TEXT = "다음으로, 우리의 작가 4명을 소개합니다."
AUTHOR_ID = 4   # 1=백야 2=차로운 3=한여름 4=김도현
# ──────────────────────────────────────────────────

OUT = Path(__file__).resolve().parent.parent.parent / "docs" / "시연_나레이션" / "문장별"


def safe(s):
    s = re.sub(r'[\\/:*?"<>|]', '', s.strip()).rstrip(' .')
    return s[:120] or "untitled"


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        audio = await tts.synthesize(TEXT, AUTHOR_ID)
    except Exception as e:
        print(f"❌ 실패: {str(e)[:80]}")
        return
    if not audio:
        print("⚠️ 빈 결과(키 없음/한도/차단)")
        return
    f = OUT / (safe(TEXT) + ".mp3")
    f.write_bytes(audio)
    print(f"✅ {f.name}  ({len(audio)//1024}KB)")


asyncio.run(main())
