import { useEffect, useState } from 'react';
import { Eye, Pause, Zap } from 'lucide-react';
import { useAppStore } from '../store/index.js';
import type { AutopilotMode, AutopilotObservation } from '@helper/shared';

const MODES: Array<{ id: AutopilotMode; icon: typeof Eye; label: string; desc: string }> = [
    { id: 'passive', icon: Pause, label: 'Passive', desc: 'Log only' },
    { id: 'advisory', icon: Eye, label: 'Advisory', desc: 'Log + suggest' },
    { id: 'autonomous', icon: Zap, label: 'Autonomous', desc: 'Log + act' },
];

export function AutopilotPanel() {
    const mode = useAppStore((s) => s.autopilotMode);
    const observations = useAppStore((s) => s.autopilotObservations);
    const setMode = useAppStore((s) => s.setAutopilotMode);
    const [serverObs, setServerObs] = useState<AutopilotObservation[]>([]);

    useEffect(() => {
        fetch('/api/autopilot/observations?limit=30')
            .then((r) => r.json())
            .then((data) => setServerObs(data.observations ?? []))
            .catch(() => {});
    }, []);

    const allObs = [...observations, ...serverObs.filter(
        (so) => !observations.some((o) => o.id === so.id)
    )].slice(0, 50);

    const changeMode = async (newMode: AutopilotMode) => {
        setMode(newMode);
        await fetch('/api/autopilot/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: newMode }),
        }).catch(() => {});
    };

    return (
        <div className="autopilot-panel">
            <h2>Autopilot Observer</h2>

            <div className="autopilot-modes">
                {MODES.map((m) => (
                    <button
                        key={m.id}
                        className={`autopilot-mode-btn ${mode === m.id ? 'active' : ''}`}
                        onClick={() => void changeMode(m.id)}
                    >
                        <m.icon size={16} />
                        <span>{m.label}</span>
                        <small>{m.desc}</small>
                    </button>
                ))}
            </div>

            <h3>Recent Observations</h3>
            <div className="autopilot-observations">
                {allObs.length === 0 ? (
                    <p className="autopilot-empty">No observations yet.</p>
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
