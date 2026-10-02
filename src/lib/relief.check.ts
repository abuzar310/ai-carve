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

// Relief-trained depth: wood grain on the background must not be carved, and the background
// is cut from the depth (flat), not from picture colour. A distance model keeps the old path.
{
  const C = 96;
  const luma = new Float32Array(C * C);
  const depth = new Float32Array(C * C);
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const i = y * C + x;
      const inFlower = Math.hypot(x - 48, y - 48) < 20;
      luma[i] = 0.45 + 0.18 * Math.sin(y * 0.9 + Math.sin(x * 0.15) * 2); // strong wood grain everywhere
      depth[i] = inFlower ? 0.4 + 0.6 * Math.cos((Math.hypot(x - 48, y - 48) / 20) * (Math.PI / 2)) : 0.02;
    }
  const h = composeRelief({ luma, depth, cols: C, rows: C }, { depthKind: "relief" });
  let bgMax = 0;
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) if (Math.hypot(x - 48, y - 48) > 26) bgMax = Math.max(bgMax, h[y * C + x]!);
  ok(bgMax === 0, `relief model: grained background stays flat (max ${bgMax.toFixed(3)})`);
  ok(h[48 * C + 48]! > 0.8 && h[48 * C + 48 + 15]! > 0.1, "relief model: subject raised, dome kept");
  let worst = 0; // inside the subject the grain may add only a little texture
  for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) worst = Math.max(worst, Math.abs(h[y * C + x]! - h[y * C + x + 1]!));
  ok(worst < 0.06, `relief model: little grain on the subject (step ${worst.toFixed(3)})`);
  const keep = composeRelief({ luma, depth, cols: C, rows: C }, { depthKind: "relief", cutBackground: false });
  let bgSpread = 0;
  for (let y = 0; y < 12; y++) for (let x = 0; x < C; x++) bgSpread = Math.max(bgSpread, keep[y * C + x]!);
  ok(bgSpread < 0.05, `relief model, cut off: background still smooth (max ${bgSpread.toFixed(3)})`);
  const general = composeRelief({ luma, depth, cols: C, rows: C });
  const generalAgain = composeRelief({ luma, depth, cols: C, rows: C }, { depthKind: "general" });
  ok(general.every((v, i) => v === generalAgain[i]), "default is the general-model path");
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

// Background level (zero plane): the background flattens to 0, the subject keeps the full depth.
{
  const { zeroPlane } = await import("./relief");
  const C = 64;
  const h = new Float32Array(C * C);
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const r = Math.hypot(x - 32, y - 32);
    h[y * C + x] = r < 16 ? 0.4 + 0.6 * Math.cos((r / 16) * (Math.PI / 2)) : 0.15 + 0.1 * Math.sin(x * 0.7) * Math.sin(y * 0.5); // lumpy background
  }
  ok(zeroPlane(h, 0) === h, "level 0 leaves the relief untouched");
  const z = zeroPlane(h, 0.3);
  let bgMax = 0;
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) if (Math.hypot(x - 32, y - 32) > 20) bgMax = Math.max(bgMax, z[y * C + x]!);
  ok(bgMax === 0, `background below the level is flat at 0 (max ${bgMax})`);
  ok(Math.abs(z[32 * C + 32]! - 1) < 0.05, `subject top still reaches the full depth (${z[32 * C + 32]!.toFixed(3)})`);
  let worst = 0, src = 0;
  for (let x = 1; x < C; x++) {
    worst = Math.max(worst, Math.abs(z[32 * C + x]! - z[32 * C + x - 1]!));
    src = Math.max(src, Math.abs(h[32 * C + x]! - h[32 * C + x - 1]!));
  }
  ok(worst <= src / (1 - 0.3) + 1e-6, `adds no cliff of its own (step ${worst.toFixed(3)} ≤ picture's ${src.toFixed(3)} × stretch)`);
  let mono = true;
  for (let i = 1; i < 200; i++) { const a = new Float32Array([i / 200]), b = new Float32Array([(i - 1) / 200]); if (zeroPlane(a, 0.3)[0]! < zeroPlane(b, 0.3)[0]!) mono = false; }
  ok(mono, "higher stays higher (order of heights kept)");
  ok(zeroPlane(h, 0.5).every((v) => v >= 0 && v <= 1 && Number.isFinite(v)), "stays within 0..1");
}
console.log("carve relief.check zero plane OK");
