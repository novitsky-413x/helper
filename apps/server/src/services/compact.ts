import { generateText, type CoreMessage } from "ai";
import { togetherLlm } from "../pipeline/chatHelpers.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

function getContentString(msg: CoreMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: any) => part?.text ?? part?.result ?? JSON.stringify(part))
      .join(" ");
  }
  return String(msg.content);
}

/**
 * Micro-compact: shrink old tool results that are too long.
 */
export function microCompactMessages(
  messages: CoreMessage[],
  opts: { maxToolResultChars?: number; keepRecentTurns?: number } = {},
): CoreMessage[] {
  const maxChars = opts.maxToolResultChars ?? 2000;
  const keepRecent = opts.keepRecentTurns ?? 4;
  const cutoff = messages.length - keepRecent * 2;

  return messages.map((msg, i) => {
    if (i >= cutoff) return msg;
    if (msg.role !== "tool") return msg;

    if (Array.isArray(msg.content)) {
      const newContent = msg.content.map((part: any) => {
        if (part.type === "tool-result" && typeof part.result === "string" && part.result.length > maxChars) {
          const head = part.result.slice(0, 400);
          const tail = part.result.slice(-400);
          return {
            ...part,
            result: `${head}\n\n... [${part.result.length - 800} chars truncated] ...\n\n${tail}`,
          };
        }
        return part;
      });
      return { ...msg, content: newContent } as CoreMessage;
    }

    return msg;
  });
}

/**
 * Full compact: summarize the conversation up to a boundary,
 * replace everything before it with the summary.
 */
export async function compactConversation(
  messages: CoreMessage[],
  opts?: { instructions?: string },
): Promise<{ messages: CoreMessage[]; summary: string }> {
  if (messages.length < 6) {
    return { messages, summary: "" };
  }

  const toSummarize = messages.slice(0, -4);
  const toKeep = messages.slice(-4);

  const transcript = toSummarize
    .map((m) => `[${m.role}]: ${getContentString(m).slice(0, 500)}`)
    .join("\n");

  try {
    const result = await generateText({
      model: togetherLlm(config.togetherBaseModel),
      temperature: 0,
      maxTokens: 1000,
      prompt: `Summarize the following conversation concisely, preserving key decisions, facts, and action items. ${
        opts?.instructions ? `Additional instructions: ${opts.instructions}` : ""
      }\n\n${transcript}`,
    });

    const summary = result.text || "(conversation summary unavailable)";

    const compacted: CoreMessage[] = [
      {
        role: "assistant",
        content: `[Conversation Summary]\n${summary}\n\n[End of summary — conversation continues below]`,
      },
      ...toKeep,
    ];

    logger.info(
      {
        beforeCount: messages.length,
        afterCount: compacted.length,
        summaryChars: summary.length,
      },
      "conversation compacted",
    );

    return { messages: compacted, summary };
  } catch (e) {
    logger.warn({ err: e }, "compact failed, returning original messages");
    return { messages, summary: "" };
  }
}
