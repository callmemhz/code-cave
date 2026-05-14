import { useEffect, useRef } from "react";
import { useViewport } from "@xyflow/react";
import type { BgTheme } from "./useBgTheme";

const CELL = 22; // flow units per grid cell

const RAMP_WAVES = " .·:-=+*#%@";
const MATRIX_CHARS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123ABCDXYZ";
const RAIN_CHARS = "|│┃║";
const STAR_CHARS = "·∙*+✦";

function hashInt(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x >>> 0;
}
function hash2(a: number, b: number): number {
  return hashInt(Math.imul(a, 73856093) ^ Math.imul(b, 19349663));
}

type VP = { x: number; y: number; zoom: number };

function visibleRange(w: number, h: number, vp: VP) {
  const flowMinX = -vp.x / vp.zoom;
  const flowMinY = -vp.y / vp.zoom;
  const flowMaxX = (w - vp.x) / vp.zoom;
  const flowMaxY = (h - vp.y) / vp.zoom;
  return {
    gxMin: Math.floor(flowMinX / CELL) - 1,
    gxMax: Math.ceil(flowMaxX / CELL) + 1,
    gyMin: Math.floor(flowMinY / CELL) - 1,
    gyMax: Math.ceil(flowMaxY / CELL) + 1,
  };
}

