import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  markModelUnavailable,
  isModelTemporarilyUnavailable,
} from "./pipeline/chatHelpers.js";
import { listModelsCached } from "./togetherModels.js";
import { isNonTextModel } from "./modelCatalog.js";
import type { ModelHealthEntry } from "@helper/shared";

const together = createOpenAI({
  baseURL: "https://api.together.xyz/v1",
  apiKey: config.togetherApiKey,
});

/* ── Snapshot persistence ─────────────────────────────────────────── */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.resolve(__dirname, "../data/health-snapshot.json");

const healthMap = new Map<string, ModelHealthEntry>();

/** How long a health-check result stays valid before we re-ping. */
const HEALTH_TTL_MS = 60 * 60 * 1000; // 1 hour

let checkInProgress = false;

function entryAge(entry: ModelHealthEntry | undefined): number {
  if (!entry?.checkedAt) return Infinity;
  return Date.now() - new Date(entry.checkedAt).getTime();
}

function isStale(entry: ModelHealthEntry | undefined): boolean {
  return entryAge(entry) > HEALTH_TTL_MS;
}

function loadSnapshot(): void {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8")) as Record<
      string,
      ModelHealthEntry
    >;
    let loaded = 0;
    for (const [id, entry] of Object.entries(raw)) {
      if (entry && entry.checkedAt) {
        healthMap.set(id, entry);
        loaded++;
      }
    }
    const fresh = [...healthMap.values()].filter((e) => !isStale(e)).length;
    logger.info(
      { loaded, fresh, stale: loaded - fresh, path: SNAPSHOT_PATH },
      "health snapshot loaded from disk",
    );
  } catch (e) {
    logger.warn({ err: e }, "failed to load health snapshot");
  }
}

function saveSnapshot(): void {
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, ModelHealthEntry> = {};
    for (const [id, entry] of healthMap) obj[id] = entry;
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(obj, null, 2));
  } catch (e) {
    logger.warn({ err: e }, "failed to save health snapshot");
  }
}

// Load snapshot synchronously on module init
loadSnapshot();

/* ── Ping helpers ─────────────────────────────────────────────────── */

