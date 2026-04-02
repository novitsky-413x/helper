import { Router } from "express";
import { getDb } from "../db.js";

const router = Router();

router.get("/plans", (req, res) => {
  const profileId = String(req.query.profileId ?? "");
  if (!profileId) { res.status(400).json({ error: "profileId required" }); return; }
  const db = getDb();
  const rows = db.prepare("SELECT * FROM learning_plans WHERE profileId = ? ORDER BY updatedAt DESC").all(profileId);
  res.json({ plans: rows });
});

router.get("/plans/:id", (req, res) => {
  const db = getDb();
  const plan = db.prepare("SELECT * FROM learning_plans WHERE id = ?").get(req.params.id) as any;
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }
  try { plan.syllabus = JSON.parse(plan.syllabus); } catch { plan.syllabus = []; }
  res.json({ plan });
});

router.get("/progress/:planId", (req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM learning_progress WHERE planId = ? ORDER BY lessonIdx ASC").all(req.params.planId);
  res.json({ progress: rows });
});

export default router;
