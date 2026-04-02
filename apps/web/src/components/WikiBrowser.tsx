import { useEffect, useState, useCallback } from 'react';
import { FileText, Search, ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { UiText } from '../i18n/uiText';

interface WikiArticle {
    id: string;
    title: string;
    content?: string;
    tags?: string[];
    updatedAt: string;
}

export function WikiBrowser({ profileId, tx }: { profileId?: string; tx: UiText }) {
    const [articles, setArticles] = useState<WikiArticle[]>([]);
    const [selected, setSelected] = useState<WikiArticle | null>(null);
    const [search, setSearch] = useState('');

    const loadArticles = useCallback((query?: string) => {
        if (!profileId) return;
        const url = query
            ? `/api/wiki?profileId=${encodeURIComponent(profileId)}&q=${encodeURIComponent(query)}`
            : `/api/wiki?profileId=${encodeURIComponent(profileId)}`;
        fetch(url)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data && Array.isArray(data.articles)) setArticles(data.articles);
            })
            .catch(() => {});
    }, [profileId]);

    useEffect(() => { loadArticles(); }, [loadArticles]);

    const openArticle = (id: string) => {
        fetch(`/api/wiki/${id}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (data?.article) setSelected(data.article);
            })
            .catch(() => {});
    };

    if (selected) {
        return (
            <div className="wiki-article-view">
                <button type="button" className="wiki-back" onClick={() => setSelected(null)}>
                    <ArrowLeft size={16} /> {tx.wikiBack}
                </button>
                <h2>{selected.title}</h2>
                <div className="wiki-content">
                    <ReactMarkdown>{selected.content ?? ''}</ReactMarkdown>
                </div>
            </div>
        );
    }

    return (
        <div className="wiki-browser">
            <h2><FileText size={20} /> {tx.wikiTitle}</h2>

            <div className="wiki-search">
                <Search size={16} />
                <input
                    type="search"
                    id="wiki-search"
                    name="wiki-search"
                    autoComplete="off"
                    placeholder={tx.wikiSearchPlaceholder}
                    aria-label={tx.wikiSearchPlaceholder}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') loadArticles(search); }}
                />
            </div>

            {articles.length === 0 ? (
                <p className="wiki-empty">{tx.wikiEmpty}</p>
            ) : (
                <ul className="wiki-list">
                    {articles.map((a) => (
                        <li key={a.id} className="wiki-item" onClick={() => openArticle(a.id)}>
                            <FileText size={14} />
                            <span>{a.title}</span>
                            <small>{new Date(a.updatedAt).toLocaleDateString()}</small>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
