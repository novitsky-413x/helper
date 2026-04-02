import { generateText } from "ai";
import { togetherLlm } from "../../pipeline/chatHelpers.js";
import { config } from "../../config.js";
import { logger } from "../../logger.js";
import { getDb } from "../../db.js";
import {
  memoryGetAll,
  memoryUpdate,
  memoryDelete,
  getMemoryInstance,
} from "../../mem0Service.js";
import { buildConsolidationPrompt } from "./consolidationPrompt.js";
import { randomUUID } from "node:crypto";

interface ConsolidationResult {
  merge: Array<{ keepId: string; removeIds: string[]; newText: string }>;
  create: Array<{ text: string; category: string }>;
  delete: string[];
  stats: {
    totalAnalyzed: number;
    merged: number;
    created: number;
    deleted: number;
    unchanged: number;
  };
}

export async function runDreamConsolidation(
  userId: string,
  triggeredBy: "auto" | "manual" | "autopilot" = "auto",
): Promise<{ sessionId: string; stats: ConsolidationResult["stats"] }> {
  const db = getDb();
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO dream_sessions (id, profileId, triggeredBy, startedAt, status) VALUES (?, ?, ?, ?, 'running')"
  ).run(sessionId, userId, triggeredBy, now);

  try {
    const allMemories = await memoryGetAll(userId, 200);
    if (allMemories.length < 3) {
      db.prepare("UPDATE dream_sessions SET status = 'completed', endedAt = ?, memoriesProcessed = ? WHERE id = ?")
        .run(new Date().toISOString(), allMemories.length, sessionId);
      return { sessionId, stats: { totalAnalyzed: allMemories.length, merged: 0, created: 0, deleted: 0, unchanged: allMemories.length } };
    }

    const recentSessions = db.prepare(
      "SELECT id FROM agent_sessions WHERE profileId = ? AND status = 'completed' ORDER BY endedAt DESC LIMIT 5"
    ).all(userId) as any[];
    const sessionSummaries: string[] = [];
    for (const s of recentSessions) {
      const chatSession = db.prepare(
        "SELECT summary FROM chat_sessions WHERE id = ? AND summary IS NOT NULL"
      ).get(s.id) as any;
      if (chatSession?.summary) sessionSummaries.push(chatSession.summary);
    }

    const memories = allMemories.map((m: any) => ({ id: m.id, text: m.text ?? m.memory ?? "" }));
    const prompt = buildConsolidationPrompt(memories, sessionSummaries);

    db.prepare("UPDATE dream_sessions SET prompt = ? WHERE id = ?").run(prompt.slice(0, 10000), sessionId);

    const response = await generateText({
      model: togetherLlm(config.togetherMemoryModel),
      temperature: 0,
      maxTokens: 4000,
      prompt,
    });

    let result: ConsolidationResult;
    try {
      const cleaned = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(cleaned);
    } catch (e) {
      logger.warn({ text: response.text.slice(0, 500) }, "autoDream: failed to parse consolidation result");
      throw new Error("Failed to parse consolidation JSON");
    }

    let merged = 0;
    let created = 0;
    let deleted = 0;

    for (const merge of result.merge ?? []) {
      try {
        await memoryUpdate(merge.keepId, merge.newText);
        for (const removeId of merge.removeIds) {
          await memoryDelete(removeId);
        }
        merged++;
      } catch (e) {
        logger.warn({ err: e, keepId: merge.keepId }, "autoDream merge failed");
      }
    }

    const memInstance = await getMemoryInstance();
    for (const create of result.create ?? []) {
      try {
        if (memInstance) {
          await memInstance.add(
            [{ role: "user", content: create.text }],
            { userId, infer: false },
          );
          created++;
        }
      } catch (e) {
        logger.warn({ err: e, text: create.text.slice(0, 100) }, "autoDream create failed");
      }
    }

    for (const deleteId of result.delete ?? []) {
      try {
        await memoryDelete(deleteId);
        deleted++;
      } catch (e) {
        logger.warn({ err: e, deleteId }, "autoDream delete failed");
      }
    }

    const stats = {
      totalAnalyzed: memories.length,
      merged,
      created,
      deleted,
      unchanged: memories.length - merged - deleted,
    };

    db.prepare(
      `UPDATE dream_sessions SET
        status = 'completed', endedAt = ?, memoriesProcessed = ?,
        memoriesCreated = ?, memoriesPruned = ?, memoriesMerged = ?,
        result = ?
      WHERE id = ?`
    ).run(
      new Date().toISOString(),
      memories.length,
      created,
      deleted,
      merged,
      JSON.stringify(stats),
      sessionId,
    );

    logger.info({ sessionId, stats }, "autoDream consolidation completed");
    return { sessionId, stats };
  } catch (e) {
    logger.error({ err: e, sessionId }, "autoDream consolidation failed");
    db.prepare("UPDATE dream_sessions SET status = 'error', endedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), sessionId);
    throw e;
  }
}
