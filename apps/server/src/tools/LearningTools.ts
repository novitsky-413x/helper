import { z } from "zod";
import { generateText } from "ai";
import { randomUUID } from "node:crypto";
import { buildTool } from "./buildTool.js";
import { togetherLlm } from "../pipeline/chatHelpers.js";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { logger } from "../logger.js";

export const CreateLearningPlanTool = buildTool({
  name: "create_learning_plan",
  description: "Create a structured learning plan for a given topic. Generates a syllabus with lessons.",
  inputSchema: z.object({
    topic: z.string().min(1),
    depth: z.enum(["beginner", "intermediate", "advanced"]).optional().default("intermediate"),
    lessonsCount: z.number().int().min(3).max(20).optional().default(8),
  }),
  isReadOnly: false,

  async call(input, context) {
    if (!context.profileId) return "No profile active. Select a profile first.";

    try {
      const result = await generateText({
        model: togetherLlm(config.togetherMemoryModel),
        temperature: 0.3,
        maxTokens: 2000,
        prompt: `Create a learning plan for "${input.topic}" at ${input.depth} level with ${input.lessonsCount} lessons.
Return JSON: {"title": "...", "subject": "...", "lessons": [{"title": "...", "description": "...", "objectives": ["..."]}]}
Return ONLY JSON.`,
      });

      let plan: any;
      try {
        const cleaned = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        plan = JSON.parse(cleaned);
      } catch {
        return "Failed to generate learning plan. Try again.";
      }

      const db = getDb();
      const planId = randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        "INSERT INTO learning_plans (id, profileId, title, subject, syllabus, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
      ).run(planId, context.profileId, plan.title ?? input.topic, plan.subject ?? input.topic, JSON.stringify(plan.lessons ?? []), now, now);

      const lessons = plan.lessons ?? [];
      for (let i = 0; i < lessons.length; i++) {
        db.prepare(
          "INSERT INTO learning_progress (id, planId, lessonIdx, status) VALUES (?, ?, ?, 'not_started')"
        ).run(randomUUID(), planId, i);
      }

      return `Learning plan created: "${plan.title}" with ${lessons.length} lessons. Plan ID: ${planId}`;
    } catch (e: any) {
      logger.warn({ err: e }, "create_learning_plan failed");
      return `Failed to create learning plan: ${e.message}`;
    }
  },
});

export const GenerateLessonTool = buildTool({
  name: "generate_lesson",
  description: "Generate a detailed lesson/article on a topic from a learning plan.",
  inputSchema: z.object({
    planId: z.string().min(1),
    lessonIdx: z.number().int().min(0),
  }),
  isReadOnly: false,

  async call(input) {
    const db = getDb();
    const plan = db.prepare("SELECT * FROM learning_plans WHERE id = ?").get(input.planId) as any;
    if (!plan) return "Learning plan not found.";

    let lessons: any[];
    try { lessons = JSON.parse(plan.syllabus); } catch { return "Invalid syllabus data."; }
    if (input.lessonIdx >= lessons.length) return "Lesson index out of range.";

    const lesson = lessons[input.lessonIdx];
    try {
      const result = await generateText({
        model: togetherLlm(config.togetherMemoryModel),
        temperature: 0.3,
        maxTokens: 3000,
        prompt: `Write a comprehensive lesson article on: "${lesson.title}"
Plan: ${plan.title}
Description: ${lesson.description ?? ""}
Objectives: ${JSON.stringify(lesson.objectives ?? [])}

Write in educational style with examples, key concepts, and a summary. Use markdown formatting.`,
      });

      db.prepare(
        "UPDATE learning_progress SET status = 'in_progress', lastAttemptAt = ? WHERE planId = ? AND lessonIdx = ?"
      ).run(new Date().toISOString(), input.planId, input.lessonIdx);

      return result.text || "Failed to generate lesson content.";
    } catch (e: any) {
      return `Lesson generation failed: ${e.message}`;
    }
  },
});

export const QuizTool = buildTool({
  name: "quiz",
  description: "Generate a quiz to test knowledge on a lesson topic, or evaluate quiz answers.",
  inputSchema: z.object({
    action: z.enum(["generate", "evaluate"]),
    planId: z.string().optional(),
    lessonIdx: z.number().optional(),
    topic: z.string().optional(),
    questions: z.number().optional().default(5),
    answers: z.array(z.object({ questionIdx: z.number(), answer: z.string() })).optional(),
  }),
  isReadOnly: false,

  async call(input) {
    if (input.action === "generate") {
      const topic = input.topic ?? "general knowledge";
      try {
        const result = await generateText({
          model: togetherLlm(config.togetherMemoryModel),
          temperature: 0.3,
          maxTokens: 2000,
          prompt: `Create a quiz with ${input.questions} questions about "${topic}".
Return JSON: {"questions": [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correct": "A"}]}
Return ONLY JSON.`,
        });
        return result.text;
      } catch (e: any) {
        return `Quiz generation failed: ${e.message}`;
      }
    }

    if (input.action === "evaluate" && input.answers) {
      const score = input.answers.length;
      if (input.planId !== undefined && input.lessonIdx !== undefined) {
        const db = getDb();
        db.prepare(
          `UPDATE learning_progress SET
            status = 'completed',
            score = ?,
            attempts = attempts + 1,
            lastAttemptAt = ?
          WHERE planId = ? AND lessonIdx = ?`
        ).run(score / Math.max(input.questions ?? 5, 1) * 100, new Date().toISOString(), input.planId, input.lessonIdx);
      }
      return `Quiz evaluated. Score: ${score}/${input.questions ?? 5}`;
    }

    return "Invalid quiz action.";
  },
});

