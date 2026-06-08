const API_BASE_URL = `${import.meta.env.VITE_API_BASE_URL}api/v1`;

export async function getAuthors() {
  const response = await fetch(`${API_BASE_URL}/authors/`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("작가 목록을 불러오는데 실패했습니다.");
  }

  return response.json();
}

export async function getAuthor(authorId) {
  const response = await fetch(`${API_BASE_URL}/authors/${authorId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("작가 정보를 불러오는데 실패했습니다.");
  }

  return response.json();
}

export async function getQuestions(authorId) {
  const response = await fetch(`${API_BASE_URL}/authors/${authorId}/questions`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("질문 목록을 불러오는데 실패했습니다.");
  }

  return response.json();
}