import { useMemo, useState } from "react";
import { NodeResizer } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import type { DbNode, NoteData } from "../types";
import { useCanvasStore } from "../store/canvasStore";
import { NodeHeader } from "../components/NodeHeader";

type NoteFlowNode = Node<{ dbNode: DbNode }, "note">;

export function NoteNode({ data }: NodeProps<NoteFlowNode>) {
  const dbNode = data.dbNode;
  const parsed = useMemo<NoteData>(
    () => { try { return JSON.parse(dbNode.data_json); } catch { return { content: "", preview_mode: false }; } },
    [dbNode.data_json],
  );

  const updateData = useCanvasStore((s) => s.updateNodeData);
  const updateTitle = useCanvasStore((s) => s.updateNodeTitle);
  const deleteNode = useCanvasStore((s) => s.deleteNode);
  const [content, setContent] = useState(parsed.content);
  const [preview, setPreview] = useState(parsed.preview_mode);

  const persist = (next: Partial<NoteData>) => {
    const merged: NoteData = { content, preview_mode: preview, ...next };
    updateData(dbNode.id, JSON.stringify(merged));
  };

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "#1a1a1a", color: "#ddd",
      border: "1px solid #333", borderRadius: 4,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <NodeResizer
        minWidth={200} minHeight={140}
        lineStyle={{ borderColor: "transparent" }}
        handleStyle={{ width: 12, height: 12, background: "transparent", border: "none" }}
      />
      <NodeHeader
        title={dbNode.title ?? "Note"}
        onRename={(t) => updateTitle(dbNode.id, t || null)}
        onDelete={() => deleteNode(dbNode.id)}>
        <button
          className="nodrag"
          onClick={() => { setPreview((p) => { persist({ preview_mode: !p }); return !p; }); }}
          style={{ background: "transparent", color: "#aaa", border: "1px solid #444", borderRadius: 3, fontSize: 11, padding: "1px 6px", cursor: "pointer" }}
        >
          {preview ? "edit" : "preview"}
        </button>
      </NodeHeader>
      {preview ? (
        <pre className="nowheel nodrag" style={{
          flex: 1, margin: 0, padding: 10, overflow: "auto",
          background: "#111", whiteSpace: "pre-wrap", fontFamily: "ui-monospace,monospace",
        }}>{content}</pre>
      ) : (
        <textarea className="nowheel nodrag"
          value={content}
          onChange={(e) => { setContent(e.target.value); persist({ content: e.target.value }); }}
          style={{
            flex: 1, padding: 10, background: "#111", color: "#ddd",
            border: "none", outline: "none", resize: "none",
            fontFamily: "ui-monospace,monospace", fontSize: 13,
          }}/>
      )}
    </div>
  );
}
