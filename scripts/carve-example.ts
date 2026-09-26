import { writeFileSync } from "node:fs";
import { normalizeHeight } from "../src/lib/height.ts";
import { refineHeight } from "../src/lib/refine.ts";
import { buildRelief } from "../src/lib/mesh.ts";
import { analyzeStl, writeStl } from "../src/lib/stl.ts";
import { validateMesh, validateStl } from "../src/lib/validate.ts";

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

const src = 512;
const depth = 220;
const raw = carving(depth, depth);
const refined = refineHeight(raw, depth, depth, { contrast: 1.2, smooth: 1 });
const t0 = Date.now();
const mesh = buildRelief(refined, depth, depth, { widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 2 });
const meshMs = Date.now() - t0;
const meshR = validateMesh(mesh);
if (!meshR.ok) throw new Error(meshR.errors.join("; "));
const t1 = Date.now();
const buf = writeStl(mesh);
const stlMs = Date.now() - t1;
const stlR = validateStl(buf, mesh);
if (!stlR.ok) throw new Error(stlR.errors.join("; "));
const stats = analyzeStl(buf);
const out = "/tmp/carve-example.stl";
writeFileSync(out, Buffer.from(buf));

console.log(JSON.stringify({
  sourceImage: `${src}x${src} synthetic carving`,
  depthMap: `${depth}x${depth}`,
  previewHint: "160x160 in UI",
  exportMesh: `${depth}x${depth}`,
  physicalMm: [100, 100, stats.size[2]],
  reliefDepthMm: 3,
  baseMm: 2,
  triangles: stats.triangles,
  uniqueVerts: stats.uniqueVerts,
  stlBytes: stats.bytes,
  zMin: stats.zMin,
  zMax: stats.zMax,
  zBins: stats.zBins,
  degenerate: stats.degenerate,
  nan: stats.nan,
  meshMs,
  stlMs,
  meshOk: meshR.ok,
  stlOk: stlR.ok,
  manifold: meshR.manifold,
  file: out,
}, null, 2));
