import { getDb } from "../../db.js";
import { logger } from "../../logger.js";

const STALE_THRESHOLD_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function tryAcquireLock(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT * FROM consolidation_lock WHERE id = 1").get() as any;

  if (row?.lockedAt) {
    const heartbeat = row.heartbeatAt ? new Date(row.heartbeatAt).getTime() : 0;
    const age = Date.now() - heartbeat;
    const pidAlive = row.pid ? isPidAlive(row.pid) : false;

    if (age < STALE_THRESHOLD_MS && pidAlive) {
      logger.debug({ pid: row.pid, ageMs: age }, "autoDream lock busy");
      return false;
    }
    logger.info({ stalePid: row.pid, ageMs: age, pidAlive }, "autoDream reclaiming stale lock");
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE consolidation_lock SET lockedAt = ?, heartbeatAt = ?, pid = ? WHERE id = 1"
  ).run(now, now, process.pid);

  startHeartbeat();
  return true;
}

export function releaseLock() {
  stopHeartbeat();
  try {
    const db = getDb();
    db.prepare("UPDATE consolidation_lock SET lockedAt = NULL, heartbeatAt = NULL, pid = NULL WHERE id = 1").run();
  } catch { /* db may be closing */ }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    try {
      const db = getDb();
      db.prepare("UPDATE consolidation_lock SET heartbeatAt = ? WHERE id = 1").run(new Date().toISOString());
    } catch { /* ignore */ }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
