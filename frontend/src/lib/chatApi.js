import { API_BASE_URL } from './apiBase';

export async function sendMessage(chatId, payload) {
  return fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function connectChatStream(chatId, { content, character_id, mode = "author", world_context = "" }, onToken, onDone) {
  const params = new URLSearchParams({ content, character_id, mode, world_context });
  const es = new EventSource(`${API_BASE_URL}/chats/${chatId}/stream?${params}`);

  es.addEventListener("reply", (event) => {
    const { narration, dialogue } = JSON.parse(event.data);
    onToken({ narration: narration || "", dialogue: dialogue || "" });
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