function setupFont(ctx: CanvasRenderingContext2D, cellScreen: number, weight = 0.75) {
  const fontSize = Math.max(8, cellScreen * weight);
  ctx.font = `${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
}

function drawWaves(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, vp: VP) {
  const cellScreen = CELL * vp.zoom;
  if (cellScreen < 6) return;
  setupFont(ctx, cellScreen);
  const last = RAMP_WAVES.length - 1;
  const r = visibleRange(w, h, vp);
  for (let gy = r.gyMin; gy <= r.gyMax; gy++) {
    for (let gx = r.gxMin; gx <= r.gxMax; gx++) {
      const v =
        Math.sin(gx * 0.18 + t * 0.6) +
        Math.sin(gy * 0.22 - t * 0.45) +
        Math.sin((gx + gy) * 0.12 + t * 0.3) +
        Math.sin(Math.hypot(gx, gy) * 0.15 - t * 0.8);
      const n = (v + 4) / 8;
      const idx = Math.min(last, Math.max(0, Math.floor(n * (last + 1))));
      const ch = RAMP_WAVES[idx];
      if (ch === " ") continue;
      const alpha = 0.04 + n * 0.18;
      ctx.fillStyle = `rgba(170, 205, 255, ${alpha})`;
      ctx.fillText(ch, gx * CELL * vp.zoom + vp.x, gy * CELL * vp.zoom + vp.y);
    }
  }
}

function drawPlasma(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, vp: VP) {
  const cellScreen = CELL * vp.zoom;
  if (cellScreen < 6) return;
  setupFont(ctx, cellScreen);
  const last = RAMP_WAVES.length - 1;
  const r = visibleRange(w, h, vp);
  for (let gy = r.gyMin; gy <= r.gyMax; gy++) {
    for (let gx = r.gxMin; gx <= r.gxMax; gx++) {
      const v =
        Math.sin(gx * 0.16 + t * 0.5) +
        Math.sin(gy * 0.19 - t * 0.4) +
        Math.sin((gx - gy) * 0.13 + t * 0.35) +
        Math.sin(Math.hypot(gx - 3, gy + 2) * 0.14 - t * 0.6);
      const n = (v + 4) / 8;
      const idx = Math.min(last, Math.max(0, Math.floor(n * (last + 1))));
      const ch = RAMP_WAVES[idx];
      if (ch === " ") continue;
      const hue = (n * 280 + t * 25) % 360;
      ctx.fillStyle = `hsla(${hue}, 85%, 65%, ${0.08 + n * 0.18})`;
      ctx.fillText(ch, gx * CELL * vp.zoom + vp.x, gy * CELL * vp.zoom + vp.y);
    }
  }
}

function drawMatrix(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, vp: VP) {
  const cellScreen = CELL * vp.zoom;
  if (cellScreen < 6) return;
  setupFont(ctx, cellScreen, 0.82);
  const TRAIL = 16;
  const PERIOD = 70;
  const r = visibleRange(w, h, vp);
  for (let gx = r.gxMin; gx <= r.gxMax; gx++) {
    const seed = hashInt(gx);
    const speed = 3 + (seed % 5);
    const offset = (seed % 100) * 0.7;
    for (let gy = r.gyMin; gy <= r.gyMax; gy++) {
      const raw = (t * speed + offset - gy) % PERIOD;
      const phase = raw < 0 ? raw + PERIOD : raw;
      if (phase >= TRAIL) continue;
      const ch = MATRIX_CHARS[hash2(gx, gy) % MATRIX_CHARS.length];
      const sx = gx * CELL * vp.zoom + vp.x;
      const sy = gy * CELL * vp.zoom + vp.y;
      if (phase < 1) {
        ctx.fillStyle = "rgba(220, 255, 230, 0.95)";
      } else {
        const b = 1 - phase / TRAIL;
        ctx.fillStyle = `rgba(70, 220, 110, ${b * 0.55})`;
      }
      ctx.fillText(ch, sx, sy);
    }
  }
}

function drawRain(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, vp: VP) {
  const cellScreen = CELL * vp.zoom;
  if (cellScreen < 6) return;
  setupFont(ctx, cellScreen, 0.9);
  const TRAIL = 6;
  const PERIOD = 90;
  const r = visibleRange(w, h, vp);
  for (let gx = r.gxMin; gx <= r.gxMax; gx++) {
    const seed = hashInt(gx);
    if (seed % 3 !== 0) continue; // only 1/3 of columns get rain
    const speed = 6 + (seed % 6);
    const offset = (seed % 200) * 0.5;
    for (let gy = r.gyMin; gy <= r.gyMax; gy++) {
      const raw = (t * speed + offset - gy) % PERIOD;
      const phase = raw < 0 ? raw + PERIOD : raw;
      if (phase >= TRAIL) continue;
      const ch = RAIN_CHARS[hash2(gx, gy) % RAIN_CHARS.length];
      const b = 1 - phase / TRAIL;
      ctx.fillStyle = `rgba(160, 200, 255, ${0.1 + b * 0.45})`;
      ctx.fillText(ch, gx * CELL * vp.zoom + vp.x, gy * CELL * vp.zoom + vp.y);
    }
  }
}

function drawStarfield(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, vp: VP) {
  const cellScreen = CELL * vp.zoom;
  if (cellScreen < 6) return;
  setupFont(ctx, cellScreen, 0.85);
  const r = visibleRange(w, h, vp);
  for (let gy = r.gyMin; gy <= r.gyMax; gy++) {
    for (let gx = r.gxMin; gx <= r.gxMax; gx++) {
      const h2 = hash2(gx, gy);
      // ~2.5% density
      if (h2 % 40 !== 0) continue;
      const twinkleSpeed = 0.6 + ((h2 >>> 8) % 100) / 100; // 0.6..1.6
      const phase = (h2 % 360) / 57.3; // 0..2π-ish
      const b = 0.4 + 0.5 * Math.sin(t * twinkleSpeed + phase);
      const ch = STAR_CHARS[(h2 >>> 4) % STAR_CHARS.length];
      // subtle warm/cool variation
      const warm = (h2 >>> 12) & 1;
      const color = warm
        ? `rgba(255, 240, 200, ${b * 0.75})`
        : `rgba(200, 220, 255, ${b * 0.75})`;
      ctx.fillStyle = color;
      ctx.fillText(ch, gx * CELL * vp.zoom + vp.x, gy * CELL * vp.zoom + vp.y);
    }
  }
}

const RENDERERS: Partial<
  Record<BgTheme, (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, vp: VP) => void>
> = {
  waves: drawWaves,
  plasma: drawPlasma,
  matrix: drawMatrix,
  rain: drawRain,
  starfield: drawStarfield,
};

export function AsciiBackground({ theme }: { theme: BgTheme }) {
  const viewport = useViewport();
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const themeRef = useRef(theme);
  themeRef.current = theme;

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

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const render = RENDERERS[themeRef.current];
      if (render) render(ctx, w, h, t, viewportRef.current);
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
