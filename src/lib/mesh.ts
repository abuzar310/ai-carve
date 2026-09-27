/**
 * IMAGE → pixelsToHeight → refineHeight → buildRelief → validateMesh
 *                                    ├→ Preview (same typed arrays)
 *                                    └→ writeStl → parseStl → validateStl
 *
 * baseMm > 0: one closed solid (relief top + base + walls + bottom).
 * baseMm = 0: relief surface only, Z 0..depth — what ArtCAM / Aspire import as a relief.
 * Preview and STL both come from ReliefMesh. Quality only changes sample density.
 */

export const QUALITY = {
  standard: { label: "Standard", field: 512 },
  high: { label: "High", field: 1024 },
  ultra: { label: "Ultra", field: 1280 },
} as const;

export type Quality = keyof typeof QUALITY;

export type ReliefOpts = {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  baseMm: number;
};

export type ReliefMesh = {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  ranges: { top: number; walls: number; bottom: number };
  meta: {
    cols: number;
    rows: number;
    widthMm: number;
    heightMm: number;
    depthMm: number;
    baseMm: number;
    zMin: number;
    zMax: number;
    topZMin: number;
    topZMax: number;
    triangleCount: number;
    vertexCount: number;
  };
};

/**
 * High is the production grid: 1024 on the long side, including when the
 * picture is smaller. Those extra samples only interpolate the original
 * pixels. Ultra keeps more of a picture that is already larger than 1024,
 * and never enlarges one that is not. Standard is the explicit smaller file.
 */
export function fieldCols(q: Quality, srcMax: number): number {
  const want = QUALITY[q].field;
  if (q === "high") return want;
  if (!(srcMax > 0)) return want;
  const src = Math.round(srcMax);
  if (q === "ultra") return src <= 1024 ? 1024 : Math.min(want, src);
  return want;
}

export function constrainedPreview(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iP(hone|ad|od)/.test(navigator.userAgent)) return true;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number" && mem <= 4) return true;
  return typeof window !== "undefined" && window.innerWidth < 760;
}

/** Preview uses the export field. A second, coarser grid was hiding the relief the STL actually contains. */
export function previewCols(q: Quality, _mobile = false, field = Infinity): number {
  return Math.max(8, Math.min(QUALITY[q].field, field));
}

export function exportCols(q: Quality, srcMax = Infinity): number {
  return fieldCols(q, srcMax);
}

/** Boundary of the board, clockwise in grid space, corners once. */
function boundaryRing(gx: number, gy: number): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  for (let x = 0; x < gx; x++) ring.push([x, 0]);
  for (let y = 1; y < gy; y++) ring.push([gx - 1, y]);
  for (let x = gx - 2; x >= 0; x--) ring.push([x, gy - 1]);
  for (let y = gy - 2; y >= 1; y--) ring.push([0, y]);
  return ring;
}

/** Base 0 means surface-only export (no walls, no bottom). */
export function isSurfaceOnly(baseMm: number): boolean {
  return !(baseMm > 0);
}

export function triangleEstimate(cols: number, rows: number, surfaceOnly = false): number {
  const gx = Math.max(2, cols | 0);
  const gy = Math.max(2, rows | 0);
  const top = (gx - 1) * (gy - 1) * 2;
  if (surfaceOnly) return top;
  const walls = 4 * (gx + gy - 2);
  const bottom = 2 * (gx + gy - 2);
  return top + walls + bottom;
}

function addTri(idx: Uint32Array, n: { i: number }, a: number, b: number, c: number) {
  idx[n.i++] = a;
  idx[n.i++] = b;
  idx[n.i++] = c;
}

