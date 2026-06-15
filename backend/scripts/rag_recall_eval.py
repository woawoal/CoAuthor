"""기억 RAG 정량 평가 — "묻어둔 설정을 꺼내오는가"를 OFF/ON × N회로 수치화.

rag_demo(질적 시연)를 정량화한 버전. 차별점 평가표의 '장기기억 회상' 행을 채운다.

흐름(시나리오마다):
  1) 핵심 설정(비밀)을 1턴에 심고
  2) 무관한 잡담 N턴으로 대화창 밖으로 밀어낸 뒤
  3) 그 설정을 묻는 질문을 RAG OFF / ON 으로 각 R회 생성

측정 지표:
  - 검색 회상률(recall_on) : ON일 때 '관련 기억'에 심은 사실이 떠오른 비율 (키워드 — 검색된 문장이
    곧 심은 문장이므로 키워드가 정확)
  - 응답 일치율(hit_on/off): 생성된 응답이 그 사실을 반영하는지 — **독립 LLM 심판(Groq/Llama)** 판정.
    (키워드 매칭은 은유적 반영을 놓쳐 과소평가 → 의미 판정으로 교체. 심판은 생성기 Gemini와 다른 계열.)

⚠️ generate_novel(집필형 변환) 경로엔 기억 RAG가 없다 — 기억 RAG는 채팅 /stream 에만 있으므로
   이 스크립트가 차별점(장기기억)을 재는 유일한 정량 도구다.

실행: backend 폴더에서
    python -m scripts.rag_recall_eval        (conda nodevelture, DB·임베딩 키 필요)
서버 불필요(인프로세스 TestClient). 심판은 EVAL_JUDGE_PROVIDER(기본 groq)로 강제.
"""
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import os
import re
import asyncio
import json
import uuid

from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.database import AsyncSessionLocal, engine
from app.models.user import User
from app.services import llm

# ── 독립 심판(응답 일치 판정) ─────────────────────────────────────
# 생성기는 우리(Gemini). 심판은 다른 계열(Groq/Llama)로 강제해 자기채점 회피.
def _has_groq() -> bool:
    return bool((settings.GROQ_API_KEY or "").strip() or (settings.GROQ_API_KEYS or "").strip())


JUDGE_PROVIDER = os.getenv("EVAL_JUDGE_PROVIDER") or ("groq" if _has_groq() else None)

JUDGE_SYSTEM = (
    "너는 응답이 '주어진 비밀 사실'을 반영하는지 판정하는 엄격한 채점관이다.\n"
    "[비밀 사실]의 내용이 [응답]에 직접 언급되거나, 자연스럽게 암시·전제되면 reflects=true.\n"
    "전혀 드러나지 않거나(일반적 서술) 모순되면 reflects=false.\n"
    '오직 JSON만 출력: {"reflects": true}'
)


async def _judge(secret: str, response: str) -> bool:
    """응답이 비밀 사실을 반영하면 True. 심판 없거나 실패 시 키워드 폴백은 호출부에서."""
    if not (response or "").strip() or not JUDGE_PROVIDER:
        return False
    prompt = f"[비밀 사실]\n{secret}\n\n[응답]\n{response}"
    try:
        raw = await llm.generate(
            JUDGE_SYSTEM, [{"role": "user", "parts": [{"text": prompt}]}],
            json_mode=True, provider=JUDGE_PROVIDER,
        )
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=re.MULTILINE)
        return bool(json.loads(cleaned).get("reflects"))
    except Exception:
        return False

# ── 시나리오 ──────────────────────────────────────────────────
FILLERS = [
    "나는 따뜻한 커피를 한 모금 마신다.",
    "창밖에는 여전히 비가 내리고 있다.",
    "나는 메뉴판을 천천히 살펴본다.",
    "가게 안에 잔잔한 음악이 흐른다.",
    "나는 휴대폰을 꺼내 시간을 확인한다.",
]

SCENARIOS = [
    {
        "name": "잠입형사",
        "secret": "민준은 사실 잠입 수사 중인 형사다. 정체를 숨기고 카페에서 일하는 척하고 있다.",
        "keys": ["형사", "잠입", "수사"],
        "probe": "문득 궁금해진다. 민준의 진짜 정체가 뭐였지?",
    },
    {
        "name": "화재트라우마",
        "secret": "유나는 3년 전 화재로 동생을 잃었다. 그 뒤로 불을 보면 손이 떨린다.",
        "keys": ["화재", "동생", "불"],
        "probe": "유나는 왜 촛불 앞에서 그렇게 굳어버린 걸까?",
    },
    {
        "name": "금지된우물",
        "secret": "이 마을 사람들은 뒷산 우물에 절대 접근하지 않는다. 오래전 그곳에서 끔찍한 일이 있었기 때문이다.",
        "keys": ["우물", "마을", "접근"],
        "probe": "사람들은 어째서 뒷산 쪽으로는 발길도 하지 않는 거지?",
    },
]

REPEATS = 3          # 시나리오당 OFF/ON 각 R회 생성
BAR = "=" * 64


def _ask(c, sid, text, use_rag):
    """/stream 호출 → reply 파싱해 {narration,dialogue,memories} 반환."""
    out = {"narration": "", "dialogue": "", "memories": []}
    with c.stream("GET", f"/api/v1/chats/{sid}/stream", params={
        "content": text, "character_id": "hanyeoreum",
        "world_context": "", "mode": "author",
        "use_rag": str(use_rag).lower(),
    }) as resp:
        for line in resp.iter_lines():
            if line and line.startswith("data:"):
                try:
                    d = json.loads(line[5:].strip())
                    for key in out:
                        if key in d and d[key]:
                            out[key] = d[key]
                except Exception:
                    pass
    return out


