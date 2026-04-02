import type { z } from "zod";
import type { Server as SocketIOServer } from "socket.io";

export interface ToolContext {
  profileId?: string;
  agentSessionId?: string;
  abortSignal?: AbortSignal;
  emitProgress: (data: Record<string, unknown>) => void;
  io: SocketIOServer | null;
  workingDirectory: string;
}

export interface ToolDef<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  isReadOnly?: boolean;
  isConcurrencySafe?: boolean;
  isEnabled?: () => boolean;
  call(input: TInput, context: ToolContext): Promise<TOutput>;
}

export interface BuiltTool<TInput = unknown, TOutput = unknown> extends Required<Pick<ToolDef<TInput, TOutput>,
  "name" | "description" | "inputSchema" | "call"
>> {
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  isEnabled: () => boolean;
}

const TOOL_DEFAULTS = {
  isReadOnly: false,
  isConcurrencySafe: false,
  isEnabled: () => true,
} as const;

export function buildTool<TInput, TOutput>(
  def: ToolDef<TInput, TOutput>,
): BuiltTool<TInput, TOutput> {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    call: def.call,
    isReadOnly: def.isReadOnly ?? TOOL_DEFAULTS.isReadOnly,
    isConcurrencySafe: def.isConcurrencySafe ?? TOOL_DEFAULTS.isConcurrencySafe,
    isEnabled: def.isEnabled ?? TOOL_DEFAULTS.isEnabled,
  };
}

export type AnyBuiltTool = BuiltTool<any, any>;

/**
 * Partition tool calls into concurrent (read-only, concurrency-safe) batches
 * and serial (mutating) calls. Read-only tools can run in parallel.
 */
export function partitionToolCalls<T extends { toolName: string }>(
  calls: T[],
  toolMap: Map<string, AnyBuiltTool>,
): { concurrent: T[]; serial: T[] } {
  const concurrent: T[] = [];
  const serial: T[] = [];

  for (const call of calls) {
    const tool = toolMap.get(call.toolName);
    if (tool?.isReadOnly && tool?.isConcurrencySafe) {
      concurrent.push(call);
    } else {
      serial.push(call);
    }
  }

  return { concurrent, serial };
}
