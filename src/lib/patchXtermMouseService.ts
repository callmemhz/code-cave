import type { Terminal } from "@xterm/xterm";

/**
 * Patch xterm.js so its mouse-to-cell math survives a CSS-transformed parent
 * (e.g. xyflow's `transform: scale(zoom)` viewport).
 *
 * The problem: xterm's MouseService uses `getBoundingClientRect()` (returns
 * post-transform screen pixels) divided by its internal `cellWidth`/`cellHeight`
 * (pre-transform layout pixels). When the canvas is zoomed to Z, clicks at the
 * right edge of a terminal map to `cols * Z` columns instead of `cols`, causing
 * the selection rectangle to drift.
 *
 * The fix: dynamically compute `scale = rect.width / element.offsetWidth`
 * (post-transform / pre-transform = the effective CSS scale) and divide the
 * mouse-relative coordinates by it before xterm converts them to cells.
 *
 * Technique borrowed from OpenCove (MIT, DeadWaveWave/opencove):
 *   src/contexts/workspace/presentation/renderer/components/terminalNode/
 *     patchXtermMouseService.ts
 */

type XtermMouseService = {
  getCoords: (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ) => [number, number] | undefined;
  getMouseReportCoords?: (
    event: { clientX: number; clientY: number },
    element: HTMLElement,
  ) =>
    | { col: number; row: number; x: number; y: number }
    | undefined;
  __vibeSpacePatched?: boolean;
};

function resolveElementScale(
  element: HTMLElement,
  rect: DOMRect,
): { scaleX: number; scaleY: number } {
  const w = element.offsetWidth;
  const h = element.offsetHeight;
  const sx = w > 0 && rect.width > 0 ? rect.width / w : 1;
  const sy = h > 0 && rect.height > 0 ? rect.height / h : 1;
  return {
    scaleX: Number.isFinite(sx) && sx > 0 ? sx : 1,
    scaleY: Number.isFinite(sy) && sy > 0 ? sy : 1,
  };
}

function parsePx(v: string): number {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function scaledRelativePx(
  event: { clientX: number; clientY: number },
  element: HTMLElement,
): [number, number] {
  const rect = element.getBoundingClientRect();
  const { scaleX, scaleY } = resolveElementScale(element, rect);
  const style = window.getComputedStyle(element);
  const padL = parsePx(style.getPropertyValue("padding-left"));
  const padT = parsePx(style.getPropertyValue("padding-top"));
  return [
    (event.clientX - rect.left) / scaleX - padL,
    (event.clientY - rect.top) / scaleY - padT,
  ];
}

function scaledCoords(
  event: { clientX: number; clientY: number },
  element: HTMLElement,
  isSelection: boolean,
  cellW: number,
  cellH: number,
  cols: number,
  rows: number,
): [number, number] | undefined {
  if (!Number.isFinite(cellW) || cellW <= 0) return undefined;
  if (!Number.isFinite(cellH) || cellH <= 0) return undefined;

  const [rx, ry] = scaledRelativePx(event, element);
  const x = Math.ceil((rx + (isSelection ? cellW / 2 : 0)) / cellW);
  const y = Math.ceil(ry / cellH);
  return [
    Math.min(Math.max(x, 1), cols + (isSelection ? 1 : 0)),
    Math.min(Math.max(y, 1), rows),
  ];
}

export function patchXtermMouseService(terminal: Terminal): boolean {
  const core = terminal as unknown as {
    _core?: {
      _mouseService?: XtermMouseService;
      _renderService?: {
        dimensions?: {
          css?: {
            cell?: { width?: number; height?: number };
            canvas?: { width?: number; height?: number };
          };
        };
      };
      _charSizeService?: { hasValidSize?: boolean };
    };
  };

  const ms = core._core?._mouseService;
  const rs = core._core?._renderService;
  const cs = core._core?._charSizeService;
  if (!ms || typeof ms.getCoords !== "function" || !rs || !cs) return false;
  if (ms.__vibeSpacePatched) return true;

  ms.__vibeSpacePatched = true;
  const originalGetCoords = ms.getCoords.bind(ms);

  ms.getCoords = (event, element, cols, rows, isSelection = false) => {
    if (!cs.hasValidSize) return undefined;
    const cellW = rs.dimensions?.css?.cell?.width ?? 0;
    const cellH = rs.dimensions?.css?.cell?.height ?? 0;
    return (
      scaledCoords(event, element, isSelection, cellW, cellH, cols, rows) ??
      originalGetCoords(event, element, cols, rows, isSelection)
    );
  };

  const originalReport =
    typeof ms.getMouseReportCoords === "function"
      ? ms.getMouseReportCoords.bind(ms)
      : null;
  if (!originalReport) return true;

  ms.getMouseReportCoords = (event, element) => {
    if (!cs.hasValidSize) return undefined;
    const cellW = rs.dimensions?.css?.cell?.width ?? 0;
    const cellH = rs.dimensions?.css?.cell?.height ?? 0;
    if (!Number.isFinite(cellW) || cellW <= 0) return originalReport(event, element);
    if (!Number.isFinite(cellH) || cellH <= 0) return originalReport(event, element);

    const [x, y] = scaledRelativePx(event, element);
    const cw = rs.dimensions?.css?.canvas?.width ?? 0;
    const ch = rs.dimensions?.css?.canvas?.height ?? 0;
    const cx = Number.isFinite(cw) && cw > 0 ? Math.min(Math.max(x, 0), cw - 1) : x;
    const cy = Number.isFinite(ch) && ch > 0 ? Math.min(Math.max(y, 0), ch - 1) : y;
    return {
      col: Math.floor(cx / cellW),
      row: Math.floor(cy / cellH),
      x: Math.floor(cx),
      y: Math.floor(cy),
    };
  };

  return true;
}

/**
 * The internal services may not be initialized synchronously after `term.open()`,
 * so retry on rAF until the patch succeeds (or `maxAttempts` is exhausted).
 * Returns a cancel function — call it on component unmount.
 */
export function patchXtermMouseServiceWithRetry(
  terminal: Terminal,
  maxAttempts = 30,
): () => void {
  if (typeof window === "undefined") {
    patchXtermMouseService(terminal);
    return () => {};
  }

  let cancelled = false;
  let frame: number | null = null;

  const tryPatch = (attempt: number) => {
    if (cancelled) return;
    if (patchXtermMouseService(terminal)) return;
    if (attempt >= maxAttempts) return;
    frame = window.requestAnimationFrame(() => tryPatch(attempt + 1));
  };
  tryPatch(0);

  return () => {
    cancelled = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}
