import { useEffect, useMemo, useState, type RefObject } from "react";
import type { UiText } from "../i18n/uiText";

export function ChatComposer(props: {
  tx: UiText;
  input: string;
  setInput: (v: string) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  busy: boolean;
  stop: () => void;
  pendingImageDataUrl: string;
  setPendingImageDataUrl: (v: string) => void;
  pendingImageName: string;
  setPendingImageName: (v: string) => void;
  liveSpeech: boolean;
  recordingEnabled: boolean;
  setRecordingEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  voiceInterim: string | null;
  setVoiceInterim: (v: null) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onAppendImage: (text: string, dataUrl: string) => void;
  analyticsSection: React.ReactNode;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const { tx, input, setInput, busy, liveSpeech, recordingEnabled, voiceInterim, textareaRef } = props;

  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');

  const slashCommands = useMemo(
    () => [
      { cmd: "/compact", desc: tx.slashDescCompact },
      { cmd: "/dream", desc: tx.slashDescDream },
      { cmd: "/persona", desc: tx.slashDescPersona },
      { cmd: "/tasks", desc: tx.slashDescTasks },
      { cmd: "/learn", desc: tx.slashDescLearn },
      { cmd: "/wiki", desc: tx.slashDescWiki },
      { cmd: "/autopilot", desc: tx.slashDescAutopilot },
      { cmd: "/context", desc: tx.slashDescContext },
    ],
    [tx],
  );

  const filteredCommands = useMemo(
    () => slashCommands.filter((c) => c.cmd.startsWith(slashFilter.toLowerCase())),
    [slashCommands, slashFilter],
  );

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const syncFromDom = () => {
      const v = el.value;
      if (v !== input) {
        setInput(v);
      }
    };
    el.addEventListener("input", syncFromDom);
    return () => el.removeEventListener("input", syncFromDom);
  }, [input, setInput, textareaRef]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    props.handleInputChange(e);
    const val = e.target.value;
    if (val.startsWith('/') && !val.includes(' ')) {
      setShowSlashMenu(true);
      setSlashFilter(val);
    } else {
      setShowSlashMenu(false);
    }
  };

  return (
    <div className="composer">
      <input
        ref={props.imageInputRef}
        id="chat-image-attach"
        name="chat-image-attach"
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result !== "string") return;
            props.setPendingImageDataUrl(reader.result);
            props.setPendingImageName(file.name || "image");
          };
          reader.readAsDataURL(file);
        }}
      />
      {props.pendingImageDataUrl && (
        <div className="voice-interim-inline" style={{ alignItems: "flex-start" }}>
          <img
            src={props.pendingImageDataUrl}
            alt={props.pendingImageName || "pending"}
            style={{ width: "84px", height: "84px", objectFit: "cover", borderRadius: "8px", border: "1px solid #2f3545" }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <span>{tx.imageAttached}{props.pendingImageName ? `: ${props.pendingImageName}` : ""}</span>
            <button
              type="button"
              className="small"
              onClick={() => {
                props.setPendingImageDataUrl("");
                props.setPendingImageName("");
                // eslint-disable-next-line react-hooks/immutability
                if (props.imageInputRef.current) props.imageInputRef.current.value = "";
              }}
            >
              {tx.removeImage}
            </button>
          </div>
        </div>
      )}
      {liveSpeech && recordingEnabled && voiceInterim && (
        <div className="voice-interim-inline">
          <span className="dot" aria-hidden="true" />
          <span>{voiceInterim}</span>
        </div>
      )}
      {props.analyticsSection}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div className="slash-menu">
          {filteredCommands.map((c) => (
            <button
              key={c.cmd}
              className="slash-menu-item"
              type="button"
              onClick={() => {
                props.setInput(c.cmd + ' ');
                setShowSlashMenu(false);
              }}
            >
              <span className="slash-cmd">{c.cmd}</span>
              <span className="slash-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      <form onSubmit={props.onSubmit}>
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            id="chat-composer-message"
            name="chat-composer-message"
            value={input}
            onChange={handleChange}
            placeholder={tx.messagePlaceholder}
            aria-label={tx.messagePlaceholder}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                props.setVoiceInterim(null);
                if (!props.pendingImageDataUrl) {
                  props.onSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
                  return;
                }
                const raw = textareaRef.current?.value ?? input;
                props.onAppendImage(raw.trim(), props.pendingImageDataUrl);
              }
            }}
          />
          <button
            type="button"
            className={props.pendingImageDataUrl ? "composer-attach-btn attached" : "composer-attach-btn"}
            onClick={() => props.imageInputRef.current?.click()}
            title={tx.attachImage}
            aria-label={tx.attachImage}
            data-tooltip={tx.attachImage}
          >
            {"\uD83D\uDDBC"}
          </button>
        </div>
        {busy ? (
          <button type="button" className="stop" onClick={() => props.stop()}>
            {tx.stop}
          </button>
        ) : (
          <>
            <button type="submit" className="send" disabled={!input.trim() && !props.pendingImageDataUrl}>
              {tx.send}
            </button>
            {liveSpeech && (
              <button
                type="button"
                className={recordingEnabled ? "voice-record-btn on" : "voice-record-btn off"}
                onClick={() =>
                  props.setRecordingEnabled((v) => {
                    const next = !v;
                    if (!next) props.setVoiceInterim(null);
                    return next;
                  })
                }
                title={recordingEnabled ? tx.recordStop : tx.recordStart}
                aria-label={recordingEnabled ? tx.recordStop : tx.recordStart}
              >
                {recordingEnabled ? "\u23F9" : "\uD83C\uDF99"}
              </button>
            )}
          </>
        )}
      </form>
    </div>
  );
}
