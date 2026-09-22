import { sampleHeight } from "./height.ts";

export type Cut = {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  stepMm: number;
  safeZ: number;
  feed: number;
  plunge: number;
};

export function reliefGcode(h: Float32Array, cols: number, rows: number, cut: Cut): string {
  const lines = [
    "(carve relief — 2.5D from picture)",
    "G21 G90 G17",
    "G0 Z" + cut.safeZ.toFixed(3),
    "M3 S18000",
  ];
  const nx = Math.max(2, Math.ceil(cut.widthMm / cut.stepMm));
  const ny = Math.max(2, Math.ceil(cut.heightMm / cut.stepMm));
  for (let iy = 0; iy <= ny; iy++) {
    const y = (iy / ny) * cut.heightMm;
    const py = (iy / ny) * (rows - 1);
    const fwd = iy % 2 === 0;
    lines.push("G0 Z" + cut.safeZ.toFixed(3));
    const x0 = fwd ? 0 : cut.widthMm;
    lines.push("G0 X" + x0.toFixed(3) + " Y" + y.toFixed(3));
    let first = true;
    for (let ix = 0; ix <= nx; ix++) {
      const i = fwd ? ix : nx - ix;
      const x = (i / nx) * cut.widthMm;
      const px = (i / nx) * (cols - 1);
      const z = -(1 - sampleHeight(h, cols, rows, px, py)) * cut.depthMm;
      if (first) {
        lines.push("G1 Z" + z.toFixed(3) + " F" + cut.plunge);
        first = false;
      }
      lines.push("G1 X" + x.toFixed(3) + " Y" + y.toFixed(3) + " Z" + z.toFixed(3) + " F" + cut.feed);
    }
  }
  lines.push("G0 Z" + cut.safeZ.toFixed(3));
  lines.push("M5");
  lines.push("G0 X0 Y0");
  lines.push("M30");
  return lines.join("\n") + "\n";
}

export function gcodeSpan(src: string): { minX: number; maxX: number; minZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  for (const line of src.split(/\n/)) {
    const x = line.match(/X(-?\d+\.?\d*)/);
    const z = line.match(/Z(-?\d+\.?\d*)/);
    if (x) {
      const v = Number(x[1]);
      if (v < minX) minX = v;
      if (v > maxX) maxX = v;
    }
    if (z) minZ = Math.min(minZ, Number(z[1]));
  }
  return { minX, maxX, minZ };
}
