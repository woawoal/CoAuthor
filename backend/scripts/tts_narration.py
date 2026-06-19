"""시연 영상용 — 데모_시나리오.md §8 김도현 나레이션 대본을 김도현 TTS(mp3)로 출력.

각 문단을 끊어 생성(호흡·억양 자연스럽게) → narration_0.mp3 ~ narration_9.mp3.
영상 편집기에서 화면 액션과 싱크 맞추면 됨.

전제:
  - ElevenLabs 키가 동작해야 함: backend/.env 에 ELEVENLABS_API_KEY_2=... (김도현=키2)
  - 빈 결과(키 없음/IP 차단)면 그 문단은 건너뜀.

실행: backend 폴더에서
    python -m scripts.tts_narration
    OUT_DIR=../docs/시연_나레이션 python -m scripts.tts_narration   # 출력 폴더 지정
"""
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import os
import asyncio

from app.services import tts

AUTHOR_ID = 4  # 4 = 김도현
OUT_DIR = os.getenv("OUT_DIR", "narration_out")

# §8 대본 — 이모지·따옴표·기호 없이 읽힐 텍스트만 (문서와 동기화)
SEGMENTS = [
    ("0_오프닝", "안녕하세요. 김도현입니다. 일상을 쓰는 작가예요. 소설, 쓰고는 싶은데 첫 줄부터 막히죠. 저도 그랬어요. 여기선 그냥 저랑 이야기하면 됩니다. 그러다 보면, 한 편이 남아요. 천천히 보여드릴게요."),
    ("1_작가세계관", "먼저 작가를 골라요. 저 말고도 셋이 더 있어요. 호러, 추리, 로맨스. 고르면 말투도, 화면 색도 바뀝니다. 세계관은 같이 만들어요. 막막하면 예시를 받아도 되고요. 등장인물도 몇 명 적어두면, 그 친구들이 이따 직접 말을 합니다."),
    ("2_대화창작_기억", "이제 제가 첫 장면을 던집니다. 그쪽은 주인공이 되어 대답만 하면 돼요. 옆에 메모로, 사실 이 친구는 첫사랑이었다, 같은 걸 적어두면, 그 설정을 잊지 않습니다. 대화가 길어져도요. 보통 AI는 길어지면 앞을 흘리거든요. 여긴 안 그래요. 기억하고 있어요."),
    ("3_검수", "가끔 제가 딴소리를 할 때가 있어요. 아까 형사라더니, 갑자기 의사라거나. 그걸 옆에서 짚어줍니다. 어, 설정이랑 안 맞는데요, 하고. 너무 깐깐한 건 또 싫으니까, 끄고 켤 수도 있어요."),
    ("4_장르가드", "일상 이야기인데 갑자기 용이 나타나면, 제가 물어봐요. 이거, 들여보낼까요, 하고. 허락하면 그때 받아들입니다. 세계관은 지키되, 결정은 그쪽이 해요."),
    ("5_리액션_음성", "참, 지금 이 목소리. 제 목소리예요. 대화하다 보면 제가 짧게 반응도 하고, 가끔 소리 내서 읽어주기도 합니다. 도구라기보단, 옆자리에 앉은 사람 같달까요."),
    ("6_교정_오답", "맞춤법도 봐드려요. 근데 혼내진 않아요. 자주 틀리는 건 기억해뒀다가, 다음엔 틀리기 전에 먼저 알려줍니다. 또 이거 틀리시네요, 하는 친구가 하나쯤 있으면 좋잖아요."),
    ("7_소설변환", "이야기가 끝나면, 종료를 누릅니다. 잠깐만요. 제가 지금 쓰고 있어요. 방금 나눈 대화가, 한 편의 소설이 됩니다. 제 문체로요. 채팅 덩어리가 아니라, 진짜 읽을 수 있는 글이에요."),
    ("8_삽화", "마음에 드는 장면은 그림으로도 남겨요. 한 장면을 고르면, 삽화가 됩니다."),
    ("9_클로징", "여기엔 그동안 쓴 게 다 쌓여요. 저장해둔 문장, 자주 틀린 것, 작품들. 그리고 제가 가끔 보내는 편지까지요. 쓸수록, 이 공간이 그쪽을 조금씩 알아갑니다. 한 번 잘 써주고 끝나는 도구 말고, 끝까지 같이 쓰는 사람. 그게 저희가 만들고 싶었던 거예요. 천천히, 와서 써보세요."),
]


async def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    ok, skipped = 0, 0
    for label, text in SEGMENTS:
        audio = await tts.synthesize(text, author_id=AUTHOR_ID)
        if not audio:
            print(f"  [{label}] TTS 빈 결과(키 없음/IP 차단?) — 건너뜀")
            skipped += 1
            continue
        path = os.path.join(OUT_DIR, f"narration_{label}.mp3")
        with open(path, "wb") as f:
            f.write(audio)
        print(f"  [{label}] 저장: {path}  ({len(audio):,} bytes)")
        ok += 1

    print()
    print(f"완료: {ok}개 생성, {skipped}개 건너뜀 → 폴더: {os.path.abspath(OUT_DIR)}")
    if skipped:
        print("건너뛴 게 있으면 backend/.env 의 ELEVENLABS_API_KEY_2 를 확인하세요(김도현=키2).")


if __name__ == "__main__":
    asyncio.run(main())
