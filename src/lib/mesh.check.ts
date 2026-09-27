import { pixelsToHeight, normalizeHeight } from "./height.ts";
import { finishField, refineHeight } from "./refine.ts";
import { buildRelief, fieldCols, previewCols, restampRelief, triangleEstimate } from "./mesh.ts";
import { analyzeStl, parseStl, writeStl, writeStlAsync } from "./stl.ts";
import { validateMesh, validateMeshQuick, validateStl } from "./validate.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

function grid(kind: "flat" | "gradient" | "raised" | "recessed" | "carving", cols: number, rows: number): Float32Array {
  const h = new Float32Array(cols * rows);
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const u = x / (cols - 1);
      const v = y / (rows - 1);
      if (kind === "flat") h[i] = 0.4;
      else if (kind === "gradient") h[i] = u;
      else if (kind === "raised") {
        const d = Math.hypot((x - cx) / cols, (y - cy) / rows);
        h[i] = d < 0.22 ? 1 : 0.05;
      } else if (kind === "recessed") {
        const d = Math.hypot((x - cx) / cols, (y - cy) / rows);
        h[i] = d < 0.22 ? 0.05 : 1;
      } else {
        const dx = (x - cx) / cx;
        const dy = (y - cy) / cy;
        const r = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const petal = 0.55 + 0.45 * Math.cos(ang * 8);
        const ring = Math.exp(-Math.pow((r - 0.55) * 7, 2));
        const boss = Math.max(0, 1 - r * 2.2);
        const border = u < 0.04 || u > 0.96 || v < 0.04 || v > 0.96 ? 0.15 : 1;
        const groove = Math.abs(Math.sin(ang * 16)) < 0.12 && r > 0.2 && r < 0.75 ? 0.25 : 1;
        h[i] = Math.min(1, Math.max(0, (0.18 + 0.72 * boss * petal + 0.35 * ring) * border * groove));
      }
    }
  }
  return h;
}

const board = { widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 2 };

for (const kind of ["flat", "gradient", "raised", "recessed", "carving"] as const) {
  const h = kind === "carving" ? normalizeHeight(grid(kind, 48, 48)) : grid(kind, 16, 16);
  const cols = kind === "carving" ? 48 : 16;
  const mesh = buildRelief(h, cols, cols, board);
  const report = validateMesh(mesh);
  ok(report.ok, `${kind} mesh: ${report.errors.join("; ")}`);
  ok(report.hasBase && report.hasSides && report.hasBottom, `${kind} solid parts`);
  ok(report.degenerate === 0, `${kind} no degenerate`);
  ok(Math.abs(report.size[0] - 100) < 0.02 && Math.abs(report.size[1] - 100) < 0.02, `${kind} XY`);
  if (kind === "flat") ok(report.topSpan < 1e-6, "flat top");
  else ok(report.topSpan > 1.5, `${kind} Z variation ${report.topSpan}`);
  const buf = writeStl(mesh);
  const parsed = parseStl(buf);
  ok(parsed.binary && parsed.count === mesh.meta.triangleCount, `${kind} stl count`);
  const stl = validateStl(buf, mesh);
  ok(stl.ok, `${kind} stl: ${stl.errors.join("; ")}`);
  const stats = analyzeStl(buf);
  ok(stats.format === "binary" && stats.degenerate === 0 && stats.nan === 0, `${kind} analyze`);
}

const px = new Uint8ClampedArray(32 * 32 * 4);
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    const g = Math.round(grid("carving", 32, 32)[y * 32 + x]! * 255);
    px[i] = px[i + 1] = px[i + 2] = g;
    px[i + 3] = 255;
  }
}
const raw = normalizeHeight(pixelsToHeight(px, false));
const refined = refineHeight(raw, 32, 32, { contrast: 1.25, smooth: 1 });
ok(refined.some((v, i) => Math.abs(v - (raw[i] ?? 0)) > 1e-6), "refine changes field");
const pipe = buildRelief(refined, 32, 32, { widthMm: 100, heightMm: 80, depthMm: 3, baseMm: 1.5 });
const pipeR = validateMesh(pipe);
ok(pipeR.ok && pipeR.topSpan > 1, `pipeline mesh ${pipeR.errors.join("; ")}`);
ok(Math.abs(pipeR.size[0] - 100) < 0.02 && Math.abs(pipeR.size[1] - 80) < 0.02, "pipeline dims");
const invert = pixelsToHeight(px, true);
ok(Math.abs((invert[0] ?? 0) - (1 - (pixelsToHeight(px, false)[0] ?? 0))) < 1e-6, "invert");

