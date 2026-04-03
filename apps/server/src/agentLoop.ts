import {
  streamText,
  convertToCoreMessages,
  type Message,
  type CoreMessage,
  type ToolSet,
} from "ai";
import { togetherLlm } from "./pipeline/chatHelpers.js";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { getIO } from "./socketServer.js";
import { logger } from "./logger.js";
import { getToolMap, buildAIToolSet, partitionToolCalls } from "./tools/index.js";
import type { ToolContext, AnyBuiltTool } from "./tools/buildTool.js";
import { buildMcpToolSet } from "./mcpRuntime.js";
import type { McpServerRecord } from "./store.js";
import {
  trimToContextBudget,
  getModelContextWindow,
} from "./pipeline/contextManager.js";
import type { TogetherModelRow } from "./togetherModels.js";
import type { AgentTaskStatus } from "@helper/shared";
import { sanitizeCoreMessages, sanitizeControlTokens } from "./pipeline/sanitize.js";
import { repairStreamToolCall } from "./pipeline/toolCallRepair.js";

export type AgentUiLocale = "ru" | "en";

function isAbortLike(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false;
  const name = (e as { name?: string }).name;
  if (name === "AbortError") return true;
  const msg = String((e as Error).message ?? "");
  return /aborted|AbortError|The operation was aborted/i.test(msg);
}

