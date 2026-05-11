import { useCanvasStore } from "../store/canvasStore";

export function TabBar() {
  const canvases = useCanvasStore((s) => s.canvases);
  const active = useCanvasStore((s) => s.activeCanvasId);
  const setActive = useCanvasStore((s) => s.setActive);
  const addCanvas = useCanvasStore((s) => s.addCanvas);
  const renameCanvas = useCanvasStore((s) => s.renameCanvas);
  const deleteCanvas = useCanvasStore((s) => s.deleteCanvas);

  return (
    <div style={{
      display: "flex", gap: 4, padding: 6, borderBottom: "1px solid #2a2a2a",
      background: "#1a1a1a", color: "#ddd", fontSize: 13,
    }}>
      {canvases.map((c) => (
        <div key={c.id}
          onClick={() => setActive(c.id)}
          onDoubleClick={() => {
            const name = prompt("Rename canvas", c.name);
            if (name && name !== c.name) renameCanvas(c.id, name);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (canvases.length > 1 && confirm(`Delete canvas "${c.name}"?`)) {
              deleteCanvas(c.id);
            }
          }}
          style={{
            padding: "4px 10px", borderRadius: 4, cursor: "pointer",
            background: c.id === active ? "#333" : "transparent",
          }}>
          {c.name}
        </div>
      ))}
      <button onClick={() => addCanvas(`canvas ${canvases.length + 1}`)}
        style={{ marginLeft: 6, padding: "2px 8px" }}>+</button>
    </div>
  );
}
