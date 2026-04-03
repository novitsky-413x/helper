import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.js";
import { logger } from "../logger.js";

const router = Router();

/** Todos left `in_progress` when the agent run ended without another todo_write — clear for list accuracy. */
function reconcileStaleInProgressTasks(db: ReturnType<typeof getDb>) {
  try {
    const r = db
      .prepare(
        `UPDATE agent_tasks SET status = 'pending', updatedAt = datetime('now')
         WHERE status = 'in_progress'
           AND sessionId IN (
             SELECT id FROM agent_sessions
             WHERE status IN ('completed','interrupted','error','max_turns')
           )`,
      )
      .run();
    if (r.changes > 0) {
      logger.info({ changes: r.changes }, "reconciled orphan in_progress agent_tasks");
    }
  } catch (e) {
    logger.warn({ err: e }, "reconcileStaleInProgressTasks failed");
  }
}

type AgentTaskRow = {
  id: string;
  title: string;
  updatedAt: string;
  status?: string;
  priority?: number | null;
  [key: string]: unknown;
};

/** Tie-break when `updatedAt` is equal: more actionable status wins. */
function taskStatusDedupeRank(status: unknown): number {
  switch (String(status ?? "")) {
    case "in_progress":
      return 0;
    case "pending":
      return 1;
    case "completed":
      return 2;
    case "cancelled":
      return 3;
    default:
      return 9;
  }
}

function pickTaskRowForDedupe(prev: AgentTaskRow, row: AgentTaskRow): AgentTaskRow {
  const a = String(row.updatedAt ?? "");
  const b = String(prev.updatedAt ?? "");
  if (a > b) return row;
  if (a < b) return prev;
  const rp = taskStatusDedupeRank(prev.status);
  const rr = taskStatusDedupeRank(row.status);
  if (rr !== rp) return rr < rp ? row : prev;
  return row.id > prev.id ? row : prev;
}

/**
 * Same todo text often appears twice with different ids (reconciler cancelled one row; model wrote a fresh pending).
 * One row per trimmed title: newest `updatedAt` wins; on ties prefer in_progress → … → cancelled.
 */
function dedupeTasksByTitle(rows: AgentTaskRow[]): AgentTaskRow[] {
  const byKey = new Map<string, AgentTaskRow>();
  for (const row of rows) {
    const raw = typeof row.title === "string" ? row.title.trim().replace(/\s+/g, " ") : "";
    const key = raw.length > 0 ? raw : row.id;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, pickTaskRowForDedupe(prev, row));
  }
  const out = Array.from(byKey.values());
  out.sort((x, y) => {
    const px = Number(x.priority ?? 0);
    const py = Number(y.priority ?? 0);
    if (px !== py) return px - py;
    return String(y.updatedAt ?? "").localeCompare(String(x.updatedAt ?? ""));
  });
  return out;
}

router.get("/", (req, res) => {
  const profileId = String(req.query.profileId ?? "");
  const sessionId = String(req.query.sessionId ?? "");
  const db = getDb();

  reconcileStaleInProgressTasks(db);

  let sql = "SELECT * FROM agent_tasks";
  const conditions: string[] = [];
  const params: any[] = [];

  if (profileId) { conditions.push("profileId = ?"); params.push(profileId); }
  if (sessionId) { conditions.push("sessionId = ?"); params.push(sessionId); }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY priority ASC, updatedAt DESC LIMIT 200";

  const rows = db.prepare(sql).all(...params) as AgentTaskRow[];
  const tasks = dedupeTasksByTitle(rows);
  res.json({ tasks });
});

const UpdateBody = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
  result: z.string().optional(),
});

router.patch("/:id", (req, res) => {
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = getDb();
  const now = new Date().toISOString();
  const sets: string[] = ["updatedAt = ?"];
  const vals: any[] = [now];

  if (parsed.data.title !== undefined) { sets.push("title = ?"); vals.push(parsed.data.title); }
  if (parsed.data.description !== undefined) { sets.push("description = ?"); vals.push(parsed.data.description); }
  if (parsed.data.status !== undefined) { sets.push("status = ?"); vals.push(parsed.data.status); }
  if (parsed.data.result !== undefined) { sets.push("result = ?"); vals.push(parsed.data.result); }

  vals.push(req.params.id);
  const result = db.prepare(`UPDATE agent_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  if (result.changes === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM agent_tasks WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
