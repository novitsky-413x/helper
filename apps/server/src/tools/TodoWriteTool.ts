import { z } from "zod";
import { buildTool } from "./buildTool.js";
import { getDb } from "../db.js";
import { getIO } from "../socketServer.js";
import { logger } from "../logger.js";

const TodoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
});

export const TodoWriteTool = buildTool({
  name: "todo_write",
  description:
    "Create and manage a structured task list for the current session. " +
    "Use for complex multi-step tasks. Provide an array of todos with id, content, and status.",
  inputSchema: z.object({
    todos: z.array(TodoItemSchema).min(1),
    merge: z.boolean().optional().default(false),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,

  async call(input, context) {
    const db = getDb();
    const now = new Date().toISOString();
    const sessionId = context.agentSessionId ?? "default";

    const upsert = db.prepare(`
      INSERT INTO agent_tasks (id, profileId, sessionId, title, status, priority, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        updatedAt = excluded.updatedAt
    `);

    const upsertMany = db.transaction((todos: z.infer<typeof TodoItemSchema>[]) => {
      for (let i = 0; i < todos.length; i++) {
        const t = todos[i]!;
        upsert.run(
          t.id,
          context.profileId ?? null,
          sessionId,
          t.content,
          t.status,
          i,
          now,
          now,
        );
      }
    });

    try {
      upsertMany(input.todos);

      const io = getIO();
      if (io) {
        for (const t of input.todos) {
          io.of("/agent").emit("agent:task-update", {
            id: t.id,
            profileId: context.profileId,
            sessionId,
            title: t.content,
            status: t.status,
            priority: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      logger.info(
        { count: input.todos.length, sessionId },
        "todo_write: tasks updated",
      );
      return `Updated ${input.todos.length} task(s).`;
    } catch (e) {
      logger.error({ err: e }, "todo_write failed");
      return `Failed to update tasks: ${String(e)}`;
    }
  },
});
