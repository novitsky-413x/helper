import express from "express";
import cors from "cors";
import path from "node:path";
import { existsSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { pinoHttp } from "pino-http";
import { refreshModelCatalog } from "./modelCatalog.js";
import { runStartupHealthCheck } from "./modelHealth.js";
import { disconnectAllMcp } from "./mcpRuntime.js";
import { persistVectorStore, restoreVectorStore } from "./mem0Service.js";

import chatRouter from "./routes/chat.js";
import profilesRouter from "./routes/profiles.js";
import memoryRouter from "./routes/memory.js";
import mcpRouter from "./routes/mcp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(
  cors({
    origin: config.webOrigin,
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", chatRouter);
app.use("/api/profiles", profilesRouter);
app.use("/api/memory", memoryRouter);
app.use("/api/mcp", mcpRouter);

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
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      (httpServer as any).closeIdleConnections?.();
      (httpServer as any).closeAllConnections?.();
    });
    await persistVectorStore();
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
