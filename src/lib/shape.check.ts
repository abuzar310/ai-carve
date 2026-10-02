import { archRise, contentBox, insideShape, shapeContour } from "./shape";
import { DEFAULT_SPEC, composePanel, layoutPanel, restoreSpec, type Masks } from "./textPanel";

let n = 0;
function ok(cond: unknown, msg: string): void {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
}

for (const [shape, W, H] of [["arch", 300, 400], ["arch", 400, 200], ["oval", 400, 280], ["oval", 300, 300]] as const) {
  const ins = 20;
  const c = contentBox(shape, W, H, ins);
  for (const [x, y] of [[c.x0, c.y0], [c.x1, c.y0], [c.x0, c.y1], [c.x1, c.y1]] as const)
    ok(insideShape(shape, W, H, x, y, ins - 1e-6), `${shape} ${W}×${H}: text box corner (${x.toFixed(0)}, ${y.toFixed(0)}) inside the bead`);
  ok((c.x1 - c.x0) * (c.y1 - c.y0) > 0.35 * (W - 2 * ins) * (H - 2 * ins), `${shape} ${W}×${H}: text box is roomy`);
  const path = shapeContour(shape, W, H, ins);
  const [a, b] = [path[0]!, path[path.length - 1]!];
  ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9, `${shape}: bead path is closed`);
  ok(path.every(([x, y]) => x >= ins - 1e-6 && x <= W - ins + 1e-6 && y >= ins - 1e-6 && y <= H - ins + 1e-6), `${shape}: bead stays inside by the inset`);
  ok(!insideShape(shape, W, H, 1, 1) && !insideShape(shape, W, H, W - 1, 1), `${shape}: top corners are cut away`);
  ok(insideShape(shape, W, H, W / 2, H / 2), `${shape}: centre inside`);
}
ok(archRise(300, 400) === 150 && archRise(400, 200) === 90, "arch is a half circle when there is room, flatter on wide panels");
ok(insideShape("arch", 300, 400, 2, 398), "arch keeps its bottom corners");

// layouts: every text box sits inside the shape's bead, plates and pattern centres
for (const shape of ["arch", "oval"] as const) {
  for (const lines of [["محمد"], ["بسم الله", "Mohammed Abuzar", "2026"]]) {
    const spec = { ...DEFAULT_SPEC, template: "plate" as const, shape, widthMm: 300, heightMm: shape === "arch" ? 400 : 220, lines, header: shape === "arch" ? "بسم الله" : "", corners: "flowers" as const };
    const lay = layoutPanel(spec);
    ok(lay.shape?.kind === shape && lay.beads.length === 0, `${shape} plate: shaped, no square beads`);
    for (const it of lay.items) for (const [x, y] of [[it.box.x0, it.box.y0], [it.box.x1, it.box.y0], [it.box.x0, it.box.y1], [it.box.x1, it.box.y1]] as const)
      ok(insideShape(shape, spec.widthMm, spec.heightMm, x, y, lay.shape!.inset - 1e-6), `${shape} plate: "${it.text}" inside the outline`);
    if (shape === "oval") ok(lay.pockets.length === 0, "oval: no corner flowers (it has no corners)");
    else ok(lay.pockets.length === 2 && lay.pockets.every((p) => p.sy === -1), "arch: flowers in the two bottom corners only");
  }
}
ok(layoutPanel({ ...DEFAULT_SPEC, shape: "oval" }).shape === undefined, "the 99 Names board stays rectangular");

// relief: outside cut to 0, frame all round (also where the outline touches the top edge)
{
  const C = 300, W = 300, H = 300, k = W / C;
  const lay = layoutPanel({ ...DEFAULT_SPEC, template: "plate", shape: "oval", widthMm: W, heightMm: H, lines: [], header: "", corners: "none" });
  const z: Masks = { text: new Float32Array(C * C), header: new Float32Array(C * C), stars: new Float32Array(C * C) };
  const h = composePanel(lay, z, C, C, "raised", 1.8).heightsMm;
  const at = (x: number, y: number) => h[Math.floor(y / k) * C + Math.floor(x / k)]!;
  ok(at(3, 3) < 0.2 && at(W - 3, H - 3) < 0.2, "corners outside the oval are cut away");
  const fm = lay.frameMm;
  ok(at(W / 2, fm * 0.35) > 2 && at(fm * 0.35, H / 2) > 2 && at(W / 2, H - fm * 0.35) > 2, "frame moulding runs all round, also at the top centre");
  ok(at(W / 2, H / 2) > 0.9 && at(W / 2, H / 2) < 1.1, "field inside");
}
ok(restoreSpec(JSON.stringify({ shape: "arch" })).shape === "arch" && restoreSpec(JSON.stringify({ shape: "star" })).shape === "rect", "shape survives a refresh; unknown → rectangle");

console.log(`carve shape.check OK (${n} assertions)`);
