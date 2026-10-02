/**
 * Geometric (girih-style) star patterns, built the traditional way: tile the plane with polygons,
 * then from the midpoint of every edge draw two lines into each polygon at a fixed "contact angle".
 * Lines from the two edges that meet at a corner run until they cross; the crossings make the stars.
 * (This is the polygons-in-contact method described by E. H. Hankin, 1925.)
 *
 * Everything is exact geometry in millimetres, seamless at any size, and pure (runs in tests).
 */
export type Pt = readonly [number, number];
export type Seg = readonly [Pt, Pt];
export type PatternKind = "star8" | "star6" | "octagon8" | "star12";
export type BandStyle = "raised" | "double" | "groove";

export const PATTERNS: readonly { id: PatternKind; label: string; hint: string }[] = [
  { id: "star8", label: "Star and cross", hint: "The classic 8-point tile" },
  { id: "octagon8", label: "Khatam stars", hint: "8-point stars, small 4-point stars" },
  { id: "star6", label: "6-point stars", hint: "Hexagon lattice" },
  { id: "star12", label: "12-point rosettes", hint: "Rich, for large panels" },
];

type Poly = Pt[];

// ---------------------------------------------------------------- tilings (unit edge length 1)

/** Regular polygon with `n` sides of length 1, centred at c, first vertex at angle a0. */
function regular(n: number, c: Pt, a0: number): Poly {
  const R = 1 / (2 * Math.sin(Math.PI / n));
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i * 2 * Math.PI) / n;
    return [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)] as Pt;
  });
}

/**
 * Star and cross: an eight-point star (two squares, one turned 45°) at every point of a square grid,
 * reaching exactly half-way to its neighbours. The gaps between four stars are the crosses.
 */
function starAndCross(): Seg[] {
  const R = 0.5;
  const q = R / Math.SQRT2;
  const inner = R - q; // where the two squares' edges cross
  const pts: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const rot = (p: Pt): Pt => {
      const a = (k * Math.PI) / 2;
      return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
    };
    pts.push(rot([R, 0]), rot([q, inner]), rot([q, q]), rot([inner, q]));
  }
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as Seg);
}

/** Translational unit of each tiling: its polygons, and the two lattice vectors. */
function unit(kind: PatternKind): { polys: Poly[]; a: Pt; b: Pt; theta: number; motif?: Seg[] } {
  switch (kind) {
    case "star8": {
      return { polys: [], a: [1, 0], b: [0, 1], theta: 0, motif: starAndCross() };
    }
    case "star6": {
      // hexagons (flat top); 60° gives six-point stars with small hexagons between
      const s3 = Math.sqrt(3);
      return { polys: [regular(6, [0, 0], 0)], a: [1.5, s3 / 2], b: [0, s3], theta: (60 * Math.PI) / 180 };
    }
    case "octagon8": {
      // 4.8.8: octagons and squares
      const R8 = 1 / (2 * Math.sin(Math.PI / 8));
      const w = 2 * R8 * Math.cos(Math.PI / 8); // octagon across flats = 1 + √2
      return {
        polys: [regular(8, [0, 0], Math.PI / 8), regular(4, [w / 2, w / 2], Math.PI / 4)],
        a: [w, 0],
        b: [0, w],
        theta: (67.5 * Math.PI) / 180,
      };
    }
    case "star12": {
      // 3.12.12: dodecagons and triangles (lines are drawn in the dodecagons only)
      const R12 = 1 / (2 * Math.sin(Math.PI / 12));
      const d = 2 * R12 * Math.cos(Math.PI / 12); // across flats of the dodecagon = 2 + √3
      const a: Pt = [d, 0];
      const b: Pt = [d / 2, (d * Math.sqrt(3)) / 2];
      return {
        // only the dodecagons get lines: the small triangles between them would carve as tiny blobs
        polys: [regular(12, [0, 0], Math.PI / 12)],
        a,
        b,
        theta: (72 * Math.PI) / 180, // tried 60–80°: 72° gives clean, sharp rosettes
      };
    }
  }
}

// ---------------------------------------------------------------- Hankin construction

function intersect(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + t * d[0], p[1] + t * d[1]];
}

/** Star-pattern lines inside one convex polygon (vertices counter-clockwise). */
function hankin(poly: Poly, theta: number): Seg[] {
  const n = poly.length;
  const out: Seg[] = [];
  const mids: Pt[] = [];
  const dirs: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    mids.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    dirs.push([(b[0] - a[0]) / l, (b[1] - a[1]) / l]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; // edges i and j meet at vertex poly[j]
    const [ux, uy] = dirs[i]!;
    const [vx, vy] = dirs[j]!;
    // from edge i, towards its end vertex, turned inwards (left of the edge for CCW polygons) by theta
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const r1: Pt = [ux * c - uy * s, ux * s + uy * c];
    // from edge j, back towards its start vertex, turned inwards by theta
    const r2: Pt = [-vx * c - vy * s, -vy * c + vx * s];
    const x = intersect(mids[i]!, r1, mids[j]!, r2);
    if (!x) continue;
    out.push([mids[i]!, x], [x, mids[j]!]);
  }
  return out;
}

