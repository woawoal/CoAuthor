import logging
import uuid
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.world import World
from app.schemas.world import WorldCreate, WorldUpdate, WorldResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/", response_model=list[WorldResponse])
async def list_worlds(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(World).where(World.user_id == user_id))
    return result.scalars().all()


@router.post("/", response_model=WorldResponse, status_code=201)
async def create_world(user_id: uuid.UUID, body: WorldCreate, db: AsyncSession = Depends(get_db)):
    world = World(user_id=user_id, **body.model_dump())
    db.add(world)
    await db.flush()
    await db.refresh(world)
    logger.info("세계관 생성: %s (user=%s)", world.id, user_id)
    return world


@router.get("/{world_id}", response_model=WorldResponse)
async def get_world(world_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(World).where(World.id == world_id))
    world = result.scalar_one_or_none()
    if not world:
        raise HTTPException(status_code=404, detail="세계관을 찾을 수 없습니다.")
    return world


@router.put("/{world_id}", response_model=WorldResponse)
async def update_world(world_id: uuid.UUID, body: WorldUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(World).where(World.id == world_id))
    world = result.scalar_one_or_none()
    if not world:
        raise HTTPException(status_code=404, detail="세계관을 찾을 수 없습니다.")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(world, field, value)

    await db.flush()
    await db.refresh(world)
    return world


@router.delete("/{world_id}", status_code=204)
async def delete_world(world_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(World).where(World.id == world_id))
    world = result.scalar_one_or_none()
    if not world:
        raise HTTPException(status_code=404, detail="세계관을 찾을 수 없습니다.")
    await db.delete(world)
