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
export type BandStyle = "raised" | "double" | "groove" | "woven";

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
  if (style === "woven") {
    drawWoven(h, cols, rows, mmPx, segs, ground, half, shoulder, heightMm, keep);
    return;
  }
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

// ---------------------------------------------------------------- weaving (over and under)

/** For each segment, the positions t (0..1 along it) where it passes UNDER another band. */
export type Weave = number[][];

/**
 * Over-under for star-pattern lines, like hand-carved interlace: follow each strand (lines that run
 * straight on through a crossing) and alternate over, under, over… Crossings are where two segments
 * cut through each other, or where four segment ends meet as two straight lines. Each crossing is
 * decided once, by whichever strand reaches it first; the other strand takes the opposite.
 */
export function weave(segs: readonly Seg[]): Weave {
  return weaveFull(segs).under;
}

/** weave(), plus which strand (continuous band) each segment belongs to. */
export function weaveFull(segs: readonly Seg[]): { under: Weave; strand: Int32Array } {
  const n = segs.length;
  const under: Weave = segs.map(() => []);
  type Pass = { seg: number; t: number };
  type Cross = { a: Pass[]; b: Pass[]; over?: "a" | "b" };
  const crosses: Cross[] = [];
  // crossings met along each segment: [t, crossing, side]
  const along: [number, number, "a" | "b"][][] = segs.map(() => []);
  const dir = (s: Seg) => {
    const dx = s[1][0] - s[0][0];
    const dy = s[1][1] - s[0][1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l] as const;
  };
  // 1) interior crossings
  for (let i = 0; i < n; i++) {
    const [[ax, ay], [bx, by]] = segs[i]!;
    for (let j = i + 1; j < n; j++) {
      const [[cx, cy], [dx, dy]] = segs[j]!;
      if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx) || Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) continue;
      const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
      const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
      if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) continue;
      const k = crosses.push({ a: [{ seg: i, t }], b: [{ seg: j, t: u }] }) - 1;
      along[i]!.push([t, k, "a"]);
      along[j]!.push([u, k, "b"]);
    }
  }
  // 2) joints: segment ends that meet; pair the ends that continue most nearly straight
  const key = (p: Pt) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const ends = new Map<string, { seg: number; end: 0 | 1 }[]>();
  segs.forEach((s, i) => ([0, 1] as const).forEach((e) => {
    const k = key(s[e]);
    (ends.get(k) ?? ends.set(k, []).get(k)!).push({ seg: i, end: e });
  }));
  // next[seg][end] = the segment end a strand continues into
  const next: ({ seg: number; end: 0 | 1 } | null)[][] = segs.map(() => [null, null]);
  for (const list of ends.values()) {
    // outward direction of each end (pointing away from the joint, along its segment)
    const out = list.map(({ seg, end }) => {
      const [x, y] = dir(segs[seg]!);
      return end === 0 ? [x, y] : [-x, -y];
    });
    const used = new Set<number>();
    const pairs: [number, number][] = [];
    for (;;) {
      let best = -1, bi = -1, bj = -1;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        if (used.has(i) || used.has(j)) continue;
        const straight = -(out[i]![0]! * out[j]![0]! + out[i]![1]! * out[j]![1]!); // 1 = straight on
        if (straight > best) (best = straight), (bi = i), (bj = j);
      }
      if (bi < 0) break;
      used.add(bi); used.add(bj);
      pairs.push([bi, bj]);
      next[list[bi]!.seg]![list[bi]!.end] = list[bj]!;
      next[list[bj]!.seg]![list[bj]!.end] = list[bi]!;
    }
    if (pairs.length === 2) {
      // four ends meeting as two lines: that is a crossing too
      const pass = (p: [number, number]): Pass[] => p.map((q) => ({ seg: list[q]!.seg, t: list[q]!.end }));
      const k = crosses.push({ a: pass(pairs[0]!), b: pass(pairs[1]!) }) - 1;
      for (const q of pairs[0]!) along[list[q]!.seg]!.push([list[q]!.end, k, "a"]);
      for (const q of pairs[1]!) along[list[q]!.seg]!.push([list[q]!.end, k, "b"]);
    }
  }
  for (const a of along) a.sort((x, y) => x[0] - y[0]);
  // 3) walk strands and alternate
  const seen = new Uint8Array(n);
  const strand = new Int32Array(n).fill(-1);
  let strands = 0;
  const walk = (start: number, from: 0 | 1) => {
    const id = strands++;
    let parity: boolean | null = null; // true = next crossing goes over
    let seg = start;
    let entry = from;
    const visitedJoint = new Set<number>();
    while (!seen[seg]) {
      seen[seg] = 1;
      strand[seg] = id;
      const list = entry === 0 ? along[seg]! : [...along[seg]!].reverse();
      for (const [, k, side] of list) {
        const c = crosses[k]!;
        // a joint crossing is listed on both segments of a pass: count it once per strand
        const joint = c.a.length > 1;
        if (joint && visitedJoint.has(k)) continue;
        if (joint) visitedJoint.add(k);
        if (c.over === undefined) {
          const over: boolean = parity ?? true;
          c.over = over ? side : side === "a" ? "b" : "a";
        }
        parity = c.over !== side; // after going over, go under next (and vice versa)
      }
      const exit = (1 - entry) as 0 | 1;
      const nx = next[seg]![exit];
      if (!nx) break;
      seg = nx.seg;
      entry = nx.end;
    }
  };
  // start from strand ends first (lines cut by the border), then closed loops
  for (let i = 0; i < n; i++) for (const e of [0, 1] as const) if (!seen[i] && !next[i]![e]) walk(i, e);
  for (let i = 0; i < n; i++) if (!seen[i]) walk(i, 0);
  for (const c of crosses) for (const p of c.over === "a" ? c.b : c.a) under[p.seg]!.push(p.t);
  return { under, strand };
}

