import { mergeTiles, planTiles } from "./tiles.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(planTiles(1024, 1024).length === 1, "square picture is one tile");
ok(planTiles(800, 1200).length === 1, "mild portrait is one tile");
const legPlan = planTiles(103, 1280);
ok(legPlan.length >= 8, `1:12 leg is tiled (${legPlan.length})`);
ok(legPlan.every((t) => t.w === 103 && t.h <= 155), "leg tiles are full width, ~1.5× tall");
ok(legPlan[0]!.y === 0 && legPlan.at(-1)!.y + legPlan.at(-1)!.h === 1280, "tiles cover the whole length");
for (let k = 1; k < legPlan.length; k++) ok(legPlan[k]!.y < legPlan[k - 1]!.y + legPlan[k - 1]!.h, "tiles overlap");
const strip = planTiles(1600, 300);
ok(strip.length > 1 && strip.every((t) => t.h === 300), "wide strip tiles along x");

// Fake model: true depth, but every tile comes back with its own random scale and offset.
const cols = 60;
const rows = 700;
const truth = new Float32Array(cols * rows);
for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
  const r = 20 + 8 * Math.sin(y / 40);
  const d = Math.abs(x - 30);
  truth[y * cols + x] = d < r ? Math.sqrt(r * r - d * d) / 28 + y / rows : y / rows;
}
const plan = planTiles(cols, rows);
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const parts = plan.map((t) => {
  const a = 0.5 + rnd() * 3;
  const b = rnd() * 10 - 5;
  const p = new Float32Array(t.w * t.h);
  for (let yy = 0; yy < t.h; yy++) for (let xx = 0; xx < t.w; xx++) p[yy * t.w + xx] = a * truth[(t.y + yy) * cols + t.x + xx]! + b;
  return p;
});
const merged = mergeTiles(plan, parts, cols, rows);
let mx = 0, my = 0;
for (let i = 0; i < merged.length; i++) (mx += merged[i]!, (my += truth[i]!));
mx /= merged.length;
my /= merged.length;
let sxy = 0, sxx = 0, syy = 0;
for (let i = 0; i < merged.length; i++) {
  const a = merged[i]! - mx;
  const b = truth[i]! - my;
  sxy += a * b; sxx += a * a; syy += b * b;
}
const corr = sxy / Math.sqrt(sxx * syy);
ok(corr > 0.995, `stitched depth matches truth (r = ${corr.toFixed(4)})`);

console.log(`carve tiles.check OK (${n} assertions)`);
