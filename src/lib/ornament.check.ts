import { cornerParts, drawParts, pocketArc, type Pocket } from "./ornament";

let n = 0;
function ok(cond: unknown, msg: string): void {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
}

const R = 100;
const pocket: Pocket = { cx: 0, cy: 0, sx: 1, sy: 1, r: R };
const parts = cornerParts("flowers", pocket, 2);
ok(parts.length > 15, `flower spray has its parts (${parts.length})`);

// every point of the spray sits inside the pocket, clear of the closing arc
let worst = 0;
for (const p of parts) for (const [x, y] of p.kind === "dome" ? p.poly : p.path) worst = Math.max(worst, Math.hypot(x, y) / R);
ok(worst < 0.93, `spray stays inside its pocket (reaches ${(worst * 100).toFixed(0)} % of the radius)`);
ok(parts.every((p) => (p.kind === "dome" ? p.poly : p.path).every(([x, y]) => x >= 0 && y >= 0)), "spray stays on the panel side of the corner");

// draw it: raised, symmetric about the diagonal, with carved veins
const N = 400, mm = (R * 1.0) / N;
const h = new Float32Array(N * N).fill(1);
drawParts(h, N, N, mm, parts, 1);
let max = 0, raised = 0, asym = 0;
for (let y = 0; y < N; y++)
  for (let x = 0; x < N; x++) {
    const v = h[y * N + x]!;
    max = Math.max(max, v);
    if (v > 1.05) raised++;
    asym = Math.max(asym, Math.abs(v - h[x * N + y]!));
  }
ok(max > 1 + 2 * 1.0 && max < 1 + 2 * 1.3, `tallest point about the ornament height (${(max - 1).toFixed(2)} mm for 2 mm)`);
ok(raised > N * N * 0.08, `a good share of the pocket is carved (${((raised / (N * N)) * 100).toFixed(0)} %)`);
ok(asym < 0.15, `reads the same in every corner: symmetric about the diagonal (off by ${asym.toFixed(3)} mm)`);

// veins are cut into the leaves: along a leaf's midrib the surface dips below its sides
{
  const leaf = parts.find((p) => p.kind === "dome" && (p.grooves?.length ?? 0) > 3)!;
  ok(!!leaf, "a leaf with veins");
  if (leaf.kind === "dome") {
    const mid = leaf.grooves![0]!;
    const [gx, gy] = mid[Math.floor(mid.length / 2)]!;
    const at = (x: number, y: number) => h[Math.floor(y / mm) * N + Math.floor(x / mm)]!;
    const dip = Math.max(at(gx + 1.2, gy), at(gx - 1.2, gy), at(gx, gy + 1.2), at(gx, gy - 1.2)) - at(gx, gy);
    ok(dip > 0.05, `midrib is carved into the leaf (${dip.toFixed(2)} mm)`);
  }
}

// mirrored into the other corners
const other = cornerParts("flowers", { cx: 500, cy: 300, sx: -1, sy: -1, r: R }, 2);
const [ax, ay] = (parts[0]!.kind === "dome" ? parts[0]!.poly : parts[0]!.path)[0]!;
const [bx, by] = (other[0]!.kind === "dome" ? other[0]!.poly : other[0]!.path)[0]!;
ok(Math.abs(500 - bx - ax) < 1e-9 && Math.abs(300 - by - ay) < 1e-9, "bottom-right corner is the mirror image");

// scales with the pocket: twice the radius, twice the size
const big = cornerParts("flowers", { ...pocket, r: 2 * R }, 2);
ok(big.every((p, i) => (p.kind === "tube" ? Math.abs(p.width - 2 * (parts[i] as typeof p).width) < 1e-9 : true)), "stems scale with the pocket");

// the arc closing the pocket runs from one edge to the other at radius r
const arc = pocketArc(pocket);
ok(Math.abs(arc[0]![0] - R) < 1e-9 && Math.abs(arc[arc.length - 1]![1] - R) < 1e-9 && arc.every(([x, y]) => Math.abs(Math.hypot(x, y) - R) < 1e-6), "pocket arc is a true quarter circle");

// tiny pockets (a small plate on a coarse grid) do not crash or make NaN
const t = new Float32Array(50 * 50).fill(1);
drawParts(t, 50, 50, 1, cornerParts("flowers", { cx: 0, cy: 0, sx: 1, sy: 1, r: 8 }, 1), 1);
ok(t.every(Number.isFinite), "tiny pocket on a coarse grid is fine");

console.log(`carve ornament.check OK (${n} assertions)`);
