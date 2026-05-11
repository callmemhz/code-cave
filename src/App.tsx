import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCanvasStore } from "./store/canvasStore";
import { Canvas } from "./canvas/Canvas";
import { TabBar } from "./components/TabBar";

export default function App() {
  const loadAll = useCanvasStore((s) => s.loadAll);
  useEffect(() => { loadAll(); }, [loadAll]);

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
