import { sampleHeight } from "./height.ts";

function normal(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len] as const;
}

function tri(
  view: DataView,
  at: { n: number },
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
) {
  const [nx, ny, nz] = normal(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  let o = at.n;
  for (const v of [nx, ny, nz, ...a, ...b, ...c]) {
    view.setFloat32(o, v, true);
    o += 4;
  }
  view.setUint16(o, 0, true);
  at.n = o + 2;
}

/** Solid relief: picture as the top, flat back so a CAM or printer can hold it. */
export function reliefStl(h: Float32Array, cols: number, rows: number, widthMm: number, heightMm: number, depthMm: number): ArrayBuffer {
  const gx = cols;
  const gy = rows;
  const top = (gx - 1) * (gy - 1) * 2;
  const walls = (gx - 1) * 2 * 2 + (gy - 1) * 2 * 2;
  const bottom = 2;
  const count = top + walls + bottom;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  const header = "carve relief";
  for (let i = 0; i < 80; i++) view.setUint8(i, header.charCodeAt(i) || 0);
  view.setUint32(80, count, true);
  const at = { n: 84 };
  const pt = (ix: number, iy: number, z: number): [number, number, number] => [
    (ix / (gx - 1)) * widthMm,
    (iy / (gy - 1)) * heightMm,
    z,
  ];
  const up = (ix: number, iy: number): [number, number, number] => {
    const z = sampleHeight(h, cols, rows, ix, iy) * depthMm;
    return pt(ix, iy, z);
  };

  for (let y = 0; y < gy - 1; y++) {
    for (let x = 0; x < gx - 1; x++) {
      const a = up(x, y);
      const b = up(x + 1, y);
      const c = up(x + 1, y + 1);
      const d = up(x, y + 1);
      tri(view, at, a, b, c);
      tri(view, at, a, c, d);
    }
  }
  for (let x = 0; x < gx - 1; x++) {
    const a = up(x, 0);
    const b = up(x + 1, 0);
    tri(view, at, pt(x, 0, 0), b, a);
    tri(view, at, pt(x, 0, 0), pt(x + 1, 0, 0), b);
    const c = up(x, gy - 1);
    const d = up(x + 1, gy - 1);
    tri(view, at, pt(x, gy - 1, 0), c, d);
    tri(view, at, pt(x, gy - 1, 0), d, pt(x + 1, gy - 1, 0));
  }
  for (let y = 0; y < gy - 1; y++) {
    const a = up(0, y);
    const b = up(0, y + 1);
    tri(view, at, pt(0, y, 0), a, b);
    tri(view, at, pt(0, y, 0), b, pt(0, y + 1, 0));
    const c = up(gx - 1, y);
    const d = up(gx - 1, y + 1);
    tri(view, at, pt(gx - 1, y, 0), d, c);
    tri(view, at, pt(gx - 1, y, 0), pt(gx - 1, y + 1, 0), d);
  }
  tri(view, at, pt(0, 0, 0), pt(0, gy - 1, 0), pt(gx - 1, gy - 1, 0));
  tri(view, at, pt(0, 0, 0), pt(gx - 1, gy - 1, 0), pt(gx - 1, 0, 0));
  return buf;
}

export function stlCount(buf: ArrayBuffer): number {
  return new DataView(buf).getUint32(80, true);
}
