import { create } from 'zustand';
import type {
    AgentTask,
    AgentTaskStatus,
    AutopilotMode,
    AutopilotObservation,
    AppNotification,
} from '@helper/shared';

export type ViewId = 'chat' | 'learning' | 'wiki' | 'autopilot' | 'settings';
export type BottomPanelTab = 'terminal' | 'tasks' | 'agent-log';
export type AgentProgressPhase = 'llm' | 'tool' | null;

const LS_TOOL_DOCK_OPEN = 'helper-tool-dock-open';

function readToolDockOpen(): boolean {
    if (typeof window === 'undefined') return true;
    try {
        const v = localStorage.getItem(LS_TOOL_DOCK_OPEN);
        if (v === '0') return false;
    } catch {
        /* ignore */
    }
    return true;
}

function persistToolDockOpen(open: boolean): void {
    try {
        localStorage.setItem(LS_TOOL_DOCK_OPEN, open ? '1' : '0');
    } catch {
        /* ignore */
    }
}

function taskStatusDedupeRank(status: AgentTaskStatus): number {
    switch (status) {
        case 'in_progress':
            return 0;
        case 'pending':
            return 1;
        case 'completed':
            return 2;
        case 'cancelled':
            return 3;
        default:
            return 9;
    }
}

function pickAgentTaskForDedupe(prev: AgentTask, row: AgentTask): AgentTask {
    const a = String(row.updatedAt ?? '');
    const b = String(prev.updatedAt ?? '');
    if (a > b) return row;
    if (a < b) return prev;
    const rp = taskStatusDedupeRank(prev.status);
    const rr = taskStatusDedupeRank(row.status);
    if (rr !== rp) return rr < rp ? row : prev;
    return row.id > prev.id ? row : prev;
}

/** Match server GET /api/tasks: one row per title; newest `updatedAt`, then status tie-break, then id. */
function dedupeAgentTasksByTitle(tasks: AgentTask[]): AgentTask[] {
    const byKey = new Map<string, AgentTask>();
    for (const row of tasks) {
        const raw = row.title.trim().replace(/\s+/g, ' ');
        const key = raw.length > 0 ? raw : row.id;
        const prev = byKey.get(key);
        if (!prev) {
            byKey.set(key, row);
            continue;
        }
        byKey.set(key, pickAgentTaskForDedupe(prev, row));
    }
    const out = Array.from(byKey.values());
    out.sort((x, y) => {
        const px = Number(x.priority ?? 0);
        const py = Number(y.priority ?? 0);
        if (px !== py) return px - py;
        return String(y.updatedAt ?? '').localeCompare(String(x.updatedAt ?? ''));
    });
    return out;
}

interface AppState {
    // UI Layout
    sidebarOpen: boolean;
    activeView: ViewId;
    bottomPanelOpen: boolean;
    bottomPanelTab: BottomPanelTab;
    setSidebarOpen: (open: boolean) => void;
    setActiveView: (view: ViewId) => void;
    setBottomPanelOpen: (open: boolean) => void;
    setBottomPanelTab: (tab: BottomPanelTab) => void;

    // Socket
    socketConnected: boolean;
    socketReconnecting: boolean;
    setSocketConnected: (connected: boolean) => void;
    setSocketReconnecting: (reconnecting: boolean) => void;

    // Agent Tasks
    agentTasks: AgentTask[];
    setAgentTasks: (tasks: AgentTask[]) => void;
    upsertTask: (task: AgentTask) => void;

    // Agent Progress
    agentTurn: number;
    agentMaxTurns: number;
    agentProgressPhase: AgentProgressPhase;
    currentToolName: string | null;
    setAgentProgress: (
        turn: number,
        maxTurns: number,
        detail?: { toolName?: string | null; phase?: 'llm' | 'tool' } | null,
    ) => void;

    // Autopilot
    autopilotMode: AutopilotMode;
    autopilotObservations: AutopilotObservation[];
    setAutopilotMode: (mode: AutopilotMode) => void;
    addAutopilotObservation: (obs: AutopilotObservation) => void;

    // Notifications
    notifications: AppNotification[];
    addNotification: (n: AppNotification) => void;
    dismissNotification: (id: string) => void;

