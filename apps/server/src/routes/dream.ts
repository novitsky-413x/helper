import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.js";
import { executeAutoDream } from "../services/autoDream/index.js";
import { logger } from "../logger.js";

const router = Router();

router.get("/history", (req, res) => {
  const profileId = String(req.query.profileId ?? "");
  const db = getDb();
  const sql = profileId
    ? "SELECT * FROM dream_sessions WHERE profileId = ? ORDER BY startedAt DESC LIMIT 20"
    : "SELECT * FROM dream_sessions ORDER BY startedAt DESC LIMIT 20";
  const rows = profileId ? db.prepare(sql).all(profileId) : db.prepare(sql).all();
  res.json({ sessions: rows });
});

const TriggerBody = z.object({
  profileId: z.string().min(1),
});

router.post("/trigger", async (req, res) => {
  const parsed = TriggerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await executeAutoDream(parsed.data.profileId, "manual");
    res.json({ ok: true, sessionId: result.sessionId, stats: result.stats });
  } catch (e: any) {
    logger.error({ err: e }, "dream trigger failed");
    res.status(409).json({ error: e.message || "autoDream failed" });
  }
});

export default router;
