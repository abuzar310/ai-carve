import { PATTERNS, drawPattern, patternSegments } from "./pattern";
import { DEFAULT_SPEC, composePanel, layoutPanel, restoreSpec, switchTemplate, type Masks } from "./textPanel";

let n = 0;
function ok(cond: unknown, msg: string): void {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
}

const box = { x0: 20, y0: 30, x1: 420, y1: 330 };
const key = (x: number, y: number) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
for (const p of PATTERNS) {
  const segs = patternSegments(p.id, box, 3);
  ok(segs.length > 30, `${p.id}: has lines (${segs.length})`);
  ok(segs.every(([a, b]) => [a, b].every(([x, y]) => x >= box.x0 - 1e-6 && x <= box.x1 + 1e-6 && y >= box.y0 - 1e-6 && y <= box.y1 + 1e-6)), `${p.id}: clipped to the box`);
  ok(segs.every(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6), `${p.id}: no zero-length lines`);
  const ids = segs.map(([a, b]) => [key(...a), key(...b)].sort().join("|"));
  ok(new Set(ids).size === ids.length, `${p.id}: shared lines drawn once`);
  // symmetric left-right about the box centre (the design is centred)
  const cx = (box.x0 + box.x1) / 2;
  const pts = new Set(segs.flatMap(([a, b]) => [key(...a), key(...b)]));
  let miss = 0;
  for (const [a, b] of segs) for (const [x, y] of [a, b]) if (!pts.has(key(2 * cx - x, y))) miss++;
  ok(miss <= segs.length * 0.02, `${p.id}: mirror-symmetric about the centre (${miss} unmatched points)`);
  const fewer = patternSegments(p.id, box, 1.5).length;
  ok(fewer < segs.length, `${p.id}: fewer repeats, fewer lines (${fewer} < ${segs.length})`);
}

// carving: raised band, double line with a centre groove, V groove
{
  const N = 200, mm = 0.5; // 100 × 100 mm
  const seg = [[[10, 50], [90, 50]]] as const;
  const raised = new Float32Array(N * N).fill(1);
  drawPattern(raised, N, N, mm, seg as never, 1, 6, 2, "raised");
  const at = (h: Float32Array, x: number, y: number) => h[Math.floor(y / mm) * N + Math.floor(x / mm)]!;
  ok(Math.abs(at(raised, 50, 50) - 3) < 0.05 && Math.abs(at(raised, 50, 51.5) - 3) < 0.1, "raised: flat top 2 mm up");
  ok(at(raised, 50, 54) === 1, "raised: nothing beyond the band");
  const dbl = new Float32Array(N * N).fill(1);
  drawPattern(dbl, N, N, mm, seg as never, 1, 6, 2, "double");
  ok(at(dbl, 50, 50.2) < at(dbl, 50, 51.8) - 0.4, "double: a groove runs down the middle of the band");
  const gr = new Float32Array(N * N).fill(1);
  drawPattern(gr, N, N, mm, seg as never, 1, 6, 2, "groove");
  ok(at(gr, 50, 50.2) < 0 && at(gr, 50, 54) === 1, "groove: cut into the surface");
  const kept = new Float32Array(N * N).fill(1);
  drawPattern(kept, N, N, mm, seg as never, 1, 6, 2, "raised", (x) => x > 50);
  ok(at(kept, 30, 50) === 1 && at(kept, 70, 50) > 2.9, "keep(): carving only where allowed");
}

// pattern panels
{
  const spec = { ...switchTemplate(DEFAULT_SPEC, "pattern"), widthMm: 500, heightMm: 500, medallion: "circle" as const, lines: ["الله"], pattern: "star12" as const, repeats: 1 };
  ok(spec.corners === "none" && spec.header === "", "switching to a pattern panel clears header and corners");
  const lay = layoutPanel(spec);
  ok(lay.pattern && lay.medallion, "pattern and medallion laid out");
  const med = lay.medallion!;
  let near = Infinity;
  for (const [[ax, ay], [bx, by]] of lay.pattern!.segs) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((med.cx - ax) * dx + (med.cy - ay) * dy) / (dx * dx + dy * dy)));
    near = Math.min(near, Math.hypot(med.cx - ax - t * dx, med.cy - ay - t * dy));
  }
  ok(med.r + lay.pattern!.bandMm * 0.9 <= near, `the centre sits inside the middle star, no line cut (r ${med.r.toFixed(0)}, star ${near.toFixed(0)} mm)`);
  ok(med.r > 60, `a 12-point star gives a roomy centre on 500 mm (${med.r.toFixed(0)} mm)`);
  const it = lay.items[0]!;
  ok(lay.items.length === 1 && Math.hypot(it.box.x0 - med.cx, it.box.y0 - med.cy) <= med.r && Math.hypot(it.box.x1 - med.cx, it.box.y1 - med.cy) <= med.r, "text box inside the circle");
  ok(layoutPanel({ ...spec, repeats: 3 }).medallion!.r < med.r, "more repeats, smaller centre");
  ok(layoutPanel({ ...spec, medallion: "none" }).items.length === 0, "no centre: no text, even if lines were typed");
  ok(lay.pattern!.bandMm >= 3 && layoutPanel({ ...spec, widthMm: 120, heightMm: 120, repeats: 8 }).pattern!.bandMm >= 3, "bands never thinner than 3 mm");

  // relief: bands raised in the field, the centre left plain apart from its ring
  const C = 250, k = 500 / C;
  const z: Masks = { text: new Float32Array(C * C), header: new Float32Array(C * C), stars: new Float32Array(C * C) };
  const plain = { ...spec, lines: [] };
  const H = composePanel(layoutPanel(plain), z, C, C, "raised", 2).heightsMm;
  let ring = 0, inside = 0, band = 0;
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const d = Math.hypot((x + 0.5) * k - med.cx, (y + 0.5) * k - med.cy);
      const v = H[y * C + x]!;
      if (d < med.r * 0.8 && v > 1.2) inside++;
      if (Math.abs(d - med.r) < 1.5 && v > 1.5) ring++;
      if (d > med.r * 1.3 && d < med.r * 2 && v > 2.5) band++;
    }
  ok(inside === 0, "nothing carved inside the centre (text goes there)");
  ok(ring > 20 && band > 100, `ring around the centre (${ring}) and pattern bands outside (${band})`);
}

