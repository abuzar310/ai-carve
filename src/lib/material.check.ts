import { MATERIALS, materialColors } from "./material";

let n = 0;
function ok(cond: unknown, msg: string): void {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
}
// a 100 × 100 mm flat top (z = 3) and a lower ring (z = 1)
const N = 60;
const pos: number[] = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pos.push((i / (N - 1)) * 100, (j / (N - 1)) * 100, Math.hypot(i - 30, j - 30) < 12 ? 1 : 3);
const count = N * N;
const avg = (c: Float32Array) => { let s = 0; for (let i = 0; i < c.length; i++) s += c[i]!; return s / c.length; };
const spread = (c: Float32Array) => { let lo = 9, hi = -9; for (let i = 0; i < c.length; i += 3) { const v = c[i]! + c[i + 1]! + c[i + 2]!; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
const of: Record<string, Float32Array> = {};
for (const m of MATERIALS) {
  if (m.id === "classic") continue;
  const c = materialColors(pos, count, count, 1, 2, m.id);
  of[m.id] = c;
  ok(c.length === count * 3 && c.every((v) => v >= 0 && v <= 1 && Number.isFinite(v)), `${m.id}: one colour per vertex, in 0..1`);
  ok(spread(c) > 0.08, `${m.id}: has visible variation (grain, veins or depth)`);
  ok(m.roughness >= 0 && m.roughness <= 1 && m.metalness >= 0 && m.metalness <= 1, `${m.id}: valid surface finish`);
}
ok(avg(of.marble!) > avg(of.teak!) && avg(of.teak!) > avg(of.walnut!), "marble lighter than teak, teak lighter than walnut");
const c = of.teak!;
const at = (i: number, j: number) => { const k = (j * N + i) * 3; return c[k]! + c[k + 1]! + c[k + 2]!; };
ok(at(30, 30) < at(30, 30) + 1 && at(30, 30) < Math.max(at(5, 30), at(55, 30), at(30, 5), at(30, 55)), "carved-down areas read darker than the surface");
const red = (m: Float32Array) => { let r = 0, b = 0; for (let i = 0; i < m.length; i += 3) (r += m[i]!), (b += m[i + 2]!); return r / b; };
ok(red(of.rosewood!) > red(of.walnut!), "rosewood is redder than walnut");
const same = materialColors(pos, count, count, 1, 2, "teak");
ok(same.every((v, i) => v === c[i]), "same input, same colours (no randomness: the preview never flickers)");
ok(MATERIALS.find((m) => m.id === "brass")!.metalness > 0.5, "brass is metallic");
console.log(`carve material.check OK (${n} assertions)`);
