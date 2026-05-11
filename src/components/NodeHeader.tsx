import React, { useState } from "react";

interface Props {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  onRename: (title: string) => void;
  onDelete: () => void;
  children?: React.ReactNode; // extra toolbar buttons
}

export function NodeHeader({ title, subtitle, badge, onRename, onDelete, children }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  return (
    <div
      className="node-drag-handle"
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 8px", background: "#222", color: "#eee",
        borderTopLeftRadius: 4, borderTopRightRadius: 4,
        borderBottom: "1px solid #444", fontSize: 12,
        cursor: "move",
      }}
    >
      {badge}
      {editing ? (
        <input
          className="nodrag"
          autoFocus value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onRename(draft); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onRename(draft); setEditing(false); }
            if (e.key === "Escape") { setDraft(title); setEditing(false); }
          }}
          style={{ flex: 1, background: "#111", color: "#eee", border: "1px solid #555", padding: "1px 4px" }}
        />
      ) : (
        <span
          className="nodrag"
          onDoubleClick={() => { setDraft(title); setEditing(true); }}
          style={{ flex: 1, userSelect: "none", cursor: "text" }}
        >
          {title}
        </span>
      )}
      {subtitle && <span style={{ opacity: 0.5, pointerEvents: "none" }}>{subtitle}</span>}
      {children}
      <button
        className="nodrag"
        onClick={onDelete}
        title="Delete"
        style={{ background: "transparent", color: "#aaa", border: "none", cursor: "pointer" }}
      >
        ✕
      </button>
    </div>
  );
}
