import { useCallback, useMemo } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  type Node, type Viewport,
} from "@xyflow/react";
import { useCanvasStore } from "../store/canvasStore";
import { nodeTypes } from "./nodeTypes";

export function Canvas() {
  const canvases = useCanvasStore((s) => s.canvases);
  const activeId = useCanvasStore((s) => s.activeCanvasId);
  const nodesByCanvas = useCanvasStore((s) => s.nodesByCanvas);
  const saveViewport = useCanvasStore((s) => s.saveViewport);
  const updatePos = useCanvasStore((s) => s.updateNodePosition);
  const updateSize = useCanvasStore((s) => s.updateNodeSize);

  const active = canvases.find((c) => c.id === activeId) ?? null;
  const rawNodes = activeId ? nodesByCanvas[activeId] ?? [] : [];

  const flowNodes = useMemo<Node[]>(() => rawNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.x, y: n.y },
    data: { dbNode: n },
    width: n.width,
    height: n.height,
  })), [rawNodes]);

  const defaultViewport: Viewport = active
    ? { x: active.viewport_x, y: active.viewport_y, zoom: active.viewport_zoom }
    : { x: 0, y: 0, zoom: 1 };

  const onMove = useCallback((_: unknown, vp: Viewport) => {
    if (activeId) saveViewport(activeId, vp.x, vp.y, vp.zoom);
  }, [activeId, saveViewport]);

  const onNodeDragStop = useCallback((_: unknown, n: Node) => {
    updatePos(n.id, n.position.x, n.position.y);
  }, [updatePos]);

  const onNodeResize = useCallback(
    (id: string, w: number, h: number) => updateSize(id, w, h),
    [updateSize],
  );

  if (!active) return <div style={{ padding: 24 }}>No canvas</div>;

  return (
    <ReactFlow
      key={active.id}
      nodes={flowNodes}
      edges={[]}
      nodeTypes={nodeTypes}
      defaultViewport={defaultViewport}
      onMove={onMove}
      onNodeDragStop={onNodeDragStop}
      onNodesChange={(changes) => {
        for (const c of changes) {
          if (c.type === "dimensions" && c.dimensions) {
            onNodeResize(c.id, c.dimensions.width, c.dimensions.height);
          }
        }
      }}
      proOptions={{ hideAttribution: true }}
      fitView={false}
    >
      <Background />
      <MiniMap pannable zoomable />
      <Controls />
    </ReactFlow>
  );
}
