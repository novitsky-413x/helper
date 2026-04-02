import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useChat } from '@ai-sdk/react';
import { useLiveVoice } from './liveVoice/useLiveVoice.ts';
import { UI_TEXT, type UiLang } from './i18n/uiText';
import { useBackendData } from './hooks/useBackendData';
import { useProfileChats } from './hooks/useProfileChats';
import { MemoryModal } from './components/MemoryModal';
import { McpModal } from './components/McpModal';
import { SettingsModal } from './components/SettingsModal';
import { ChatMessages } from './components/ChatMessages';
import { collectReasoning } from './components/chatUtils';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { AppHeader } from './components/AppHeader';
import { ChatComposer } from './components/ChatComposer';
import { ChatSessionList } from './components/ChatSessionList';
import type { TaskCategory } from './types/appTypes';
import { formatPricePerMillion, useAnalyticsMetrics } from './hooks/useAnalyticsMetrics';
import { Sidebar } from './components/Sidebar';
import { NotificationToast } from './components/NotificationToast';
import { useAppStore } from './store/index.js';
import './App.css';

const LearningDashboard = lazy(async () => {
    const m = await import('./components/LearningDashboard');
    return { default: m.LearningDashboard };
});
const WikiBrowser = lazy(async () => {
    const m = await import('./components/WikiBrowser');
    return { default: m.WikiBrowser };
});
const AutopilotPanel = lazy(async () => {
    const m = await import('./components/AutopilotPanel');
    return { default: m.AutopilotPanel };
});
const BottomPanel = lazy(async () => {
    const m = await import('./components/BottomPanel');
    return { default: m.BottomPanel };
});

const LS_UI_LANG = 'helper-ui-lang';
const LS_PROFILE_VOICE_MAP = 'helper-profile-voice-map';

type TtsVoice = string;

const TASK_CATEGORIES: TaskCategory[] = [
    'primary',
    'code_mcp',
    'reasoning',
    'vision',
    'image_gen',
    'audio',
    'memory',
];

const CATEGORY_I18N_KEY: Record<TaskCategory, keyof (typeof UI_TEXT)['ru']> = {
    primary: 'categoryPrimary',
    code_mcp: 'categoryCodeMcp',
    reasoning: 'categoryReasoning',
    vision: 'categoryVision',
    image_gen: 'categoryImageGen',
    audio: 'categoryAudio',
    memory: 'categoryMemory',
};

function prettyNum(value: number): string {
    return new Intl.NumberFormat().format(Math.max(0, Math.round(value)));
}

function messageText(m: { content?: string; parts?: Array<{ type: string; text?: string }> }) {
    if (m.parts?.length) {
        return m.parts
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && !!p.text)
            .map((p) => p.text)
            .join('');
    }
    return m.content ?? '';
}

function stripAgentArtifacts(text: string): string {
    if (!text) return '';
    let out = text;
    // Remove hallucinated tool-call blocks
    out = out.replace(/<\|start\|>[\s\S]*?(?:<\|end\|>|$)/g, '');
    // Remove channel routing (analysis/commentary → final)
    out = out.replace(/<\|channel\|>(?:analysis|commentary)[\s\S]*?(?:<\|channel\|>final<\|message\|>|$)/gi, '');
    // Remove all remaining control tokens
    out = out.replace(/<\|[^|]*?\|>/g, '');
    // Remove orphaned routing words before Cyrillic/Latin text
    out = out.replace(/\b(?:final|commentary)(?=[А-Яа-яA-Z])/g, '');
    out = out.replace(/to=use_other_model/gi, '');
    // Strip tool result tags that the model may echo
    out = out.replace(/\[img:https?:\/\/[^\]\s]+\][^\n]*/g, '');
    out = out.replace(/\[audio:\/api\/audio\/file\/[\w-]+\][^\n]*/g, '');
    // Strip escaped JSON blobs from tool results
    out = out.replace(/"\\*"?\{[\s\S]*?\}\\*"?"/g, '');
    // Strip leaked HTML audio tags
    out = out.replace(/<audio[^>]*>[^<]*<\/audio>/gi, '');
    out = out.replace(/<audio[^>]*\/?\s*>/gi, '');
    // Collapse whitespace
    out = out.replace(/\n{3,}/g, '\n\n').trim();
    return out;
}

