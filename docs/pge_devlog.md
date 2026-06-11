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

## dev 머지 충돌 해결 내역

- `chat_context.py`: `PROMPT_HISTORY_LIMIT` 10 / `DB_SYNC_INTERVAL` 5 (dev 값) 적용, 작가별 분리 히스토리 기능 유지
- `author_chat.py`: `prev_questions` 기능 유지, `get_author_chat_history` 엔드포인트에 `author_id` 쿼리 파라미터 추가
- `chats.py`: dev의 `session` 변수 저장 + 에러 로깅 적용, conflict marker 제거
- `main.css`: dev의 `.dashboard-btn` 스타일 추가
- `App.jsx`: `TokenDashboard` + `MyPage` 라우트 모두 유지
