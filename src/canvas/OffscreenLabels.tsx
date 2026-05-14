import { useStore, useReactFlow, type ReactFlowState } from "@xyflow/react";
import { useCanvasStore } from "../store/canvasStore";
import {
  computeOffscreenLabel,
  type Edge,
  type ViewportPx,
} from "./offscreenLabelsMath";

const PAD = 16;

// Anchor the pill so it grows inward from the edge it's pinned to,
// keeping the whole label visible regardless of which side.
function pillTransform(edge: Edge): string {
  switch (edge) {
    case "left":   return "translate(0, -50%)";
    case "right":  return "translate(-100%, -50%)";
    case "top":    return "translate(-50%, 0)";
    case "bottom": return "translate(-50%, -100%)";
  }
}

const transformSel = (s: ReactFlowState) => s.transform;
const widthSel = (s: ReactFlowState) => s.width;
const heightSel = (s: ReactFlowState) => s.height;

export function OffscreenLabels() {
  const transform = useStore(transformSel);
  const W = useStore(widthSel);
  const H = useStore(heightSel);
  const activeId = useCanvasStore((s) => s.activeCanvasId);
  const nodes = useCanvasStore((s) =>
    activeId ? s.nodesByCanvas[activeId] ?? [] : [],
  );
  const rf = useReactFlow();

  if (!W || !H) return null;

  const vp: ViewportPx = {
    tx: transform[0],
    ty: transform[1],
    zoom: transform[2],
    W,
    H,
  };

  const labels = nodes
    .map((n) => computeOffscreenLabel(n, vp, PAD))
    .filter((l): l is NonNullable<typeof l> => l !== null);

  if (labels.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        // Sit above ReactFlow's panes but below MiniMap/Controls (which
        // are positioned with their own z-index). z-index 4 is between
        // node layer (~1-3) and controls (5+).
        zIndex: 4,
      }}
    >
      {labels.map((l) => (
        <button
          key={l.id}
          className="nodrag"
          onClick={() =>
            rf.setCenter(l.cxFlow, l.cyFlow, {
              zoom: vp.zoom,
              duration: 250,
            })
          }
          title={l.title}
          style={{
            position: "absolute",
            left: l.ax,
            top: l.ay,
            transform: pillTransform(l.edge),
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "#222",
            border: "1px solid #444",
            color: "#eee",
            padding: "2px 6px",
            borderRadius: 999,
            fontSize: 11,
            lineHeight: 1.2,
            maxWidth: 180,
            pointerEvents: "auto",
            cursor: "pointer",
            font: "inherit",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              transform: `rotate(${l.angle}rad)`,
              transformOrigin: "center",
              fontSize: 10,
              lineHeight: 1,
            }}
          >
            ▶
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 140,
            }}
          >
            {l.title}
          </span>
        </button>
      ))}
    </div>
  );
}
