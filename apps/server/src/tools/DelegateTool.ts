import { z } from "zod";
import { generateText } from "ai";
import { buildTool } from "./buildTool.js";
import { togetherLlm, isModelNotAvailableError } from "../pipeline/chatHelpers.js";
import { getModelCatalog, resolveCategoryOrder, type TaskCategory } from "../modelCatalog.js";
import { pickFirstHealthyModel, markModelUnhealthy } from "../modelHealth.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

export const DelegateTool = buildTool({
  name: "delegate_to_category",
  description:
    "Delegate a sub-task to a specialist model category " +
    "(code_mcp, reasoning, vision, image_gen, audio, memory).",
  inputSchema: z.object({
    category: z.enum([
      "primary", "code_mcp", "reasoning", "vision",
      "image_gen", "audio", "memory",
    ]),
    task: z.string().min(1),
    context: z.string().optional(),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,

  async call(input) {
    const catalog = await getModelCatalog();
    const ordered = resolveCategoryOrder(
      input.category as TaskCategory,
      undefined,
      catalog,
    );
    const picked = pickFirstHealthyModel(ordered) ?? config.togetherBaseModel;

    try {
      const answer = await generateText({
        model: togetherLlm(picked),
        temperature: 0.1,
        maxTokens: 4000,
        prompt: `You are a specialist assistant for category "${input.category}".\n\n${
          input.context ? `Context:\n${input.context}\n\n` : ""
        }Task:\n${input.task}`,
      });
      return answer.text || "(empty response)";
    } catch (e) {
      if (isModelNotAvailableError(e)) {
        markModelUnhealthy(picked, String((e as any)?.message ?? e));
      }
      logger.warn({ err: e, category: input.category, picked }, "delegate failed");

      const fallback =
        pickFirstHealthyModel(
          resolveCategoryOrder("primary", undefined, catalog),
        ) ?? config.togetherBaseModel;
      if (fallback !== picked) {
        try {
          const fb = await generateText({
            model: togetherLlm(fallback),
            temperature: 0.1,
            maxTokens: 4000,
            prompt: `You are a helpful assistant. Answer this task:\n${input.task}`,
          });
          return fb.text || "(empty response)";
        } catch (e2) {
          logger.warn({ err: e2, fallback }, "delegate fallback also failed");
        }
      }
      return `Specialist execution failed for ${input.category}.`;
    }
  },
});
