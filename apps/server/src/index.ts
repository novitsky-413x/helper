import express from "express";
import cors from "cors";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { config, corsOrigin } from "./config.js";
import { logger } from "./logger.js";
import { pinoHttp } from "pino-http";
import { refreshModelCatalog } from "./modelCatalog.js";
import { runStartupHealthCheck } from "./modelHealth.js";
import { disconnectAllMcp } from "./mcpRuntime.js";
import { persistVectorStore, restoreVectorStore } from "./mem0Service.js";
import { getDb } from "./db.js";
import { registerShutdownHooks, runStartupRecovery, isShuttingDown } from "./lifecycle.js";
import { initSocketServer, closeSocketServer } from "./socketServer.js";
import { initAutoDream } from "./services/autoDream/index.js";
import { initAutopilot } from "./services/autopilot/index.js";
import { restoreUsageFromDb } from "./pipeline/chatHelpers.js";

import chatRouter from "./routes/chat.js";
import profilesRouter from "./routes/profiles.js";
import memoryRouter from "./routes/memory.js";
import mcpRouter from "./routes/mcp.js";
import chatSessionsRouter from "./routes/chatSessions.js";
import tasksRouter from "./routes/tasks.js";
import dreamRouter from "./routes/dream.js";
import autopilotRouter from "./routes/autopilot.js";
import learningRouter from "./routes/learning.js";
import wikiRouter from "./routes/wiki.js";
import modelEvalRouter from "./routes/modelEval.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Ensure agent workspace dir exists ---
if (!existsSync(config.agentWorkspace)) {
  mkdirSync(config.agentWorkspace, { recursive: true });
}

// --- SQLite init + startup recovery (before HTTP) ---
getDb();
runStartupRecovery();
restoreUsageFromDb();

const app = express();
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
    exposedHeaders: ["x-helper-resolved-model", "x-helper-base-model"],
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

app.use((_req, res, next) => {
  if (isShuttingDown()) {
    res.status(503).json({ error: "Server is shutting down" });
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, shutting_down: isShuttingDown() });
});

app.use("/api", chatRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/memory", memoryRouter);
app.use("/api/mcp", mcpRouter);
app.use("/api/chat-sessions", chatSessionsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/dream", dreamRouter);
app.use("/api/autopilot", autopilotRouter);
app.use("/api/learning", learningRouter);
app.use("/api/wiki", wikiRouter);
app.use("/api/model-eval", modelEvalRouter);

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

async function bootstrapRuntime() {
  if (!config.togetherApiKey) return;
  try {
    const catalog = await refreshModelCatalog();
    logger.info(
      {
        models: catalog.models.length,
        chatModels: catalog.chatModels.length,
        baseModel: config.togetherBaseModel,
      },
      "model catalog refreshed at startup"
    );
    void runStartupHealthCheck(catalog.defaults);
  } catch (e) {
    logger.warn({ err: e }, "model catalog startup refresh failed");
  }
  try {
    await restoreVectorStore();
  } catch (e) {
    logger.warn({ err: e }, "vector store restore failed");
  }
}

void bootstrapRuntime();

const httpServer = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      webOrigin: config.webOrigin,
      logFile: config.logFile || null,
      logPretty: config.logPretty,
    },
    "HTTP server listening"
  );
});

// --- Socket.io ---
initSocketServer(httpServer);

// --- Lifecycle: shutdown hooks ---
registerShutdownHooks(httpServer, {
  persistVectorStore,
  disconnectAllMcp,
  socketIoClose: closeSocketServer,
});

// --- Background services ---
initAutoDream();
initAutopilot();

// --- Periodic Mem0 vector snapshot (every 5 min) ---
const vectorSnapshotInterval = setInterval(() => {
  void persistVectorStore().catch((e) =>
    logger.warn({ err: e }, "periodic vector snapshot failed")
  );
}, 5 * 60 * 1000);
vectorSnapshotInterval.unref();
