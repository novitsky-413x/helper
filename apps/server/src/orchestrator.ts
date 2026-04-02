import { generateText, type ToolSet } from "ai";
import { togetherLlm } from "./pipeline/chatHelpers.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getToolMap, buildAIToolSet } from "./tools/index.js";
import type { ToolContext, AnyBuiltTool } from "./tools/buildTool.js";
import { getIO } from "./socketServer.js";
import { randomUUID } from "node:crypto";

export type SubAgentType = "explore" | "specialist" | "dream" | "teacher";

export interface SubAgentParams {
  type: SubAgentType;
  task: string;
  context?: string;
  model?: string;
  profileId?: string;
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

export async function runSubAgent(params: SubAgentParams): Promise<string> {
  const {
    type,
    task,
    context,
    model,
    profileId,
    parentSessionId,
    maxTurns = 5,
  } = params;

  const sessionId = randomUUID();
  const io = getIO();

  const toolContext: ToolContext = {
    profileId,
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

  let messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: task },
  ];

  let finalText = "";
  let turn = 0;

  while (turn < maxTurns) {
    turn++;
    try {
      const result = await generateText({
        model: togetherLlm(selectedModel),
        system: systemPrompt,
        messages,
        tools: aiTools,
        toolChoice: "auto",
        maxSteps: 3,
        maxTokens: 4000,
      });

      finalText = result.text || finalText;

      if (!result.toolCalls?.length) break;

      messages = [
        ...messages,
        { role: "assistant", content: result.text || "(tool calls executed)" },
        { role: "user", content: "Continue with the task based on the tool results." },
      ];
    } catch (e) {
      logger.error({ err: e, type, turn }, "subAgent turn failed");
      break;
    }
  }

  logger.info({ type, sessionId, turns: turn, textLen: finalText.length }, "subAgent completed");
  return finalText || "(sub-agent returned no result)";
}
