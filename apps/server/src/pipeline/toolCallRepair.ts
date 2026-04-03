import { logger } from "../logger.js";

/** Input shape from `streamText` / `experimental_repairToolCall`. */
export type StreamToolCallLike = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type StreamToolCallRepairResult = {
  toolCallType: "function";
  toolCallId: string;
  toolName: string;
  args: string;
} | null;

export type ToolCallRepairVariant = "agent_loop" | "chat" | "sub_agent";

function repairLog(variant: ToolCallRepairVariant, level: "warn" | "error" | "info", data: Record<string, unknown>, msg: string) {
  const prefix =
    variant === "agent_loop"
      ? "agent loop: "
      : variant === "sub_agent"
        ? "sub-agent: "
        : "";
  const full = variant === "chat" ? msg : `${prefix}${msg}`;
  if (level === "warn") logger.warn(data, full);
  else if (level === "error") logger.error(data, full);
  else logger.info(data, full);
}

function mkResult(toolCall: StreamToolCallLike, args: Record<string, unknown>): StreamToolCallRepairResult {
  return {
    toolCallType: "function",
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    args: JSON.stringify(args),
  };
}

/**
 * Shared repairs for invalid tool JSON from models (bash output shape, file_read aliases, manage_memory, optional generate_image).
 */
export function repairStreamToolCall(
  toolCall: StreamToolCallLike,
  opts: { variant: ToolCallRepairVariant },
): StreamToolCallRepairResult {
  const { variant } = opts;
  repairLog(variant, "warn", { toolName: toolCall.toolName, args: toolCall.args }, "invalid tool call args — attempting repair");

  try {
    const raw = typeof toolCall.args === "string" ? JSON.parse(toolCall.args) : toolCall.args;

    if (variant === "chat") {
      if (toolCall.toolName === "generate_image" && raw && !raw.prompt) {
        if (raw.type === "image" || raw.markdown || raw.url) {
          logger.warn("model echoed previous image result as args — skipping duplicate call");
          return null;
        }
      }
    }

    if (
      toolCall.toolName === "bash" &&
      raw &&
      typeof raw === "object" &&
      !("command" in raw) &&
      ("stdout" in raw || "stderr" in raw || "exitCode" in raw || "output" in raw)
    ) {
      const r = raw as { stdout?: unknown; output?: unknown };
      const stdoutRaw =
        typeof r.stdout === "string" ? r.stdout : typeof r.output === "string" ? r.output : "";
      const pickSafeLine = (s: string): string => {
        const trimmed = s.trim();
        if (!trimmed) return "";
        const lines = trimmed.split(/\r?\n/);
        for (const line of lines) {
          const t = line.trim();
          if (t.length > 500 || /[`$]/.test(t)) continue;
          if (t) return t;
        }
        return "";
      };
      const stdout = pickSafeLine(stdoutRaw);
      if (stdout) {
        const command =
          process.platform === "win32"
            ? `Write-Output ${JSON.stringify(stdout)}`
            : `printf '%s\\n' ${JSON.stringify(stdout)}`;
        repairLog(variant, "info", { preview: stdout.slice(0, 80) }, "repaired bash args (model sent stdout/exitCode shape)");
        return mkResult(toolCall, { command });
      }
    }

    if (toolCall.toolName === "file_read" && raw && typeof raw === "object") {
      const fp = (raw as { filePath?: unknown }).filePath;
      const hasNonEmptyFilePath = typeof fp === "string" && fp.length > 0;
      if (!hasNonEmptyFilePath) {
        const o = raw as Record<string, unknown>;
        const alt = o.path ?? o.file_path ?? o.filename ?? o.file;
        if (typeof alt === "string" && alt.length > 0 && alt.length < 4096) {
          const offset = typeof o.offset === "number" ? o.offset : undefined;
          const limit = typeof o.limit === "number" ? o.limit : undefined;
          const payload: Record<string, unknown> = { filePath: alt };
          if (offset !== undefined) payload.offset = offset;
          if (limit !== undefined) payload.limit = limit;
          repairLog(variant, "info", { filePath: alt.slice(0, 120) }, "repaired file_read args (alias path key)");
          return mkResult(toolCall, payload);
        }
      }
    }

    if (toolCall.toolName === "manage_memory" && raw && !raw.action) {
      if (Array.isArray(raw.memory)) {
        const first = raw.memory[0];
        if (first?.id && first?.text) return mkResult(toolCall, { action: "update", memoryId: first.id, text: first.text });
        if (first?.text) return mkResult(toolCall, { action: "add", text: first.text });
      }
      if (raw.text) return mkResult(toolCall, { action: "add", text: raw.text });
    }
  } catch {
    // parse failed
  }

  repairLog(variant, "error", { toolName: toolCall.toolName }, "tool call repair failed, skipping");
  return null;
}
