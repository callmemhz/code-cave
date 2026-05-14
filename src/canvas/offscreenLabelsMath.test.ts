import { describe, it, expect } from "vitest";
import { intersectEdgeAnchor, computeOffscreenLabel } from "./offscreenLabelsMath";
import type { DbNode } from "../types";

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
