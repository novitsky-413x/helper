// ── Profiles & Personas ──

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
  avatarEmoji?: string;
  personality?: string;
  voiceStyle?: string;
  systemPromptMode?: "replace" | "append" | "prepend";
  customSystemPrompt?: string;
};

// ── Chat ──

export type ChatSession = {
  id: string;
  profileId: string;
  title: string;
  messages: unknown[];
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

// ── Agent ──

export type AgentTaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type AgentTask = {
  id: string;
  profileId?: string;
  sessionId?: string;
  title: string;
  description?: string;
  status: AgentTaskStatus;
  priority: number;
  parentId?: string;
  result?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentSessionStatus = "running" | "completed" | "interrupted" | "error";

export type AgentSession = {
  id: string;
  profileId?: string;
  startedAt: string;
  endedAt?: string;
  turnCount: number;
  totalTokens: number;
  status: AgentSessionStatus;
};

// ── autoDream ──

export type DreamSessionStatus = "running" | "completed" | "interrupted" | "error";

export type DreamSession = {
  id: string;
  profileId?: string;
  triggeredBy: "auto" | "manual" | "autopilot";
  startedAt: string;
  endedAt?: string;
  status: DreamSessionStatus;
  memoriesProcessed: number;
  memoriesCreated: number;
  memoriesPruned: number;
  memoriesMerged: number;
  prompt?: string;
  result?: string;
};

// ── Autopilot ──

export type AutopilotMode = "passive" | "advisory" | "autonomous";

export type AutopilotObservation = {
  id: string;
  type: string;
  data?: string;
  actionTaken?: string;
  createdAt: string;
};

export type AutopilotScheduledTask = {
  id: string;
  profileId?: string;
  cronExpr?: string;
  description: string;
  taskType: string;
  lastRunAt?: string;
  nextRunAt?: string;
  enabled: boolean;
  createdAt: string;
};

// ── Model evaluation ──

export type ModelEvaluation = {
  id: string;
  sessionId?: string;
  modelId: string;
  taskType?: string;
  qualityScore?: number;
  latencyMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  evaluatedAt: string;
};

// ── Learning ──

export type LearningPlanStatus = "active" | "completed" | "paused" | "archived";

export type LearningPlan = {
  id: string;
  profileId: string;
  title: string;
  subject?: string;
  syllabus: unknown[];
  status: LearningPlanStatus;
  createdAt: string;
  updatedAt: string;
};

export type LessonStatus = "not_started" | "in_progress" | "completed" | "failed";

export type LearningProgress = {
  id: string;
  planId: string;
  lessonIdx: number;
  status: LessonStatus;
  score?: number;
  attempts: number;
  lastAttemptAt?: string;
};

// ── Wiki ──

export type WikiArticle = {
  id: string;
  profileId: string;
  title: string;
  content: string;
  tags: string[];
  verified: boolean;
  createdAt: string;
  updatedAt: string;
};

// ── Models & Catalog ──

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

export type ModelHealthStatus = "available" | "unavailable" | "unknown" | "checking";

export type ModelHealthEntry = {
  status: ModelHealthStatus;
  latencyMs?: number;
  error?: string;
  checkedAt?: string;
};

export type ModelCatalog = {
  models: TogetherModel[];
  chatModels: TogetherModel[];
  defaults: Record<TaskCategory, string[]>;
  latencyMsByModel: Record<string, number>;
  healthByModel?: Record<string, ModelHealthEntry>;
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

// ── Notifications ──

export type NotificationType = "info" | "success" | "warning" | "error" | "autopilot";

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  ttl?: number;
  createdAt: number;
};

// ── Slash Commands ──

export type SlashCommandName =
  | "compact"
  | "dream"
  | "persona"
  | "context"
  | "tasks"
  | "learn"
  | "wiki"
  | "autopilot";

// ── Socket.io event maps ──

export interface ServerToClientEvents {
  "terminal:output": (data: { sessionId: string; chunk: string; stream: "stdout" | "stderr" }) => void;
  "autopilot:observation": (obs: AutopilotObservation) => void;
  "autopilot:action": (data: { observationId: string; action: string; result?: string }) => void;
  "agent:progress": (data: { sessionId: string; turn: number; maxTurns: number; toolName?: string }) => void;
  "agent:task-update": (task: AgentTask) => void;
  "dream:status": (data: { status: DreamSessionStatus; stats?: Record<string, number> }) => void;
  "notification": (n: AppNotification) => void;
}

export interface ClientToServerEvents {
  "terminal:input": (data: { sessionId: string; input: string }) => void;
  "terminal:resize": (data: { sessionId: string; cols: number; rows: number }) => void;
  "autopilot:set-mode": (mode: AutopilotMode) => void;
}
