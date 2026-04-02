import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle, Clock } from 'lucide-react';
import type { UiText } from '../i18n/uiText';

interface LearningPlan {
    id: string;
    title: string;
    subject?: string;
    status: string;
    createdAt: string;
}

interface ProgressEntry {
    planId: string;
    lessonIdx: number;
    status: string;
    score?: number;
}

export function LearningDashboard({ profileId, tx }: { profileId?: string; tx: UiText }) {
    const [plans, setPlans] = useState<LearningPlan[]>([]);
    const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
    const [progress, setProgress] = useState<ProgressEntry[]>([]);

    useEffect(() => {
        if (!profileId) return;
        fetch(`/api/learning/plans?profileId=${encodeURIComponent(profileId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data && Array.isArray(data.plans)) setPlans(data.plans);
            })
            .catch(() => {});
    }, [profileId]);

    useEffect(() => {
        if (!selectedPlan) return;
        fetch(`/api/learning/progress/${encodeURIComponent(selectedPlan)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data && Array.isArray(data.progress)) setProgress(data.progress);
            })
            .catch(() => {});
    }, [selectedPlan]);

    return (
        <div className="learning-dashboard">
            <h2><BookOpen size={20} /> {tx.learningTitle}</h2>

            {plans.length === 0 ? (
                <p className="learning-empty">
                    {(() => {
                        const parts = tx.learningEmpty.split('/learn');
                        if (parts.length === 1) return tx.learningEmpty;
                        return (
                            <>
                                {parts[0]}
                                <code>/learn</code>
                                {parts.slice(1).join('/learn')}
                            </>
                        );
                    })()}
                </p>
            ) : (
                <div className="learning-plans-list">
                    {plans.map((plan) => {
                        const isSelected = selectedPlan === plan.id;
                        return (
                            <div key={plan.id} className={`learning-plan-card ${isSelected ? 'selected' : ''}`}
                                 onClick={() => setSelectedPlan(isSelected ? null : plan.id)}>
                                <div className="learning-plan-header">
                                    <strong>{plan.title}</strong>
                                    <span className={`learning-plan-status ${plan.status}`}>{plan.status}</span>
                                </div>
                                {plan.subject && <small>{plan.subject}</small>}

                                {isSelected && progress.length > 0 && (
                                    <div className="learning-progress-list">
                                        {progress.map((p) => (
                                            <div key={p.lessonIdx} className={`learning-progress-item ${p.status}`}>
                                                {p.status === 'completed' ? <CheckCircle size={14} /> : <Clock size={14} />}
                                                <span>
                                                    {tx.learningLesson} {p.lessonIdx + 1}
                                                </span>
                                                {p.score != null && <span className="score">{p.score.toFixed(0)}%</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
