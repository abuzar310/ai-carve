import { pixelsToHeight, normalizeHeight } from "./height.ts";
import { refineHeight } from "./refine.ts";
import { buildRelief, fieldCols, triangleEstimate } from "./mesh.ts";
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
ok(fieldCols("ultra", 256) === 256, "ultra does not invent pixels");
ok(fieldCols("ultra", 2000) === 720 && fieldCols("high", 2000) === 512, "quality caps");
ok(triangleEstimate(220, 220) === 193596, "standard triangle estimate");
ok(validateMesh(buildRelief(grid("flat", 16, 16), 16, 16, board)).mode === "full", "small mesh full topology");
ok(validateMesh(perfMesh).mode === "full", "160² still full");
const stdH = normalizeHeight(grid("carving", 220, 220));
const stdMesh = buildRelief(stdH, 220, 220, board);
ok(validateMesh(stdMesh).mode === "export", "220² export path skips topology maps");
ok(validateMeshQuick(stdMesh).ok, "220 quick ok");
const stdBuf = writeStl(stdMesh);
const stdR = validateStl(stdBuf);
ok(stdR.ok && stdR.mode === "export" && stdBuf.byteLength === 84 + 193596 * 50, "standard export scan");
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

console.log(
  `carve mesh.check OK (${n} assertions) · 160² ${perfMesh.meta.triangleCount} tris · ${(perfBuf.byteLength / 1e6).toFixed(2)} MB · ${perfMs} ms`,
);
