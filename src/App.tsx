import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "./store/canvasStore";
import { Canvas } from "./canvas/Canvas";
import { TabBar } from "./components/TabBar";

export default function App() {
  const loadAll = useCanvasStore((s) => s.loadAll);
  const [ready, setReady] = useState(false);
  useEffect(() => { loadAll().then(() => setReady(true)); }, [loadAll]);

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
