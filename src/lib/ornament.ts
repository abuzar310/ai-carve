/**
 * Carved ornaments, drawn as exact shapes in millimetres (no pictures, no AI): domed petals,
 * leaves with V-cut veins, round vine stems and spiral curls. Pure code, so it runs in `pnpm check`
 * and stays sharp at any panel size.
 *
 * A corner ornament is designed once in a unit "pocket" (corner at 0,0; the pocket is the quarter
 * disc u² + v² < 1) and mirrored into each corner. All designs here are original to AI Carve.
 */
import { distanceInside } from "./textPanel";

export type Pt = readonly [number, number];
/** A corner pocket: the corner point, which way the pocket opens (±1, ±1), and its radius in mm. */
export type Pocket = { cx: number; cy: number; sx: 1 | -1; sy: 1 | -1; r: number };
export type CornerDesign = "flowers";

type Dome = { kind: "dome"; poly: Pt[]; base: number; height: number; round: number; grooves?: Pt[][]; grooveW?: number };
type Tube = { kind: "tube"; path: Pt[]; base: number; height: number; width: number };
export type Part = Dome | Tube;

// ---------------------------------------------------------------- geometry helpers (unit space)

const TAU = Math.PI * 2;
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const rot = (a: Pt, t: number): Pt => [a[0] * Math.cos(t) - a[1] * Math.sin(t), a[0] * Math.sin(t) + a[1] * Math.cos(t)];

/** Quadratic Bézier sampled into `n` points. */
function quad(a: Pt, c: Pt, b: Pt, n = 24): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** A leaf / petal along a curved spine: width follows sin(πt)^p, slightly fuller near the base. */
function leaf(spine: Pt[], width: number, p = 0.75, bias = 0.35): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = spine.length - 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = spine[Math.max(0, i - 1)]!;
    const b = spine[Math.min(n, i + 1)]!;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    // peak width a little before the middle, like a real leaf
    const tt = Math.pow(t, 1 - bias * 0.5);
    const w = (width / 2) * Math.pow(Math.sin(Math.PI * tt), p);
    const s = spine[i]!;
    left.push([s[0] - dy * w, s[1] + dx * w]);
    right.push([s[0] + dy * w, s[1] - dx * w]);
  }
  return [...left, ...right.reverse()];
}

/** Side veins of a leaf: short strokes from the spine towards the edges, pointing to the tip. */
function veins(spine: Pt[], width: number, pairs: number): Pt[][] {
  const out: Pt[][] = [];
  const n = spine.length - 1;
  for (let k = 1; k <= pairs; k++) {
    const i = Math.round((n * (k + 0.3)) / (pairs + 1.6));
    const s = spine[i]!;
    const a = spine[Math.max(0, i - 1)]!;
    const b = spine[Math.min(n, i + 1)]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const d: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const reach = width * 0.36 * Math.sin((Math.PI * i) / n);
    for (const side of [1, -1]) {
      const nrm: Pt = [-d[1] * side, d[0] * side];
      out.push([s, add(s, add(scale(nrm, reach), scale(d, reach * 0.8)))]);
    }
  }
  return out;
}

