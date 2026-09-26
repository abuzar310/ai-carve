import { faceNormal, type ReliefMesh } from "./mesh.ts";
import { analyzeStl, parseStl } from "./stl.ts";

export type MeshReport = {
  ok: boolean;
  errors: string[];
  triangles: number;
  size: [number, number, number];
  zMin: number;
  zMax: number;
  topSpan: number;
  degenerate: number;
  manifold: boolean;
  components: number;
  hasBase: boolean;
  hasSides: boolean;
  hasBottom: boolean;
};

const EPS = 1e-9;

function qkey(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e5)}|${Math.round(y * 1e5)}|${Math.round(z * 1e5)}`;
}

export function validateMesh(mesh: ReliefMesh): MeshReport {
  const errors: string[] = [];
  const { positions, indices, meta } = mesh;
  let degenerate = 0;
  let nan = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let side = 0;
  let bottom = 0;
  const undirected = new Map<string, number>();
  const directed = new Map<string, number>();
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let p = parent.get(a) ?? a;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(a, p);
    return p;
  };
  const union = (a: string, b: string) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };

  for (let i = 0; i < positions.length; i++) {
    const v = positions[i]!;
    if (Number.isNaN(v)) nan++;
    else if (!Number.isFinite(v)) nan++;
  }
  if (nan) errors.push(`${nan} non-finite coordinates`);

  const keys: string[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    keys.push(qkey(x, y, z));
    if (!parent.has(keys[keys.length - 1]!)) parent.set(keys[keys.length - 1]!, keys[keys.length - 1]!);
  }

  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]!, ib = indices[i + 1]!, ic = indices[i + 2]!;
    const ax = positions[ia * 3]!, ay = positions[ia * 3 + 1]!, az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]!, by = positions[ib * 3 + 1]!, bz = positions[ib * 3 + 2]!;
    const cx = positions[ic * 3]!, cy = positions[ic * 3 + 1]!, cz = positions[ic * 3 + 2]!;
    const [nx, ny, nz, area] = faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
    if (area < 1e-12) degenerate++;
    if (Math.abs(nx) > 0.7 || Math.abs(ny) > 0.7) side++;
    if (nz < -0.7) bottom++;
    const ka = keys[ia]!, kb = keys[ib]!, kc = keys[ic]!;
    union(ka, kb);
    union(kb, kc);
    const edges: [string, string][] = [[ka, kb], [kb, kc], [kc, ka]];
    for (const [a, b] of edges) {
      if (a === b) continue;
      const u = a < b ? `${a}~${b}` : `${b}~${a}`;
      undirected.set(u, (undirected.get(u) ?? 0) + 1);
      const d = `${a}>${b}`;
      directed.set(d, (directed.get(d) ?? 0) + 1);
    }
    void nx;
  }

  if (degenerate) errors.push(`${degenerate} degenerate triangles`);
  const sx = maxX - minX;
  const sy = maxY - minY;
  const sz = maxZ - minZ;
  if (Math.abs(sx - meta.widthMm) > 0.05) errors.push(`width ${sx.toFixed(3)} != ${meta.widthMm}`);
  if (Math.abs(sy - meta.heightMm) > 0.05) errors.push(`height ${sy.toFixed(3)} != ${meta.heightMm}`);
  if (sz + EPS < meta.baseMm * 0.9) errors.push(`Z ${sz.toFixed(3)} thinner than base`);
  if (Math.abs(minZ) > 0.05) errors.push(`bottom not at Z=0 (${minZ})`);

  let open = 0;
  let over = 0;
  let opposite = 0;
  for (const [u, c] of undirected) {
    if (c !== 2) (c === 1 ? open++ : over++);
    const [a, b] = u.split("~");
    const ab = directed.get(`${a}>${b}`) ?? 0;
    const ba = directed.get(`${b}>${a}`) ?? 0;
    if (ab && ba) opposite++;
  }
  const manifold = open === 0 && over === 0 && opposite === undirected.size;
  if (!manifold) errors.push(`not edge-manifold (open ${open}, overused ${over})`);

  const roots = new Set<string>();
  for (const k of parent.keys()) roots.add(find(k));
  const components = roots.size;
  if (components !== 1) errors.push(`${components} disconnected components`);

  const hasBase = minZ <= 0.05 && sz >= meta.baseMm * 0.9;
  const hasSides = side > 0;
  const hasBottom = bottom > 0;
  if (!hasBase) errors.push("missing base");
  if (!hasSides) errors.push("missing side walls");
  if (!hasBottom) errors.push("missing bottom");

  const topSpan = meta.topZMax - meta.topZMin;
  return {
    ok: errors.length === 0,
    errors,
    triangles: meta.triangleCount,
    size: [sx, sy, sz],
    zMin: minZ,
    zMax: maxZ,
    topSpan,
    degenerate,
    manifold,
    components,
    hasBase,
    hasSides,
    hasBottom,
  };
}

export function validateStl(buf: ArrayBuffer | Uint8Array, mesh?: ReliefMesh): MeshReport {
  const parsed = parseStl(buf);
  const stats = analyzeStl(buf);
  const errors: string[] = [];
  if (stats.nan) errors.push(`${stats.nan} NaN`);
  if (stats.inf) errors.push(`${stats.inf} non-finite`);
  if (stats.degenerate) errors.push(`${stats.degenerate} degenerate`);
  if (mesh && parsed.count !== mesh.meta.triangleCount) errors.push("STL count != mesh");
  if (stats.nzNeg < 1) errors.push("no downward faces (bottom)");
  if (stats.nzPos < 1) errors.push("no upward faces (relief)");
  if (stats.size[2]! < 0.05) errors.push("no Z thickness");
  const report: MeshReport = {
    ok: errors.length === 0,
    errors,
    triangles: stats.triangles,
    size: stats.size,
    zMin: stats.zMin,
    zMax: stats.zMax,
    topSpan: stats.zMax - stats.zMin,
    degenerate: stats.degenerate,
    manifold: true,
    components: 1,
    hasBase: stats.zMin <= 0.05,
    hasSides: true,
    hasBottom: stats.nzNeg > 0,
  };
  if (mesh) {
    const m = validateMesh(mesh);
    report.manifold = m.manifold;
    report.components = m.components;
    report.hasSides = m.hasSides;
    report.errors = [...m.errors, ...errors];
    report.ok = report.errors.length === 0;
    report.topSpan = m.topSpan;
  }
  return report;
}

export function formatReport(r: MeshReport): string {
  const dim = `${r.size[0].toFixed(1)} × ${r.size[1].toFixed(1)} × ${r.size[2].toFixed(2)} mm`;
  if (!r.ok) return `STL INVALID — ${r.errors[0]}`;
  return `STL VALID · ${r.triangles.toLocaleString()} triangles · ${dim}`;
}
