import { writeFileSync } from "node:fs";
import { normalizeHeight, resampleHeight } from "../src/lib/height.ts";
import { refineHeight } from "../src/lib/refine.ts";
import { QUALITY, buildRelief, fieldCols, previewCols, triangleEstimate, type Quality } from "../src/lib/mesh.ts";
import { analyzeStl, writeStl } from "../src/lib/stl.ts";
import { validateMesh, validateStl } from "../src/lib/validate.ts";

/** Same ornamental field used for the 193,596-triangle Standard STL. */
function carving(cols: number, rows: number): Float32Array {
  const h = new Float32Array(cols * rows);
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u = x / (cols - 1);
      const v = y / (rows - 1);
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const petal = 0.55 + 0.45 * Math.cos(ang * 8);
      const ring = Math.exp(-Math.pow((r - 0.55) * 7, 2));
      const boss = Math.max(0, 1 - r * 2.2);
      const vine = 0.5 + 0.5 * Math.sin(u * 18) * Math.sin(v * 14);
      const border = u < 0.035 || u > 0.965 || v < 0.035 || v > 0.965 ? 0.12 : 1;
      const groove = Math.abs(Math.sin(ang * 16)) < 0.1 && r > 0.18 && r < 0.78 ? 0.22 : 1;
      h[y * cols + x] = Math.min(1, Math.max(0, (0.12 + 0.62 * boss * petal + 0.32 * ring + 0.18 * vine) * border * groove));
    }
  }
  return normalizeHeight(h);
}

function detailEnergy(h: Float32Array, cols: number, rows: number): number {
  let e = 0;
  let n = 0;
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const c = h[y * cols + x] ?? 0;
      const lap = 4 * c - (h[y * cols + x - 1] ?? 0) - (h[y * cols + x + 1] ?? 0) - (h[(y - 1) * cols + x] ?? 0) - (h[(y + 1) * cols + x] ?? 0);
      e += lap * lap;
      n++;
    }
  }
  return e / Math.max(1, n);
}

const src = 768;
const source = carving(src, src);
const board = { widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 2 };
const rows: Record<string, unknown>[] = [];

for (const q of Object.keys(QUALITY) as Quality[]) {
  const field = fieldCols(q, src);
  const preview = previewCols(q, false, field);
  const t0 = Date.now();
  const raw = carving(field, field);
  const refined = refineHeight(raw, field, field, { contrast: 1.15, smooth: 0 });
  const fieldMs = Date.now() - t0;
  const t1 = Date.now();
  const mesh = buildRelief(refined, field, field, board);
  const meshMs = Date.now() - t1;
  const meshR = validateMesh(mesh);
  if (!meshR.ok) throw new Error(`${q} mesh: ${meshR.errors.join("; ")}`);
  const t2 = Date.now();
  const buf = writeStl(mesh);
  const stlMs = Date.now() - t2;
  const stlR = validateStl(buf, mesh);
  if (!stlR.ok) throw new Error(`${q} stl: ${stlR.errors.join("; ")}`);
  const stats = analyzeStl(buf);
  const prevH = resampleHeight(refined, field, field, preview, preview);
  writeFileSync(`/tmp/carve-${q}.stl`, Buffer.from(buf));
  rows.push({
    quality: q,
    sourceImage: `${src}x${src}`,
    depthMap: `${field}x${field}`,
    preview: `${preview}x${preview}`,
    previewTris: triangleEstimate(preview, preview),
    exportTris: stats.triangles,
    stlBytes: stats.bytes,
    stlMB: +(stats.bytes / 1e6).toFixed(2),
    sizeMm: stats.size.map((n) => +n.toFixed(3)),
    z: [+stats.zMin.toFixed(4), +stats.zMax.toFixed(4)],
    degenerate: stats.degenerate,
    nan: stats.nan,
    manifold: meshR.manifold,
    fieldEnergy: +detailEnergy(refined, field, field).toFixed(6),
    sourceEnergy: +detailEnergy(source, src, src).toFixed(6),
    previewEnergy: +detailEnergy(prevH, preview, preview).toFixed(6),
    fieldMs,
    meshMs,
    stlMs,
    file: `/tmp/carve-${q}.stl`,
  });
}

console.log(JSON.stringify({
  note: "Extra triangles are extra samples of the same 768 source, not subdivided empty faces. Ultra on a 256px picture would cap at 256.",
  ultraOn256: fieldCols("ultra", 256),
  rows,
}, null, 2));
