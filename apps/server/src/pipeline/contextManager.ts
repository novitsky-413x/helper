import { generateText } from "ai";
import type { CoreMessage } from "ai";
import { togetherLlm } from "./chatHelpers.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { sanitizeConversation } from "./messageQuality.js";

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function estimateMessageTokens(msg: CoreMessage): number {
  const overhead = 4;
  if (typeof msg.content === "string") {
    return overhead + estimateTokens(msg.content);
  }
  if (Array.isArray(msg.content)) {
    let total = overhead;
    for (const part of msg.content) {
      if ("text" in part && typeof part.text === "string") {
        total += estimateTokens(part.text);
      } else {
        total += 85;
      }
    }
    return total;
  }
  return overhead;
}

/**
 * Group messages into atomic blocks that must not be split.
 * An assistant message followed by tool results (and an optional
 * continuation assistant message) forms one indivisible block.
 * Splitting these would orphan tool-result messages and cause
 * "Input validation error" from OpenAI-compatible APIs.
 */
function groupIntoAtomicBlocks(messages: CoreMessage[]): CoreMessage[][] {
  const blocks: CoreMessage[][] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === "assistant") {
      const block: CoreMessage[] = [msg];
      i++;
      // Absorb all subsequent tool-result messages
      while (i < messages.length && messages[i].role === "tool") {
        block.push(messages[i]);
        i++;
      }
      // If we absorbed tool messages and next is assistant (continuation), include it
      if (block.length > 1 && i < messages.length && messages[i].role === "assistant") {
        block.push(messages[i]);
        i++;
      }
      blocks.push(block);
    } else {
      blocks.push([msg]);
      i++;
    }
  }

  return blocks;
}

function blockTokens(block: CoreMessage[]): number {
  return block.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

export function estimateTotalTokens(messages: CoreMessage[], systemPrompt: string): number {
  let total = estimateTokens(systemPrompt) + 4;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

export type ContextBudgetResult = {
  messages: CoreMessage[];
  /** Fraction of the original conversation that had to be dropped (0..1). */
  dropRatio: number;
  /** Estimated tokens of the full (sanitised) conversation before trimming. */
  fullConversationTokens: number;
  /** The context window that was used for budgeting. */
  contextWindow: number;
};

/**
 * Trims messages to fit within the context window budget.
 * Keeps system + first block + last N blocks.
 * Uses atomic blocks so tool-call chains are never split.
 */
export async function trimToContextBudget(params: {
  messages: CoreMessage[];
  systemTokens: number;
  contextWindow: number;
  reserveForCompletion?: number;
}): Promise<ContextBudgetResult> {
  const { messages: rawMessages, systemTokens, contextWindow, reserveForCompletion = 2000 } = params;

  const messages = sanitizeConversation(rawMessages);
  const budget = contextWindow - systemTokens - reserveForCompletion;

  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateMessageTokens(msg);
  }

  if (budget <= 0) {
    return {
      messages: messages.slice(-2),
      dropRatio: messages.length > 2 ? 1 : 0,
      fullConversationTokens: totalTokens,
      contextWindow,
    };
  }

  if (totalTokens <= budget) {
    return { messages, dropRatio: 0, fullConversationTokens: totalTokens, contextWindow };
  }

  // Work with atomic blocks to avoid splitting tool-call chains
  const blocks = groupIntoAtomicBlocks(messages);

  const keepFirstBlocks = Math.min(1, blocks.length);
  const firstBlocks = blocks.slice(0, keepFirstBlocks);
  const firstMessages = firstBlocks.flat();
  const firstTokens = blockTokens(firstMessages);

  const remaining = blocks.slice(keepFirstBlocks);
  const recentBudget = budget - firstTokens - 200;

  const recentBlocks: CoreMessage[][] = [];
  let recentTokenCount = 0;
  for (let i = remaining.length - 1; i >= 0; i--) {
    const bt = blockTokens(remaining[i]);
    if (recentTokenCount + bt > recentBudget) break;
    recentBlocks.unshift(remaining[i]);
    recentTokenCount += bt;
  }

  const recentMessages = recentBlocks.flat();
  const droppedBlockCount = remaining.length - recentBlocks.length;
  const droppedMessages = remaining.slice(0, droppedBlockCount).flat();
  const dropRatio = messages.length > 0 ? droppedMessages.length / messages.length : 0;

  if (droppedMessages.length > 0) {
    const summary = await summarizeMessages(droppedMessages);
    if (summary) {
      return {
        messages: [
          ...firstMessages,
          { role: "assistant" as const, content: `[Earlier conversation summary: ${summary}]` },
          ...recentMessages,
        ],
        dropRatio,
        fullConversationTokens: totalTokens,
        contextWindow,
      };
    }
  }

  return {
    messages: [...firstMessages, ...recentMessages],
    dropRatio,
    fullConversationTokens: totalTokens,
    contextWindow,
  };
}

async function summarizeMessages(messages: CoreMessage[]): Promise<string | null> {
  if (messages.length === 0) return null;

  const text = messages
    .map((m) => {
      const content = typeof m.content === "string" ? m.content : "[complex content]";
      return `${m.role}: ${content.slice(0, 200)}`;
    })
    .join("\n");

  try {
    const result = await generateText({
      model: togetherLlm(config.togetherBaseModel),
      temperature: 0,
      maxTokens: 150,
      prompt: `Summarize this conversation excerpt in 1-2 sentences, preserving key facts and decisions:\n\n${text.slice(0, 2000)}`,
    });
    return result.text?.trim() || null;
  } catch (e) {
    logger.warn({ err: e }, "context summarization failed");
    return null;
  }
}

export function getModelContextWindow(
  modelId: string,
  catalogModels: Array<{ id: string; context_length?: number | null }>
): number {
  const model = catalogModels.find((m) => m.id === modelId);
  return model?.context_length ?? 8192;
}

/**
 * Find a routable model with a larger context window than the current one.
 * Returns null if no suitable upgrade exists.
 */
export function findLargerContextModel(
  currentModelId: string,
  currentContextWindow: number,
  catalogModels: Array<{ id: string; context_length?: number | null; type?: string; pricing?: { input?: number | null } | null }>,
  isModelAvailable: (id: string) => boolean,
): string | null {
  const chatModels = catalogModels.filter(
    (m) => (m.type === "chat" || m.type === "language" || m.type === "code") && m.id !== currentModelId
  );

  const candidates = chatModels
    .filter((m) => (m.context_length ?? 0) > currentContextWindow && isModelAvailable(m.id))
    .sort((a, b) => {
      const ctxDiff = (a.context_length ?? 0) - (b.context_length ?? 0);
      if (ctxDiff !== 0) return ctxDiff;
      const pa = a.pricing?.input ?? 999;
      const pb = b.pricing?.input ?? 999;
      return pa - pb;
    });

  const picked = candidates[0];
  if (!picked) return null;

  logger.info(
    {
      from: currentModelId,
      fromCtx: currentContextWindow,
      to: picked.id,
      toCtx: picked.context_length,
    },
    "context escalation: switching to larger-context model"
  );
  return picked.id;
}
