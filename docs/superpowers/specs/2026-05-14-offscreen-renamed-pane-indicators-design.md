# Off-screen Renamed-Pane Edge Indicators

## Goal

When a pane (node) has been renamed by the user and currently sits fully
outside the canvas viewport, render a small clickable indicator on the
viewport edge that points toward the pane and shows its title. Clicking
the indicator pans the canvas so the pane is centered (zoom preserved).

This helps users find the panes they care enough about to name, without
having to remember their canvas coordinates.

## Scope

In:

- Detect "user-renamed" via `DbNode.title != null && title.trim() !== ""`.
- Detect "fully off-screen" via viewport-vs-node rect intersection in
  flow coordinates.
- Place each indicator at the intersection of the viewport-center →
  pane-center line with the viewport edge (with inset padding).
- Render a pill: outward arrow (rotated to point at the pane) + title
  text (horizontal, truncated). Dark theme matching `NodeHeader`.
- Click the indicator → `setCenter(paneCenter.x, paneCenter.y,
  { zoom: currentZoom, duration: 250 })`.
- Live-update during pan and zoom.

Out (YAGNI):

- Partial-visibility indicators. Only fully-outside panes qualify.
- Collision/stacking when multiple indicators overlap. Pure projection;
  overlap accepted.
- Indicators for un-renamed panes.
- Keyboard navigation, focus rings beyond browser default, screen-reader
  affordances beyond plain `<button>` semantics.
- Animation on appear/disappear.
- Configuration UI / settings persistence.
- MiniMap interactions, edge cases involving multiple canvases — the
  component renders only for the active canvas's nodes (same source as
  `Canvas.tsx`).

## Architecture

One new file:

- `src/canvas/OffscreenLabels.tsx` — default-exports a React component
  with no props.

One small edit:

- `src/canvas/Canvas.tsx` — render `<OffscreenLabels />` as a child of
  `<ReactFlow>`, alongside `<BackgroundLayer />`, `<MiniMap />`,
  `<Controls />`.

No store, IPC, type, or schema changes. Reads existing state only.

## Data Flow

`OffscreenLabels` subscribes to:

- ReactFlow internal store via `useStore` from `@xyflow/react`:
  - `transform: [tx, ty, zoom]`
  - `width`, `height` (canvas container size in CSS pixels)
- App store via `useCanvasStore`:
  - `activeCanvasId`
  - `nodesByCanvas[activeCanvasId]` (the same `rawNodes` `Canvas.tsx`
    uses)
- `useReactFlow()` for the `setCenter` action used on click.

On every render (i.e., on transform/size/nodes change):

1. Compute viewport rect in flow coords:
   `vMinX = -tx / zoom`, `vMinY = -ty / zoom`,
   `vMaxX = vMinX + W / zoom`, `vMaxY = vMinY + H / zoom`.
2. For each node `n` with `n.title?.trim()`:
   - If `n.x + n.width >= vMinX && n.x <= vMaxX && n.y + n.height
     >= vMinY && n.y <= vMaxY` → intersects viewport, skip.
   - Else compute pane center in screen px:
     `cxS = (n.x + n.width/2) * zoom + tx`,
     `cyS = (n.y + n.height/2) * zoom + ty`.
   - Direction from viewport center `(W/2, H/2)` to `(cxS, cyS)`:
     `dx, dy`. If both are zero, skip.
   - Edge intersection with inset rectangle
     `[PAD, PAD, W-PAD, H-PAD]`: let `halfW = W/2 - PAD`,
     `halfH = H/2 - PAD`. Compute
     `tX = dx !== 0 ? halfW / Math.abs(dx) : Infinity`,
     `tY = dy !== 0 ? halfH / Math.abs(dy) : Infinity`,
     `t = Math.min(tX, tY)`. Anchor: `ax = W/2 + dx * t`,
     `ay = H/2 + dy * t`.
   - Angle for the arrow: `angle = atan2(dy, dx)`.
3. Render one absolutely-positioned `<button>` per qualifying node at
   `(ax, ay)`, with the arrow rotated by `angle` and the title text
   horizontal.

## Components

```
src/canvas/OffscreenLabels.tsx
  export function OffscreenLabels(): JSX.Element
    - selectors: useStore(s => s.transform), useStore(s => [s.width, s.height], shallow)
    - state: derived `labels` array
    - render: <div pointerEvents=none, absolute inset:0> {labels.map -> <Pill/>} </div>

  helper (file-local):
    function intersectEdge(cx, cy, tx, ty, W, H, pad)
      returns { ax, ay, angle }
```