const t0 = Date.now();
const perfH = normalizeHeight(grid("carving", 160, 160));
const perfMesh = buildRelief(perfH, 160, 160, board);
const perfBuf = writeStl(perfMesh);
const perfMs = Date.now() - t0;
const perfR = validateStl(perfBuf, perfMesh);
ok(perfR.ok, `perf stl ${perfR.errors.join("; ")}`);
ok(perfMesh.meta.triangleCount > 50_000, "preview-scale density");
ok(perfBuf.byteLength === 84 + perfMesh.meta.triangleCount * 50, "binary size");
ok(fieldCols("high", 96) === 1024 && fieldCols("high", 768) === 1024 && fieldCols("high", 4000) === 1024, "high is the 1024 grid");
ok(fieldCols("standard", 4000) === 512, "standard is the explicit smaller grid");
ok(fieldCols("ultra", 256) === 1024, "ultra does not enlarge a small picture past 1024");
ok(fieldCols("ultra", 1100) === 1100 && fieldCols("ultra", 4000) === 1280, "ultra keeps extra detail only from a larger picture");
ok(previewCols("high", true, 1024) === 1024, "preview grid matches the export field");
ok(previewCols("standard", true, 4000) === 512, "preview does not drop to a phone thumbnail");
ok(triangleEstimate(220, 220) === 98550, "220 is relief cells plus a flat base cap");
ok(validateMesh(buildRelief(grid("flat", 16, 16), 16, 16, board)).mode === "full", "small mesh full topology");
ok(validateMesh(perfMesh).mode === "full", "160² still full");
const stdH = normalizeHeight(grid("carving", 220, 220));
const stdMesh = buildRelief(stdH, 220, 220, board);
ok(validateMesh(stdMesh).mode === "full", "220² flat cap is small enough for a full topology check");
ok(validateMeshQuick(stdMesh).ok, "220 quick ok");
const stdBuf = writeStl(stdMesh);
const stdR = validateStl(stdBuf);
ok(stdR.ok && stdR.mode === "export" && stdBuf.byteLength === 84 + 98550 * 50, "standard export scan");
const asyncBuf = await writeStlAsync(stdMesh, 10_000, async () => {});
ok(asyncBuf.byteLength === stdBuf.byteLength, "async writer size");

for (const n of [512, 720] as const) {
  const h = normalizeHeight(grid("carving", n, n));
  const m = buildRelief(h, n, n, board);
  ok(validateMesh(m).mode === "export", `${n} skips topology maps`);
  const q = validateMeshQuick(m);
  ok(q.ok && q.degenerate === 0, `${n} quick mesh`);
  const b = writeStl(m);
  const r = validateStl(b);
  ok(r.ok && r.triangles === m.meta.triangleCount && b.byteLength === 84 + r.triangles * 50, `${n} stl scan`);
  ok(Math.abs(r.size[0] - 100) < 0.05 && Math.abs(r.size[2] - 5) < 0.05, `${n} bbox`);
}

function picture(kind: "groove" | "portrait" | "steps", cols: number): Float32Array {
  const h = new Float32Array(cols * cols);
  const cx = (cols - 1) / 2;
  const cy = (cols - 1) / 2;
  for (let y = 0; y < cols; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (kind === "groove") {
        h[i] = x === Math.round(cols * 0.5) ? 0.05 : 0.85;
      } else if (kind === "portrait") {
        const d = Math.hypot((x - cx) / cols, (y - cy) / cols);
        h[i] = d < 0.18 ? 0.95 : d < 0.32 ? 0.45 : 0.15;
      } else {
        h[i] = x < cols * 0.33 ? 0.2 : x < cols * 0.66 ? 0.55 : 0.9;
      }
    }
  }
  return h;
}

const boards = { widthMm: 120, heightMm: 80, depthMm: 4, baseMm: 2.5 };
for (const kind of ["groove", "portrait", "steps"] as const) {
  const cols = kind === "groove" ? 64 : kind === "portrait" ? 48 : 40;
  const h = picture(kind, cols);
  const m = buildRelief(h, cols, cols, boards);
  const buf = writeStl(m);
  const r = validateStl(buf, m);
  ok(r.ok, `${kind} stl ${r.errors.join("; ")}`);
  ok(Math.abs(r.size[0] - 120) < 0.05 && Math.abs(r.size[1] - 80) < 0.05, `${kind} XY ${r.size}`);
  ok(r.zMin <= 0.05 && r.zMax >= boards.baseMm + 0.5, `${kind} Z ${r.zMin}..${r.zMax}`);
  ok(r.triangles === m.meta.triangleCount && buf.byteLength === 84 + r.triangles * 50, `${kind} binary size`);
  ok(!r.ok || r.degenerate === 0, `${kind} degenerate`);
}
const groove = buildRelief(picture("groove", 64), 64, 64, boards);
ok(groove.meta.topZMax - groove.meta.topZMin > 2, `groove survives ${groove.meta.topZMax - groove.meta.topZMin}`);

