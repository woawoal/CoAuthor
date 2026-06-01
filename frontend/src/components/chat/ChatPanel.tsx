import { useState } from "react";
import { streamChat } from "../../api/client";
import type { Message, PersonaId } from "../../types";

interface Props {
  personaId: PersonaId;
}

export default function ChatPanel({ personaId }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const send = async () => {
    if (!input.trim() || streaming) return;

    const userMsg: Message = { role: "user", content: input, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    let assistantContent = "";
    const assistantMsg: Message = { role: "assistant", content: "", personaId, timestamp: Date.now() };
    setMessages((prev) => [...prev, assistantMsg]);

    for await (const chunk of streamChat(personaId, input, messages)) {
      assistantContent += chunk;
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...assistantMsg, content: assistantContent };
        return updated;
      });
    }
    setStreaming(false);
  };

  return (
    <aside className="w-80 flex flex-col border-l h-full bg-gray-50">
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`text-sm ${m.role === "user" ? "text-right" : "text-left"}`}>
            <span className={`inline-block px-3 py-2 rounded-lg ${m.role === "user" ? "bg-black text-white" : "bg-white border"}`}>
              {m.content || "▋"}
            </span>
          </div>
        ))}
      </div>
      <div className="p-3 border-t flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="작가에게 말하기..."
        />
        <button className="bg-black text-white px-3 py-2 rounded text-sm" onClick={send}>
          전송
        </button>
      </div>
    </aside>
  );
}
