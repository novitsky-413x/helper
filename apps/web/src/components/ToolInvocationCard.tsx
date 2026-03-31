const TOOL_META: Record<string, { icon: string; label: string }> = {
  generate_image: { icon: "\uD83C\uDFA8", label: "Image Generation" },
  generate_audio: { icon: "\uD83D\uDD0A", label: "Audio Generation" },
  delegate_to_category: { icon: "\uD83E\uDDE0", label: "Specialist Delegation" },
  manage_memory: { icon: "\uD83D\uDCDD", label: "Memory Management" },
};

function extractImageRef(result: unknown): string | null {
  if (typeof result === "string") {
    const tag = result.match(/\[img:(https?:\/\/[^\]\s]+)\]/);
    if (tag?.[1]) return tag[1];
    try {
      const parsed = JSON.parse(result);
      if (parsed?.type === "image" && typeof parsed.url === "string") return parsed.url;
    } catch { /* not JSON */ }
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

function extractAudioRef(result: unknown): string | null {
  if (typeof result === "string") {
    const tag = result.match(/\[audio:(\/api\/audio\/file\/[\w-]+)\]/);
    if (tag?.[1]) return tag[1];
    try {
      const parsed = JSON.parse(result);
      if (parsed?.type === "audio" && typeof parsed.url === "string") return parsed.url;
    } catch { /* not JSON */ }
    const apiMatch = result.match(/\/api\/audio\/file\/[\w-]+/);
    if (apiMatch?.[0]) return apiMatch[0];
    const dataMatch = result.match(/data:audio\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/);
    if (dataMatch?.[0]) return dataMatch[0];
  }
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (obj.type === "audio" && typeof obj.url === "string") return obj.url;
  }
  return null;
}

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const val = typeof v === "string" && v.length > 100 ? v.slice(0, 100) + "..." : String(v);
      return `${k}: ${val}`;
    })
    .join(" \u00B7 ");
}

export function ToolInvocationCard(props: {
  toolInvocation: Record<string, unknown> & {
    toolName?: string;
    state?: string;
    args?: Record<string, unknown>;
    result?: unknown;
  };
}) {
  const { toolInvocation: t } = props;
  const name = String(t.toolName ?? "unknown");
  const state = String(t.state ?? "pending");
  const meta = TOOL_META[name] ?? { icon: "\uD83D\uDD27", label: name };
  const imageRef = extractImageRef(t.result);
  const audioRef = extractAudioRef(t.result);
  const args = t.args && typeof t.args === "object" ? t.args : {};

  const isRunning = state === "call" || state === "partial-call";
  const isDone = state === "result";

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <span className="tool-card-icon">{meta.icon}</span>
        <span className="tool-card-name">{meta.label}</span>
        <span className={`tool-card-status ${isRunning ? "running" : isDone ? "done" : "pending"}`}>
          {isRunning && <span className="tool-card-spinner" />}
          {isRunning ? "Running..." : isDone ? "Done" : "Pending"}
        </span>
      </div>
      {Object.keys(args).length > 0 && (
        <div className="tool-card-args">{formatArgs(args)}</div>
      )}
      {imageRef && (
        <div className="tool-card-image">
          <img src={imageRef} alt="generated" />
        </div>
      )}
      {audioRef && (
        <div className="tool-card-audio">
          <audio controls preload="metadata" src={audioRef} />
          <a
            href={audioRef}
            download="audio.mp3"
            className="tool-card-audio-download"
            title="Download audio"
          >
            Download
          </a>
        </div>
      )}
      {isDone && !imageRef && !audioRef && t.result != null && (
        <div className="tool-card-result">
          {typeof t.result === "string" ? t.result.slice(0, 500) : JSON.stringify(t.result, null, 2).slice(0, 500)}
        </div>
      )}
    </div>
  );
}
