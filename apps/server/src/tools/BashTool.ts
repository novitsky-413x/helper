import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { buildTool } from "./buildTool.js";
import { getIO } from "../socketServer.js";
import { logger } from "../logger.js";
import { registerShutdownTask } from "../lifecycle.js";

const activeProcesses = new Map<string, ChildProcess>();
let processCounter = 0;

registerShutdownTask("BashTool:killAll", () => {
  for (const [id, proc] of activeProcesses) {
    try { proc.kill("SIGTERM"); } catch { /* ignore */ }
    activeProcesses.delete(id);
  }
});

function getShell(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return { shell: "powershell.exe", args: ["-NoProfile", "-Command"] };
  }
  return { shell: "/bin/bash", args: ["-c"] };
}

export const BashTool = buildTool({
  name: "bash",
  description:
    "Execute a shell command. Output is streamed to the terminal UI. " +
    "Use for running scripts, installing packages, git operations, etc. " +
    "Stateful: working directory persists between calls in the same session.",
  inputSchema: z.object({
    command: z.string().min(1).describe("The shell command to execute"),
    timeout: z.number().optional().describe("Timeout in ms (default 30000)"),
    background: z.boolean().optional().describe("Run in background without waiting"),
  }),
  isReadOnly: false,
  isConcurrencySafe: false,

  async call(input, context) {
    if (context.abortSignal?.aborted) {
      return "[aborted]";
    }
    const timeout = input.timeout ?? 30000;
    const { shell, args } = getShell();
    const sessionId = `bash-${++processCounter}`;
    const io = getIO();

    return new Promise<string>((resolve) => {
      let stdout = "";
      let stderr = "";
      let resolved = false;

      io?.of("/terminal").emit("terminal:output", {
        sessionId,
        chunk: `$ ${input.command}\n`,
        // Client store only accepts stdout | stderr; this is a UI echo of the command, not process stdin.
        stream: "stdout",
      });

      const proc = spawn(shell, [...args, input.command], {
        cwd: context.workingDirectory,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      activeProcesses.set(sessionId, proc);

      const detachAbort =
        context.abortSignal && !context.abortSignal.aborted
          ? (() => {
              const sig = context.abortSignal!;
              const onAbort = () => {
                if (resolved) return;
                resolved = true;
                if (timer) clearTimeout(timer);
                try {
                  proc.kill("SIGTERM");
                } catch {
                  /* ignore */
                }
                activeProcesses.delete(sessionId);
                const tail = (stdout + stderr).slice(-2000);
                resolve(`[aborted]\n${tail}`);
              };
              sig.addEventListener("abort", onAbort, { once: true });
              return () => sig.removeEventListener("abort", onAbort);
            })()
          : null;

      proc.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        io?.of("/terminal").emit("terminal:output", {
          sessionId,
          chunk,
          stream: "stdout",
        });
      });

      proc.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        io?.of("/terminal").emit("terminal:output", {
          sessionId,
          chunk,
          stream: "stderr",
        });
      });

      const timer = input.background ? null : setTimeout(() => {
        if (!resolved) {
          resolved = true;
          detachAbort?.();
          try { proc.kill("SIGTERM"); } catch { /* ignore */ }
          activeProcesses.delete(sessionId);
          const output = (stdout + stderr).slice(-4000);
          resolve(`[timeout after ${timeout}ms]\n${output}`);
        }
      }, timeout);

      if (input.background) {
        resolved = true;
        detachAbort?.();
        resolve(`Command started in background (session: ${sessionId}). PID: ${proc.pid}`);
        return;
      }

      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        detachAbort?.();
        activeProcesses.delete(sessionId);
        if (!resolved) {
          resolved = true;
          const combined = stdout + (stderr ? `\n[stderr]: ${stderr}` : "");
          const trimmed = combined.length > 8000
            ? combined.slice(0, 2000) + `\n...[${combined.length - 4000} chars truncated]...\n` + combined.slice(-2000)
            : combined;
          resolve(`[exit code: ${code ?? "unknown"}]\n${trimmed}`);
        }
      });

      proc.on("error", (err) => {
        if (timer) clearTimeout(timer);
        detachAbort?.();
        activeProcesses.delete(sessionId);
        if (!resolved) {
          resolved = true;
          resolve(`[error]: ${err.message}`);
        }
      });
    });
  },
});
