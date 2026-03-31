import { useEffect, useRef, useState } from 'react';
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
import type { TaskCategory } from './types/appTypes';
import { formatPricePerMillion, useAnalyticsMetrics } from './hooks/useAnalyticsMetrics';
import './App.css';

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
    out = out.replace(/<\|start\|>assistant[\s\S]*?<\|call\|>/gi, '');
    out = out.replace(/<\|channel\|>commentary[\s\S]*?(?=(<\|start\|>assistant|$))/gi, '');
    out = out.replace(/<\|constrain\|>json/gi, '');
    out = out.replace(/<\|message\|>\{[\s\S]*?\}/gi, '');
    out = out.replace(/to=use_other_model/gi, '');
    out = out.replace(/<\|[^|]+?\|>/g, '');
    out = out.replace(/<\|im_end\|>/gi, '');
    out = out.replace(/<\|im_start\|>[^\n]*/gi, '');
    // Strip tool result tags that the model may echo
    out = out.replace(/\[img:https?:\/\/[^\]\s]+\][^\n]*/g, '');
    out = out.replace(/\[audio:\/api\/audio\/file\/[\w-]+\][^\n]*/g, '');
    // Strip escaped JSON blobs from tool results (e.g. "\"{\\\"type\\\"...}\"")
    out = out.replace(/"\\*"?\{[\s\S]*?\}\\*"?"/g, '');
    // Strip leaked HTML audio tags
    out = out.replace(/<audio[^>]*>[^<]*<\/audio>/gi, '');
    out = out.replace(/<audio[^>]*\/?\s*>/gi, '');
    out = out.replace(/\n{3,}/g, '\n\n').trim();
    return out;
}

export default function App() {
    const [uiLang, setUiLang] = useState<UiLang>(() => {
        const stored = localStorage.getItem(LS_UI_LANG);
        return stored === 'ru' || stored === 'en' ? stored : 'ru';
    });
    const tx = UI_TEXT[uiLang];

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
    } = useBackendData({
        profileDeleteConfirm: tx.profileDeleteConfirm,
        memoryDeleteConfirm: tx.memoryDeleteConfirm,
        mcpDeleteConfirm: tx.mcpDeleteConfirm,
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
        body: { model: modelChoice, profileId: activeProfile?.id },
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
        chatBody: { model: modelChoice, profileId: activeProfile?.id },
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
        if (!pendingImageDataUrl) {
            handleSubmit(e);
            return;
        }
        e.preventDefault();
        const text = input.trim();
        const parts: Array<Record<string, unknown>> = [];
        if (text) parts.push({ type: 'text', text });
        parts.push({ type: 'image', image_url: pendingImageDataUrl });
        await append({ role: 'user', content: text, parts: parts as never });
        setInput('');
        setPendingImageDataUrl('');
        setPendingImageName('');
        if (imageInputRef.current) imageInputRef.current.value = '';
    };

    const handleAppendImage = (text: string, dataUrl: string) => {
        const parts: Array<Record<string, unknown>> = [];
        if (text) parts.push({ type: 'text', text });
        parts.push({ type: 'image', image_url: dataUrl });
        void append({ role: 'user', content: text, parts: parts as never }).then(() => {
            setInput('');
            setPendingImageDataUrl('');
            setPendingImageName('');
            if (imageInputRef.current) imageInputRef.current.value = '';
        });
    };

    const setVoiceForActiveProfile = (voiceUri: string) => {
        if (!activeProfile?.id) return;
        setProfileVoiceMap((prev) => ({ ...prev, [activeProfile.id]: voiceUri }));
    };

    return (
        <>
            <div className="layout">
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
                    {error && <div className="error-banner">{error.message || String(error)}</div>}
                    {liveSpeech && liveVoiceError && (
                        <div className="error-banner voice-hint">{liveVoiceError}</div>
                    )}
                    {!liveSpeech && busy && (
                        <div className="status-bar busy" aria-live="polite">
                            <span className="thinking-spinner" aria-hidden="true" />
                            <span>{tx.thinkingInline}</span>
                        </div>
                    )}
                    {!liveSpeech && !busy && (
                        <div className="status-bar">
                            <span>{tx.ready}</span>
                            {modelChoice === 'auto' && <span className="muted"> — auto</span>}
                        </div>
                    )}
                    {liveSpeech && (
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
                                · STT {sttReady ? 'ok' : 'off'} · TTS{' '}
                                {ttsReady && ttsOutputEnabled ? 'on' : 'off'}
                            </span>
                        </div>
                    )}
                    <ChatMessages
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
                    />
                    <ChatComposer
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
                    />
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
            />
        </>
    );
}
