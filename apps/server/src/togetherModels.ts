import Together from "together-ai";
import { config } from "./config.js";

type Cached = { at: number; models: TogetherModelRow[] };
let cache: Cached | null = null;
const TTL_MS = 10 * 60 * 1000;

export type TogetherModelRow = {
  id: string;
  display_name?: string | null;
  type?: string;
  context_length?: number | null;
  pricing?: {
    hourly?: number | null;
    input?: number | null;
    output?: number | null;
    base?: number | null;
    finetune?: number | null;
  } | null;
};

type RawModel = {
  id: string;
  display_name?: string | null;
  type?: string | null;
  context_length?: number | null;
  pricing?: {
    hourly?: number | null;
    input?: number | null;
    output?: number | null;
    base?: number | null;
    finetune?: number | null;
  } | null;
};

function normalizePrice(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  // Together can expose price as "per token" (very small number) or per 1M tokens.
  // Normalize to "per 1M tokens" for consistent UI math.
  if (parsed > 0 && parsed < 0.001) return parsed * 1_000_000;
  return parsed;
}

function normalizeModelRow(m: RawModel): TogetherModelRow {
  return {
    id: m.id,
    display_name: m.display_name ?? null,
    type: m.type ?? undefined,
    context_length: m.context_length ?? null,
    pricing: m.pricing
      ? {
          hourly: normalizePrice(m.pricing.hourly),
          input: normalizePrice(m.pricing.input),
          output: normalizePrice(m.pricing.output),
          base: normalizePrice(m.pricing.base),
          finetune: normalizePrice(m.pricing.finetune),
        }
      : null,
  };
}

export async function listModelsCached(): Promise<TogetherModelRow[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.models;

  if (!config.togetherApiKey) {
    return [];
  }

  const client = new Together({ apiKey: config.togetherApiKey });
  const list = (await client.models.list()) as RawModel[];
  const all = list.map(normalizeModelRow).sort((a, b) => a.id.localeCompare(b.id));
  cache = { at: now, models: all };
  return all;
}

export async function listChatModelsCached(): Promise<TogetherModelRow[]> {
  const all = await listModelsCached();
  return all.filter((m) => m.type === "chat" || m.type === "language" || m.type === "code");
}