export const WikiTool = buildTool({
  name: "wiki",
  description: "Manage the knowledge base (wiki). Create, update, search, or read articles.",
  inputSchema: z.object({
    action: z.enum(["create", "update", "search", "read", "list"]),
    id: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    query: z.string().optional(),
  }),
  isReadOnly: false,

  async call(input, context) {
    const db = getDb();
    const profileId = context.profileId ?? "";

    switch (input.action) {
      case "create": {
        if (!input.title || !input.content) return "Title and content required.";
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          "INSERT INTO wiki_articles (id, profileId, title, content, tags, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(id, profileId, input.title, input.content, JSON.stringify(input.tags ?? []), now, now);
        return `Wiki article created: "${input.title}" (id: ${id})`;
      }
      case "update": {
        if (!input.id) return "Article ID required for update.";
        const sets: string[] = ["updatedAt = ?"];
        const vals: any[] = [new Date().toISOString()];
        if (input.title) { sets.push("title = ?"); vals.push(input.title); }
        if (input.content) { sets.push("content = ?"); vals.push(input.content); }
        if (input.tags) { sets.push("tags = ?"); vals.push(JSON.stringify(input.tags)); }
        vals.push(input.id);
        db.prepare(`UPDATE wiki_articles SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
        return `Wiki article updated.`;
      }
      case "search": {
        const q = input.query ?? input.title ?? "";
        const rows = db.prepare(
          "SELECT id, title, tags FROM wiki_articles WHERE profileId = ? AND (title LIKE ? OR content LIKE ?) ORDER BY updatedAt DESC LIMIT 20"
        ).all(profileId, `%${q}%`, `%${q}%`) as any[];
        if (rows.length === 0) return `No articles found for "${q}".`;
        return rows.map((r: any) => `- ${r.title} (${r.id.slice(0, 8)})`).join("\n");
      }
      case "read": {
        if (!input.id) return "Article ID required.";
        const article = db.prepare("SELECT * FROM wiki_articles WHERE id = ?").get(input.id) as any;
        if (!article) return "Article not found.";
        return `# ${article.title}\n\n${article.content}`;
      }
      case "list": {
        const rows = db.prepare(
          "SELECT id, title, updatedAt FROM wiki_articles WHERE profileId = ? ORDER BY updatedAt DESC LIMIT 50"
        ).all(profileId) as any[];
        if (rows.length === 0) return "No wiki articles yet.";
        return rows.map((r: any) => `- ${r.title} (${r.id.slice(0, 8)}, updated ${r.updatedAt})`).join("\n");
      }
      default:
        return "Unknown wiki action.";
    }
  },
});

export const ProgressTrackTool = buildTool({
  name: "track_progress",
  description: "View learning progress across all plans or a specific plan.",
  inputSchema: z.object({
    planId: z.string().optional(),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,

  async call(input, context) {
    const db = getDb();
    const profileId = context.profileId ?? "";

    if (input.planId) {
      const plan = db.prepare("SELECT * FROM learning_plans WHERE id = ?").get(input.planId) as any;
      if (!plan) return "Plan not found.";
      const progress = db.prepare(
        "SELECT * FROM learning_progress WHERE planId = ? ORDER BY lessonIdx ASC"
      ).all(input.planId) as any[];

      const total = progress.length;
      const completed = progress.filter((p: any) => p.status === "completed").length;
      const avgScore = progress.filter((p: any) => p.score != null).reduce((s: number, p: any) => s + p.score, 0) / Math.max(completed, 1);

      const lines = progress.map((p: any) => {
        const icon = p.status === "completed" ? "✅" : p.status === "in_progress" ? "📖" : "⬜";
        const score = p.score != null ? ` (${p.score.toFixed(0)}%)` : "";
        return `${icon} Lesson ${p.lessonIdx + 1}${score}`;
      });

      return `## ${plan.title}\nProgress: ${completed}/${total} (${((completed/total)*100).toFixed(0)}%)\nAvg Score: ${avgScore.toFixed(0)}%\n\n${lines.join("\n")}`;
    }

    const plans = db.prepare(
      "SELECT * FROM learning_plans WHERE profileId = ? ORDER BY updatedAt DESC"
    ).all(profileId) as any[];
    if (plans.length === 0) return "No learning plans yet. Use /learn <topic> to start.";

    return plans.map((p: any) => {
      const progress = db.prepare(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as done FROM learning_progress WHERE planId = ?"
      ).get(p.id) as any;
      const pct = progress.total > 0 ? ((progress.done / progress.total) * 100).toFixed(0) : "0";
      return `- ${p.title} [${p.status}] ${progress.done}/${progress.total} (${pct}%)`;
    }).join("\n");
  },
});