/** Canonical Z-up solid. X = width, Y = height (image row 0 = +Y), Z = 0 bottom … base+h·depth top. */
export function buildRelief(h: Float32Array, cols: number, rows: number, opts: ReliefOpts): ReliefMesh {
  const gx = Math.max(2, cols | 0);
  const gy = Math.max(2, rows | 0);
  if (h.length < gx * gy) throw new Error("height short");
  const widthMm = opts.widthMm;
  const heightMm = opts.heightMm;
  const depthMm = Math.max(0, opts.depthMm);
  const surface = isSurfaceOnly(opts.baseMm);
  const baseMm = surface ? 0 : Math.max(0.01, opts.baseMm);
  if (!(widthMm > 0) || !(heightMm > 0)) throw new Error("board size must be > 0");

  const layer = gx * gy;
  const ring = boundaryRing(gx, gy);
  const vertexCount = layer + ring.length + 1;
  const topTris = (gx - 1) * (gy - 1) * 2;
  const wallCount = surface ? 0 : 4 * (gx + gy - 2);
  const bottomTris = surface ? 0 : ring.length;
  const triangleCount = topTris + wallCount + bottomTris;
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);
  const dx = widthMm / (gx - 1);
  const dy = heightMm / (gy - 1);
  const x0 = -widthMm / 2;
  const y0 = -heightMm / 2;

  let topZMin = Infinity;
  let topZMax = -Infinity;
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      const px = x0 + x * dx;
      const py = y0 + (gy - 1 - y) * dy;
      const z = baseMm + (h[y * gx + x] ?? 0) * depthMm;
      if (z < topZMin) topZMin = z;
      if (z > topZMax) topZMax = z;
      const t = (y * gx + x) * 3;
      positions[t] = px;
      positions[t + 1] = py;
      positions[t + 2] = z;
    }
  }
  const ringAt = (x: number, y: number) => {
    const t = (y * gx + x) * 3;
    return [positions[t]!, positions[t + 1]!] as const;
  };
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i]!;
    const [px, py] = ringAt(x, y);
    const b = (layer + i) * 3;
    positions[b] = px;
    positions[b + 1] = py;
    positions[b + 2] = 0;
  }
  const center = layer + ring.length;
  positions[center * 3] = 0;
  positions[center * 3 + 1] = 0;
  positions[center * 3 + 2] = 0;

  const n = { i: 0 };
  const top = (x: number, y: number) => y * gx + x;
  const botOf = new Map<number, number>();
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i]!;
    botOf.set(y * gx + x, layer + i);
  }
  const bot = (x: number, y: number) => botOf.get(y * gx + x)!;

  for (let y = 0; y < gy - 1; y++) {
    for (let x = 0; x < gx - 1; x++) {
      const a = top(x, y);
      const b = top(x + 1, y);
      const c = top(x + 1, y + 1);
      const d = top(x, y + 1);
      addTri(indices, n, a, d, c);
      addTri(indices, n, a, c, b);
    }
  }
  const topIdx = n.i;

  for (let x = 0; x < gx - 1 && !surface; x++) {
    addTri(indices, n, bot(x, 0), top(x, 0), top(x + 1, 0));
    addTri(indices, n, bot(x, 0), top(x + 1, 0), bot(x + 1, 0));
    addTri(indices, n, bot(x, gy - 1), bot(x + 1, gy - 1), top(x + 1, gy - 1));
    addTri(indices, n, bot(x, gy - 1), top(x + 1, gy - 1), top(x, gy - 1));
  }
  for (let y = 0; y < gy - 1 && !surface; y++) {
    addTri(indices, n, bot(0, y), top(0, y + 1), top(0, y));
    addTri(indices, n, bot(0, y), bot(0, y + 1), top(0, y + 1));
    addTri(indices, n, bot(gx - 1, y), top(gx - 1, y), top(gx - 1, y + 1));
    addTri(indices, n, bot(gx - 1, y), top(gx - 1, y + 1), bot(gx - 1, y + 1));
  }
  const wallIdx = n.i;

  if (!surface) for (let i = 0; i < ring.length; i++) addTri(indices, n, center, layer + i, layer + ((i + 1) % ring.length));
  if (n.i !== indices.length) throw new Error("index fill mismatch");

  const normals = new Float32Array(positions.length);
  fillVertexNormals(positions, indices, normals);
  return {
    positions,
    indices,
    normals,
    ranges: { top: topIdx, walls: wallIdx - topIdx, bottom: n.i - wallIdx },
    meta: {
      cols: gx,
      rows: gy,
      widthMm,
      heightMm,
      depthMm,
      baseMm,
      zMin: 0,
      zMax: topZMax,
      topZMin,
      topZMax,
      triangleCount,
      vertexCount,
    },
  };
}

