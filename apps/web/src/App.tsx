import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLiveVoice } from "./liveVoice/useLiveVoice.ts";
import "./App.css";

const LS_PROFILE = "helper-active-profile";
const LS_UI_LANG = "helper-ui-lang";
const LS_PROFILE_VOICE_MAP = "helper-profile-voice-map";
const LS_PROFILE_CHATS = "helper-profile-chats";

type UiLang = "ru" | "en";
type TtsVoice = string;

const UI_TEXT: Record<
  UiLang,
  {
    model: string;
    memoryProfile: string;
    settings: string;
    uiLanguage: string;
    ttsVoice: string;
    ttsVoiceHint: string;
    thinkingInline: string;
    thinkingDetails: string;
    close: string;
    liveOff: string;
    liveOn: string;
    voiceOutputOn: string;
    voiceOutputOff: string;
    recordStart: string;
    recordStop: string;
    voiceLabel: string;
    listening: string;
    thinking: string;
    speaking: string;
    ready: string;
    messagePlaceholder: string;
    send: string;
    stop: string;
    contextAnalytics: string;
    contextAnalyticsOpen: string;
    contextAnalyticsClose: string;
    estContextUsed: string;
    estContextLimit: string;
    estContextLeft: string;
    contextRisk: string;
    resolvedModel: string;
    selectedModel: string;
    modelUsageSession: string;
    lastRequestUsage: string;
    promptTokens: string;
    completionTokens: string;
    totalTokens: string;
    memoryInjected: string;
    memoryHits: string;
    mem0Usage: string;
    mem0Rows: string;
    mem0Chars: string;
    mem0ApproxTokens: string;
    mem0Note: string;
    analyticsProfileOwner: string;
    analyticsProfileStatus: string;
    analyticsProfileStatusCurrent: string;
    analyticsProfileStatusStale: string;
    analyticsWarningHigh: string;
    analyticsWarningMedium: string;
    analyticsWarningLow: string;
    analyticsEstimateNote: string;
    memoryTab: string;
    mcpTab: string;
  }
> = {
  ru: {
    model: "Модель",
    memoryProfile: "Профиль памяти",
    settings: "Настройки",
    uiLanguage: "Язык интерфейса",
    ttsVoice: "Голос ассистента",
    ttsVoiceHint: "Качественные офлайн-голоса (RU, живее и естественнее)",
    thinkingInline: "Размышляет...",
    thinkingDetails: "Ход рассуждений",
    close: "Закрыть",
    liveOff: "Голосовой чат",
    liveOn: "Голосовой чат · вкл",
    voiceOutputOn: "Голос: вкл",
    voiceOutputOff: "Голос: выкл",
    recordStart: "Начать запись",
    recordStop: "Остановить запись",
    voiceLabel: "Голос",
    listening: "слушает",
    thinking: "думает...",
    speaking: "говорит...",
    ready: "Готово",
    messagePlaceholder: "Сообщение...",
    send: "Отправить",
    stop: "Стоп",
    contextAnalytics: "Аналитика контекста",
    contextAnalyticsOpen: "Показать аналитику",
    contextAnalyticsClose: "Скрыть аналитику",
    estContextUsed: "Оценка занято",
    estContextLimit: "Лимит модели",
    estContextLeft: "Осталось до лимита",
    contextRisk: "Риск упереться в лимит",
    resolvedModel: "Фактическая модель",
    selectedModel: "Выбранная модель",
    modelUsageSession: "Модели в текущей сессии",
    lastRequestUsage: "Последний запрос (точно)",
    promptTokens: "Prompt tokens",
    completionTokens: "Completion tokens",
    totalTokens: "Total tokens",
    memoryInjected: "Инжектировано памяти (симв.)",
    memoryHits: "Попало записей mem0",
    mem0Usage: "Использование mem0 (профиль)",
    mem0Rows: "Записей",
    mem0Chars: "Символов",
    mem0ApproxTokens: "Оценка токенов",
    mem0Note:
      "mem0 хранится отдельно и почти не ограничен по объему, но в контекст попадает лишь небольшая выборка.",
    analyticsProfileOwner: "Владелец данных",
    analyticsProfileStatus: "Статус данных",
    analyticsProfileStatusCurrent: "Текущий профиль",
    analyticsProfileStatusStale: "Не совпадает с выбранным профилем",
    analyticsWarningHigh: "Высокий",
    analyticsWarningMedium: "Средний",
    analyticsWarningLow: "Низкий",
    analyticsEstimateNote: "Все значения по токенам оценочные.",
    memoryTab: "Память",
    mcpTab: "MCP",
  },
  en: {
    model: "Model",
    memoryProfile: "Memory profile",
    settings: "Settings",
    uiLanguage: "Interface language",
    ttsVoice: "Assistant voice",
    ttsVoiceHint: "High-quality offline voices (RU, more natural and lively)",
    thinkingInline: "Thinking...",
    thinkingDetails: "Reasoning",
    close: "Close",
    liveOff: "Voice chat",
    liveOn: "Voice chat · on",
    voiceOutputOn: "Voice output: on",
    voiceOutputOff: "Voice output: off",
    recordStart: "Start recording",
    recordStop: "Stop recording",
    voiceLabel: "Voice",
    listening: "listening",
    thinking: "thinking...",
    speaking: "speaking...",
    ready: "Ready",
    messagePlaceholder: "Message...",
    send: "Send",
    stop: "Stop",
    contextAnalytics: "Context analytics",
    contextAnalyticsOpen: "Show analytics",
    contextAnalyticsClose: "Hide analytics",
    estContextUsed: "Estimated used",
    estContextLimit: "Model limit",
    estContextLeft: "Remaining to limit",
    contextRisk: "Context overflow risk",
    resolvedModel: "Resolved model",
    selectedModel: "Selected model",
    modelUsageSession: "Models used in this session",
    lastRequestUsage: "Last request (exact)",
    promptTokens: "Prompt tokens",
    completionTokens: "Completion tokens",
    totalTokens: "Total tokens",
    memoryInjected: "Injected memory (chars)",
    memoryHits: "Injected mem0 entries",
    mem0Usage: "mem0 usage (profile)",
    mem0Rows: "Entries",
    mem0Chars: "Chars",
    mem0ApproxTokens: "Approx tokens",
    mem0Note:
      "mem0 is stored outside model context and is practically unbounded, but only a small subset is injected per request.",
    analyticsProfileOwner: "Data owner",
    analyticsProfileStatus: "Data status",
    analyticsProfileStatusCurrent: "Current profile",
    analyticsProfileStatusStale: "Does not match selected profile",
    analyticsWarningHigh: "High",
    analyticsWarningMedium: "Medium",
    analyticsWarningLow: "Low",
    analyticsEstimateNote: "Token metrics are approximate.",
    memoryTab: "Memory",
    mcpTab: "MCP",
  },
};

