# API 명세

Base URL: `http://localhost:8000/api/v1`

Swagger UI: `http://localhost:8000/docs`

---

## Users

### 회원가입
```
POST /users/register
```

**요청 body**
```json
{
  "username": "홍길동",
  "email": "hong@example.com",
  "password": "password1234"
}
```

**응답 201**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "홍길동",
  "email": "hong@example.com",
  "is_active": true,
  "created_at": "2024-01-01T00:00:00"
}
```

**에러**
- `409` : 이미 사용 중인 이메일

---

### 유저 조회
```
GET /users/{user_id}
```

**응답 200** : `UserResponse` 형식 (위와 동일)

---

## Worlds (세계관)

### 세계관 목록 조회
```
GET /worlds?user_id={uuid}
```

**응답 200**
```json
[
  {
    "id": "...",
    "user_id": "...",
    "title": "마법의 대륙",
    "description": "...",
    "genre": "판타지",
    "setting": "중세 유럽풍",
    "rules": "마법은 감정으로 발동된다",
    "created_at": "...",
    "updated_at": "..."
  }
]
```

### 세계관 생성
```
POST /worlds?user_id={uuid}
```

**요청 body**
```json
{
  "title": "마법의 대륙",
  "description": "고대 마법이 지배하는 세계",
  "genre": "판타지",
  "setting": "중세 유럽풍 대륙",
  "rules": "마법은 감정으로 발동된다. 거짓말을 하면 마법력을 잃는다."
}
```

**응답 201** : `WorldResponse`

### 세계관 수정
```
PUT /worlds/{world_id}
```
- body : 수정할 필드만 (나머지는 null로 보내면 무시됨)

### 세계관 삭제
```
DELETE /worlds/{world_id}
```
- **응답 204** (body 없음)
- 연관된 Characters, Sessions 전부 함께 삭제됨

---

## Characters (등장인물)

### 캐릭터 목록
```
GET /worlds/{world_id}/characters
```

### 캐릭터 생성
```
POST /worlds/{world_id}/characters
```

**요청 body**
```json
{
  "name": "아리아",
  "role": "supporting",
  "personality": "차갑지만 의리 있는 성격. 감정 표현이 서툴다.",
  "background": "왕국에서 추방된 기사 출신",
  "appearance": "은발, 날카로운 회색 눈",
  "is_ai_controlled": true,
  "system_prompt": "당신은 아리아입니다. 차갑고 간결하게 말하며, 필요할 때만 감정을 드러냅니다."
}
```

**role 가능 값**
| 값 | 의미 |
|---|---|
| `protagonist` | 주인공 (사용자가 조작) |
| `supporting` | 조연 (AI 제어) |
| `villain` | 빌런 (AI 제어) |
| `narrator` | 나레이터 (AI 제어) |

### 캐릭터 수정
```
PUT /worlds/{world_id}/characters/{character_id}
```

### 캐릭터 삭제
```
DELETE /worlds/{world_id}/characters/{character_id}
```

---

## Sessions (창작 세션)

### 세션 시작
```
POST /sessions
```

**요청 body**
```json
{
  "world_id": "...",
  "user_id": "...",
  "protagonist_id": "..."
}
```
> `protagonist_id` : 사용자가 맡을 주인공 캐릭터 ID

**응답 201**
```json
{
  "id": "...",
  "world_id": "...",
  "user_id": "...",
  "protagonist_id": "...",
  "status": "active",
  "started_at": "...",
  "ended_at": null
}
```

### 세션 조회
```
GET /sessions/{session_id}
```

### 세션 완료
```
PATCH /sessions/{session_id}/complete
```
- status를 `active` → `completed` 로 변경
- `ended_at` 자동 기록
- 이후 소설 변환 가능

---

## Dialogues (대화)

### 대화 목록 조회
```
GET /sessions/{session_id}/dialogues
```
- turn_order 순서로 정렬됨

**응답 200**
```json
[
  {
    "id": "...",
    "session_id": "...",
    "speaker_type": "user",
    "character_id": null,
    "content": "아리아, 지금 무슨 생각을 하고 있어?",
    "turn_order": 0,
    "created_at": "..."
  },
  {
    "id": "...",
    "speaker_type": "character",
    "character_id": "아리아-uuid",
    "content": "...쓸데없는 걸 묻는군.",
    "turn_order": 1,
    "created_at": "..."
  }
]
```

### 대화 스트리밍 (SSE)
```
POST /sessions/{session_id}/dialogues/stream
Content-Type: application/json

{
  "content": "아리아, 지금 무슨 생각을 하고 있어?",
  "character_id": "아리아-uuid"
}
```

**응답** : `text/event-stream`
```
data: ...쓸데없는 걸 묻는군.

data: [DONE]
```

- 사용자 발화 → DB 저장 → AI 응답 스트리밍 → 완료 후 AI 발화 DB 저장
- 세션이 `active` 상태일 때만 사용 가능

---

## Novels (소설 초안)

### 소설 조회
```
GET /sessions/{session_id}/novel
```

### 소설 생성 (대화 → 소설 변환)
```
POST /sessions/{session_id}/novel/generate
```
- 세션이 `completed` 상태여야 함
- 같은 세션에 이미 소설이 있으면 `409` 에러

**응답 201**
```json
{
  "id": "...",
  "session_id": "...",
  "title": "제목 없음",
  "content": "...(변환된 소설 내용)...",
  "status": "draft",
  "created_at": "...",
  "updated_at": "..."
}
```

### 소설 수정
```
PATCH /sessions/{session_id}/novel
```

**요청 body**
```json
{
  "title": "어둠 속의 기사",
  "content": "수정된 소설 내용..."
}
```

---

## 공통 에러 코드

| 코드 | 의미 |
|------|------|
| 400 | 잘못된 요청 (상태 불일치 등) |
| 404 | 리소스 없음 |
| 409 | 중복 (이미 존재함) |
| 422 | 입력값 유효성 검사 실패 |
| 500 | 서버 내부 오류 |

**에러 응답 형식**
```json
{
  "detail": "에러 메시지"
}
```
