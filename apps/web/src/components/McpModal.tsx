import type { UiText } from "../i18n/uiText";

export type McpForm = {
  name: string;
  transport: "http" | "stdio";
  url: string;
  command: string;
  args: string;
  enabled: boolean;
};

export function McpModal(props: {
  open: boolean;
  tx: UiText;
  mcpForm: McpForm;
  mcpServers: Array<{ id: string; name: string; enabled: boolean; transport: "http" | "stdio" }>;
  testResult: string | null;
  onClose: () => void;
  onFormChange: (next: McpForm) => void;
  onSave: () => void;
  onTest: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!props.open) return null;
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{props.tx.mcpTab}</h3>
          <button type="button" className="small" onClick={props.onClose}>
            {props.tx.close}
          </button>
        </div>
        <h3>{props.tx.addMcpServer}</h3>
        <div className="row">
          <input
            type="text"
            placeholder={props.tx.displayName}
            value={props.mcpForm.name}
            onChange={(e) => props.onFormChange({ ...props.mcpForm, name: e.target.value })}
          />
        </div>
        <div className="row">
          <select
            value={props.mcpForm.transport}
            onChange={(e) => props.onFormChange({ ...props.mcpForm, transport: e.target.value as "http" | "stdio" })}
          >
            <option value="http">{props.tx.transportHttp}</option>
            <option value="stdio">{props.tx.transportStdio}</option>
          </select>
          <label>
            <input
              type="checkbox"
              checked={props.mcpForm.enabled}
              onChange={(e) => props.onFormChange({ ...props.mcpForm, enabled: e.target.checked })}
            />
            {props.tx.enabled}
          </label>
        </div>
        {props.mcpForm.transport === "http" ? (
          <div className="row">
            <input
              type="text"
              placeholder={props.tx.mcpUrl}
              value={props.mcpForm.url}
              onChange={(e) => props.onFormChange({ ...props.mcpForm, url: e.target.value })}
              style={{ width: "100%" }}
            />
          </div>
        ) : (
          <>
            <div className="row">
              <input
                type="text"
                placeholder={props.tx.command}
                value={props.mcpForm.command}
                onChange={(e) => props.onFormChange({ ...props.mcpForm, command: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
            <div className="row">
              <input
                type="text"
                placeholder={props.tx.args}
                value={props.mcpForm.args}
                onChange={(e) => props.onFormChange({ ...props.mcpForm, args: e.target.value })}
                style={{ width: "100%" }}
              />
            </div>
          </>
        )}
        <button type="button" className="small primary" onClick={props.onSave}>
          {props.tx.saveServer}
        </button>
        <h3 style={{ marginTop: "1rem" }}>{props.tx.configured}</h3>
        {props.mcpServers.map((s) => (
          <div key={s.id} className="mcp-item">
            <div>
              <strong>{s.name}</strong>{" "}
              <span className="muted">
                {s.transport} {s.enabled ? "" : "(off)"}
              </span>
            </div>
            <div className="row">
              <button type="button" className="small" onClick={() => props.onTest(s.id)}>
                {props.tx.testListTools}
              </button>
              <button type="button" className="small danger" onClick={() => props.onDelete(s.id)}>
                {props.tx.remove}
              </button>
            </div>
          </div>
        ))}
        {props.testResult && (
          <pre className="tool-part" style={{ marginTop: "0.75rem" }}>
            {props.testResult}
          </pre>
        )}
      </div>
    </div>
  );
}
