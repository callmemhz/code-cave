import { useEffect, useMemo, useRef, useState } from "react";
import { NodeResizer } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { DbNode, TerminalData } from "../types";
import { NodeHeader } from "../components/NodeHeader";
import { useCanvasStore } from "../store/canvasStore";
import {
  ptySpawn, ptyWrite, ptyResize, ptyKill, ptySnapshot, ptyIsAlive,
  b64encode, b64decode,
} from "../ipc/pty";
import { onPtyData, onPtyExit } from "../ipc/events";

type TerminalFlowNode = Node<{ dbNode: DbNode }, "terminal">;

export function TerminalNode({ data }: NodeProps<TerminalFlowNode>) {
  const dbNode = data.dbNode;
  const parsed = useMemo<TerminalData>(
    () => { try { return JSON.parse(dbNode.data_json); }
            catch { return { cwd: "~", shell: "/bin/zsh", env: {} }; } },
    [dbNode.data_json],
  );

  const updateTitle = useCanvasStore((s) => s.updateNodeTitle);
  const deleteNode = useCanvasStore((s) => s.deleteNode);

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [alive, setAlive] = useState(false);

  // Mount xterm exactly once.
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: "ui-monospace, Menlo, Consolas, monospace",
      fontSize: 13,
      theme: { background: "#111", foreground: "#ddd" },
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    try { term.loadAddon(new WebglAddon()); } catch { /* webgl optional */ }
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();

    const encoder = new TextEncoder();
    const onDataHandler = term.onData((s) => {
      ptyWrite(dbNode.id, b64encode(encoder.encode(s))).catch(console.error);
    });

    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let cancelled = false;

    const startOrReattach = async () => {
      // Subscribe BEFORE spawning to not miss bytes.
      unlistenData = await onPtyData(dbNode.id, (e) => {
        if (!termRef.current) return;
        termRef.current.write(b64decode(e.bytes_b64));
      });
      unlistenExit = await onPtyExit(dbNode.id, () => setAlive(false));

      // Repaint saved scrollback (process may or may not still be alive).
      const snapB64 = await ptySnapshot(dbNode.id);
      if (snapB64) term.write(b64decode(snapB64));

      const isAlive = await ptyIsAlive(dbNode.id);
      if (cancelled) return;
      if (!isAlive) {
        const cols = term.cols, rows = term.rows;
        await ptySpawn({
          nodeId: dbNode.id, cwd: parsed.cwd,
          program: parsed.shell, args: [],
          env: parsed.env, cols, rows,
        });
      }
      setAlive(true);
    };
    startOrReattach().catch(console.error);

    return () => {
      cancelled = true;
      onDataHandler.dispose();
      unlistenData?.();
      unlistenExit?.();
      term.dispose();
      termRef.current = null;
    };
  }, [dbNode.id]); // re-run only if the node id itself changes

  // Resize PTY when container resizes.
  useEffect(() => {
    if (!hostRef.current || !termRef.current || !fitRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      fitRef.current.fit();
      ptyResize(dbNode.id, termRef.current.cols, termRef.current.rows).catch(() => {});
    });
    ro.observe(hostRef.current);
    return () => ro.disconnect();
  }, [dbNode.id]);

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "#111", border: "1px solid #333", borderRadius: 4,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <NodeResizer minWidth={300} minHeight={180} />
      <NodeHeader
        title={dbNode.title ?? `terminal — ${parsed.shell}`}
        subtitle={parsed.cwd}
        badge={<span style={{
          width: 8, height: 8, borderRadius: 4,
          background: alive ? "#5fb55f" : "#888",
        }} />}
        onRename={(t) => updateTitle(dbNode.id, t || null)}
        onDelete={() => { ptyKill(dbNode.id).catch(() => {}); deleteNode(dbNode.id); }}/>
      <div ref={hostRef} className="nowheel nodrag"
        style={{ flex: 1, minHeight: 0, padding: 4 }}/>
    </div>
  );
}
