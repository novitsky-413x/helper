export function collectReasoning(parts: Array<Record<string, unknown>> | null): string {
  if (!parts) return "";
  return parts
    .filter((p) => String(p.type || "") === "reasoning")
    .map((p) => {
      const candidates = [p.text, p.reasoning, p.content, p.value];
      for (const v of candidates) {
        if (typeof v === "string" && v.trim()) return v;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export interface ChatMessagePart {
  type: string;
  text?: string;
  reasoning?: string;
  toolInvocation?: {
    toolName?: string;
    state?: string;
    toolCallId?: string;
    args?: Record<string, unknown>;
    result?: unknown;
  };
}

export interface ChatMsg {
  id: string;
  role: string;
  content?: string;
  parts?: ChatMessagePart[];
}
