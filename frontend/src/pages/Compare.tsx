import { useState } from "react";
import { compareGenres } from "../api/client";

export default function Compare() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCompare = async () => {
    setLoading(true);
    const data = await compareGenres(input);
    setResults(data.results);
    setLoading(false);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">장르 비교</h2>
      <textarea
        className="w-full border rounded p-3 h-24 mb-4"
        placeholder="한 문장을 입력하세요. 4명의 작가가 이어씁니다."
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        className="bg-black text-white px-6 py-2 rounded"
        onClick={handleCompare}
        disabled={loading}
      >
        {loading ? "생성 중..." : "4명에게 맡기기"}
      </button>

      {results && (
        <div className="grid grid-cols-2 gap-4 mt-8">
          {Object.entries(results).map(([pid, text]) => (
            <div key={pid} className="border rounded p-4">
              <p className="font-bold mb-2">{pid}</p>
              <p className="text-sm whitespace-pre-wrap">{text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
