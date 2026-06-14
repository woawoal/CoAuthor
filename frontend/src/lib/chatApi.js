import { API_BASE_URL } from './apiBase';

export async function sendMessage(chatId, payload) {
  return fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// F-AS-05 작가 리액션 — 사용자 대사 → 작가 짧은 반응 한 줄(아바타 자막용)
export async function getAuthorReaction(chatId, payload) {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/reaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { reaction: '', emotion: '' };
  return res.json();
}

// 교정 '넘기기' → 그 단어를 세계관 보호 용어집에 영구 추가(다음 교정부터 제외)
export async function addGlossaryTerm(chatId, term) {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/glossary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ term }),
  });
  if (!res.ok) throw new Error('용어집 추가 실패');
  return res.json();
}

// 맞춤법/오탈자 검사 — F-QC-02 정답지 기반. errors:[{original,corrected,type,frequent,count}], memo:작가 톤 한 줄
export async function proofread(chatId, text, characterId = 'baekya') {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/proofread`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, character_id: characterId }),
  });
  if (!res.ok) return { errors: [], memo: '', count: 0 };
  return res.json();
}

// 능동 경고: 글쓰기 진입 시 '자주 틀리는 것'(2회 이상) 상위 N개. 실패/없으면 빈 배열.
export async function getErrorWarmup(chatId, limit = 3) {
  try {
    const res = await fetch(`${API_BASE_URL}/chats/${chatId}/error-warmup?limit=${limit}`);
    if (!res.ok) return { items: [], count: 0 };
    return res.json();
  } catch {
    return { items: [], count: 0 };
  }
}

export function connectChatStream(
  chatId,
  { content, character_id, mode = "author", world_context = "", speaker = "", check_consistency = false },
  onToken,
  onDone,
) {
  const params = new URLSearchParams({ content, character_id, mode, world_context });
  // @등장인물: 이 턴을 해당 인물의 시점·서사로 전개하도록 백엔드에 화자 전달
  if (speaker) params.set("speaker", speaker);
  // 일관성 검수(F-QC-01)를 켜면 응답에 consistency.violations 가 채워져 아바타가 짚어줄 수 있다.
  if (check_consistency) params.set("check_consistency", "true");
  const es = new EventSource(`${API_BASE_URL}/chats/${chatId}/stream?${params}`);

  es.addEventListener("reply", (event) => {
    // 백엔드는 narration·dialogue 외에 memories(기억 검색)·consistency(검수)도 함께 보낸다.
    const { narration, dialogue, memories, consistency } = JSON.parse(event.data);
    onToken({
      narration: narration || "",
      dialogue: dialogue || "",
      memories: memories || [],
      consistency: consistency || { consistent: true, violations: [] },
    });
  });

  es.addEventListener("audio", (event) => {
    const { audio } = JSON.parse(event.data);
    if (audio) {
      const blob = new Blob([Uint8Array.from(atob(audio), c => c.charCodeAt(0))], { type: 'audio/mpeg' });
      new Audio(URL.createObjectURL(blob)).play();
    }
  });

  es.addEventListener("done", () => {
    onDone?.();
    es.close();
  });

  es.onerror = () => { onDone?.(); es.close(); };

  return es;
}

export async function completeSession(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/complete`, {
    method: 'PATCH',
  });
  if (!res.ok) throw new Error('세션 종료 실패');
  return res.json();
}

export async function generateNovel(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/novel/generate`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('소설 저장 실패');
  return res.json();
}

export async function convertToNovel(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/novel/convert`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('소설 변환 실패');
  return res.json();
}

export async function getNovel(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/novel`);
  if (!res.ok) throw new Error('소설 조회 실패');
  return res.json();
}

export async function getVoiceSuggestions(chatId, payload) {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/voice-suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { suggestions: [] };
  return res.json();
}

export async function getSuggestions(chatId, payload) {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { suggestions: [] };
  return res.json();
}

export async function sendAuthorMessage(chatId, payload) {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/author/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('작가 AI 요청 실패');
  return res.json();
}

export async function generateAuthorRewrite(chatId, payload) {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/author/rewrite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('추천 문장 생성 실패');
  return res.json();
}

export async function getMemos(chatId) {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/memos`);
  if (!res.ok) return { memos: [] };
  return res.json();
}

export async function saveMemos(chatId, memos) {
  await fetch(`${API_BASE_URL}/chats/${chatId}/memos`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memos }),
  });
}

export async function getTasteRecommend(chatId, userId) {
  const res = await fetch(`${API_BASE_URL}/chats/${chatId}/author/taste-recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!res.ok) throw new Error('취향저격 추천 실패');
  return res.json();
}
