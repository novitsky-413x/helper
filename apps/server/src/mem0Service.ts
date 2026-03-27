import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Memory as Mem0Memory } from "mem0ai/oss";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getModelCatalog, resolveCategoryOrder } from "./modelCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let memory: Mem0Memory | null = null;
let initPromise: Promise<Mem0Memory | null> | null = null;
let memoryDisabled = false;
let pgCompatChecked = false;
let memoryWriteOkCount = 0;
let memoryWriteFailCount = 0;
const memoryListCache = new Map<
  string,
  { at: number; rows: { id: string; text: string; createdAt: string; updatedAt: string }[] }
>();
const MEMORY_LIST_CACHE_TTL_MS = 8_000;

async function ensurePgCompatForMem0(): Promise<boolean> {
  if (pgCompatChecked) return !memoryDisabled;
  pgCompatChecked = true;
  try {
    const pg = (await import("pg")) as Record<string, unknown>;
    // mem0ai/oss currently imports `Client` and `Pool` as named ESM exports from `pg`.
    if (!("Client" in pg) || !("Pool" in pg)) {
      memoryDisabled = true;
      logger.warn(
        "memory disabled: installed `pg` package does not expose ESM named exports Client/Pool required by mem0ai/oss"
      );
      return false;
    }
    return true;
  } catch (e) {
    memoryDisabled = true;
    logger.warn({ err: e }, "memory disabled: failed to verify `pg` compatibility");
    return false;
  }
}

/** Dynamic import avoids loading `mem0ai` (and optional pgvector paths) until memory is used. */
async function getMemory(): Promise<Mem0Memory | null> {
  if (!config.togetherApiKey) return null;
  if (memoryDisabled) return null;
  if (!(await ensurePgCompatForMem0())) return null;
  if (memory) return memory;
  if (!initPromise) {
    initPromise = (async () => {
      let mem0LlmModel = config.mem0LlmModel || config.togetherBaseModel;
      const mem0EmbeddingModel = config.mem0EmbeddingModel || "intfloat/multilingual-e5-large-instruct";
      if (!config.mem0LlmModel) {
        try {
          const catalog = await getModelCatalog();
          const ranked = resolveCategoryOrder("memory", undefined, catalog);
          if (ranked[0]) mem0LlmModel = ranked[0];
        } catch {
          /* ignore, keep base fallback */
        }
      }
      const { Memory } = await import("mem0ai/oss");
      memory = new Memory({
        version: "v1.1",
        historyDbPath: config.mem0HistoryDb,
        embedder: {
          provider: "openai",
          config: {
            apiKey: config.togetherApiKey,
            model: mem0EmbeddingModel,
            baseURL: "https://api.together.xyz/v1",
            embeddingDims: config.mem0EmbeddingDims,
          },
        },
        vectorStore: {
          provider: "memory",
          config: {
            collectionName: "helper_memories",
            dimension: config.mem0EmbeddingDims,
          },
        },
        llm: {
          provider: "openai",
          config: {
            apiKey: config.togetherApiKey,
            model: mem0LlmModel,
            baseURL: "https://api.together.xyz/v1",
          },
        },
        customPrompt:
          "You extract durable facts and preferences about the user for long-term memory. Ignore transient trivia.",
      });
      return memory;
    })().catch((e) => {
      initPromise = null;
      logger.error({ err: e }, "failed to load mem0ai/oss Memory");
      memoryDisabled = true;
      return null;
    });
  }
  return initPromise;
}

export function isMemoryAvailable(): boolean {
  return !!config.togetherApiKey && !memoryDisabled;
}

export type MemorySelectionPolicy = {
  topK: number;
  maxChars: number;
  pinnedOnlyForSimple: boolean;
};

export const DEFAULT_MEMORY_POLICY: MemorySelectionPolicy = {
  topK: 10,
  maxChars: 3500,
  pinnedOnlyForSimple: true,
};

export async function searchMemoryForUser(
  query: string,
  userId: string,
  limit = 12
): Promise<{ id: string; memory: string; score?: number }[]> {
  const m = await getMemory();
  if (!m) return [];
  const res = await m.search(query, { userId, limit });
  return res.results.map((r) => ({
    id: r.id,
    memory: r.memory,
    score: r.score,
  }));
}

export function formatMemoryBlock(
  memories: { id: string; memory: string; score?: number }[]
): string {
  if (!memories.length) return "";
  const lines = memories.map((x) => `- (${x.id.slice(0, 8)}…) ${x.memory}`);
  return `Known facts about this user (memory profile). Use naturally; do not fabricate beyond this list.\n${lines.join("\n")}`;
}

function trimToChars(lines: string[], maxChars: number): string[] {
  const out: string[] = [];
  let size = 0;
  for (const line of lines) {
    const next = size + line.length + 1;
    if (next > maxChars) break;
    out.push(line);
    size = next;
  }
  return out;
}

