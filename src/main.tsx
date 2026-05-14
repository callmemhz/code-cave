import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const style = document.createElement("style");
style.textContent = `
  html, body, #root { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; }
  body { background: #0d0d0d; color: #e0e0e0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  *, *::before, *::after { box-sizing: border-box; }
  .react-flow__node { background: transparent; border: none; padding: 0; }

  /* Drag handle hover/active feedback. */
  .node-drag-handle:active { cursor: grabbing; }

  /* While xyflow is dragging this node, lift it visually. */
  .react-flow__node.dragging {
    box-shadow: 0 10px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(120,160,255,0.35) inset;
    opacity: 0.96;
    z-index: 1000;
  }

  /* Selection ring (xyflow toggles .selected). */
  .react-flow__node.selected {
    box-shadow: 0 0 0 2px rgba(120,160,255,0.55);
  }

  /* Keep overlays (controls, minimap, panels, attribution) above nodes —
     including a dragging node, which we bump to z-index 1000. */
  .react-flow__controls,
  .react-flow__minimap,
  .react-flow__panel,
  .react-flow__attribution {
    z-index: 2000;
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
