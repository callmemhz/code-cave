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
