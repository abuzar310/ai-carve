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

export async function rasterFromImage(src: CanvasImageSource, cols: number, invert: boolean): Promise<{
  height: Float32Array;
  cols: number;
  rows: number;
}> {
  const w = "width" in src ? Number(src.width) : cols;
  const h0 = "height" in src ? Number(src.height) : cols;
  const rows = Math.max(8, Math.round((cols * h0) / Math.max(w, 1)));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.drawImage(src as CanvasImageSource, 0, 0, cols, rows);
  const { data } = ctx.getImageData(0, 0, cols, rows);
  return { height: pixelsToHeight(data, invert), cols, rows };
}
