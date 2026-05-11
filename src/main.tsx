import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const style = document.createElement("style");
style.textContent = `
  html, body, #root { height: 100%; margin: 0; }
  body { background: #0d0d0d; color: #e0e0e0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  *, *::before, *::after { box-sizing: border-box; }
  .react-flow__node { background: transparent; border: none; padding: 0; }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