export function faceNormal(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): [number, number, number, number] {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const area2 = Math.hypot(nx, ny, nz);
  const len = area2 || 1;
  return [nx / len, ny / len, nz / len, area2 * 0.5];
}

/** Rewrite millimetres on an existing solid. Indices stay; preview and STL keep this mesh. */
export function restampRelief(mesh: ReliefMesh, h: Float32Array, opts: ReliefOpts): void {
  const gx = mesh.meta.cols;
  const gy = mesh.meta.rows;
  if (h.length < gx * gy) throw new Error("height short");
  const widthMm = opts.widthMm;
  const heightMm = opts.heightMm;
  const depthMm = Math.max(0, opts.depthMm);
  const surface = isSurfaceOnly(opts.baseMm);
  if (surface !== isSurfaceOnly(mesh.meta.baseMm)) throw new Error("base on/off changes topology: rebuild");
  const baseMm = surface ? 0 : Math.max(0.01, opts.baseMm);
  if (!(widthMm > 0) || !(heightMm > 0)) throw new Error("board size must be > 0");
  const layer = gx * gy;
  const dx = widthMm / (gx - 1);
  const dy = heightMm / (gy - 1);
  const x0 = -widthMm / 2;
  const y0 = -heightMm / 2;
  const positions = mesh.positions;
  let topZMin = Infinity;
  let topZMax = -Infinity;
  for (let y = 0; y < gy; y++) {
    for (let x = 0; x < gx; x++) {
      const px = x0 + x * dx;
      const py = y0 + (gy - 1 - y) * dy;
      const z = baseMm + (h[y * gx + x] ?? 0) * depthMm;
      if (z < topZMin) topZMin = z;
      if (z > topZMax) topZMax = z;
      const t = (y * gx + x) * 3;
      positions[t] = px;
      positions[t + 1] = py;
      positions[t + 2] = z;
    }
  }
  const ring = boundaryRing(gx, gy);
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i]!;
    const t = (y * gx + x) * 3;
    const b = (layer + i) * 3;
    positions[b] = positions[t]!;
    positions[b + 1] = positions[t + 1]!;
    positions[b + 2] = 0;
  }
  const center = (layer + ring.length) * 3;
  positions[center] = 0;
  positions[center + 1] = 0;
  positions[center + 2] = 0;
  fillVertexNormals(positions, mesh.indices, mesh.normals);
  mesh.meta = {
    ...mesh.meta,
    widthMm,
    heightMm,
    depthMm,
    baseMm,
    zMin: 0,
    zMax: topZMax,
    topZMin,
    topZMax,
  };
}

export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  fillVertexNormals(positions, indices, normals);
  return normals;
}

function fillVertexNormals(positions: Float32Array, indices: Uint32Array, normals: Float32Array) {
  normals.fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3;
    const ib = indices[i + 1]! * 3;
    const ic = indices[i + 2]! * 3;
    const [nx, ny, nz] = faceNormal(
      positions[ia]!, positions[ia + 1]!, positions[ia + 2]!,
      positions[ib]!, positions[ib + 1]!, positions[ib + 2]!,
      positions[ic]!, positions[ic + 1]!, positions[ic + 2]!,
    );
    for (const o of [ia, ib, ic]) {
      normals[o] += nx;
      normals[o + 1] += ny;
      normals[o + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    normals[i]! /= len;
    normals[i + 1]! /= len;
    normals[i + 2]! /= len;
  }
  return normals;
}
