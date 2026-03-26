import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type LiveVoiceState = "idle" | "listening" | "speaking" | "thinking";

type AppendFn = (
  message: { role: "user"; content: string },
  options?: { body?: Record<string, unknown> }
) => Promise<string | null | undefined>;

type BrowserSpeechResult = { isFinal: boolean; 0?: { transcript?: string } };
type BrowserSpeechEvent = Event & { resultIndex: number; results: ArrayLike<BrowserSpeechResult> };
type BrowserSpeechErrorEvent = Event & { error?: string };
type BrowserSpeechRecognition = {
  start: () => void;
  stop: () => void;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onresult: ((ev: BrowserSpeechEvent) => void) | null;
  onerror: ((ev: BrowserSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

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

export function useLiveVoice(options: {
  enabled: boolean;
  microphoneEnabled: boolean;
  browserTtsVoiceUri?: string;
  ttsEnabled: boolean;
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
  const { enabled, microphoneEnabled, browserTtsVoiceUri, ttsEnabled, append, chatBody, messages, status, onInterimChange } =
    options;

  const browserSttSupported = Boolean(
    (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  );

  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [sttReady, setSttReady] = useState(false);
  const [ttsReady, setTtsReady] = useState(false);
  const [ttsActive, setTtsActive] = useState(false);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const appendRef = useRef(append);
  const chatBodyRef = useRef(chatBody);
  const onInterimChangeRef = useRef(onInterimChange);
  const browserTtsVoiceUriRef = useRef(browserTtsVoiceUri ?? "");
  const lastAssistantIdRef = useRef<string | null>(null);
  const ttsCursorRef = useRef(0);
  const enabledPrevRef = useRef(false);

  const finalBufferRef = useRef("");
  const interimRef = useRef("");
  const pendingUtterancesRef = useRef<string[]>([]);
  const appendInFlightRef = useRef(false);

  useEffect(() => {
    appendRef.current = append;
    chatBodyRef.current = chatBody;
    onInterimChangeRef.current = onInterimChange;
    browserTtsVoiceUriRef.current = browserTtsVoiceUri ?? "";
  }, [append, chatBody, onInterimChange, browserTtsVoiceUri]);

  const sendUserUtterance = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (appendInFlightRef.current || status !== "ready") {
        pendingUtterancesRef.current.push(clean);
        return;
      }
      appendInFlightRef.current = true;
      try {
        await appendRef.current({ role: "user", content: clean }, { body: chatBodyRef.current });
      } catch (e) {
        pendingUtterancesRef.current.unshift(clean);
        setVoiceError(`Voice send failed: ${String(e)}`);
      } finally {
        appendInFlightRef.current = false;
      }
    },
    [status]
  );

  useEffect(() => {
    if (!enabled) {
      onInterimChangeRef.current(null);
      finalBufferRef.current = "";
      interimRef.current = "";
      setVoiceError(null);
      setTtsActive(false);
      try {
        window.speechSynthesis?.cancel?.();
      } catch {
        /* ignore */
      }
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
        recognitionRef.current = null;
      }
      return;
    }

    setSttReady(browserSttSupported);
    setTtsReady("speechSynthesis" in window);

    if (!browserSttSupported) {
      setVoiceError("Browser STT is unavailable in this browser.");
      return;
    }

    const Ctor = (
      (window as unknown as { SpeechRecognition?: new () => BrowserSpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition }).webkitSpeechRecognition
    ) as (new () => BrowserSpeechRecognition) | undefined;
    if (!Ctor) return;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = navigator.language?.toLowerCase().startsWith("ru") ? "ru-RU" : "en-US";
    let active = true;

    rec.onresult = (ev: BrowserSpeechEvent) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = String(r?.[0]?.transcript ?? "").trim();
        if (!t) continue;
        if (r.isFinal) finalBufferRef.current += `${t} `;
        else interim += `${t} `;
      }
      interimRef.current = interim.trim();
      onInterimChangeRef.current(interimRef.current || null);
    };

    rec.onerror = (ev: BrowserSpeechErrorEvent) => {
      setVoiceError(`Browser STT error: ${String(ev?.error ?? "unknown")}`);
    };

    rec.onend = () => {
      if (!active) return;
      if (!enabled || !microphoneEnabled) return;
      try {
        rec.start();
      } catch {
        /* ignore */
      }
    };

    recognitionRef.current = rec;
    if (microphoneEnabled) {
      try {
        rec.start();
      } catch {
        /* ignore */
      }
    }

    return () => {
      active = false;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      if (recognitionRef.current === rec) recognitionRef.current = null;
    };
  }, [enabled, browserSttSupported, microphoneEnabled]);

  useEffect(() => {
    if (!enabled) return;
    if (microphoneEnabled) {
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.start();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    const combined = `${finalBufferRef.current} ${interimRef.current}`.trim();
    finalBufferRef.current = "";
    interimRef.current = "";
    onInterimChangeRef.current(null);
    if (combined) {
      void sendUserUtterance(combined);
    }
  }, [enabled, microphoneEnabled, sendUserUtterance]);

  useEffect(() => {
    if (!enabled) return;
    if (status !== "ready") return;
    if (appendInFlightRef.current) return;
    const next = pendingUtterancesRef.current.shift();
    if (!next) return;
    void sendUserUtterance(next);
  }, [enabled, status, sendUserUtterance]);

  useEffect(() => {
    if (!ttsEnabled) {
      setTtsActive(false);
      try {
        window.speechSynthesis?.cancel?.();
      } catch {
        /* ignore */
      }
    }
  }, [ttsEnabled]);

  useEffect(() => {
    if (!enabled || !ttsEnabled || !ttsReady) return;
    const assistants = messages.filter((m) => m.role === "assistant");
    const lastA = assistants[assistants.length - 1];
    if (!lastA?.id) return;

    if (lastA.id !== lastAssistantIdRef.current) {
      lastAssistantIdRef.current = lastA.id;
      ttsCursorRef.current = 0;
    }

    const text = assistantSpeakableText(lastA);
    const busy = status === "submitted" || status === "streaming";
    if (!busy && ttsCursorRef.current < text.length) {
      const rest = text.slice(ttsCursorRef.current).trim();
      if (!rest) return;
      const utterance = new SpeechSynthesisUtterance(rest);
      utterance.lang = /[\u0400-\u04FF]/.test(rest) ? "ru-RU" : "en-US";
      const voices = window.speechSynthesis?.getVoices?.() ?? [];
      const byUri = browserTtsVoiceUriRef.current
        ? voices.find((v) => v.voiceURI === browserTtsVoiceUriRef.current)
        : null;
      if (byUri) utterance.voice = byUri;
      utterance.onstart = () => setTtsActive(true);
      utterance.onend = () => setTtsActive(false);
      utterance.onerror = () => setTtsActive(false);
      window.speechSynthesis?.speak?.(utterance);
      ttsCursorRef.current = text.length;
    }
  }, [enabled, ttsEnabled, ttsReady, messages, status]);

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

  const liveState = useMemo((): LiveVoiceState => {
    if (!enabled) return "idle";
    if (status === "submitted" || status === "streaming") return "thinking";
    if (ttsActive) return "speaking";
    return "listening";
  }, [enabled, status, ttsActive]);

  return { liveState, voiceError, sttReady, ttsReady };
}
