/**
 * IMAGE → pixelsToHeight → refineHeight → buildRelief → validateMesh
 *                                    ├→ Preview (same typed arrays)
 *                                    └→ writeStl → parseStl → validateStl
 *
 * One height-field solid: relief top + base + walls + bottom.
 * Preview and STL both come from ReliefMesh. Quality only changes sample density.
 */

export const QUALITY = {
  draft: { label: "Draft", preview: 96, export: 96 },
  standard: { label: "Standard", preview: 160, export: 220 },
  high: { label: "High", preview: 200, export: 480 },
  ultra: { label: "CNC / Ultra", preview: 200, export: 720 },
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

export function previewCols(q: Quality, mobile = false): number {
  return Math.min(QUALITY[q].preview, mobile ? 128 : 200);
}

export function exportCols(q: Quality): number {
  return QUALITY[q].export;
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
  const baseMm = Math.max(0.01, opts.baseMm);
  if (!(widthMm > 0) || !(heightMm > 0)) throw new Error("board size must be > 0");

  const layer = gx * gy;
  const vertexCount = layer * 2;
  const topCells = (gx - 1) * (gy - 1);
  const wallCount = 4 * (gx + gy - 2);
  const triangleCount = topCells * 4 + wallCount;
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
      const b = (layer + y * gx + x) * 3;
      positions[t] = px;
      positions[t + 1] = py;
      positions[t + 2] = z;
      positions[b] = px;
      positions[b + 1] = py;
      positions[b + 2] = 0;
    }
  }

  const n = { i: 0 };
  const top = (x: number, y: number) => y * gx + x;
  const bot = (x: number, y: number) => layer + y * gx + x;

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

  for (let x = 0; x < gx - 1; x++) {
    addTri(indices, n, bot(x, 0), top(x, 0), top(x + 1, 0));
    addTri(indices, n, bot(x, 0), top(x + 1, 0), bot(x + 1, 0));
    addTri(indices, n, bot(x, gy - 1), bot(x + 1, gy - 1), top(x + 1, gy - 1));
    addTri(indices, n, bot(x, gy - 1), top(x + 1, gy - 1), top(x, gy - 1));
  }
  for (let y = 0; y < gy - 1; y++) {
    addTri(indices, n, bot(0, y), top(0, y + 1), top(0, y));
    addTri(indices, n, bot(0, y), bot(0, y + 1), top(0, y + 1));
    addTri(indices, n, bot(gx - 1, y), top(gx - 1, y), top(gx - 1, y + 1));
    addTri(indices, n, bot(gx - 1, y), top(gx - 1, y + 1), bot(gx - 1, y + 1));
  }
  const wallIdx = n.i;

  for (let y = 0; y < gy - 1; y++) {
    for (let x = 0; x < gx - 1; x++) {
      const a = bot(x, y);
      const b = bot(x + 1, y);
      const c = bot(x + 1, y + 1);
      const d = bot(x, y + 1);
      addTri(indices, n, a, b, c);
      addTri(indices, n, a, c, d);
    }
  }
  if (n.i !== indices.length) throw new Error("index fill mismatch");

  const normals = vertexNormals(positions, indices);
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

export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
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
