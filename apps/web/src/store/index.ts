import { create } from 'zustand';
import type {
    AgentTask,
    AutopilotMode,
    AutopilotObservation,
    AppNotification,
} from '@helper/shared';

export type ViewId = 'chat' | 'learning' | 'wiki' | 'autopilot' | 'settings';
export type BottomPanelTab = 'terminal' | 'tasks' | 'agent-log';

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
    currentToolName: string | null;
    setAgentProgress: (turn: number, maxTurns: number, toolName?: string | null) => void;

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
    bottomPanelOpen: false,
    bottomPanelTab: 'terminal',
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setActiveView: (view) => set({ activeView: view }),
    setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
    setBottomPanelTab: (tab) => set({ bottomPanelTab: tab, bottomPanelOpen: true }),

    // Socket
    socketConnected: false,
    socketReconnecting: false,
    setSocketConnected: (connected) => set({ socketConnected: connected }),
    setSocketReconnecting: (reconnecting) => set({ socketReconnecting: reconnecting }),

    // Agent Tasks
    agentTasks: [],
    setAgentTasks: (tasks) => set({ agentTasks: tasks }),
    upsertTask: (task) =>
        set((state) => {
            const idx = state.agentTasks.findIndex((t) => t.id === task.id);
            if (idx >= 0) {
                const next = [...state.agentTasks];
                next[idx] = task;
                return { agentTasks: next };
            }
            return { agentTasks: [...state.agentTasks, task] };
        }),

    // Agent Progress
    agentTurn: 0,
    agentMaxTurns: 0,
    currentToolName: null,
    setAgentProgress: (turn, maxTurns, toolName) =>
        set({ agentTurn: turn, agentMaxTurns: maxTurns, currentToolName: toolName ?? null }),

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
