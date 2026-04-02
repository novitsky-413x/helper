import { getDb } from "../../db.js";
import { getIO } from "../../socketServer.js";
import { logger } from "../../logger.js";
import { randomUUID } from "node:crypto";
import type { AutopilotMode, AutopilotObservation } from "@helper/shared";

export async function runObservationCycle(mode: AutopilotMode) {
  const db = getDb();
  const now = new Date().toISOString();
  const io = getIO();

  const observations: AutopilotObservation[] = [];

  // 1. Check for stale tasks
  const staleTasks = db.prepare(
    "SELECT id, title FROM agent_tasks WHERE status = 'in_progress' AND updatedAt < datetime('now', '-1 hour')"
  ).all() as any[];
  if (staleTasks.length > 0) {
    observations.push({
      id: randomUUID(),
      type: "stale_tasks",
      data: JSON.stringify({ count: staleTasks.length, tasks: staleTasks.slice(0, 5) }),
      createdAt: now,
    });
  }

  // 2. Check learning progress
  const overdueLessons = db.prepare(
    "SELECT lp.id, lp.title, COUNT(*) as pending FROM learning_plans lp JOIN learning_progress lpr ON lpr.planId = lp.id WHERE lp.status = 'active' AND lpr.status = 'not_started' GROUP BY lp.id HAVING pending > 3"
  ).all() as any[];
  if (overdueLessons.length > 0) {
    observations.push({
      id: randomUUID(),
      type: "learning_overdue",
      data: JSON.stringify(overdueLessons),
      createdAt: now,
    });
  }

  // 3. Check scheduled tasks
  const dueTasks = db.prepare(
    "SELECT * FROM autopilot_scheduled_tasks WHERE enabled = 1 AND nextRunAt <= ? ORDER BY nextRunAt ASC LIMIT 10"
  ).all(now) as any[];
  for (const task of dueTasks) {
    observations.push({
      id: randomUUID(),
      type: "scheduled_task_due",
      data: JSON.stringify({ taskId: task.id, description: task.description }),
      createdAt: now,
    });
  }

  // 4. Check memory health
  const lastDream = db.prepare(
    "SELECT endedAt FROM dream_sessions WHERE status = 'completed' ORDER BY endedAt DESC LIMIT 1"
  ).get() as any;
  if (lastDream?.endedAt) {
    const daysSinceDream = (Date.now() - new Date(lastDream.endedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDream > 7) {
      observations.push({
        id: randomUUID(),
        type: "memory_stale",
        data: JSON.stringify({ daysSinceDream: Math.round(daysSinceDream) }),
        createdAt: now,
      });
    }
  }

  // Store observations
  const insert = db.prepare(
    "INSERT INTO autopilot_observations (id, type, data, createdAt) VALUES (?, ?, ?, ?)"
  );
  for (const obs of observations) {
    insert.run(obs.id, obs.type, obs.data, obs.createdAt);
    io?.of("/autopilot").emit("autopilot:observation", obs);
  }

  // In advisory mode, emit notifications
  if (mode === "advisory" && observations.length > 0) {
    for (const obs of observations) {
      io?.of("/agent").emit("notification", {
        id: obs.id,
        type: "autopilot",
        title: `Autopilot: ${obs.type.replace(/_/g, " ")}`,
        body: getObservationSummary(obs),
        ttl: 15000,
        createdAt: Date.now(),
      });
    }
  }

  // In autonomous mode, take action on scheduled tasks
  if (mode === "autonomous" && dueTasks.length > 0) {
    for (const task of dueTasks) {
      try {
        db.prepare("UPDATE autopilot_scheduled_tasks SET lastRunAt = ? WHERE id = ?").run(now, task.id);
        db.prepare(
          "UPDATE autopilot_observations SET actionTaken = 'executed_scheduled_task' WHERE id = ? AND type = 'scheduled_task_due'"
        ).run(observations.find((o) => o.type === "scheduled_task_due")?.id);

        io?.of("/autopilot").emit("autopilot:action", {
          observationId: task.id,
          action: "execute_scheduled",
          result: `Executed: ${task.description}`,
        });
      } catch (e) {
        logger.warn({ err: e, taskId: task.id }, "Autopilot autonomous task execution failed");
      }
    }
  }

  if (observations.length > 0) {
    logger.debug({ count: observations.length, mode }, "Autopilot observation cycle completed");
  }
}

function getObservationSummary(obs: AutopilotObservation): string {
  try {
    const data = obs.data ? JSON.parse(obs.data) : {};
    switch (obs.type) {
      case "stale_tasks": return `${data.count} task(s) have been in progress for over an hour`;
      case "learning_overdue": return "Some learning plans have many pending lessons";
      case "scheduled_task_due": return `Scheduled task: ${data.description}`;
      case "memory_stale": return `Memory hasn't been consolidated in ${data.daysSinceDream} days`;
      default: return obs.type;
    }
  } catch {
    return obs.type;
  }
}