export interface AgentLoopParams {
  sessionId: string;
  profileId?: string;
  mem0UserId?: string;
  model: string;
  system: string;
  messages: Message[];
  mcpServers: McpServerRecord[];
  catalogModels: TogetherModelRow[];
  maxTurns?: number;
  /** Streamed footers for max_turns / interrupted match the web UI language when set. */
  locale?: AgentUiLocale;
  extraTools?: ToolSet;
  abortSignal?: AbortSignal;
  onText?: (chunk: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onTurnEnd?: (turn: number, totalTurns: number) => void;
}

function agentStreamFooters(locale: AgentUiLocale, maxTurns: number) {
  if (locale === "en") {
    return {
      maxTurns: `\n\n⚠️ Agent step limit reached (${maxTurns}). The task may be incomplete — narrow your request or raise MAX_TOOL_ROUNDS on the server.`,
      interrupted: "\n\n⏹️ Agent execution was stopped.",
    };
  }
  return {
    maxTurns: `\n\n⚠️ Достигнут лимит шагов агента (${maxTurns}). Задача могла выполниться не полностью — уточните запрос или увеличьте MAX_TOOL_ROUNDS на сервере.`,
    interrupted: "\n\n⏹️ Выполнение агента остановлено.",
  };
}

function agentStreamRecoverError(locale: AgentUiLocale): string {
  if (locale === "en") {
    return "An error occurred while processing the request. The model could not invoke tools correctly. Try again or switch models.";
  }
  return "Произошла ошибка при обработке запроса. Модель не смогла корректно вызвать инструмент. Попробуйте ещё раз или переключите модель.";
}

export interface AgentLoopResult {
  text: string;
  turnCount: number;
  totalTokens: number;
  status: "completed" | "interrupted" | "error" | "max_turns";
}

export async function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult> {
  const {
    sessionId,
    profileId,
    mem0UserId,
    model,
    system,
    messages: initialMessages,
    mcpServers,
    catalogModels,
    maxTurns = 16,
    locale = "ru",
    extraTools = {},
    abortSignal,
    onText,
    onToolCall,
    onToolResult,
    onTurnEnd,
  } = params;

  const db = getDb();
  const io = getIO();

  db.prepare(
    `INSERT INTO agent_sessions (id, profileId, startedAt, status) VALUES (?, ?, datetime('now'), 'running')`
  ).run(sessionId, profileId ?? null);

  const toolContext: ToolContext = {
    profileId,
    mem0UserId,
    agentSessionId: sessionId,
    abortSignal,
    emitProgress: (data) => {
      io?.of("/agent").emit("agent:progress", { sessionId, ...data });
    },
    io,
    workingDirectory: config.agentWorkspace,
  };

  const builtToolMap = getToolMap();
  const aiTools = buildAIToolSet(builtToolMap, toolContext);
  const mcpTools = await buildMcpToolSet(mcpServers);

  const allTools: ToolSet = {
    ...aiTools,
    ...mcpTools,
    ...extraTools,
  };

  let coreMessages: CoreMessage[];
  try {
    coreMessages = convertToCoreMessages(initialMessages);
  } catch {
    coreMessages = initialMessages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));
  }
  coreMessages = sanitizeCoreMessages(coreMessages);

  let turnCount = 0;
  let totalTokens = 0;
  let finalText = "";
  let status: AgentLoopResult["status"] = "completed";
  let completedNaturally = false;

  try {
    while (turnCount < maxTurns) {
      if (abortSignal?.aborted) {
        status = "interrupted";
        break;
      }

      const contextWindow = getModelContextWindow(model, catalogModels);
      const systemTokenEstimate = Math.ceil(system.length / 3.5);
      const budget = await trimToContextBudget({
        messages: coreMessages,
        systemTokens: systemTokenEstimate,
        contextWindow,
      });
      coreMessages = budget.messages;

      turnCount++;

      io?.of("/agent").emit("agent:progress", {
        sessionId,
        turn: turnCount,
        maxTurns,
        phase: "llm",
      });

      const result = await streamText({
        model: togetherLlm(model),
        system,
        messages: coreMessages,
        tools: allTools,
        toolChoice: "auto",
        experimental_repairToolCall: async ({ toolCall }) =>
          repairStreamToolCall(toolCall, { variant: "agent_loop" }),
        maxSteps: 1,
        abortSignal,
        onError: ({ error }) => {
          logger.error({ err: error, model, turn: turnCount }, "streamText error in agent loop");
        },
      });

      let assistantText = "";
      const toolCalls: Array<{ toolName: string; args: unknown; toolCallId: string }> = [];
      let streamError: unknown = null;
      let rawAccum = "";
      let lastCleanLength = 0;

      try {
        for await (const part of result.fullStream) {
          if (abortSignal?.aborted) {
            status = "interrupted";
            break;
          }
          if (part.type === "text-delta") {
            rawAccum += part.textDelta;
            const cleaned = sanitizeControlTokens(rawAccum);
            if (cleaned.length > lastCleanLength) {
              const newText = cleaned.slice(lastCleanLength);
              assistantText += newText;
              onText?.(newText);
              lastCleanLength = cleaned.length;
            }
          } else if (part.type === "tool-call") {
            toolCalls.push({
              toolName: part.toolName,
              args: part.args,
              toolCallId: part.toolCallId,
            });
            onToolCall?.(part.toolName, part.args);
          }
        }
      } catch (e) {
        if (abortSignal?.aborted || isAbortLike(e)) {
          status = "interrupted";
          streamError = null;
        } else {
          streamError = e;
          logger.warn({ err: e, turn: turnCount }, "agent loop: stream error caught, recovering");
        }
      }

      assistantText = sanitizeControlTokens(rawAccum);

      if (status === "interrupted") {
        finalText = assistantText;
        break;
      }

      if (streamError && toolCalls.length === 0 && !assistantText) {
        const errMsg = agentStreamRecoverError(locale);
        finalText = errMsg;
        onText?.(errMsg);
        status = "error";
        break;
      }

      try {
        const usage = await result.usage;
        totalTokens += usage?.totalTokens ?? 0;
      } catch {
        /* stream may be aborted before usage resolves */
      }

      if (toolCalls.length === 0) {
        finalText = assistantText;
        completedNaturally = true;
        break;
      }

      const assistantContent: Array<{type: "text"; text: string} | {type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown>}> = [];
      if (assistantText) {
        assistantContent.push({ type: "text" as const, text: assistantText });
      }
      for (const tc of toolCalls) {
        assistantContent.push({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args as Record<string, unknown>,
        });
      }

      coreMessages.push({ role: "assistant", content: assistantContent });

      const toolResults: Array<{type: "tool-result"; toolCallId: string; toolName: string; result: string}> = [];
      for (const tc of toolCalls) {
        if (abortSignal?.aborted) {
          status = "interrupted";
          finalText = assistantText;
          break;
        }
        io?.of("/agent").emit("agent:progress", {
          sessionId,
          turn: turnCount,
          maxTurns,
          phase: "tool",
          toolName: tc.toolName,
        });
        const builtTool = builtToolMap.get(tc.toolName);
        let toolResult: string;
        if (builtTool) {
          try {
            const raw = await builtTool.call(tc.args, toolContext);
            toolResult = typeof raw === "string" ? raw : JSON.stringify(raw);
          } catch (e) {
            toolResult = `Tool error: ${String(e)}`;
          }
        } else if (tc.toolName in allTools) {
          toolResult = "(executed via AI SDK)";
        } else {
          toolResult = `Unknown tool: ${tc.toolName}`;
        }
        toolResults.push({
          type: "tool-result" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          result: toolResult,
        });
        onToolResult?.(tc.toolName, toolResult);
      }

      if (status === "interrupted") {
        break;
      }

      coreMessages.push({ role: "tool", content: toolResults });

      finalText = assistantText;
      onTurnEnd?.(turnCount, maxTurns);
    }

    if (!completedNaturally && turnCount >= maxTurns && status === "completed") {
      status = "max_turns";
    }

    const footers = agentStreamFooters(locale, maxTurns);
    if (status === "max_turns") {
      const note = footers.maxTurns;
      finalText = (finalText || "") + note;
      onText?.(note);
    } else if (status === "interrupted") {
      const note = footers.interrupted;
      finalText = (finalText || "") + note;
      onText?.(note);
    }
  } catch (e) {
    logger.error({ err: e, sessionId, turn: turnCount }, "agent loop error");
    status = "error";
    finalText = finalText || `Agent loop error: ${String(e)}`;
  }

  try {
    db.prepare(
      `UPDATE agent_sessions SET endedAt = datetime('now'), turnCount = ?, totalTokens = ?, status = ? WHERE id = ?`
    ).run(turnCount, totalTokens, status, sessionId);
  } catch (e) {
    logger.warn({ err: e }, "failed to update agent_session");
  }

  // Model often sets a todo to in_progress via todo_write but never sends a final update when the run ends.
  try {
    const nowIso = new Date().toISOString();
    const nextStatus: AgentTaskStatus | null =
      status === "interrupted" || status === "error" || status === "max_turns"
        ? "cancelled"
        : status === "completed"
          ? "pending"
          : null;
    if (nextStatus) {
      const rows = db
        .prepare(
          `SELECT id, title, priority, createdAt, profileId FROM agent_tasks WHERE sessionId = ? AND status = 'in_progress'`,
        )
        .all(sessionId) as Array<{
          id: string;
          title: string;
          priority: number | null;
          createdAt: string;
          profileId: string | null;
        }>;
      if (rows.length > 0) {
        db.prepare(
          `UPDATE agent_tasks SET status = ?, updatedAt = ? WHERE sessionId = ? AND status = 'in_progress'`,
        ).run(nextStatus, nowIso, sessionId);
        for (const row of rows) {
          io?.of("/agent").emit("agent:task-update", {
            id: row.id,
            profileId: row.profileId ?? profileId,
            sessionId,
            title: row.title,
            status: nextStatus,
            priority: row.priority ?? 0,
            createdAt: row.createdAt,
            updatedAt: nowIso,
          });
        }
        logger.info(
          { sessionId, count: rows.length, nextStatus },
          "agent loop: reconciled in_progress todos after run",
        );
      }
    }
  } catch (e) {
    logger.warn({ err: e, sessionId }, "agent task end reconciliation failed");
  }

  return { text: finalText, turnCount, totalTokens, status };
}
