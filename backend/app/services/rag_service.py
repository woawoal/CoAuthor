import logging
import numpy as np
from motor.motor_asyncio import AsyncIOMotorDatabase
from app.models.dialogue import DialogueDocument

logger = logging.getLogger(__name__)

_embed_model = None


def _get_embed_model():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        _embed_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
        logger.info("임베딩 모델 로드 완료")
    return _embed_model


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(np.dot(va, vb) / denom) if denom else 0.0


async def save_with_embedding(dialogue: DialogueDocument, mongo: AsyncIOMotorDatabase) -> None:
    model = _get_embed_model()
    embedding = model.encode(dialogue.content).tolist()
    doc = dialogue.model_dump()
    doc["embedding"] = embedding
    await mongo["dialogues"].insert_one(doc)
    logger.debug("대화 저장 완료 - turn %d, embedding dim: %d", dialogue.turn_order, len(embedding))


async def search_similar(
    query: str,
    session_id: str,
    mongo: AsyncIOMotorDatabase,
    top_k: int = 3,
) -> list[dict]:
    model = _get_embed_model()
    query_vec = model.encode(query).tolist()

    # MongoDB Atlas 없이 Python에서 코사인 유사도 계산 (MVP용)
    cursor = mongo["dialogues"].find(
        {"session_id": session_id, "embedding": {"$exists": True}},
        {"_id": 0, "content": 1, "speaker_type": 1, "embedding": 1},
    )
    docs = await cursor.to_list(length=200)

    if not docs:
        return []

    scored = sorted(
        docs,
        key=lambda d: _cosine_similarity(query_vec, d["embedding"]),
        reverse=True,
    )
    return [{"content": d["content"], "speaker_type": d["speaker_type"]} for d in scored[:top_k]]
