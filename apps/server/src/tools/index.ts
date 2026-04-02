import { z, type ZodType } from "zod";
import { tool, type ToolSet } from "ai";
import type { AnyBuiltTool, ToolContext } from "./buildTool.js";
import { MemoryTool } from "./MemoryTool.js";
import { TodoWriteTool } from "./TodoWriteTool.js";
import { DelegateTool } from "./DelegateTool.js";
import { BashTool } from "./BashTool.js";
import { FileReadTool } from "./FileReadTool.js";
import { FileWriteTool } from "./FileWriteTool.js";
import { GlobTool } from "./GlobTool.js";
import { GrepTool } from "./GrepTool.js";
import { WebSearchTool } from "./WebSearchTool.js";
import { WebFetchTool } from "./WebFetchTool.js";
import { DownloadFileTool } from "./DownloadFileTool.js";
import {
  CreateLearningPlanTool,
  GenerateLessonTool,
  QuizTool,
  WikiTool,
  ProgressTrackTool,
} from "./LearningTools.js";

const ALL_TOOLS: AnyBuiltTool[] = [
  MemoryTool,
  TodoWriteTool,
  DelegateTool,
  BashTool,
  FileReadTool,
  FileWriteTool,
  GlobTool,
  GrepTool,
  WebSearchTool,
  WebFetchTool,
  DownloadFileTool,
  CreateLearningPlanTool,
  GenerateLessonTool,
  QuizTool,
  WikiTool,
  ProgressTrackTool,
];

export function getToolMap(): Map<string, AnyBuiltTool> {
  const map = new Map<string, AnyBuiltTool>();
  for (const t of ALL_TOOLS) {
    if (t.isEnabled()) {
      map.set(t.name, t);
    }
  }
  return map;
}

export function registerTool(tool: AnyBuiltTool) {
  ALL_TOOLS.push(tool);
}

/**
 * Convert our BuiltTools into Vercel AI SDK ToolSet for use with streamText.
 * Each tool's `call` is adapted to receive the shared ToolContext.
 */
export function buildAIToolSet(
  toolMap: Map<string, AnyBuiltTool>,
  context: ToolContext,
): ToolSet {
  const result: ToolSet = {};
  for (const [name, t] of toolMap) {
    result[name] = tool({
      description: t.description,
      parameters: t.inputSchema as ZodType<any>,
      execute: async (args: unknown) => {
        return t.call(args, context);
      },
    });
  }
  return result;
}

export { partitionToolCalls } from "./buildTool.js";
export type { ToolContext, AnyBuiltTool } from "./buildTool.js";
