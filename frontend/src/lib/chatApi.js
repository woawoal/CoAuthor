import { API_BASE_URL } from './apiBase';

export async function sendMessage(chatId, payload) {
  return fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function connectChatStream(
  chatId,
  { content, character_id, mode = "author", world_context = "", check_consistency = false },
  onToken,
  onDone,
) {
  const params = new URLSearchParams({ content, character_id, mode, world_context });
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

export async function getNovel(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/novel`);
  if (!res.ok) throw new Error('소설 조회 실패');
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
