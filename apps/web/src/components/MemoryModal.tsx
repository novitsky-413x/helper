import { MemoryRowEditor } from "./MemoryRowEditor";
import type { UiText } from "../i18n/uiText";

export function MemoryModal(props: {
  open: boolean;
  tx: UiText;
  memoryRows: Array<{ id: string; memory: string; score?: number }>;
  memoryLoading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSaveRow: (id: string, text: string) => void;
  onDeleteRow: (id: string) => void;
}) {
  if (!props.open) return null;
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{props.tx.memoryTab}</h3>
          <button type="button" className="small" onClick={props.onClose}>
            {props.tx.close}
          </button>
        </div>
        <p className="muted">{props.tx.memorySelectedProfileHint}</p>
        <button type="button" className="small" onClick={props.onRefresh} disabled={props.memoryLoading}>
          {props.tx.refresh}
        </button>
        {props.memoryLoading && (
          <div className="thinking-inline" style={{ display: "flex", alignItems: "center", gap: "0.4rem", margin: "0.5rem 0" }}>
            <span className="thinking-spinner" aria-hidden="true" />
            <span>{props.tx.memoryLoading}</span>
          </div>
        )}
        {props.memoryRows.map((row) => (
          <MemoryRowEditor
            key={`${row.id}:${row.memory}`}
            row={row}
            labels={{ update: props.tx.update, delete: props.tx.delete }}
            onSave={(text) => props.onSaveRow(row.id, text)}
            onDelete={() => props.onDeleteRow(row.id)}
          />
        ))}
        {!props.memoryRows.length && !props.memoryLoading && <p className="muted">{props.tx.noMemoriesYet}</p>}
      </div>
    </div>
  );
}
