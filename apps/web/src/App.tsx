import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useLiveVoice } from "./liveVoice/useLiveVoice.ts";
import { UI_TEXT, type UiLang } from "./i18n/uiText";
import { useBackendData } from "./hooks/useBackendData";
import { MemoryModal } from "./components/MemoryModal";
import { McpModal } from "./components/McpModal";
import { SettingsModal } from "./components/SettingsModal";
import { ChatMessages, collectReasoning } from "./components/ChatMessages";
import { AnalyticsPanel } from "./components/AnalyticsPanel";
import type { TaskCategory } from "./types/appTypes";
import { formatPricePerMillion, useAnalyticsMetrics } from "./hooks/useAnalyticsMetrics";
import "./App.css";

const LS_UI_LANG = "helper-ui-lang";
const LS_PROFILE_VOICE_MAP = "helper-profile-voice-map";
const LS_PROFILE_CHATS = "helper-profile-chats";

type TtsVoice = string;

const TASK_CATEGORIES: TaskCategory[] = [
  "primary",
  "code_mcp",
  "reasoning",
  "vision",
  "image_gen",
  "audio",
  "memory",
];

const CATEGORY_I18N_KEY: Record<TaskCategory, keyof (typeof UI_TEXT)["ru"]> = {
  primary: "categoryPrimary",
  code_mcp: "categoryCodeMcp",
  reasoning: "categoryReasoning",
  vision: "categoryVision",
  image_gen: "categoryImageGen",
  audio: "categoryAudio",
  memory: "categoryMemory",
};
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

