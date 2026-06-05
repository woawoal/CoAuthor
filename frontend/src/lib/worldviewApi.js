const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL}api/v1`;

// 테스트용 더미 user_id (인증 구현 전까지 고정)
// PostgreSQL users 테이블에 이 UUID 행이 존재해야 World FK 통과
const DUMMY_USER_ID = "00000000-0000-0000-0000-000000000001";

/**
 * 세계관 + 캐릭터 일괄 저장
 * @param {{ world: object, characters: object[] }} payload
 * @returns {Promise<string>} 생성된 world_id (UUID)
 */
export async function createWorldview({ world, characters }) {
  // 1. 세계관 생성
  const worldRes = await fetch(`${API_BASE_URL}/worlds/?user_id=${DUMMY_USER_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(world),
  });
  if (!worldRes.ok) {
    const err = await worldRes.json().catch(() => ({}));
    throw new Error(err.detail || "세계관 생성 실패");
  }
  const { id: worldId } = await worldRes.json();

  // 2. 캐릭터 생성 (순서대로)
  for (const char of characters) {
    const charRes = await fetch(`${API_BASE_URL}/worlds/${worldId}/characters/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: DUMMY_USER_ID,
        name: char.name,
        role: char.role,
        personality: char.personality,
        prompt: char.system_prompt,   // worldview 폼 필드명 → DB 컬럼명
        is_ai_controlled: true,
      }),
    });
    if (!charRes.ok) {
      const err = await charRes.json().catch(() => ({}));
      throw new Error(err.detail || `캐릭터 '${char.name}' 생성 실패`);
    }
  }

  return worldId;
}
