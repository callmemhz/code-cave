import React, { useCallback, useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  useReactFlow,
  type Node, type Viewport,
} from "@xyflow/react";
import { useCanvasStore } from "../store/canvasStore";
import { nodeTypes } from "./nodeTypes";
import { ContextMenu } from "./ContextMenu";
import { CwdPrompt } from "./CwdPrompt";
import type { NodeType } from "../types";

type CwdKind = "terminal" | "claude" | "codex";
type PendingCreate = { type: CwdKind; canvasX: number; canvasY: number };

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
    dragHandle: ".node-drag-handle",
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

  const [menu, setMenu] = useState<{ screenX: number; screenY: number; canvasX: number; canvasY: number } | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const addNode = useCanvasStore((s) => s.addNode);
  const rf = useReactFlow();

  const handleCanvasContextMenu = (e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    const pt = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: pt.x, canvasY: pt.y });
  };

  const createNode = async (type: NodeType, x: number, y: number, cwd: string) => {
    if (!activeId) return;
    const defaults = {
      terminal: { w: 520, h: 320, data: { cwd, shell: "/bin/zsh", env: {} } },
      claude:   { w: 560, h: 360, data: { cwd, args: [], resume_session_id: null } },
      codex:    { w: 560, h: 360, data: { cwd, args: [], resume_session_id: null } },
      note:     { w: 320, h: 220, data: { content: "", preview_mode: false } },
    }[type];
    await addNode({
      canvas_id: activeId, type,
      x, y,
      width: defaults.w, height: defaults.h,
      title: null, data_json: JSON.stringify(defaults.data),
    });
  };

  const pickType = (type: NodeType) => {
    if (!activeId || !menu) return;
    if (type === "terminal" || type === "claude" || type === "codex") {
      setPendingCreate({ type, canvasX: menu.canvasX, canvasY: menu.canvasY });
    } else {
      // note: no cwd needed
      void createNode(type, menu.canvasX, menu.canvasY, "~");
    }
  };

  if (!active) return <div style={{ padding: 24 }}>No canvas</div>;

  return (
    <>
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
        onPaneContextMenu={handleCanvasContextMenu}
        proOptions={{ hideAttribution: true }}
        fitView={false}
        // Tiny drag threshold so single click/double-click on the drag handle
        // still fire (rename = double-click on title).
        nodeDragThreshold={4}
      >
        <Background />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
      {menu && (
        <ContextMenu
          x={menu.screenX} y={menu.screenY}
          onPick={pickType} onClose={() => setMenu(null)}
        />
      )}
      {pendingCreate && (
        <CwdPrompt
          type={pendingCreate.type}
          defaultCwd="~"
          onCancel={() => setPendingCreate(null)}
          onSubmit={(cwd) => {
            const { type, canvasX, canvasY } = pendingCreate;
            setPendingCreate(null);
            void createNode(type, canvasX, canvasY, cwd);
          }}
        />
      )}
    </>
  );
}
