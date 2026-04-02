import { useState } from 'react';
import { ProfileRow } from "./ProfileRow";
import type { UiLang, UiText } from "../i18n/uiText";
import type { ModelHealthEntry } from "../types/appTypes";

type TaskCategory = "primary" | "code_mcp" | "reasoning" | "vision" | "image_gen" | "audio" | "memory";

function HealthDot({ entry }: { entry: ModelHealthEntry | undefined }) {
  if (!entry || entry.status === "unknown") {
    return <span className="health-dot unknown" title="Not checked" />;
  }
  if (entry.status === "checking") {
    return <span className="health-dot checking" title="Checking..." />;
  }
  const latency = entry.latencyMs != null ? `${entry.latencyMs}ms` : "";
  if (entry.status === "available") {
    return <span className="health-dot available" title={`Available${latency ? ` · ${latency}` : ""}`} />;
  }
  const errHint = entry.error ? `: ${entry.error.slice(0, 100)}` : "";
  return <span className="health-dot unavailable" title={`Unavailable${errHint}`} />;
}

type PersonaData = { avatarEmoji?: string; personality?: string; voiceStyle?: string };

function PersonaEditForm({ initial, onSave }: { initial: PersonaData; onSave: (data: PersonaData) => void }) {
  const [personaEdit, setPersonaEdit] = useState({
    avatarEmoji: initial.avatarEmoji ?? '🤖',
    personality: initial.personality ?? '',
    voiceStyle: initial.voiceStyle ?? '',
  });

  return (
    <>
      <h3 className="settings-subheading">🎭 Profile Persona</h3>
      <div className="persona-form">
        <label className="persona-label">Avatar</label>
        <input className="persona-input" placeholder="🤖" value={personaEdit.avatarEmoji} onChange={(e) => setPersonaEdit(f => ({...f, avatarEmoji: e.target.value}))} />
        <label className="persona-label">Voice style</label>
        <input className="persona-input" placeholder="Friendly, concise..." value={personaEdit.voiceStyle} onChange={(e) => setPersonaEdit(f => ({...f, voiceStyle: e.target.value}))} />
        <label className="persona-label">Personality</label>
        <textarea className="persona-input" placeholder="Describe how the agent should behave..." value={personaEdit.personality} onChange={(e) => setPersonaEdit(f => ({...f, personality: e.target.value}))} rows={3} />
        <button className="small primary" type="button" onClick={() => onSave(personaEdit)}>Save Persona</button>
      </div>
    </>
  );
}

