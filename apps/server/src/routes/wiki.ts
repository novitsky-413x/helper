import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.js";
import { randomUUID } from "node:crypto";

const router = Router();

router.get("/", (req, res) => {
  const profileId = String(req.query.profileId ?? "");
  const q = String(req.query.q ?? "");
  const db = getDb();

  if (q) {
    const rows = db.prepare(
      "SELECT id, title, tags, verified, updatedAt FROM wiki_articles WHERE profileId = ? AND (title LIKE ? OR content LIKE ?) ORDER BY updatedAt DESC LIMIT 50"
    ).all(profileId, `%${q}%`, `%${q}%`);
    res.json({ articles: rows });
  } else {
    const rows = db.prepare(
      "SELECT id, title, tags, verified, updatedAt FROM wiki_articles WHERE profileId = ? ORDER BY updatedAt DESC LIMIT 100"
    ).all(profileId);
    res.json({ articles: rows });
  }
});

router.get("/:id", (req, res) => {
  const db = getDb();
  const article = db.prepare("SELECT * FROM wiki_articles WHERE id = ?").get(req.params.id) as any;
  if (!article) { res.status(404).json({ error: "Not found" }); return; }
  try { article.tags = JSON.parse(article.tags); } catch { article.tags = []; }
  res.json({ article });
});

const CreateBody = z.object({
  profileId: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  tags: z.array(z.string()).optional(),
});

router.post("/", (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO wiki_articles (id, profileId, title, content, tags, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, parsed.data.profileId, parsed.data.title, parsed.data.content, JSON.stringify(parsed.data.tags ?? []), now, now);
  res.status(201).json({ id });
});

const UpdateBody = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  verified: z.boolean().optional(),
});

router.patch("/:id", (req, res) => {
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const db = getDb();
  const now = new Date().toISOString();
  const sets: string[] = ["updatedAt = ?"];
  const vals: any[] = [now];
  if (parsed.data.title !== undefined) { sets.push("title = ?"); vals.push(parsed.data.title); }
  if (parsed.data.content !== undefined) { sets.push("content = ?"); vals.push(parsed.data.content); }
  if (parsed.data.tags !== undefined) { sets.push("tags = ?"); vals.push(JSON.stringify(parsed.data.tags)); }
  if (parsed.data.verified !== undefined) { sets.push("verified = ?"); vals.push(parsed.data.verified ? 1 : 0); }
  vals.push(req.params.id);
  db.prepare(`UPDATE wiki_articles SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM wiki_articles WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
