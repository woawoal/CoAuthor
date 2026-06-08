from fastapi import APIRouter, HTTPException
import json
import os

router = APIRouter()

# 경로 설정
CURRENT_FILE_PATH = os.path.abspath(__file__)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(CURRENT_FILE_PATH)))))
AUTHORS_PATH = os.path.join(BASE_DIR, "data/assets", "authors.json")
QUESTIONS_PATH = os.path.join(BASE_DIR, "data/assets", "questions.json")

@router.get("")
async def get_authors():
    try:
        if not os.path.exists(AUTHORS_PATH):
            raise HTTPException(status_code=404, detail="작가 정보를 찾을 수 없습니다.")
            
        with open(AUTHORS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.get("/{author_id}")
async def get_author(author_id: int):
    try:
        if not os.path.exists(AUTHORS_PATH):
            raise HTTPException(status_code=404, detail="작가 정보를 찾을 수 없습니다.")

        with open(AUTHORS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        author = next((item for item in data if str(item.get("id")) == str(author_id)), None)

        if not author:
            raise HTTPException(status_code=404, detail="해당 작가를 찾을 수 없습니다.")

        return author

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.get("/{author_id}/questions")
async def get_questions(author_id: int):
    try:
        if not os.path.exists(QUESTIONS_PATH):
            raise HTTPException(status_code=404, detail="질문 정보를 찾을 수 없습니다.")

        with open(QUESTIONS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        questions = data.get(str(author_id))

        if not questions:
            raise HTTPException(status_code=404, detail="해당 작가의 질문을 찾을 수 없습니다.")

        return questions

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))