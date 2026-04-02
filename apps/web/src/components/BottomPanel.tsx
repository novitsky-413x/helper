import { Terminal as TerminalIcon, ListTodo, Activity, X, ChevronUp } from 'lucide-react';
import { useAppStore, type BottomPanelTab } from '../store/index.js';
import { TerminalPanel } from './TerminalPanel.js';

const TABS: Array<{ id: BottomPanelTab; icon: typeof TerminalIcon; label: string }> = [
    { id: 'terminal', icon: TerminalIcon, label: 'Terminal' },
    { id: 'tasks', icon: ListTodo, label: 'Tasks' },
    { id: 'agent-log', icon: Activity, label: 'Agent' },
];

export function BottomPanel() {
    const open = useAppStore((s) => s.bottomPanelOpen);
    const tab = useAppStore((s) => s.bottomPanelTab);
    const setOpen = useAppStore((s) => s.setBottomPanelOpen);
    const setTab = useAppStore((s) => s.setBottomPanelTab);
    const agentTasks = useAppStore((s) => s.agentTasks);
    const agentTurn = useAppStore((s) => s.agentTurn);
    const agentMaxTurns = useAppStore((s) => s.agentMaxTurns);
    const currentToolName = useAppStore((s) => s.currentToolName);

    if (!open) {
        return (
            <div className="bottom-panel-bar" onClick={() => setOpen(true)}>
                <ChevronUp size={16} />
                <span>Panel</span>
                {agentTurn > 0 && (
                    <span className="bottom-panel-agent-badge">
                        Turn {agentTurn}/{agentMaxTurns}
                        {currentToolName && ` · ${currentToolName}`}
                    </span>
                )}
            </div>
        );
    }

    return (
        <div className="bottom-panel">
            <div className="bottom-panel-header">
                <div className="bottom-panel-tabs">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            className={`bottom-panel-tab ${tab === t.id ? 'active' : ''}`}
                            onClick={() => setTab(t.id)}
                        >
                            <t.icon size={14} />
                            <span>{t.label}</span>
                        </button>
                    ))}
                </div>
                <button className="bottom-panel-close" onClick={() => setOpen(false)} title="Close panel">
                    <X size={16} />
                </button>
            </div>

            <div className="bottom-panel-content">
                {tab === 'terminal' && (
                    <TerminalPanel />
                )}

                {tab === 'tasks' && (
                    <div className="tasks-panel">
                        {agentTasks.length === 0 ? (
                            <div className="tasks-empty">No active tasks.</div>
                        ) : (
                            <ul className="tasks-list">
                                {agentTasks.map((task) => (
                                    <li key={task.id} className={`task-item task-${task.status}`}>
                                        <span className="task-status-icon">
                                            {task.status === 'completed' ? '✅' :
                                             task.status === 'in_progress' ? '🔄' :
                                             task.status === 'cancelled' ? '❌' : '⏳'}
                                        </span>
                                        <span className="task-title">{task.title}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {tab === 'agent-log' && (
                    <div className="agent-log-panel">
                        {agentTurn > 0 ? (
                            <div className="agent-progress">
                                <div className="agent-progress-bar">
                                    <div
                                        className="agent-progress-fill"
                                        style={{ width: `${(agentTurn / Math.max(agentMaxTurns, 1)) * 100}%` }}
                                    />
                                </div>
                                <span>Turn {agentTurn}/{agentMaxTurns}</span>
                                {currentToolName && <span className="muted"> · {currentToolName}</span>}
                            </div>
                        ) : (
                            <div className="agent-log-empty">Agent idle.</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
