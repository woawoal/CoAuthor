from fastapi import APIRouter
from app.api.v1.endpoints import users, worlds, characters, sessions, dialogues, novels, chats

router = APIRouter(prefix="/api/v1")

router.include_router(users.router,      prefix="/users",                               tags=["users"])
router.include_router(worlds.router,     prefix="/worlds",                              tags=["worlds"])
router.include_router(characters.router, prefix="/worlds/{world_id}/characters",        tags=["characters"])
router.include_router(sessions.router,   prefix="/sessions",                            tags=["sessions"])
router.include_router(dialogues.router,  prefix="/sessions/{session_id}/dialogues",     tags=["dialogues"])
router.include_router(novels.router,     prefix="/sessions",                            tags=["novels"])
router.include_router(chats.router,      prefix="/chats",                               tags=["chats"])
