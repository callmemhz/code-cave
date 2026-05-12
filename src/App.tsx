import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { listen } from "@tauri-apps/api/event";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "./store/canvasStore";
import { Canvas } from "./canvas/Canvas";
import { TabBar } from "./components/TabBar";
import type { DbNode } from "./types";

export default function App() {
  const loadAll = useCanvasStore((s) => s.loadAll);
  const replaceNode = useCanvasStore((s) => s.replaceNode);
  const [ready, setReady] = useState(false);
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

  if (!ready) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <TabBar />
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
