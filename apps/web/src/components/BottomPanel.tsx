import { useMemo } from 'react';
import { Terminal as TerminalIcon, ListTodo, Activity, X, ChevronUp } from 'lucide-react';
import { useAppStore, type BottomPanelTab } from '../store/index.js';
import type { UiText } from '../i18n/uiText';
import { TerminalPanel } from './TerminalPanel.js';

export function BottomPanel({ tx }: { tx: UiText }) {
    const open = useAppStore((s) => s.bottomPanelOpen);
    const tab = useAppStore((s) => s.bottomPanelTab);
    const setOpen = useAppStore((s) => s.setBottomPanelOpen);
    const setTab = useAppStore((s) => s.setBottomPanelTab);
    const agentTasks = useAppStore((s) => s.agentTasks);
    const agentTurn = useAppStore((s) => s.agentTurn);
    const agentMaxTurns = useAppStore((s) => s.agentMaxTurns);
    const agentProgressPhase = useAppStore((s) => s.agentProgressPhase);
    const currentToolName = useAppStore((s) => s.currentToolName);

    const tabs = useMemo(
        () =>
            [
                { id: 'terminal' as const, icon: TerminalIcon, label: tx.bottomTabTerminal },
                { id: 'tasks' as const, icon: ListTodo, label: tx.bottomTabTasks },
                { id: 'agent-log' as const, icon: Activity, label: tx.bottomTabAgentLog },
            ] satisfies Array<{ id: BottomPanelTab; icon: typeof TerminalIcon; label: string }>,
        [tx.bottomTabTerminal, tx.bottomTabTasks, tx.bottomTabAgentLog],
    );

    const progressDetail =
        agentTurn > 0
            ? agentProgressPhase === 'tool' && currentToolName
                ? ` · ${currentToolName}`
                : ` · ${tx.thinkingInline}`
            : '';

    if (!open) {
        return (
            <div className="bottom-panel-bar" onClick={() => setOpen(true)}>
                <ChevronUp size={16} />
                <span>{tx.bottomPanelBar}</span>
                {agentTurn > 0 && (
                    <span className="bottom-panel-agent-badge">
                        {tx.bottomAgentTurnLabel} {agentTurn}/{agentMaxTurns}
                        {progressDetail}
                    </span>
                )}
            </div>
        );
    }

    return (
        <div className="bottom-panel">
            <div className="bottom-panel-header">
                <div className="bottom-panel-tabs">
                    {tabs.map((t) => (
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
                <button
                    type="button"
                    className="bottom-panel-close"
                    onClick={() => setOpen(false)}
                    title={tx.bottomClosePanel}
                    aria-label={tx.bottomClosePanel}
                >
                    <X size={16} />
                </button>
            </div>

            <div className="bottom-panel-content">
                {tab === 'terminal' && <TerminalPanel />}

                {tab === 'tasks' && (
                    <div className="tasks-panel">
                        {agentTasks.length === 0 ? (
                            <div className="tasks-empty">{tx.bottomTasksEmpty}</div>
                        ) : (
                            <ul className="tasks-list">
                                {agentTasks.map((task) => (
                                    <li key={task.id} className={`task-item task-${task.status}`}>
                                        <span className="task-status-icon">
                                            {task.status === 'completed'
                                                ? '✅'
                                                : task.status === 'in_progress'
                                                  ? '🔄'
                                                  : task.status === 'cancelled'
                                                    ? '❌'
                                                    : '⏳'}
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
                                <span>
                                    {tx.bottomAgentTurnLabel} {agentTurn}/{agentMaxTurns}
                                </span>
                                <span className="muted">{progressDetail}</span>
                            </div>
                        ) : (
                            <div className="agent-log-empty">{tx.bottomAgentIdle}</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
