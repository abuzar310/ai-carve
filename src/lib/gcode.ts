import { sampleHeight } from "./height.ts";

export type Cut = {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  bitMm: number;
  stepPct: number;
  safeZ: number;
  feed: number;
  plunge: number;
  spindle: number;
  passMm: number;
  cross: boolean;
  stockMm: number;
};

/** Stepover from bit diameter, same rule as Aspire / LinuxCNC 3D finish (~10–20% of the bit). */
export function stepOf(cut: Cut): number {
  return Math.max(0.2, cut.bitMm * (cut.stepPct / 100));
}

const STRAIGHT = 0.02;

function zAt(h: Float32Array, cols: number, rows: number, px: number, py: number, depthMm: number, maxD: number): number {
  const t = sampleHeight(h, cols, rows, px, py);
  return Math.max(-(1 - t) * depthMm, -maxD);
}

function raster(
  lines: string[],
  h: Float32Array,
  cols: number,
  rows: number,
  cut: Cut,
  maxD: number,
  alongY: boolean,
) {
  const step = stepOf(cut);
  const spanX = cut.widthMm;
  const spanY = cut.heightMm;
  const nScan = Math.max(2, Math.ceil((alongY ? spanX : spanY) / step));
  const nAlong = Math.max(2, Math.ceil((alongY ? spanY : spanX) / step));
  for (let is = 0; is <= nScan; is++) {
    const tScan = is / nScan;
    const fwd = is % 2 === 0;
    const xScan = alongY ? tScan * spanX : 0;
    const yScan = alongY ? 0 : tScan * spanY;
    lines.push("G0 Z" + cut.safeZ.toFixed(3));
    const t0 = fwd ? 0 : 1;
    const x0 = alongY ? xScan : t0 * spanX;
    const y0 = alongY ? t0 * spanY : yScan;
    lines.push("G0 X" + x0.toFixed(3) + " Y" + y0.toFixed(3));
    let lastZ = NaN;
    for (let ia = 0; ia <= nAlong; ia++) {
      const t = fwd ? ia / nAlong : 1 - ia / nAlong;
      const x = alongY ? xScan : t * spanX;
      const y = alongY ? t * spanY : yScan;
      const px = (x / spanX) * (cols - 1);
      const py = (y / spanY) * (rows - 1);
      const z = zAt(h, cols, rows, px, py, cut.depthMm, maxD);
      const first = ia === 0;
      const last = ia === nAlong;
      if (first) {
        lines.push("G1 Z" + z.toFixed(3) + " F" + cut.plunge);
        lines.push("G1 X" + x.toFixed(3) + " Y" + y.toFixed(3) + " Z" + z.toFixed(3) + " F" + cut.feed);
        lastZ = z;
        continue;
      }
      if (!last && Number.isFinite(lastZ) && Math.abs(z - lastZ) < STRAIGHT) continue;
      lines.push("G1 X" + x.toFixed(3) + " Y" + y.toFixed(3) + " Z" + z.toFixed(3) + " F" + cut.feed);
      lastZ = z;
    }
  }
}

export function reliefGcode(h: Float32Array, cols: number, rows: number, cut: Cut): string {
  const step = stepOf(cut);
  const pass = cut.passMm > 0 ? cut.passMm : cut.depthMm;
  const nPass = Math.max(1, Math.ceil(cut.depthMm / pass - 1e-9));
  const lines = [
    "(carve relief — 2.5D from picture)",
    "(Z0 = top of the stock. Deepest cut is Z=-depth.)",
    `(size ${cut.widthMm}x${cut.heightMm} mm  depth ${cut.depthMm} mm  stock ${cut.stockMm} mm)`,
    `(bit ${cut.bitMm} mm  stepover ${step.toFixed(2)} mm = ${cut.stepPct}%  layers ${nPass})`,
    `(feed ${cut.feed} plunge ${cut.plunge} mm/min  spindle ${cut.spindle})`,
    "G21 G90 G17",
    "G0 Z" + cut.safeZ.toFixed(3),
    "M3 S" + Math.round(cut.spindle),
  ];
  for (let i = 1; i <= nPass; i++) {
    const maxD = Math.min(cut.depthMm, i * pass);
    lines.push(`(layer ${i}/${nPass}  max Z=-${maxD.toFixed(2)})`);
    raster(lines, h, cols, rows, cut, maxD, false);
    if (cut.cross && i === nPass) {
      lines.push("(cross pass — columns)");
      raster(lines, h, cols, rows, cut, maxD, true);
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
