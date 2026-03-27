import { useMemo } from "react";
import type { Profile, TaskCategory, TogetherModel, UsageSnapshot } from "../types/appTypes";

const DEFAULT_CONTEXT_WINDOW = 8192;
const MODEL_CONTEXT_HINTS: Array<{ re: RegExp; tokens: number }> = [
  { re: /gpt-4\.1|gpt-4o|o4|o3/i, tokens: 128000 },
  { re: /gpt-oss-20b/i, tokens: 32768 },
  { re: /gemma-3n/i, tokens: 32768 },
  { re: /qwen3|qwen2\.5|qwen/i, tokens: 32768 },
  { re: /llama-3\.3|llama-3\.1/i, tokens: 131072 },
  { re: /mistral|mixtral/i, tokens: 32768 },
];

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

function estimateModelContextWindow(modelId: string | undefined): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;
  const hit = MODEL_CONTEXT_HINTS.find((x) => x.re.test(modelId));
  return hit?.tokens ?? DEFAULT_CONTEXT_WINDOW;
}

function normalizePerMillion(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  if (v > 0 && v < 0.001) return v * 1_000_000;
  return v;
}

function estimateRequestCostUsd(params: {
  model: TogetherModel | undefined;
  promptTokens: number | null | undefined;
  completionTokens: number | null | undefined;
}): number | null {
  const inPrice = normalizePerMillion(params.model?.pricing?.input ?? null);
  const outPrice = normalizePerMillion(params.model?.pricing?.output ?? null);
  const pt = typeof params.promptTokens === "number" ? params.promptTokens : null;
  const ct = typeof params.completionTokens === "number" ? params.completionTokens : null;
  if ((inPrice === null && outPrice === null) || (pt === null && ct === null)) return null;
  const inCost = inPrice !== null && pt !== null ? (pt / 1_000_000) * inPrice : 0;
  const outCost = outPrice !== null && ct !== null ? (ct / 1_000_000) * outPrice : 0;
  return inCost + outCost;
}

export function formatPricePerMillion(m: TogetherModel | undefined): string {
  if (!m?.pricing) return "";
  const input = normalizePerMillion(m.pricing.input ?? null);
  const output = normalizePerMillion(m.pricing.output ?? null);
  const hourly =
    typeof m.pricing.hourly === "number" && Number.isFinite(m.pricing.hourly) && m.pricing.hourly > 0
      ? m.pricing.hourly
      : null;
  if (input === null && output === null) {
    return hourly !== null ? `$${hourly.toFixed(2)}/hr` : "pricing n/a";
  }
  if (input !== null && output !== null) return `$${input.toFixed(2)}/$${output.toFixed(2)} per 1M`;
  if (input !== null) return `$${input.toFixed(2)} in per 1M`;
  return `$${(output ?? 0).toFixed(2)} out per 1M`;
}