type Profile = {
  id: string;
  name: string;
  mem0UserId: string;
};

type TogetherModel = {
  id: string;
  display_name?: string | null;
};

type McpServer = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
};

type MemoryRow = { id: string; memory: string; score?: number };
type UsageSnapshot = {
  ts: string;
  resolvedModel: string;
  tier?: string;
  profileId: string | null;
  messageCount: number;
  lastUserChars: number;
  memoryHits: number;
  memoryBlockChars: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};
const DEFAULT_CONTEXT_WINDOW = 8192;
const MODEL_CONTEXT_HINTS: Array<{ re: RegExp; tokens: number }> = [
  { re: /gpt-4\.1|gpt-4o|o4|o3/i, tokens: 128000 },
  { re: /gpt-oss-20b/i, tokens: 32768 },
  { re: /gemma-3n/i, tokens: 32768 },
  { re: /qwen3|qwen2\.5|qwen/i, tokens: 32768 },
  { re: /llama-3\.3|llama-3\.1/i, tokens: 131072 },
  { re: /mistral|mixtral/i, tokens: 32768 },
];

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

function estimateModelContextWindow(modelId: string | undefined): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;
  const hit = MODEL_CONTEXT_HINTS.find((x) => x.re.test(modelId));
  return hit?.tokens ?? DEFAULT_CONTEXT_WINDOW;
}

function prettyNum(value: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.round(value)));
}

