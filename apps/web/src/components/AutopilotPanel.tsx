import { useEffect, useMemo, useState } from 'react';
import { Eye, Pause, Zap } from 'lucide-react';
import { useAppStore } from '../store/index.js';
import type { AutopilotMode, AutopilotObservation } from '@helper/shared';
import type { UiText } from '../i18n/uiText';

export function AutopilotPanel({ tx }: { tx: UiText }) {
    const mode = useAppStore((s) => s.autopilotMode);
    const observations = useAppStore((s) => s.autopilotObservations);
    const setMode = useAppStore((s) => s.setAutopilotMode);
    const [serverObs, setServerObs] = useState<AutopilotObservation[]>([]);

    const modes = useMemo(
        () =>
            [
                { id: 'passive' as const, icon: Pause, label: tx.autopilotPassive, desc: tx.autopilotPassiveDesc },
                { id: 'advisory' as const, icon: Eye, label: tx.autopilotAdvisory, desc: tx.autopilotAdvisoryDesc },
                {
                    id: 'autonomous' as const,
                    icon: Zap,
                    label: tx.autopilotAutonomous,
                    desc: tx.autopilotAutonomousDesc,
                },
            ] satisfies Array<{
                id: AutopilotMode;
                icon: typeof Eye;
                label: string;
                desc: string;
            }>,
        [
            tx.autopilotPassive,
            tx.autopilotPassiveDesc,
            tx.autopilotAdvisory,
            tx.autopilotAdvisoryDesc,
            tx.autopilotAutonomous,
            tx.autopilotAutonomousDesc,
        ],
    );

    useEffect(() => {
        fetch('/api/autopilot/observations?limit=30')
            .then((r) => {
                if (!r.ok) return null;
                return r.json();
            })
            .then((data) => {
                if (data && Array.isArray(data.observations)) setServerObs(data.observations);
            })
            .catch(() => {});
    }, []);

    const allObs = [...observations, ...serverObs.filter(
        (so) => !observations.some((o) => o.id === so.id)
    )].slice(0, 50);

    const changeMode = async (newMode: AutopilotMode) => {
        const prev = useAppStore.getState().autopilotMode;
        setMode(newMode);
        try {
            const r = await fetch('/api/autopilot/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: newMode }),
            });
            if (!r.ok) setMode(prev);
        } catch {
            setMode(prev);
        }
    };

    return (
        <div className="autopilot-panel">
            <h2>{tx.autopilotTitle}</h2>

            <div className="autopilot-modes">
                {modes.map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        className={`autopilot-mode-btn ${mode === m.id ? 'active' : ''}`}
                        onClick={() => void changeMode(m.id)}
                    >
                        <m.icon size={16} />
                        <span>{m.label}</span>
                        <small>{m.desc}</small>
                    </button>
                ))}
            </div>

            <h3>{tx.autopilotRecentObs}</h3>
            <div className="autopilot-observations">
                {allObs.length === 0 ? (
                    <p className="autopilot-empty">{tx.autopilotObsEmpty}</p>
                ) : (
                    <ul>
                        {allObs.map((obs) => (
                            <li key={obs.id} className="autopilot-obs-item">
                                <span className="autopilot-obs-type">{obs.type.replace(/_/g, ' ')}</span>
                                <span className="autopilot-obs-time">
                                    {new Date(obs.createdAt).toLocaleTimeString()}
                                </span>
                                {obs.actionTaken && (
                                    <span className="autopilot-obs-action">→ {obs.actionTaken}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
