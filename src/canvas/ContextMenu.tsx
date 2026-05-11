import type { NodeType } from "../types";

interface Props {
  x: number; y: number;
  onPick: (type: NodeType) => void;
  onClose: () => void;
}

const ITEMS: Array<{ type: NodeType; label: string }> = [
  { type: "terminal", label: "New Terminal" },
  { type: "claude",   label: "New Claude Code" },
  { type: "codex",    label: "New Codex" },
  { type: "note",     label: "New Note" },
];

export function ContextMenu({ x, y, onPick, onClose }: Props) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
    }}>
      <div style={{
        position: "absolute", top: y, left: x,
        background: "#222", color: "#ddd", border: "1px solid #444",
        borderRadius: 4, padding: 4, minWidth: 160, fontSize: 13,
      }} onClick={(e) => e.stopPropagation()}>
        {ITEMS.map((i) => (
          <div key={i.type}
            onClick={() => { onPick(i.type); onClose(); }}
            style={{ padding: "6px 10px", cursor: "pointer" }}>
            {i.label}
          </div>
        ))}
      </div>
    </div>
  );
}