export function SettingsModal(props: {
  open: boolean;
  tx: UiText;
  uiLang: UiLang;
  setUiLang: (lang: UiLang) => void;
  activeProfileId: string | null;
  activeBrowserVoiceUri: string;
  browserVoices: SpeechSynthesisVoice[];
  setVoiceForActiveProfile: (voiceUri: string) => void;
  profiles: Array<{ id: string; name: string }>;
  newProfileName: string;
  setNewProfileName: (v: string) => void;
  addProfile: () => void;
  renameProfile: (id: string, name: string) => void;
  removeProfile: (id: string) => void;
  taskCategories: TaskCategory[];
  categoryLabel: (category: TaskCategory) => string;
  categoryOptions: Record<TaskCategory, string[]>;
  modelsLoading: boolean;
  modelHealth: Record<string, ModelHealthEntry>;
  categoryModelPrice: (id: string) => string;
  canEditCategory: boolean;
  moveCategoryModel: (category: TaskCategory, id: string, direction: "up" | "down") => void;
  memoryTopKDraft: number;
  setMemoryTopKDraft: (v: number) => void;
  memoryMaxCharsDraft: number;
  setMemoryMaxCharsDraft: (v: number) => void;
  saveMemoryPolicy: () => void;
  onClose: () => void;
  activeProfilePersona?: PersonaData;
  onSavePersona: (data: PersonaData) => void;
}) {
  if (!props.open) return null;
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal-card settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{props.tx.settings}</h3>
          <button type="button" className="small" onClick={props.onClose}>
            {props.tx.close}
          </button>
        </div>
        <div className="settings-grid">
          <section className="settings-section">
            <label className="modal-field">
              {props.tx.uiLanguage}
              <select className="model-select" value={props.uiLang} onChange={(e) => props.setUiLang(e.target.value as UiLang)}>
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </label>
            <label className="modal-field">
              {props.tx.ttsVoice}
              <select
                className="model-select"
                value={props.activeBrowserVoiceUri}
                onChange={(e) => props.setVoiceForActiveProfile(e.target.value)}
                disabled={!props.activeProfileId}
              >
                {!props.browserVoices.length && <option value="">{props.tx.noBrowserVoices}</option>}
                {props.browserVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <span className="muted">{props.tx.browserVoicesHint}</span>
            </label>
            <h3 style={{ margin: "0.5rem 0" }}>{props.tx.profilesTitle}</h3>
            <div className="row">
              <input
                type="text"
                placeholder={props.tx.newProfileName}
                value={props.newProfileName}
                onChange={(e) => props.setNewProfileName(e.target.value)}
              />
              <button type="button" className="small primary" onClick={props.addProfile}>
                {props.tx.add}
              </button>
            </div>
            <div className="settings-scroll">
              {props.profiles.map((p) => (
                <div key={p.id} className="memory-item">
                  <ProfileRow
                    name={p.name}
                    labels={{ save: props.tx.save, delete: props.tx.delete }}
                    onSave={(name) => props.renameProfile(p.id, name)}
                    onDelete={() => props.removeProfile(p.id)}
                  />
                </div>
              ))}
            </div>

            <PersonaEditForm
              initial={props.activeProfilePersona ?? {}}
              onSave={props.onSavePersona}
            />
          </section>
          <section className="settings-section">
            <h3 style={{ margin: "0.75rem 0" }}>{props.tx.modelCategories}</h3>
            <div className="settings-scroll">
              {props.taskCategories.map((category) => {
                const ordered = props.categoryOptions[category] ?? [];
                return (
                  <div className="modal-field" key={category}>
                    <strong>{props.categoryLabel(category)}</strong>
                    {!ordered.length && !props.modelsLoading && (
                      <div className="muted">{props.modelsLoading ? props.tx.modelsLoading : props.tx.noCategoryOptions}</div>
                    )}
                    {props.modelsLoading && (
                      <>
                        <div className="muted">{props.tx.modelsLoading}</div>
                        <div className="settings-skeleton-list" aria-hidden="true">
                          <div className="settings-skeleton-row" />
                          <div className="settings-skeleton-row" />
                          <div className="settings-skeleton-row" />
                        </div>
                      </>
                    )}
                    {!props.modelsLoading && ordered.slice(0, 8).map((id, idx) => (
                      <div className="row" key={`${category}:${id}`} style={{ alignItems: "center" }}>
                        <HealthDot entry={props.modelHealth[id]} />
                        <span style={{ flex: 1 }}>
                          {id}
                          {props.categoryModelPrice(id) ? ` · ${props.categoryModelPrice(id)}` : ""}
                        </span>
                        <button
                          type="button"
                          className="small"
                          onClick={() => props.moveCategoryModel(category, id, "up")}
                          disabled={!props.canEditCategory || idx === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="small"
                          onClick={() => props.moveCategoryModel(category, id, "down")}
                          disabled={!props.canEditCategory || idx === ordered.length - 1}
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <h3 style={{ margin: "0.75rem 0" }}>{props.tx.memoryPolicyTitle}</h3>
            <p className="muted">{props.tx.memoryPolicyHelp}</p>
            <div className="row">
              <label className="modal-field-inline">
                {props.tx.memoryPolicyTopK}
                <input
                  type="number"
                  value={props.memoryTopKDraft}
                  min={1}
                  max={30}
                  onChange={(e) => props.setMemoryTopKDraft(Number(e.target.value || 10))}
                />
                <span className="muted">{props.tx.memoryPolicyTopKHelp}</span>
              </label>
              <label className="modal-field-inline">
                {props.tx.memoryPolicyMaxChars}
                <input
                  type="number"
                  value={props.memoryMaxCharsDraft}
                  min={200}
                  max={12000}
                  onChange={(e) => props.setMemoryMaxCharsDraft(Number(e.target.value || 3500))}
                />
                <span className="muted">{props.tx.memoryPolicyMaxCharsHelp}</span>
              </label>
            </div>
            <button type="button" className="small" onClick={props.saveMemoryPolicy}>
              {props.tx.saveMemoryPolicy}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
