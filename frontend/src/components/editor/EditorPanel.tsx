import { useState } from "react";
import type { PersonaId } from "../../types";

interface Props {
  personaId: PersonaId;
}

export default function EditorPanel({ personaId }: Props) {
  const [content, setContent] = useState("");

  return (
    <main className="flex-1 flex flex-col p-8">
      <div className="mb-4 text-sm text-gray-400">
        소설 편집기 — <span className="font-medium text-gray-700">{personaId}</span>와 함께 쓰는 중
      </div>
      <textarea
        className="flex-1 w-full resize-none border rounded-lg p-4 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-black"
        placeholder="이야기를 시작하세요..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="mt-2 text-xs text-gray-300 text-right">{content.length}자</div>
    </main>
  );
}
