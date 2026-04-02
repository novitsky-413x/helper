import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.js";
import { getAutopilotMode, setAutopilotMode } from "../services/autopilot/index.js";
import { randomUUID } from "node:crypto";

const router = Router();

router.get("/status", (_req, res) => {
  res.json({ mode: getAutopilotMode() });
});

router.post("/mode", (req, res) => {
  const parsed = z.object({ mode: z.enum(["passive", "advisory", "autonomous"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  setAutopilotMode(parsed.data.mode);
  res.json({ ok: true, mode: parsed.data.mode });
});

router.get("/observations", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const db = getDb();
  const rows = db.prepare("SELECT * FROM autopilot_observations ORDER BY createdAt DESC LIMIT ?").all(limit);
  res.json({ observations: rows });
});

router.get("/scheduled", (req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM autopilot_scheduled_tasks ORDER BY nextRunAt ASC").all();
  res.json({ tasks: rows });
});

const ScheduleBody = z.object({
  profileId: z.string().optional(),
  description: z.string().min(1),
  taskType: z.string().optional(),
  cronExpr: z.string().optional(),
  nextRunAt: z.string().optional(),
});

router.post("/scheduled", (req, res) => {
  const parsed = ScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO autopilot_scheduled_tasks (id, profileId, cronExpr, description, taskType, nextRunAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, parsed.data.profileId ?? null, parsed.data.cronExpr ?? null, parsed.data.description, parsed.data.taskType ?? "reminder", parsed.data.nextRunAt ?? null, now);
  res.status(201).json({ id });
});

router.delete("/scheduled/:id", (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM autopilot_scheduled_tasks WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ok: true });
});

export default router;
