import { logger } from "../logger.js";
import {
  togetherClient,
  buildVisionMessages,
  isModelNotAvailableError,
  isModelTemporarilyUnavailable,
} from "./chatHelpers.js";
import { markModelUnhealthy } from "../modelHealth.js";

export async function generateVisionReply(params: {
  uiMessages: Array<{ role: string; content?: unknown; parts?: Array<Record<string, unknown>> }>;
  candidateModels: string[];
}): Promise<{ text: string; usedModel: string } | null> {
  const candidates = [...new Set(params.candidateModels)].filter((id) => !isModelTemporarilyUnavailable(id));
  const messages = buildVisionMessages(params.uiMessages);
  if (!messages.length) return null;
  for (const candidate of candidates) {
    try {
      const response = (await (togetherClient as any).chat.completions.create({
        model: candidate,
        messages: [
          {
            role: "system",
            content:
              "You are a multimodal assistant. If user included images, analyze them accurately. " +
              "If user asks to generate a new image, explain that generation is handled separately.",
          },
          ...messages,
        ],
        temperature: 0.2,
      })) as { choices?: Array<{ message?: { content?: string } }> };
      const text = String(response.choices?.[0]?.message?.content ?? "").trim();
      if (!text) continue;
      return { text, usedModel: candidate };
    } catch (e) {
      const errObj = e as { data?: { error?: { code?: string; message?: string } }; message?: string };
      if (isModelNotAvailableError(e)) {
        markModelUnhealthy(candidate, errObj?.data?.error?.message ?? errObj?.message ?? undefined);
      }
      logger.warn(
        {
          err: e,
          model: candidate,
          providerCode: errObj?.data?.error?.code ?? null,
          providerMessage: errObj?.data?.error?.message ?? errObj?.message ?? null,
        },
        "vision route failed"
      );
    }
  }
  return null;
}
