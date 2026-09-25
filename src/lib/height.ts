export function luma(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** 0 = deepest cut, 1 = top of the wood. White stays high unless invert is on. */
export function pixelsToHeight(data: Uint8ClampedArray, invert: boolean): Float32Array {
  const n = data.length / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = luma(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    out[i] = invert ? 1 - v : v;
  }
  return out;
}

/** Stretch the height field so the darkest pixel is 0 and the lightest is 1. LinuxCNC image-to-gcode "Normalize". */
export function normalizeHeight(h: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) return h;
  const out = new Float32Array(h.length);
  const d = hi - lo;
  for (let i = 0; i < h.length; i++) out[i] = (h[i] - lo) / d;
  return out;
}

export function sampleHeight(h: Float32Array, cols: number, rows: number, x: number, y: number): number {
  const c = Math.min(cols - 1, Math.max(0, Math.round(x)));
  const r = Math.min(rows - 1, Math.max(0, Math.round(y)));
  return h[r * cols + c] ?? 0;
}

export function heightToImageData(h: Float32Array, cols: number, rows: number): ImageData {
  const img = new ImageData(cols, rows);
  for (let i = 0; i < h.length; i++) {
    const g = Math.round(Math.min(1, Math.max(0, h[i])) * 255);
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

export async function rasterFromImage(
  src: CanvasImageSource,
  cols: number,
  invert: boolean,
  rows?: number,
): Promise<{
  height: Float32Array;
  cols: number;
  rows: number;
}> {
  const w = "width" in src ? Number(src.width) : cols;
  const h0 = "height" in src ? Number(src.height) : cols;
  const hh = Math.max(8, rows ?? Math.round((cols * h0) / Math.max(w, 1)));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = hh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.drawImage(src as CanvasImageSource, 0, 0, cols, hh);
  const { data } = ctx.getImageData(0, 0, cols, hh);
  return { height: pixelsToHeight(data, invert), cols, rows: hh };
}
