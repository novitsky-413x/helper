import { logger } from "./logger.js";
import { closeDb, getDb } from "./db.js";

type ShutdownTask = { name: string; fn: () => void | Promise<void> };
const shutdownTasks: ShutdownTask[] = [];
let _shuttingDown = false;

export function isShuttingDown(): boolean {
  return _shuttingDown;
}

export function registerShutdownTask(name: string, fn: () => void | Promise<void>) {
  shutdownTasks.push({ name, fn });
}

export function runStartupRecovery() {
  const db = getDb();
  try {
    db.exec(`DELETE FROM consolidation_lock WHERE id = 1`);
    db.exec(`INSERT OR IGNORE INTO consolidation_lock (id) VALUES (1)`);
  } catch { /* table may not exist yet */ }

  try {
    const stmts = [
      `UPDATE dream_sessions SET status = 'interrupted', endedAt = datetime('now') WHERE status = 'running'`,
      `UPDATE agent_sessions SET status = 'interrupted', endedAt = datetime('now') WHERE status = 'running'`,
      `UPDATE agent_tasks SET status = 'pending', updatedAt = datetime('now') WHERE status = 'in_progress'`,
    ];
    for (const sql of stmts) {
      const result = db.prepare(sql).run();
      if (result.changes > 0) {
        logger.info({ sql: sql.slice(0, 60), changes: result.changes }, "startup recovery");
      }
    }
  } catch (e) {
    logger.warn({ err: e }, "startup recovery queries failed (tables may not exist yet)");
  }

  logger.info("startup recovery completed");
}

export function registerShutdownHooks(
  httpServer: import("node:http").Server,
  extras?: {
    persistVectorStore?: () => Promise<void>;
    disconnectAllMcp?: () => Promise<void>;
    socketIoClose?: () => void;
  },
) {
  async function shutdown(reason: string, exitCode = 0) {
    if (_shuttingDown) return;
    _shuttingDown = true;
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

      for (const task of shutdownTasks) {
        try {
          await task.fn();
        } catch (e) {
          logger.warn({ err: e, task: task.name }, "shutdown task failed");
        }
      }

      if (extras?.persistVectorStore) {
        await extras.persistVectorStore();
      }
      if (extras?.disconnectAllMcp) {
        await extras.disconnectAllMcp();
      }
      if (extras?.socketIoClose) {
        extras.socketIoClose();
      }

      closeDb();

      logger.info({ reason }, "shutdown completed");
      clearTimeout(forceTimer);
      process.exit(exitCode);
    } catch (e) {
      logger.error({ err: e, reason }, "shutdown failed");
      clearTimeout(forceTimer);
      process.exit(1);
    }
  }

  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  if (process.platform !== "win32") {
    process.on("SIGHUP", () => void shutdown("SIGHUP", 0));
  }
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled rejection");
    void shutdown("unhandledRejection", 1);
  });
}
