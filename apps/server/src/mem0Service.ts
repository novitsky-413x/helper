import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { Memory as Mem0Memory } from "mem0ai/oss";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { isLowQuality, stripModelArtifacts } from "./pipeline/messageQuality.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let memory: Mem0Memory | null = null;
let initPromise: Promise<Mem0Memory | null> | null = null;
let memoryDisabled = false;
let memoryWriteOkCount = 0;
let memoryWriteFailCount = 0;
const memoryListCache = new Map<
  string,
  { at: number; rows: { id: string; text: string; createdAt: string; updatedAt: string }[] }
>();
const MEMORY_LIST_CACHE_TTL_MS = 8_000;

/**
 * Load mem0ai/oss via CJS require() to avoid the ESM named-import issue with `pg`.
 * mem0ai/oss's ESM bundle does `import { Client } from "pg"` which fails under
 * tsx's loader because pg's ESM wrapper isn't properly resolved. The CJS bundle
 * uses `require("pg")` which always works.
 */
function loadMem0Oss(): { Memory: new (config: Record<string, unknown>) => Mem0Memory } {
  return require("mem0ai/oss") as { Memory: new (config: Record<string, unknown>) => Mem0Memory };
}

export async function getMemoryInstance(): Promise<Mem0Memory | null> {
  return getMemory();
}

