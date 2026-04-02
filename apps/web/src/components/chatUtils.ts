const THINK_RE = /<think>([\s\S]*?)<\/think>/gi;

/**
 * Extract `<think>…</think>` blocks from text.
 * Returns { cleaned, thinking } where cleaned has the tags stripped.
 */
export function extractThinkBlocks(text: string): { cleaned: string; thinking: string } {
  const blocks: string[] = [];
  const cleaned = text.replace(THINK_RE, (_match, inner) => {
    if (inner.trim()) blocks.push(inner.trim());
    return "";
  });
  return { cleaned: cleaned.trim(), thinking: blocks.join("\n\n") };
}

export function collectReasoning(parts: Array<Record<string, unknown>> | null): string {
  if (!parts) return "";
  const fromParts = parts
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

  const fromThinkTags = parts
    .filter((p) => String(p.type || "") === "text" && typeof p.text === "string")
    .map((p) => extractThinkBlocks(p.text as string).thinking)
    .filter(Boolean)
    .join("\n\n");

  return [fromParts, fromThinkTags].filter(Boolean).join("\n\n");
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
