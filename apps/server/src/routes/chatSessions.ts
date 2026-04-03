import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { logger } from "../logger.js";

const router = Router();

router.get("/", (req, res) => {
  const profileId = String(req.query.profileId ?? "");
  if (!profileId) {
    res.status(400).json({ error: "profileId required" });
    return;
  }
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, profileId, title, summary, createdAt, updatedAt FROM chat_sessions WHERE profileId = ? ORDER BY updatedAt DESC LIMIT 100"
    )
    .all(profileId);
  res.json({ sessions: rows });
});

router.get("/:id", (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  try {
    row.messages = JSON.parse(row.messages);
  } catch {
    row.messages = [];
  }
  res.json({ session: row });
});

const CreateBody = z.object({
  profileId: z.string().min(1),
  title: z.string().optional(),
});

router.post("/", (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO chat_sessions (id, profileId, title, messages, createdAt, updatedAt) VALUES (?, ?, ?, '[]', ?, ?)"
  ).run(id, parsed.data.profileId, parsed.data.title ?? "New Chat", now, now);
  res.status(201).json({
    session: { id, profileId: parsed.data.profileId, title: parsed.data.title ?? "New Chat", messages: [], createdAt: now, updatedAt: now },
  });
});

const UpdateBody = z.object({
  title: z.string().optional(),
  messages: z.array(z.unknown()).optional(),
  summary: z.string().optional(),
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
  if (parsed.data.messages !== undefined) { sets.push("messages = ?"); vals.push(JSON.stringify(parsed.data.messages)); }
  if (parsed.data.summary !== undefined) { sets.push("summary = ?"); vals.push(parsed.data.summary); }

  vals.push(req.params.id);
  const result = db.prepare(`UPDATE chat_sessions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  if (result.changes === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json({ ok: true });
});

const ImportBody = z.object({
  sessions: z.array(
    z.object({
      profileId: z.string(),
      title: z.string().optional(),
      messages: z.array(z.unknown()),
      createdAt: z.string().optional(),
    })
  ),
});

router.post("/import", (req, res) => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO chat_sessions (id, profileId, title, messages, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const migrationTitles = new Set(["Migrated Chat", "Перенесённый чат"]);
  /** One legacy import per profile — avoids stacking rows when the client retries with a renamed title. */
  const profileHasLegacyMigration = db.prepare(
    "SELECT 1 FROM chat_sessions WHERE profileId = ? AND title IN ('Migrated Chat', 'Перенесённый чат') LIMIT 1"
  );

  const importMany = db.transaction((sessions: typeof parsed.data.sessions) => {
    let count = 0;
    for (const s of sessions) {
      const title = s.title ?? "Imported Chat";
      if (migrationTitles.has(title) && profileHasLegacyMigration.get(s.profileId)) {
        continue;
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      insert.run(id, s.profileId, title, JSON.stringify(s.messages), s.createdAt ?? now, now);
      count++;
    }
    return count;
  });
  try {
    const count = importMany(parsed.data.sessions);
    res.json({ imported: count });
  } catch (e) {
    logger.error({ err: e }, "chat sessions import failed");
    res.status(500).json({ error: String(e) });
  }
});

export default router;
