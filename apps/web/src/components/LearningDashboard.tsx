import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle, Clock } from 'lucide-react';

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

export function LearningDashboard({ profileId }: { profileId?: string }) {
    const [plans, setPlans] = useState<LearningPlan[]>([]);
    const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
    const [progress, setProgress] = useState<ProgressEntry[]>([]);

    useEffect(() => {
        if (!profileId) return;
        fetch(`/api/learning/plans?profileId=${encodeURIComponent(profileId)}`)
            .then((r) => r.json())
            .then((data) => setPlans(data.plans ?? []))
            .catch(() => {});
    }, [profileId]);

    useEffect(() => {
        if (!selectedPlan) return;
        fetch(`/api/learning/progress/${encodeURIComponent(selectedPlan)}`)
            .then((r) => r.json())
            .then((data) => setProgress(data.progress ?? []))
            .catch(() => {});
    }, [selectedPlan]);

    return (
        <div className="learning-dashboard">
            <h2><BookOpen size={20} /> Learning Plans</h2>

            {plans.length === 0 ? (
                <p className="learning-empty">
                    No learning plans yet. Use <code>/learn &lt;topic&gt;</code> in chat to create one.
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
                                                <span>Lesson {p.lessonIdx + 1}</span>
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