def _kw(text: str, keys: list[str]) -> bool:
    return any(k in (text or "") for k in keys)


def _reply_text(ans: dict) -> str:
    return (ans["narration"] + " " + ans["dialogue"]).strip()


async def _make_user():
    suffix = uuid.uuid4().hex[:8]
    async with AsyncSessionLocal() as s:
        u = User(username=f"recall_{suffix}", email=f"recall_{suffix}@t.com", hashed_password="x")
        s.add(u)
        await s.flush()
        uid = str(u.id)
        await s.commit()
    await engine.dispose()   # 이 루프에 묶인 풀 해제 → 이후 TestClient가 새 풀로 동작
    return uid


def _build_session(c, uid: str) -> str:
    w = c.post(f"/api/v1/worlds/?user_id={uid}", json={
        "title": "기억 평가", "description": "장기기억 테스트", "genre": "드라마",
        "setting": "", "rules": "",
    }).json()["id"]
    p = c.post(f"/api/v1/worlds/{w}/characters/", json={
        "user_id": uid, "name": "나", "role": "protagonist",
        "personality": "평범한 인물", "prompt": "", "is_ai_controlled": False,
    }).json()["id"]
    return c.post("/api/v1/sessions/", json={
        "world_id": w, "user_id": uid, "protagonist_id": p, "author_id": 3,
    }).json()["id"]


def collect_scenario(c, uid: str, sc: dict) -> dict:
    """TestClient(동기)로 생성만 수집 — 심판(async)은 나중에 일괄."""
    sid = _build_session(c, uid)

    def send(text):
        c.post(f"/api/v1/chats/{sid}/messages", json={"content": text})
        _ask(c, sid, text, use_rag=True)

    send(sc["secret"])                       # 1턴: 비밀 심기
    for f in FILLERS:                        # N턴: 잡담으로 밀어내기
        send(f)
    c.post(f"/api/v1/chats/{sid}/messages", json={"content": sc["probe"]})  # 질문 1회 게시

    trials = []
    for _ in range(REPEATS):
        off = _ask(c, sid, sc["probe"], use_rag=False)
        on = _ask(c, sid, sc["probe"], use_rag=True)
        trials.append({
            "recall_on": any(_kw(m, sc["keys"]) for m in on["memories"]),
            "on_text": _reply_text(on),
            "off_text": _reply_text(off),
        })
    return {"name": sc["name"], "secret": sc["secret"], "trials": trials}


async def _judge_all(results: list[dict]):
    """각 trial의 on/off 응답을 독립 심판으로 판정해 hit 채움."""
    for r in results:
        for t in r["trials"]:
            t["hit_on"] = await _judge(r["secret"], t["on_text"])
            t["hit_off"] = await _judge(r["secret"], t["off_text"])


def main():
    uid = asyncio.run(_make_user())

    print(BAR)
    print(" 기억 RAG 정량 평가 — 묻어둔 설정 회상 (OFF vs ON)")
    print(f" 시나리오 {len(SCENARIOS)}종 × 잡담 {len(FILLERS)}턴 매장 × 각 {REPEATS}회")
    print(f" 생성기=Vertex Gemini / 응답심판={JUDGE_PROVIDER or '없음(키워드 폴백)'}")
    print(BAR)

    results = []
    with TestClient(app) as c:
        for sc in SCENARIOS:
            results.append(collect_scenario(c, uid, sc))

    # 응답 일치 판정(독립 심판) — TestClient 종료 후 일괄
    asyncio.run(_judge_all(results))

    for r in results:
        n = len(r["trials"])
        recall = sum(t["recall_on"] for t in r["trials"])
        hon = sum(t["hit_on"] for t in r["trials"])
        hoff = sum(t["hit_off"] for t in r["trials"])
        print(f"\n[{r['name']}]  (n={n})")
        print(f"  검색 회상(ON)   : {recall}/{n}  — 관련 기억에 사실이 떠오름")
        print(f"  응답 일치(ON)   : {hon}/{n}  — 답변이 사실을 반영(심판)")
        print(f"  응답 일치(OFF)  : {hoff}/{n}  — RAG 끄면(낮을수록 차별점↑)")

    tot = len(results) * REPEATS
    s_recall = sum(t["recall_on"] for r in results for t in r["trials"])
    s_on = sum(t["hit_on"] for r in results for t in r["trials"])
    s_off = sum(t["hit_off"] for r in results for t in r["trials"])

    print(f"\n{BAR}")
    print(" 종합")
    print(BAR)
    print(f"  검색 회상률(ON)    : {s_recall}/{tot}  ({100*s_recall/tot:.0f}%)")
    print(f"  응답 일치율(ON)    : {s_on}/{tot}  ({100*s_on/tot:.0f}%)")
    print(f"  응답 일치율(OFF)   : {s_off}/{tot}  ({100*s_off/tot:.0f}%)")
    gap = (s_on - s_off) / tot * 100
    print(f"  ▶ 차별점(ON−OFF)  : {'+' if gap >= 0 else ''}{gap:.0f}%p  (기억 RAG가 만든 회상 격차)")
    print(BAR)
    if s_off >= s_on:
        print(" ⚠️ OFF가 ON 이상 — 잡담 매장 부족/최근 윈도우 큼/요약 누수. FILLERS 늘려 재측정.")


if __name__ == "__main__":
    main()
