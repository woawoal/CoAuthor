// FastAPI로 교체 시 NEXT_PUBLIC_API_BASE_URL 환경변수만 변경
const API_BASE_URL = "/api";

export async function sendMessage(chatId, payload) {
  return fetch(`${API_BASE_URL}/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function connectChatStream(chatId, onToken, onDone) {
  const es = new EventSource(`${API_BASE_URL}/chats/${chatId}/stream`);

  es.addEventListener("token", (event) => {
    const data = JSON.parse(event.data);
    onToken(data);
  });

  es.addEventListener("done", () => {
    onDone?.();
    es.close();
  });

  es.onerror = () => es.close();

  return es;
}
