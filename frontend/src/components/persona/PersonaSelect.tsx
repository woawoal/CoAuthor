import { useNavigate } from "react-router-dom";
import type { Persona } from "../../types";

const PERSONAS: Persona[] = [
  { id: "baegil",   name: "백일",   genre: "스릴러/미스터리", philosophy: "공포는 안 보여주는 것이다",     greeting: "...오셨군요. 무엇을 쓰고 싶으십니까." },
  { id: "charoi",   name: "차로이", genre: "본격 추리",        philosophy: "생각보다 서투르다고 가정해라", greeting: "시간 없으니 바로 시작하죠." },
  { id: "haseorim", name: "하서림", genre: "로맨스",           philosophy: "심장이 두근거려야 하는 페이지", greeting: "어떤 오늘 날 이야기를 써볼까요?" },
  { id: "kimdaha",  name: "김다하", genre: "일상/성장이야기",  philosophy: "평범한 시간이 더 문학적이다",   greeting: "오늘 어떤 하루였어요?" },
];

export default function PersonaSelect() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 gap-6 w-full max-w-2xl">
      {PERSONAS.map((p) => (
        <button
          key={p.id}
          className="border rounded-xl p-6 text-left hover:bg-gray-50 transition"
          onClick={() => navigate(`/write/${p.id}`)}
        >
          <p className="text-xs text-gray-400 mb-1">{p.genre}</p>
          <p className="text-xl font-bold mb-2">{p.name}</p>
          <p className="text-sm text-gray-600 italic mb-3">"{p.philosophy}"</p>
          <p className="text-sm text-gray-500">{p.greeting}</p>
        </button>
      ))}
    </div>
  );
}