/** A spiral curl ending a vine: starts at `p` heading `dir` (radians), turns `turns` times inward. */
function curl(p: Pt, dir: number, r0: number, turns: number, sense: 1 | -1, n = 60): Pt[] {
  const out: Pt[] = [];
  // centre of the first turn sits to the side of the heading
  const c = add(p, rot([0, sense * r0], dir));
  const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + sense * turns * TAU * t;
    const r = r0 * (1 - 0.72 * t);
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

// ---------------------------------------------------------------- designs

/**
 * "Flower spray": a six-petal rosette near the corner, two veined leaves running along the two
 * edges, vine stems that end in curls at the pocket's ends, a bud on the diagonal and two berries.
 * Symmetric about the diagonal, so it reads the same in every corner. Heights are in units of `h`.
 */
function flowerSpray(): { parts: Array<Omit<Dome, "base" | "height"> & { z: number; hz: number } | Omit<Tube, "base" | "height" | "width"> & { z: number; hz: number; w: number }> } {
  const parts: ReturnType<typeof flowerSpray>["parts"] = [];
  const F: Pt = [0.3, 0.3];
  const half = (draw: (m: (q: Pt) => Pt) => void) => {
    draw((q) => q);
    draw((q) => [q[1], q[0]]); // mirror on the diagonal
  };

  // vines first (lowest), so leaves and petals sit on top of them
  half((m) => {
    const stem = quad(m([0.36, 0.2]), m([0.52, 0.06]), m([0.74, 0.08]), 28);
    const end = stem[stem.length - 1]!;
    const prev = stem[stem.length - 2]!;
    const dir = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
    const sense: 1 | -1 = m([1, 0])[0] === 1 ? 1 : -1;
    const tail = curl(end, dir, 0.075, 1.15, sense);
    parts.push({ kind: "tube", path: [...stem, ...tail.slice(1)], z: 0, hz: 0.42, w: 0.03 });
    // a small tendril curl off the stem
    const s = stem[12]!;
    const t2 = quad(s, add(s, m([0.04, 0.09])), add(s, m([0.1, 0.12])), 10);
    const e2 = t2[t2.length - 1]!;
    const p2 = t2[t2.length - 2]!;
    parts.push({ kind: "tube", path: [...t2, ...curl(e2, Math.atan2(e2[1] - p2[1], e2[0] - p2[0]), 0.035, 1.0, (sense * -1) as 1 | -1, 30).slice(1)], z: 0, hz: 0.3, w: 0.02 });
  });

  // big leaves along each edge
  half((m) => {
    const spine = quad(m([0.36, 0.36]), m([0.6, 0.52]), m([0.8, 0.34]), 32);
    parts.push({ kind: "dome", poly: leaf(spine, 0.2), z: 0.1, hz: 0.75, round: 0.065, grooves: [spine.slice(2, -3), ...veins(spine, 0.2, 4)], grooveW: 0.014 });
  });

  // bud on the diagonal, and berries
  {
    const spine = quad([0.42, 0.42], [0.53, 0.53], [0.63, 0.63], 20);
    parts.push({ kind: "dome", poly: leaf(spine, 0.11, 0.6, 0.1), z: 0.1, hz: 0.7, round: 0.045, grooves: [spine.slice(3, -4)], grooveW: 0.012 });
  }
  half((m) => {
    const c = m([0.58, 0.16]);
    const ring: Pt[] = Array.from({ length: 20 }, (_, i) => add(c, rot([0.028, 0], (i / 20) * TAU)));
    parts.push({ kind: "dome", poly: ring, z: 0.05, hz: 0.55, round: 0.028 });
  });

  // rosette: six petals, each with a centre vein, then a boss
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + Math.PI / 4 + Math.PI / 6;
    const tip = add(F, rot([0.215, 0], a));
    const ctl = add(F, rot([0.1, 0], a));
    const spine = quad(add(F, rot([0.025, 0], a)), ctl, tip, 20);
    parts.push({ kind: "dome", poly: leaf(spine, 0.13, 0.55, 0.25), z: 0.25, hz: 0.8, round: 0.05, grooves: [spine.slice(4, -4)], grooveW: 0.011 });
  }
  const boss: Pt[] = Array.from({ length: 24 }, (_, i) => add(F, rot([0.05, 0], (i / 24) * TAU)));
  parts.push({ kind: "dome", poly: boss, z: 0.6, hz: 0.55, round: 0.05 });
  return { parts };
}

/** Parts for one pocket in millimetres; `h` is the tallest ornament height above the field. */
export function cornerParts(design: CornerDesign, pocket: Pocket, h: number): Part[] {
  const { parts } = flowerSpray();
  void design;
  const R = pocket.r;
  const map = (q: Pt): Pt => [pocket.cx + pocket.sx * q[0] * R, pocket.cy + pocket.sy * q[1] * R];
  return parts.map((p) =>
    p.kind === "tube"
      ? { kind: "tube", path: p.path.map(map), base: p.z * h, height: p.hz * h, width: p.w * R }
      : {
          kind: "dome",
          poly: p.poly.map(map),
          base: p.z * h,
          height: p.hz * h,
          round: p.round * R,
          grooves: p.grooves?.map((g) => g.map(map)),
          grooveW: (p.grooveW ?? 0) * R,
        },
  );
}