/**
 * Woven bands: double-line strapwork where each band dips under the crossing band and rises again,
 * so the over band reads as passing on top. Heights are worked out per segment and the highest wins.
 */
function drawWoven(
  h: Float32Array, cols: number, rows: number, mmPx: number, segs: readonly Seg[], ground: number,
  half: number, shoulder: number, heightMm: number, keep?: (x: number, y: number) => boolean,
): void {
  const { under, strand } = weaveFull(segs);
  const top = new Float32Array(cols * rows).fill(-Infinity);
  const win = new Int32Array(cols * rows).fill(-1); // which strand is on top at each pixel
  const gapR = half * 1.35; // under the crossing band plus a small gap either side
  const dipR = half * 3.4; // back to full height here
  const grooveHalf = half * 0.28;
  segs.forEach((s, si) => {
    const [[ax, ay], [bx, by]] = s;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    const unders = under[si]!;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half) / mmPx) - 1);
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + half) / mmPx) + 1);
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - half) / mmPx) - 1);
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(ay, by) + half) / mmPx) + 1);
    for (let y = r0; y <= r1; y++) {
      for (let x = c0; x <= c1; x++) {
        const px = (x + 0.5) * mmPx, py = (y + 0.5) * mmPx;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (len * len)));
        const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
        if (d >= half) continue;
        const e = half - d;
        let z = heightMm * Math.sqrt(Math.max(0, 1 - Math.max(0, 1 - e / shoulder) ** 2));
        // passing under: low through the crossing and a small gap either side, then a smooth rise
        let k = 1;
        for (const u of unders) {
          const along = Math.abs(t - u) * len;
          if (along < gapR) k = Math.min(k, 0.15);
          else if (along < dipR) {
            const f = (along - gapR) / (dipR - gapR);
            k = Math.min(k, 0.15 + 0.85 * f * f * (3 - 2 * f));
          }
        }
        z *= k;
        const i = y * cols + x;
        if (z > top[i]!) {
          top[i] = z;
          win[i] = strand[si]!;
        }
      }
    }
  });
  // the double-line groove follows the band that is on top, so it runs straight through corners
  const groove = new Float32Array(cols * rows);
  segs.forEach((s, si) => {
    const [[ax, ay], [bx, by]] = s;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - grooveHalf) / mmPx) - 1);
    const c1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + grooveHalf) / mmPx) + 1);
    const r0 = Math.max(0, Math.floor((Math.min(ay, by) - grooveHalf) / mmPx) - 1);
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(ay, by) + grooveHalf) / mmPx) + 1);
    for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) {
      const i = y * cols + x;
      if (win[i] !== strand[si]) continue;
      const d = distSeg((x + 0.5) * mmPx, (y + 0.5) * mmPx, s);
      if (d < grooveHalf) groove[i] = Math.max(groove[i]!, 0.45 * (1 - d / grooveHalf));
    }
  });
  for (let i = 0; i < top.length; i++) {
    if (top[i] === -Infinity) continue;
    top[i] = top[i]! - heightMm * groove[i]! * Math.min(1, top[i]! / heightMm);
    if (keep && !keep(((i % cols) + 0.5) * mmPx, (Math.floor(i / cols) + 0.5) * mmPx)) continue;
    const z = ground + top[i]!;
    if (z > h[i]!) h[i] = z;
  }
}
