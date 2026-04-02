import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../store/index.js';

export function NotificationToast() {
    const notifications = useAppStore((s) => s.notifications);
    const dismiss = useAppStore((s) => s.dismissNotification);

    useEffect(() => {
        for (const n of notifications) {
            if (n.ttl && n.ttl > 0) {
                const timer = setTimeout(() => dismiss(n.id), n.ttl);
                return () => clearTimeout(timer);
            }
        }
    }, [notifications, dismiss]);

    if (notifications.length === 0) return null;

    return (
        <div className="notification-container">
            {notifications.slice(0, 5).map((n) => (
                <div key={n.id} className={`notification-toast notification-${n.type}`}>
                    <div className="notification-content">
                        <strong>{n.title}</strong>
                        {n.body && <p>{n.body}</p>}
                    </div>
                    <button className="notification-close" onClick={() => dismiss(n.id)}>
                        <X size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
}
