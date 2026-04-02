import type { CoreMessage } from "ai";

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
