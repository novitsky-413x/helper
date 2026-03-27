export type Profile = {
  id: string;
  name: string;
  mem0UserId: string;
  modelPreferences?: {
    categories?: Record<string, { order: string[] }>;
    updatedAt?: string;
  };
  memoryPolicy?: {
    topK?: number;
    maxChars?: number;
    pinnedOnlyForSimple?: boolean;
  };
  memoryPins?: string[];
};

export type TogetherModel = {
  id: string;
  display_name?: string | null;
  type?: string;
  context_length?: number | null;
  pricing?: {
    hourly?: number | null;
    input?: number | null;
    output?: number | null;
  } | null;
};

export type TaskCategory =
  | "primary"
  | "code_mcp"
  | "reasoning"
  | "vision"
  | "image_gen"
  | "audio"
  | "memory";

export type ModelCatalog = {
  models: TogetherModel[];
  chatModels: TogetherModel[];
  defaults: Record<TaskCategory, string[]>;
  latencyMsByModel: Record<string, number>;
};

export type McpServer = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
};

export type MemoryRow = { id: string; memory: string; score?: number };

export type UsageSnapshot = {
  ts: string;
  resolvedModel: string;
  delegatedCategory?: string;
  profileId: string | null;
  messageCount: number;
  lastUserChars: number;
  memoryHits: number;
  memoryBlockChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  requestCostUsd?: number | null;
  sessionCostUsd?: number | null;
  memoryWriteOkTotal?: number;
  memoryWriteFailTotal?: number;
  memoryWriteLastOk?: boolean | null;
};
