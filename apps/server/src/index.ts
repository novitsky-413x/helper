import express from "express";
import cors from "cors";
import { z } from "zod";
import { streamText, convertToCoreMessages, type Message } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import path from "node:path";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
import { attachVoiceWebSocket } from "./voice/voiceWs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(
  cors({
    origin: config.webOrigin,
    credentials: true,
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

  const lastUserText = lastUserTextFromMessages(
    uiMessages as { role: string; content?: string; parts?: { type: string; text?: string }[] }[]
  );

  try {
    const { model, tier, skippedClassifier } = await resolveChatModel(
      requestedModel,
      lastUserText || "hello"
    );

    logger.info(
      {
        route: "POST /api/chat",
        resolvedModel: model,
        tier,
        skippedClassifier,
        profileId: profileId ?? null,
        lastUserChars: lastUserText.length,
        messageCount: uiMessages.length,
      },
      "chat request"
    );

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
      model: togetherLlm(model),
      system,
      messages: core,
      maxSteps: config.maxToolRounds,
      tools: Object.keys(mcpTools).length ? mcpTools : undefined,
      onFinish: async ({ text }) => {
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

const httpServer = createServer(app);
attachVoiceWebSocket(httpServer);

httpServer.on("error", (err) => {
  logger.fatal({ err }, "HTTP server failed to bind or accept");
  process.exit(1);
});

httpServer.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      webOrigin: config.webOrigin,
      logFile: config.logFile || null,
      logPretty: config.logPretty,
      voice: {
        voskConfigured: Boolean(config.voskModelPath),
        piperConfigured: Boolean(config.piperExecutable && config.piperModelPath),
      },
    },
    "HTTP server listening"
  );
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, closing");
  await disconnectAllMcp();
  httpServer.close();
  process.exit(0);
});
