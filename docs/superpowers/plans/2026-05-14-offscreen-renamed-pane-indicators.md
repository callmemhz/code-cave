# Off-screen Renamed-Pane Edge Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small, clickable edge indicator pointing toward any user-renamed pane that has scrolled fully out of the canvas viewport; clicking it pans the canvas to center that pane.

**Architecture:** Add one new React component `OffscreenLabels` rendered as a child of `<ReactFlow>` inside `Canvas.tsx`. The component subscribes to ReactFlow's transform + size and the canvas store's nodes, derives label positions by projecting the viewport-center → pane-center line onto an inset viewport rectangle, and calls `useReactFlow().setCenter` on click. Pure geometry lives in a separate module and is unit-tested with Vitest.

**Tech Stack:** TypeScript, React 19, `@xyflow/react` v12 (`useStore`, `useReactFlow`), Vitest (already a devDependency, configuration added in Task 1).

**Spec:** `docs/superpowers/specs/2026-05-14-offscreen-renamed-pane-indicators-design.md`

**File Structure:**

- Create: `vitest.config.ts` — minimal config so unit tests can run
- Create: `src/canvas/offscreenLabelsMath.ts` — pure geometry: `intersectEdgeAnchor`, `computeOffscreenLabel`, types
- Create: `src/canvas/offscreenLabelsMath.test.ts` — unit tests for the above
- Create: `src/canvas/OffscreenLabels.tsx` — React component, no props
- Modify: `src/canvas/Canvas.tsx` — render `<OffscreenLabels />` inside `<ReactFlow>`

---

### Task 1: Add minimal Vitest config

The codebase has `vitest` and `@testing-library/react` in devDependencies but no config file or tests yet. We need one config so the pure-math tests in later tasks can run.

**Files:**
- Create: `vitest.config.ts`

- [ ] **Step 1: Create the config**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 2: Verify Vitest discovers no tests yet but exits clean**

Run: `npx vitest run`
Expected: exits 0 with "No test files found" (or similar). If it errors on missing imports, fix the config; do not proceed.

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "chore(test): add minimal vitest config"
```

---

### Task 2: Implement and test `intersectEdgeAnchor`

A pure helper: given the viewport size in CSS pixels and a direction vector `(dx, dy)` from the viewport center, return the point on the inset viewport rectangle that the ray hits, plus the angle for the arrow.

**Files:**
- Create: `src/canvas/offscreenLabelsMath.ts`
- Test: `src/canvas/offscreenLabelsMath.test.ts`

- [ ] **Step 1: Write the failing test**

`src/canvas/offscreenLabelsMath.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { intersectEdgeAnchor } from "./offscreenLabelsMath";