function loadProfileChatsFromStorage(): Record<string, unknown[]> {
  try {
    const raw = localStorage.getItem(LS_PROFILE_CHATS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, unknown[]> = {};
    for (const [profileId, maybeMsgs] of Object.entries(parsed)) {
      if (!Array.isArray(maybeMsgs)) continue;
      const msgs = maybeMsgs.filter((m) => typeof m === "object" && m !== null);
      out[profileId] = msgs;
    }
    return out;
  } catch {
    return {};
  }
}

function messageText(m: { content?: string; parts?: Array<{ type: string; text?: string }> }) {
  if (m.parts?.length) {
    return m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
      .map((p) => p.text)
      .join("");
  }
  return m.content ?? "";
}

function stripAgentArtifacts(text: string): string {
  if (!text) return "";
  let out = text;
  // Remove leaked internal control tokens/tool-call wrappers from model output.
  out = out.replace(/<\|start\|>assistant[\s\S]*?<\|call\|>/gi, "");
  out = out.replace(/<\|channel\|>commentary[\s\S]*?(?=(<\|start\|>assistant|$))/gi, "");
  out = out.replace(/<\|constrain\|>json/gi, "");
  out = out.replace(/<\|message\|>\{[\s\S]*?\}/gi, "");
  out = out.replace(/to=use_other_model/gi, "");
  out = out.replace(/<\|[^|]+?\|>/g, "");
  // Collapse excessive blank lines after cleanup.
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

function partText(part: Record<string, unknown>): string {
  const candidates = [part.text, part.reasoning, part.content, part.value];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function collectReasoning(parts: Array<Record<string, unknown>> | null): string {
  if (!parts) return "";
  return parts
    .filter((p) => String(p.type || "") === "reasoning")
    .map((p) => partText(p))
    .filter(Boolean)
    .join("\n");
}

function MessageMarkdown({ text }: { text: string }) {
  const cleaned = stripAgentArtifacts(text);
  if (!cleaned) return null;
  return (
    <div className="msg-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
    </div>
  );
}
const MemoMessageMarkdown = memo(MessageMarkdown);

export default function App() {
  const [models, setModels] = useState<TogetherModel[]>([]);
  const [modelChoice, setModelChoice] = useState<string>("auto");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [memoryRows, setMemoryRows] = useState<MemoryRow[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [mcpForm, setMcpForm] = useState({
    name: "",
    transport: "http" as "http" | "stdio",
    url: "",
    command: "",
    args: "",
    enabled: true,
  });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [liveSpeech, setLiveSpeech] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [ttsOutputEnabled, setTtsOutputEnabled] = useState(true);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceInterim, setVoiceInterim] = useState<string | null>(null);
  const [uiLang, setUiLang] = useState<UiLang>(() => {
    const stored = localStorage.getItem(LS_UI_LANG);
    return stored === "ru" || stored === "en" ? stored : "ru";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [resolvedModelId, setResolvedModelId] = useState<string | null>(null);
  const [resolvedTier, setResolvedTier] = useState<string | null>(null);
  const [usedModels, setUsedModels] = useState<string[]>([]);
  const [lastUsage, setLastUsage] = useState<UsageSnapshot | null>(null);
  const usedModelsByProfileRef = useRef<Record<string, string[]>>({});
  const [profileVoiceMap, setProfileVoiceMap] = useState<Record<string, TtsVoice>>(() => {
    try {
      const raw = localStorage.getItem(LS_PROFILE_VOICE_MAP);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, string>;
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "string" && v.trim().length > 0)
      ) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [reasoningByMessageId, setReasoningByMessageId] = useState<Record<string, string>>({});

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null,
    [profiles, activeProfileId]
  );

  const activeBrowserVoiceUri: string = activeProfile?.id ? profileVoiceMap[activeProfile.id] ?? "" : "";

  const { messages, input, handleInputChange, handleSubmit, status, error, stop, setMessages, append } =
    useChat({
      api: "/api/chat",
      body: {
        model: modelChoice,
        profileId: activeProfile?.id,
      },
      onResponse: (response) => {
        const resolved = response.headers.get("x-helper-resolved-model");
        const tier = response.headers.get("x-helper-tier");
        if (resolved) {
          setResolvedModelId(resolved);
          setUsedModels((prev) => {
            const next = prev.includes(resolved) ? prev : [...prev, resolved];
            if (activeProfile?.id) {
              usedModelsByProfileRef.current[activeProfile.id] = next;
            }
            return next;
          });
        }
        if (tier) setResolvedTier(tier);
      },
    });
  const busy = status === "submitted" || status === "streaming";

  const { liveState, voiceError: liveVoiceError, sttReady, ttsReady } = useLiveVoice({
    enabled: liveSpeech,
    microphoneEnabled: recordingEnabled,
    browserTtsVoiceUri: activeBrowserVoiceUri,
    ttsEnabled: ttsOutputEnabled,
    append,
    chatBody: { model: modelChoice, profileId: activeProfile?.id },
    messages,
    status,
    onInterimChange: setVoiceInterim,
  });

  const loadModels = useCallback(async () => {
    try {
      const r = await fetch("/api/models");
      if (!r.ok) return;
      const j = (await r.json()) as { models?: TogetherModel[] };
      if (j.models) setModels(j.models);
    } catch {
      /* ignore */
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    const r = await fetch("/api/profiles");
    if (!r.ok) return;
    const j = (await r.json()) as { profiles: Profile[] };
    const list = j.profiles;
    setProfiles(list);
    const fromLs = localStorage.getItem(LS_PROFILE);
    if (fromLs && list.some((p) => p.id === fromLs)) {
      setActiveProfileId(fromLs);
    } else if (list[0]) {
      setActiveProfileId(list[0].id);
      localStorage.setItem(LS_PROFILE, list[0].id);
    }
    setProfilesLoaded(true);
  }, []);

  const loadMemory = useCallback(async () => {
    if (!activeProfile) return;
    const r = await fetch(
      `/api/memory?userId=${encodeURIComponent(activeProfile.mem0UserId)}`
    );
    if (!r.ok) return;
    const j = (await r.json()) as { results?: MemoryRow[] };
    setMemoryRows(j.results ?? []);
  }, [activeProfile]);

  const loadMcp = useCallback(async () => {
    const r = await fetch("/api/mcp/servers");
    if (!r.ok) return;
    const j = (await r.json()) as { servers?: McpServer[] };
    setMcpServers(j.servers ?? []);
  }, []);

  const loadUsage = useCallback(async () => {
    const query = activeProfileId ? `?profileId=${encodeURIComponent(activeProfileId)}` : "";
    const r = await fetch(`/api/chat/usage${query}`);
    if (!r.ok) return;
    const j = (await r.json()) as { usage?: UsageSnapshot | null };
    setLastUsage(j.usage ?? null);
  }, [activeProfileId]);

  useEffect(() => {
    localStorage.setItem(LS_UI_LANG, uiLang);
  }, [uiLang]);

  useEffect(() => {
    localStorage.setItem(LS_PROFILE_VOICE_MAP, JSON.stringify(profileVoiceMap));
  }, [profileVoiceMap]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const refresh = () => {
      const voices = synth.getVoices();
      setBrowserVoices(voices);
    };
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => synth.removeEventListener("voiceschanged", refresh);
  }, []);

  useEffect(() => {
    if (!activeProfile?.id) return;
    if (profileVoiceMap[activeProfile.id]) return;
    if (!browserVoices.length) return;
    const bilingual =
      browserVoices.find((v) => /multilingual|bilingual|samantha|zira|aria|natasha/i.test(v.name)) ||
      browserVoices.find((v) => /ru|en/i.test(v.lang)) ||
      browserVoices[0];
    if (!bilingual?.voiceURI) return;
    const timer = window.setTimeout(() => {
      setProfileVoiceMap((prev) => ({ ...prev, [activeProfile.id!]: bilingual.voiceURI }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeProfile?.id, profileVoiceMap, browserVoices]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadModels();
      void loadProfiles();
      void loadMcp();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadModels, loadProfiles, loadMcp]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMemory();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMemory, activeProfile?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsage();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadUsage, activeProfile?.id]);

  useEffect(() => {
    if (busy) return;
    const timer = window.setTimeout(() => {
      void loadUsage();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [busy, loadUsage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setReasoningByMessageId((prev) => {
        const next: Record<string, string> = {};
        for (const m of messages) {
          if (m.role !== "assistant" || !m.id) continue;
          const parts = (m.parts?.length ? m.parts : null) as Array<Record<string, unknown>> | null;
          const now = collectReasoning(parts);
          if (now) {
            next[m.id] = now;
            continue;
          }
          if (prev[m.id]) {
            next[m.id] = prev[m.id];
          }
        }
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length === nextKeys.length && prevKeys.every((k) => prev[k] === next[k])) {
          return prev;
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [messages]);

  const profileChatsRef = useRef<Record<string, unknown[]>>(loadProfileChatsFromStorage());
  const prevProfileIdRef = useRef<string | null>(null);
  const hydratedChatProfilesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentId = activeProfile?.id ?? null;
    if (!currentId) return;
    if (!hydratedChatProfilesRef.current.has(currentId)) return;
    // During profile switch, messages still belong to the previous profile
    // for one render. Avoid writing old messages into the newly selected profile.
    if (prevProfileIdRef.current && prevProfileIdRef.current !== currentId) return;
    profileChatsRef.current[currentId] = messages;
    localStorage.setItem(LS_PROFILE_CHATS, JSON.stringify(profileChatsRef.current));
  }, [messages, activeProfile?.id]);

  useEffect(() => {
    const nextId = activeProfile?.id ?? null;
    const prevId = prevProfileIdRef.current;
    let timer: number | null = null;
    if (prevId && prevId !== nextId) {
      profileChatsRef.current[prevId] = messages;
      hydratedChatProfilesRef.current.add(prevId);
    }
    if (nextId && prevId !== nextId) {
      setMessages((profileChatsRef.current[nextId] ?? []) as Parameters<typeof setMessages>[0]);
      hydratedChatProfilesRef.current.add(nextId);
      timer = window.setTimeout(() => {
        setLastUsage(null);
        setResolvedModelId(null);
        setResolvedTier(null);
        setUsedModels(usedModelsByProfileRef.current[nextId] ?? []);
      }, 0);
    }
    prevProfileIdRef.current = nextId;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeProfile?.id, messages, setMessages]);

  useEffect(() => {
    if (!activeProfileId) return;
    if (!lastUsage) return;
    if (lastUsage.profileId !== activeProfileId) return;
    const timer = window.setTimeout(() => {
      setResolvedModelId(lastUsage.resolvedModel ?? null);
      setResolvedTier(lastUsage.tier ?? null);
      setUsedModels((prev) => {
        const next = lastUsage.resolvedModel
          ? prev.includes(lastUsage.resolvedModel)
            ? prev
            : [...prev, lastUsage.resolvedModel]
          : prev;
        usedModelsByProfileRef.current[activeProfileId] = next;
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [lastUsage, activeProfileId]);

  useEffect(() => {
    if (!profilesLoaded) return;
    const validIds = new Set(profiles.map((p) => p.id));
    for (const k of Object.keys(profileChatsRef.current)) {
      if (!validIds.has(k)) {
        delete profileChatsRef.current[k];
      }
    }
    localStorage.setItem(LS_PROFILE_CHATS, JSON.stringify(profileChatsRef.current));

    const timer = window.setTimeout(() => {
      setProfileVoiceMap((prev) => {
        const next: Record<string, TtsVoice> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (validIds.has(k)) next[k] = v;
        }
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [profiles, profilesLoaded]);

  const onProfileChange = (id: string) => {
    setActiveProfileId(id);
    localStorage.setItem(LS_PROFILE, id);
  };

  const addProfile = async () => {
    const name = newProfileName.trim() || "Profile";
    const r = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const p = await r.json();
    setNewProfileName("");
    await loadProfiles();
    onProfileChange(p.id);
  };

  const renameProfile = async (id: string, name: string) => {
    await fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadProfiles();
  };

  const removeProfile = async (id: string) => {
    if (!confirm("Delete this profile and its stored memories?")) return;
    await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    delete profileChatsRef.current[id];
    localStorage.setItem(LS_PROFILE_CHATS, JSON.stringify(profileChatsRef.current));
    setProfileVoiceMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await loadProfiles();
    const next = profiles.find((p) => p.id !== id);
    if (next) onProfileChange(next.id);
  };

  const saveMemory = async (id: string, text: string) => {
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await loadMemory();
  };

  const removeMemory = async (id: string) => {
    if (!confirm("Delete this memory?")) return;
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    await loadMemory();
  };

  const saveMcp = async () => {
    const args = mcpForm.args
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await fetch("/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: mcpForm.name.trim() || "MCP",
        enabled: mcpForm.enabled,
        transport: mcpForm.transport,
        url: mcpForm.transport === "http" ? mcpForm.url.trim() : undefined,
        command: mcpForm.transport === "stdio" ? mcpForm.command.trim() : undefined,
        args: mcpForm.transport === "stdio" ? args : undefined,
      }),
    });
    setMcpForm({ name: "", transport: mcpForm.transport, url: "", command: "", args: "", enabled: true });
    await loadMcp();
  };

  const testMcp = async (id: string) => {
    setTestResult(null);
    const r = await fetch(`/api/mcp/servers/${id}/test`, { method: "POST" });
    const j = await r.json();
    setTestResult(JSON.stringify(j, null, 2));
  };

  const deleteMcp = async (id: string) => {
    if (!confirm("Remove this MCP server?")) return;
    await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
    await loadMcp();
    setTestResult(null);
  };

  const tx = UI_TEXT[uiLang];
  const selectedModelLabel = modelChoice === "auto" ? "auto" : modelChoice;
  const effectiveModelId = resolvedModelId ?? (modelChoice !== "auto" ? modelChoice : undefined);
  const contextWindow = estimateModelContextWindow(effectiveModelId);
  const messagesTokenEstimate = useMemo(
    () =>
      messages.reduce((sum, m) => {
        const roleOverhead = 8;
        return sum + roleOverhead + estimateTokens(messageText(m));
      }, 0),
    [messages]
  );
  const mem0Chars = useMemo(() => memoryRows.reduce((sum, row) => sum + (row.memory?.length ?? 0), 0), [memoryRows]);
  const mem0TokensApprox = useMemo(() => Math.ceil(mem0Chars / 4), [mem0Chars]);
  const mem0InjectedApprox = useMemo(() => {
    if (!memoryRows.length) return 0;
    const avgRowTokens = Math.max(1, Math.ceil(mem0TokensApprox / memoryRows.length));
    return Math.min(12, memoryRows.length) * avgRowTokens + 60;
  }, [memoryRows.length, mem0TokensApprox]);
  const systemAndToolsOverhead = 220;
  const precisePromptTokens = lastUsage?.promptTokens ?? null;
  const totalContextUsed =
    precisePromptTokens !== null ? precisePromptTokens : messagesTokenEstimate + mem0InjectedApprox + systemAndToolsOverhead;
  const totalContextLeft = Math.max(0, contextWindow - totalContextUsed);
  const fillRatio = contextWindow ? totalContextUsed / contextWindow : 0;
  const riskLevel =
    fillRatio >= 0.82 ? tx.analyticsWarningHigh : fillRatio >= 0.62 ? tx.analyticsWarningMedium : tx.analyticsWarningLow;
  const usageOwnerProfile =
    (lastUsage?.profileId && profiles.find((p) => p.id === lastUsage.profileId)) ?? null;
  const usageOwnerLabel = usageOwnerProfile
    ? `${usageOwnerProfile.name} (${usageOwnerProfile.id.slice(0, 8)}...)`
    : lastUsage?.profileId
      ? `${lastUsage.profileId.slice(0, 8)}...`
      : "—";
  const usageMatchesSelected = !!activeProfile?.id && lastUsage?.profileId === activeProfile.id;
  const submitFromComposer = (e: React.FormEvent<HTMLFormElement>) => {
    setVoiceInterim(null);
    handleSubmit(e);
  };
  const setVoiceForActiveProfile = (voiceUri: string) => {
    if (!activeProfile?.id) return;
    setProfileVoiceMap((prev) => ({ ...prev, [activeProfile.id]: voiceUri }));
  };

  return (
    <>
      <div className="layout">
      <main className="chat-main">
        <header className="top">
          <h1>Helper</h1>
          <label>
            {tx.model}
            <select
              className="model-select"
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
            >
              <option value="auto">Auto (cost-aware)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name || m.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tx.memoryProfile}
            <select
              className="model-select"
              value={activeProfile?.id ?? ""}
              onChange={(e) => onProfileChange(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="small icon-button"
            onClick={() => {
              void loadMemory();
              setMemoriesOpen(true);
            }}
            title={tx.memoryTab}
            aria-label={tx.memoryTab}
          >
            🧠
          </button>
          <button
            type="button"
            className="small icon-button"
            onClick={() => setMcpOpen(true)}
            title={tx.mcpTab}
            aria-label={tx.mcpTab}
          >
            🧩
          </button>
          <button
            type="button"
            className="small icon-button"
            onClick={() => setSettingsOpen(true)}
            title={tx.settings}
            aria-label={tx.settings}
          >
            ⚙
          </button>
          <button
            type="button"
            className={liveSpeech ? "small live-speech on" : "small live-speech"}
            onClick={() =>
              setLiveSpeech((v) => {
                const next = !v;
                if (!next) {
                  setRecordingEnabled(false);
                  setVoiceInterim(null);
                }
                return next;
              })
            }
            title={tx.liveOff}
          >
            {liveSpeech ? tx.liveOn : tx.liveOff}
          </button>
          {liveSpeech && (
            <button
              type="button"
              className={ttsOutputEnabled ? "small voice-output-toggle on" : "small voice-output-toggle off"}
              onClick={() => setTtsOutputEnabled((v) => !v)}
              title={ttsOutputEnabled ? tx.voiceOutputOn : tx.voiceOutputOff}
              aria-label={ttsOutputEnabled ? tx.voiceOutputOn : tx.voiceOutputOff}
            >
              <span className="voice-output-icon" aria-hidden="true">
                🔊
              </span>
            </button>
          )}
        </header>
        {error && (
          <div className="error-banner">{error.message || String(error)}</div>
        )}
        {liveSpeech && liveVoiceError && (
          <div className="error-banner voice-hint">{liveVoiceError}</div>
        )}
        <div className="status">
          {liveSpeech ? (
            <>
              {tx.voiceLabel}: {liveState === "idle" && "…"}
              {liveState === "listening" && tx.listening}
              {liveState === "thinking" && tx.thinking}
              {liveState === "speaking" && tx.speaking}
              <span className="muted">
                {" "}
                · STT {sttReady ? "ok" : "off"} · TTS {ttsReady && ttsOutputEnabled ? "on (browser)" : "off"} · REC{" "}
                {recordingEnabled ? "on" : "off"}
              </span>
            </>
          ) : busy ? (
            tx.thinking
          ) : (
            tx.ready
          )}
          {!liveSpeech && modelChoice === "auto" && !busy && (
            <span className="muted"> — auto picks tier via small classifier</span>
          )}
        </div>
        {!liveSpeech && busy && (
          <div className="thinking-banner" aria-live="polite">
            <span className="thinking-spinner" aria-hidden="true" />
            <span>{tx.thinkingInline}</span>
          </div>
        )}
        <div className="messages">
          {messages.map((m, idx) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="msg-role">{m.role}</div>
              {m.role === "assistant" && idx === messages.length - 1 && busy && (
                <div className="thinking-inline">{tx.thinkingInline}</div>
              )}
              {m.role === "assistant" &&
                (() => {
                  const parts = (m.parts?.length ? m.parts : null) as
                    | Array<Record<string, unknown>>
                    | null;
                  const reasoning = collectReasoning(parts) || (m.id ? reasoningByMessageId[m.id] ?? "" : "");
                  if (!reasoning) return null;
                  const isLatestAssistant = idx === messages.length - 1;
                  const isThinkingNow = isLatestAssistant && busy;
                  return (
                    <details className="reasoning-block" open={isThinkingNow}>
                      <summary>
                        {tx.thinkingDetails}
                        {isThinkingNow ? ` · ${tx.thinkingInline}` : ""}
                      </summary>
                      <pre>{reasoning}</pre>
                    </details>
                  );
                })()}
              {(m.parts?.length ? m.parts : null)?.map((part, i) => {
                if (part.type === "text") {
                  const partText = stripAgentArtifacts(part.text ?? "");
                  if (!partText) return null;
                  const isLatestAssistant = m.role === "assistant" && idx === messages.length - 1;
                  const isStreaming = busy && isLatestAssistant;
                  if (isStreaming) {
                    return (
                      <div key={i} className="msg-plain">
                        {partText}
                      </div>
                    );
                  }
                  return <MemoMessageMarkdown key={i} text={partText} />;
                }
                if (part.type === "reasoning") {
                  return null;
                }
                if (part.type === "tool-invocation") {
                  const t = part.toolInvocation as unknown as Record<string, unknown> & {
                    toolName?: string;
                    state?: string;
                  };
                  return (
                    <div key={i} className="tool-part">
                      <strong>{String(t.toolName ?? "?")}</strong> ({String(t.state ?? "")})
                      <pre style={{ margin: "0.35rem 0 0" }}>{JSON.stringify(t, null, 2)}</pre>
                    </div>
                  );
                }
                return null;
              }) ??
                (messageText(m) ? (
                  busy && m.role === "assistant" && idx === messages.length - 1 ? (
                    <div className="msg-plain">{stripAgentArtifacts(messageText(m))}</div>
                  ) : (
                    <MemoMessageMarkdown text={stripAgentArtifacts(messageText(m))} />
                  )
                ) : null)}
            </div>
          ))}
        </div>
        <div className="composer">
          {liveSpeech && recordingEnabled && voiceInterim && (
            <div className="voice-interim-inline">
              <span className="dot" aria-hidden="true" />
              <span>{voiceInterim}</span>
            </div>
          )}
          <div className={`analytics-drawer ${analyticsOpen ? "open" : ""}`}>
            <div className="analytics-grid">
              <div className="analytics-card">
                <h4>{tx.contextAnalytics}</h4>
                <div className="analytics-row">
                  <span>{tx.selectedModel}</span>
                  <strong>{selectedModelLabel}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.resolvedModel}</span>
                  <strong>{resolvedModelId ? `${resolvedModelId}${resolvedTier ? ` (${resolvedTier})` : ""}` : "—"}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.estContextUsed}</span>
                  <strong>{precisePromptTokens !== null ? prettyNum(totalContextUsed) : `~${prettyNum(totalContextUsed)}`}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.estContextLimit}</span>
                  <strong>{prettyNum(contextWindow)}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.estContextLeft}</span>
                  <strong>{prettyNum(totalContextLeft)}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.contextRisk}</span>
                  <strong>{riskLevel}</strong>
                </div>
              </div>
              <div className="analytics-card">
                <h4>{tx.lastRequestUsage}</h4>
                <div className="analytics-row">
                  <span>{tx.analyticsProfileOwner}</span>
                  <strong>{usageOwnerLabel}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.analyticsProfileStatus}</span>
                  <strong className={usageMatchesSelected ? "ok-text" : "warn-text"}>
                    {usageMatchesSelected ? tx.analyticsProfileStatusCurrent : tx.analyticsProfileStatusStale}
                  </strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.promptTokens}</span>
                  <strong>{lastUsage?.promptTokens !== null && lastUsage?.promptTokens !== undefined ? prettyNum(lastUsage.promptTokens) : "—"}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.completionTokens}</span>
                  <strong>{lastUsage?.completionTokens !== null && lastUsage?.completionTokens !== undefined ? prettyNum(lastUsage.completionTokens) : "—"}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.totalTokens}</span>
                  <strong>{lastUsage?.totalTokens !== null && lastUsage?.totalTokens !== undefined ? prettyNum(lastUsage.totalTokens) : "—"}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.memoryInjected}</span>
                  <strong>{lastUsage ? prettyNum(lastUsage.memoryBlockChars) : "—"}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.memoryHits}</span>
                  <strong>{lastUsage ? prettyNum(lastUsage.memoryHits) : "—"}</strong>
                </div>
              </div>
              <div className="analytics-card">
                <h4>{tx.mem0Usage}</h4>
                <div className="analytics-row">
                  <span>{tx.mem0Rows}</span>
                  <strong>{prettyNum(memoryRows.length)}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.mem0Chars}</span>
                  <strong>{prettyNum(mem0Chars)}</strong>
                </div>
                <div className="analytics-row">
                  <span>{tx.mem0ApproxTokens}</span>
                  <strong>~{prettyNum(mem0TokensApprox)}</strong>
                </div>
                <div className="analytics-row">
                  <span>mem0 in current prompt</span>
                  <strong>~{prettyNum(mem0InjectedApprox)}</strong>
                </div>
                <p className="muted">{tx.mem0Note}</p>
              </div>
              <div className="analytics-card">
                <h4>{tx.modelUsageSession}</h4>
                {usedModels.length ? (
                  <ul className="analytics-list">
                    {usedModels.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">—</p>
                )}
                <p className="muted">{tx.analyticsEstimateNote}</p>
              </div>
            </div>
          </div>
          <div className="analytics-toggle-row">
            <button
              type="button"
              className="small"
              onClick={() => setAnalyticsOpen((v) => !v)}
              aria-expanded={analyticsOpen}
            >
              {analyticsOpen ? tx.contextAnalyticsClose : tx.contextAnalyticsOpen}
            </button>
          </div>
          <form
            onSubmit={submitFromComposer}
          >
            <textarea
              value={input}
              onChange={handleInputChange}
              placeholder={tx.messagePlaceholder}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  setVoiceInterim(null);
                  handleSubmit(e);
                }
              }}
            />
            {busy ? (
              <button type="button" className="stop" onClick={() => stop()}>
                {tx.stop}
              </button>
            ) : (
              <>
                <button type="submit" className="send" disabled={!input.trim()}>
                  {tx.send}
                </button>
                {liveSpeech && (
                  <button
                    type="button"
                    className={recordingEnabled ? "voice-record-btn on" : "voice-record-btn off"}
                    onClick={() =>
                      setRecordingEnabled((v) => {
                        const next = !v;
                        if (!next) setVoiceInterim(null);
                        return next;
                      })
                    }
                    title={recordingEnabled ? tx.recordStop : tx.recordStart}
                    aria-label={recordingEnabled ? tx.recordStop : tx.recordStart}
                  >
                    {recordingEnabled ? "⏹" : "🎙"}
                  </button>
                )}
              </>
            )}
          </form>
        </div>
      </main>
      </div>
      {memoriesOpen && (
        <div className="modal-overlay" onClick={() => setMemoriesOpen(false)}>
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{tx.memoryTab}</h3>
              <button type="button" className="small" onClick={() => setMemoriesOpen(false)}>
                {tx.close}
              </button>
            </div>
            <p className="muted">Memories for the selected profile</p>
            <button type="button" className="small" onClick={() => void loadMemory()}>
              Refresh
            </button>
            {memoryRows.map((row) => (
              <MemoryRowEditor
                key={`${row.id}:${row.memory}`}
                row={row}
                onSave={(text) => void saveMemory(row.id, text)}
                onDelete={() => void removeMemory(row.id)}
              />
            ))}
            {!memoryRows.length && <p className="muted">No memories yet.</p>}
          </div>
        </div>
      )}
      {mcpOpen && (
        <div className="modal-overlay" onClick={() => setMcpOpen(false)}>
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{tx.mcpTab}</h3>
              <button type="button" className="small" onClick={() => setMcpOpen(false)}>
                {tx.close}
              </button>
            </div>
            <h3>Add MCP server</h3>
            <div className="row">
              <input
                type="text"
                placeholder="Display name"
                value={mcpForm.name}
                onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="row">
              <select
                value={mcpForm.transport}
                onChange={(e) =>
                  setMcpForm((f) => ({
                    ...f,
                    transport: e.target.value as "http" | "stdio",
                  }))
                }
              >
                <option value="http">HTTP (streamable)</option>
                <option value="stdio">stdio</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={mcpForm.enabled}
                  onChange={(e) => setMcpForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                enabled
              </label>
            </div>
            {mcpForm.transport === "http" ? (
              <div className="row">
                <input
                  type="text"
                  placeholder="MCP URL"
                  value={mcpForm.url}
                  onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))}
                  style={{ width: "100%" }}
                />
              </div>
            ) : (
              <>
                <div className="row">
                  <input
                    type="text"
                    placeholder="Command (e.g. npx)"
                    value={mcpForm.command}
                    onChange={(e) => setMcpForm((f) => ({ ...f, command: e.target.value }))}
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="row">
                  <input
                    type="text"
                    placeholder="Args (space-separated)"
                    value={mcpForm.args}
                    onChange={(e) => setMcpForm((f) => ({ ...f, args: e.target.value }))}
                    style={{ width: "100%" }}
                  />
                </div>
              </>
            )}
            <button type="button" className="small primary" onClick={() => void saveMcp()}>
              Save server
            </button>
            <h3 style={{ marginTop: "1rem" }}>Configured</h3>
            {mcpServers.map((s) => (
              <div key={s.id} className="mcp-item">
                <div>
                  <strong>{s.name}</strong>{" "}
                  <span className="muted">
                    {s.transport} {s.enabled ? "" : "(off)"}
                  </span>
                </div>
                <div className="row">
                  <button type="button" className="small" onClick={() => void testMcp(s.id)}>
                    Test / list tools
                  </button>
                  <button
                    type="button"
                    className="small danger"
                    onClick={() => void deleteMcp(s.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {testResult && (
              <pre className="tool-part" style={{ marginTop: "0.75rem" }}>
                {testResult}
              </pre>
            )}
          </div>
        </div>
      )}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{tx.settings}</h3>
              <button type="button" className="small" onClick={() => setSettingsOpen(false)}>
                {tx.close}
              </button>
            </div>
            <label className="modal-field">
              {tx.uiLanguage}
              <select
                className="model-select"
                value={uiLang}
                onChange={(e) => setUiLang(e.target.value as UiLang)}
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
            <h3 style={{ margin: "0.5rem 0" }}>Profiles</h3>
            <div className="row">
              <input
                type="text"
                placeholder="New profile name"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
              />
              <button type="button" className="small primary" onClick={() => void addProfile()}>
                Add
              </button>
            </div>
            {profiles.map((p) => (
              <div key={p.id} className="memory-item">
                <ProfileRow
                  key={`${p.id}:${p.name}`}
                  name={p.name}
                  onSave={(name) => void renameProfile(p.id, name)}
                  onDelete={() => void removeProfile(p.id)}
                />
              </div>
            ))}
            <label className="modal-field">
              {tx.ttsVoice}
              <select
                className="model-select"
                value={activeBrowserVoiceUri}
                onChange={(e) => setVoiceForActiveProfile(e.target.value)}
                disabled={!activeProfile?.id}
              >
                {!browserVoices.length && <option value="">No browser voices</option>}
                {browserVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <span className="muted">Uses your OS/Chrome voices for natural speech.</span>
            </label>
          </div>
        </div>
      )}
    </>
  );
}

function ProfileRow(props: {
  name: string;
  onSave: (name: string) => void;
  onDelete: () => void;
}) {
  const [v, setV] = useState(props.name);
  return (
    <div>
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="small" onClick={() => props.onSave(v)}>
        Save
      </button>
      <button type="button" className="small danger" onClick={props.onDelete}>
        Delete
      </button>
    </div>
  );
}

function MemoryRowEditor(props: {
  row: MemoryRow;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(props.row.memory);
  return (
    <div className="memory-item">
      <div className="muted" style={{ fontSize: "0.75rem" }}>
        {props.row.id.slice(0, 12)}… score: {props.row.score?.toFixed?.(3) ?? "—"}
      </div>
      <textarea className="edit" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button type="button" className="small primary" onClick={() => props.onSave(text)}>
          Update
        </button>
        <button type="button" className="small danger" onClick={props.onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
