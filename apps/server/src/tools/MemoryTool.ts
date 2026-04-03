import { z } from "zod";
import { buildTool } from "./buildTool.js";
import { logger } from "../logger.js";
import {
  memoryGetAll,
  memoryUpdate,
  memoryDelete,
  getMemoryInstance,
} from "../mem0Service.js";

export const MemoryTool = buildTool({
  name: "manage_memory",
  description:
    "Manage the user's long-term memory — add, update, delete, or list memory entries. " +
    "Use when the user asks to remember, forget, or change rules/preferences/facts.",
  inputSchema: z.object({
    action: z.enum(["list", "add", "update", "delete"]),
    text: z.string().optional(),
    memoryId: z.string().optional(),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,

  async call(input, context) {
    const userId = context.mem0UserId ?? context.profileId;
    if (!userId) return "No memory profile active.";

    try {
      if (input.action === "list") {
        const all = await memoryGetAll(userId, 50);
        if (all.length === 0) return "No memories stored yet.";
        return JSON.stringify(all.map((m) => ({ id: m.id, text: m.text })));
      }
      if (input.action === "add") {
        if (!input.text) return "Error: text is required for add.";
        const m = await getMemoryInstance();
        if (!m) return "Memory system unavailable.";
        await m.add([{ role: "user", content: input.text }], {
          userId,
          infer: false,
        });
        return `Memory added: "${input.text}"`;
      }
      if (input.action === "update") {
        if (!input.memoryId || !input.text)
          return "Error: memoryId and text are required for update.";
        await memoryUpdate(input.memoryId, input.text);
        return `Memory ${input.memoryId} updated to: "${input.text}"`;
      }
      if (input.action === "delete") {
        if (!input.memoryId)
          return "Error: memoryId is required for delete.";
        await memoryDelete(input.memoryId);
        return `Memory ${input.memoryId} deleted.`;
      }
      return "Unknown action.";
    } catch (e) {
      logger.warn({ err: e, action: input.action }, "manage_memory tool error");
      return `Memory operation failed: ${String(e)}`;
    }
  },
});