function ccw(poly: Poly): Poly {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a < 0 ? [...poly].reverse() : poly;
}

/** Clip a segment to a box (Liang–Barsky); null if outside. */
function clip(s: Seg, x0: number, y0: number, x1: number, y1: number): Seg | null {
  const [[ax, ay], [bx, by]] = s;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (t1 - t0 < 1e-9) return null;
  return [
    [ax + t0 * dx, ay + t0 * dy],
    [ax + t1 * dx, ay + t1 * dy],
  ];
}

export type PatternBox = { x0: number; y0: number; x1: number; y1: number };

/**
 * Pattern lines covering `box`, with `repeats` pattern units across the box's short side,
 * centred on the box so the design is symmetric. Segments are in mm and clipped to the box.
 */
export function patternSegments(kind: PatternKind, box: PatternBox, repeats: number): Seg[] {
  const u = unit(kind);
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  // size of one unit along the short side
  const span = Math.hypot(u.b[0], u.b[1]);
  const k = Math.min(w, h) / Math.max(0.5, repeats) / span;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  // offset so a polygon centre / vertex star sits in the middle of the box
  const offset: Pt = [0, 0];
  const motif = u.motif ?? u.polys.map(ccw).flatMap((p) => hankin(p, u.theta));
  // how many lattice steps cover the box
  const reach = Math.hypot(w, h) / k;
  const det = u.a[0] * u.b[1] - u.a[1] * u.b[0];
  const n = Math.ceil(reach / Math.min(Math.hypot(...u.a), Math.abs(det) / Math.hypot(...u.a))) + 2;
  const out: Seg[] = [];
  const seen = new Set<string>();
  const key = (p: Pt) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const tx = i * u.a[0] + j * u.b[0] + offset[0];
      const ty = i * u.a[1] + j * u.b[1] + offset[1];
      for (const [p, q] of motif) {
        const P: Pt = [cx + (p[0] + tx) * k, cy + (p[1] + ty) * k];
        const Q: Pt = [cx + (q[0] + tx) * k, cy + (q[1] + ty) * k];
        const c = clip([P, Q], box.x0, box.y0, box.x1, box.y1);
        if (!c) continue;
        // neighbouring tiles draw shared lines twice: keep one
        const id = [key(c[0]), key(c[1])].sort().join("|");
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(c);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- carving

function distSeg(x: number, y: number, s: Seg): number {
  const [[ax, ay], [bx, by]] = s;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/**
 * Carve pattern bands onto `h` (heights in mm). A band is `bandMm` wide:
 *  - raised: flat top with rounded shoulders, `heightMm` above `ground`
 *  - double: the same with a V groove down the middle (two-line strapwork)
 *  - groove: a V cut `heightMm` deep into the surface
 * `keep(x, y)` (mm) limits carving to an area, e.g. outside a medallion.
 */
export function drawPattern(
  h: Float32Array,
  cols: number,
  rows: number,
  mmPx: number,
  segs: readonly Seg[],
  ground: number,
  bandMm: number,
  heightMm: number,
  style: BandStyle,
  keep?: (x: number, y: number) => boolean,
): void {
  const half = Math.max(bandMm / 2, mmPx * 0.8);
  const shoulder = Math.max(half * 0.45, mmPx * 0.8);
  // nearest-band distance per pixel, so crossings join cleanly
  const dist = new Float32Array(cols * rows).fill(Infinity);
  for (const s of segs) {
    const [[ax, ay], [bx, by]] = s;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half) / mmPx) - 1);
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + half) / mmPx) + 1);
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - half) / mmPx) - 1);
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(ay, by) + half) / mmPx) + 1);
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const d = distSeg((x + 0.5) * mmPx, (y + 0.5) * mmPx, s);
        const i = y * cols + x;
        if (d < dist[i]!) dist[i] = d;
      }
    }
  }
  const grooveHalf = half * 0.28;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const d = dist[i]!;
      if (d >= half) continue;
      if (keep && !keep((x + 0.5) * mmPx, (y + 0.5) * mmPx)) continue;
      if (style === "groove") {
        // V cut: deepest on the line
        const z = (h[i] ?? ground) - heightMm * (1 - d / half);
        if (z < h[i]!) h[i] = z;
        continue;
      }
      // flat top, rounded shoulder at the band edge
      const e = half - d; // distance in from the band edge
      let z = ground + heightMm * Math.sqrt(Math.max(0, 1 - Math.max(0, 1 - e / shoulder) ** 2));
      if (style === "double" && d < grooveHalf) z -= heightMm * 0.45 * (1 - d / grooveHalf);
      if (z > h[i]!) h[i] = z;
    }
  }
}
