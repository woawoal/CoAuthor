const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export async function* streamChat(
  personaId: string,
  text: string,
  history: { role: string; content: string }[]
): AsyncGenerator<string> {
  const res = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona_id: personaId, text, history }),
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}

export async function compareGenres(text: string) {
  const res = await fetch(`${BASE_URL}/api/compare/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return res.json();
}

export async function getCoaching(personaId: string, userText: string) {
  const res = await fetch(`${BASE_URL}/api/coaching/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona_id: personaId, user_text: userText }),
  });
  return res.json();
}
