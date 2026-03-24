import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TARGET_RATE = 16000;
const BARGE_RMS = 0.08;
const BARGE_MS = 120;

type ServerMsg =
  | { type: "voice_ready"; stt: boolean; tts: boolean; sampleRate: number }
  | { type: "stt_partial"; text: string }
  | { type: "stt_final"; text: string }
  | { type: "stt_error"; message: string }
  | { type: "tts_audio"; id: number; format: string; data: string }
  | { type: "tts_error"; id: number; message: string }
  | { type: "tts_cancelled"; gen: number };

function downsampleTo16kInt16(input: Float32Array, inputRate: number): Int16Array {
  if (inputRate === TARGET_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]!));
      out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
    }
    return out;
  }
  const ratio = inputRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    const avg = sum / (end - start || 1);
    const s = Math.max(-1, Math.min(1, avg));
    out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
  }
  return out;
}

function assistantSpeakableText(m: {
  content?: string;
  parts?: Array<{ type: string; text?: string }>;
}): string {
  if (m.parts?.length) {
    return m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
      .map((p) => p.text)
      .join("");
  }
  return m.content ?? "";
}

function pullCompleteSentences(full: string, cursor: number): { sentences: string[]; nextCursor: number } {
  const slice = full.slice(cursor);
  const sentences: string[] = [];
  let i = 0;
  let chunkStart = 0;

  const pushChunk = (end: number) => {
    const t = slice.slice(chunkStart, end).trim();
    if (t) sentences.push(t);
    chunkStart = end;
  };

  while (i < slice.length) {
    const ch = slice[i]!;
    if (ch === "." || ch === "!" || ch === "?" || ch === "…") {
      const next = slice[i + 1];
      if (next === undefined || /\s/.test(next)) {
        pushChunk(i + 1);
        while (chunkStart < slice.length && /\s/.test(slice[chunkStart]!)) {
          chunkStart++;
        }
        i = chunkStart;
        continue;
      }
    }
    if (ch === "\n" && slice[i + 1] === "\n") {
      pushChunk(i + 2);
      while (chunkStart < slice.length && /\s/.test(slice[chunkStart]!)) {
        chunkStart++;
      }
      i = chunkStart;
      continue;
    }
    i++;
  }

  return { sentences, nextCursor: cursor + chunkStart };
}

function voiceWebSocketUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/voice`;
}

export type LiveVoiceState = "idle" | "listening" | "speaking" | "thinking";

type AppendFn = (
  message: { role: "user"; content: string },
  options?: { body?: Record<string, unknown> }
) => Promise<string | null | undefined>;

export function useLiveVoice(options: {
  enabled: boolean;
  append: AppendFn;
  chatBody: { model: string; profileId?: string };
  messages: Array<{ id?: string; role: string; content?: string; parts?: Array<{ type: string; text?: string }> }>;
  status: "ready" | "submitted" | "streaming" | "error";
  onInterimChange: (text: string | null) => void;
}): {
  liveState: LiveVoiceState;
  voiceError: string | null;
  sttReady: boolean;
  ttsReady: boolean;
} {
  const { enabled, append, chatBody, messages, status, onInterimChange } = options;

  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [sttReady, setSttReady] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [ttsActive, setTtsActive] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);
  const bargeSinceRef = useRef<number | null>(null);
  const ttsPlayingRef = useRef(false); // mirrors whether any AudioBufferSource is running
  const playChainRef = useRef<Promise<void>>(Promise.resolve());
  const currentSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const ttsIdRef = useRef(0);
  const lastAssistantIdRef = useRef<string | null>(null);
  const ttsCursorRef = useRef(0);
  const enabledPrevRef = useRef(false);
  const appendRef = useRef(append);
  appendRef.current = append;
  const chatBodyRef = useRef(chatBody);
  chatBodyRef.current = chatBody;
  const onInterimChangeRef = useRef(onInterimChange);
  onInterimChangeRef.current = onInterimChange;

  const stopPlayback = useCallback(() => {
    for (const s of currentSourcesRef.current) {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    }
    currentSourcesRef.current = [];
    ttsPlayingRef.current = false;
    setTtsActive(false);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "barge_in" }));
    }
  }, []);

  const decodeAndStart = useCallback(
    (ctx: AudioContext, b64: string): Promise<void> => {
      return new Promise((resolve) => {
        let binary: string;
        try {
          binary = atob(b64);
        } catch {
          resolve();
          return;
        }
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        void ctx.decodeAudioData(bytes.buffer.slice(0)).then(
          (buf) => {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            currentSourcesRef.current.push(src);
            ttsPlayingRef.current = true;
            setTtsActive(true);
            src.onended = () => {
              currentSourcesRef.current = currentSourcesRef.current.filter((x) => x !== src);
              if (currentSourcesRef.current.length === 0) {
                ttsPlayingRef.current = false;
                setTtsActive(false);
              }
              resolve();
            };
            src.start();
          },
          () => resolve()
        );
      });
    },
    []
  );

  const enqueueTtsAudio = useCallback(
    (b64: string) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      playChainRef.current = playChainRef.current.then(() => decodeAndStart(ctx, b64));
    },
    [decodeAndStart]
  );

  useEffect(() => {
    if (!enabled) {
      onInterimChangeRef.current(null);
      setVoiceError(null);
      setSttReady(false);
      setTtsReady(false);
      setTtsActive(false);
      stopPlayback();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      processorRef.current?.disconnect();
      processorRef.current = null;
      analyserRef.current?.disconnect();
      analyserRef.current = null;
      micSourceRef.current?.disconnect();
      micSourceRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = stream;

        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        await ctx.resume();
        const source = ctx.createMediaStreamSource(stream);
        micSourceRef.current = source;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyserRef.current = analyser;
        source.connect(analyser);

        const proc = ctx.createScriptProcessor(4096, 1, 1);
        processorRef.current = proc;
        proc.onaudioprocess = (ev) => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const input = ev.inputBuffer.getChannelData(0);
          const pcm = downsampleTo16kInt16(input, ctx.sampleRate);
          if (pcm.byteLength) {
            ws.send(pcm.buffer.slice(0, pcm.byteLength));
          }
        };
        source.connect(proc);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        proc.connect(mute);
        mute.connect(ctx.destination);

        const ws = new WebSocket(voiceWebSocketUrl());
        wsRef.current = ws;
        ws.binaryType = "arraybuffer";

        ws.onmessage = (ev) => {
          let msg: ServerMsg;
          try {
            msg = JSON.parse(String(ev.data)) as ServerMsg;
          } catch {
            return;
          }
          if (msg.type === "voice_ready") {
            setSttReady(msg.stt);
            setTtsReady(msg.tts);
            const parts: string[] = [];
            if (!msg.stt) {
              parts.push("STT: set VOSK_MODEL_PATH to a Vosk model folder, pip install vosk, VOICE_PYTHON if needed");
            }
            if (!msg.tts) {
              parts.push("TTS: set PIPER_EXECUTABLE and PIPER_MODEL_PATH or PIPER_RU_MODEL (.onnx)");
            }
            setVoiceError(parts.length ? parts.join(" · ") : null);
            return;
          }
          if (msg.type === "stt_error") {
            setVoiceError(msg.message);
            return;
          }
          if (msg.type === "stt_partial") {
            onInterimChangeRef.current(msg.text || null);
            return;
          }
          if (msg.type === "stt_final") {
            const t = (msg.text || "").trim();
            onInterimChangeRef.current(null);
            if (t) {
              void appendRef.current({ role: "user", content: t }, { body: chatBodyRef.current });
            }
            return;
          }
          if (msg.type === "tts_audio" && msg.format === "wav") {
            enqueueTtsAudio(msg.data);
            return;
          }
          if (msg.type === "tts_error") {
            console.warn("[tts]", msg.message);
          }
        };

        ws.onerror = () => {
          setVoiceError("Voice WebSocket error");
        };

        ws.onclose = () => {
          if (!cancelled) setVoiceError((prev) => prev ?? "Voice connection closed");
        };

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const bargeLoop = () => {
          rafRef.current = requestAnimationFrame(bargeLoop);
          if (!ttsPlayingRef.current) {
            bargeSinceRef.current = null;
            return;
          }
          analyser.getByteTimeDomainData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const v = (dataArray[i]! - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const now = performance.now();
          if (rms > BARGE_RMS) {
            if (bargeSinceRef.current === null) bargeSinceRef.current = now;
            else if (now - bargeSinceRef.current > BARGE_MS) {
              bargeSinceRef.current = null;
              stopPlayback();
              playChainRef.current = Promise.resolve();
            }
          } else {
            bargeSinceRef.current = null;
          }
        };
        bargeLoop();
      } catch (e) {
        setVoiceError(String(e));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [enabled, stopPlayback, enqueueTtsAudio]);

  const liveState = useMemo((): LiveVoiceState => {
    if (!enabled) return "idle";
    if (status === "submitted" || status === "streaming") return "thinking";
    if (ttsActive) return "speaking";
    return "listening";
  }, [enabled, status, ttsActive]);

  useEffect(() => {
    if (!enabled) return;

    const assistants = messages.filter((m) => m.role === "assistant");
    const lastA = assistants[assistants.length - 1];
    if (!lastA?.id) {
      return;
    }

    if (lastA.id !== lastAssistantIdRef.current) {
      lastAssistantIdRef.current = lastA.id;
      ttsCursorRef.current = 0;
    }

    const text = assistantSpeakableText(lastA);
    const busy = status === "submitted" || status === "streaming";

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !ttsReady) return;

    const { sentences, nextCursor } = pullCompleteSentences(text, ttsCursorRef.current);
    ttsCursorRef.current = nextCursor;

    for (const s of sentences) {
      const id = ++ttsIdRef.current;
      ws.send(JSON.stringify({ type: "tts", text: s, id }));
    }

    if (!busy && ttsCursorRef.current < text.length) {
      const rest = text.slice(ttsCursorRef.current).trim();
      if (rest) {
        const id = ++ttsIdRef.current;
        ws.send(JSON.stringify({ type: "tts", text: rest, id }));
        ttsCursorRef.current = text.length;
      }
    }
  }, [enabled, messages, status, ttsReady]);

  useEffect(() => {
    if (enabled && !enabledPrevRef.current) {
      const assistants = messages.filter((m) => m.role === "assistant");
      const lastA = assistants[assistants.length - 1];
      if (lastA?.id) {
        lastAssistantIdRef.current = lastA.id;
        ttsCursorRef.current = assistantSpeakableText(lastA).length;
      } else {
        lastAssistantIdRef.current = null;
        ttsCursorRef.current = 0;
      }
    }
    if (!enabled) {
      lastAssistantIdRef.current = null;
      ttsCursorRef.current = 0;
    }
    enabledPrevRef.current = enabled;
  }, [enabled, messages]);

  return { liveState, voiceError, sttReady, ttsReady };
}
