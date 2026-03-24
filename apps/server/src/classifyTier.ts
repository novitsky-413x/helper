import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "./config.js";
import { logger } from "./logger.js";

const together = createOpenAI({
  baseURL: "https://api.together.xyz/v1",
  apiKey: config.togetherApiKey,
});

export type Tier = "low" | "med" | "high";

function heuristicTier(text: string): Tier | null {
  const t = text.trim();
  if (t.length > 2000) return "high";
  if (t.length < 90 && !/```/.test(t) && !/\b(refactor|architecture|debug|implement|design)\b/i.test(t)) {
    return "low";
  }
  return null;
}

function parseTier(raw: string): Tier {
  const m = raw.match(/\{[\s\S]*\}/);
  const json = m ? m[0] : raw;
  try {
    const o = JSON.parse(json) as { tier?: string };
    const t = String(o.tier || "").toLowerCase();
    if (t === "low" || t === "med" || t === "medium" || t === "high") {
      return t === "medium" ? "med" : (t as Tier);
    }
  } catch {
    /* ignore */
  }
  return "med";
}

export function tierToModel(tier: Tier): string {
  switch (tier) {
    case "low":
      return config.chatModelLow;
    case "high":
      return config.chatModelHigh;
    default:
      return config.chatModelMed;
  }
}

export async function resolveChatModel(
  requested: string | undefined,
  lastUserText: string
): Promise<{ model: string; tier?: Tier; skippedClassifier?: boolean }> {
  if (!config.togetherApiKey) throw new Error("TOGETHER_API_KEY is not set");

  if (requested && requested !== "auto") {
    return { model: requested };
  }

  const h = heuristicTier(lastUserText);
  if (h) {
    logger.info({ tier: h }, "auto classifier skipped (heuristic)");
    return { model: tierToModel(h), tier: h, skippedClassifier: true };
  }

  const t0 = Date.now();
  const { text } = await generateText({
    model: together(config.classifierModel),
    maxTokens: 80,
    temperature: 0,
    prompt: `Classify the complexity of this user request for routing to a language model.
Respond with ONLY valid JSON, no markdown: {"tier":"low"|"med"|"high"}
- low: trivial, chitchat, one-liner facts
- med: multi-step reasoning, coding tasks of moderate scope
- high: deep analysis, large code changes, subtle debugging, architecture

User request:
"""${lastUserText.slice(0, 8000)}"""`,
  });

  const tier = parseTier(text || "");
  const model = tierToModel(tier);
  logger.info(
    {
      tier,
      model,
      ms: Date.now() - t0,
      rawPreview: (text || "").slice(0, 200),
    },
    "auto classifier result"
  );
  return { model, tier };
}