/** The quarter-circle line that closes a pocket (from one edge to the other). */
export function pocketArc(pocket: Pocket, n = 48): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * (Math.PI / 2);
    return [pocket.cx + pocket.sx * pocket.r * Math.cos(a), pocket.cy + pocket.sy * pocket.r * Math.sin(a)] as Pt;
  });
}

// ---------------------------------------------------------------- rasterising onto a height field

function pointInPoly(x: number, y: number, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPath(x: number, y: number, path: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]!;
    const [bx, by] = path[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < best) best = d;
  }
  return best;
}

function bbox(pts: readonly Pt[], pad: number, mmPx: number, cols: number, rows: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return {
    c0: Math.max(0, Math.floor((x0 - pad) / mmPx)),
    r0: Math.max(0, Math.floor((y0 - pad) / mmPx)),
    c1: Math.min(cols - 1, Math.ceil((x1 + pad) / mmPx)),
    r1: Math.min(rows - 1, Math.ceil((y1 + pad) / mmPx)),
  };
}

/** A raised round line (bead, vine) along `path`, `width` mm wide, `height` mm tall above `ground`. */
export function drawTube(h: Float32Array, cols: number, rows: number, mmPx: number, path: readonly Pt[], ground: number, height: number, width: number): void {
  const r = Math.max(width / 2, mmPx * 0.75);
  const b = bbox(path, r + mmPx, mmPx, cols, rows);
  for (let y = b.r0; y <= b.r1; y++) {
    for (let x = b.c0; x <= b.c1; x++) {
      const d = distToPath((x + 0.5) * mmPx, (y + 0.5) * mmPx, path);
      if (d >= r) continue;
      const z = ground + height * Math.sqrt(1 - (d / r) ** 2);
      const i = y * cols + x;
      if (z > h[i]!) h[i] = z;
    }
  }
}

/**
 * Draw parts onto `h` (heights in mm). Each part stands on `ground` plus its own base, and the
 * higher surface wins, so petals sit on leaves and leaves on vines.
 */
export function drawParts(h: Float32Array, cols: number, rows: number, mmPx: number, parts: readonly Part[], ground: number): void {
  for (const p of parts) {
    if (p.kind === "tube") {
      drawTube(h, cols, rows, mmPx, p.path, ground + p.base, p.height, p.width);
      continue;
    }
    const b = bbox(p.poly, mmPx * 2, mmPx, cols, rows);
    const w = b.c1 - b.c0 + 1;
    const ht = b.r1 - b.r0 + 1;
    if (w <= 0 || ht <= 0) continue;
    const m = new Uint8Array(w * ht);
    for (let y = 0; y < ht; y++)
      for (let x = 0; x < w; x++) m[y * w + x] = pointInPoly((b.c0 + x + 0.5) * mmPx, (b.r0 + y + 0.5) * mmPx, p.poly) ? 1 : 0;
    const dt = distanceInside(m, w, ht);
    const round = Math.max(p.round, mmPx * 1.2);
    const gw = Math.max(p.grooveW ?? 0, mmPx * 1.2);
    for (let y = 0; y < ht; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (!m[k]) continue;
        const u = Math.min(1, (dt[k]! * mmPx) / round);
        let z = ground + p.base + p.height * Math.sqrt(Math.max(0, 1 - (1 - u) ** 2));
        if (p.grooves) {
          const px = (b.c0 + x + 0.5) * mmPx;
          const py = (b.r0 + y + 0.5) * mmPx;
          let d = Infinity;
          for (const g of p.grooves) d = Math.min(d, distToPath(px, py, g));
          // V-cut vein, never deeper than ⅓ of the part
          if (d < gw / 2) z -= Math.min(p.height * 0.33, gw * 0.9) * (1 - (2 * d) / gw);
        }
        const i = (b.r0 + y) * cols + (b.c0 + x);
        if (z > h[i]!) h[i] = z;
      }
    }
  }
}
