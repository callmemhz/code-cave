import { useEffect, useMemo, useRef, useState } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { DbNode, AgentData } from "../types";
import { NodeHeader } from "../components/NodeHeader";
import { useCanvasStore } from "../store/canvasStore";
import {
  ptyWrite, ptyResize, ptyKill, ptySnapshot, ptyIsAlive,
  b64encode, b64decode,
} from "../ipc/pty";
import { onPtyData, onPtyExit } from "../ipc/events";
import { agentSpawn, onAgentSession, type AgentKind } from "../ipc/agents";

type AgentFlowNode = Node<{ dbNode: DbNode }, "claude" | "codex">;

export function AgentNode({ data, kind }: NodeProps<AgentFlowNode> & { kind: AgentKind }) {
  const dbNode = data.dbNode;
  const parsed = useMemo<AgentData>(
    () => { try { return JSON.parse(dbNode.data_json); }
            catch { return { cwd: "~", args: [], resume_session_id: null }; } },
    [dbNode.data_json],
  );

  const updateTitle = useCanvasStore((s) => s.updateNodeTitle);
  const updateData = useCanvasStore((s) => s.updateNodeData);
  const deleteNode = useCanvasStore((s) => s.deleteNode);

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [alive, setAlive] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(parsed.resume_session_id);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13,
      theme: { background: "#101418", foreground: "#ddd" },
      cursorBlink: true, scrollback: 5000, allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    try { term.loadAddon(new WebglAddon()); } catch { /* optional */ }
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();

    const encoder = new TextEncoder();
    const onDataHandler = term.onData((s) => {
      ptyWrite(dbNode.id, b64encode(encoder.encode(s))).catch(console.error);
    });

    let cancelled = false;
    const unlistens: Array<() => void> = [];

    const startOrReattach = async () => {
      const u1 = await onPtyData(dbNode.id, (e) => termRef.current?.write(b64decode(e.bytes_b64)));
      if (cancelled) { u1(); return; }
      unlistens.push(u1);

      const u2 = await onPtyExit(dbNode.id, () => setAlive(false));
      if (cancelled) { u2(); return; }
      unlistens.push(u2);

      const u3 = await onAgentSession(dbNode.id, (id) => {
        setSessionId(id);
        const merged: AgentData = { ...parsed, resume_session_id: id };
        updateData(dbNode.id, JSON.stringify(merged));
      });
      if (cancelled) { u3(); return; }
      unlistens.push(u3);

      const snapB64 = await ptySnapshot(dbNode.id);
      if (cancelled) return;
      if (snapB64) term.write(b64decode(snapB64));

      const isAlive = await ptyIsAlive(dbNode.id);
      if (cancelled) return;
      if (!isAlive) {
        await agentSpawn({
          nodeId: dbNode.id, kind, cwd: parsed.cwd,
          extraArgs: parsed.args, resumeId: parsed.resume_session_id,
          env: {}, cols: term.cols, rows: term.rows,
        });
        if (cancelled) return;
      }
      setAlive(true);
    };
    startOrReattach().catch(console.error);

    return () => {
      cancelled = true;
      onDataHandler.dispose();
      for (const u of unlistens) u();
      term.dispose();
      termRef.current = null;
    };
  }, [dbNode.id, kind]);

  useEffect(() => {
    if (!hostRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      fitRef.current.fit();
      ptyResize(dbNode.id, termRef.current.cols, termRef.current.rows).catch(() => {});
    });
    ro.observe(hostRef.current);
    return () => ro.disconnect();
  }, [dbNode.id]);

  const label = kind === "claude" ? "Claude Code" : "Codex";

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "#101418", border: "1px solid #2a3340", borderRadius: 4,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <NodeResizer
        minWidth={320} minHeight={200}
        lineStyle={{ borderColor: "transparent" }}
        handleStyle={{ width: 8, height: 8, background: "#5a78a8", border: "none", borderRadius: 2 }}
      />
      <NodeHeader
        title={dbNode.title ?? label}
        subtitle={`${parsed.cwd}${sessionId ? ` · ${sessionId.slice(0, 8)}` : ""}`}
        badge={<span style={{
          width: 8, height: 8, borderRadius: 4,
          background: alive ? "#5fb55f" : "#888",
        }}/>}
        onRename={(t) => updateTitle(dbNode.id, t || null)}
        onDelete={() => { ptyKill(dbNode.id).catch(() => {}); deleteNode(dbNode.id); }}/>
      <div ref={hostRef} className="nowheel nodrag" style={{ flex: 1, minHeight: 0, padding: 4 }}/>
    </div>
  );
}
