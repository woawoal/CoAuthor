"""팀 기념 일러스트 — 작가 4명 실제 이미지를 Vertex Gemini 2.5 Flash Image로 합성.

입력: frontend/public/assets/author{1..4}/author{N}.png  (백야·차로운·한여름·김도현)
출력: 레포 루트 team_celebration.png

실행: backend 폴더에서  python -m scripts.team_image
"""
import sys
from pathlib import Path
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from app.services import llm

REPO = Path(__file__).resolve().parent.parent.parent
ASSETS = REPO / "frontend" / "public" / "assets"
IMGS = [ASSETS / f"author{i}" / f"author{i}.png" for i in (1, 2, 3, 4)]
OUT = REPO / "team_celebration.png"

PROMPT = (
    "You are given four character portraits — four AI novelist personas of the service 'NodeVelture': "
    "a cool, pale horror-mystery author (baekya), a sharp analytical detective author (charoun), "
    "a warm gentle romance author (hanyeoreum), and a cozy calm everyday-essay author (kimdohyeon).\n\n"
    "Create ONE single warm, celebratory commemorative illustration that brings ALL FOUR characters "
    "together in the same scene, gathered around a single glowing finished novel/manuscript floating "
    "above an old wooden writing desk at dawn, its pages turning into soft particles of light rising up. "
    "Keep each character clearly recognizable from the given portraits (same faces, hair, outfit, vibe). "
    "Compose a dark-to-light gradient: cool moonlit blue on the horror/detective side, warm golden light "
    "on the romance/essay side, the two lights meeting in the middle over the manuscript. Cozy study with "
    "a tall window and floating books, the mood triumphant and warm — the end of a long night, 'we finished it'. "
    "Soft volumetric light, painterly cinematic illustration, highly detailed, emotional. "
    "Wide 16:9 cinematic composition."
)


def run():
    from vertexai.generative_models import GenerativeModel, Part
    llm._ensure_vertex()
    parts = [Part.from_data(data=p.read_bytes(), mime_type="image/png") for p in IMGS if p.exists()]
    print(f"입력 이미지 {len(parts)}장 → gemini-2.5-flash-image 합성 중…")
    parts.append(PROMPT)
    model = GenerativeModel("gemini-2.5-flash-image")
    resp = model.generate_content(parts, generation_config={"response_modalities": ["TEXT", "IMAGE"]})
    for cand in (getattr(resp, "candidates", None) or []):
        for part in (getattr(getattr(cand, "content", None), "parts", None) or []):
            inline = getattr(part, "inline_data", None)
            if inline and getattr(inline, "data", None):
                OUT.write_bytes(inline.data)
                print(f"✅ 저장: {OUT}  ({len(inline.data)//1024}KB)")
                return
    print("⚠️ 이미지 파트 없음 — 안전필터 차단 또는 모델이 IMAGE 미반환")


if __name__ == "__main__":
    run()
