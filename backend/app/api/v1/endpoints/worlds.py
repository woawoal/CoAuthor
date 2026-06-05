import logging
import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.database import get_mongo_db
from app.schemas.world import WorldCreate, WorldUpdate

router = APIRouter()
logger = logging.getLogger(__name__)

DUMMY_USER_ID = "00000000-0000-0000-0000-000000000001"


def _to_response(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


@router.get("/")
async def list_worlds(user_id: str = DUMMY_USER_ID):
    db = get_mongo_db()
    cursor = db["worlds"].find({"user_id": user_id}, {"_id": 0})
    return await cursor.to_list(length=100)


@router.post("/", status_code=201)
async def create_world(body: WorldCreate, user_id: str = DUMMY_USER_ID):
    db = get_mongo_db()
    now = datetime.utcnow()
    world_id = str(uuid.uuid4())
    doc = {
        "id": world_id,
        "user_id": user_id,
        **body.model_dump(),
        "created_at": now,
        "updated_at": now,
    }
    await db["worlds"].insert_one(doc)
    logger.info("세계관 생성: %s (user=%s)", world_id, user_id)
    return _to_response(doc)


@router.get("/{world_id}")
async def get_world(world_id: str):
    db = get_mongo_db()
    doc = await db["worlds"].find_one({"id": world_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="세계관을 찾을 수 없습니다.")
    return doc


@router.put("/{world_id}")
async def update_world(world_id: str, body: WorldUpdate):
    db = get_mongo_db()
    doc = await db["worlds"].find_one({"id": world_id})
    if not doc:
        raise HTTPException(status_code=404, detail="세계관을 찾을 수 없습니다.")
    updates = {k: v for k, v in body.model_dump(exclude_none=True).items()}
    updates["updated_at"] = datetime.utcnow()
    await db["worlds"].update_one({"id": world_id}, {"$set": updates})
    doc.update(updates)
    return _to_response(doc)


@router.delete("/{world_id}", status_code=204)
async def delete_world(world_id: str):
    db = get_mongo_db()
    result = await db["worlds"].delete_one({"id": world_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="세계관을 찾을 수 없습니다.")