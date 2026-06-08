import { API_BASE_URL } from './apiBase';

export async function sendMessage(chatId, payload) {
  return fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function connectChatStream(chatId, { content, character_id, mode = "author" }, onToken, onDone) {
  const params = new URLSearchParams({ content, character_id, mode });
  const es = new EventSource(`${API_BASE_URL}/chats/${chatId}/stream?${params}`);

  es.addEventListener("token", (event) => {
    const data = JSON.parse(event.data);
    onToken(data);
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
