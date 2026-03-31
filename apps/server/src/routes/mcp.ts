import { Router } from "express";
import { z } from "zod";
import { listMcpServers, upsertMcpServer, deleteMcpServer, type McpServerRecord } from "../store.js";
import { testMcpServer, disconnectMcp } from "../mcpRuntime.js";

const router = Router();

const McpUpsert = z.object({
  id: z.string().optional(),
  name: z.string(),
  enabled: z.boolean(),
  transport: z.enum(["http", "stdio"]),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

router.get("/servers", async (_req, res) => {
  try {
    const servers = await listMcpServers();
    res.json({ servers });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/servers", async (req, res) => {
  const p = McpUpsert.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const row = await upsertMcpServer(p.data as Omit<McpServerRecord, "id"> & { id?: string });
  res.json(row);
});

router.delete("/servers/:id", async (req, res) => {
  const id = req.params.id!;
  const ok = await deleteMcpServer(id);
  await disconnectMcp(id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

router.post("/servers/:id/test", async (req, res) => {
  const servers = await listMcpServers();
  const s = servers.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  try {
    const r = await testMcpServer(s);
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
