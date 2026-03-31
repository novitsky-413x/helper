import Together from "together-ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getMemoryWriteStats } from "../mem0Service.js";

export const togetherLlm = createOpenAI({
  baseURL: "https://api.together.xyz/v1",
  apiKey: config.togetherApiKey,
});

export const togetherClient = new Together({ apiKey: config.togetherApiKey });

export type UsageSnapshot = {
  ts: string;
  resolvedModel: string;
  delegatedCategory?: string;
  profileId: string | null;
  messageCount: number;
  lastUserChars: number;
  memoryHits: number;
  memoryBlockChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  requestCostUsd: number | null;
  sessionCostUsd: number | null;
  memoryWriteOkTotal: number;
  memoryWriteFailTotal: number;
  memoryWriteLastOk: boolean | null;
};

export const usageByProfile = new Map<string, UsageSnapshot>();
export const sessionCostByProfile = new Map<string, number>();

const unavailableModelsUntil = new Map<string, number>();
const MODEL_UNAVAILABLE_TTL_MS = 15 * 60 * 1000;

function normalizePerMillion(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (value > 0 && value < 0.001) return value * 1_000_000;
  return value;
}

export function estimateRequestCostUsd(params: {
  modelInputPer1M: number | null | undefined;
  modelOutputPer1M: number | null | undefined;
  promptTokens: number | null | undefined;
  completionTokens: number | null | undefined;
}): number | null {
  const inPrice = normalizePerMillion(params.modelInputPer1M);
  const outPrice = normalizePerMillion(params.modelOutputPer1M);
  const pt = typeof params.promptTokens === "number" ? params.promptTokens : null;
  const ct = typeof params.completionTokens === "number" ? params.completionTokens : null;
  if ((inPrice === null && outPrice === null) || (pt === null && ct === null)) return null;
  const inCost = inPrice !== null && pt !== null ? (pt / 1_000_000) * inPrice : 0;
  const outCost = outPrice !== null && ct !== null ? (ct / 1_000_000) * outPrice : 0;
  return inCost + outCost;
}

export function isModelNotAvailableError(err: unknown): boolean {
  const e = err as { data?: { error?: { code?: string; message?: string } }; message?: string };
  const code = String(e?.data?.error?.code ?? "").toLowerCase();
  const msg = String(e?.data?.error?.message ?? e?.message ?? "").toLowerCase();
  return code === "model_not_available" || msg.includes("non-serverless model");
}

export function markModelUnavailable(modelId: string) {
  unavailableModelsUntil.set(modelId, Date.now() + MODEL_UNAVAILABLE_TTL_MS);
}

export function isModelTemporarilyUnavailable(modelId: string): boolean {
  const until = unavailableModelsUntil.get(modelId);
  if (!until) return false;
  if (Date.now() > until) {
    unavailableModelsUntil.delete(modelId);
    return false;
  }
  return true;
}

export function pickFirstRoutableModel(candidates: string[]): string | null {
  for (const modelId of candidates) {
    if (!isModelTemporarilyUnavailable(modelId)) return modelId;
  }
  return null;
}

export function estimateTokensFromText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

export type ModalityRoute = "text_chat" | "image_gen" | "vision_understand";

export function inferModalityRoute(params: {
  lastUserText: string;
  imageInputCount: number;
  likelyImageRequest: boolean;
  likelyImageEditRequest: boolean;
}): ModalityRoute {
  if (params.imageInputCount > 0 && !params.likelyImageEditRequest) return "vision_understand";
  if (params.likelyImageRequest || params.likelyImageEditRequest) return "image_gen";
  return "text_chat";
}

export function createUsageSnapshotFinalizer(params: {
  usageKey: string;
  profileId: string | null;
  selectedModel: string;
  modelPriceInput: number | null | undefined;
  modelPriceOutput: number | null | undefined;
  uiMessageCount: number;
  lastUserTextLength: number;
  memoryHits: number;
  memoryBlockLength: number;
  getDelegatedCategory: () => string | undefined;
}) {
  return (extra?: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    resolvedModel?: string;
    modelInputPer1M?: number | null;
    modelOutputPer1M?: number | null;
    requestCostUsd?: number | null;
    memoryWriteLastOk?: boolean | null;
  }) => {
    const promptTokens = typeof extra?.promptTokens === "number" ? extra.promptTokens : null;
    const completionTokens = typeof extra?.completionTokens === "number" ? extra.completionTokens : null;
    const totalTokens = typeof extra?.totalTokens === "number" ? extra.totalTokens : null;
    const requestCostUsd =
      typeof extra?.requestCostUsd === "number"
        ? extra.requestCostUsd
        : estimateRequestCostUsd({
            modelInputPer1M: extra?.modelInputPer1M ?? params.modelPriceInput ?? null,
            modelOutputPer1M: extra?.modelOutputPer1M ?? params.modelPriceOutput ?? null,
            promptTokens,
            completionTokens,
          });
    const memStats = getMemoryWriteStats();
    const prevSessionCost = sessionCostByProfile.get(params.usageKey) ?? 0;
    const nextSessionCost = prevSessionCost + (requestCostUsd ?? 0);
    sessionCostByProfile.set(params.usageKey, nextSessionCost);
    usageByProfile.set(params.usageKey, {
      ts: new Date().toISOString(),
      resolvedModel: extra?.resolvedModel ?? params.selectedModel,
      delegatedCategory: params.getDelegatedCategory(),
      profileId: params.profileId,
      messageCount: params.uiMessageCount,
      lastUserChars: params.lastUserTextLength,
      memoryHits: params.memoryHits,
      memoryBlockChars: params.memoryBlockLength,
      promptTokens,
      completionTokens,
      totalTokens,
      requestCostUsd,
      sessionCostUsd: nextSessionCost,
      memoryWriteOkTotal: memStats.ok,
      memoryWriteFailTotal: memStats.fail,
      memoryWriteLastOk: typeof extra?.memoryWriteLastOk === "boolean" ? extra.memoryWriteLastOk : null,
    });
  };
}

export function buildVisionMessages(
  uiMessages: Array<{ role: string; content?: unknown; parts?: Array<Record<string, unknown>> }>
): Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
  const recent = uiMessages.slice(-8);
  const out: Array<{ role: "system" | "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [];
  for (const m of recent) {
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;
    const role = m.role as "system" | "user" | "assistant";
    const parts = Array.isArray(m.parts)
      ? m.parts
      : Array.isArray(m.content)
        ? (m.content as Array<Record<string, unknown>>)
        : [];
    if (!parts.length) {
      if (typeof m.content === "string" && m.content.trim()) out.push({ role, content: m.content });
      continue;
    }
    const contentParts: Array<Record<string, unknown>> = [];
    for (const p of parts) {
      const type = String(p.type ?? "").toLowerCase();
      const text = typeof p.text === "string" ? p.text : typeof p.content === "string" ? p.content : "";
      const imageUrl =
        typeof p.image_url === "string"
          ? p.image_url
          : typeof p.imageUrl === "string"
            ? p.imageUrl
            : typeof p.url === "string"
              ? p.url
              : typeof (p.image_url as { url?: unknown } | undefined)?.url === "string"
                ? ((p.image_url as { url?: string }).url as string)
                : "";
      if ((type === "text" || type === "input_text") && text) {
        contentParts.push({ type: "text", text });
      } else if (type.includes("image") || imageUrl) {
        contentParts.push({ type: "image_url", image_url: { url: imageUrl } });
      }
    }
    if (contentParts.length) {
      out.push({ role, content: contentParts });
    }
  }
  return out;
}
