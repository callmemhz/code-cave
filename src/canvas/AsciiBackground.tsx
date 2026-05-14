import { useEffect, useRef } from "react";
import { useViewport } from "@xyflow/react";

const RAMP = " .·:-=+*#%@";
const CELL = 22; // flow units per grid cell

export function AsciiBackground() {
  const viewport = useViewport();
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);

    const lastIdx = RAMP.length - 1;

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const { x: vx, y: vy, zoom } = viewportRef.current;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      ctx.clearRect(0, 0, w, h);

      const cellScreen = CELL * zoom;
      // Too zoomed out — chars would overlap into noise. Skip render.
      if (cellScreen < 6) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const fontSize = Math.max(8, cellScreen * 0.75);
      ctx.font = `${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";

      const flowMinX = -vx / zoom;
      const flowMinY = -vy / zoom;
      const flowMaxX = (w - vx) / zoom;
      const flowMaxY = (h - vy) / zoom;
      const gxMin = Math.floor(flowMinX / CELL) - 1;
      const gxMax = Math.ceil(flowMaxX / CELL) + 1;
      const gyMin = Math.floor(flowMinY / CELL) - 1;
      const gyMax = Math.ceil(flowMaxY / CELL) + 1;

      for (let gy = gyMin; gy <= gyMax; gy++) {
        for (let gx = gxMin; gx <= gxMax; gx++) {
          const v =
            Math.sin(gx * 0.18 + t * 0.6) +
            Math.sin(gy * 0.22 - t * 0.45) +
            Math.sin((gx + gy) * 0.12 + t * 0.3) +
            Math.sin(Math.hypot(gx, gy) * 0.15 - t * 0.8);
          const n = (v + 4) / 8; // -> 0..1
          const idx = Math.min(
            lastIdx,
            Math.max(0, Math.floor(n * (lastIdx + 1))),
          );
          const ch = RAMP[idx];
          if (ch === " ") continue;
          const alpha = 0.04 + n * 0.18;
          ctx.fillStyle = `rgba(170, 205, 255, ${alpha})`;
          const sx = gx * CELL * zoom + vx;
          const sy = gy * CELL * zoom + vy;
          ctx.fillText(ch, sx, sy);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
