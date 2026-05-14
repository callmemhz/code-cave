import { useEffect, useRef } from "react";
import { useStore, useReactFlow, type ReactFlowState } from "@xyflow/react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useCanvasStore } from "../store/canvasStore";
import { onPtyData } from "../ipc/events";
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

// Keyframes injected once. Inline styles can't express @keyframes.
const BREATHE_STYLE_ID = "offscreen-label-breathe";
function ensureBreatheKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(BREATHE_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = BREATHE_STYLE_ID;
  el.textContent =
    "@keyframes offscreen-label-breathe { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }";
  document.head.appendChild(el);
}

const transformSel = (s: ReactFlowState) => s.transform;
const widthSel = (s: ReactFlowState) => s.width;
const heightSel = (s: ReactFlowState) => s.height;

export function OffscreenLabels() {
  ensureBreatheKeyframes();

  const transform = useStore(transformSel);
  const W = useStore(widthSel);
  const H = useStore(heightSel);
  const activeId = useCanvasStore((s) => s.activeCanvasId);
  const nodes = useCanvasStore((s) =>
    activeId ? s.nodesByCanvas[activeId] ?? [] : [],
  );
  const unreadByNode = useCanvasStore((s) => s.unreadByNode);
  const markUnread = useCanvasStore((s) => s.markUnread);
  const markRead = useCanvasStore((s) => s.markRead);
  const rf = useReactFlow();

  // Refs let the PTY listener read the current viewport + node positions
  // without re-subscribing on every pan/zoom/drag tick.
  const vpRef = useRef({ tx: transform[0], ty: transform[1], zoom: transform[2], W, H });
  vpRef.current = { tx: transform[0], ty: transform[1], zoom: transform[2], W, H };
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Subscribe to pty:data for every node in the active canvas. Re-sub only
  // when the set of node ids changes (not on position/size updates).
  const nodeIdsKey = nodes.map((n) => n.id).join(",");
  useEffect(() => {
    const unsubs: UnlistenFn[] = [];
    let cancelled = false;
    for (const id of nodeIdsKey ? nodeIdsKey.split(",") : []) {
      onPtyData(id, () => {
        const v = vpRef.current;
        if (!v.W || !v.H) return;
        const node = nodesRef.current.find((x) => x.id === id);
        if (!node) return;
        const cxFlow = node.x + node.width / 2;
        const cyFlow = node.y + node.height / 2;
        const vMinX = -v.tx / v.zoom;
        const vMinY = -v.ty / v.zoom;
        const vMaxX = vMinX + v.W / v.zoom;
        const vMaxY = vMinY + v.H / v.zoom;
        const centerInside =
          cxFlow >= vMinX && cxFlow <= vMaxX &&
          cyFlow >= vMinY && cyFlow <= vMaxY;
        if (!centerInside) markUnread(id);
      }).then((u) => {
        if (cancelled) u();
        else unsubs.push(u);
      });
    }
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [nodeIdsKey, markUnread]);

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
      {labels.map((l) => {
        const unread = !!unreadByNode[l.id];
        return (
        <button
          key={l.id}
          className="nodrag"
          onClick={() => {
            rf.setCenter(l.cxFlow, l.cyFlow, {
              zoom: vp.zoom,
              duration: 250,
            });
            markRead(l.id);
          }}
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
            animation: unread ? "offscreen-label-breathe 1.4s ease-in-out infinite" : undefined,
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
        );
      })}
    </div>
  );
}
