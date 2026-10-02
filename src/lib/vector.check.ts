import { letterOutlines, loopArea, simplifyLoop, traceContours, vectorsDxf, vectorsSvg } from "./vector";

let n = 0;
function ok(cond: unknown, msg: string): void {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
}

/** Anti-aliased disc / ring coverage, like the canvas typesetting gives. */
function disc(C: number, cx: number, cy: number, r: number, hole = 0): Float32Array {
  const m = new Float32Array(C * C);
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const outer = Math.max(0, Math.min(1, r - d + 0.5));
      const inner = hole ? Math.max(0, Math.min(1, hole - d + 0.5)) : 0;
      m[y * C + x] = Math.max(m[y * C + x]!, outer - inner);
    }
  return m;
}

// a disc: one loop, the true area, the true centre
{
  const loops = traceContours(disc(120, 60, 60, 40), 120, 120);
  ok(loops.length === 1, `disc: one outline (${loops.length})`);
  const a = Math.abs(loopArea(loops[0]!));
  ok(Math.abs(a - Math.PI * 40 * 40) / (Math.PI * 1600) < 0.01, `disc: area within 1 % (${a.toFixed(0)} vs ${(Math.PI * 1600).toFixed(0)})`);
  const cx = loops[0]!.reduce((s, p) => s + p[0], 0) / loops[0]!.length;
  ok(Math.abs(cx - 60) < 0.2, `disc: outline centred (${cx.toFixed(2)})`);
  const r = loops[0]!.map(([x, y]) => Math.hypot(x - 60, y - 60));
  ok(Math.max(...r) - Math.min(...r) < 0.25, "disc: sub-pixel round edge (no staircase)");
}
// a ring (like the hole in و or ه): outer and inner outline
{
  const loops = traceContours(disc(120, 60, 60, 40, 20), 120, 120);
  ok(loops.length === 2, `ring: outer and hole (${loops.length})`);
  const areas = loops.map((l) => Math.abs(loopArea(l))).sort((a, b) => a - b);
  ok(Math.abs(areas[0]! - Math.PI * 400) / (Math.PI * 400) < 0.03, "ring: hole has the right size");
}
// separate blobs, touching the edge of the image, and nothing
{
  const m = disc(100, 25, 50, 15);
  const m2 = disc(100, 75, 50, 15);
  for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i]!, m2[i]!);
  ok(traceContours(m, 100, 100).length === 2, "two letters, two outlines");
  ok(traceContours(disc(60, 0, 30, 20), 60, 60).length === 1, "a shape cut by the image edge still closes");
  ok(traceContours(new Float32Array(400), 20, 20).length === 0, "empty mask, no outlines");
  const full = new Float32Array(400).fill(1);
  ok(traceContours(full, 20, 20).length === 1, "full mask: one outline round the edge");
}
// simplifying keeps the shape, drops most points
{
  const loop = traceContours(disc(400, 200, 200, 150), 400, 400)[0]!;
  const s = simplifyLoop(loop, 0.1);
  ok(s.length < loop.length / 3, `simplified: ${loop.length} → ${s.length} points`);
  ok(Math.abs(Math.abs(loopArea(s)) - Math.abs(loopArea(loop))) / Math.abs(loopArea(loop)) < 0.002, "simplified area within 0.2 %");
}
// mm outlines from a panel mask, and the files
{
  const C = 200;
  const mm = letterOutlines(disc(C, 100, 100, 50), C, C, 100); // 100 mm panel, 0.5 mm pixels
  ok(mm.length === 1, "mm outline");
  const a = Math.abs(loopArea(mm[0]!));
  ok(Math.abs(a - Math.PI * 25 * 25) / (Math.PI * 625) < 0.01, `outline in mm (${a.toFixed(0)} mm²)`);
  const xs = mm[0]!.map((p) => p[0]);
  ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 50) < 0.15, "mm outline centred on the panel");
  const speck = new Float32Array(C * C);
  speck[50 * C + 50] = 0.6;
  ok(letterOutlines(speck, C, C, 100).length === 0, "single-pixel specks are dropped");

  const layers = [
    { name: "LETTERS", color: 7, closed: true, paths: mm },
    { name: "PATTERN", color: 5, closed: false, paths: [[[10, 10], [90, 10]] as [number, number][]] },
    { name: "CUT_OUTLINE", color: 1, closed: true, paths: [[[0, 0], [100, 0], [100, 80], [0, 80]] as [number, number][]] },
  ];
  const dxf = vectorsDxf(layers, 100, 80);
  ok(dxf.startsWith("0\r\nSECTION") && dxf.trimEnd().endsWith("EOF"), "DXF: complete file");
  ok((dxf.match(/\r\nPOLYLINE\r\n/g) ?? []).length === 3, "DXF: one polyline per path");
  ok((dxf.match(/\r\nSEQEND\r\n/g) ?? []).length === 3, "DXF: every polyline ended");
  ok(/\r\nLAYER\r\n2\r\nLETTERS\r\n/.test(dxf) && /\r\nLAYER\r\n2\r\nPATTERN\r\n/.test(dxf), "DXF: named layers");
  // the pattern line at y = 10 mm from the top sits at Y = 70 in DXF (Y up)
  ok(/8\r\nPATTERN\r\n10\r\n10\r\n20\r\n70\r\n/.test(dxf), "DXF: Y points up from the bottom-left corner");
  ok(!/NaN|Infinity/.test(dxf), "DXF: no NaN");
  const svg = vectorsSvg(layers, 100, 80);
  ok(svg.includes('width="100mm"') && svg.includes('viewBox="0 0 100 80"'), "SVG: real size in mm");
  ok(svg.includes('fill-rule="evenodd"') && svg.includes('id="CUT_OUTLINE"'), "SVG: letters filled even-odd, layers as groups");
}
console.log(`carve vector.check OK (${n} assertions)`);
