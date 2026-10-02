/**
 * Panel outlines: rectangle, arch top (a half-ellipse over a rectangle, like a mihrab) and oval.
 * Outside the outline the relief drops to zero, so the plaque can be profile-cut on the CNC.
 * `inset` gives the same outline moved inwards (approximately: the radii shrink), used for the
 * bead inside the frame and for keeping text and patterns clear of it.
 */
export type Shape = "rect" | "arch" | "oval";
export type Pt = readonly [number, number];

/** Height of the arch above its spring line: a half-circle when the panel is tall enough. */
export function archRise(W: number, H: number): number {
  return Math.min(W / 2, H * 0.45);
}

/** Is (x, y) inside the outline shrunk by `inset` mm? */
export function insideShape(shape: Shape, W: number, H: number, x: number, y: number, inset = 0): boolean {
  if (x < inset || x > W - inset || y > H - inset || y < inset) return false;
  if (shape === "rect") return true;
  if (shape === "oval") {
    const a = W / 2 - inset;
    const b = H / 2 - inset;
    if (a <= 0 || b <= 0) return false;
    return ((x - W / 2) / a) ** 2 + ((y - H / 2) / b) ** 2 <= 1;
  }
  const rise = archRise(W, H);
  if (y >= rise) return true;
  const a = W / 2 - inset;
  const b = rise - inset;
  if (a <= 0 || b <= 0) return false;
  return ((x - W / 2) / a) ** 2 + ((y - rise) / b) ** 2 <= 1;
}

/** The outline shrunk by `inset`, as a closed path (first point repeated at the end). */
export function shapeContour(shape: Shape, W: number, H: number, inset: number, n = 160): Pt[] {
  const pts: Pt[] = [];
  if (shape === "oval") {
    const a = W / 2 - inset;
    const b = H / 2 - inset;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 2 * Math.PI;
      pts.push([W / 2 + a * Math.cos(t), H / 2 + b * Math.sin(t)]);
    }
    return pts;
  }
  if (shape === "arch") {
    const rise = archRise(W, H);
    const a = W / 2 - inset;
    const b = rise - inset;
    pts.push([inset, H - inset]);
    for (let i = 0; i <= n; i++) {
      const t = Math.PI + (i / n) * Math.PI; // left spring → apex → right spring
      pts.push([W / 2 + a * Math.cos(t), rise + b * Math.sin(t)]);
    }
    pts.push([W - inset, H - inset], [inset, H - inset]);
    return pts;
  }
  return [
    [inset, inset],
    [W - inset, inset],
    [W - inset, H - inset],
    [inset, H - inset],
    [inset, inset],
  ];
}

/**
 * The biggest comfortable box for text inside the shrunk outline. For an arch the box starts a
 * little way up into the arch (narrowed so its top corners stay inside); for an oval it is a
 * wide rectangle inscribed in the ellipse.
 */
export function contentBox(shape: Shape, W: number, H: number, inset: number): { x0: number; y0: number; x1: number; y1: number } {
  if (shape === "oval") {
    const a = W / 2 - inset;
    const b = H / 2 - inset;
    // (0.82)² + (0.55)² < 1: the corners stay inside the ellipse
    return { x0: W / 2 - 0.82 * a, x1: W / 2 + 0.82 * a, y0: H / 2 - 0.55 * b, y1: H / 2 + 0.55 * b };
  }
  if (shape === "arch") {
    const rise = archRise(W, H);
    const a = W / 2 - inset;
    const b = rise - inset;
    // up into the arch by 40 % of its rise, where its width is still √(1 − 0.4²) ≈ 0.92 of the full width
    return { x0: W / 2 - 0.88 * a, x1: W / 2 + 0.88 * a, y0: rise - 0.4 * b, y1: H - inset };
  }
  return { x0: inset, y0: inset, x1: W - inset, y1: H - inset };
}