describe("intersectEdgeAnchor", () => {
  const W = 1000, H = 600, PAD = 16;

  it("returns the right edge for a purely-right direction", () => {
    const r = intersectEdgeAnchor(1, 0, W, H, PAD);
    expect(r.ax).toBeCloseTo(W - PAD);
    expect(r.ay).toBeCloseTo(H / 2);
    expect(r.angle).toBeCloseTo(0);
  });

  it("returns the left edge for a purely-left direction", () => {
    const r = intersectEdgeAnchor(-1, 0, W, H, PAD);
    expect(r.ax).toBeCloseTo(PAD);
    expect(r.ay).toBeCloseTo(H / 2);
    expect(r.angle).toBeCloseTo(Math.PI);
  });

  it("returns the bottom edge for a purely-down direction", () => {
    const r = intersectEdgeAnchor(0, 1, W, H, PAD);
    expect(r.ax).toBeCloseTo(W / 2);
    expect(r.ay).toBeCloseTo(H - PAD);
    expect(r.angle).toBeCloseTo(Math.PI / 2);
  });

  it("returns the top edge for a purely-up direction", () => {
    const r = intersectEdgeAnchor(0, -1, W, H, PAD);
    expect(r.ax).toBeCloseTo(W / 2);
    expect(r.ay).toBeCloseTo(PAD);
    expect(r.angle).toBeCloseTo(-Math.PI / 2);
  });

  it("hits the top/bottom edge first when |dy|/H dominates", () => {
    // W=1000 H=600, halfW=484, halfH=284. dx=200, dy=200.
    // tX = 484/200 = 2.42, tY = 284/200 = 1.42 → tY wins.
    const r = intersectEdgeAnchor(200, 200, W, H, PAD);
    expect(r.ay).toBeCloseTo(H - PAD); // hits bottom
    expect(r.ax).toBeCloseTo(W / 2 + 284); // 500 + 284 = 784
  });

  it("hits the left/right edge first when |dx|/W dominates", () => {
    // dx=400, dy=100. tX = 484/400 = 1.21, tY = 284/100 = 2.84 → tX wins.
    const r = intersectEdgeAnchor(400, 100, W, H, PAD);
    expect(r.ax).toBeCloseTo(W - PAD); // hits right
    expect(r.ay).toBeCloseTo(H / 2 + 121); // 300 + 121
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/canvas/offscreenLabelsMath.test.ts`
Expected: FAIL — module not found / `intersectEdgeAnchor` is not exported.

- [ ] **Step 3: Implement the helper**

`src/canvas/offscreenLabelsMath.ts`:

```ts
export interface EdgeAnchor {
  ax: number;
  ay: number;
  angle: number;
}

export function intersectEdgeAnchor(
  dx: number,
  dy: number,
  W: number,
  H: number,
  pad: number,
): EdgeAnchor {
  const halfW = W / 2 - pad;
  const halfH = H / 2 - pad;
  const tX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  return {
    ax: W / 2 + dx * t,
    ay: H / 2 + dy * t,
    angle: Math.atan2(dy, dx),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/canvas/offscreenLabelsMath.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/canvas/offscreenLabelsMath.ts src/canvas/offscreenLabelsMath.test.ts
git commit -m "feat(canvas): geometry helper for off-screen edge anchors"
```

---

### Task 3: Implement and test `computeOffscreenLabel`

Combines viewport math and per-node eligibility. Given a node and the current viewport (in CSS pixels and zoom), returns either a label descriptor or `null`.

**Files:**
- Modify: `src/canvas/offscreenLabelsMath.ts`
- Modify: `src/canvas/offscreenLabelsMath.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `src/canvas/offscreenLabelsMath.test.ts`:

```ts
import { computeOffscreenLabel } from "./offscreenLabelsMath";
import type { DbNode } from "../types";

function mkNode(over: Partial<DbNode>): DbNode {
  return {
    id: "n1",
    canvas_id: "c",
    type: "terminal",
    x: 0, y: 0, width: 100, height: 80,
    title: "My Pane",
    data_json: "{}",
    created_at: 0, updated_at: 0,
    ...over,
  };
}

const VP = { tx: 0, ty: 0, zoom: 1, W: 1000, H: 600 };
const PAD = 16;

describe("computeOffscreenLabel", () => {
  it("returns null when the pane is inside the viewport", () => {
    const n = mkNode({ x: 100, y: 100 });
    expect(computeOffscreenLabel(n, VP, PAD)).toBeNull();
  });

  it("returns null when the pane partially overlaps the viewport", () => {
    // pane at right edge overlapping
    const n = mkNode({ x: 950, y: 100, width: 200, height: 80 });
    expect(computeOffscreenLabel(n, VP, PAD)).toBeNull();
  });

  it("returns null when title is null", () => {
    const n = mkNode({ x: 2000, y: 100, title: null });
    expect(computeOffscreenLabel(n, VP, PAD)).toBeNull();
  });

  it("returns null when title is whitespace", () => {
    const n = mkNode({ x: 2000, y: 100, title: "   " });
    expect(computeOffscreenLabel(n, VP, PAD)).toBeNull();
  });

  it("returns a right-edge anchor for a pane off to the right", () => {
    const n = mkNode({ x: 2000, y: 260, width: 100, height: 80 });
    const r = computeOffscreenLabel(n, VP, PAD);
    expect(r).not.toBeNull();
    expect(r!.ax).toBeCloseTo(VP.W - PAD);
    expect(r!.title).toBe("My Pane");
    expect(r!.cxFlow).toBeCloseTo(2050);
    expect(r!.cyFlow).toBeCloseTo(300);
  });

  it("returns a bottom-edge anchor for a pane off below, accounting for zoom and pan", () => {
    // Viewport in flow coords with zoom=2, tx=ty=0:
    //   vMinX=0, vMaxX=500, vMinY=0, vMaxY=300
    // Place pane fully below viewport in flow coords.
    const n = mkNode({ x: 200, y: 400, width: 100, height: 80 });
    const r = computeOffscreenLabel(n, { ...VP, zoom: 2 }, PAD);
    expect(r).not.toBeNull();
    expect(r!.ay).toBeCloseTo(VP.H - PAD);
  });

  it("trims the title", () => {
    const n = mkNode({ x: 2000, y: 100, title: "  Named  " });
    const r = computeOffscreenLabel(n, VP, PAD);
    expect(r!.title).toBe("Named");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/canvas/offscreenLabelsMath.test.ts`
Expected: FAIL — `computeOffscreenLabel` is not exported.

- [ ] **Step 3: Implement `computeOffscreenLabel`**

Append to `src/canvas/offscreenLabelsMath.ts`:

```ts
import type { DbNode } from "../types";

export interface ViewportPx {
  /** ReactFlow translate.x in CSS px (negative = pan right). */
  tx: number;
  /** ReactFlow translate.y in CSS px. */
  ty: number;
  zoom: number;
  /** Container width in CSS px. */
  W: number;
  /** Container height in CSS px. */
  H: number;
}

export interface OffscreenLabel {
  id: string;
  title: string;
  /** Anchor in screen-space CSS px, relative to ReactFlow container. */
  ax: number;
  ay: number;
  /** Arrow rotation in radians; base orientation points to +x. */
  angle: number;
  /** Pane center in flow coordinates, used by setCenter. */
  cxFlow: number;
  cyFlow: number;
}

export function computeOffscreenLabel(
  n: DbNode,
  vp: ViewportPx,
  pad: number,
): OffscreenLabel | null {
  const title = n.title?.trim();
  if (!title) return null;

  // Viewport rect in flow coords.
  const vMinX = -vp.tx / vp.zoom;
  const vMinY = -vp.ty / vp.zoom;
  const vMaxX = vMinX + vp.W / vp.zoom;
  const vMaxY = vMinY + vp.H / vp.zoom;

  const nMaxX = n.x + n.width;
  const nMaxY = n.y + n.height;

  const intersects =
    nMaxX >= vMinX && n.x <= vMaxX &&
    nMaxY >= vMinY && n.y <= vMaxY;
  if (intersects) return null;

  const cxFlow = n.x + n.width / 2;
  const cyFlow = n.y + n.height / 2;
  const cxScreen = cxFlow * vp.zoom + vp.tx;
  const cyScreen = cyFlow * vp.zoom + vp.ty;

  const dx = cxScreen - vp.W / 2;
  const dy = cyScreen - vp.H / 2;
  if (dx === 0 && dy === 0) return null;

  const { ax, ay, angle } = intersectEdgeAnchor(dx, dy, vp.W, vp.H, pad);
  return { id: n.id, title, ax, ay, angle, cxFlow, cyFlow };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/canvas/offscreenLabelsMath.test.ts`
Expected: all tests pass (6 from Task 2 + 7 new = 13).

- [ ] **Step 5: Commit**

```bash
git add src/canvas/offscreenLabelsMath.ts src/canvas/offscreenLabelsMath.test.ts
git commit -m "feat(canvas): computeOffscreenLabel eligibility + anchor"
```

---

### Task 4: Implement `OffscreenLabels` React component

Wraps the pure math with ReactFlow store subscriptions and renders pills.

**Files:**
- Create: `src/canvas/OffscreenLabels.tsx`

- [ ] **Step 1: Create the component**

`src/canvas/OffscreenLabels.tsx`:

```tsx
import React from "react";
import { useStore, useReactFlow, type ReactFlowState } from "@xyflow/react";
import { useCanvasStore } from "../store/canvasStore";
import { computeOffscreenLabel, type ViewportPx } from "./offscreenLabelsMath";

const PAD = 16;

const transformSel = (s: ReactFlowState) => s.transform;
const widthSel = (s: ReactFlowState) => s.width;
const heightSel = (s: ReactFlowState) => s.height;

export function OffscreenLabels() {
  const transform = useStore(transformSel);
  const W = useStore(widthSel);
  const H = useStore(heightSel);
  const activeId = useCanvasStore((s) => s.activeCanvasId);
  const nodes = useCanvasStore((s) =>
    activeId ? s.nodesByCanvas[activeId] ?? [] : [],
  );
  const rf = useReactFlow();

  if (!W || !H) return null;

  const vp: ViewportPx = {
    tx: transform[0],
    ty: transform[1],
    zoom: transform[2],
    W,
    H,
  };

  const labels = nodes
    .map((n) => computeOffscreenLabel(n, vp, PAD))
    .filter((l): l is NonNullable<typeof l> => l !== null);

  if (labels.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        // Sit above ReactFlow's panes but below MiniMap/Controls (which
        // are positioned with their own z-index). z-index 4 is between
        // node layer (~1-3) and controls (5+).
        zIndex: 4,
      }}
    >
      {labels.map((l) => (
        <button
          key={l.id}
          className="nodrag"
          onClick={() =>
            rf.setCenter(l.cxFlow, l.cyFlow, {
              zoom: vp.zoom,
              duration: 250,
            })
          }
          title={l.title}
          style={{
            position: "absolute",
            left: l.ax,
            top: l.ay,
            transform: "translate(-50%, -50%)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: "#222",
            border: "1px solid #444",
            color: "#eee",
            padding: "2px 6px",
            borderRadius: 999,
            fontSize: 11,
            lineHeight: 1.2,
            maxWidth: 180,
            pointerEvents: "auto",
            cursor: "pointer",
            font: "inherit",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              transform: `rotate(${l.angle}rad)`,
              transformOrigin: "center",
              fontSize: 10,
              lineHeight: 1,
            }}
          >
            ▶
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 140,
            }}
          >
            {l.title}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

If `useStore` complains about the selector return type, the `ReactFlowState` import handles it. If `setCenter`'s options type rejects `{ zoom, duration }`, drop `duration` and use a plain pan — but xyflow v12's `setCenter(x, y, options)` accepts both.

- [ ] **Step 3: Commit**

```bash
git add src/canvas/OffscreenLabels.tsx
git commit -m "feat(canvas): OffscreenLabels component for renamed off-screen panes"
```

---

### Task 5: Wire `OffscreenLabels` into `Canvas.tsx` and verify manually

**Files:**
- Modify: `src/canvas/Canvas.tsx`

- [ ] **Step 1: Add the import**

Add this import near the other canvas imports in `src/canvas/Canvas.tsx`:

```ts
import { OffscreenLabels } from "./OffscreenLabels";
```

- [ ] **Step 2: Render the component inside `<ReactFlow>`**

In `Canvas.tsx`, find this block (around line 171-174):

```tsx
        <BackgroundLayer />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
```

Replace with:

```tsx
        <BackgroundLayer />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
        <OffscreenLabels />
```

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the dev app and verify manually**

Run: `npm run tauri dev` (or `npm run dev` if Tauri isn't needed for this smoke test).
Manually verify:

1. Open the app, create or open a canvas with at least one terminal/claude/codex/note pane.
2. Double-click the pane title bar, type a name, press Enter. Confirm the title sticks.
3. Pan/zoom so the pane is fully outside the viewport. A small pill with the name should appear on the viewport edge between the viewport center and the pane.
4. Click the pill. The viewport should smoothly recenter on the pane at the current zoom level.
5. Rename a pane back to empty (or never rename it) → no indicator appears for that pane.
6. With two renamed off-screen panes in different directions, both indicators appear on the correct edges.

Stop the dev process.

- [ ] **Step 5: Commit**

```bash
git add src/canvas/Canvas.tsx
git commit -m "feat(canvas): wire OffscreenLabels overlay into the canvas"
```

---

## Self-Review

**Spec coverage:**

- Detect renamed via `title?.trim()`. Task 3 step 3.
- Detect fully off-screen via AABB. Task 3 step 3.
- Projection anchor on inset rect. Task 2 step 3.
- Rotated arrow, horizontal label. Task 4 step 1.
- Click → `setCenter(..., { zoom, duration: 250 })`. Task 4 step 1.
- Live update on pan/zoom. Task 4 uses `useStore` selectors, re-renders on transform change.
- Component renders for active canvas only. Task 4 reads `activeCanvasId` and gates on it.
- Edge case: container size 0 → return null. Task 4 step 1.
- Edge case: pane center exactly at viewport center → return null. Task 3 step 3.

**Placeholder scan:** no TBDs, no "similar to", no incomplete code blocks. The one optional `if` in Task 4 step 2 (about `setCenter` options) describes a fallback explicitly — not a placeholder.

**Type consistency:** `ViewportPx`, `EdgeAnchor`, `OffscreenLabel` types defined in Task 2/3 and consumed in Task 4. `intersectEdgeAnchor` signature `(dx, dy, W, H, pad)` used identically in test and implementation. `computeOffscreenLabel(n, vp, pad)` consistent across tasks. `PAD = 16` is the only magic constant and is defined once in `OffscreenLabels.tsx`.