    // Dream
    dreamStatus: 'idle' | 'running' | 'completed' | 'error';
    dreamStats: { created: number; merged: number; deleted: number } | null;
    setDreamStatus: (status: 'idle' | 'running' | 'completed' | 'error', stats?: { created: number; merged: number; deleted: number } | null) => void;

    // Terminal
    terminalOutput: Array<{ sessionId: string; chunk: string; stream: 'stdout' | 'stderr' }>;
    addTerminalOutput: (entry: { sessionId: string; chunk: string; stream: 'stdout' | 'stderr' }) => void;
    clearTerminalOutput: () => void;

    // Chat Sessions
    chatSessions: Array<{ id: string; title: string; createdAt: string; updatedAt: string }>;
    activeChatSessionId: string | null;
    setChatSessions: (sessions: Array<{ id: string; title: string; createdAt: string; updatedAt: string }>) => void;
    setActiveChatSessionId: (id: string | null) => void;

    // Agent Mode
    agentMode: boolean;
    setAgentMode: (mode: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
    // UI Layout
    sidebarOpen: true,
    activeView: 'chat',
    bottomPanelOpen: readToolDockOpen(),
    bottomPanelTab: 'terminal',
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setActiveView: (view) => set({ activeView: view }),
    setBottomPanelOpen: (open) => {
        persistToolDockOpen(open);
        set({ bottomPanelOpen: open });
    },
    setBottomPanelTab: (tab) => {
        persistToolDockOpen(true);
        set({ bottomPanelTab: tab, bottomPanelOpen: true });
    },

    // Socket
    socketConnected: false,
    socketReconnecting: false,
    setSocketConnected: (connected) => set({ socketConnected: connected }),
    setSocketReconnecting: (reconnecting) => set({ socketReconnecting: reconnecting }),

    // Agent Tasks
    agentTasks: [],
    setAgentTasks: (tasks) => set({ agentTasks: dedupeAgentTasksByTitle(tasks) }),
    upsertTask: (task) =>
        set((state) => {
            const idx = state.agentTasks.findIndex((t) => t.id === task.id);
            const next = [...state.agentTasks];
            if (idx >= 0) next[idx] = task;
            else next.push(task);
            return { agentTasks: dedupeAgentTasksByTitle(next) };
        }),

    // Agent Progress
    agentTurn: 0,
    agentMaxTurns: 0,
    agentProgressPhase: null,
    currentToolName: null,
    setAgentProgress: (turn, maxTurns, detail) => {
        if (turn === 0 && maxTurns === 0) {
            set({
                agentTurn: 0,
                agentMaxTurns: 0,
                currentToolName: null,
                agentProgressPhase: null,
            });
            return;
        }
        const phase = detail?.phase ?? (detail?.toolName ? 'tool' : 'llm');
        set({
            agentTurn: turn,
            agentMaxTurns: maxTurns,
            currentToolName: detail?.toolName ?? null,
            agentProgressPhase: phase,
        });
    },

    // Autopilot
    autopilotMode: 'advisory',
    autopilotObservations: [],
    setAutopilotMode: (mode) => set({ autopilotMode: mode }),
    addAutopilotObservation: (obs) =>
        set((state) => ({ autopilotObservations: [obs, ...state.autopilotObservations].slice(0, 100) })),

    // Notifications
    notifications: [],
    addNotification: (n) =>
        set((state) => ({ notifications: [n, ...state.notifications].slice(0, 20) })),
    dismissNotification: (id) =>
        set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),

    // Dream
    dreamStatus: 'idle',
    dreamStats: null,
    setDreamStatus: (status, stats) => set({ dreamStatus: status, dreamStats: stats ?? null }),

    // Terminal
    terminalOutput: [],
    addTerminalOutput: (entry) =>
        set((state) => ({
            terminalOutput: [...state.terminalOutput, entry].slice(-500),
        })),
    clearTerminalOutput: () => set({ terminalOutput: [] }),

    // Chat Sessions
    chatSessions: [],
    activeChatSessionId: null,
    setChatSessions: (sessions) => set({ chatSessions: sessions }),
    setActiveChatSessionId: (id) => set({ activeChatSessionId: id }),

    // Agent Mode
    agentMode: false,
    setAgentMode: (mode) => set({ agentMode: mode }),
}));
