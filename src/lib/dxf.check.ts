import { outlineDxf } from "./dxf";

let n = 0;
function ok(cond: unknown, msg: string): void {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
}

/** Read the vertices back the way a CAD program would: (code, value) pairs. */
function parse(dxf: string) {
  const lines = dxf.split("\r\n");
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]!]);
  const verts: [number, number][] = [];
  let closed = false;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i]!;
    if (c === 0 && v === "POLYLINE") for (let j = i + 1; pairs[j]![0] !== 0; j++) if (pairs[j]![0] === 70) closed = (Number(pairs[j]![1]) & 1) === 1;
    if (c === 0 && v === "VERTEX") {
      let x = NaN, y = NaN;
      for (let j = i + 1; pairs[j]![0] !== 0; j++) {
        if (pairs[j]![0] === 10) x = Number(pairs[j]![1]);
        if (pairs[j]![0] === 20) y = Number(pairs[j]![1]);
      }
      verts.push([x, y]);
    }
  }
  return { pairs, verts, closed };
}

for (const [shape, W, H] of [["rect", 300, 120], ["arch", 300, 400], ["oval", 400, 260]] as const) {
  const d = outlineDxf(shape, W, H);
  const { pairs, verts, closed } = parse(d);
  ok(d.endsWith("0\r\nEOF\r\n") && pairs[0]![1] === "SECTION", `${shape}: well-formed DXF`);
  ok(pairs.some(([c, v]) => c === 1 && v === "AC1009"), `${shape}: R12, readable everywhere`);
  ok(closed && verts.length >= 4, `${shape}: one closed outline (${verts.length} points)`);
  ok(verts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)), `${shape}: numbers only`);
  const xs = verts.map((v) => v[0]), ys = verts.map((v) => v[1]);
  ok(Math.abs(Math.min(...xs)) < 0.01 && Math.abs(Math.max(...xs) - W) < 0.01, `${shape}: spans the full width in mm`);
  ok(Math.abs(Math.min(...ys)) < 0.01 && Math.abs(Math.max(...ys) - H) < 0.01, `${shape}: spans the full height in mm`);
  const first = verts[0]!, last = verts[verts.length - 1]!;
  ok(Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6, `${shape}: no repeated closing point`);
}
{
  // arch: the curve is at the top (Y up), the straight bottom at Y = 0
  const { verts } = parse(outlineDxf("arch", 300, 400));
  const bottom = verts.filter(([, y]) => y < 0.01);
  ok(bottom.length >= 2 && Math.min(...bottom.map((v) => v[0])) < 0.01 && Math.max(...bottom.map((v) => v[0])) > 299.99, "arch: flat bottom edge at Y = 0");
  const apex = verts.reduce((a, b) => (b[1] > a[1] ? b : a));
  ok(Math.abs(apex[0] - 150) < 1 && Math.abs(apex[1] - 400) < 0.01, "arch: apex at the top centre");
}
console.log(`carve dxf.check OK (${n} assertions)`);