export function useAnalyticsMetrics(params: {
  modelCatalog: { models: TogetherModel[]; chatModels: TogetherModel[]; defaults: Record<TaskCategory, string[]> } | null;
  models: TogetherModel[];
  messages: Array<{ content?: string; parts?: Array<{ type: string; text?: string }> }>;
  memoryRows: Array<{ memory: string }>;
  modelChoice: string;
  resolvedModelId: string | null;
  lastUsage: UsageSnapshot | null;
  usageLoading: boolean;
  usageLoadedForProfileId: string | null;
  activeProfile: Profile | null;
  profiles: Profile[];
  activeProfileId: string | null;
  tx: { analyticsWarningHigh: string; analyticsWarningMedium: string; analyticsWarningLow: string };
}) {
  const categoryOptions = useMemo(() => {
    const allModels = params.modelCatalog?.models ?? params.models;
    const chatLike = params.modelCatalog?.chatModels ?? params.models;
    const byId = new Map(allModels.map((m) => [m.id, m]));
    const out: Record<TaskCategory, string[]> = {
      primary: [],
      code_mcp: [],
      reasoning: [],
      vision: [],
      image_gen: [],
      audio: [],
      memory: [],
    };
    for (const category of Object.keys(out) as TaskCategory[]) {
      const defaults = params.modelCatalog?.defaults?.[category] ?? [];
      const basePool =
        category === "image_gen"
          ? allModels.filter((m) => m.type === "image")
          : category === "audio"
            ? allModels.filter((m) => /audio|speech|whisper|tts|asr/i.test(m.id))
            : chatLike;
      const fallbackPool = basePool.map((m) => m.id).slice(0, 20);
      out[category] = [...new Set([...defaults.filter((id) => byId.has(id)), ...fallbackPool])];
    }
    return out;
  }, [params.modelCatalog, params.models]);

  const effectiveModelId = params.resolvedModelId ?? (params.modelChoice !== "auto" ? params.modelChoice : undefined);
  const contextWindow = estimateModelContextWindow(effectiveModelId);
  const messagesTokenEstimate = useMemo(
    () =>
      params.messages.reduce((sum, m) => {
        const roleOverhead = 8;
        const txt = m.parts?.length
          ? m.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
              .map((p) => p.text)
              .join("")
          : (m.content ?? "");
        return sum + roleOverhead + estimateTokens(txt);
      }, 0),
    [params.messages]
  );

  const mem0Chars = useMemo(() => params.memoryRows.reduce((sum, row) => sum + (row.memory?.length ?? 0), 0), [params.memoryRows]);
  const mem0TokensApprox = useMemo(() => Math.ceil(mem0Chars / 4), [mem0Chars]);
  const mem0InjectedApprox = useMemo(() => {
    if (!params.memoryRows.length) return 0;
    const avgRowTokens = Math.max(1, Math.ceil(mem0TokensApprox / params.memoryRows.length));
    return Math.min(12, params.memoryRows.length) * avgRowTokens + 60;
  }, [params.memoryRows.length, mem0TokensApprox]);
  const systemAndToolsOverhead = 220;
  const precisePromptTokens = params.lastUsage?.promptTokens ?? null;
  const totalContextUsed =
    precisePromptTokens !== null ? precisePromptTokens : messagesTokenEstimate + mem0InjectedApprox + systemAndToolsOverhead;
  const totalContextLeft = Math.max(0, contextWindow - totalContextUsed);
  const fillRatio = contextWindow ? totalContextUsed / contextWindow : 0;
  const riskLevel =
    fillRatio >= 0.82 ? params.tx.analyticsWarningHigh : fillRatio >= 0.62 ? params.tx.analyticsWarningMedium : params.tx.analyticsWarningLow;

  const usageProfileId = params.lastUsage?.profileId ?? null;
  const usageOwnerProfile = usageProfileId
    ? params.profiles.find((p) => p.id === usageProfileId) ?? null
    : null;
  const usageOwnerLabel = usageOwnerProfile
    ? `${usageOwnerProfile.name} (${usageOwnerProfile.id.slice(0, 8)}...)`
    : usageProfileId
      ? `${usageProfileId.slice(0, 8)}...`
      : "—";
  const activeUsageKey = params.activeProfileId ?? "__default__";
  const usageReady = params.usageLoadedForProfileId === activeUsageKey;
  const usageMatchesSelected = !!params.activeProfile?.id && usageProfileId === params.activeProfile.id;
  const usageStatus: "loading" | "empty" | "current" | "stale" = params.usageLoading || !usageReady
    ? "loading"
    : !params.lastUsage
      ? "empty"
      : usageMatchesSelected
        ? "current"
        : "stale";
  const pricedModel = useMemo(() => {
    const id = params.resolvedModelId ?? (params.modelChoice !== "auto" ? params.modelChoice : undefined);
    if (!id) return undefined;
    return (params.modelCatalog?.models ?? []).find((m) => m.id === id);
  }, [params.modelCatalog?.models, params.resolvedModelId, params.modelChoice]);
  const estimatedRequestCostUsd = estimateRequestCostUsd({
    model: pricedModel,
    promptTokens: params.lastUsage?.promptTokens,
    completionTokens: params.lastUsage?.completionTokens,
  });
  const requestCostUsd =
    typeof params.lastUsage?.requestCostUsd === "number" ? params.lastUsage.requestCostUsd : estimatedRequestCostUsd;
  const sessionCostUsd = typeof params.lastUsage?.sessionCostUsd === "number" ? params.lastUsage.sessionCostUsd : null;

  return {
    categoryOptions,
    effectiveModelId,
    contextWindow,
    mem0Chars,
    mem0TokensApprox,
    mem0InjectedApprox,
    precisePromptTokens,
    totalContextUsed,
    totalContextLeft,
    riskLevel,
    usageOwnerLabel,
    usageMatchesSelected,
    usageStatus,
    requestCostUsd,
    sessionCostUsd,
  };
}
