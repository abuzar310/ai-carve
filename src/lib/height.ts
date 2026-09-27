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

/** Restore edges lost when a large picture is sampled down to the depth field. */
export function sharpenHeight(h: Float32Array, cols: number, rows: number, amount = 0.45): Float32Array {
  if (!(amount > 0) || cols < 3 || rows < 3) return h;
  const blur = new Float32Array(h.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(rows - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(cols - 1, Math.max(0, x + dx));
          s += h[yy * cols + xx] ?? 0;
        }
      }
      blur[y * cols + x] = s / 9;
    }
  }
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    out[i] = Math.min(1, Math.max(0, (h[i] ?? 0) + amount * ((h[i] ?? 0) - (blur[i] ?? 0))));
  }
  return out;
}

/** Bilinear resample of the same height field. */
export function resampleHeight(h: Float32Array, cols: number, rows: number, outCols: number, outRows: number): Float32Array {
  if (outCols === cols && outRows === rows) return h;
  if (outCols < 2 || outRows < 2) throw new Error("resample too small");
  const out = new Float32Array(outCols * outRows);
  const xs = (cols - 1) / (outCols - 1);
  const ys = (rows - 1) / (outRows - 1);
  for (let y = 0; y < outRows; y++) {
    const fy = y * ys;
    const y0 = Math.min(rows - 1, Math.floor(fy));
    const y1 = Math.min(rows - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < outCols; x++) {
      const fx = x * xs;
      const x0 = Math.min(cols - 1, Math.floor(fx));
      const x1 = Math.min(cols - 1, x0 + 1);
      const tx = fx - x0;
      const a = h[y0 * cols + x0] ?? 0;
      const b = h[y0 * cols + x1] ?? 0;
      const c = h[y1 * cols + x0] ?? 0;
      const d = h[y1 * cols + x1] ?? 0;
      out[y * outCols + x] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    }
  }
  return out;
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

function drawSampled(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  cols: number,
  rows: number,
) {
  if (!(sw > cols * 2) || !(sh > rows * 2)) {
    ctx.drawImage(src, 0, 0, cols, rows);
    return;
  }
  let cur: CanvasImageSource = src;
  let w = sw;
  let h = sh;
  let scratch: HTMLCanvasElement | null = null;
  while (w > cols * 2 && h > rows * 2) {
    const nw = Math.max(cols, Math.round(w / 2));
    const nh = Math.max(rows, Math.round(h / 2));
    const next = document.createElement("canvas");
    next.width = nw;
    next.height = nh;
    const nctx = next.getContext("2d");
    if (!nctx) break;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(cur, 0, 0, nw, nh);
    scratch = next;
    cur = next;
    w = nw;
    h = nh;
  }
  ctx.drawImage(scratch ?? cur, 0, 0, cols, rows);
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
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No canvas");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawSampled(ctx, src, w, h0, cols, hh);
  const { data } = ctx.getImageData(0, 0, cols, hh);
  return { height: pixelsToHeight(data, invert), cols, rows: hh };
}
