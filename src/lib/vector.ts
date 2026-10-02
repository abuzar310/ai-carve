/**
 * Vectors for CAM: closed outlines of the typeset letters (for V-carve / profile toolpaths in
 * ArtCAM, Aspire, VCarve, Fusion), the centre lines of pattern bands, and the panel's cut outline.
 *
 * Letters are traced from the same anti-aliased typesetting the relief uses (marching squares with
 * sub-pixel edges), then simplified. Pure code: runs in `pnpm check`.
 */
export type Pt = readonly [number, number];

/**
 * Closed contours where `mask` crosses `t` (0..1 coverage), in pixel units (x right, y down; a
 * pixel's centre is at +0.5). Holes come out as their own loops; nesting is left to the CAM program.
 */
export function traceContours(mask: Float32Array, cols: number, rows: number, t = 0.5): Pt[][] {
  // pad with an empty border so every contour closes
  const W = cols + 2;
  const H = rows + 2;
  const v = (x: number, y: number) => (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1 ? 0 : (mask[(y - 1) * cols + (x - 1)] ?? 0));
  // edge points are keyed by the grid edge they sit on: horizontal edge (x,y)-(x+1,y) or vertical (x,y)-(x,y+1)
  const pos = new Map<number, Pt>();
  const nbr = new Map<number, number[]>();
  const hKey = (x: number, y: number) => (y * W + x) * 2;
  const vKey = (x: number, y: number) => (y * W + x) * 2 + 1;
  const point = (key: number, x0: number, y0: number, x1: number, y1: number, a: number, b: number) => {
    if (!pos.has(key)) {
      const f = Math.abs(b - a) < 1e-9 ? 0.5 : (t - a) / (b - a);
      // grid node (x, y) is the centre of padded pixel (x, y) → original pixel coords x - 1 + 0.5
      pos.set(key, [x0 + (x1 - x0) * f - 0.5, y0 + (y1 - y0) * f - 0.5]);
    }
    return key;
  };
  const link = (a: number, b: number) => {
    (nbr.get(a) ?? nbr.set(a, []).get(a)!).push(b);
    (nbr.get(b) ?? nbr.set(b, []).get(b)!).push(a);
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = v(x, y); // top-left
      const b = v(x + 1, y); // top-right
      const c = v(x + 1, y + 1); // bottom-right
      const d = v(x, y + 1); // bottom-left
      const code = (a >= t ? 8 : 0) | (b >= t ? 4 : 0) | (c >= t ? 2 : 0) | (d >= t ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => point(hKey(x, y), x, y, x + 1, y, a, b);
      const right = () => point(vKey(x + 1, y), x + 1, y, x + 1, y + 1, b, c);
      const bottom = () => point(hKey(x, y + 1), x, y + 1, x + 1, y + 1, d, c);
      const left = () => point(vKey(x, y), x, y, x, y + 1, a, d);
      switch (code) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5: case 10: {
          // saddle: decide by the centre value
          const centre = (a + b + c + d) / 4 >= t;
          if ((code === 5) === centre) { link(left(), top()); link(bottom(), right()); }
          else { link(left(), bottom()); link(top(), right()); }
          break;
        }
      }
    }
  }
  // walk the links into loops
  const loops: Pt[][] = [];
  const used = new Set<number>();
  for (const start of nbr.keys()) {
    if (used.has(start)) continue;
    const loop: Pt[] = [];
    let prev = -1;
    let cur = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      loop.push(pos.get(cur)!);
      const n = nbr.get(cur)!;
      const next = n[0] !== prev ? n[0]! : n[1]!;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Signed area (pixel² or mm²) of a closed loop; the sign tells the winding. */
export function loopArea(loop: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x0, y0] = loop[i]!;
    const [x1, y1] = loop[(i + 1) % loop.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

function dp(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 3) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[j]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1e-12;
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = pts[k]!;
      const d = Math.abs((px - ax) * dy - (py - ay) * dx) / l;
      if (d > worst) (worst = d), (at = k);
    }
    if (worst > tol && at > 0) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** Douglas–Peucker for a closed loop: split at the point farthest from the first, simplify both halves. */
export function simplifyLoop(loop: readonly Pt[], tol: number): Pt[] {
  if (loop.length < 8) return [...loop];
  const [x0, y0] = loop[0]!;
  let far = 0;
  let best = -1;
  loop.forEach(([x, y], k) => {
    const d = (x - x0) ** 2 + (y - y0) ** 2;
    if (d > best) (best = d), (far = k);
  });
  const a = dp(loop.slice(0, far + 1), tol);
  const b = dp([...loop.slice(far), loop[0]!], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : [...loop];
}

/** Letter outlines in mm from a coverage mask of a `widthMm` wide panel. */
export function letterOutlines(mask: Float32Array, cols: number, rows: number, widthMm: number, tolMm = 0.02): Pt[][] {
  const k = widthMm / cols;
  return traceContours(mask, cols, rows)
    .filter((l) => Math.abs(loopArea(l)) * k * k >= 0.02) // drop specks below 0.02 mm²
    .map((l) => simplifyLoop(l.map(([x, y]) => [x * k, y * k] as Pt), tolMm));
}

// ---------------------------------------------------------------- files

export type VectorLayer = { name: string; color: number; closed: boolean; paths: readonly (readonly Pt[])[] };

const num = (v: number) => (Math.abs(v) < 5e-7 ? "0" : v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));

/** AutoCAD R12 DXF in mm, Y up with (0, 0) at the panel's bottom-left (like the relief files). */
export function vectorsDxf(layers: readonly VectorLayer[], widthMm: number, heightMm: number): string {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$INSUNITS"); g(70, 4);
  g(9, "$EXTMIN"); g(10, 0); g(20, 0);
  g(9, "$EXTMAX"); g(10, num(widthMm)); g(20, num(heightMm));
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES"); g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length);
  for (const l of layers) { g(0, "LAYER"); g(2, l.name); g(70, 0); g(62, l.color); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  for (const l of layers) {
    for (const p of l.paths) {
      if (p.length < 2) continue;
      g(0, "POLYLINE"); g(8, l.name); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, l.closed ? 1 : 0);
      for (const [x, y] of p) { g(0, "VERTEX"); g(8, l.name); g(10, num(x)); g(20, num(heightMm - y)); g(30, 0); }
      g(0, "SEQEND"); g(8, l.name);
    }
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

/** SVG in mm (1 user unit = 1 mm); letters filled even-odd so holes stay open. */
export function vectorsSvg(layers: readonly VectorLayer[], widthMm: number, heightMm: number): string {
  const colors: Record<number, string> = { 1: "#d62020", 5: "#1f4fd6", 7: "#000000", 3: "#1a9a3a" };
  const body = layers
    .map((l) => {
      const d = l.paths.map((p) => "M" + p.map(([x, y]) => `${num(x)} ${num(y)}`).join("L") + (l.closed ? "Z" : "")).join("");
      const c = colors[l.color] ?? "#000";
      return l.closed && l.name === "LETTERS"
        ? `<g id="${l.name}"><path d="${d}" fill="${c}" fill-rule="evenodd" stroke="none"/></g>`
        : `<g id="${l.name}"><path d="${d}" fill="none" stroke="${c}" stroke-width="0.25"/></g>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${num(widthMm)}mm" height="${num(heightMm)}mm" viewBox="0 0 ${num(widthMm)} ${num(heightMm)}">\n${body}\n</svg>\n`;
}

// ---------------------------------------------------------------- bitmap tracing (sketch / logo → vectors)

export type TraceOptions = {
  /** 0..1 brightness below which a pixel counts as ink */
  threshold: number;
  /** trace light lines on a dark background instead */
  invert: boolean;
  widthMm: number;
  /** drop shapes smaller than this, mm² (pen specks, paper grain) */
  minAreaMm2: number;
  /** simplification tolerance, mm */
  tolMm?: number;
};

/**
 * Outlines of the ink in a picture, in mm. `lum` is brightness 0..1 per pixel. A soft ramp around the
 * threshold keeps edges sub-pixel accurate instead of stair-stepped.
 */
export function traceBitmap(lum: Float32Array, cols: number, rows: number, o: TraceOptions): Pt[][] {
  const soft = 0.06;
  const ink = new Float32Array(lum.length);
  for (let i = 0; i < lum.length; i++) {
    const v = o.invert ? 1 - (lum[i] ?? 0) : lum[i] ?? 0;
    ink[i] = Math.max(0, Math.min(1, (o.threshold - v) / soft + 0.5));
  }
  const k = o.widthMm / cols;
  return traceContours(ink, cols, rows)
    .filter((l) => Math.abs(loopArea(l)) * k * k >= o.minAreaMm2)
    .map((l) => simplifyLoop(l.map(([x, y]) => [x * k, y * k] as Pt), o.tolMm ?? Math.max(0.02, k * 0.25)));
}