async function pingNonTextModel(modelId: string): Promise<ModelHealthEntry> {
  const t0 = Date.now();
  try {
    const catalog = await listModelsCached();
    const found = catalog.find((m) => m.id === modelId);
    const latencyMs = Date.now() - t0;
    if (found) {
      return {
        status: "available",
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      status: "unavailable",
      latencyMs,
      error: "model not found in catalog",
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    return {
      status: "unavailable",
      latencyMs,
      error: String((e as { message?: string })?.message ?? e).slice(0, 200),
      checkedAt: new Date().toISOString(),
    };
  }
}

async function pingTextModel(modelId: string): Promise<ModelHealthEntry> {
  const t0 = Date.now();
  try {
    await generateText({
      model: together(modelId),
      prompt: "Reply OK",
      maxTokens: 4,
      temperature: 0,
    });
    const latencyMs = Date.now() - t0;
    return {
      status: "available",
      latencyMs,
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    const msg = String((e as { message?: string })?.message ?? e).slice(0, 200);
    const isNotAvailable =
      msg.toLowerCase().includes("non-serverless") ||
      msg.toLowerCase().includes("model_not_available");
    if (isNotAvailable) markModelUnavailable(modelId);
    return {
      status: "unavailable",
      latencyMs,
      error: msg,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function pingModel(
  modelId: string,
  modelType?: string,
): Promise<ModelHealthEntry> {
  if (
    isNonTextModel(modelType) ||
    /whisper|speech|tts|veo.*audio|orpheus|kokoro|cartesia\/sonic|aura/i.test(
      modelId,
    )
  ) {
    return pingNonTextModel(modelId);
  }
  return pingTextModel(modelId);
}

/* ── Public API ────────────────────────────────────────────────────── */

export function getHealthMap(): Record<string, ModelHealthEntry> {
  const out: Record<string, ModelHealthEntry> = {};
  for (const [id, entry] of healthMap) out[id] = entry;
  return out;
}

export function getModelHealth(modelId: string): ModelHealthEntry {
  if (isModelTemporarilyUnavailable(modelId)) {
    return healthMap.get(modelId) ?? { status: "unavailable" };
  }
  return healthMap.get(modelId) ?? { status: "unknown" };
}

/**
 * Mark a model as unavailable in health map (e.g. after a runtime failure)
 * and persist the snapshot immediately.
 */
export function markModelUnhealthy(modelId: string, error?: string): void {
  const entry: ModelHealthEntry = {
    status: "unavailable",
    error: error?.slice(0, 200),
    checkedAt: new Date().toISOString(),
  };
  healthMap.set(modelId, entry);
  markModelUnavailable(modelId);
  saveSnapshot();
  logger.info({ model: modelId, error: entry.error }, "model marked unhealthy at runtime");
}

export async function checkModelsHealth(
  modelIds: string[],
  concurrency = 4,
  typeByModel?: Record<string, string | undefined>,
): Promise<Record<string, ModelHealthEntry>> {
  const results: Record<string, ModelHealthEntry> = {};
  const queue = [...modelIds];

  async function worker() {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const existing = healthMap.get(id);
      if (existing && !isStale(existing)) {
        results[id] = existing;
        continue;
      }
      healthMap.set(id, {
        status: "checking",
        checkedAt: new Date().toISOString(),
      });
      const entry = await pingModel(id, typeByModel?.[id]);
      healthMap.set(id, entry);
      results[id] = entry;
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    () => worker(),
  );
  await Promise.all(workers);

  saveSnapshot();
  return results;
}

export async function runStartupHealthCheck(
  categoryDefaults: Record<string, string[]>,
): Promise<void> {
  if (checkInProgress) return;
  checkInProgress = true;

  try {
    const catalog = await listModelsCached();
    const typeByModel: Record<string, string | undefined> = {};
    for (const m of catalog) typeByModel[m.id] = m.type;

    const baseModel = config.togetherBaseModel;
    const memoryModel = config.togetherMemoryModel;
    const priorityModels = [
      baseModel,
      ...(memoryModel && memoryModel !== baseModel ? [memoryModel] : []),
    ];

    // Only re-check priority models if stale
    const stalePriority = priorityModels.filter((id) =>
      isStale(healthMap.get(id)),
    );
    if (stalePriority.length > 0) {
      logger.info(
        { priorityModels: stalePriority },
        "health check: verifying priority models",
      );
      const baseResult = await checkModelsHealth(
        stalePriority,
        2,
        typeByModel,
      );
      for (const id of stalePriority) {
        logger.info(
          {
            model: id,
            status: baseResult[id]?.status,
            latencyMs: baseResult[id]?.latencyMs,
          },
          "health check: priority model result",
        );
      }
    } else {
      logger.info(
        { priorityModels },
        "health check: priority models still fresh from snapshot, skipping",
      );
    }

    const allDefaults = new Set<string>();
    for (const models of Object.values(categoryDefaults)) {
      for (const id of models) allDefaults.add(id);
    }
    allDefaults.delete(baseModel);

    const toCheck = [...allDefaults].filter((id) =>
      isStale(healthMap.get(id)),
    );

    if (toCheck.length > 0) {
      logger.info(
        { count: toCheck.length },
        "health check: background checking stale category models",
      );
      const bgResults = await checkModelsHealth(toCheck, 6, typeByModel);
      const available = Object.values(bgResults).filter(
        (e) => e.status === "available",
      ).length;
      const unavailable = Object.values(bgResults).filter(
        (e) => e.status === "unavailable",
      ).length;
      const skipped =
        toCheck.length - available - unavailable;
      logger.info(
        { total: toCheck.length, available, unavailable, skippedFresh: skipped },
        "health check: background complete",
      );
    } else {
      logger.info(
        "health check: all category models still fresh from snapshot, skipping",
      );
    }
  } catch (e) {
    logger.warn({ err: e }, "health check: startup check failed");
  } finally {
    checkInProgress = false;
  }
}

export function isHealthCheckRunning(): boolean {
  return checkInProgress;
}

export function isModelHealthy(modelId: string): boolean {
  if (isModelTemporarilyUnavailable(modelId)) return false;
  const entry = healthMap.get(modelId);
  if (!entry) return true; // not checked yet → optimistic
  return entry.status !== "unavailable";
}

export function pickFirstHealthyModel(candidates: string[]): string | null {
  for (const id of candidates) {
    if (isModelHealthy(id)) return id;
  }
  return null;
}
