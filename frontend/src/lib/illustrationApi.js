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

// ── 저장된 삽화 (DB 영속 — 다른 기기/계정에서도 보임) ───────────────
export async function listIllustrations(sessionId) {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/illustrations`);
  if (!res.ok) return { illustrations: [] };
  return res.json();
}

export async function createIllustration(sessionId, payload) {
  // payload: { image_url, caption }
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}/illustrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('삽화 저장에 실패했어요.');
  return res.json();
}

export async function removeIllustration(sessionId, illusId) {
  await fetch(`${API_BASE_URL}/sessions/${sessionId}/illustrations/${illusId}`, { method: 'DELETE' });
}
