import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
// Monorepo: src/ and dist/ live under apps/server — repo-root .env is three levels up.
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  override: true,
});

const isProduction = process.env.NODE_ENV === "production";

/**
 * CORS / Socket.io origin: in production, single WEB_ORIGIN. In dev, allow any
 * http localhost port so Vite can bind 5173, 5175, … while the client still
 * talks to :3001 (e.g. Socket.io).
 */
export function corsOrigin(
  requestOrigin: string | undefined,
  callback: (err: Error | null, allow?: boolean | string) => void,
): void {
  const primary = process.env.WEB_ORIGIN?.trim() || "http://localhost:5173";
  if (isProduction) {
    callback(null, primary);
    return;
  }
  if (!requestOrigin) {
    callback(null, true);
    return;
  }
  try {
    const u = new URL(requestOrigin);
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ) {
      callback(null, requestOrigin);
      return;
    }
  } catch {
    /* ignore */
  }
  if (requestOrigin === primary) {
    callback(null, true);
    return;
  }
  callback(new Error(`CORS blocked: ${requestOrigin}`));
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
  togetherApiKey: process.env.TOGETHER_API_KEY || "",
  mongoUri: process.env.MONGODB_URI || "",
  togetherBaseModel: process.env.TOGETHER_BASE_MODEL || "google/gemma-3n-E4B-it",
  /** Stronger model used when memory context is present and instruction following matters. */
  togetherMemoryModel: process.env.TOGETHER_MEMORY_MODEL || "openai/gpt-oss-20b",
  mem0EmbeddingModel: process.env.MEM0_EMBEDDING_MODEL || "",
  mem0EmbeddingDims: Number(process.env.MEM0_EMBEDDING_DIMS) || 1024,
  mem0LlmModel: process.env.MEM0_LLM_MODEL || "",
  mem0HistoryDb:
    process.env.MEM0_HISTORY_DB ||
    path.resolve(__dirname, "../data/mem0-history.db"),
  maxToolRounds: Number(process.env.MAX_TOOL_ROUNDS) || 8,

  /** Agent workspace — all files the agent creates go here. */
  agentWorkspace:
    process.env.AGENT_WORKSPACE?.trim() ||
    path.resolve(repoRoot, "workspace"),

  /** OS metadata exposed to the system prompt. */
  platform: process.platform as string,
  shell: process.platform === "win32" ? "PowerShell" : "bash",
  hostname: os.hostname(),

  /** Pino level: trace | debug | info | warn | error | fatal */
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  /** Pretty-print logs on stdout (still JSON if false). */
  logPretty: process.env.LOG_PRETTY === "1" || process.env.LOG_PRETTY === "true",
  /** Append the same logs to this file (JSON lines). Directory is created if needed. */
  logFile:
    process.env.LOG_FILE?.trim() ||
    path.resolve(__dirname, "../logs/server.log"),
};

