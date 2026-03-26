import express from "express";
import cors from "cors";
import { z } from "zod";
import { streamText, generateText, convertToCoreMessages, type Message } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import path from "node:path";
import { existsSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { pinoHttp } from "pino-http";
import { listChatModelsCached } from "./togetherModels.js";
import { resolveChatModel } from "./classifyTier.js";
import {
  searchMemoryForUser,
  formatMemoryBlock,
  addConversationToMemory,
  isMemoryAvailable,
  memoryGetAll,
  memoryUpdate,
  memoryDelete,
} from "./mem0Service.js";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getProfileById,
  listMcpServers,
  upsertMcpServer,
  deleteMcpServer,
  type McpServerRecord,
} from "./store.js";
import {
  buildMcpToolSet,
  testMcpServer,
  disconnectAllMcp,
  disconnectMcp,
} from "./mcpRuntime.js";
import { lastUserTextFromMessages } from "./messageUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(
  cors({
    origin: config.webOrigin,
    credentials: true,
    exposedHeaders: ["x-helper-resolved-model", "x-helper-tier"],
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(
  pinoHttp({
    logger,
    customLogLevel: (req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err) return "error";
      if (res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      const u = req.url ?? "";
      if (u === "/api/health" || u.startsWith("/api/health?")) return "debug";
      return "info";
    },
  })
);

const togetherLlm = createOpenAI({
  baseURL: "https://api.together.xyz/v1",
  apiKey: config.togetherApiKey,
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/models", async (_req, res) => {
  try {
    if (!config.togetherApiKey) {
      res.status(503).json({ error: "TOGETHER_API_KEY not configured" });
      return;
    }
    const models = await listChatModelsCached();
    res.json({ models });
  } catch (e) {
    logger.error({ err: e }, "GET /api/models failed");
    res.status(500).json({ error: String(e) });
  }
});

const ChatBody = z.object({
  messages: z.array(z.unknown()),
  model: z.string().optional(),
  profileId: z.string().optional(),
});

type UsageSnapshot = {
  ts: string;
  resolvedModel: string;
  tier?: string;
  profileId: string | null;
  messageCount: number;
  lastUserChars: number;
  memoryHits: number;
  memoryBlockChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

const usageByProfile = new Map<string, UsageSnapshot>();
const unavailableModelsUntil = new Map<string, number>();
const MODEL_UNAVAILABLE_TTL_MS = 15 * 60 * 1000;

function isModelNotAvailableError(err: unknown): boolean {
  const e = err as { data?: { error?: { code?: string; message?: string } }; message?: string };
  const code = String(e?.data?.error?.code ?? "").toLowerCase();
  const msg = String(e?.data?.error?.message ?? e?.message ?? "").toLowerCase();
  return code === "model_not_available" || msg.includes("non-serverless model");
}

function markModelUnavailable(modelId: string) {
  unavailableModelsUntil.set(modelId, Date.now() + MODEL_UNAVAILABLE_TTL_MS);
}

function isModelTemporarilyUnavailable(modelId: string): boolean {
  const until = unavailableModelsUntil.get(modelId);
  if (!until) return false;
  if (Date.now() > until) {
    unavailableModelsUntil.delete(modelId);
    return false;
  }
  return true;
}

async function pickFirstAvailableModel(candidates: string[]): Promise<string | null> {
  for (const modelId of candidates) {
    if (isModelTemporarilyUnavailable(modelId)) continue;
    try {
      await generateText({
        model: togetherLlm(modelId),
        maxTokens: 8,
        temperature: 0,
        prompt: "ping",
      });
      return modelId;
    } catch (e) {
      if (isModelNotAvailableError(e)) {
        markModelUnavailable(modelId);
        continue;
      }
      // For transient/provider errors we still allow trying next candidate.
      logger.warn({ err: e, modelId }, "model availability probe failed");
      continue;
    }
  }
  return null;
}

app.post("/api/chat", async (req, res) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  if (!config.togetherApiKey) {
    res.status(503).json({ error: "TOGETHER_API_KEY not configured" });
    return;
  }

  const { messages, model: requestedModel, profileId } = parsed.data;
  const uiMessages = messages as Message[];
  const autoRequested = !requestedModel || requestedModel === "auto";

  const lastUserText = lastUserTextFromMessages(
    uiMessages as { role: string; content?: string; parts?: { type: string; text?: string }[] }[]
  );

  try {
    const { model, tier, skippedClassifier, candidates } = await resolveChatModel(
      requestedModel,
      lastUserText || "hello"
    );
    const orderedCandidates = [model, ...candidates.filter((c) => c !== model)];
    const autoFiltered = autoRequested
      ? orderedCandidates.filter((m) => !isModelTemporarilyUnavailable(m))
      : orderedCandidates;
    const effectiveCandidates = autoFiltered.length ? autoFiltered : orderedCandidates;
    let selectedModel = effectiveCandidates[0] ?? model;
    let escalatedFrom: string | null = null;

    if (autoRequested && effectiveCandidates.length > 1 && lastUserText.trim()) {
      try {
        const probe = await generateText({
          model: togetherLlm(selectedModel),
          temperature: 0.1,
          maxTokens: 260,
          prompt: `You are a strict quality probe.
Answer the user query directly and briefly. If uncertain, say so.

User query:
"""${lastUserText.slice(0, 8000)}"""`,
        });
        const probeText = (probe.text || "").trim();
        const weak =
          probeText.length < Math.max(48, Math.min(140, Math.floor(lastUserText.length * 0.2))) ||
          /\b(i (do not|don't) know|cannot|can't|not enough (context|information)|unknown|as an ai)\b/i.test(
            probeText
          ) ||
          /\b(не знаю|не могу|недостаточно (контекста|информации)|не уверен)\b/i.test(probeText);
        if (weak) {
          const next = effectiveCandidates.find((c) => c !== selectedModel) ?? selectedModel;
          if (next !== selectedModel) {
            escalatedFrom = selectedModel;
            selectedModel = next;
          }
        }
      } catch (e) {
        if (isModelNotAvailableError(e)) {
          markModelUnavailable(selectedModel);
          const next = effectiveCandidates.find((c) => c !== selectedModel && !isModelTemporarilyUnavailable(c));
          if (next) {
            logger.warn(
              { model: selectedModel, fallback: next },
              "probe model unavailable, switched to fallback"
            );
            selectedModel = next;
          } else {
            logger.warn({ err: e, model: selectedModel }, "probe model unavailable, no fallback");
          }
        } else {
          logger.warn({ err: e, model: selectedModel }, "probe generation failed, keep primary model");
        }
      }
    }

    if (autoRequested) {
      const preferred = [selectedModel, ...effectiveCandidates.filter((m) => m !== selectedModel)];
      const available = await pickFirstAvailableModel(preferred);
      if (available && available !== selectedModel) {
        logger.warn({ from: selectedModel, to: available }, "selected model unavailable, switched before chat");
        selectedModel = available;
      }
      if (!available) {
        throw new Error("No available Together chat models for current account");
      }
    }

    logger.info(
      {
        route: "POST /api/chat",
        resolvedModel: selectedModel,
        routedCandidates: effectiveCandidates.slice(0, 5),
        escalatedFrom,
        tier,
        skippedClassifier,
        profileId: profileId ?? null,
        lastUserChars: lastUserText.length,
        messageCount: uiMessages.length,
      },
      "chat request"
    );
    res.setHeader("x-helper-resolved-model", selectedModel);
    if (tier) res.setHeader("x-helper-tier", tier);

    let mem0UserId: string | undefined;
    if (profileId) {
      const p = await getProfileById(profileId);
      mem0UserId = p?.mem0UserId;
    }

    let memoryBlock = "";
    if (mem0UserId && lastUserText) {
      const hits = await searchMemoryForUser(lastUserText, mem0UserId);
      memoryBlock = formatMemoryBlock(hits);
    }

    const mcpRows = await listMcpServers();
    const mcpTools = await buildMcpToolSet(mcpRows);

    const systemParts = [
      "You are Helper, a capable assistant. Be concise and accurate. When tools are available, use them when they clearly help answer the user.",
    ];
    if (memoryBlock) systemParts.push(memoryBlock);
    const system = systemParts.join("\n\n");

    const core = convertToCoreMessages(uiMessages);

    const result = streamText({
      model: togetherLlm(selectedModel),
      system,
      messages: core,
      maxSteps: config.maxToolRounds,
      tools: Object.keys(mcpTools).length ? mcpTools : undefined,
      onFinish: async ({ text, usage }) => {
        const usageSafe = usage as
          | {
              promptTokens?: number;
              completionTokens?: number;
              totalTokens?: number;
            }
          | undefined;
        const key = profileId ?? "__default__";
        usageByProfile.set(key, {
          ts: new Date().toISOString(),
          resolvedModel: selectedModel,
          tier,
          profileId: profileId ?? null,
          messageCount: uiMessages.length,
          lastUserChars: lastUserText.length,
          memoryHits: memoryBlock ? memoryBlock.split("\n").filter((l) => l.startsWith("- (")).length : 0,
          memoryBlockChars: memoryBlock.length,
          promptTokens:
            typeof usageSafe?.promptTokens === "number" ? usageSafe.promptTokens : null,
          completionTokens:
            typeof usageSafe?.completionTokens === "number" ? usageSafe.completionTokens : null,
          totalTokens: typeof usageSafe?.totalTokens === "number" ? usageSafe.totalTokens : null,
        });
        if (mem0UserId && lastUserText && text) {
          try {
            await addConversationToMemory(mem0UserId, lastUserText, text);
          } catch (e) {
            logger.warn({ err: e, mem0UserId }, "mem0 addConversation failed");
          }
        }
      },
    });

    result.pipeDataStreamToResponse(res);
  } catch (e) {
    logger.error({ err: e, route: "POST /api/chat" }, "chat handler failed");
    if (!res.headersSent) {
      res.status(500).json({ error: String(e) });
    }
  }
});

const ChatUsageQuery = z.object({
  profileId: z.string().optional(),
});

app.get("/api/chat/usage", (req, res) => {
  const parsed = ChatUsageQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(parsed.error.flatten());
    return;
  }
  // This endpoint is profile-sensitive and should never be served from cache,
  // otherwise UI can show usage from a different profile (304 replay).
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  const key = parsed.data.profileId || "__default__";
  const usage = usageByProfile.get(key) ?? null;
  res.json({ usage });
});

app.get("/api/profiles", async (_req, res) => {
  try {
    const profiles = await listProfiles();
    res.json({ profiles });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const ProfileCreate = z.object({ name: z.string() });
app.post("/api/profiles", async (req, res) => {
  const p = ProfileCreate.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const profile = await createProfile(p.data.name);
  res.json(profile);
});

const ProfilePatch = z.object({ name: z.string() });
app.patch("/api/profiles/:id", async (req, res) => {
  const p = ProfilePatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, p.data.name);
  if (!updated) return res404(res);
  res.json(updated);
});

app.delete("/api/profiles/:id", async (req, res) => {
  const ok = await deleteProfile(req.params.id!);
  if (!ok) return res404(res);
  res.json({ ok: true });
});

function res404(res: express.Response) {
  res.status(404).json({ error: "Not found" });
}

const MemoryQuery = z.object({
  userId: z.string(),
  q: z.string().optional(),
});

app.get("/api/memory", async (req, res) => {
  const p = MemoryQuery.safeParse(req.query);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (!isMemoryAvailable()) {
    return res.status(503).json({ error: "Memory unavailable (set TOGETHER_API_KEY)" });
  }
  try {
    if (p.data.q) {
      const results = await searchMemoryForUser(p.data.q, p.data.userId, 50);
      return res.json({ results });
    }
    const list = await memoryGetAll(p.data.userId, 200);
    const results = list.map((r) => ({
      id: r.id,
      memory: r.text,
      metadata: { createdAt: r.createdAt, updatedAt: r.updatedAt },
    }));
    return res.json({ results });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const MemoryUpdate = z.object({ text: z.string() });
app.patch("/api/memory/:id", async (req, res) => {
  const p = MemoryUpdate.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (!isMemoryAvailable()) return res.status(503).json({ error: "Memory unavailable" });
  try {
    await memoryUpdate(req.params.id!, p.data.text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.delete("/api/memory/:id", async (req, res) => {
  if (!isMemoryAvailable()) return res.status(503).json({ error: "Memory unavailable" });
  try {
    await memoryDelete(req.params.id!);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const McpUpsert = z.object({
  id: z.string().optional(),
  name: z.string(),
  enabled: z.boolean(),
  transport: z.enum(["http", "stdio"]),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

app.get("/api/mcp/servers", async (_req, res) => {
  try {
    const servers = await listMcpServers();
    res.json({ servers });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/mcp/servers", async (req, res) => {
  const p = McpUpsert.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const row = await upsertMcpServer(p.data as Omit<McpServerRecord, "id"> & { id?: string });
  res.json(row);
});

app.delete("/api/mcp/servers/:id", async (req, res) => {
  const id = req.params.id!;
  const ok = await deleteMcpServer(id);
  await disconnectMcp(id);
  if (!ok) return res404(res);
  res.json({ ok: true });
});

app.post("/api/mcp/servers/:id/test", async (req, res) => {
  const servers = await listMcpServers();
  const s = servers.find((x) => x.id === req.params.id);
  if (!s) return res404(res);
  try {
    const r = await testMcpServer(s);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const webDist = path.resolve(__dirname, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(webDist, "index.html"), (err) => {
      if (err) next();
    });
  });
}

const httpServer = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      webOrigin: config.webOrigin,
      logFile: config.logFile || null,
      logPretty: config.logPretty,
      voice: {
        browserAudioOnly: true,
      },
    },
    "HTTP server listening"
  );
});

let shuttingDown = false;
async function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "shutdown started");
  const forceTimer = setTimeout(() => {
    logger.error({ reason }, "forced shutdown timeout");
    process.exit(1);
  }, 8000);
  forceTimer.unref?.();
  try {
    // Stop accepting new connections first.
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      // Ensure keep-alive sockets don't block shutdown indefinitely.
      (httpServer as any).closeIdleConnections?.();
      (httpServer as any).closeAllConnections?.();
    });
    await disconnectAllMcp();
    logger.info({ reason }, "shutdown completed");
    clearTimeout(forceTimer);
    process.exit(exitCode);
  } catch (e) {
    logger.error({ err: e, reason }, "shutdown failed");
    clearTimeout(forceTimer);
    process.exit(1);
  }
}

httpServer.on("error", (err) => {
  logger.fatal({ err }, "HTTP server failed to bind or accept");
  process.exit(1);
});

process.on("SIGINT", () => void shutdown("SIGINT", 0));
process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
process.on("SIGHUP", () => void shutdown("SIGHUP", 0));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "unhandled rejection");
  void shutdown("unhandledRejection", 1);
});
