import { useCallback, useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import "./App.css";

const LS_PROFILE = "helper-active-profile";

type Profile = {
  id: string;
  name: string;
  mem0UserId: string;
};

type TogetherModel = {
  id: string;
  display_name?: string | null;
};

type McpServer = {
  id: string;
  name: string;
  enabled: boolean;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
};

type MemoryRow = { id: string; memory: string; score?: number };

function messageText(m: { content?: string; parts?: Array<{ type: string; text?: string }> }) {
  if (m.parts?.length) {
    return m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
      .map((p) => p.text)
      .join("");
  }
  return m.content ?? "";
}

export default function App() {
  const [models, setModels] = useState<TogetherModel[]>([]);
  const [modelChoice, setModelChoice] = useState<string>("auto");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<"memory" | "mcp">("memory");
  const [memoryRows, setMemoryRows] = useState<MemoryRow[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [mcpForm, setMcpForm] = useState({
    name: "",
    transport: "http" as "http" | "stdio",
    url: "",
    command: "",
    args: "",
    enabled: true,
  });
  const [testResult, setTestResult] = useState<string | null>(null);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null,
    [profiles, activeProfileId]
  );

  const { messages, input, handleInputChange, handleSubmit, status, error, stop, setMessages } =
    useChat({
      api: "/api/chat",
      body: {
        model: modelChoice,
        profileId: activeProfile?.id,
      },
    });

  const loadModels = useCallback(async () => {
    try {
      const r = await fetch("/api/models");
      if (!r.ok) return;
      const j = (await r.json()) as { models?: TogetherModel[] };
      if (j.models) setModels(j.models);
    } catch {
      /* ignore */
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    const r = await fetch("/api/profiles");
    if (!r.ok) return;
    const j = (await r.json()) as { profiles: Profile[] };
    const list = j.profiles;
    setProfiles(list);
    const fromLs = localStorage.getItem(LS_PROFILE);
    if (fromLs && list.some((p) => p.id === fromLs)) {
      setActiveProfileId(fromLs);
    } else if (list[0]) {
      setActiveProfileId(list[0].id);
      localStorage.setItem(LS_PROFILE, list[0].id);
    }
  }, []);

  const loadMemory = useCallback(async () => {
    if (!activeProfile) return;
    const r = await fetch(
      `/api/memory?userId=${encodeURIComponent(activeProfile.mem0UserId)}`
    );
    if (!r.ok) return;
    const j = (await r.json()) as { results?: MemoryRow[] };
    setMemoryRows(j.results ?? []);
  }, [activeProfile]);

  const loadMcp = useCallback(async () => {
    const r = await fetch("/api/mcp/servers");
    if (!r.ok) return;
    const j = (await r.json()) as { servers?: McpServer[] };
    setMcpServers(j.servers ?? []);
  }, []);

  useEffect(() => {
    void loadModels();
    void loadProfiles();
    void loadMcp();
  }, [loadModels, loadProfiles, loadMcp]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory, activeProfile?.id]);

  const onProfileChange = (id: string) => {
    setActiveProfileId(id);
    localStorage.setItem(LS_PROFILE, id);
  };

  const addProfile = async () => {
    const name = newProfileName.trim() || "Profile";
    const r = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const p = await r.json();
    setNewProfileName("");
    await loadProfiles();
    onProfileChange(p.id);
  };

  const renameProfile = async (id: string, name: string) => {
    await fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadProfiles();
  };

  const removeProfile = async (id: string) => {
    if (!confirm("Delete this profile and its stored memories?")) return;
    await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    await loadProfiles();
    const next = profiles.find((p) => p.id !== id);
    if (next) onProfileChange(next.id);
  };

  const saveMemory = async (id: string, text: string) => {
    await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await loadMemory();
  };

  const removeMemory = async (id: string) => {
    if (!confirm("Delete this memory?")) return;
    await fetch(`/api/memory/${id}`, { method: "DELETE" });
    await loadMemory();
  };

  const saveMcp = async () => {
    const args = mcpForm.args
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await fetch("/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: mcpForm.name.trim() || "MCP",
        enabled: mcpForm.enabled,
        transport: mcpForm.transport,
        url: mcpForm.transport === "http" ? mcpForm.url.trim() : undefined,
        command: mcpForm.transport === "stdio" ? mcpForm.command.trim() : undefined,
        args: mcpForm.transport === "stdio" ? args : undefined,
      }),
    });
    setMcpForm({ name: "", transport: mcpForm.transport, url: "", command: "", args: "", enabled: true });
    await loadMcp();
  };

  const testMcp = async (id: string) => {
    setTestResult(null);
    const r = await fetch(`/api/mcp/servers/${id}/test`, { method: "POST" });
    const j = await r.json();
    setTestResult(JSON.stringify(j, null, 2));
  };

  const deleteMcp = async (id: string) => {
    if (!confirm("Remove this MCP server?")) return;
    await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
    await loadMcp();
    setTestResult(null);
  };

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="layout">
      <main className="chat-main">
        <header className="top">
          <h1>Helper</h1>
          <label>
            Model
            <select
              className="model-select"
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
            >
              <option value="auto">Auto (cost-aware)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name || m.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Memory profile
            <select
              className="model-select"
              value={activeProfile?.id ?? ""}
              onChange={(e) => onProfileChange(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="small" onClick={() => setMessages([])}>
            New chat
          </button>
        </header>
        {error && (
          <div className="error-banner">{error.message || String(error)}</div>
        )}
        <div className="status">
          {busy ? "Thinking…" : "Ready"}
          {modelChoice === "auto" && !busy && (
            <span className="muted"> — auto picks tier via small classifier</span>
          )}
        </div>
        <div className="messages">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="msg-role">{m.role}</div>
              {(m.parts?.length ? m.parts : null)?.map((part, i) => {
                if (part.type === "text") {
                  return <div key={i}>{part.text}</div>;
                }
                if (part.type === "tool-invocation") {
                  const t = part.toolInvocation as unknown as Record<string, unknown> & {
                    toolName?: string;
                    state?: string;
                  };
                  return (
                    <div key={i} className="tool-part">
                      <strong>{String(t.toolName ?? "?")}</strong> ({String(t.state ?? "")})
                      <pre style={{ margin: "0.35rem 0 0" }}>{JSON.stringify(t, null, 2)}</pre>
                    </div>
                  );
                }
                return null;
              }) ?? (messageText(m) ? <div>{messageText(m)}</div> : null)}
            </div>
          ))}
        </div>
        <div className="composer">
          <form
            onSubmit={(e) => {
              handleSubmit(e);
            }}
          >
            <textarea
              value={input}
              onChange={handleInputChange}
              placeholder="Message…"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            {busy ? (
              <button type="button" className="stop" onClick={() => stop()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="send" disabled={!input.trim()}>
                Send
              </button>
            )}
          </form>
        </div>
      </main>
      <aside className="side">
        <div className="side-tabs">
          <button
            type="button"
            className={sideTab === "memory" ? "active" : ""}
            onClick={() => setSideTab("memory")}
          >
            Memory
          </button>
          <button
            type="button"
            className={sideTab === "mcp" ? "active" : ""}
            onClick={() => setSideTab("mcp")}
          >
            MCP
          </button>
        </div>
        {sideTab === "memory" && (
          <div className="side-panel">
            <h3>Profiles</h3>
            <div className="row">
              <input
                type="text"
                placeholder="New profile name"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
              />
              <button type="button" className="small primary" onClick={() => void addProfile()}>
                Add
              </button>
            </div>
            {profiles.map((p) => (
              <div key={p.id} className="memory-item">
                <ProfileRow
                  name={p.name}
                  onSave={(name) => void renameProfile(p.id, name)}
                  onDelete={() => void removeProfile(p.id)}
                />
              </div>
            ))}
            <p className="muted">Memories for the selected profile</p>
            <h3 style={{ marginTop: "0.75rem" }}>Saved memories</h3>
            <button type="button" className="small" onClick={() => void loadMemory()}>
              Refresh
            </button>
            {memoryRows.map((row) => (
              <MemoryRowEditor
                key={row.id}
                row={row}
                onSave={(text) => void saveMemory(row.id, text)}
                onDelete={() => void removeMemory(row.id)}
              />
            ))}
            {!memoryRows.length && <p className="muted">No memories yet.</p>}
          </div>
        )}
        {sideTab === "mcp" && (
          <div className="side-panel">
            <h3>Add MCP server</h3>
            <div className="row">
              <input
                type="text"
                placeholder="Display name"
                value={mcpForm.name}
                onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="row">
              <select
                value={mcpForm.transport}
                onChange={(e) =>
                  setMcpForm((f) => ({
                    ...f,
                    transport: e.target.value as "http" | "stdio",
                  }))
                }
              >
                <option value="http">HTTP (streamable)</option>
                <option value="stdio">stdio</option>
              </select>
              <label>
                <input
                  type="checkbox"
                  checked={mcpForm.enabled}
                  onChange={(e) => setMcpForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                enabled
              </label>
            </div>
            {mcpForm.transport === "http" ? (
              <div className="row">
                <input
                  type="text"
                  placeholder="MCP URL"
                  value={mcpForm.url}
                  onChange={(e) => setMcpForm((f) => ({ ...f, url: e.target.value }))}
                  style={{ width: "100%" }}
                />
              </div>
            ) : (
              <>
                <div className="row">
                  <input
                    type="text"
                    placeholder="Command (e.g. npx)"
                    value={mcpForm.command}
                    onChange={(e) => setMcpForm((f) => ({ ...f, command: e.target.value }))}
                    style={{ width: "100%" }}
                  />
                </div>
                <div className="row">
                  <input
                    type="text"
                    placeholder="Args (space-separated)"
                    value={mcpForm.args}
                    onChange={(e) => setMcpForm((f) => ({ ...f, args: e.target.value }))}
                    style={{ width: "100%" }}
                  />
                </div>
              </>
            )}
            <button type="button" className="small primary" onClick={() => void saveMcp()}>
              Save server
            </button>
            <h3 style={{ marginTop: "1rem" }}>Configured</h3>
            {mcpServers.map((s) => (
              <div key={s.id} className="mcp-item">
                <div>
                  <strong>{s.name}</strong>{" "}
                  <span className="muted">
                    {s.transport} {s.enabled ? "" : "(off)"}
                  </span>
                </div>
                <div className="row">
                  <button type="button" className="small" onClick={() => void testMcp(s.id)}>
                    Test / list tools
                  </button>
                  <button
                    type="button"
                    className="small danger"
                    onClick={() => void deleteMcp(s.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {testResult && (
              <pre className="tool-part" style={{ marginTop: "0.75rem" }}>
                {testResult}
              </pre>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function ProfileRow(props: {
  name: string;
  onSave: (name: string) => void;
  onDelete: () => void;
}) {
  const [v, setV] = useState(props.name);
  useEffect(() => setV(props.name), [props.name]);
  return (
    <div>
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="small" onClick={() => props.onSave(v)}>
        Save
      </button>
      <button type="button" className="small danger" onClick={props.onDelete}>
        Delete
      </button>
    </div>
  );
}

function MemoryRowEditor(props: {
  row: MemoryRow;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(props.row.memory);
  useEffect(() => setText(props.row.memory), [props.row.memory, props.row.id]);
  return (
    <div className="memory-item">
      <div className="muted" style={{ fontSize: "0.75rem" }}>
        {props.row.id.slice(0, 12)}… score: {props.row.score?.toFixed?.(3) ?? "—"}
      </div>
      <textarea className="edit" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button type="button" className="small primary" onClick={() => props.onSave(text)}>
          Update
        </button>
        <button type="button" className="small danger" onClick={props.onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
