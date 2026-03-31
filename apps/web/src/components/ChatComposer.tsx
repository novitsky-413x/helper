import { useRef } from "react";
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
}) {
  const { tx, input, busy, liveSpeech, recordingEnabled, voiceInterim } = props;

  return (
    <div className="composer">
      <input
        ref={props.imageInputRef}
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
      <form onSubmit={props.onSubmit}>
        <div className="composer-input-wrap">
          <textarea
            value={input}
            onChange={props.handleInputChange}
            placeholder={tx.messagePlaceholder}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                props.setVoiceInterim(null);
                if (!props.pendingImageDataUrl) {
                  props.onSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
                  return;
                }
                props.onAppendImage(input.trim(), props.pendingImageDataUrl);
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
