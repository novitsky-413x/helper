import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { listModelsCached, type TogetherModelRow } from "./togetherModels.js";

export const TASK_CATEGORIES = [
  "primary",
  "code_mcp",
  "reasoning",
  "vision",
  "image_gen",
  "audio",
  "memory",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export type CategoryRanking = Record<TaskCategory, string[]>;

export type ModelSelectionPolicy = {
  topK: number;
  maxChars: number;
  pinnedOnlyForSimple: boolean;
};

export type ProfileModelPreferences = {
  categories: Partial<Record<TaskCategory, { order: string[] }>>;
  updatedAt: string;
};

export type ModelCatalogSnapshot = {
  refreshedAt: string;
  models: TogetherModelRow[];
  chatModels: TogetherModelRow[];
  latencyMsByModel: Record<string, number>;
  defaults: CategoryRanking;
};

const together = createOpenAI({
  baseURL: "https://api.together.xyz/v1",
  apiKey: config.togetherApiKey,
});

let snapshot: ModelCatalogSnapshot | null = null;

function pricingScore(m: TogetherModelRow): number {
  const p = m.pricing;
  if (!p) return 999_999;
  // Treat zero/empty token pricing as unknown (not "free"), so it doesn't dominate ranking.
  const inPrice = typeof p.input === "number" && p.input > 0 ? p.input : 999_999;
  const outPrice = typeof p.output === "number" && p.output > 0 ? p.output : 999_999;
  return inPrice + outPrice;
}

function byFastCheap(a: TogetherModelRow, b: TogetherModelRow, latency: Record<string, number>): number {
  const la = latency[a.id] ?? 999_999;
  const lb = latency[b.id] ?? 999_999;
  if (la !== lb) return la - lb;
  return pricingScore(a) - pricingScore(b);
}

async function benchmarkLatency(chat: TogetherModelRow[]): Promise<Record<string, number>> {
  const selected = [...chat]
    .sort((a, b) => pricingScore(a) - pricingScore(b))
    .slice(0, 8);
  const out: Record<string, number> = {};
  await Promise.all(
    selected.map(async (m) => {
      const t0 = Date.now();
      try {
        await generateText({
          model: together(m.id),
          prompt: "Ping. Reply with OK.",
          maxTokens: 8,
          temperature: 0,
        });
        out[m.id] = Date.now() - t0;
      } catch {
        out[m.id] = 999_999;
      }
    })
  );
  return out;
}

function fallbackDefaults(models: TogetherModelRow[], latency: Record<string, number>): CategoryRanking {
  const chat = models.filter((m) => m.type === "chat" || m.type === "language" || m.type === "code");
  const image = models.filter((m) => m.type === "image");
  const byCostLatency = [...chat].sort((a, b) => byFastCheap(a, b, latency)).map((m) => m.id);
  const byReasoning = [...chat]
    .sort((a, b) => {
      const aa = /r1|reason|70b|72b|405b|opus|o1|o3/i.test(a.id) ? 1 : 0;
      const bb = /r1|reason|70b|72b|405b|opus|o1|o3/i.test(b.id) ? 1 : 0;
      if (aa !== bb) return bb - aa;
      return byFastCheap(a, b, latency);
    })
    .map((m) => m.id);
  const byCode = [...chat]
    .sort((a, b) => {
      const aa = /deepseek|coder|qwen|llama|gpt-oss/i.test(a.id) ? 1 : 0;
      const bb = /deepseek|coder|qwen|llama|gpt-oss/i.test(b.id) ? 1 : 0;
      if (aa !== bb) return bb - aa;
      return byFastCheap(a, b, latency);
    })
    .map((m) => m.id);
  const byVision = [...chat]
    .sort((a, b) => {
      const aa = /vision|ocr|vl/i.test(a.id) ? 1 : 0;
      const bb = /vision|ocr|vl/i.test(b.id) ? 1 : 0;
      if (aa !== bb) return bb - aa;
      return byFastCheap(a, b, latency);
    })
    .map((m) => m.id);

  return {
    primary: byCostLatency.slice(0, 10),
    code_mcp: byCode.slice(0, 10),
    reasoning: byReasoning.slice(0, 10),
    vision: byVision.slice(0, 10),
    image_gen: image.map((m) => m.id).slice(0, 10),
    audio: [],
    memory: byCostLatency.slice(0, 10),
  };
}

function parseCategoryRanking(raw: string, knownIds: Set<string>): CategoryRanking | null {
  const m = raw.match(/\{[\s\S]*\}/);
  const json = m ? m[0] : raw;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    const out = {} as CategoryRanking;
    for (const cat of TASK_CATEGORIES) {
      const arr = Array.isArray(obj[cat]) ? (obj[cat] as unknown[]) : [];
      out[cat] = arr.filter((x): x is string => typeof x === "string" && knownIds.has(x)).slice(0, 10);
    }
    return out;
  } catch {
    return null;
  }
}

