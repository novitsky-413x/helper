import type { Server as HttpServer } from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { VoskSttBridge, voskBridgeScriptPath, type SttEvent } from "./sttVosk.js";
import { piperSynth } from "./ttsPiper.js";

type ClientJson =
  | { type: "tts"; text: string; id: number }
  | { type: "barge_in" }
  | { type: "utterance_end" };

export function attachVoiceWebSocket(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const host = request.headers.host ?? "localhost";
    const pathname = new URL(request.url ?? "/", `http://${host}`).pathname;
    if (pathname !== "/api/voice") {
      logger.debug({ pathname }, "WS upgrade ignored (path)");
      socket.destroy();
      return;
    }
    logger.debug({ pathname, host }, "WS upgrade accepted for voice");
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    handleConnection(ws);
  });
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function handleConnection(ws: WebSocket): void {
  const connId = randomBytes(4).toString("hex");
  const log = logger.child({ component: "voice", connId });

  const scriptPath = voskBridgeScriptPath();
  const hasStt =
    !!config.voskModelPath &&
    existsSync(config.voskModelPath) &&
    existsSync(scriptPath);
  const piperExeOk =
    !!config.piperExecutable &&
    (!config.piperExecutable.includes(path.sep) || existsSync(config.piperExecutable));
  const hasTts = piperExeOk && !!config.piperModelPath && existsSync(config.piperModelPath);

  let bridge: VoskSttBridge | null = null;
  if (hasStt) {
    bridge = new VoskSttBridge(
      config.voicePython,
      scriptPath,
      config.voskModelPath,
      (e: SttEvent) => {
        if (e.type === "error") {
          log.warn({ msg: e.message }, "stt error");
          safeSend(ws, { type: "stt_error", message: e.message });
          return;
        }
        if (e.type === "partial") {
          log.debug({ text: truncate(e.text, 120) }, "stt partial");
          safeSend(ws, { type: "stt_partial", text: e.text });
          return;
        }
        if (e.type === "final") {
          log.info({ text: truncate(e.text, 200) }, "stt final");
          safeSend(ws, { type: "stt_final", text: e.text });
        }
      }
    );
    try {
      bridge.start();
    } catch (e) {
      log.error({ err: e }, "vosk bridge start failed");
      safeSend(ws, { type: "stt_error", message: String(e) });
      bridge.stop();
      bridge = null;
    }
  }

  type TtsJob = { id: number; text: string; gen: number };
  const queue: TtsJob[] = [];
  let ttsGen = 0;
  let processing = false;

  const pumpTts = (): void => {
    if (!hasTts || processing) return;
    while (queue.length > 0 && queue[0].gen < ttsGen) {
      queue.shift();
    }
    if (!queue.length) return;

    const job = queue[0];
    processing = true;

    const t0 = Date.now();
    void piperSynth(job.text, config.piperExecutable, config.piperModelPath)
      .then((wav) => {
        processing = false;
        if (queue[0] === job) {
          queue.shift();
        }
        if (job.gen === ttsGen && wav.length > 0) {
          log.info(
            {
              ttsId: job.id,
              gen: job.gen,
              ms: Date.now() - t0,
              wavBytes: wav.length,
              preview: truncate(job.text, 100),
            },
            "tts synthesized"
          );
          safeSend(ws, {
            type: "tts_audio",
            id: job.id,
            format: "wav",
            data: wav.toString("base64"),
          });
        } else if (job.gen !== ttsGen) {
          log.debug({ ttsId: job.id, gen: job.gen, currentGen: ttsGen }, "tts dropped (stale gen)");
        }
        void pumpTts();
      })
      .catch((err) => {
        processing = false;
        if (queue[0] === job) {
          queue.shift();
        }
        if (job.gen === ttsGen) {
          log.warn({ err, ttsId: job.id, preview: truncate(job.text, 80) }, "tts failed");
          safeSend(ws, { type: "tts_error", id: job.id, message: String(err) });
        }
        void pumpTts();
      });
  };

  log.info(
    {
      stt: Boolean(bridge),
      tts: hasTts,
      sampleRate: config.voiceSampleRate,
      voskModelPath: config.voskModelPath || null,
      scriptPath,
    },
    "voice session ready"
  );

  safeSend(ws, {
    type: "voice_ready",
    stt: !!bridge,
    tts: hasTts,
    sampleRate: config.voiceSampleRate,
  });

  let pcmChunks = 0;
  let pcmBytes = 0;

  ws.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data)
        ? data
        : ArrayBuffer.isView(data)
          ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          : Buffer.from(data as ArrayBuffer);
      pcmChunks += 1;
      pcmBytes += buf.length;
      if (pcmChunks % 200 === 0) {
        log.debug({ pcmChunks, pcmBytes, lastChunkBytes: buf.length }, "voice pcm (sampled)");
      }
      bridge?.writePcm(buf);
      return;
    }

    const raw =
      typeof data === "string"
        ? data
        : Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Buffer.from(data as ArrayBuffer).toString("utf8");
    let msg: ClientJson;
    try {
      msg = JSON.parse(raw) as ClientJson;
    } catch {
      return;
    }

    if (msg.type === "barge_in") {
      ttsGen += 1;
      queue.length = 0;
      log.info({ gen: ttsGen }, "client barge_in");
      safeSend(ws, { type: "tts_cancelled", gen: ttsGen });
      return;
    }

    if (msg.type === "utterance_end") {
      log.debug("utterance_end (flush vosk)");
      bridge?.flushUtterance();
      return;
    }

    if (msg.type === "tts" && typeof msg.text === "string" && typeof msg.id === "number") {
      if (!hasTts) {
        log.warn({ ttsId: msg.id }, "tts request but TTS not configured");
        safeSend(ws, { type: "tts_error", id: msg.id, message: "TTS not configured" });
        return;
      }
      log.debug({ ttsId: msg.id, preview: truncate(msg.text, 100), queueLen: queue.length }, "tts enqueue");
      queue.push({ id: msg.id, text: msg.text, gen: ttsGen });
      void pumpTts();
    }
  });

  ws.on("close", (code, reason) => {
    log.info(
      { code, reason: reason?.toString() || "", pcmChunks, pcmBytes },
      "voice WebSocket closed"
    );
    bridge?.stop();
    bridge = null;
    queue.length = 0;
  });

  ws.on("error", (err) => {
    log.warn({ err }, "voice WebSocket error");
    bridge?.stop();
    bridge = null;
  });
}

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}