export default function App() {
  const [uiLang, setUiLang] = useState<UiLang>(() => {
    const stored = localStorage.getItem(LS_UI_LANG);
    return stored === "ru" || stored === "en" ? stored : "ru";
  });
  const tx = UI_TEXT[uiLang];
  const {
    models,
    modelCatalog,
    modelsLoading,
    profiles,
    profilesLoaded,
    activeProfileId,
    activeProfile,
    memoryRows,
    memoryLoading,
    mcpServers,
    newProfileName,
    setNewProfileName,
    mcpForm,
    setMcpForm,
    testResult,
    lastUsage,
    usageLoading,
    usageLoadedForProfileId,
    setLastUsage,
    onProfileChange,
    loadMemory,
    loadUsage,
    addProfile,
    renameProfile,
    moveCategoryModel,
    saveMemoryPolicy,
    removeProfile,
    saveMemory,
    removeMemory,
    saveMcp,
    testMcp,
    deleteMcp,
  } = useBackendData({
    profileDeleteConfirm: tx.profileDeleteConfirm,
    memoryDeleteConfirm: tx.memoryDeleteConfirm,
    mcpDeleteConfirm: tx.mcpDeleteConfirm,
  });

  const [modelChoice, setModelChoice] = useState<string>("auto");
  const [liveSpeech, setLiveSpeech] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [ttsOutputEnabled, setTtsOutputEnabled] = useState(true);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceInterim, setVoiceInterim] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [resolvedModelId, setResolvedModelId] = useState<string | null>(null);
  const [resolvedBaseModel, setResolvedBaseModel] = useState<string | null>(null);
  const [usedModels, setUsedModels] = useState<string[]>([]);
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
  const [memoryTopKDraft, setMemoryTopKDraft] = useState<number>(10);
  const [memoryMaxCharsDraft, setMemoryMaxCharsDraft] = useState<number>(3500);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string>("");
  const [pendingImageName, setPendingImageName] = useState<string>("");
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const activeBrowserVoiceUri: string = activeProfile?.id ? profileVoiceMap[activeProfile.id] ?? "" : "";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMemoryTopKDraft(activeProfile?.memoryPolicy?.topK ?? 10);
      setMemoryMaxCharsDraft(activeProfile?.memoryPolicy?.maxChars ?? 3500);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeProfile?.id, activeProfile?.memoryPolicy]);

  const { messages, input, setInput, handleInputChange, handleSubmit, status, error, stop, setMessages, append } =
    useChat({
      api: "/api/chat",
      body: {
        model: modelChoice,
        profileId: activeProfile?.id,
      },
      onResponse: (response) => {
        const resolved = response.headers.get("x-helper-resolved-model");
        const baseModel = response.headers.get("x-helper-base-model");
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
        if (baseModel) setResolvedBaseModel(baseModel);
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
        setResolvedBaseModel(null);
        setUsedModels(usedModelsByProfileRef.current[nextId] ?? []);
      }, 0);
    }
    prevProfileIdRef.current = nextId;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [activeProfile?.id, messages, setLastUsage, setMessages]);

  useEffect(() => {
    if (!activeProfileId) return;
    if (!lastUsage) return;
    if (lastUsage.profileId !== activeProfileId) return;
    const timer = window.setTimeout(() => {
      setResolvedModelId(lastUsage.resolvedModel ?? null);
      setResolvedBaseModel(null);
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
  }, [lastUsage, activeProfileId, setLastUsage]);

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

  const selectedModelLabel = modelChoice === "auto" ? "auto" : modelChoice;
  const {
    categoryOptions,
    contextWindow,
    mem0Chars,
    mem0TokensApprox,
    mem0InjectedApprox,
    precisePromptTokens,
    totalContextUsed,
    totalContextLeft,
    riskLevel,
    usageOwnerLabel,
    usageStatus,
    requestCostUsd,
    sessionCostUsd,
  } = useAnalyticsMetrics({
    modelCatalog,
    models,
    messages: messages as Array<{ content?: string; parts?: Array<{ type: string; text?: string }> }>,
    memoryRows,
    modelChoice,
    resolvedModelId,
    lastUsage,
    usageLoading,
    usageLoadedForProfileId,
    activeProfile,
    profiles,
    activeProfileId,
    tx: {
      analyticsWarningHigh: tx.analyticsWarningHigh,
      analyticsWarningMedium: tx.analyticsWarningMedium,
      analyticsWarningLow: tx.analyticsWarningLow,
    },
  });
  const submitFromComposer = async (e: React.FormEvent<HTMLFormElement>) => {
    setVoiceInterim(null);
    if (!pendingImageDataUrl) {
      handleSubmit(e);
      return;
    }
    e.preventDefault();
    const text = input.trim();
    const parts: Array<Record<string, unknown>> = [];
    if (text) parts.push({ type: "text", text });
    parts.push({ type: "image", image_url: pendingImageDataUrl });
    await append({
      role: "user",
      content: text,
      parts: parts as never,
    });
    setInput("");
    setPendingImageDataUrl("");
    setPendingImageName("");
    if (imageInputRef.current) imageInputRef.current.value = "";
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
                  {`${m.display_name || m.id}${formatPricePerMillion(m) ? ` · ${formatPricePerMillion(m)}` : ""}`}
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
            <span className="muted"> — auto starts with base model and delegates when needed</span>
          )}
        </div>
        {!liveSpeech && busy && (
          <div className="thinking-banner" aria-live="polite">
            <span className="thinking-spinner" aria-hidden="true" />
            <span>{tx.thinkingInline}</span>
          </div>
        )}
        <ChatMessages
          messages={messages}
          busy={busy}
          tx={tx}
          reasoningByMessageId={reasoningByMessageId}
          stripAgentArtifacts={stripAgentArtifacts}
          messageText={messageText}
        />
        <div className="composer">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result !== "string") return;
                setPendingImageDataUrl(reader.result);
                setPendingImageName(file.name || "image");
              };
              reader.readAsDataURL(file);
            }}
          />
          {pendingImageDataUrl && (
            <div className="voice-interim-inline" style={{ alignItems: "flex-start" }}>
              <img
                src={pendingImageDataUrl}
                alt={pendingImageName || "pending"}
                style={{ width: "84px", height: "84px", objectFit: "cover", borderRadius: "8px", border: "1px solid #2f3545" }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span>{tx.imageAttached}{pendingImageName ? `: ${pendingImageName}` : ""}</span>
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    setPendingImageDataUrl("");
                    setPendingImageName("");
                    if (imageInputRef.current) imageInputRef.current.value = "";
                  }}
                >
                  {tx.removeImage}
                </button>
              </div>
            </div>
          )}
          {liveSpeech && recordingEnabled && voiceInterim && (
            <div className="voice-interim-inline">
              <span className="dot" aria-hidden="true" />
              <span>{voiceInterim}</span>
            </div>
          )}
          <AnalyticsPanel
            analyticsOpen={analyticsOpen}
            setAnalyticsOpen={setAnalyticsOpen}
            tx={tx}
            selectedModelLabel={selectedModelLabel}
            resolvedModelId={resolvedModelId}
            resolvedBaseModel={resolvedBaseModel}
            precisePromptTokens={precisePromptTokens}
            totalContextUsed={totalContextUsed}
            contextWindow={contextWindow}
            totalContextLeft={totalContextLeft}
            riskLevel={riskLevel}
            usageOwnerLabel={usageOwnerLabel}
            usageStatus={usageStatus}
            lastUsage={lastUsage}
            prettyNum={prettyNum}
            requestCostUsd={requestCostUsd}
            memoryRowsLen={memoryRows.length}
            mem0Chars={mem0Chars}
            mem0TokensApprox={mem0TokensApprox}
            mem0InjectedApprox={mem0InjectedApprox}
            sessionCostUsd={sessionCostUsd}
            usedModels={usedModels}
          />
          <form
            onSubmit={submitFromComposer}
          >
            <div className="composer-input-wrap">
              <textarea
                value={input}
                onChange={handleInputChange}
                placeholder={tx.messagePlaceholder}
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    setVoiceInterim(null);
                    if (!pendingImageDataUrl) {
                      handleSubmit(e);
                      return;
                    }
                    const text = input.trim();
                    const parts: Array<Record<string, unknown>> = [];
                    if (text) parts.push({ type: "text", text });
                    parts.push({ type: "image", image_url: pendingImageDataUrl });
                    void append({
                      role: "user",
                      content: text,
                      parts: parts as never,
                    }).then(() => {
                      setInput("");
                      setPendingImageDataUrl("");
                      setPendingImageName("");
                      if (imageInputRef.current) imageInputRef.current.value = "";
                    });
                  }
                }}
              />
              <button
                type="button"
                className={pendingImageDataUrl ? "composer-attach-btn attached" : "composer-attach-btn"}
                onClick={() => imageInputRef.current?.click()}
                title={tx.attachImage}
                aria-label={tx.attachImage}
                data-tooltip={tx.attachImage}
              >
                🖼
              </button>
            </div>
            {busy ? (
              <button type="button" className="stop" onClick={() => stop()}>
                {tx.stop}
              </button>
            ) : (
              <>
                <button type="submit" className="send" disabled={!input.trim() && !pendingImageDataUrl}>
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
      <MemoryModal
        open={memoriesOpen}
        tx={tx}
        memoryRows={memoryRows}
        memoryLoading={memoryLoading}
        onClose={() => setMemoriesOpen(false)}
        onRefresh={() => void loadMemory()}
        onSaveRow={(id, text) => void saveMemory(id, text)}
        onDeleteRow={(id) => void removeMemory(id)}
      />
      <McpModal
        open={mcpOpen}
        tx={tx}
        mcpForm={mcpForm}
        mcpServers={mcpServers}
        testResult={testResult}
        onClose={() => setMcpOpen(false)}
        onFormChange={setMcpForm}
        onSave={() => void saveMcp()}
        onTest={(id) => void testMcp(id)}
        onDelete={(id) => void deleteMcp(id)}
      />
      <SettingsModal
        open={settingsOpen}
        tx={tx}
        uiLang={uiLang}
        setUiLang={setUiLang}
        activeProfileId={activeProfile?.id ?? null}
        activeBrowserVoiceUri={activeBrowserVoiceUri}
        browserVoices={browserVoices}
        setVoiceForActiveProfile={setVoiceForActiveProfile}
        profiles={profiles}
        newProfileName={newProfileName}
        setNewProfileName={setNewProfileName}
        addProfile={() => void addProfile()}
        renameProfile={(id, name) => void renameProfile(id, name)}
        removeProfile={(id) => void removeProfile(id)}
        taskCategories={TASK_CATEGORIES}
        categoryLabel={(category) => tx[CATEGORY_I18N_KEY[category]]}
        categoryOptions={categoryOptions}
        modelsLoading={modelsLoading}
        categoryModelPrice={(id) => {
          const m = (modelCatalog?.models ?? models).find((x) => x.id === id);
          return formatPricePerMillion(m);
        }}
        canEditCategory={!!activeProfile?.id}
        moveCategoryModel={(category, id, direction) => void moveCategoryModel(category, id, direction)}
        memoryTopKDraft={memoryTopKDraft}
        setMemoryTopKDraft={setMemoryTopKDraft}
        memoryMaxCharsDraft={memoryMaxCharsDraft}
        setMemoryMaxCharsDraft={setMemoryMaxCharsDraft}
        saveMemoryPolicy={() =>
          void saveMemoryPolicy({
            topK: memoryTopKDraft,
            maxChars: memoryMaxCharsDraft,
          })
        }
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
