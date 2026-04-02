import { useState } from "react";

export function ProfileRow(props: {
  profileId: string;
  name: string;
  labels: { save: string; delete: string };
  onSave: (name: string) => void;
  onDelete: () => void;
}) {
  const [v, setV] = useState(props.name);
  const fieldId = `profile-rename-${props.profileId}`;
  return (
    <div>
      <input id={fieldId} name={fieldId} type="text" value={v} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="small" onClick={() => props.onSave(v)}>
        {props.labels.save}
      </button>
      <button type="button" className="small danger" onClick={props.onDelete}>
        {props.labels.delete}
      </button>
    </div>
  );
}
