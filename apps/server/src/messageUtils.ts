/** Best-effort user text from AI SDK UI messages */
export function lastUserTextFromMessages(
  messages: Array<{ role: string; content?: string; parts?: Array<{ type: string; text?: string }> }>
): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (last.parts?.length) {
    return last.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
  }
  return typeof last.content === "string" ? last.content : "";
}
