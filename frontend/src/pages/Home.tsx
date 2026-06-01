import PersonaSelect from "../components/persona/PersonaSelect";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-8 p-8">
      <h1 className="text-3xl font-bold">AI 빙의작가</h1>
      <p className="text-gray-500">함께 쓸 작가를 선택하세요</p>
      <PersonaSelect />
    </main>
  );
}