const hiH = normalizeHeight(grid("carving", 1024, 1024));
const hi = buildRelief(hiH, 1024, 1024, board);
ok(hi.meta.cols === 1024 && hi.meta.rows === 1024, "1024 field is the mesh grid");
ok(hi.meta.triangleCount === triangleEstimate(1024, 1024), `1024 triangles ${hi.meta.triangleCount}`);
ok(hi.ranges.top / 3 === 1023 * 1023 * 2 && hi.ranges.bottom / 3 === 4092, "1024 relief keeps every cell and the base is a cap");
ok(hi.meta.vertexCount === 1024 * 1024 + 2 * (1024 + 1024 - 2) + 1, "1024 does not duplicate the flat base grid");
ok(hi.meta.topZMax - hi.meta.topZMin > 1.5, "1024 relief is not flat");
let finite = true;
for (let i = 0; i < hi.positions.length; i += 997) {
  if (!Number.isFinite(hi.positions[i]!)) finite = false;
}
ok(finite, "1024 positions finite");

const step = new Float32Array(32 * 32);
for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) step[y * 32 + x] = x < 16 ? 0 : 1;
const kept = finishField(step, 32, 32, { contrast: 1, smooth: 0, normalize: true });
ok((kept[0] ?? 1) < 0.08 && (kept[31] ?? 0) > 0.92, "finish keeps a hard edge");
const mild = finishField(grid("gradient", 32, 32), 32, 32, { contrast: 0.55, smooth: 0, normalize: true });
const hard = finishField(grid("gradient", 32, 32), 32, 32, { contrast: 2.4, smooth: 0, normalize: true });
ok(Math.abs((mild[32 * 16 + 8] ?? 0) - (hard[32 * 16 + 8] ?? 0)) > 0.05, "depth strength moves a mid height");
const deep = buildRelief(mild, 32, 32, { widthMm: 180, heightMm: 70, depthMm: 9, baseMm: 4 });
const deepR = validateMesh(deep);
ok(deepR.ok, `resized solid ${deepR.errors.join("; ")}`);
ok(Math.abs(deepR.size[0] - 180) < 0.05 && Math.abs(deepR.size[1] - 70) < 0.05, "width and height follow settings");
let peak = 0;
for (const v of mild) if (v > peak) peak = v;
ok(Math.abs(deep.meta.zMin) < 0.001 && Math.abs(deep.meta.zMax - (4 + 9 * peak)) < 0.05, `base plus relief ${deep.meta.zMax}`);
const shallow = buildRelief(mild, 32, 32, { widthMm: 180, heightMm: 70, depthMm: 1.5, baseMm: 4 });
ok(shallow.meta.zMax < deep.meta.zMax - 3, "relief depth changes Z");
const sameArrays = shallow.positions;
restampRelief(shallow, mild, { widthMm: 180, heightMm: 70, depthMm: 9, baseMm: 4 });
ok(shallow.positions === sameArrays && shallow.indices.length === deep.indices.length, "restamp keeps the same triangles");
ok(Math.abs(shallow.meta.zMax - deep.meta.zMax) < 0.05 && Math.abs(shallow.meta.widthMm - 180) < 0.001, "restamp applies the new millimetres");

console.log(
  `carve mesh.check OK (${n} assertions) · 160² ${perfMesh.meta.triangleCount} tris · ${(perfBuf.byteLength / 1e6).toFixed(2)} MB · ${perfMs} ms · 1024² ${hi.meta.triangleCount} tris · ${((84 + hi.meta.triangleCount * 50) / 1e6).toFixed(1)} MB stl`,
);

// Base 0 = surface-only export (what ArtCAM imports as a relief): top grid only, Z 0..depth, valid.
{
  const { buildRelief: br, restampRelief: rs, triangleEstimate: te } = await import("./mesh.ts");
  const { validateMesh: vm, validateStl: vs } = await import("./validate.ts");
  const { writeStl: ws } = await import("./stl.ts");
  const g = 24;
  const f = new Float32Array(g * g);
  for (let i = 0; i < f.length; i++) f[i] = (Math.sin(i * 0.37) + 1) / 2;
  let lo = Infinity, hi = -Infinity;
  for (const v of f) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < f.length; i++) f[i] = (f[i]! - lo) / (hi - lo);
  const surf = br(f, g, g, { widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 0 });
  if (surf.meta.triangleCount !== (g - 1) * (g - 1) * 2) throw new Error("FAIL: surface-only has walls/bottom");
  if (te(g, g, true) !== surf.meta.triangleCount) throw new Error("FAIL: surface estimate");
  const r = vm(surf);
  if (!r.ok) throw new Error("FAIL: surface-only mesh invalid: " + r.errors.join("; "));
  if (Math.abs(r.zMax - 3) > 1e-4) throw new Error("FAIL: surface-only top should be depth (" + r.zMax + ")");
  const sr = vs(ws(surf), surf);
  if (!sr.ok) throw new Error("FAIL: surface-only STL invalid: " + sr.errors.join("; "));
  let threw = false;
  try { rs(surf, f, { widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 2 }); } catch { threw = true; }
  if (!threw) throw new Error("FAIL: restamp must refuse base on/off switch");
  console.log(`carve mesh.check surface-only OK · ${surf.meta.triangleCount} tris · Z 0..${r.zMax.toFixed(2)} mm`);
}
