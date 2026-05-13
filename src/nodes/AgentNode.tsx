import { useEffect, useMemo, useRef, useState } from "react";
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { patchXtermMouseServiceWithRetry } from "../lib/patchXtermMouseService";
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
    // Canvas renderer (xterm default). See TerminalNode for rationale —
    // WebGL breaks IME composition and selection alignment.
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    fit.fit();
    // Don't yank focus from a pane the user is already typing in. See
    // TerminalNode for the full rationale.
    if (document.activeElement === document.body || document.activeElement === null) {
      term.focus();
    }
    const cancelPatch = patchXtermMouseServiceWithRetry(term);

    // xterm sends plain \r for both Enter and Shift+Enter — there's no
    // way at the OS/TTY level to distinguish them. Terminal emulators
    // that support multi-line editing (iTerm Natural Text Editing,
    // Warp, …) emit a separate byte for Shift+Enter; Claude Code
    // listens for those. We send LF (0x0a) which is what iTerm's
    // Natural Text Editing preset uses for Shift+Return.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === "keydown" && ev.key === "Enter") {
        console.log("[code-cave] Enter keydown", {
          shiftKey: ev.shiftKey, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey,
        });
      }
      if (ev.type === "keydown" && ev.key === "Enter" && ev.shiftKey
          && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        // Same bytes as Option+Enter (ESC + CR), which the user just
        // confirmed Claude treats as a newline. preventDefault stops
        // xterm's hidden textarea from inserting its own newline.
        ev.preventDefault();
        ptyWrite(dbNode.id, b64encode(new Uint8Array([0x1b, 0x0d])))
          .catch(console.error);
        return false;
      }
      return true;
    });

    const encoder = new TextEncoder();
    // See TerminalNode for rationale: gate xterm-generated input while we
    // replay saved scrollback, otherwise device-attribute responses
    // (\x1b[?1;2c etc.) get typed back into the freshly-spawned process.
    let replaying = true;
    const onDataHandler = term.onData((s) => {
      if (replaying) return;
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
        // Empty string = "session cleared" (claude PID changed in pane, new
        // claude hasn't produced a jsonl yet). Treat as null so the title
        // drops the stale id and respawn doesn't pass --resume "".
        const next = id === "" ? null : id;
        setSessionId(next);
        const merged: AgentData = { ...parsed, resume_session_id: next };
        updateData(dbNode.id, JSON.stringify(merged));
      });
      if (cancelled) { u3(); return; }
      unlistens.push(u3);

      const snapB64 = await ptySnapshot(dbNode.id);
      if (cancelled) return;
      if (snapB64) {
        await new Promise<void>((resolve) => {
          term.write(b64decode(snapB64), () => resolve());
        });
      }
      replaying = false;

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
      cancelPatch();
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
  const accent = kind === "claude"
    ? "rgba(217, 119, 87, 0.18)"   // Anthropic orange
    : "rgba(80, 200, 140, 0.16)";  // OpenAI green

  return (
    <div style={{
      width: "100%", height: "100%",
      background: "#101418", border: "1px solid #2a3340", borderRadius: 4,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <NodeResizer
        minWidth={320} minHeight={200}
        lineStyle={{ borderColor: "transparent" }}
        handleStyle={{ width: 12, height: 12, background: "transparent", border: "none" }}
      />
      <NodeHeader
        title={dbNode.title ?? label}
        subtitle={`${parsed.cwd}${sessionId ? ` · ${sessionId.slice(0, 8)}` : ""}`}
        accent={accent}
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
