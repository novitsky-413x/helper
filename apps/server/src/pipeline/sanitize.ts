import type { CoreMessage } from "ai";

/**
 * GPT-OSS / Harmony-style leaks without <|…|> brackets: routing and fake tool lines in plain text.
 * Keep in sync with `stripAgentArtifacts` in apps/web/src/App.tsx.
 */
function stripHarmonyPlaintextLeaks(text: string): string {
    let out = text;
    out = out.replace(/\bto=functions\.[a-zA-Z0-9_]+\b/gi, "");
    out = out.replace(/\bjsonfunctions\.[a-zA-Z0-9_]+\b/gi, "");
    out = out.replace(/to=assistant(?:commentary|final|analysis)?/gi, "");
    out = out.replace(/assistant(?:commentary|final|analysis)/gi, "");
    out = out.replace(/\bto=user\b/gi, "");
    out = out.replace(/\buser(?:commentary|final|analysis)\b/gi, "");
    // todo_write echo: """Updated N task(s)."" or """...""" then junk
    out = out.replace(/"{3}Updated \d+ task\(s\)\.?"{2,}/gi, "");
    out = out.replace(/""Updated \d+ task\(s\)\.?""/gi, "");
    out = out.replace(/""+analysis/gi, "");
    out = out.replace(/\banalysisNeed\b[\s\S]{0,1500}?Let's call\./gi, "");
    out = out.replace(/\s*""+/g, " ");
    out = out.replace(/\.{3,}/g, "...");
    out = out.replace(/[ \t]{2,}/g, " ");
    return out;
}

/**
 * Strip control tokens that some models leak into their text output.
 * These tokens corrupt conversation history and cause 400 errors.
 */
export function sanitizeControlTokens(text: string): string {
    if (!text) return text;
    let out = text;
    // Remove entire hallucinated tool-call blocks emitted as text
    out = out.replace(/<\|start\|>[\s\S]*?(?:<\|end\|>|$)/g, '');
    // Remove channel routing blocks (analysis, commentary, or any channel → final)
    out = out.replace(/<\|channel\|>(?:analysis|commentary)[\s\S]*?(?:<\|channel\|>final<\|message\|>|$)/gi, '');
    // Remove any remaining control tokens
    out = out.replace(/<\|[^|]*?\|>/g, '');
    // Remove orphaned routing words glued to next word
    out = out.replace(/\b(?:final|commentary)(?=[А-Яа-яA-Z])/g, '');
    out = stripHarmonyPlaintextLeaks(out);
    // Collapse whitespace artifacts
    out = out.replace(/\n{3,}/g, '\n\n').trim();
    return out;
}

export function sanitizeCoreMessages(messages: CoreMessage[]): CoreMessage[] {
    return messages.map((msg) => {
        if (msg.role !== 'assistant') return msg;
        if (typeof msg.content === 'string') {
            const cleaned = sanitizeControlTokens(msg.content);
            return { ...msg, content: cleaned };
        }
        if (Array.isArray(msg.content)) {
            const cleanedContent = msg.content.map((part) => {
                if (part.type === 'text' && typeof part.text === 'string') {
                    return { ...part, text: sanitizeControlTokens(part.text) };
                }
                return part;
            });
            return { ...msg, content: cleanedContent };
        }
        return msg;
    });
}
