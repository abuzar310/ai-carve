import { closeField, composeRelief, gaussianBlur, guidedFilter, limitSlope, removeTexture } from "./relief.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const N = 64;
const flat = new Float32Array(N * N).fill(0.4);
const b = gaussianBlur(flat, N, N, 3);
ok(b.every((v) => Math.abs(v - 0.4) < 1e-5), "blur keeps a flat field flat");

// One-cell pit must be filled by closing; a wide basin must survive.
const pit = new Float32Array(N * N).fill(1);
pit[32 * N + 32] = 0;
ok(closeField(pit, N, N, 1)[32 * N + 32]! > 0.99, "closing fills a 1-cell pit");
const basin = new Float32Array(N * N).fill(1);
for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) basin[y * N + x] = 0;
ok(closeField(basin, N, N, 1)[32 * N + 32]! < 0.01, "closing keeps a wide basin");

// A cliff becomes a ramp no steeper than step.
const cliff = new Float32Array(N * N);
for (let y = 0; y < N; y++) for (let x = 32; x < N; x++) cliff[y * N + x] = 1;
const lim = limitSlope(cliff, N, N, 0.1);
let worst = 0;
for (let y = 0; y < N; y++) for (let x = 1; x < N; x++) worst = Math.max(worst, Math.abs(lim[y * N + x]! - lim[y * N + x - 1]!));
ok(worst <= 0.1 + 1e-5, `slope capped (${worst.toFixed(3)})`);

// Depth decides the big shape: a near disc must sit higher than the far background
// even when the picture itself is dark on the disc.
const depth = new Float32Array(N * N);
const luma = new Float32Array(N * N).fill(0.8);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    if (Math.hypot(x - 32, y - 32) < 16) {
      depth[y * N + x] = 1;
      luma[y * N + x] = 0.2;
    }
  }
}
const h = composeRelief({ luma, depth, cols: N, rows: N });
ok(h.every((v) => v >= 0 && v <= 1), "output in 0..1");
ok(h[32 * N + 32]! > h[4 * N + 4]! + 0.3, "near (depth) wins over dark (brightness)");
const fallback = composeRelief({ luma, depth: null, cols: N, rows: N });
ok(fallback.every(Number.isFinite), "no-depth fallback is finite");

// Texture removal: fine speckle on a flat face goes, a big step edge stays.
const tex = new Float32Array(N * N);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) tex[y * N + x] = (x < 32 ? 0.2 : 0.8) + (rnd() - 0.5) * 0.08;
const cleaned = removeTexture(tex, N, N, 2);
let noise = 0;
for (let y = 8; y < 56; y++) for (let x = 40; x < 56; x++) noise = Math.max(noise, Math.abs(cleaned[y * N + x]! - 0.8));
ok(noise < 0.02, `speckle removed (${noise.toFixed(3)})`);
ok(cleaned[32 * N + 36]! - cleaned[32 * N + 27]! > 0.5, "edge kept after texture removal");

// Guided filter snaps a soft depth edge to the picture edge.
const guide = new Float32Array(N * N);
const soft = new Float32Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  guide[y * N + x] = x < 32 ? 0 : 1;
  soft[y * N + x] = Math.min(1, Math.max(0, (x - 24) / 16));
}
const snapped = guidedFilter(guide, soft, N, N, 4, 1e-3);
ok(snapped[32 * N + 33]! - snapped[32 * N + 30]! > soft[32 * N + 33]! - soft[32 * N + 30]!, "depth edge sharpened by guide");

console.log(`carve relief.check OK (${n} assertions)`);
