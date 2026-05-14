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
