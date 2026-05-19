import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "./store/canvasStore";
import { Canvas } from "./canvas/Canvas";
import { TabBar } from "./components/TabBar";
import type { DbNode } from "./types";

export default function App() {
  const loadAll = useCanvasStore((s) => s.loadAll);
  const replaceNode = useCanvasStore((s) => s.replaceNode);
  const [ready, setReady] = useState(false);
  const [quitPrompt, setQuitPrompt] = useState(false);
  useEffect(() => { loadAll().then(() => setReady(true)); }, [loadAll]);

  // Backend may convert a terminal node into a claude node when it sees
  // a fresh claude session file in the terminal's cwd. Swap it in place.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<DbNode>("node:converted", (ev) => replaceNode(ev.payload))
      .then((fn) => { unlisten = fn; })
      .catch(console.error);
    return () => { unlisten?.(); };
  }, [replaceNode]);

  // Cmd+Q / app-level quit triggers RunEvent::ExitRequested in Rust, which
  // prevents the exit and emits this event. We render a confirm modal;
  // the user can either invoke confirm_quit (actually exits) or dismiss.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("app:quit-requested", () => {
      console.log("[vibe-space] app:quit-requested received");
      setQuitPrompt(true);
    })
      .then((fn) => { unlisten = fn; })
      .catch(console.error);
    return () => { unlisten?.(); };
  }, []);

  if (!ready) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <TabBar />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      </div>
      {quitPrompt && (
        <div
          onClick={() => setQuitPrompt(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 3000,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#1a1a1a", color: "#e0e0e0",
              border: "1px solid #444", borderRadius: 6,
              padding: 18, minWidth: 360,
              boxShadow: "0 12px 32px rgba(0,0,0,0.65)",
              fontSize: 13,
            }}
          >
            <div style={{ marginBottom: 14, lineHeight: 1.5 }}>
              Quit Vibe Space?
              <div style={{ marginTop: 6, opacity: 0.65 }}>
                Running terminals and Claude/Codex sessions will be killed.
                Scrollback and cwd are saved.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                autoFocus
                onClick={() => setQuitPrompt(false)}
                style={quitBtn}
              >Cancel</button>
              <button
                onClick={() => { invoke("confirm_quit").catch(console.error); }}
                style={{ ...quitBtn, background: "#7a2a2a", borderColor: "#8a3a3a" }}
              >Quit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const quitBtn: React.CSSProperties = {
  background: "#2a2a2a", color: "#ddd",
  border: "1px solid #444", borderRadius: 4,
  padding: "4px 14px", fontSize: 13, cursor: "pointer",
};
