import { memo, useEffect, useRef, useCallback, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { UiText } from "../i18n/uiText";
import { CodeBlock } from "./CodeBlock";
import { ToolInvocationCard } from "./ToolInvocationCard";
import { collectReasoning, extractThinkBlocks, type ChatMsg, type ChatMessagePart } from "./chatUtils";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

const mdComponents: ComponentPropsWithoutRef<typeof ReactMarkdown>["components"] = {
  pre({ children }) {
    return <pre>{children}</pre>;
  },
  code({ className, children, ...rest }) {
    const isInline = !className && typeof children === "string" && !children.includes("\n");
    if (isInline) {
      return <code {...rest}>{children}</code>;
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
};

function MessageMarkdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="msg-markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={mdComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
const MemoMessageMarkdown = memo(MessageMarkdown);

export function ChatMessages(props: {
  messages: ChatMsg[];
  busy: boolean;
  tx: UiText;
  reasoningByMessageId: Record<string, string>;
  stripAgentArtifacts: (s: string) => string;
  messageText: (m: { content?: string; parts?: Array<{ type: string; text?: string }> }) => string;
  onRegenerate?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUpRef.current = distFromBottom > 80;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [props.messages, props.busy]);

  const lastAssistantIdx = (() => {
    for (let i = props.messages.length - 1; i >= 0; i--) {
      if (props.messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div className="messages" ref={scrollRef} onScroll={handleScroll}>
      {props.messages.map((m, idx) => (
        <div key={m.id} className={`msg ${m.role} msg-animate`}>
          <div className="msg-role">{m.role}</div>
          {m.role === "assistant" &&
            (() => {
              const parts = (m.parts?.length ? m.parts : null) as Array<Record<string, unknown>> | null;
              let reasoning = collectReasoning(parts) || (m.id ? props.reasoningByMessageId[m.id] ?? "" : "");
              if (!reasoning && !parts) {
                const raw = props.messageText(m);
                reasoning = raw ? extractThinkBlocks(raw).thinking : "";
              }
              if (!reasoning) return null;
              const isLatestAssistant = idx === props.messages.length - 1;
              const isThinkingNow = isLatestAssistant && props.busy;
              return (
                <details className="reasoning-block" open={isThinkingNow}>
                  <summary>
                    {isThinkingNow && <span className="thinking-spinner" aria-hidden="true" />}
                    {props.tx.thinkingDetails}
                  </summary>
                  <pre>{reasoning}</pre>
                </details>
              );
            })()}
          {(() => {
            const textParts: string[] = [];
            return (m.parts?.length ? m.parts : null)?.map((part: ChatMessagePart, i: number) => {
            if (part.type === "text") {
              let partText = extractThinkBlocks(part.text ?? "").cleaned;
              partText = props.stripAgentArtifacts(partText);
              partText = partText
                .replace(/!\[[^\]]*?\]\([^)]+\)/g, "")
                .replace(/\[Open original\]\([^)]+\)/gi, "")
                .replace(/\[Открыть оригинал\]\([^)]+\)/gi, "")
                .replace(/\[img:[^\]]+\]/g, "")
                .replace(/\[audio:[^\]]+\]/g, "")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
              if (!partText) return null;
              const isDuplicate = textParts.some((prev) => {
                if (prev === partText) return true;
                const shorter = prev.length < partText.length ? prev : partText;
                const longer = prev.length < partText.length ? partText : prev;
                return shorter.length > 10 && longer.startsWith(shorter);
              });
              if (isDuplicate) return null;
              textParts.push(partText);
              return <MemoMessageMarkdown key={i} text={partText} />;
            }
            if (part.type === "reasoning") return null;
            if (part.type === "tool-invocation") {
              const t = part.toolInvocation as Record<string, unknown> & { toolName?: string; state?: string; args?: Record<string, unknown>; result?: unknown };
              if (t.toolName === "generate_image" && t.state === "result" && t.result) {
                const resultStr = typeof t.result === "string" ? t.result : "";
                const tagMatch = resultStr.match(/\[img:(https?:\/\/[^\]\s]+)\]/);
                const urlMatch = tagMatch?.[1] || resultStr.match(/https?:\/\/\S+/)?.[0];
                if (urlMatch) {
                  return (
                    <div key={i} className="msg-generated-image">
                      <img src={urlMatch} alt="generated" loading="lazy" />
                    </div>
                  );
                }
              }
              return <ToolInvocationCard key={i} toolInvocation={t} />;
            }
            return null;
          });
          })() ??
            (() => {
              const raw = props.messageText(m);
              if (!raw) return null;
              const { cleaned } = extractThinkBlocks(raw);
              const final = props.stripAgentArtifacts(cleaned);
              return final ? <MemoMessageMarkdown text={final} /> : null;
            })()}
          {m.role === "assistant" && idx === lastAssistantIdx && !props.busy && props.onRegenerate && (
            <button
              type="button"
              className="msg-regenerate"
              onClick={props.onRegenerate}
              title={props.tx.regenerate ?? "Regenerate"}
            >
              ↻ {props.tx.regenerate ?? "Regenerate"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
