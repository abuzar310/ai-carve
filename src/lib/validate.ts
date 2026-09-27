import { faceNormal, type ReliefMesh } from "./mesh.ts";
import { parseStl, scanStl } from "./stl.ts";

/** Full edge-manifold Maps stay under this. 720² Ultra must never take this path. */
export const FULL_TOPOLOGY_TRIS = 120_000;

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
  mode: "full" | "export";
  checks: string;
};

const EPS = 1e-9;

function qkey(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e5)}|${Math.round(y * 1e5)}|${Math.round(z * 1e5)}`;
}

function bboxAndFaces(mesh: ReliefMesh): {
  errors: string[];
  nan: number;
  degenerate: number;
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
  side: number;
  bottom: number;
  up: number;
} {
  const { positions, indices } = mesh;
  const errors: string[] = [];
  let nan = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nan++;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (nan) errors.push(`${nan} non-finite coordinates`);
  let degenerate = 0;
  let side = 0;
  let bottom = 0;
  let up = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3, ib = indices[i + 1]! * 3, ic = indices[i + 2]! * 3;
    const [nx, ny, nz, area] = faceNormal(
      positions[ia]!, positions[ia + 1]!, positions[ia + 2]!,
      positions[ib]!, positions[ib + 1]!, positions[ib + 2]!,
      positions[ic]!, positions[ic + 1]!, positions[ic + 2]!,
    );
    if (area < 1e-12) degenerate++;
    if (Math.abs(nx) > 0.7 || Math.abs(ny) > 0.7) side++;
    if (nz < -0.7) bottom++;
    if (nz > 0.2) up++;
  }
  if (degenerate) errors.push(`${degenerate} degenerate triangles`);
  return { errors, nan, degenerate, minX, minY, minZ, maxX, maxY, maxZ, side, bottom, up };
}

function dimErrors(mesh: ReliefMesh, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): string[] {
  const { meta } = mesh;
  const errors: string[] = [];
  const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
  if (Math.abs(sx - meta.widthMm) > 0.05) errors.push(`width ${sx.toFixed(3)} != ${meta.widthMm}`);
  if (Math.abs(sy - meta.heightMm) > 0.05) errors.push(`height ${sy.toFixed(3)} != ${meta.heightMm}`);
  if (sz + EPS < meta.baseMm * 0.9) errors.push(`Z ${sz.toFixed(3)} thinner than base`);
  if (Math.abs(minZ) > 0.05) errors.push(`bottom not at Z=0 (${minZ})`);
  return errors;
}

/** Streamed geometry checks. No string Maps. Safe for 720² Ultra. */
export function validateMeshQuick(mesh: ReliefMesh): MeshReport {
  const g = bboxAndFaces(mesh);
  const solid = mesh.meta.baseMm > 0; // base 0 = surface-only export, open rim by design
  const errors = [...g.errors, ...dimErrors(mesh, g.minX, g.minY, g.minZ, g.maxX, g.maxY, g.maxZ)];
  const hasBase = g.minZ <= 0.05 && g.maxZ - g.minZ >= mesh.meta.baseMm * 0.9;
  const hasSides = g.side > 0;
  const hasBottom = g.bottom > 0;
  if (!hasBase) errors.push("missing base");
  if (solid && !hasSides) errors.push("missing side walls");
  if (solid && !hasBottom) errors.push("missing bottom");
  if (g.up < 1) errors.push("no upward faces (relief)");
  return {
    ok: errors.length === 0,
    errors,
    triangles: mesh.meta.triangleCount,
    size: [g.maxX - g.minX, g.maxY - g.minY, g.maxZ - g.minZ],
    zMin: g.minZ,
    zMax: g.maxZ,
    topSpan: mesh.meta.topZMax - mesh.meta.topZMin,
    degenerate: g.degenerate,
    manifold: true,
    components: 1,
    hasBase,
    hasSides,
    hasBottom,
    mode: "export",
    checks: "finite, bbox, Z, faces (full scan) · topology skipped (large mesh)",
  };
}

export function validateMesh(mesh: ReliefMesh): MeshReport {
  if (mesh.meta.triangleCount > FULL_TOPOLOGY_TRIS) return validateMeshQuick(mesh);
  const g = bboxAndFaces(mesh);
  const solid = mesh.meta.baseMm > 0; // base 0 = surface-only export, open rim by design
  const errors = [...g.errors, ...dimErrors(mesh, g.minX, g.minY, g.minZ, g.maxX, g.maxY, g.maxZ)];
  const { positions, indices } = mesh;
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
  const keys: string[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    const k = qkey(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    keys.push(k);
    if (!parent.has(k)) parent.set(k, k);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]!, ib = indices[i + 1]!, ic = indices[i + 2]!;
    const ka = keys[ia]!, kb = keys[ib]!, kc = keys[ic]!;
    union(ka, kb);
    union(kb, kc);
    for (const [a, b] of [[ka, kb], [kb, kc], [kc, ka]] as const) {
      if (a === b) continue;
      const u = a < b ? `${a}~${b}` : `${b}~${a}`;
      undirected.set(u, (undirected.get(u) ?? 0) + 1);
      directed.set(`${a}>${b}`, (directed.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  let over = 0;
  let opposite = 0;
  for (const [u, c] of undirected) {
    if (c !== 2) (c === 1 ? open++ : over++);
    const [a, b] = u.split("~");
    if ((directed.get(`${a}>${b}`) ?? 0) && (directed.get(`${b}>${a}`) ?? 0)) opposite++;
  }
  const manifold = over === 0 && opposite === undirected.size - open && (!solid || open === 0);
  if (!manifold) errors.push(`not edge-manifold (open ${open}, overused ${over})`);
  // Only vertices a triangle uses count (surface-only export leaves the unused base ring out).
  const used = new Set<string>();
  for (let i = 0; i < indices.length; i++) used.add(keys[indices[i]!]!);
  const roots = new Set<string>();
  for (const k of used) roots.add(find(k));
  if (roots.size !== 1) errors.push(`${roots.size} disconnected components`);
  const hasBase = g.minZ <= 0.05 && g.maxZ - g.minZ >= mesh.meta.baseMm * 0.9;
  const hasSides = g.side > 0;
  const hasBottom = g.bottom > 0;
  if (!hasBase) errors.push("missing base");
  if (solid && !hasSides) errors.push("missing side walls");
  if (solid && !hasBottom) errors.push("missing bottom");
  return {
    ok: errors.length === 0,
    errors,
    triangles: mesh.meta.triangleCount,
    size: [g.maxX - g.minX, g.maxY - g.minY, g.maxZ - g.minZ],
    zMin: g.minZ,
    zMax: g.maxZ,
    topSpan: mesh.meta.topZMax - mesh.meta.topZMin,
    degenerate: g.degenerate,
    manifold,
    components: roots.size,
    hasBase,
    hasSides,
    hasBottom,
    mode: "full",
    checks: "finite, bbox, Z, faces, edge-manifold, components",
  };
}

export function validateStl(buf: ArrayBuffer | Uint8Array, mesh?: ReliefMesh, opts: { surfaceOnly?: boolean } = {}): MeshReport {
  const parsed = parseStl(buf);
  const scan = scanStl(buf);
  const errors: string[] = [];
  if (scan.nan) errors.push(`${scan.nan} NaN`);
  if (scan.inf) errors.push(`${scan.inf} non-finite`);
  if (scan.degenerate) errors.push(`${scan.degenerate} degenerate`);
  if (mesh && parsed.count !== mesh.meta.triangleCount) errors.push("STL count != mesh");
  const surfaceOnly = mesh ? !(mesh.meta.baseMm > 0) : !!opts.surfaceOnly;
  if (!surfaceOnly && scan.nzNeg < 1) errors.push("no downward faces (bottom)");
  if (scan.nzPos < 1) errors.push("no upward faces (relief)");
  if (scan.size[2]! < 0.05) errors.push("no Z thickness");
  const large = !mesh || mesh.meta.triangleCount > FULL_TOPOLOGY_TRIS;
  const topo = mesh ? (large ? validateMeshQuick(mesh) : validateMesh(mesh)) : null;
  if (topo) errors.push(...topo.errors.filter((e) => !errors.includes(e)));
  return {
    ok: errors.length === 0,
    errors,
    triangles: scan.triangles,
    size: scan.size,
    zMin: scan.zMin,
    zMax: scan.zMax,
    topSpan: topo?.topSpan ?? scan.zMax - scan.zMin,
    degenerate: scan.degenerate,
    manifold: topo?.manifold ?? true,
    components: topo?.components ?? 1,
    hasBase: scan.zMin <= 0.05,
    hasSides: topo?.hasSides ?? true,
    hasBottom: scan.nzNeg > 0,
    mode: large ? "export" : "full",
    checks: large
      ? "binary header, byte length, triangle count, finite, bbox, Z, faces (full scan) · topology skipped (large export)"
      : "binary header, byte length, triangle count, finite, bbox, Z, faces, edge-manifold",
  };
}

export function formatReport(r: MeshReport): string {
  const dim = `${r.size[0].toFixed(1)} × ${r.size[1].toFixed(1)} × ${r.size[2].toFixed(2)} mm`;
  if (!r.ok) return `STL INVALID — ${r.errors[0]}`;
  return `STL VALID · ${r.triangles.toLocaleString()} triangles · ${dim} · ${r.checks}`;
}

export function stlBytesEstimate(tris: number): number {
  return 84 + tris * 50;
}
