import { useEffect } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { useAppStore } from '../store/index.js';
import type { AgentTask, AutopilotObservation, AppNotification } from '@helper/shared';

export function SocketProvider({ children }: { children: React.ReactNode }) {
    const { socket: agentSocket, connected, reconnecting } = useSocket('/agent');
    const { socket: autopilotSocket } = useSocket('/autopilot');
    const { socket: terminalSocket } = useSocket('/terminal');

    const setSocketConnected = useAppStore((s) => s.setSocketConnected);
    const setSocketReconnecting = useAppStore((s) => s.setSocketReconnecting);
    const setAgentProgress = useAppStore((s) => s.setAgentProgress);
    const upsertTask = useAppStore((s) => s.upsertTask);
    const addAutopilotObservation = useAppStore((s) => s.addAutopilotObservation);
    const addNotification = useAppStore((s) => s.addNotification);
    const setDreamStatus = useAppStore((s) => s.setDreamStatus);
    const addTerminalOutput = useAppStore((s) => s.addTerminalOutput);

    useEffect(() => {
        setSocketConnected(connected);
        setSocketReconnecting(reconnecting);
    }, [connected, reconnecting, setSocketConnected, setSocketReconnecting]);

    useEffect(() => {
        if (!agentSocket) return;

        const onProgress = (data: {
            turn: number;
            maxTurns: number;
            toolName?: string;
            phase?: 'llm' | 'tool';
        }) => {
            const phase = data.phase ?? (data.toolName ? 'tool' : 'llm');
            setAgentProgress(data.turn, data.maxTurns, {
                toolName: data.toolName ?? null,
                phase,
            });
        };

        const onTaskUpdate = (task: AgentTask) => {
            upsertTask(task);
        };

        const onNotification = (n: AppNotification) => {
            addNotification(n);
        };

        const onDreamStatus = (data: { status: 'idle' | 'running' | 'completed' | 'error'; stats?: { created: number; merged: number; deleted: number } }) => {
            setDreamStatus(data.status, data.stats);
        };

        agentSocket.on('agent:progress', onProgress);
        agentSocket.on('agent:task-update', onTaskUpdate);
        agentSocket.on('notification', onNotification);
        agentSocket.on('dream:status', onDreamStatus);

        return () => {
            agentSocket.off('agent:progress', onProgress);
            agentSocket.off('agent:task-update', onTaskUpdate);
            agentSocket.off('notification', onNotification);
            agentSocket.off('dream:status', onDreamStatus);
        };
    }, [agentSocket, setAgentProgress, upsertTask, addNotification, setDreamStatus]);

    useEffect(() => {
        if (!autopilotSocket) return;

        const onObservation = (obs: AutopilotObservation) => {
            addAutopilotObservation(obs);
        };

        autopilotSocket.on('autopilot:observation', onObservation);

        return () => {
            autopilotSocket.off('autopilot:observation', onObservation);
        };
    }, [autopilotSocket, addAutopilotObservation]);

    useEffect(() => {
        if (!terminalSocket) return;

        const onOutput = (data: { sessionId: string; chunk: string; stream: 'stdout' | 'stderr' }) => {
            addTerminalOutput(data);
        };

        terminalSocket.on('terminal:output', onOutput);

        return () => {
            terminalSocket.off('terminal:output', onOutput);
        };
    }, [terminalSocket, addTerminalOutput]);

    return <>{children}</>;
}
