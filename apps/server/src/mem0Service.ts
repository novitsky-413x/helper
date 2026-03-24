import path from "node:path";
import { fileURLToPath } from "node:url";
import { Memory } from "mem0ai/oss";
import type { Message as Mem0Message } from "mem0ai/oss";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let memory: Memory | null = null;

function getMemory(): Memory | null {
  if (!config.togetherApiKey) return null;
  if (!memory) {
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
  }
  return memory;
}

export function isMemoryAvailable(): boolean {
  return !!config.togetherApiKey;
}

export async function searchMemoryForUser(
  query: string,
  userId: string,
  limit = 12
): Promise<{ id: string; memory: string; score?: number }[]> {
  const m = getMemory();
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
  const m = getMemory();
  if (!m) return;
  const messages: Mem0Message[] = [
    { role: "user", content: userContent },
    { role: "assistant", content: assistantContent },
  ];
  await m.add(messages, { userId, infer: true });
}

/** Shape expected by `index.ts` when listing all memories for a profile */
export async function memoryGetAll(
  userId: string,
  limit = 200
): Promise<{ id: string; text: string; createdAt: string; updatedAt: string }[]> {
  const m = getMemory();
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
  const m = getMemory();
  if (!m) throw new Error("Memory unavailable");
  await m.update(memoryId, text);
}

export async function memoryDelete(memoryId: string) {
  const m = getMemory();
  if (!m) throw new Error("Memory unavailable");
  await m.delete(memoryId);
}

export async function memoryDeleteAllForUser(userId: string) {
  const m = getMemory();
  if (!m) return;
  await m.deleteAll({ userId });
}