Pill markup (sketch):

```tsx
<button
  className="nodrag"
  onClick={() => rf.setCenter(cxFlow, cyFlow, { zoom, duration: 250 })}
  style={{
    position: "absolute", left: ax, top: ay,
    transform: "translate(-50%, -50%)",
    display: "flex", alignItems: "center", gap: 4,
    background: "#222", border: "1px solid #444",
    color: "#eee", padding: "2px 6px",
    borderRadius: 999, fontSize: 11, lineHeight: 1.2,
    maxWidth: 180, pointerEvents: "auto",
    cursor: "pointer",
  }}
  title={title}
>
  <span style={{ transform: `rotate(${angle}rad)`, display: "inline-flex" }}>
    {/* small ▶ glyph, base orientation pointing right */}
    ▶
  </span>
  <span style={{
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    maxWidth: 140,
  }}>{title}</span>
</button>
```

The arrow rotates; the label stays upright. The arrow glyph's base
orientation points to the right (+x), so `angle = atan2(dy, dx)` with
no offset is correct.

Constants:

- `PAD = 16` — inset from container edge so the pill doesn't hang off.

`className="nodrag"` matches the convention used elsewhere
(`NodeHeader.tsx`) to keep clicks out of ReactFlow's drag pipeline.

## Integration

`Canvas.tsx` edit (inside the existing `<ReactFlow>` block):

```tsx
<ReactFlow ...>
  <BackgroundLayer />
  <MiniMap pannable zoomable />
  <Controls showInteractive={false} />
  <OffscreenLabels />
</ReactFlow>
```

Children of `<ReactFlow>` render inside its wrapper div, so the
overlay's `position: absolute; inset: 0` aligns 1:1 with the canvas
viewport and reads the same `width/height` we use for math.

## Behavior

- Pan / zoom → indicators recompute and reposition each frame.
- Renaming a pane via header → `updateNodeTitle` flips its `title` to a
  non-empty string; if currently off-screen, an indicator appears on the
  next render.
- Clearing the title (rename to empty) → `onRename` is called with the
  empty draft; `onRename` is implementation-defined per node type, but
  this component just respects `title.trim() !== ""`. No special-case
  handling needed here.
- Deleting a pane → it leaves `nodesByCanvas`; its indicator disappears.
- Switching active canvas → `Canvas.tsx` rekeys `<ReactFlow key={active.id}>`,
  which remounts `<OffscreenLabels />` with the new canvas's nodes.

## Edge Cases

| Case | Behavior |
| --- | --- |
| Pane fully inside viewport | No indicator. |
| Pane edges touch / overlap viewport (partially visible) | No indicator (rect-intersect check is inclusive). |
| Pane completely contains viewport | "Intersects" by the inclusive check → no indicator. |
| Pane center exactly at viewport center (`dx == dy == 0`) | Skip. (Only possible when pane completely contains viewport, already filtered.) |
| `n.title == null` or whitespace | Not eligible. |
| Container size is 0 (first paint, hidden tab) | Math degenerates but no errors; pills land at origin and are invisible. Acceptable. |
| Hundreds of renamed off-screen panes | Each render is O(N), no observable cost in target ranges (we never expect >100). No throttling. |
| Click on indicator | `setCenter(cxFlow, cyFlow, { zoom: currentZoom, duration: 250 })`. The existing `onMove` handler debounces the viewport save. |

## Testing

Unit-testable: extract `intersectEdge` and a `computeLabel(node, vp,
size)` pure function. Cover:

- Pane off to each of the 4 sides (up/down/left/right) — anchor lands
  on correct edge, angle in expected quadrant.
- Pane off-diagonal — anchor on the "earlier" edge by `min(|tX|, |tY|)`.
- Pane fully inside viewport → returns `null`.
- Title `null` / empty / whitespace → returns `null`.
- Pane partially visible → returns `null`.

Component-level interaction (click → `setCenter`) is covered by a
shallow test that mocks `useReactFlow` and asserts call args.

No visual regression coverage; manual sanity check by panning around.

## Risk / Open Questions

- `useStore` from `@xyflow/react` re-renders every frame during pan/zoom.
  Verified cheap for N ~ tens of nodes; revisit if profiling shows it.
- If we later want collision avoidance, `intersectEdge`'s output is the
  natural input for a stacking pass — design is forward-compatible.
