import { useParams } from "react-router-dom";
import EditorPanel from "../components/editor/EditorPanel";
import ChatPanel from "../components/chat/ChatPanel";
import type { PersonaId } from "../types";

export default function Write() {
  const { personaId } = useParams<{ personaId: PersonaId }>();

  if (!personaId) return null;

  return (
    <div className="flex h-screen">
      <EditorPanel personaId={personaId} />
      <ChatPanel personaId={personaId} />
    </div>
  );
}
