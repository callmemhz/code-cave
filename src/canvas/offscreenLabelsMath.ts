import type { DbNode } from "../types";

export type Edge = "left" | "right" | "top" | "bottom";

export interface EdgeAnchor {
  ax: number;
  ay: number;
  angle: number;
  edge: Edge;
}

export function intersectEdgeAnchor(
  dx: number,
  dy: number,
  W: number,
  H: number,
  pad: number,
): EdgeAnchor {
  const halfW = W / 2 - pad;
  const halfH = H / 2 - pad;
  const tX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  const edge: Edge =
    tX <= tY ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  return {
    ax: W / 2 + dx * t,
    ay: H / 2 + dy * t,
    angle: Math.atan2(dy, dx),
    edge,
  };
}

export interface ViewportPx {
  /** ReactFlow translate.x in CSS px (negative = pan right). */
  tx: number;
  /** ReactFlow translate.y in CSS px. */
  ty: number;
  zoom: number;
  /** Container width in CSS px. */
  W: number;
  /** Container height in CSS px. */
  H: number;
}

export interface OffscreenLabel {
  id: string;
  title: string;
  /** Anchor in screen-space CSS px, relative to ReactFlow container. */
  ax: number;
  ay: number;
  /** Arrow rotation in radians; base orientation points to +x. */
  angle: number;
  /** Which container edge the anchor lies on; drives pill alignment. */
  edge: Edge;
  /** Pane center in flow coordinates, used by setCenter. */
  cxFlow: number;
  cyFlow: number;
}

export function computeOffscreenLabel(
  n: DbNode,
  vp: ViewportPx,
  pad: number,
): OffscreenLabel | null {
  const title = n.title?.trim();
  if (!title) return null;

  // Viewport rect in flow coords.
  const vMinX = -vp.tx / vp.zoom;
  const vMinY = -vp.ty / vp.zoom;
  const vMaxX = vMinX + vp.W / vp.zoom;
  const vMaxY = vMinY + vp.H / vp.zoom;

  const cxFlow = n.x + n.width / 2;
  const cyFlow = n.y + n.height / 2;

  // Show the indicator whenever the pane's CENTER is outside the viewport,
  // even if some edge of the pane is still visible — otherwise a barely-
  // peeking pane gives no hint about which renamed pane it is.
  const centerInside =
    cxFlow >= vMinX && cxFlow <= vMaxX &&
    cyFlow >= vMinY && cyFlow <= vMaxY;
  if (centerInside) return null;

  const cxScreen = cxFlow * vp.zoom + vp.tx;
  const cyScreen = cyFlow * vp.zoom + vp.ty;

  const dx = cxScreen - vp.W / 2;
  const dy = cyScreen - vp.H / 2;
  if (dx === 0 && dy === 0) return null;

  const { ax, ay, angle, edge } = intersectEdgeAnchor(dx, dy, vp.W, vp.H, pad);
  return { id: n.id, title, ax, ay, angle, edge, cxFlow, cyFlow };
}
