import { Terminal as TerminalIcon, ListTodo, Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '../store/index.js';
import type { UiText } from '../i18n/uiText';
import { TerminalPanel } from './TerminalPanel.js';

export function BottomPanel({ tx }: { tx: UiText }) {
    const open = useAppStore((s) => s.bottomPanelOpen);
    const setOpen = useAppStore((s) => s.setBottomPanelOpen);
    const agentTasks = useAppStore((s) => s.agentTasks);
    const visibleTasks = agentTasks.filter((t) => t.status !== 'cancelled');
    const agentTurn = useAppStore((s) => s.agentTurn);
    const agentMaxTurns = useAppStore((s) => s.agentMaxTurns);
    const agentProgressPhase = useAppStore((s) => s.agentProgressPhase);
    const currentToolName = useAppStore((s) => s.currentToolName);

    const progressDetail =
        agentTurn > 0
            ? agentProgressPhase === 'tool' && currentToolName
                ? ` · ${currentToolName}`
                : ` · ${tx.thinkingInline}`
            : '';

    if (!open) {
        return (
            <aside className="tool-dock tool-dock--collapsed" aria-label={tx.toolDockTitle}>
                <button
                    type="button"
                    className="tool-dock-expand-btn"
                    onClick={() => setOpen(true)}
                    title={tx.toolDockExpand}
                    aria-label={tx.toolDockExpand}
                >
                    <ChevronLeft size={18} aria-hidden />
                    <span className="tool-dock-collapsed-label">{tx.bottomPanelBar}</span>
                    {agentTurn > 0 && (
                        <span className="tool-dock-collapsed-badge" aria-hidden>
                            {agentTurn}/{agentMaxTurns}
                        </span>
                    )}
                </button>
            </aside>
        );
    }

    return (
        <aside className="tool-dock tool-dock--open" aria-label={tx.toolDockTitle}>
            <div className="tool-dock-header">
                <span className="tool-dock-header-title">{tx.toolDockTitle}</span>
                <button
                    type="button"
                    className="tool-dock-collapse-btn"
                    onClick={() => setOpen(false)}
                    title={tx.toolDockCollapse}
                    aria-label={tx.toolDockCollapse}
                >
                    <ChevronRight size={18} aria-hidden />
                </button>
            </div>

            <div className="tool-dock-stack">
                <section className="tool-dock-section tool-dock-section--terminal" aria-labelledby="tool-dock-terminal-h">
                    <h3 id="tool-dock-terminal-h" className="tool-dock-section-head">
                        <TerminalIcon size={14} aria-hidden />
                        {tx.bottomTabTerminal}
                    </h3>
                    <div className="tool-dock-section-body tool-dock-section-body--terminal">
                        <TerminalPanel />
                    </div>
                </section>

                <section className="tool-dock-section tool-dock-section--tasks" aria-labelledby="tool-dock-tasks-h">
                    <h3 id="tool-dock-tasks-h" className="tool-dock-section-head">
                        <ListTodo size={14} aria-hidden />
                        {tx.bottomTabTasks}
                    </h3>
                    <div className="tool-dock-section-body tool-dock-section-body--scroll">
                        <div className="tasks-panel">
                            {visibleTasks.length === 0 ? (
                                <div className="tasks-empty">{tx.bottomTasksEmpty}</div>
                            ) : (
                                <ul className="tasks-list">
                                    {visibleTasks.map((task) => (
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
                    </div>
                </section>

                <section className="tool-dock-section tool-dock-section--agent" aria-labelledby="tool-dock-agent-h">
                    <h3 id="tool-dock-agent-h" className="tool-dock-section-head">
                        <Activity size={14} aria-hidden />
                        {tx.bottomTabAgentLog}
                    </h3>
                    <div className="tool-dock-section-body tool-dock-section-body--scroll">
                        <div className="agent-log-panel">
                            {agentTurn > 0 ? (
                                <div className="agent-progress">
                                    <div className="agent-progress-bar">
                                        <div
                                            className="agent-progress-fill"
                                            style={{
                                                width: `${(agentTurn / Math.max(agentMaxTurns, 1)) * 100}%`,
                                            }}
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
                    </div>
                </section>
            </div>
        </aside>
    );
}
