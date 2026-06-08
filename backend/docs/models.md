# DB 모델 명세

## ERD (텍스트)

```
User ──────────┬──── World ────────── Character
               │         │                 │
               │         └──── Session ────┤
               │                   │       │
               └───────────────────┤       │
                                   │       │
                              Dialogue ────┘
                                   │
                              (Session 완료 후)
                                   │
                                Novel

ApiLog ──── User
       └─── Session
```

---

## 테이블별 상세

### `users`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 기본키 |
| username | VARCHAR(50) UNIQUE | 사용자명 |
| email | VARCHAR(255) UNIQUE | 이메일 |
| hashed_password | VARCHAR(255) | bcrypt 해시 |
| is_active | BOOLEAN | 계정 활성 여부 |
| created_at | TIMESTAMP | 가입일 |

---

### `worlds` (세계관)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 기본키 |
| user_id | UUID (FK → users) | 소유자 |
| title | VARCHAR(200) | 세계관 제목 |
| description | TEXT | 세계관 설명 |
| genre | VARCHAR(50) | 장르 (판타지, 스릴러 등) |
| setting | TEXT | 시대/공간 배경 |
| rules | TEXT | 세계관 규칙/법칙 |
| created_at | TIMESTAMP | 생성일 |
| updated_at | TIMESTAMP | 수정일 |

- `user_id` 삭제 시 연관 worlds 전부 삭제 (CASCADE)

---

### `characters` (등장인물)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 기본키 |
| world_id | UUID (FK → worlds) | 소속 세계관 |
| name | VARCHAR(100) | 이름 |
| role | ENUM | protagonist / supporting / villain / narrator |
| personality | TEXT | 성격 묘사 |
| background | TEXT | 배경 스토리 |
| appearance | TEXT | 외모 묘사 |
| is_ai_controlled | BOOLEAN | AI 제어 여부 (조연 = true) |
| system_prompt | TEXT | AI에게 전달할 캐릭터 지시문 |
| created_at | TIMESTAMP | 생성일 |

- `world_id` 삭제 시 연관 characters 전부 삭제 (CASCADE)
- `is_ai_controlled = false` : 사용자가 직접 조작하는 주인공

---

### `sessions` (창작 세션)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 기본키 |
| world_id | UUID (FK → worlds) | 사용할 세계관 |
| user_id | UUID (FK → users) | 참여 유저 |
| protagonist_id | UUID (FK → characters) | 사용자가 맡을 주인공 캐릭터 |
| status | ENUM | active / paused / completed |
| started_at | TIMESTAMP | 시작 시각 |
| ended_at | TIMESTAMP (nullable) | 종료 시각 |

- 상태 전이: `active` → `paused` / `completed`
- `completed` 상태에서만 소설 변환 가능

---

### `dialogues` (대화 로그)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 기본키 |
| session_id | UUID (FK → sessions) | 소속 세션 |
| speaker_type | ENUM | user / character |
| character_id | UUID (FK → characters, nullable) | AI 캐릭터 (user 발화 시 null) |
| content | TEXT | 발화 내용 |
| turn_order | INTEGER | 대화 순서 (0부터 시작) |
| created_at | TIMESTAMP | 저장 시각 |

- `speaker_type = user` → `character_id = null`
- `speaker_type = character` → `character_id` 에 AI 캐릭터 ID

---

### `novels` (소설 초안)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 기본키 |
| session_id | UUID (FK → sessions, UNIQUE) | 원본 세션 (1:1) |
| title | VARCHAR(200) | 소설 제목 |
| content | TEXT | 소설 본문 |
| status | ENUM | draft / generating / final |
| created_at | TIMESTAMP | 생성일 |
| updated_at | TIMESTAMP | 수정일 |

- 세션 하나당 소설 하나 (UNIQUE 제약)
- `generating` : LLM이 변환 중인 상태

---

### `api_logs` (AI API 호출 로그)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID (PK) | 기본키 |
| user_id | UUID (FK → users, nullable) | 요청 유저 |
| session_id | UUID (FK → sessions, nullable) | 관련 세션 |
| endpoint | VARCHAR(255) | 호출한 API 경로 |
| model_used | VARCHAR(100) | 사용한 AI 모델명 |
| prompt_tokens | INTEGER | 입력 토큰 수 |
| completion_tokens | INTEGER | 출력 토큰 수 |
| total_cost | FLOAT | 비용 (USD) |
| created_at | TIMESTAMP | 호출 시각 |

---

## 관계 정리

| 관계 | 종류 | 비고 |
|------|------|------|
| User → World | 1:N | 유저 삭제 시 world 전부 삭제 |
| World → Character | 1:N | world 삭제 시 character 전부 삭제 |
| World → Session | 1:N | |
| User → Session | 1:N | |
| Session → Dialogue | 1:N | session 삭제 시 dialogue 전부 삭제 |
| Session → Novel | 1:1 | |
| Character → Dialogue | 1:N | AI 캐릭터 발화 기록 |