export default function App() {
    const [uiLang, setUiLang] = useState<UiLang>(() => {
        const stored = localStorage.getItem(LS_UI_LANG);
        return stored === 'ru' || stored === 'en' ? stored : 'ru';
    });
    const tx = UI_TEXT[uiLang];
    const addNotification = useAppStore((s) => s.addNotification);
    const onProfileAddFailed = useCallback(() => {
        const t = UI_TEXT[uiLang];
        addNotification({
            id: crypto.randomUUID(),
            type: 'error',
            title: t.profileAddFailedTitle,
            body: t.profileAddFailedBody,
            ttl: 8000,
            createdAt: Date.now(),
        });
    }, [addNotification, uiLang]);

    const notifyGenericFailed = useCallback(() => {
        const t = UI_TEXT[uiLang];
        addNotification({
            id: crypto.randomUUID(),
            type: 'error',
            title: t.genericRequestFailedTitle,
            body: t.genericRequestFailedBody,
            ttl: 7000,
            createdAt: Date.now(),
        });
    }, [addNotification, uiLang]);

    const {
        models,
        modelCatalog,
        modelsLoading,
        modelHealth,
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
        loadProfiles,
    } = useBackendData({
        profileDeleteConfirm: tx.profileDeleteConfirm,
        memoryDeleteConfirm: tx.memoryDeleteConfirm,
        mcpDeleteConfirm: tx.mcpDeleteConfirm,
        onProfileAddFailed,
        onMcpSaveFailed: notifyGenericFailed,
        onSettingsRequestFailed: notifyGenericFailed,
    });

    const [modelChoice, setModelChoice] = useState<string>('auto');
    const [liveSpeech, setLiveSpeech] = useState(false);
    const [recordingEnabled, setRecordingEnabled] = useState(false);
    const [ttsOutputEnabled, setTtsOutputEnabled] = useState(true);
    const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [voiceInterim, setVoiceInterim] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [memoriesOpen, setMemoriesOpen] = useState(false);
    const [mcpOpen, setMcpOpen] = useState(false);
    const [analyticsOpen, setAnalyticsOpen] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia('(max-width: 640px)');
        const collapseIfNarrow = () => {
            if (mq.matches) setAnalyticsOpen(false);
        };
        collapseIfNarrow();
        mq.addEventListener('change', collapseIfNarrow);
        return () => mq.removeEventListener('change', collapseIfNarrow);
    }, []);
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
                Object.entries(parsed).filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
            ) as Record<string, string>;
        } catch {
            return {};
        }
    });
    const [reasoningByMessageId, setReasoningByMessageId] = useState<Record<string, string>>({});
    const [memoryTopKDraft, setMemoryTopKDraft] = useState<number>(10);
    const [memoryMaxCharsDraft, setMemoryMaxCharsDraft] = useState<number>(3500);
    const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string>('');
    const [pendingImageName, setPendingImageName] = useState<string>('');
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    const agentMode = useAppStore((s) => s.agentMode);

    const activeBrowserVoiceUri: string = activeProfile?.id ? profileVoiceMap[activeProfile.id] ?? '' : '';

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setMemoryTopKDraft(activeProfile?.memoryPolicy?.topK ?? 10);
            setMemoryMaxCharsDraft(activeProfile?.memoryPolicy?.maxChars ?? 3500);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [activeProfile?.id, activeProfile?.memoryPolicy]);

    const {
        messages,
        input,
        setInput,
        handleInputChange,
        handleSubmit,
        status,
        error,
        stop,
        setMessages,
        append,
    } = useChat({
        api: '/api/chat',
        body: { model: modelChoice, profileId: activeProfile?.id, agentMode, uiLang },
        onResponse: (response) => {
            const resolved = response.headers.get('x-helper-resolved-model');
            const baseModel = response.headers.get('x-helper-base-model');
            if (resolved) {
                setResolvedModelId(resolved);
                setUsedModels((prev) => {
                    const next = prev.includes(resolved) ? prev : [...prev, resolved];
                    if (activeProfile?.id) usedModelsByProfileRef.current[activeProfile.id] = next;
                    return next;
                });
            }
            if (baseModel) setResolvedBaseModel(baseModel);
        },
    });
    const busy = status === 'submitted' || status === 'streaming';

    const setAgentProgress = useAppStore((s) => s.setAgentProgress);
    const prevBusyRef = useRef(false);
    useEffect(() => {
        if (prevBusyRef.current && !busy) {
            setAgentProgress(0, 0);
        }
        prevBusyRef.current = busy;
    }, [busy, setAgentProgress]);

    const {
        liveState,
        voiceError: liveVoiceError,
        sttReady,
        ttsReady,
    } = useLiveVoice({
        enabled: liveSpeech,
        microphoneEnabled: recordingEnabled,
        browserTtsVoiceUri: activeBrowserVoiceUri,
        ttsEnabled: ttsOutputEnabled,
        append,
        chatBody: { model: modelChoice, profileId: activeProfile?.id, uiLang, agentMode },
        messages,
        status,
        onInterimChange: setVoiceInterim,
    });

    const { clearCurrentChat } = useProfileChats({
        activeProfile,
        profiles,
        profilesLoaded,
        messages,
        setMessages,
        setLastUsage,
        setResolvedModelId,
        setResolvedBaseModel,
        usedModelsByProfileRef,
        setUsedModels,
    });

    useEffect(() => {
        localStorage.setItem(LS_UI_LANG, uiLang);
    }, [uiLang]);
    useEffect(() => {
        localStorage.setItem(LS_PROFILE_VOICE_MAP, JSON.stringify(profileVoiceMap));
    }, [profileVoiceMap]);

    useEffect(() => {
        if (!('speechSynthesis' in window)) return;
        const synth = window.speechSynthesis;
        const refresh = () => setBrowserVoices(synth.getVoices());
        refresh();
        synth.addEventListener('voiceschanged', refresh);
        return () => synth.removeEventListener('voiceschanged', refresh);
    }, []);

    useEffect(() => {
        if (!activeProfile?.id || profileVoiceMap[activeProfile.id] || !browserVoices.length) return;
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
                    if (m.role !== 'assistant' || !m.id) continue;
                    const parts = (m.parts?.length ? m.parts : null) as Array<Record<string, unknown>> | null;
                    const now = collectReasoning(parts);
                    if (now) {
                        next[m.id] = now;
                        continue;
                    }
                    if (prev[m.id]) next[m.id] = prev[m.id];
                }
                const prevKeys = Object.keys(prev);
                const nextKeys = Object.keys(next);
                if (prevKeys.length === nextKeys.length && prevKeys.every((k) => prev[k] === next[k]))
                    return prev;
                return next;
            });
        }, 0);
        return () => window.clearTimeout(timer);
    }, [messages]);

    useEffect(() => {
        if (!activeProfileId || !lastUsage || lastUsage.profileId !== activeProfileId) return;
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
    }, [lastUsage, activeProfileId]);

    useEffect(() => {
        if (!profilesLoaded) return;
        const validIds = new Set(profiles.map((p) => p.id));
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

    const selectedModelLabel = modelChoice === 'auto' ? 'auto' : modelChoice;
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
        const ta = composerTextareaRef.current;
        if (ta) {
            const domVal = ta.value;
            if (domVal !== input) {
                flushSync(() => setInput(domVal));
            }
        }
        if (!pendingImageDataUrl) {
            handleSubmit(e);
            return;
        }
        e.preventDefault();
        const text = (composerTextareaRef.current?.value ?? input).trim();
        const dataUrl = pendingImageDataUrl;
        setInput('');
        setPendingImageDataUrl('');
        setPendingImageName('');
        if (imageInputRef.current) imageInputRef.current.value = '';
        const parts: Array<Record<string, unknown>> = [];
        if (text) parts.push({ type: 'text', text });
        parts.push({ type: 'image', image_url: dataUrl });
        await append({ role: 'user', content: text, parts: parts as never });
    };

    const handleAppendImage = (text: string, dataUrl: string) => {
        setInput('');
        setPendingImageDataUrl('');
        setPendingImageName('');
        if (imageInputRef.current) imageInputRef.current.value = '';
        const parts: Array<Record<string, unknown>> = [];
        if (text) parts.push({ type: 'text', text });
        parts.push({ type: 'image', image_url: dataUrl });
        void append({ role: 'user', content: text, parts: parts as never });
    };

    const setVoiceForActiveProfile = (voiceUri: string) => {
        if (!activeProfile?.id) return;
        setProfileVoiceMap((prev) => ({ ...prev, [activeProfile.id]: voiceUri }));
    };

    const sidebarOpen = useAppStore((s) => s.sidebarOpen);
    const activeView = useAppStore((s) => s.activeView);
    const setAgentMode = useAppStore((s) => s.setAgentMode);
    const activeChatSessionId = useAppStore((s) => s.activeChatSessionId);

    // Save messages to server session when they change
    useEffect(() => {
        if (!activeChatSessionId || messages.length === 0) return;
        const timer = setTimeout(() => {
            fetch(`/api/chat-sessions/${activeChatSessionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages }),
            }).catch(() => {});
        }, 2000);
        return () => clearTimeout(timer);
    }, [messages, activeChatSessionId]);

    // One-time migration from localStorage to server sessions
    const migrationDoneRef = useRef(false);
    useEffect(() => {
        if (migrationDoneRef.current || !activeProfile?.id) return;
        const chatSessions = useAppStore.getState().chatSessions;
        if (chatSessions.length > 0) return;

        const raw = localStorage.getItem('helper-profile-chats');
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown[]>;
            const profileMsgs = parsed[activeProfile.id];
            if (!profileMsgs || profileMsgs.length === 0) return;

            migrationDoneRef.current = true;
            fetch('/api/chat-sessions/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessions: [{ profileId: activeProfile.id, title: 'Migrated Chat', messages: profileMsgs }],
                }),
            }).then(() => {
                return fetch(`/api/chat-sessions?profileId=${activeProfile.id}`);
            }).then(res => res.json()).then(data => {
                useAppStore.getState().setChatSessions(data.sessions ?? []);
            }).catch(() => {});
        } catch { /* ignore */ }
    }, [activeProfile?.id]);

    return (
        <>
            <NotificationToast />
            <div className={`layout ${sidebarOpen ? 'with-sidebar' : ''}`}>
                <Sidebar activeProfile={activeProfile} tx={tx} />
                {activeView === 'chat' && (
                    <div className="chat-history-panel">
                        <ChatSessionList
                            profileId={activeProfile?.id ?? null}
                            onSessionSelect={(_sessionId, msgs) => {
                                setMessages(msgs as Parameters<typeof setMessages>[0]);
                            }}
                            onNewChat={() => {
                                setMessages([]);
                            }}
                        />
                    </div>
                )}
                <main className="chat-main">
                    <AppHeader
                        tx={tx}
                        models={models}
                        modelChoice={modelChoice}
                        setModelChoice={setModelChoice}
                        modelHealth={modelHealth}
                        profiles={profiles}
                        activeProfile={activeProfile}
                        onProfileChange={onProfileChange}
                        onMemoryOpen={() => {
                            void loadMemory();
                            setMemoriesOpen(true);
                        }}
                        onMcpOpen={() => setMcpOpen(true)}
                        onSettingsOpen={() => setSettingsOpen(true)}
                        onNewChat={clearCurrentChat}
                        liveSpeech={liveSpeech}
                        setLiveSpeech={setLiveSpeech}
                        setRecordingEnabled={setRecordingEnabled}
                        setVoiceInterim={() => setVoiceInterim(null)}
                        ttsOutputEnabled={ttsOutputEnabled}
                        setTtsOutputEnabled={setTtsOutputEnabled}
                    />
                    {activeView === 'chat' && (
                        <div className="agent-mode-bar">
                            <button
                                type="button"
                                className={`agent-mode-toggle ${agentMode ? 'active' : ''}`}
                                onClick={() => setAgentMode(!agentMode)}
                                title={agentMode ? tx.agentModeTooltipOn : tx.agentModeTooltipOff}
                            >
                                {agentMode ? tx.agentModeBadgeOn : tx.agentModeBadgeOff}
                            </button>
                        </div>
                    )}
                    {activeView === 'learning' && (
                        <Suspense fallback={<div className="view-loading">{tx.panelLoading}</div>}>
                            <LearningDashboard profileId={activeProfile?.id} tx={tx} />
                        </Suspense>
                    )}
                    {activeView === 'wiki' && (
                        <Suspense fallback={<div className="view-loading">{tx.panelLoading}</div>}>
                            <WikiBrowser profileId={activeProfile?.id} tx={tx} />
                        </Suspense>
                    )}
                    {activeView === 'autopilot' && (
                        <Suspense fallback={<div className="view-loading">{tx.panelLoading}</div>}>
                            <AutopilotPanel tx={tx} />
                        </Suspense>
                    )}
                    {activeView === 'settings' && (
                        <div style={{ padding: '1rem' }}>
                            <button type="button" className="btn-outline" onClick={() => setSettingsOpen(true)}>
                                {tx.settingsOpenButton}
                            </button>
                        </div>
                    )}
                    {activeView === 'chat' && error && <div className="error-banner">{error.message || String(error)}</div>}
                    {activeView === 'chat' && liveSpeech && liveVoiceError && (
                        <div className="error-banner voice-hint">{liveVoiceError}</div>
                    )}
                    {activeView === 'chat' && !liveSpeech && busy && (
                        <div className="status-bar busy" aria-live="polite">
                            <span className="thinking-spinner" aria-hidden="true" />
                            <span>{tx.thinkingInline}</span>
                        </div>
                    )}
                    {activeView === 'chat' && !liveSpeech && !busy && (
                        <div className="status-bar">
                            <span>{tx.ready}</span>
                            {modelChoice === 'auto' && <span className="muted"> — auto</span>}
                        </div>
                    )}
                    {activeView === 'chat' && liveSpeech && (
                        <div
                            className={`status-bar ${
                                liveState === 'listening' || liveState === 'speaking' ? 'busy' : ''
                            }`}
                        >
                            {(liveState === 'listening' || liveState === 'thinking') && (
                                <span className="thinking-spinner" aria-hidden="true" />
                            )}
                            <span>
                                {liveState === 'idle' && tx.ready}
                                {liveState === 'listening' && tx.listening}
                                {liveState === 'thinking' && tx.thinkingInline}
                                {liveState === 'speaking' && tx.speaking}
                            </span>
                            <span className="muted">
                                {' '}
                                · {tx.voiceStt}{' '}
                                {sttReady ? tx.analyticsOk : tx.toggleOffShort} · {tx.voiceTts}{' '}
                                {ttsReady && ttsOutputEnabled ? tx.toggleOnShort : tx.toggleOffShort}
                            </span>
                        </div>
                    )}
                    {activeView === 'chat' && <ChatMessages
                        messages={messages}
                        busy={busy}
                        tx={tx}
                        reasoningByMessageId={reasoningByMessageId}
                        stripAgentArtifacts={stripAgentArtifacts}
                        messageText={messageText}
                        onRegenerate={() => {
                            if (messages.length < 2) return;
                            const lastMsg = messages[messages.length - 1];
                            if (lastMsg?.role !== 'assistant') return;
                            const userMsg = messages[messages.length - 2];
                            if (userMsg?.role !== 'user') return;
                            const newMsgs = messages.slice(0, -1);
                            setMessages(newMsgs);
                            const text = messageText(userMsg);
                            if (text) void append({ role: 'user', content: text });
                        }}
                    />}
                    {activeView === 'chat' && <ChatComposer
                        tx={tx}
                        input={input}
                        setInput={setInput}
                        handleInputChange={handleInputChange}
                        busy={busy}
                        stop={stop}
                        pendingImageDataUrl={pendingImageDataUrl}
                        setPendingImageDataUrl={setPendingImageDataUrl}
                        pendingImageName={pendingImageName}
                        setPendingImageName={setPendingImageName}
                        liveSpeech={liveSpeech}
                        recordingEnabled={recordingEnabled}
                        setRecordingEnabled={setRecordingEnabled}
                        voiceInterim={voiceInterim}
                        setVoiceInterim={() => setVoiceInterim(null)}
                        onSubmit={submitFromComposer}
                        onAppendImage={handleAppendImage}
                        imageInputRef={imageInputRef}
                        textareaRef={composerTextareaRef}
                        analyticsSection={
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
                        }
                    />}
                    <Suspense fallback={null}>
                        <BottomPanel tx={tx} />
                    </Suspense>
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
                modelHealth={modelHealth}
                categoryModelPrice={(id) => {
                    const m = (modelCatalog?.models ?? models).find((x) => x.id === id);
                    return formatPricePerMillion(m);
                }}
                canEditCategory={!!activeProfile?.id}
                moveCategoryModel={(category, id, direction) =>
                    void moveCategoryModel(category, id, direction)
                }
                memoryTopKDraft={memoryTopKDraft}
                setMemoryTopKDraft={setMemoryTopKDraft}
                memoryMaxCharsDraft={memoryMaxCharsDraft}
                setMemoryMaxCharsDraft={setMemoryMaxCharsDraft}
                saveMemoryPolicy={() =>
                    void saveMemoryPolicy({ topK: memoryTopKDraft, maxChars: memoryMaxCharsDraft })
                }
                onClose={() => setSettingsOpen(false)}
                activeProfilePersona={activeProfile ? {
                    avatarEmoji: activeProfile.avatarEmoji,
                    personality: activeProfile.personality,
                    voiceStyle: activeProfile.voiceStyle,
                } : undefined}
                onSavePersona={async (data) => {
                    if (!activeProfile?.id) return;
                    try {
                        const r = await fetch(`/api/profiles/${activeProfile.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(data),
                        });
                        if (!r.ok) {
                            notifyGenericFailed();
                            return;
                        }
                        await loadProfiles();
                    } catch {
                        notifyGenericFailed();
                    }
                }}
            />
        </>
    );
}
