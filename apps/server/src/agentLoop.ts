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
import { sanitizeCoreMessages, sanitizeControlTokens } from "./pipeline/sanitize.js";

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
  extraTools?: ToolSet;
  abortSignal?: AbortSignal;
  onText?: (chunk: string) => void;
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onTurnEnd?: (turn: number, totalTurns: number) => void;
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
    profileId: mem0UserId ?? profileId,
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
      });

      const result = await streamText({
        model: togetherLlm(model),
        system,
        messages: coreMessages,
        tools: allTools,
        toolChoice: "auto",
        experimental_repairToolCall: async ({ toolCall }) => {
          logger.warn(
            { toolName: toolCall.toolName, args: toolCall.args },
            'agent loop: invalid tool call args — attempting repair',
          );
          try {
            const raw = typeof toolCall.args === 'string' ? JSON.parse(toolCall.args) : toolCall.args;
            if (toolCall.toolName === 'manage_memory' && raw && !raw.action) {
              if (Array.isArray(raw.memory)) {
                const first = raw.memory[0];
                if (first?.id && first?.text)
                  return {
                    toolCallType: 'function' as const,
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    args: JSON.stringify({ action: 'update', memoryId: first.id, text: first.text }),
                  };
                if (first?.text)
                  return {
                    toolCallType: 'function' as const,
                    toolCallId: toolCall.toolCallId,
                    toolName: toolCall.toolName,
                    args: JSON.stringify({ action: 'add', text: first.text }),
                  };
              }
              if (raw.text)
                return {
                  toolCallType: 'function' as const,
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  args: JSON.stringify({ action: 'add', text: raw.text }),
                };
            }
          } catch {
            // parse failed
          }
          logger.error({ toolName: toolCall.toolName }, 'agent loop: tool call repair failed, skipping');
          return null;
        },
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
        streamError = e;
        logger.warn({ err: e, turn: turnCount }, "agent loop: stream error caught, recovering");
      }

      if (streamError && toolCalls.length === 0 && !assistantText) {
        const errMsg = `Произошла ошибка при обработке запроса. Модель не смогла корректно вызвать инструмент. Попробуйте ещё раз или переключите модель.`;
        finalText = errMsg;
        onText?.(errMsg);
        status = "error";
        break;
      }

      const usage = await result.usage;
      totalTokens += (usage?.totalTokens ?? 0);

      if (toolCalls.length === 0) {
        finalText = assistantText;
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

      coreMessages.push({ role: "tool", content: toolResults });

      finalText = assistantText;
      onTurnEnd?.(turnCount, maxTurns);
    }

    if (turnCount >= maxTurns && status === "completed") {
      status = "max_turns";
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

  return { text: finalText, turnCount, totalTokens, status };
}
