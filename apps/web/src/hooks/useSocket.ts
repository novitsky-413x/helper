import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:3001' : '';

type SocketNamespace = '/terminal' | '/autopilot' | '/agent';

export function useSocket(namespace: SocketNamespace = '/agent') {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [connected, setConnected] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);

    useEffect(() => {
        const s = io(`${SOCKET_URL}${namespace}`, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: Infinity,
            transports: ['websocket', 'polling'],
        });

        s.on('connect', () => {
            setSocket(s);
            setConnected(true);
            setReconnecting(false);
        });

        s.on('disconnect', () => {
            setConnected(false);
        });

        s.io.on('reconnect_attempt', () => {
            setReconnecting(true);
        });

        s.io.on('reconnect', () => {
            setReconnecting(false);
        });

        return () => {
            s.disconnect();
            setSocket(null);
        };
    }, [namespace]);

    return { socket, connected, reconnecting };
}
