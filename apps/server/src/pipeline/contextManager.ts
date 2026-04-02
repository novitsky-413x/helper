import type { CoreMessage } from "ai";

const DEFAULT_CONTEXT_WINDOW = 8192;
const RESERVE_OUTPUT_TOKENS = 2048;

export function getModelContextWindow(
  modelId: string,
  models: Array<{ id: string; context_length?: number | null }>,
): number {
  const m = models.find((mod) => mod.id === modelId);
  return m?.context_length ?? DEFAULT_CONTEXT_WINDOW;
}

function estimateMessageTokens(msg: CoreMessage): number {
  if (typeof msg.content === "string") {
    return Math.ceil(msg.content.length / 3.5) + 4;
  }
  if (Array.isArray(msg.content)) {
    let chars = 0;
    for (const part of msg.content as any[]) {
      if (typeof part === "string") chars += part.length;
      else if (part?.text) chars += String(part.text).length;
      else if (part?.result) chars += String(part.result).length;
      else chars += JSON.stringify(part).length;
    }
    return Math.ceil(chars / 3.5) + 4;
  }
  return 10;
}

export function estimateTotalTokens(messages: CoreMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export async function trimToContextBudget(params: {
  messages: CoreMessage[];
  systemTokens: number;
  contextWindow: number;
}): Promise<{ messages: CoreMessage[]; trimmed: boolean; dropRatio: number }> {
  const { messages, systemTokens, contextWindow } = params;
  const budget = contextWindow - RESERVE_OUTPUT_TOKENS - systemTokens;
  if (budget <= 0) {
    return { messages: messages.slice(-2), trimmed: true, dropRatio: 1 };
  }

  const originalCount = messages.length;
  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateMessageTokens(msg);
  }

  if (totalTokens <= budget) {
    return { messages, trimmed: false, dropRatio: 0 };
  }

  const kept: CoreMessage[] = [];
  let keptTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(messages[i]!);
    if (keptTokens + tokens > budget) break;
    kept.unshift(messages[i]!);
    keptTokens += tokens;
  }

  if (kept.length === 0 && messages.length > 0) {
    kept.push(messages[messages.length - 1]!);
  }

  const dropped = originalCount - kept.length;
  const dropRatio = originalCount > 0 ? dropped / originalCount : 0;

  return { messages: kept, trimmed: true, dropRatio };
}

export function findLargerContextModel(
  currentModel: string,
  currentContext: number,
  models: Array<{ id: string; context_length?: number | null }>,
  isHealthy: (id: string) => boolean,
): string | null {
  const candidates = models
    .filter(
      (m) =>
        m.id !== currentModel &&
        typeof m.context_length === "number" &&
        m.context_length > currentContext * 1.5 &&
        isHealthy(m.id),
    )
    .sort((a, b) => (a.context_length ?? 0) - (b.context_length ?? 0));
  return candidates[0]?.id ?? null;
}
