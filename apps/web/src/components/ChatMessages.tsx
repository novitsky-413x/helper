import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UiText } from "../i18n/uiText";

function MessageMarkdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="msg-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
const MemoMessageMarkdown = memo(MessageMarkdown);

export function collectReasoning(parts: Array<Record<string, unknown>> | null): string {
  if (!parts) return "";
  return parts
    .filter((p) => String(p.type || "") === "reasoning")
    .map((p) => {
      const candidates = [p.text, p.reasoning, p.content, p.value];
      for (const v of candidates) {
        if (typeof v === "string" && v.trim()) return v;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractImageRefFromToolInvocation(t: Record<string, unknown>): string | null {
  const result = t.result;
  if (typeof result === "string") {
    const md = result.match(/!\[[^\]]*?\]\((.*?)\)/);
    if (md?.[1]) return md[1];
    const url = result.match(/https?:\/\/\S+/);
    if (url?.[0]) return url[0];
    const data = result.match(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/);
    if (data?.[0]) return data[0];
  }
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.url === "string") return obj.url;
    if (typeof obj.image_url === "string") return obj.image_url;
  }
  return null;
}

export function ChatMessages(props: {
  messages: Array<any>;
  busy: boolean;
  tx: UiText;
  reasoningByMessageId: Record<string, string>;
  stripAgentArtifacts: (s: string) => string;
  messageText: (m: { content?: string; parts?: Array<{ type: string; text?: string }> }) => string;
}) {
  return (
    <div className="messages">
      {props.messages.map((m, idx) => (
        <div key={m.id} className={`msg ${m.role}`}>
          <div className="msg-role">{m.role}</div>
          {m.role === "assistant" && idx === props.messages.length - 1 && props.busy && (
            <div className="thinking-inline">{props.tx.thinkingInline}</div>
          )}
          {m.role === "assistant" &&
            (() => {
              const parts = (m.parts?.length ? m.parts : null) as Array<Record<string, unknown>> | null;
              const reasoning = collectReasoning(parts) || (m.id ? props.reasoningByMessageId[m.id] ?? "" : "");
              if (!reasoning) return null;
              const isLatestAssistant = idx === props.messages.length - 1;
              const isThinkingNow = isLatestAssistant && props.busy;
              return (
                <details className="reasoning-block" open={isThinkingNow}>
                  <summary>
                    {props.tx.thinkingDetails}
                    {isThinkingNow ? ` · ${props.tx.thinkingInline}` : ""}
                  </summary>
                  <pre>{reasoning}</pre>
                </details>
              );
            })()}
          {(m.parts?.length ? m.parts : null)?.map((part: any, i: number) => {
            if (part.type === "text") {
              const partText = props.stripAgentArtifacts(part.text ?? "");
              if (!partText) return null;
              const isLatestAssistant = m.role === "assistant" && idx === props.messages.length - 1;
              const isStreaming = props.busy && isLatestAssistant;
              if (isStreaming) return <div key={i} className="msg-plain">{partText}</div>;
              return <MemoMessageMarkdown key={i} text={partText} />;
            }
            if (part.type === "reasoning") return null;
            if (part.type === "tool-invocation") {
              const t = part.toolInvocation as Record<string, unknown> & { toolName?: string; state?: string };
              const imageRef = extractImageRefFromToolInvocation(t);
              return (
                <div key={i} className="tool-part">
                  <strong>{String(t.toolName ?? "?")}</strong> ({String(t.state ?? "")})
                  {imageRef ? (
                    <div style={{ marginTop: "0.45rem" }}>
                      <img src={imageRef} alt="generated" style={{ maxWidth: "100%", borderRadius: "8px", border: "1px solid #2f3545" }} />
                    </div>
                  ) : null}
                  <pre style={{ margin: "0.35rem 0 0" }}>{JSON.stringify(t, null, 2)}</pre>
                </div>
              );
            }
            return null;
          }) ??
            (props.messageText(m) ? (
              props.busy && m.role === "assistant" && idx === props.messages.length - 1 ? (
                <div className="msg-plain">{props.stripAgentArtifacts(props.messageText(m))}</div>
              ) : (
                <MemoMessageMarkdown text={props.stripAgentArtifacts(props.messageText(m))} />
              )
            ) : null)}
        </div>
      ))}
    </div>
  );
}
