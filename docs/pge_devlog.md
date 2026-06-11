# pge 브랜치 개발 로그

## 마이페이지 전면 개편

### 대시보드 신설 (`/mypage` 기본 탭)
- 기존 내 작품 위에 '작가의 작업실' 느낌의 대시보드 탭 추가
- 구성: 오늘의 작가 편지 / 이어쓰기 / 최근 AI 피드백 / 이번 주 집필 현황 / 함께한 작가
- 하단에 총 작품 수 · 완결 수 · 집필 일수 · 작품당 평균 글자 수 숫자 통계 배치
- 아바타·아이디·이메일 표시 제거

### 오늘의 작가 편지
- 4인 작가별 regular 편지 2편 + 상황별 편지 5종 (absence / completed / slump / milestone_10k / first_work)
- `determineSituation()` 로직: first_work → milestone_10k → completed → absence → slump → regular 우선순위
- `getDailyLetter()`: regular는 4인 랜덤 로테이션, 상황별은 해당 작가 고정
- `{protagonist}` 플레이스홀더 — 최근 작품 주인공 이름으로 치환, 없으면 '주인공' 폴백
- 시연용 랜덤 로테이션 (`Math.random()` 기반, 자정 기반으로 원복 예정)

### 백엔드 대시보드 API (`GET /mypage/dashboard`)
- `days_since_active`, `resume_work`(protagonist_name 포함), `recent_feedback`, `weekly_chars`, `weekly_goal`, `author_shares` 반환
- `resume_work`에서 `protagonist_id` → `Character` 조회로 주인공 이름 반환

### AI 작가 기록 퍼센티지
- 별 5개 → 작가별 함께한 작품 수 / 전체 작품 수 비중 퍼센트 바로 교체

### NAV 재구성
- 순서: 대시보드 → 최근 작업 → 설정집 → 문장 보관함 → AI 작가 기록 → 내 작품 → 업적
- 프로필 탭 제거 (통계는 대시보드 하단으로 이동)

### 내 작품 탭
- 완결 작품만 표시
- 클릭 시 `/read/${session_id}` 라우트로 이동 (기존 ReadNovel 컴포넌트 재사용)

### 최근 작업 탭
- 미완결 작품에 '이어쓰기 →' 버튼 추가
- 완결 작품에는 이어쓰기 버튼 미표시

---

## 💾 문장 보관함 저장 버튼

- chat / editor 페이지 AI 작가 메시지 버블 우상단에 💾 버튼 추가
- 클릭 시 `saveSentence()` 호출 → 문장 보관함에 저장
- 저장 후 1.5초간 ✓ 표시 피드백
- `userId`는 `authClient.getSession()` 으로 로드

---

## 집필형 ↔ 참여형 연동 개선

### 이어쓰기 모드 분기 (`/storylist`)
- editor / chat 진입 시 `localStorage.session_mode_{chatId}` 에 모드 기록
- 이어쓰기 버튼 클릭 시 기록된 모드에 따라 `/editor` 또는 `/chat` 으로 분기 (기록 없으면 기본 chat)

### 집필형 원고 유지
- 집필형 → 참여형 전환 시 `manuscriptContent`를 `localStorage.manuscript_{chatId}` 에 저장
- 참여형 재진입 시 localStorage 에서 복원 → 채팅 종료 후 돌아와도 원고 표시 유지

### editor 저장 버튼
- 헤더의 '저장됨' 상태 메시지 옆에 수동 저장 버튼 추가
- 저장 중일 때 비활성화

---

## 신규 파일

| 파일 | 설명 |
|------|------|
| `frontend/src/lib/authorLetters.js` | 작가 편지 데이터 + `getDailyLetter` / `determineSituation` |
| `frontend/src/lib/mypageApi.js` | `getDashboard`, `getStats`, `saveSentence` 등 마이페이지 API 클라이언트 |
| `frontend/src/pages/mypage/mypage.jsx` | 마이페이지 전체 UI |
| `frontend/src/pages/mypage/mypage.css` | 마이페이지 스타일 |
| `backend/app/api/v1/endpoints/mypage.py` | 마이페이지 전용 엔드포인트 (12개 라우트) |
| `backend/app/models/saved_sentence.py` | 문장 보관함 ORM 모델 |
| `backend/migrations/versions/f1a2b3c4d5e6_add_mypage_tables.py` | saved_sentences 테이블 마이그레이션 |

