import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../store/canvasStore";

export function TabBar() {
  const canvases = useCanvasStore((s) => s.canvases);
  const active = useCanvasStore((s) => s.activeCanvasId);
  const setActive = useCanvasStore((s) => s.setActive);
  const addCanvas = useCanvasStore((s) => s.addCanvas);
  const renameCanvas = useCanvasStore((s) => s.renameCanvas);
  const deleteCanvas = useCanvasStore((s) => s.deleteCanvas);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl + 1..9 jumps to the N-th tab.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (Number.isNaN(n) || n < 1 || n > 9) return;
      const target = canvases[n - 1];
      if (target) {
        e.preventDefault();
        setActive(target.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canvases, setActive]);

  const startRename = (id: string, current: string) => {
    setEditingId(id);
    setDraft(current);
    setTimeout(() => editInputRef.current?.select(), 0);
  };

  const commitRename = (id: string) => {
    const next = draft.trim();
    const c = canvases.find((x) => x.id === id);
    if (c && next && next !== c.name) renameCanvas(id, next);
    setEditingId(null);
  };

  const handleClose = (id: string, name: string) => {
    if (canvases.length <= 1) return;
    if (confirm(`Delete canvas "${name}"?`)) deleteCanvas(id);
  };

  return (
    <div style={{
      display: "flex", gap: 2, padding: 6, borderBottom: "1px solid #2a2a2a",
      background: "#1a1a1a", color: "#ddd", fontSize: 13,
    }}>
      {canvases.map((c, i) => {
        const isActive = c.id === active;
        const isEditing = editingId === c.id;
        const idx = i + 1;
        const shortcutHint = idx <= 9 ? ` (⌘${idx})` : "";
        return (
          <div
            key={c.id}
            onClick={() => { if (!isEditing) setActive(c.id); }}
            onDoubleClick={() => startRename(c.id, c.name)}
            title={isEditing ? undefined : `Double-click to rename · Click × to close${shortcutHint}`}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 4px 3px 10px", borderRadius: 4,
              cursor: isEditing ? "text" : "pointer",
              background: isActive ? "#333" : "transparent",
              color: isActive ? "#fff" : "#bbb",
            }}
          >
            {isEditing ? (
              <input
                ref={editInputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitRename(c.id); }
                  if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                }}
                autoFocus
                style={{
                  background: "#0d0d0d", color: "#eee",
                  border: "1px solid #555", borderRadius: 3,
                  padding: "1px 4px", fontSize: 13,
                  outline: "none", width: Math.max(80, draft.length * 8 + 16),
                }}
              />
            ) : (
              <span style={{ userSelect: "none" }}>{c.name}</span>
            )}
            {!isEditing && canvases.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleClose(c.id, c.name); }}
                title="Close canvas"
                style={{
                  width: 16, height: 16, lineHeight: "14px",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: "transparent",
                  color: isActive ? "#aaa" : "#666",
                  border: "none", borderRadius: 3,
                  cursor: "pointer", padding: 0,
                  fontSize: 14,
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={() => addCanvas(`canvas ${canvases.length + 1}`)}
        title="New canvas"
        style={{
          marginLeft: 6, padding: "2px 10px",
          background: "transparent", color: "#aaa",
          border: "1px dashed #444", borderRadius: 4,
          cursor: "pointer", fontSize: 13,
        }}
      >
        +
      </button>
    </div>
  );
}
