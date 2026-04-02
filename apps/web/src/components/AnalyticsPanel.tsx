import type { UiText } from "../i18n/uiText";
import type { UsageSnapshot } from "@helper/shared";

export function AnalyticsPanel(props: {
  analyticsOpen: boolean;
  setAnalyticsOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  tx: UiText;
  selectedModelLabel: string;
  resolvedModelId: string | null;
  resolvedBaseModel: string | null;
  precisePromptTokens: number | null;
  totalContextUsed: number;
  contextWindow: number;
  totalContextLeft: number;
  riskLevel: string;
  usageOwnerLabel: string;
  usageStatus: "loading" | "empty" | "current" | "stale";
  lastUsage: UsageSnapshot | null;
  prettyNum: (n: number) => string;
  requestCostUsd: number | null;
  memoryRowsLen: number;
  mem0Chars: number;
  mem0TokensApprox: number;
  mem0InjectedApprox: number;
  sessionCostUsd: number | null;
  usedModels: string[];
}) {
  return (
    <>
      <div className={`analytics-drawer ${props.analyticsOpen ? "open" : ""}`}>
        <div className="analytics-grid">
          <div className="analytics-card">
            <h4>{props.tx.contextAnalytics}</h4>
            <div className="analytics-row"><span>{props.tx.selectedModel}</span><strong>{props.selectedModelLabel}</strong></div>
            <div className="analytics-row"><span>{props.tx.resolvedModel}</span><strong>{props.resolvedModelId ? `${props.resolvedModelId}${props.resolvedBaseModel ? ` (base: ${props.resolvedBaseModel})` : ""}` : "—"}</strong></div>
            <div className="analytics-row"><span>{props.tx.estContextUsed}</span><strong>{props.precisePromptTokens !== null ? props.prettyNum(props.totalContextUsed) : `~${props.prettyNum(props.totalContextUsed)}`}</strong></div>
            <div className="analytics-row"><span>{props.tx.estContextLimit}</span><strong>{props.prettyNum(props.contextWindow)}</strong></div>
            <div className="analytics-row"><span>{props.tx.estContextLeft}</span><strong>{props.prettyNum(props.totalContextLeft)}</strong></div>
            <div className="analytics-row"><span>{props.tx.contextRisk}</span><strong>{props.riskLevel}</strong></div>
          </div>
          <div className="analytics-card">
            <h4>{props.tx.lastRequestUsage}</h4>
            <div className="analytics-row"><span>{props.tx.analyticsProfileOwner}</span><strong>{props.usageOwnerLabel}</strong></div>
            <div className="analytics-row">
              <span>{props.tx.analyticsProfileStatus}</span>
              <strong className={props.usageStatus === "current" ? "ok-text" : props.usageStatus === "stale" ? "warn-text" : ""}>
                {props.usageStatus === "loading"
                  ? props.tx.analyticsProfileStatusLoading
                  : props.usageStatus === "empty"
                    ? props.tx.analyticsProfileStatusEmpty
                    : props.usageStatus === "current"
                      ? props.tx.analyticsProfileStatusCurrent
                      : props.tx.analyticsProfileStatusStale}
              </strong>
            </div>
            <div className="analytics-row"><span>{props.tx.promptTokens}</span><strong>{props.lastUsage?.promptTokens != null ? props.prettyNum(props.lastUsage.promptTokens) : "—"}</strong></div>
            <div className="analytics-row"><span>{props.tx.completionTokens}</span><strong>{props.lastUsage?.completionTokens != null ? props.prettyNum(props.lastUsage.completionTokens) : "—"}</strong></div>
            <div className="analytics-row"><span>{props.tx.totalTokens}</span><strong>{props.lastUsage?.totalTokens != null ? props.prettyNum(props.lastUsage.totalTokens) : "—"}</strong></div>
            <div className="analytics-row"><span>{props.tx.estRequestCost}</span><strong>{props.requestCostUsd !== null ? `$${props.requestCostUsd.toFixed(6)}` : "—"}</strong></div>
            <p className="muted">{props.tx.estRequestCostNote}</p>
            <div className="analytics-row"><span>{props.tx.memoryInjected}</span><strong>{props.lastUsage ? props.prettyNum(props.lastUsage.memoryBlockChars) : "—"}</strong></div>
            <div className="analytics-row"><span>{props.tx.memoryHits}</span><strong>{props.lastUsage ? props.prettyNum(props.lastUsage.memoryHits) : "—"}</strong></div>
            <div className="analytics-row">
              <span>{props.tx.analyticsMemoryWrites}</span>
              <strong>
                {props.lastUsage
                  ? `${props.prettyNum(props.lastUsage.memoryWriteOkTotal ?? 0)} / ${props.prettyNum(props.lastUsage.memoryWriteFailTotal ?? 0)}`
                  : "—"}
              </strong>
            </div>
            <div className="analytics-row">
              <span>{props.tx.analyticsLastMemoryWrite}</span>
              <strong className={props.lastUsage?.memoryWriteLastOk === false ? "warn-text" : props.lastUsage?.memoryWriteLastOk === true ? "ok-text" : ""}>
                {props.lastUsage?.memoryWriteLastOk === true
                  ? props.tx.analyticsOk
                  : props.lastUsage?.memoryWriteLastOk === false
                    ? props.tx.analyticsFail
                    : "—"}
              </strong>
            </div>
          </div>
          <div className="analytics-card">
            <h4>{props.tx.mem0Usage}</h4>
            <div className="analytics-row"><span>{props.tx.mem0Rows}</span><strong>{props.prettyNum(props.memoryRowsLen)}</strong></div>
            <div className="analytics-row"><span>{props.tx.mem0Chars}</span><strong>{props.prettyNum(props.mem0Chars)}</strong></div>
            <div className="analytics-row"><span>{props.tx.mem0ApproxTokens}</span><strong>~{props.prettyNum(props.mem0TokensApprox)}</strong></div>
            <div className="analytics-row"><span>{props.tx.analyticsMem0InPrompt}</span><strong>~{props.prettyNum(props.mem0InjectedApprox)}</strong></div>
            <p className="muted">{props.tx.mem0Note}</p>
          </div>
          <div className="analytics-card">
            <h4>{props.tx.modelUsageSession}</h4>
            <div className="analytics-row"><span>{props.tx.sessionCost}</span><strong>{props.sessionCostUsd !== null ? `$${props.sessionCostUsd.toFixed(6)}` : "—"}</strong></div>
            {props.usedModels.length ? (
              <ul className="analytics-list">{props.usedModels.map((m) => <li key={m}>{m}</li>)}</ul>
            ) : (
              <p className="muted">—</p>
            )}
            <p className="muted">{props.tx.analyticsEstimateNote}</p>
          </div>
        </div>
      </div>
      <div className="analytics-toggle-row">
        <button type="button" className="small" onClick={() => props.setAnalyticsOpen((v) => !v)} aria-expanded={props.analyticsOpen}>
          {props.analyticsOpen ? props.tx.contextAnalyticsClose : props.tx.contextAnalyticsOpen}
        </button>
      </div>
    </>
  );
}
