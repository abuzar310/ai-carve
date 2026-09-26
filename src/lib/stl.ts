import { faceNormal, type ReliefMesh } from "./mesh.ts";

const HEADER = "carve relief";

export function writeStl(mesh: ReliefMesh): ArrayBuffer {
  const count = mesh.meta.triangleCount;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  for (let i = 0; i < 80; i++) view.setUint8(i, HEADER.charCodeAt(i) || 0);
  view.setUint32(80, count, true);
  const { positions, indices } = mesh;
  let o = 84;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3;
    const ib = indices[i + 1]! * 3;
    const ic = indices[i + 2]! * 3;
    const ax = positions[ia]!, ay = positions[ia + 1]!, az = positions[ia + 2]!;
    const bx = positions[ib]!, by = positions[ib + 1]!, bz = positions[ib + 2]!;
    const cx = positions[ic]!, cy = positions[ic + 1]!, cz = positions[ic + 2]!;
    const [nx, ny, nz] = faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(o, v, true);
      o += 4;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

export type StlTri = {
  count: number;
  binary: boolean;
  bytes: number;
};

export function parseStl(buf: ArrayBuffer | Uint8Array): StlTri {
  const raw = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (raw.byteLength < 84) throw new Error("stl too small");
  const head = new TextDecoder("latin1").decode(raw.subarray(0, 5));
  if (head === "solid" && raw.byteLength < 1_000_000) {
    const text = new TextDecoder("latin1").decode(raw);
    if (text.includes("facet")) throw new Error("ASCII STL is not supported");
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const count = view.getUint32(80, true);
  const expect = 84 + count * 50;
  if (raw.byteLength !== expect) throw new Error(`stl size ${raw.byteLength} != ${expect}`);
  if (count < 1 || count > 50_000_000) throw new Error("stl triangle count out of range");
  return { count, binary: true, bytes: raw.byteLength };
}

export type StlStats = {
  format: "binary" | "ascii";
  bytes: number;
  triangles: number;
  uniqueVerts: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  size: [number, number, number];
  zMin: number;
  zMax: number;
  zBins: number[];
  degenerate: number;
  nan: number;
  inf: number;
  nzPos: number;
  nzNeg: number;
};

export function analyzeStl(buf: ArrayBuffer | Uint8Array): StlStats {
  const raw = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const info = parseStl(raw);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const verts = new Map<string, number>();
  const bbox = { min: [Infinity, Infinity, Infinity] as [number, number, number], max: [-Infinity, -Infinity, -Infinity] as [number, number, number] };
  const zBins = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let degenerate = 0;
  let nan = 0;
  let inf = 0;
  let nzPos = 0;
  let nzNeg = 0;
  const zs: number[] = [];
  for (let t = 0; t < info.count; t++) {
    const o = 84 + t * 50;
    const nx = view.getFloat32(o, true);
    const nz = view.getFloat32(o + 8, true);
    if (nz > 0.2) nzPos++;
    if (nz < -0.2) nzNeg++;
    if (!Number.isFinite(nx) || !Number.isFinite(nz)) inf++;
    const pts: [number, number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const x = view.getFloat32(o + 12 + k * 12, true);
      const y = view.getFloat32(o + 16 + k * 12, true);
      const z = view.getFloat32(o + 20 + k * 12, true);
      pts.push([x, y, z]);
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) nan++;
      else if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) inf++;
      for (let a = 0; a < 3; a++) {
        const v = pts[k]![a]!;
        if (v < bbox.min[a]!) bbox.min[a] = v;
        if (v > bbox.max[a]!) bbox.max[a] = v;
      }
      zs.push(z);
      const key = `${Math.round(x * 1e4)}|${Math.round(y * 1e4)}|${Math.round(z * 1e4)}`;
      verts.set(key, (verts.get(key) ?? 0) + 1);
    }
    const area = faceNormal(pts[0]![0], pts[0]![1], pts[0]![2], pts[1]![0], pts[1]![1], pts[1]![2], pts[2]![0], pts[2]![1], pts[2]![2])[3];
    if (area < 1e-12) degenerate++;
  }
  const zMin = bbox.min[2];
  const zMax = bbox.max[2];
  const span = zMax - zMin || 1;
  for (const z of zs) {
    const bin = Math.min(9, Math.max(0, Math.floor(((z - zMin) / span) * 10)));
    zBins[bin]!++;
  }
  return {
    format: "binary",
    bytes: info.bytes,
    triangles: info.count,
    uniqueVerts: verts.size,
    bbox,
    size: [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]],
    zMin,
    zMax,
    zBins,
    degenerate,
    nan,
    inf,
    nzPos,
    nzNeg,
  };
}
