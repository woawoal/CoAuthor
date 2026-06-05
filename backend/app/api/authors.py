from fastapi import APIRouter, HTTPException
import json
import os

router = APIRouter()

# 경로 설정
CURRENT_FILE_PATH = os.path.abspath(__file__)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(CURRENT_FILE_PATH)))
METADATA_PATH = os.path.join(BASE_DIR, "data/assets", "authors.json")

@router.get("")
async def get_authors():
    try:
        if not os.path.exists(METADATA_PATH):
            raise HTTPException(status_code=404, detail="작가 정보를 찾을 수 없습니다.")
            
        with open(METADATA_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))