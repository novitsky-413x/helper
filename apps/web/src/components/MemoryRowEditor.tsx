import { useState } from "react";

export function MemoryRowEditor(props: {
  row: { id: string; memory: string; score?: number };
  labels: { update: string; delete: string };
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(props.row.memory);
  return (
    <div className="memory-item">
      <div className="muted" style={{ fontSize: "0.75rem" }}>
        {props.row.id.slice(0, 12)}… score: {props.row.score?.toFixed?.(3) ?? "—"}
      </div>
      <textarea className="edit" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <button type="button" className="small primary" onClick={() => props.onSave(text)}>
          {props.labels.update}
        </button>
        <button type="button" className="small danger" onClick={props.onDelete}>
          {props.labels.delete}
        </button>
      </div>
    </div>
  );
}
