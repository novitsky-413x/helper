import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Monorepo: src/ and dist/ live under apps/server — repo-root .env is three levels up.
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
  override: true,
});

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

  /** Pino level: trace | debug | info | warn | error | fatal */
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
  /** Pretty-print logs on stdout (still JSON if false). */
  logPretty: process.env.LOG_PRETTY === "1" || process.env.LOG_PRETTY === "true",
  /** Append the same logs to this file (JSON lines). Directory is created if needed. */
  logFile:
    process.env.LOG_FILE?.trim() ||
    path.resolve(__dirname, "../logs/server.log"),
};

