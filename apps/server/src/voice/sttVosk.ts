import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SttEvent =
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

export function voskBridgeScriptPath(): string {
  return path.resolve(__dirname, "../../scripts/vosk_stt_bridge.py");
}

export class VoskSttBridge {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;

  constructor(
    private readonly pythonExe: string,
    private readonly scriptPath: string,
    private readonly modelPath: string,
    private readonly onEvent: (e: SttEvent) => void
  ) {}

  start(): void {
    this.proc = spawn(this.pythonExe, [this.scriptPath, this.modelPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.proc.stderr?.on("data", (d: Buffer) => {
      const s = d.toString().trim();
      if (s) logger.warn({ component: "vosk-bridge", stderr: s }, "vosk python stderr");
    });

    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line) => {
      try {
        const j = JSON.parse(line) as SttEvent;
        if (j.type === "error" || j.type === "partial" || j.type === "final") {
          this.onEvent(j);
        }
      } catch {
        /* ignore */
      }
    });

    this.proc.on("error", (err) => {
      this.onEvent({ type: "error", message: String(err) });
    });

    this.proc.on("exit", (code, signal) => {
      if (signal === "SIGTERM" || signal === "SIGKILL") return;
      if (code !== 0 && code !== null) {
        this.onEvent({ type: "error", message: `vosk bridge exited with code ${code}` });
      }
    });
  }

  writePcm(buf: Buffer): void {
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) return;
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(buf.length, 0);
    stdin.write(len);
    stdin.write(buf);
  }

  /** End current utterance (maps to vosk finalize + new recognizer). */
  flushUtterance(): void {
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed || stdin.writableEnded) return;
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(0, 0);
    stdin.write(len);
  }

  stop(): void {
    try {
      this.proc?.stdin?.end();
    } catch {
      /* ignore */
    }
    this.rl?.close();
    this.proc?.kill();
    this.proc = null;
    this.rl = null;
  }
}