export async function buildMemoryContext(params: {
  query: string;
  userId: string;
  pinned: string[];
  policy?: Partial<MemorySelectionPolicy>;
  isSimpleRequest?: boolean;
}): Promise<{ block: string; hits: number }> {
  const policy: MemorySelectionPolicy = {
    ...DEFAULT_MEMORY_POLICY,
    ...(params.policy ?? {}),
  };
  const pinnedLines = params.pinned.filter((x) => x.trim()).map((x) => `- ${x.trim()}`);
  if (params.isSimpleRequest && policy.pinnedOnlyForSimple) {
    if (!pinnedLines.length) return { block: "", hits: 0 };
    const lines = trimToChars(pinnedLines, policy.maxChars);
    return { block: `Pinned memory:\n${lines.join("\n")}`, hits: lines.length };
  }

  const ranked = await searchMemoryForUser(params.query, params.userId, Math.max(4, policy.topK * 2));
  const unique = new Set<string>();
  const selected: string[] = [];
  for (const row of ranked) {
    const key = row.memory.trim().toLowerCase();
    if (!key || unique.has(key)) continue;
    unique.add(key);
    selected.push(`- (${row.id.slice(0, 8)}…) ${row.memory.trim()}`);
    if (selected.length >= policy.topK) break;
  }
  const combined = [...pinnedLines, ...selected];
  const lines = trimToChars(combined, policy.maxChars);
  if (!lines.length) return { block: "", hits: 0 };
  return {
    block:
      "Known facts about this user (memory profile). Use naturally; do not fabricate beyond this list.\n" +
      lines.join("\n"),
    hits: lines.length,
  };
}

export async function addConversationToMemory(
  userId: string,
  userContent: string,
  assistantContent: string
): Promise<boolean> {
  const m = await getMemory();
  if (!m) {
    memoryWriteFailCount += 1;
    return false;
  }
  const cleanUser = sanitizeMemoryText(userContent);
  const cleanAssistant = sanitizeMemoryText(assistantContent);
  const fallback = `User: ${cleanUser}\nAssistant: ${cleanAssistant}`.trim();
  if (!fallback) {
    memoryWriteFailCount += 1;
    return false;
  }
  try {
    // Keep memory writes deterministic and stable.
    // infer=true in mem0ai/oss intermittently fails with provider-specific flows.
    await m.add(fallback, { userId, infer: false });
    memoryListCache.delete(userId);
    memoryWriteOkCount += 1;
    return true;
  } catch (e) {
    memoryWriteFailCount += 1;
    logger.error({ err: e, userId }, "mem0 add failed");
    return false;
  }
}

function sanitizeMemoryText(input: string): string {
  const s = String(input ?? "").trim();
  if (!s) return "";
  // Remove huge inline payloads and keep semantic user intent.
  const withoutDataUrls = s.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, "[image-data]");
  const withoutMdImages = withoutDataUrls.replace(/!\[[^\]]*]\([^)]*\)/g, "[image]");
  const collapsed = withoutMdImages.replace(/\s+/g, " ").trim();
  return collapsed.length > 3000 ? `${collapsed.slice(0, 3000)}...` : collapsed;
}

/** Shape expected by `index.ts` when listing all memories for a profile */
export async function memoryGetAll(
  userId: string,
  limit = 200
): Promise<{ id: string; text: string; createdAt: string; updatedAt: string }[]> {
  const cached = memoryListCache.get(userId);
  if (cached && Date.now() - cached.at < MEMORY_LIST_CACHE_TTL_MS) {
    return cached.rows.slice(0, limit);
  }
  const m = await getMemory();
  if (!m) return [];
  const r = await m.getAll({ userId, limit });
  const rows = r.results.map((item) => ({
    id: item.id,
    text: item.memory,
    createdAt: item.createdAt ?? "",
    updatedAt: item.updatedAt ?? "",
  }));
  memoryListCache.set(userId, { at: Date.now(), rows });
  return rows;
}

export async function memoryUpdate(memoryId: string, text: string) {
  const m = await getMemory();
  if (!m) throw new Error("Memory unavailable");
  await m.update(memoryId, text);
  memoryListCache.clear();
}

export async function memoryDelete(memoryId: string) {
  const m = await getMemory();
  if (!m) throw new Error("Memory unavailable");
  await m.delete(memoryId);
  memoryListCache.clear();
}

export async function memoryDeleteAllForUser(userId: string) {
  const m = await getMemory();
  if (!m) return;
  await m.deleteAll({ userId });
  memoryListCache.delete(userId);
}

export function getMemoryWriteStats(): { ok: number; fail: number } {
  return { ok: memoryWriteOkCount, fail: memoryWriteFailCount };
}
