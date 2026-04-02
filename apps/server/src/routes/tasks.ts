import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.js";

const router = Router();

router.get("/", (req, res) => {
  const profileId = String(req.query.profileId ?? "");
  const sessionId = String(req.query.sessionId ?? "");
  const db = getDb();

  let sql = "SELECT * FROM agent_tasks";
  const conditions: string[] = [];
  const params: any[] = [];

  if (profileId) { conditions.push("profileId = ?"); params.push(profileId); }
  if (sessionId) { conditions.push("sessionId = ?"); params.push(sessionId); }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY priority ASC, updatedAt DESC LIMIT 200";

  const rows = db.prepare(sql).all(...params);
  res.json({ tasks: rows });
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
