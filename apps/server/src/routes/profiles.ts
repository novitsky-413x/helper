import { Router } from "express";
import { z } from "zod";
import { listProfiles, createProfile, updateProfile, deleteProfile, getProfileById } from "../store.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const profiles = await listProfiles();
    res.json({ profiles });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const ProfileCreate = z.object({ name: z.string() });
router.post("/", async (req, res) => {
  const p = ProfileCreate.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const profile = await createProfile(p.data.name);
  res.json(profile);
});

const ProfilePatch = z.object({
  name: z.string().optional(),
  avatarEmoji: z.string().optional(),
  personality: z.string().optional(),
  voiceStyle: z.string().optional(),
  systemPromptMode: z.enum(["replace", "append", "prepend"]).optional(),
  customSystemPrompt: z.string().optional(),
});
router.patch("/:id", async (req, res) => {
  const p = ProfilePatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, p.data);
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

const ProfileModelPrefsPatch = z.object({
  modelPreferences: z.object({
    categories: z.record(z.object({ order: z.array(z.string()) })).default({}),
    updatedAt: z.string().optional(),
  }),
});
router.patch("/:id/model-preferences", async (req, res) => {
  const p = ProfileModelPrefsPatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, {
    modelPreferences: {
      ...p.data.modelPreferences,
      updatedAt: p.data.modelPreferences.updatedAt ?? new Date().toISOString(),
    },
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

const ProfileMemoryPolicyPatch = z.object({
  topK: z.number().int().min(1).max(30).optional(),
  maxChars: z.number().int().min(200).max(12000).optional(),
  pinnedOnlyForSimple: z.boolean().optional(),
});
router.patch("/:id/memory-policy", async (req, res) => {
  const p = ProfileMemoryPolicyPatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, { memoryPolicy: p.data });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.get("/:id/memory-pins", async (req, res) => {
  const profile = await getProfileById(req.params.id!);
  if (!profile) return res.status(404).json({ error: "Not found" });
  res.json({ memoryPins: profile.memoryPins ?? [] });
});

const ProfileMemoryPinsPatch = z.object({ memoryPins: z.array(z.string()) });
router.patch("/:id/memory-pins", async (req, res) => {
  const p = ProfileMemoryPinsPatch.safeParse(req.body);
  if (!p.success) return res.status(400).json(p.error.flatten());
  const updated = await updateProfile(req.params.id!, { memoryPins: p.data.memoryPins });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const ok = await deleteProfile(req.params.id!);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

export default router;
