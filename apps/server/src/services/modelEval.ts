import { generateText } from "ai";
import { togetherLlm } from "../pipeline/chatHelpers.js";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { logger } from "../logger.js";
import { randomUUID } from "node:crypto";

const EVAL_EVERY_N_SESSIONS = Number(process.env.EVAL_EVERY_N_SESSIONS) || 5;
let sessionsSinceLastEval = 0;

export async function maybeEvaluateSession(sessionId: string): Promise<void> {
  sessionsSinceLastEval++;
  if (sessionsSinceLastEval < EVAL_EVERY_N_SESSIONS) return;
  sessionsSinceLastEval = 0;
  void evaluateSession(sessionId).catch((e) =>
    logger.warn({ err: e, sessionId }, "model evaluation failed")
  );
}

async function evaluateSession(sessionId: string): Promise<void> {
  const db = getDb();
  const session = db.prepare("SELECT * FROM agent_sessions WHERE id = ?").get(sessionId) as any;
  if (!session || session.status !== "completed") return;

  const chatSession = db.prepare(
    "SELECT messages FROM chat_sessions WHERE id = ? LIMIT 1"
  ).get(sessionId) as any;

  let transcript = "";
  if (chatSession?.messages) {
    try {
      const msgs = JSON.parse(chatSession.messages) as any[];
      transcript = msgs
        .slice(-10)
        .map((m: any) => `[${m.role}]: ${String(m.content ?? "").slice(0, 300)}`)
        .join("\n");
    } catch { /* ignore */ }
  }

  if (!transcript) return;

  try {
    const result = await generateText({
      model: togetherLlm(config.togetherBaseModel),
      temperature: 0,
      maxTokens: 200,
      prompt: `Evaluate this conversation. Was the task solved? Rate quality 0-10.
Return JSON: {"quality": <number>, "solved": <boolean>, "notes": "<brief>"}

Transcript:
${transcript.slice(0, 3000)}`,
    });

    let quality = 5;
    try {
      const cleaned = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      quality = typeof parsed.quality === "number" ? Math.min(10, Math.max(0, parsed.quality)) : 5;
    } catch { /* use default */ }

    const modelId = session.resolvedModel ?? config.togetherBaseModel;

    db.prepare(
      `INSERT INTO model_evaluations (id, sessionId, modelId, taskType, qualityScore, tokensUsed, evaluatedAt)
       VALUES (?, ?, ?, 'general', ?, ?, ?)`
    ).run(randomUUID(), sessionId, modelId, quality, session.totalTokens ?? 0, new Date().toISOString());

    logger.info({ sessionId, modelId, quality }, "model evaluation recorded");
  } catch (e) {
    logger.warn({ err: e, sessionId }, "model evaluation failed");
  }
}

export function getModelRankings(limit = 20): Array<{ modelId: string; avgQuality: number; totalEvals: number; avgTokens: number }> {
  const db = getDb();
  return db.prepare(`
    SELECT modelId,
           AVG(qualityScore) as avgQuality,
           COUNT(*) as totalEvals,
           AVG(tokensUsed) as avgTokens
    FROM model_evaluations
    WHERE evaluatedAt > datetime('now', '-30 day')
    GROUP BY modelId
    ORDER BY avgQuality DESC
    LIMIT ?
  `).all(limit) as any[];
}