// saved work and bad values
{
  const r = restoreSpec(JSON.stringify({ template: "pattern", pattern: "star6", repeats: 4.5, band: "groove", medallion: "circle" }));
  ok(r.template === "pattern" && r.pattern === "star6" && r.repeats === 4.5 && r.band === "groove" && r.medallion === "circle", "pattern settings survive a refresh");
  const bad = restoreSpec(JSON.stringify({ template: "pattern", pattern: "spiral", repeats: 99, band: "gold", medallion: "heart" }));
  ok(bad.pattern === DEFAULT_SPEC.pattern && bad.repeats === 12 && bad.band === DEFAULT_SPEC.band && bad.medallion === "none", "unknown pattern values fall back, repeats clamped");
}

// ---- weaving: over and under
{
  const { weave, patternSegments, PATTERNS } = await import("./pattern");
  // two lines crossing once: one goes under
  const x = weave([[[0, 0], [10, 10]], [[0, 10], [10, 0]]]);
  ok(x[0]!.length + x[1]!.length === 1, "two crossing lines: exactly one passes under");
  // a 3 × 3 grid of long lines: every line alternates over, under, over
  const grid: [[number, number], [number, number]][] = [];
  for (const k of [2, 5, 8]) grid.push([[0, k], [10, k]], [[k, 0], [k, 10]]);
  const g = weave(grid);
  ok(g.reduce((s, u) => s + u.length, 0) === 9, "grid: each of the 9 crossings has one band under");
  const pattern = (i: number) => {
    const ts = [2, 5, 8].map((v) => v / 10);
    return ts.map((t) => (g[i]!.some((u) => Math.abs(u - t) < 1e-9) ? "U" : "O")).join("");
  };
  ok(grid.every((_, i) => ["OUO", "UOU"].includes(pattern(i))), `grid: every line alternates (${grid.map((_, i) => pattern(i)).join(" ")})`);
  // real patterns: every crossing decided once (one under per crossing), mostly alternating
  for (const p of PATTERNS) {
    const segs = patternSegments(p.id, { x0: 0, y0: 0, x1: 300, y1: 300 }, 3);
    const u = weave(segs);
    ok(u.every((list) => list.every((t) => t >= 0 && t <= 1)), `${p.id}: under positions on the segments`);
    // each interior crossing (mid-segment) must have exactly one under side
    let crossings = 0, decided = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [[ax, ay], [bx, by]] = segs[i]!, [[cx, cy], [dx, dy]] = segs[j]!;
      const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((cx - ax) * sy - (cy - ay) * sx) / den, w = ((cx - ax) * ry - (cy - ay) * rx) / den;
      if (t <= 1e-6 || t >= 1 - 1e-6 || w <= 1e-6 || w >= 1 - 1e-6) continue;
      crossings++;
      const ui = u[i]!.some((v) => Math.abs(v - t) < 1e-9), uj = u[j]!.some((v) => Math.abs(v - w) < 1e-9);
      if (ui !== uj) decided++;
    }
    ok(crossings === 0 || decided === crossings, `${p.id}: all ${crossings} crossings have exactly one band under (${decided})`);
    ok(u.some((l) => l.length > 0), `${p.id}: something passes under`);
  }
  console.log("carve pattern.check weave OK");
}

ok(restoreSpec(JSON.stringify({ template: "pattern", band: "woven" })).band === "woven", "woven bands survive a refresh");
{
  // woven carving: crossings show a clear over and under (one band low, the other full height)
  const { drawPattern } = await import("./pattern");
  const N = 200, mm = 0.5;
  const h = new Float32Array(N * N).fill(1);
  drawPattern(h, N, N, mm, [[[10, 50], [90, 50]], [[50, 10], [50, 90]]], 1, 6, 2, "woven");
  const at = (x: number, y: number) => h[Math.floor(y / mm) * N + Math.floor(x / mm)]!;
  const armH = at(50, 50 - 5), armV = at(50 - 5, 50); // just beside the crossing on each band
  ok(Math.abs(armH - armV) > 1, `one band dips beside the crossing (${armH.toFixed(2)} vs ${armV.toFixed(2)})`);
  let peak = 0;
  for (let y = 47; y <= 53; y += 0.5) for (let x = 47; x <= 53; x += 0.5) peak = Math.max(peak, at(x, y));
  ok(peak > 2.8, `the over band keeps its full height across the crossing (${peak.toFixed(2)})`);
  ok(Math.abs(at(20, 50) - at(50, 20)) < 0.05, "away from crossings both bands are the same height");
}
console.log(`carve pattern.check OK (${n} assertions)`);
