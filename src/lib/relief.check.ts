import { backgroundMask, closeField, composeRelief, gaussianBlur, guidedFilter, limitSlope, removeTexture, silhouette, turnedForm } from "./relief.ts";

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

// Turned leg: bright spindle on black. Background must be 0, rows must be half-rounds,
// and a wide bulb must stand taller than a thin neck.
{
  const C = 40;
  const R = 120;
  const leg = new Float32Array(C * R);
  // Curved bulb (rows 31..59) on a thin neck, like a real turned leg.
  const half = (y: number) => (y > 30 && y < 60 ? 6 + 10 * Math.sin(((y - 30) / 30) * Math.PI) : 6);
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (Math.abs(x - 19.5) < half(y)) leg[y * C + x] = 0.7;
  const m = silhouette(leg, C, R);
  ok(!!m && m[45 * C + 20] === 1 && m[45 * C + 1] === 0, "silhouette finds the leg, not the background");
  const t = composeRelief({ luma: leg, depth: null, cols: C, rows: R }, { turned: true });
  ok(t[45 * C + 1] === 0 && t[90 * C + 2] === 0, "background is exactly 0");
  ok(t[45 * C + 20]! > t[45 * C + 10]! && t[45 * C + 10]! > t[45 * C + 5]!, "bulb row falls off like a half-round");
  ok(t[45 * C + 20]! > t[90 * C + 20]! + 0.3, "bulb stands taller than the neck");
}

// Square pedestal: widest straight-sided run gets a flat face, bulbs stay round.
{
  const C = 40;
  const R = 160;
  const m = new Uint8Array(C * R);
  const half = (y: number) => (y < 40 ? 18 : y > 60 && y < 90 ? 14 : 7);
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) if (Math.abs(x - 19.5) < half(y)) m[y * C + x] = 1;
  const f = turnedForm(m, C, R);
  const blockFlat = Math.abs(f[20 * C + 20]! - f[20 * C + 12]!) < 0.02;
  const bulbRound = f[75 * C + 20]! - f[75 * C + 12]! > 0.08;
  ok(blockFlat, "square block has a flat face");
  ok(bulbRound, "bulb stays round");
  ok(f[20 * C + 2]! > 0 && f[20 * C + 2]! < f[20 * C + 20]!, "block edge is chamfered");
}

// Background: busy border → nothing cut; flat black border → subject found; alpha wins.
{
  const C = 64;
  const busy = new Float32Array(C * C);
  let sd = 11;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < busy.length; i++) busy[i] = rnd();
  ok(backgroundMask(busy, C, C) === null, "busy picture: no background cut");
  const obj = new Float32Array(C * C);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) if (Math.hypot(x - 32, y - 32) < 18) obj[y * C + x] = 0.6 + 0.3 * Math.sin(x); // dark stripes inside
  const bm = backgroundMask(obj, C, C);
  ok(!!bm && bm[32 * C + 32] === 1 && bm[2 * C + 2] === 0, "object on black: found");
  let holes = 0;
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) if (Math.hypot(x - 32, y - 32) < 15 && bm && !bm[y * C + x]) holes++;
  ok(holes === 0, "dark detail inside the object is not background");
  const alpha = new Float32Array(C * C);
  for (let i = 0; i < alpha.length; i++) alpha[i] = i % C < 32 ? 1 : 0;
  const am = backgroundMask(busy, C, C, alpha);
  ok(!!am && am[10 * C + 5] === 1 && am[10 * C + 50] === 0, "transparent PNG uses alpha");
  const h = composeRelief({ luma: obj, depth: null, cols: C, rows: C });
  ok(h[2 * C + 2] === 0 && h[32 * C + 32]! > 0.1, "auto cut: background 0, subject raised");
  const keep = composeRelief({ luma: obj, depth: null, cols: C, rows: C }, { cutBackground: false });
  ok(keep.every((v) => v >= 0 && v <= 1), "cut off still valid");
}

// Degenerate pictures must not crash or produce NaN.
{
  const C = 32;
  for (const v of [0, 0.5, 1]) {
    const flatPic = new Float32Array(C * C).fill(v);
    const h = composeRelief({ luma: flatPic, depth: null, cols: C, rows: C });
    ok(h.every(Number.isFinite), `flat ${v} picture is finite`);
    const t = composeRelief({ luma: flatPic, depth: null, cols: C, rows: C }, { turned: true });
    ok(t.every(Number.isFinite), `flat ${v} picture in turned mode is finite`);
  }
}

console.log(`carve relief.check OK (${n} assertions)`);