async function getMemory(): Promise<Mem0Memory | null> {
  if (!config.togetherApiKey) return null;
  if (memoryDisabled) return null;
  if (memory) return memory;
  if (!initPromise) {
    initPromise = (async () => {
      const mem0LlmModel = config.mem0LlmModel || config.togetherBaseModel;
      const mem0EmbeddingModel = config.mem0EmbeddingModel || "intfloat/multilingual-e5-large-instruct";
      logger.info({ mem0LlmModel, mem0EmbeddingModel }, "mem0 initializing");
      const { Memory } = loadMem0Oss();
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
      } as Record<string, unknown>);
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

const TRIVIAL_RE = /^(привет|здравствуйте?|hi|hello|hey|yo|хай|ок|ok|okay|да|нет|yes|no|спасибо|thanks|thank you|благодарю|пока|bye|good\s*bye|ладно|понятно|ясно|хорошо|good|great|cool|nice|fine|sup|ага|угу|lol|haha|gg|wow|hmm|ну|э+|а+|o+h?)[\s!?.,]*$/i;

function isTrivialMessage(text: string): boolean {
  const t = text.trim();
  return t.length < 40 && TRIVIAL_RE.test(t);
}

const INSTRUCTION_RE =
  /\b(нельзя|запрет|запрещ|не генерир|не создава|никогда|never|don'?t|do not|prohibit|forbid|ban|block|avoid|must not|should not|не рису|не делай|не показыва|не отправля|instruction|rule|always|всегда|обязательн)\b/i;

function isInstructionMemory(text: string): boolean {
  return INSTRUCTION_RE.test(text);
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

  if (isTrivialMessage(params.query)) {
    if (!pinnedLines.length) return { block: "", hits: 0 };
    const lines = trimToChars(pinnedLines, policy.maxChars);
    return { block: `Pinned memory:\n${lines.join("\n")}`, hits: lines.length };
  }

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

  // Always include instruction/prohibition memories even if semantic search didn't match.
  // These are rules the user explicitly stored — they must always be visible to the LLM.
  try {
    const allMemories = await memoryGetAll(params.userId, 100);
    for (const mem of allMemories) {
      const key = mem.text.trim().toLowerCase();
      if (!key || unique.has(key)) continue;
      if (isInstructionMemory(mem.text)) {
        unique.add(key);
        selected.push(`- (${mem.id.slice(0, 8)}…) [RULE] ${mem.text.trim()}`);
      }
    }
  } catch (e) {
    logger.warn({ err: e }, "failed to fetch instruction memories");
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

const DEDUP_SIMILARITY_THRESHOLD = 0.92;

async function isDuplicateMemory(m: Mem0Memory, userId: string, text: string): Promise<boolean> {
  try {
    const results = await m.search(text, { userId, limit: 3 });
    for (const r of results.results) {
      if (typeof r.score === "number" && r.score >= DEDUP_SIMILARITY_THRESHOLD) {
        logger.debug({ userId, existingId: r.id, score: r.score }, "dedup: skipping near-duplicate memory");
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

const MAX_MEMORY_TEXT_CHARS = 1200;

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
  if (!cleanAssistant || cleanAssistant.length < 5 || isLowQuality(cleanAssistant)) {
    return false;
  }
  const fallback = `User: ${cleanUser}\nAssistant: ${cleanAssistant}`.trim();
  if (!fallback) {
    memoryWriteFailCount += 1;
    return false;
  }

  if (await isDuplicateMemory(m, userId, fallback)) {
    memoryWriteOkCount += 1;
    return true;
  }

  let textForAdd = fallback;
  if (fallback.length > MAX_MEMORY_TEXT_CHARS) {
    textForAdd = fallback.slice(0, MAX_MEMORY_TEXT_CHARS);
    logger.debug(
      { userId, originalChars: fallback.length, truncatedChars: textForAdd.length },
      "mem0 add: truncated fallback before embed"
    );
  }

  try {
    await m.add(textForAdd, { userId, infer: false });
    memoryListCache.delete(userId);
    memoryWriteOkCount += 1;
    logger.debug({ userId, chars: textForAdd.length }, "mem0 add succeeded");
    return true;
  } catch (e) {
    memoryWriteFailCount += 1;
    logger.error(
      { err: e, userId, textPreview: textForAdd.slice(0, 120) },
      "mem0 add failed"
    );
    return false;
  }
}

function sanitizeMemoryText(input: string): string {
  const s = stripModelArtifacts(String(input ?? "").trim());
  if (!s) return "";
  let out = s;
  out = out.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi, "");
  out = out.replace(/!\[[^\]]*]\([^)]*\)/g, "");
  out = out.replace(/\[img:https?:\/\/[^\]\s]+\][^\n]*/g, "");
  out = out.replace(/\[audio:\/api\/audio\/file\/[\w-]+\][^\n]*/g, "");
  out = out.replace(/"\\*"?\{[\s\S]*?\}\\*"?"/g, "");
  out = out.replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, "");
  out = out.replace(/<audio[^>]*\/?\s*>/gi, "");
  out = out.replace(/https?:\/\/api\.together\.ai\/shrt\/\S+/g, "");
  const collapsed = out.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_MEMORY_TEXT_CHARS ? `${collapsed.slice(0, MAX_MEMORY_TEXT_CHARS)}...` : collapsed;
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

const VECTOR_SNAPSHOT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/vector-snapshot.json"
);

export async function persistVectorStore(): Promise<void> {
  const m = await getMemory();
  if (!m) return;
  try {
    const allData: Record<string, unknown[]> = {};
    const userIds = [...memoryListCache.keys()];
    for (const userId of userIds) {
      const rows = await m.getAll({ userId, limit: 500 });
      allData[userId] = rows.results.map((r) => ({
        id: r.id,
        memory: r.memory,
        userId,
        createdAt: r.createdAt ?? "",
        updatedAt: r.updatedAt ?? "",
      }));
    }
    const dir = path.dirname(VECTOR_SNAPSHOT_PATH);
    mkdirSync(dir, { recursive: true });
    writeFileSync(VECTOR_SNAPSHOT_PATH, JSON.stringify(allData, null, 2), "utf-8");
    logger.info({ path: VECTOR_SNAPSHOT_PATH, users: userIds.length }, "vector store snapshot saved");
  } catch (e) {
    logger.warn({ err: e }, "failed to persist vector store");
  }
}

export async function restoreVectorStore(): Promise<void> {
  if (!existsSync(VECTOR_SNAPSHOT_PATH)) return;
  const m = await getMemory();
  if (!m) return;
  try {
    const raw = readFileSync(VECTOR_SNAPSHOT_PATH, "utf-8");
    const data = JSON.parse(raw) as Record<string, Array<{ memory: string; userId: string }>>;
    let count = 0;
    for (const [userId, rows] of Object.entries(data)) {
      for (const row of rows) {
        try {
          await m.add(row.memory, { userId, infer: false });
          count++;
        } catch {
          // skip individual failures
        }
      }
    }
    logger.info({ path: VECTOR_SNAPSHOT_PATH, restoredCount: count }, "vector store snapshot restored");
  } catch (e) {
    logger.warn({ err: e }, "failed to restore vector store");
  }
}