async function llmAssignCategories(models: TogetherModelRow[], latency: Record<string, number>): Promise<CategoryRanking | null> {
  const chat = models.filter((m) => m.type === "chat" || m.type === "language" || m.type === "code").slice(0, 50);
  const payload = chat.map((m) => ({
    id: m.id,
    type: m.type ?? "unknown",
    context_length: m.context_length ?? 0,
    input: m.pricing?.input ?? null,
    output: m.pricing?.output ?? null,
    latency_ms: latency[m.id] ?? null,
  }));
  if (!payload.length) return null;
  try {
    const { text } = await generateText({
      model: together(config.togetherBaseModel),
      temperature: 0,
      maxTokens: 900,
      prompt: `You assign Together models to categories for an agent router.
Categories: primary, code_mcp, reasoning, vision, image_gen, audio, memory.
Return ONLY valid JSON object where each key is a category and value is an ordered array of model ids.
Prefer low latency and low price for primary and memory. Prefer coding and tool-compatible models for code_mcp.
Prefer strongest reasoning for reasoning.
Known models:
${JSON.stringify(payload)}`,
    });
    return parseCategoryRanking(text || "", new Set(models.map((x) => x.id)));
  } catch (e) {
    logger.warn({ err: e }, "category assignment via base model failed");
    return null;
  }
}

export async function refreshModelCatalog(): Promise<ModelCatalogSnapshot> {
  const models = await listModelsCached();
  const chatModels = models.filter((m) => m.type === "chat" || m.type === "language" || m.type === "code");
  const latencyMsByModel = await benchmarkLatency(chatModels);
  const llmDefaults = await llmAssignCategories(models, latencyMsByModel);
  const defaults = llmDefaults ?? fallbackDefaults(models, latencyMsByModel);
  snapshot = {
    refreshedAt: new Date().toISOString(),
    models,
    chatModels,
    latencyMsByModel,
    defaults,
  };
  return snapshot;
}

export async function getModelCatalog(): Promise<ModelCatalogSnapshot> {
  if (!snapshot) return refreshModelCatalog();
  return snapshot;
}

export function resolveCategoryOrder(
  category: TaskCategory,
  profilePrefs: ProfileModelPreferences | undefined,
  catalog: ModelCatalogSnapshot
): string[] {
  const profileOrder = profilePrefs?.categories?.[category]?.order ?? [];
  const known = new Set(catalog.models.map((m) => m.id));
  const filteredProfile = profileOrder.filter((id) => known.has(id));
  const defaults = catalog.defaults[category] ?? [];
  return [...new Set([...filteredProfile, ...defaults])];
}

export function inferSimpleRequest(text: string): boolean {
  const t = text.trim();
  return t.length < 120 && !/\b(debug|refactor|architecture|implement|mcp|tool|integration)\b/i.test(t);
}
