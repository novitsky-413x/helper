import { useMemo } from 'react';
import { MessageSquare, BookOpen, FileText, Eye, Settings, Wifi, WifiOff, RefreshCw, Moon } from 'lucide-react';
import { useAppStore, type ViewId } from '../store/index.js';
import type { UiText } from '../i18n/uiText';

export function Sidebar({
    activeProfile,
    tx,
}: {
    activeProfile?: { name: string; avatarEmoji?: string } | null;
    tx: UiText;
}) {
    const activeView = useAppStore((s) => s.activeView);
    const setActiveView = useAppStore((s) => s.setActiveView);
    const socketConnected = useAppStore((s) => s.socketConnected);
    const socketReconnecting = useAppStore((s) => s.socketReconnecting);
    const notifications = useAppStore((s) => s.notifications);
    const dreamStatus = useAppStore((s) => s.dreamStatus);

    const navItems = useMemo(
        () =>
            [
                { id: 'chat' as const, icon: MessageSquare, label: tx.navChat },
                { id: 'learning' as const, icon: BookOpen, label: tx.navLearning },
                { id: 'wiki' as const, icon: FileText, label: tx.navWiki },
                { id: 'autopilot' as const, icon: Eye, label: tx.navAutopilot },
                { id: 'settings' as const, icon: Settings, label: tx.navSettings },
            ] satisfies Array<{ id: ViewId; icon: typeof MessageSquare; label: string }>,
        [
            tx.navChat,
            tx.navLearning,
            tx.navWiki,
            tx.navAutopilot,
            tx.navSettings,
        ],
    );

    const unreadNotifications = notifications.filter((n) => n.type === 'autopilot').length;

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <span className="sidebar-logo">{activeProfile?.avatarEmoji ?? '🤖'}</span>
                <span className="sidebar-title">{activeProfile?.name ?? 'Helper'}</span>
            </div>

            <nav className="sidebar-nav">
                {navItems.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={`sidebar-nav-item ${activeView === item.id ? 'active' : ''}`}
                        onClick={() => setActiveView(item.id)}
                        title={item.label}
                    >
                        <item.icon size={20} />
                        <span>{item.label}</span>
                        {item.id === 'autopilot' && unreadNotifications > 0 && (
                            <span className="sidebar-badge">{unreadNotifications}</span>
                        )}
                    </button>
                ))}
            </nav>

            <div className="sidebar-footer">
                {dreamStatus === 'running' && (
                    <div className="sidebar-dream-status running">
                        <Moon size={14} className="spin" /> {tx.sidebarDreaming}
                    </div>
                )}
                {dreamStatus === 'completed' && (
                    <div className="sidebar-dream-status completed">
                        <Moon size={14} /> {tx.sidebarDreamDone}
                    </div>
                )}
                <div className="sidebar-status">
                    {socketReconnecting ? (
                        <>
                            <RefreshCw size={14} className="spin" /> {tx.sidebarReconnecting}
                        </>
                    ) : socketConnected ? (
                        <>
                            <Wifi size={14} /> {tx.sidebarConnected}
                        </>
                    ) : (
                        <>
                            <WifiOff size={14} /> {tx.sidebarDisconnected}
                        </>
                    )}
                </div>
            </div>
        </aside>
    );
}
