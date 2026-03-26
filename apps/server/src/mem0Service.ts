import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Memory as Mem0Memory, Message as Mem0Message } from "mem0ai/oss";
import { config } from "./config.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let memory: Mem0Memory | null = null;
let initPromise: Promise<Mem0Memory | null> | null = null;
let memoryDisabled = false;
let pgCompatChecked = false;

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
      const { Memory } = await import("mem0ai/oss");
      memory = new Memory({
        version: "v1.1",
        historyDbPath: config.mem0HistoryDb,
        embedder: {
          provider: "openai",
          config: {
            apiKey: config.togetherApiKey,
            model: config.mem0EmbeddingModel,
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
            model: config.mem0LlmModel,
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

export async function addConversationToMemory(
  userId: string,
  userContent: string,
  assistantContent: string
) {
  const m = await getMemory();
  if (!m) return;
  const messages: Mem0Message[] = [
    { role: "user", content: userContent },
    { role: "assistant", content: assistantContent },
  ];
  try {
    await m.add(messages, { userId, infer: true });
    return;
  } catch (e) {
    // mem0ai/oss@2.4.2 currently throws `text.replace is not a function`
    // with infer=true in some provider flows. Fall back to explicit write.
    logger.warn({ err: e, userId }, "mem0 infer add failed, using fallback write");
  }

  const fallback = `User: ${userContent.trim()}\nAssistant: ${assistantContent.trim()}`;
  if (!fallback.trim()) return;
  await m.add(fallback, { userId, infer: false });
}

/** Shape expected by `index.ts` when listing all memories for a profile */
export async function memoryGetAll(
  userId: string,
  limit = 200
): Promise<{ id: string; text: string; createdAt: string; updatedAt: string }[]> {
  const m = await getMemory();
  if (!m) return [];
  const r = await m.getAll({ userId, limit });
  return r.results.map((item) => ({
    id: item.id,
    text: item.memory,
    createdAt: item.createdAt ?? "",
    updatedAt: item.updatedAt ?? "",
  }));
}

export async function memoryUpdate(memoryId: string, text: string) {
  const m = await getMemory();
  if (!m) throw new Error("Memory unavailable");
  await m.update(memoryId, text);
}

export async function memoryDelete(memoryId: string) {
  const m = await getMemory();
  if (!m) throw new Error("Memory unavailable");
  await m.delete(memoryId);
}

export async function memoryDeleteAllForUser(userId: string) {
  const m = await getMemory();
  if (!m) return;
  await m.deleteAll({ userId });
}
