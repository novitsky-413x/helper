import { useEffect, useCallback } from 'react';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { useAppStore } from '../store/index.js';

interface ChatSessionListProps {
    profileId: string | null;
    onSessionSelect: (sessionId: string, messages: unknown[]) => void;
    onNewChat: () => void;
}

export function ChatSessionList({ profileId, onSessionSelect, onNewChat }: ChatSessionListProps) {
    const chatSessions = useAppStore((s) => s.chatSessions);
    const setChatSessions = useAppStore((s) => s.setChatSessions);
    const activeChatSessionId = useAppStore((s) => s.activeChatSessionId);
    const setActiveChatSessionId = useAppStore((s) => s.setActiveChatSessionId);

    const fetchSessions = useCallback(async () => {
        if (!profileId) return;
        try {
            const res = await fetch(`/api/chat-sessions?profileId=${profileId}`);
            if (res.ok) {
                const data = await res.json();
                setChatSessions(data.sessions ?? []);
            }
        } catch { /* ignore */ }
    }, [profileId, setChatSessions]);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    const handleSelect = async (sessionId: string) => {
        try {
            const res = await fetch(`/api/chat-sessions/${sessionId}`);
            if (res.ok) {
                const data = await res.json();
                setActiveChatSessionId(sessionId);
                onSessionSelect(sessionId, data.session?.messages ?? []);
            }
        } catch { /* ignore */ }
    };

    const handleNew = async () => {
        if (!profileId) return;
        try {
            const res = await fetch('/api/chat-sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profileId, title: 'New Chat' }),
            });
            if (res.ok) {
                const data = await res.json();
                setActiveChatSessionId(data.session.id);
                onNewChat();
                fetchSessions();
            }
        } catch { /* ignore */ }
    };

    const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (!confirm('Delete this chat session?')) return;
        try {
            const res = await fetch(`/api/chat-sessions/${sessionId}`, { method: 'DELETE' });
            if (!res.ok) return;
            if (activeChatSessionId === sessionId) {
                setActiveChatSessionId(null);
                onNewChat();
            }
            fetchSessions();
        } catch { /* ignore */ }
    };

    return (
        <div className="chat-session-list">
            <button className="chat-session-new" onClick={handleNew}>
                <Plus size={14} /> New Chat
            </button>
            <div className="chat-session-items">
                {chatSessions.map((s) => (
                    <div
                        key={s.id}
                        className={`chat-session-item ${s.id === activeChatSessionId ? 'active' : ''}`}
                        onClick={() => handleSelect(s.id)}
                    >
                        <MessageSquare size={14} />
                        <span className="chat-session-title">{s.title || 'Untitled'}</span>
                        <button
                            className="chat-session-delete"
                            onClick={(e) => handleDelete(e, s.id)}
                            title="Delete"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                ))}
                {chatSessions.length === 0 && (
                    <div className="chat-session-empty">No saved sessions</div>
                )}
            </div>
        </div>
    );
}
