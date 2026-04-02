import { getDb } from "../../db.js";
import { logger } from "../../logger.js";
import { getIO } from "../../socketServer.js";
import { registerShutdownTask } from "../../lifecycle.js";
import { tryAcquireLock, releaseLock } from "./consolidationLock.js";
import { runDreamConsolidation } from "./dreamRunner.js";

const DREAM_MIN_INTERVAL_MS = (Number(process.env.DREAM_MIN_INTERVAL_HOURS) || 6) * 60 * 60 * 1000;
const DREAM_MIN_SESSIONS = Number(process.env.DREAM_MIN_SESSIONS) || 3;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let checkTimer: ReturnType<typeof setInterval> | null = null;

function shouldTriggerDream(profileId: string): boolean {
  const db = getDb();

  const lastDream = db.prepare(
    "SELECT endedAt FROM dream_sessions WHERE profileId = ? AND status = 'completed' ORDER BY endedAt DESC LIMIT 1"
  ).get(profileId) as any;

  if (lastDream?.endedAt) {
    const elapsed = Date.now() - new Date(lastDream.endedAt).getTime();
    if (elapsed < DREAM_MIN_INTERVAL_MS) return false;
  }

  const sinceDate = lastDream?.endedAt ?? "2000-01-01T00:00:00.000Z";
  const sessionsCount = db.prepare(
    "SELECT COUNT(*) as count FROM agent_sessions WHERE profileId = ? AND status = 'completed' AND endedAt > ?"
  ).get(profileId, sinceDate) as any;

  return (sessionsCount?.count ?? 0) >= DREAM_MIN_SESSIONS;
}

async function checkAndRunDream() {
  const db = getDb();
  const profiles = db.prepare(
    "SELECT DISTINCT profileId FROM agent_sessions WHERE profileId IS NOT NULL"
  ).all() as any[];

  for (const row of profiles) {
    if (!row.profileId) continue;
    if (!shouldTriggerDream(row.profileId)) continue;

    if (!tryAcquireLock()) {
      logger.debug("autoDream: lock busy, skipping");
      return;
    }

    try {
      const io = getIO();
      io?.of("/agent").emit("dream:status", { status: "running" });

      const result = await runDreamConsolidation(row.profileId, "auto");

      io?.of("/agent").emit("dream:status", { status: "completed", stats: result.stats });
      io?.of("/agent").emit("notification", {
        id: `dream-${result.sessionId}`,
        type: "success",
        title: "Memory Consolidated",
        body: `+${result.stats.created} created, ${result.stats.merged} merged, ${result.stats.deleted} removed`,
        ttl: 10000,
        createdAt: Date.now(),
      });
    } catch (e) {
      logger.error({ err: e, profileId: row.profileId }, "autoDream auto-run failed");
      getIO()?.of("/agent").emit("dream:status", { status: "error" });
    } finally {
      releaseLock();
    }

    break;
  }
}

export function initAutoDream() {
  checkTimer = setInterval(() => {
    void checkAndRunDream().catch((e) =>
      logger.error({ err: e }, "autoDream periodic check failed")
    );
  }, CHECK_INTERVAL_MS);
  checkTimer.unref();
  logger.info({ intervalMs: CHECK_INTERVAL_MS }, "autoDream initialized");
}

export async function executeAutoDream(
  profileId: string,
  triggeredBy: "manual" | "auto" | "autopilot" = "manual",
) {
  if (!tryAcquireLock()) {
    throw new Error("autoDream is already running");
  }

  try {
    getIO()?.of("/agent").emit("dream:status", { status: "running" });
    const result = await runDreamConsolidation(profileId, triggeredBy);
    getIO()?.of("/agent").emit("dream:status", { status: "completed", stats: result.stats });
    return result;
  } catch (e) {
    getIO()?.of("/agent").emit("dream:status", { status: "error" });
    throw e;
  } finally {
    releaseLock();
  }
}

export function stopAutoDream() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  releaseLock();
}

registerShutdownTask("autoDream:stop", stopAutoDream);
