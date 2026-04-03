import { streamText, type ToolSet, type CoreMessage } from "ai";
import { togetherLlm } from "./pipeline/chatHelpers.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getToolMap, buildAIToolSet } from "./tools/index.js";
import type { ToolContext, AnyBuiltTool } from "./tools/buildTool.js";
import { getIO } from "./socketServer.js";
import { randomUUID } from "node:crypto";
import { sanitizeControlTokens, sanitizeCoreMessages } from "./pipeline/sanitize.js";
import { repairStreamToolCall } from "./pipeline/toolCallRepair.js";

export type SubAgentType = "explore" | "specialist" | "dream" | "teacher";

export interface SubAgentParams {
  type: SubAgentType;
  task: string;
  context?: string;
  model?: string;
  /** SQLite profile id (tools that write to local DB). */
  profileId?: string;
  mem0UserId?: string;
  parentSessionId?: string;
  maxTurns?: number;
  toolFilter?: (tool: AnyBuiltTool) => boolean;
}

const SUB_AGENT_TOOL_FILTERS: Record<SubAgentType, (t: AnyBuiltTool) => boolean> = {
  explore: (t) => t.isReadOnly,
  specialist: () => true,
  dream: (t) => t.name === "manage_memory",
  teacher: (t) => ["web_search", "web_fetch", "manage_memory", "todo_write"].includes(t.name),
};

const SUB_AGENT_STREAM_ERROR =
  "An error occurred while processing the request. The model could not invoke tools correctly. Try again or switch models.";

export async function runSubAgent(params: SubAgentParams): Promise<string> {
  const {
    type,
    task,
    context,
    model,
    profileId,
    mem0UserId,
    parentSessionId,
    maxTurns = 5,
  } = params;

  const sessionId = randomUUID();
  const io = getIO();

  const toolContext: ToolContext = {
    profileId,
    mem0UserId,
    agentSessionId: sessionId,
    emitProgress: (data) => {
      io?.of("/agent").emit("agent:progress", { sessionId, subAgent: true, ...data });
    },
    io,
    workingDirectory: config.agentWorkspace,
  };

  const allTools = getToolMap();
  const filter = params.toolFilter ?? SUB_AGENT_TOOL_FILTERS[type];
  const filteredMap = new Map<string, AnyBuiltTool>();
  for (const [name, tool] of allTools) {
    if (filter(tool)) filteredMap.set(name, tool);
  }

  const aiTools: ToolSet = buildAIToolSet(filteredMap, toolContext);

  const systemPrompt = `You are a sub-agent of type "${type}". Your parent session is ${parentSessionId ?? "unknown"}.
${context ? `\nContext:\n${context}` : ""}

Complete the following task efficiently and return a clear result.`;

  const selectedModel = model ?? (type === "explore" ? config.togetherBaseModel : config.togetherMemoryModel);

  let coreMessages: CoreMessage[] = sanitizeCoreMessages([{ role: "user", content: task }]);

  let finalText = "";
  let turn = 0;

  while (turn < maxTurns) {
    turn++;
    toolContext.emitProgress({ turn, maxTurns, phase: "llm" });
    try {
      const result = await streamText({
        model: togetherLlm(selectedModel),
        system: systemPrompt,
        messages: coreMessages,
        tools: aiTools,
        toolChoice: "auto",
        experimental_repairToolCall: async ({ toolCall }) =>
          repairStreamToolCall(toolCall, { variant: "sub_agent" }),
        maxSteps: 1,
        maxTokens: 4000,
        onError: ({ error }) => {
          logger.error({ err: error, model: selectedModel, turn, type }, "streamText error in sub-agent");
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
              assistantText += cleaned.slice(lastCleanLength);
              lastCleanLength = cleaned.length;
            }
          } else if (part.type === "tool-call") {
            toolCalls.push({
              toolName: part.toolName,
              args: part.args,
              toolCallId: part.toolCallId,
            });
          }
        }
      } catch (e) {
        streamError = e;
        logger.warn({ err: e, turn, type }, "sub-agent: stream error caught, recovering");
      }

      assistantText = sanitizeControlTokens(rawAccum);

      if (streamError && toolCalls.length === 0 && !assistantText) {
        finalText = SUB_AGENT_STREAM_ERROR;
        break;
      }

      if (toolCalls.length === 0) {
        finalText = assistantText;
        break;
      }

      const assistantContent: Array<
        | { type: "text"; text: string }
        | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown> }
      > = [];
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

      const toolResults: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        result: string;
      }> = [];
      for (const tc of toolCalls) {
        toolContext.emitProgress({
          turn,
          maxTurns,
          phase: "tool",
          toolName: tc.toolName,
        });
        const builtTool = filteredMap.get(tc.toolName);
        let toolResult: string;
        if (builtTool) {
          try {
            const raw = await builtTool.call(tc.args, toolContext);
            toolResult = typeof raw === "string" ? raw : JSON.stringify(raw);
          } catch (e) {
            toolResult = `Tool error: ${String(e)}`;
          }
        } else if (tc.toolName in aiTools) {
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
      }

      coreMessages.push({ role: "tool", content: toolResults });
      coreMessages = sanitizeCoreMessages(coreMessages);
      finalText = assistantText;
    } catch (e) {
      logger.error({ err: e, type, turn }, "subAgent turn failed");
      break;
    }
  }

  logger.info({ type, sessionId, turns: turn, textLen: finalText.length }, "subAgent completed");
  return finalText || "(sub-agent returned no result)";
}
