export type PersonaId = "baegil" | "charoi" | "haseorim" | "kimdaha";

export interface Persona {
  id: PersonaId;
  name: string;
  genre: string;
  philosophy: string;
  greeting: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  personaId?: PersonaId;
  timestamp: number;
}

export type Mode = "together" | "coaching" | "compare";
