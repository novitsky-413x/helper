import { useMemo, useState } from "react";
import type { UiText } from "../i18n/uiText";
import type { TogetherModel, Profile, ModelHealthEntry } from "../types/appTypes";
import { formatPricePerMillion } from "../hooks/useAnalyticsMetrics";

const HEALTH_PREFIX: Record<string, string> = {
  available: "\u2713 ",
  unavailable: "\u2717 ",
  checking: "\u23F3 ",
};

export function AppHeader(props: {
  tx: UiText;
  models: TogetherModel[];
  modelChoice: string;
  setModelChoice: (v: string) => void;
  modelHealth: Record<string, ModelHealthEntry>;
  profiles: Profile[];
  activeProfile: Profile | null | undefined;
  onProfileChange: (id: string) => void;
  onMemoryOpen: () => void;
  onMcpOpen: () => void;
  onSettingsOpen: () => void;
  onNewChat: () => void;
  liveSpeech: boolean;
  setLiveSpeech: React.Dispatch<React.SetStateAction<boolean>>;
  setRecordingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setVoiceInterim: (v: null) => void;
  ttsOutputEnabled: boolean;
  setTtsOutputEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { tx, models, modelChoice, profiles, activeProfile, modelHealth } = props;
  const [modelQuery, setModelQuery] = useState("");

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) || (m.display_name ?? "").toLowerCase().includes(q),
    );
  }, [models, modelQuery]);

  const modelsForSelect = useMemo(() => {
    if (modelChoice === "auto") return filteredModels;
    const sel = models.find((m) => m.id === modelChoice);
    if (!sel) return filteredModels;
    if (filteredModels.some((m) => m.id === modelChoice)) return filteredModels;
    return [sel, ...filteredModels];
  }, [models, filteredModels, modelChoice]);

  return (
    <header className="top">
      <h1>Helper</h1>
      <button
        type="button"
        className="small icon-button"
        onClick={props.onNewChat}
        title={tx.newChat ?? "New chat"}
        aria-label={tx.newChat ?? "New chat"}
      >
        +
      </button>
      <label className="model-select-block">
        {tx.model}
        <input
          type="search"
          id="helper-model-filter"
          name="helper-model-filter"
          className="model-filter-input"
          value={modelQuery}
          onChange={(e) => setModelQuery(e.target.value)}
          placeholder={tx.modelSearchPlaceholder}
          aria-label={tx.modelSearchPlaceholder}
          autoComplete="off"
        />
        <select
          id="helper-model-choice"
          name="helper-model-choice"
          className="model-select"
          value={modelChoice}
          onChange={(e) => props.setModelChoice(e.target.value)}
        >
          <option value="auto">{tx.modelAutoOption}</option>
          {modelsForSelect.map((m) => {
            const h = modelHealth[m.id];
            const prefix = h ? (HEALTH_PREFIX[h.status] ?? "") : "";
            return (
              <option key={m.id} value={m.id}>
                {`${prefix}${m.display_name || m.id}${formatPricePerMillion(m) ? ` · ${formatPricePerMillion(m)}` : ""}`}
              </option>
            );
          })}
        </select>
      </label>
      <label>
        {tx.memoryProfile}
        <select
          id="helper-profile-choice"
          name="helper-profile-choice"
          className="model-select"
          value={activeProfile?.id ?? ""}
          onChange={(e) => props.onProfileChange(e.target.value)}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="small icon-button"
        onClick={props.onMemoryOpen}
        title={tx.memoryTab}
        aria-label={tx.memoryTab}
      >
        {"\uD83E\uDDE0"}
      </button>
      <button
        type="button"
        className="small icon-button"
        onClick={props.onMcpOpen}
        title={tx.mcpTab}
        aria-label={tx.mcpTab}
      >
        {"\uD83E\uDDE9"}
      </button>
      <button
        type="button"
        className="small icon-button"
        onClick={props.onSettingsOpen}
        title={tx.settings}
        aria-label={tx.settings}
      >
        {"\u2699"}
      </button>
      <button
        type="button"
        className={props.liveSpeech ? "small live-speech on" : "small live-speech"}
        onClick={() =>
          props.setLiveSpeech((v) => {
            const next = !v;
            if (!next) {
              props.setRecordingEnabled(false);
              props.setVoiceInterim(null);
            }
            return next;
          })
        }
        title={props.liveSpeech ? tx.liveOn : tx.liveOff}
        aria-label={props.liveSpeech ? tx.liveOn : tx.liveOff}
      >
        {props.liveSpeech ? tx.liveOn : tx.liveOff}
      </button>
      {props.liveSpeech && (
        <button
          type="button"
          className={props.ttsOutputEnabled ? "small voice-output-toggle on" : "small voice-output-toggle off"}
          onClick={() => props.setTtsOutputEnabled((v) => !v)}
          title={props.ttsOutputEnabled ? tx.voiceOutputOn : tx.voiceOutputOff}
          aria-label={props.ttsOutputEnabled ? tx.voiceOutputOn : tx.voiceOutputOff}
        >
          <span className="voice-output-icon" aria-hidden="true">
            {"\uD83D\uDD0A"}
          </span>
        </button>
      )}
    </header>
  );
}
