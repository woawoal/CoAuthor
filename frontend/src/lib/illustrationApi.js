import { API_BASE_URL } from './apiBase';

export async function getIllustrationScenes(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/illustrations/recommend`);
  if (!res.ok) return { scenes: [] };
  return res.json();
}

export async function generateIllustration(sessionId, payload) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/illustrations/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('이미지 생성에 실패했어요.');
  return res.json();
}
