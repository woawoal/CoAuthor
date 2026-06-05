import logging
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.database import get_mongo_db
from app.schemas.character import CharacterCreate, CharacterUpdate

router = APIRouter()
logger = logging.getLogger(__name__)


def _to_response(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


@router.get("/")
async def list_characters(world_id: str):
    db = get_mongo_db()
    cursor = db["characters"].find({"world_id": world_id}, {"_id": 0})
    return await cursor.to_list(length=100)


@router.post("/", status_code=201)
async def create_character(world_id: str, body: CharacterCreate):
    db = get_mongo_db()
    world = await db["worlds"].find_one({"id": world_id})
    if not world:
        raise HTTPException(status_code=404, detail="세계관을 찾을 수 없습니다.")
    now = datetime.utcnow()
    char_id = str(uuid.uuid4())
    doc = {
        "id": char_id,
        "world_id": world_id,
        **body.model_dump(),
        "created_at": now,
    }
    await db["characters"].insert_one(doc)
    logger.info("캐릭터 생성: %s (world=%s)", body.name, world_id)
    return _to_response(doc)


@router.get("/{character_id}")
async def get_character(world_id: str, character_id: str):
    db = get_mongo_db()
    doc = await db["characters"].find_one({"id": character_id, "world_id": world_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
    return doc


@router.put("/{character_id}")
async def update_character(world_id: str, character_id: str, body: CharacterUpdate):
    db = get_mongo_db()
    doc = await db["characters"].find_one({"id": character_id, "world_id": world_id})
    if not doc:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    await db["characters"].update_one({"id": character_id}, {"$set": updates})
    doc.update(updates)
    return _to_response(doc)


@router.delete("/{character_id}", status_code=204)
async def delete_character(world_id: str, character_id: str):
    db = get_mongo_db()
    result = await db["characters"].delete_one({"id": character_id, "world_id": world_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="캐릭터를 찾을 수 없습니다.")