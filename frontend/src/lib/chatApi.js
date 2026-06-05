const API_BASE_URL = `/api`;

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

  es.onerror = () => es.close();

  return es;
}