---

## 오른쪽 패널 personas.py 연동

### personas.py 대규모 업데이트
- `_AUTHOR_PERSONALITY` 에 `feedback_lens`, `rewrite_rule` 필드 추가 (작가별 피드백 관점 + 추천문장 작성 지침)
- `_WORLD_PERSONA` 신설 — 세계관 구축 단계 전용 톤/퓨샷
- `PERSONA_PROMPTS` 에 `[피드백 FEW-SHOT]` 섹션 추가
- `build_feedback_prompt(persona_id, world_context)` 신규 — `feedback_lens` 기반 단발성 피드백
- `build_rewrite_prompt(persona_id, original, feedback, world_context)` 신규 — `original + feedback` 구조 입력, `rewrite_rule + novel_style + load_persona_rule` 전부 적용
- `build_story_prompt()` 신규 — 경량 줄거리 이어쓰기 (피드백 없음)

### backend `author_chat.py`
- `AuthorMessageRequest` 에 `mode: str = 'chat'` 필드 추가 (`'chat'` | `'feedback'`)
- `mode='feedback'` 분기: `build_feedback_prompt()` 사용, RAG/히스토리 없이 단발성 평가
- `POST /{chat_id}/author/rewrite` 엔드포인트 신설 — `original + feedback` 받아 `build_rewrite_prompt()` 호출, 히스토리 저장 안 함

### backend `prompts/author.py`
- `load_persona_rule(author_id, compact=True)` 임포트 추가
- `build_author_system()` 에 `[스타일 규칙]` 섹션 주입 — compact 모드(예시 제외, 금지항목 + 규칙만)

### frontend `chatApi.js`
- `generateAuthorRewrite(chatId, payload)` 함수 추가 → `POST /author/rewrite` 호출

### frontend `chat/ui.jsx`, `editor/ui.jsx`
- `handleFeedback()`: excerpt만 추출해 `{ mode: 'feedback' }` 으로 전송 (기존 일반 채팅 분기 → 피드백 전용 프롬프트)
- `fetchRecommendation(aiMsgId, authorId, userText, aiFeedback)`: 시그니처 변경, `generateAuthorRewrite({ original, feedback })` 호출로 교체
- `handleSendAuthorMessage(overrideText, { skipRecommend, mode })`: `mode` 파라미터 추가, `data.content` 를 `fetchRecommendation` 에 전달

### 프롬프트 흐름 정리
```
피드백 받기 버튼 → build_feedback_prompt()          (feedback_lens, 단발성)
추천 문장 자동생성 → build_rewrite_prompt()          (original + feedback, 전체 스타일 규칙 적용)
작가 직접 채팅    → build_author_messages()          (히스토리 유지, 메타 레벨 대화)
```

### chat/ui.css
- `.author-msg--recommend` 스타일 추가 — 점선 테마 컬러 테두리, hover 강조
- `.rec-context-menu` / `.rec-context-menu__item` 추가 — 추천문장 우클릭 컨텍스트 메뉴

---

## dev 머지 충돌 해결 내역

- `chat_context.py`: `PROMPT_HISTORY_LIMIT` 10 / `DB_SYNC_INTERVAL` 5 (dev 값) 적용, 작가별 분리 히스토리 기능 유지
- `author_chat.py`: `prev_questions` 기능 유지, `get_author_chat_history` 엔드포인트에 `author_id` 쿼리 파라미터 추가
- `chats.py`: dev의 `session` 변수 저장 + 에러 로깅 적용, conflict marker 제거
- `main.css`: dev의 `.dashboard-btn` 스타일 추가
- `App.jsx`: `TokenDashboard` + `MyPage` 라우트 모두 유지
