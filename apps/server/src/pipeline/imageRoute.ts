import { logger } from "../logger.js";
import {
  togetherClient,
  buildVisionMessages,
  isModelNotAvailableError,
  isModelTemporarilyUnavailable,
} from "./chatHelpers.js";
import { markModelUnhealthy, isModelHealthy } from "../modelHealth.js";

export async function buildImageEditPromptFromContext(params: {
  uiMessages: Array<{ role: string; content?: unknown; parts?: Array<Record<string, unknown>> }>;
  userInstruction: string;
  candidateModels: string[];
}): Promise<{ prompt: string; usedModel: string } | null> {
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
              "You create compact production-ready image generation prompts. " +
              "Given the uploaded image and user instruction, produce ONE final English prompt that preserves key elements of the original image while applying requested changes. " +
              "Return only the prompt text without markdown, explanation, or quotes.",
          },
          ...messages,
          {
            role: "user",
            content:
              `User instruction for editing/regeneration:\n${params.userInstruction || "(none)"}` +
              "\n\nOutput format: one single prompt line in English.",
          },
        ],
        temperature: 0.1,
      })) as { choices?: Array<{ message?: { content?: string } }> };
      const prompt = String(response.choices?.[0]?.message?.content ?? "").trim();
      if (!prompt) continue;
      return { prompt, usedModel: candidate };
    } catch (e) {
      if (isModelNotAvailableError(e)) {
        markModelUnhealthy(candidate, String((e as { message?: string })?.message ?? e));
      }
      logger.warn({ err: e, model: candidate }, "image edit prompt synthesis failed");
    }
  }
  return null;
}

export async function generateImageMarkdown(params: {
  prompt: string;
  preferredModel?: string;
  candidateModels: string[];
}): Promise<{ markdown: string; usedModel: string } | null> {
  const prioritized = params.preferredModel?.trim()
    ? [params.preferredModel.trim(), ...params.candidateModels]
    : params.candidateModels;
  const candidates = [...new Set(prioritized)].filter(
    (id) => !isModelTemporarilyUnavailable(id) && isModelHealthy(id),
  );

  if (candidates.length === 0) {
    logger.warn(
      { totalCandidates: prioritized.length },
      "image gen: no healthy candidates available",
    );
    return null;
  }

  for (const candidate of candidates) {
    try {
      const response = (await togetherClient.images.create({
        model: candidate,
        prompt: params.prompt,
        width: 1024,
        height: 1024,
        response_format: "url",
        output_format: "png",
      })) as {
        data?: Array<{ url?: string; b64_json?: string; type?: string }>;
      };
      const first = response.data?.[0];
      const url = first?.url;
      const b64 = first?.b64_json;
      const imageRef = url || (b64 ? `data:image/png;base64,${b64}` : "");
      if (!imageRef) {
        logger.warn({ model: candidate }, "image fast-path returned empty result");
        continue;
      }
      return {
        markdown: `![generated image](${imageRef})\n\n[Open original](${imageRef})`,
        usedModel: candidate,
      };
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
        "image generation failed for candidate"
      );
    }
  }

  logger.error(
    { candidates, totalCandidates: prioritized.length },
    "image gen: all candidates exhausted",
  );
  return null;
}
