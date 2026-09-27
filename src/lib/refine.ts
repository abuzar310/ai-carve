import { normalizeHeight, sharpenHeight } from "./height.ts";

/** Contrast + edge-preserving smooth. Heights stay 0..1. */

export function applyContrast(h: Float32Array, contrast: number): Float32Array {
  if (!(contrast > 0) || contrast === 1) return h;
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    out[i] = Math.min(1, Math.max(0, ((h[i] ?? 0) - 0.5) * contrast + 0.5));
  }
  return out;
}

export function edgePreserveSmooth(h: Float32Array, cols: number, rows: number, passes: number, edge = 0.12): Float32Array {
  if (passes <= 0) return h;
  let cur = h;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(cur.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const c = cur[i] ?? 0;
        let s = 0;
        let w = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(cols - 1, Math.max(0, x + dx));
            const yy = Math.min(rows - 1, Math.max(0, y + dy));
            const v = cur[yy * cols + xx] ?? 0;
            const wt = Math.abs(v - c) > edge ? 0.15 : 1;
            s += v * wt;
            w += wt;
          }
        }
        next[i] = s / w;
      }
    }
    cur = next;
  }
  return cur;
}

function boxBlur(h: Float32Array, cols: number, rows: number): Float32Array {
  return edgePreserveSmooth(h, cols, rows, 1, 2);
}

/**
 * Photo noise is blended. A real edge (neighbours differ by more than ~0.2) is kept.
 * Sharpen runs before normalize so the depth slider still owns the millimetres.
 */
export function finishField(
  h: Float32Array,
  cols: number,
  rows: number,
  opts: { contrast?: number; smooth?: number; normalize?: boolean } = {},
): Float32Array {
  let out = edgePreserveSmooth(h, cols, rows, 1, 0.2);
  out = sharpenHeight(out, cols, rows, 0.3);
  if (opts.normalize !== false) out = normalizeHeight(out);
  out = applyContrast(out, opts.contrast ?? 1);
  const extra = Math.max(0, Math.min(4, Math.round(opts.smooth ?? 0)));
  if (extra > 0) {
    out = edgePreserveSmooth(out, cols, rows, extra, 0.12);
    out = sharpenHeight(out, cols, rows, 0.2);
  }
  return out;
}

export function refineHeight(
  h: Float32Array,
  cols: number,
  rows: number,
  opts: { contrast?: number; smooth?: number } = {},
): Float32Array {
  let out = applyContrast(h, opts.contrast ?? 1);
  const sm = Math.max(0, Math.min(4, Math.round(opts.smooth ?? 0)));
  if (sm > 0) {
    out = edgePreserveSmooth(out, cols, rows, sm);
    const blur = boxBlur(out, cols, rows);
    const sharp = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) {
      sharp[i] = Math.min(1, Math.max(0, (out[i] ?? 0) + 0.28 * ((out[i] ?? 0) - (blur[i] ?? 0))));
    }
    out = sharp;
  }
  return out;
}
