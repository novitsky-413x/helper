import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { listChatModelsCached, type TogetherModelRow } from "./togetherModels.js";

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

function modelCapabilityScore(id: string): number {
  const s = id.toLowerCase();
  let score = 0;
  if (/gpt-4\.1|gpt-4o|o4|o3/.test(s)) score += 100;
  if (/claude-3\.7|claude-3\.5|sonnet|opus/.test(s)) score += 90;
  if (/qwen3|qwen2\.5-7b|qwen2\.5-14b|qwen2\.5-32b|qwen2\.5-72b/.test(s)) score += 70;
  if (/llama-3\.3|llama-3\.1-70b|mixtral|mistral-large/.test(s)) score += 65;
  if (/gpt-oss-20b|deepseek-r1|deepseek-v3/.test(s)) score += 60;
  if (/gemma-3n|gemma-2-2b|phi-3/.test(s)) score += 35;
  if (/-70b|405b|72b|34b/.test(s)) score += 20;
  if (/-8b|-7b/.test(s)) score += 8;
  if (/-2b|-1b/.test(s)) score -= 8;
  return score;
}

function modelCostScore(id: string): number {
  const s = id.toLowerCase();
  let score = 0;
  if (/4o|o4|o3|claude|opus/.test(s)) score -= 40;
  if (/70b|72b|405b/.test(s)) score -= 25;
  if (/34b|32b|27b|22b|20b/.test(s)) score -= 12;
  if (/8b|7b|3n|2b|1b|mini|nano/.test(s)) score += 15;
  return score;
}

function rankModelForTier(model: TogetherModelRow, tier: Tier): number {
  const ctx = model.context_length ?? 0;
  const capability = modelCapabilityScore(model.id);
  const cost = modelCostScore(model.id);
  if (tier === "low") return cost * 2 + capability * 0.35 + Math.min(ctx, 32768) / 4096;
  if (tier === "med") return capability * 0.8 + cost * 0.5 + Math.min(ctx, 65536) / 4096;
  return capability * 1.2 + cost * 0.2 + Math.min(ctx, 131072) / 4096;
}

async function rankedCandidatesForTier(tier: Tier): Promise<string[]> {
  const models = await listChatModelsCached();
  if (!models.length) {
    const fallback = [tierToModel(tier), tierToModel("high"), tierToModel("med"), tierToModel("low")];
    return [...new Set(fallback)].filter(Boolean);
  }
  const sorted = [...models]
    .sort((a, b) => rankModelForTier(b, tier) - rankModelForTier(a, tier))
    .map((m) => m.id);
  return sorted.slice(0, 8);
}

export async function resolveChatModel(
  requested: string | undefined,
  lastUserText: string
): Promise<{ model: string; tier?: Tier; skippedClassifier?: boolean; candidates: string[] }> {
  if (!config.togetherApiKey) throw new Error("TOGETHER_API_KEY is not set");

  if (requested && requested !== "auto") {
    return { model: requested, candidates: [requested] };
  }

  const h = heuristicTier(lastUserText);
  if (h) {
    const candidates = await rankedCandidatesForTier(h);
    const primary = candidates[0] ?? tierToModel(h);
    logger.info({ tier: h }, "auto classifier skipped (heuristic)");
    return { model: primary, tier: h, skippedClassifier: true, candidates };
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
  const candidates = await rankedCandidatesForTier(tier);
  const model = candidates[0] ?? tierToModel(tier);
  logger.info(
    {
      tier,
      model,
      candidates: candidates.slice(0, 4),
      ms: Date.now() - t0,
      rawPreview: (text || "").slice(0, 200),
    },
    "auto classifier result"
  );
  return { model, tier, candidates };
}
