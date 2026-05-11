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
        cursor: "grab",
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
          style={{ flex: "0 1 auto", maxWidth: 200, minWidth: 0, background: "#111", color: "#eee", border: "1px solid #555", padding: "1px 4px" }}
        />
      ) : (
        // Title takes its content width up to maxWidth, then ellipsis.
        // Subtitle (flex: 1) gets all remaining space.
        <span
          onDoubleClick={() => { setDraft(title); setEditing(true); }}
          style={{
            flex: "0 1 auto", maxWidth: 200, minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            userSelect: "none", cursor: "inherit",
          }}
          title="Drag to move · Double-click to rename"
        >
          {title}
        </span>
      )}
      {subtitle && (
        <span
          title={subtitle}
          style={{
            flex: "1 1 auto", minWidth: 0,
            opacity: 0.5,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {subtitle}
        </span>
      )}
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
