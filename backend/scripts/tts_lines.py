"""시연 나레이션을 '줄(대사) 단위'로 김도현 TTS(mp3) 생성 — 파일명 = 대사.

docs/시연_나레이션/나레이션.md 를 읽어:
  - 빈 줄 / 타임코드 줄(예: 1:03) 은 건너뜀
  - 각 내용 줄을 김도현(author_id=4) 음성으로 합성 → "{대사}.mp3" 로 저장
출력: docs/시연_나레이션/문장별/

전제: backend/.env 의 ELEVENLABS_API_KEY_2 (김도현=키2) 동작. 빈 결과면 그 줄 건너뜀.
실행: backend 폴더에서  python -m scripts.tts_lines
"""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import re
import asyncio
from pathlib import Path

from app.services import tts

# 백야: v1 음성ID(XTqHG68…)는 key2 계정에 없어 404였음 → key2의 백야 v2로 생성(이 스크립트 한정).
#   ※ 참고: 사용자에 따르면 '진짜' 백야/한여름 음성은 key1 계정에 있음. v2는 key2의 대체 음성.
tts._VOICE_MAP["baekya"] = "Velz1FYYWzS1Ro8Ln77l"
tts._API_KEY_MAP["baekya"] = "ELEVENLABS_API_KEY_2"
# 한여름은 key1 계정에만 있음(_API_KEY_MAP 기본=key1 유지) → key1 한도 차면 401, 충전/리셋 후 재실행.

DEFAULT_AUTHOR = 4  # 김도현 (마커 없는 줄 기본 음성)
VOICE = {"백야": 1, "차로운": 2, "한여름": 3, "김도현": 4}  # *X 목소리로* → author_id
REPO = Path(__file__).resolve().parent.parent.parent
SRC = REPO / "docs" / "시연_나레이션" / "나레이션.md"
OUT_DIR = REPO / "docs" / "시연_나레이션" / "문장별"

_TIMECODE = re.compile(r"^\d{1,2}:\d{2}\s*$")              # "1:03" 같은 타임코드 줄
_VOICE_MARK = re.compile(r"^\*\s*(.+?)\s*목소리로\s*\*$")   # *백야 목소리로* (조건)
_BADCHARS = re.compile(r'[\\/:*?"<>|]')                     # 윈도우 파일명 금지문자


def safe_name(s: str) -> str:
    s = _BADCHARS.sub("", s.strip()).rstrip(" .")
    return s[:120] or "untitled"


def load_lines() -> list[tuple[str, int]]:
    """(대사, author_id) 목록. '*X 목소리로*' 마커는 다음 줄의 음성을 바꾼다."""
    out = []
    pending = None
    for raw in SRC.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or _TIMECODE.match(line):
            continue
        m = _VOICE_MARK.match(line)
        if m:                                   # 음성 조건 줄 → 읽지 않고, 다음 줄에 적용
            pending = VOICE.get(m.group(1).strip(), DEFAULT_AUTHOR)
            continue
        out.append((line, pending if pending is not None else DEFAULT_AUTHOR))
        pending = None                          # 한 줄에만 적용 후 기본으로 복귀
    return out


async def synth_retry(text: str, author_id: int, tries: int = 4):
    """429(레이트리밋)면 백오프 재시도. 401(키 소진)/빈결과면 즉시 None."""
    for i in range(tries):
        try:
            audio = await tts.synthesize(text, author_id)
            return audio or None
        except Exception as e:
            msg = str(e)
            if "429" in msg and i < tries - 1:
                await asyncio.sleep(3 * (i + 1))     # 3s, 6s, 9s 백오프
                continue
            return ("ERR", msg[:70])
    return None


async def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    lines = load_lines()
    print(f"대상 줄: {len(lines)}개 · 출력: {OUT_DIR}")

    done = fail = skip = 0
    for idx, (text, author_id) in enumerate(lines, 1):
        name = safe_name(text)
        fpath = OUT_DIR / f"{name}.mp3"
        if fpath.exists():               # 이미 생성된 건 건너뜀(재시도 시 비용 절약)
            skip += 1
            continue
        res = await synth_retry(text, author_id)
        if isinstance(res, tuple):       # 오류
            print(f"  ❌ [{idx:02d}] {res[1]} · {text[:22]}")
            fail += 1
        elif not res:
            print(f"  ⚠️ [{idx:02d}] 빈 결과 · {text[:22]}")
            fail += 1
        else:
            fpath.write_bytes(res)
            vname = {1: '백야', 2: '차로운', 3: '한여름', 4: '김도현'}.get(author_id, author_id)
            print(f"  ✅ [{idx:02d}] ({vname}) {name}.mp3  ({len(res)//1024}KB)")
            done += 1
        await asyncio.sleep(1.2)         # 호출 간 간격(429 회피)

    print(f"\n완료 — 신규 {done} · 건너뜀(기존) {skip} · 실패 {fail}")
    if fail:
        print("실패분은 키2(김도현) 한도 소진 가능 — 잠시 뒤 재실행하면 남은 것만 다시 시도함.")


if __name__ == "__main__":
    asyncio.run(main())
