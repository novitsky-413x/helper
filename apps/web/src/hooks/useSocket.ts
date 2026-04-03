import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

/** In dev, connect directly to the API server (see root `npm run dev` / wait-on :3001). */
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:3001' : '';

type SocketNamespace = '/terminal' | '/autopilot' | '/agent';

type SharedEntry = {
    socket: Socket;
    subscribers: number;
    disconnectTimer: ReturnType<typeof setTimeout> | null;
};

const registry = new Map<SocketNamespace, SharedEntry>();

/** Absorb React 18 Strict Mode (mount → unmount → remount) without aborting a connecting WebSocket. */
const DISCONNECT_DELAY_MS = 400;

function acquireSocket(namespace: SocketNamespace, create: () => Socket): Socket {
    let entry = registry.get(namespace);

    if (entry?.disconnectTimer != null) {
        clearTimeout(entry.disconnectTimer);
        entry.disconnectTimer = null;
    }

    if (!entry || entry.socket.disconnected) {
        const socket = create();
        entry = { socket, subscribers: 0, disconnectTimer: null };
        registry.set(namespace, entry);
    }

    entry.subscribers += 1;
    return entry.socket;
}

function releaseSocket(namespace: SocketNamespace): void {
    const entry = registry.get(namespace);
    if (!entry) return;

    entry.subscribers -= 1;
    if (entry.subscribers > 0) return;

    entry.disconnectTimer = setTimeout(() => {
        const current = registry.get(namespace);
        if (!current || current.subscribers > 0) return;
        current.socket.disconnect();
        registry.delete(namespace);
    }, DISCONNECT_DELAY_MS);
}

export function useSocket(namespace: SocketNamespace = '/agent') {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [connected, setConnected] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);

    useEffect(() => {
        const s = acquireSocket(namespace, () =>
            io(`${SOCKET_URL}${namespace}`, {
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionAttempts: Infinity,
                transports: ['websocket', 'polling'],
            }),
        );

        const onConnect = () => {
            setSocket(s);
            setConnected(true);
            setReconnecting(false);
        };

        const onDisconnect = (reason: string) => {
            setConnected(false);
            // Auto-reconnect is enabled with a delay before `reconnect_attempt` fires; without this
            // the sidebar briefly shows "disconnected" during normal transport hiccups.
            if (reason === 'io client disconnect') {
                setReconnecting(false);
            } else {
                setReconnecting(true);
            }
        };

        const onReconnectAttempt = () => {
            setReconnecting(true);
        };

        const onReconnect = () => {
            setReconnecting(false);
        };

        s.on('connect', onConnect);
        s.on('disconnect', onDisconnect);
        s.io.on('reconnect_attempt', onReconnectAttempt);
        s.io.on('reconnect', onReconnect);

        if (s.connected) {
            setSocket(s);
            setConnected(true);
        }

        return () => {
            s.off('connect', onConnect);
            s.off('disconnect', onDisconnect);
            s.io.off('reconnect_attempt', onReconnectAttempt);
            s.io.off('reconnect', onReconnect);
            releaseSocket(namespace);
        };
    }, [namespace]);

    return { socket, connected, reconnecting };
}
