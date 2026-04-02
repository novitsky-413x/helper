import { MessageSquare, BookOpen, FileText, Eye, Settings, Wifi, WifiOff, RefreshCw, Moon } from 'lucide-react';
import { useAppStore, type ViewId } from '../store/index.js';

const NAV_ITEMS: Array<{ id: ViewId; icon: typeof MessageSquare; label: string }> = [
    { id: 'chat', icon: MessageSquare, label: 'Chat' },
    { id: 'learning', icon: BookOpen, label: 'Learning' },
    { id: 'wiki', icon: FileText, label: 'Wiki' },
    { id: 'autopilot', icon: Eye, label: 'Autopilot' },
    { id: 'settings', icon: Settings, label: 'Settings' },
];

export function Sidebar({ activeProfile }: { activeProfile?: { name: string; avatarEmoji?: string } | null }) {
    const activeView = useAppStore((s) => s.activeView);
    const setActiveView = useAppStore((s) => s.setActiveView);
    const socketConnected = useAppStore((s) => s.socketConnected);
    const socketReconnecting = useAppStore((s) => s.socketReconnecting);
    const notifications = useAppStore((s) => s.notifications);
    const dreamStatus = useAppStore((s) => s.dreamStatus);

    const unreadNotifications = notifications.filter((n) => n.type === 'autopilot').length;

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <span className="sidebar-logo">{activeProfile?.avatarEmoji ?? '🤖'}</span>
                <span className="sidebar-title">{activeProfile?.name ?? 'Helper'}</span>
            </div>

            <nav className="sidebar-nav">
                {NAV_ITEMS.map((item) => (
                    <button
                        key={item.id}
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
                        <Moon size={14} className="spin" /> Dreaming...
                    </div>
                )}
                {dreamStatus === 'completed' && (
                    <div className="sidebar-dream-status completed">
                        <Moon size={14} /> Dream done
                    </div>
                )}
                <div className="sidebar-status">
                    {socketReconnecting ? (
                        <><RefreshCw size={14} className="spin" /> Reconnecting...</>
                    ) : socketConnected ? (
                        <><Wifi size={14} /> Connected</>
                    ) : (
                        <><WifiOff size={14} /> Disconnected</>
                    )}
                </div>
            </div>
        </aside>
    );
}
