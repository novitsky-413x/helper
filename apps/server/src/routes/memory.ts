import { Router } from "express";
import { z } from "zod";
import {
  searchMemoryForUser,
  isMemoryAvailable,
  memoryGetAll,
  memoryUpdate,
  memoryDelete,
} from "../mem0Service.js";

const router = Router();

const MemoryQuery = z.object({
  userId: z.string(),
  q: z.string().optional(),
});

router.get("/", async (req, res) => {
  const p = MemoryQuery.safeParse(req.query);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (!isMemoryAvailable()) {
    return res.json({ results: [], unavailable: true });
  }
  try {
    if (p.data.q) {
      const results = await searchMemoryForUser(p.data.q, p.data.userId, 50);
      return res.json({ results });
    }
    const list = await memoryGetAll(p.data.userId, 120);
    const results = list.map((r) => ({
      id: r.id,
      memory: r.text,
      metadata: { createdAt: r.createdAt, updatedAt: r.updatedAt },
    }));
    return res.json({ results });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const MemoryUpdate = z.object({ text: z.string() });
router.patch("/:id", async (req, res) => {
  const p = MemoryUpdate.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  if (!isMemoryAvailable()) return res.status(503).json({ error: "Memory unavailable" });
  try {
    await memoryUpdate(req.params.id!, p.data.text);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/:id", async (req, res) => {
  if (!isMemoryAvailable()) return res.status(503).json({ error: "Memory unavailable" });
  try {
    await memoryDelete(req.params.id!);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
