/**
 * Relief = large FORM (from a depth map) + small DETAIL (from the picture).
 *
 * Old pipeline used picture brightness as height and then sharpened it, so every
 * edge became a 1 mm → 3 mm cliff and the scene had no front/back. Here:
 *   form   = smoothed, equalised depth (what is near is high)
 *   detail = band-pass of brightness, soft-clipped, small weight
 *   then slots a cutter cannot enter are filled, needles removed, cliffs capped.
 *
 * All fields are 0..1, row-major, cols × rows. Pure functions, no DOM.
 */

export type ReliefInput = {
  luma: Float32Array;
  depth: Float32Array | null;
  /** Opacity per cell from a transparent PNG; transparent = background. */
  alpha?: Float32Array | null;
  cols: number;
  rows: number;
};

export type ReliefOpts = {
  /** 0..1 share of height given to fine picture detail. */
  detail?: number;
  /** 0..4 extra smoothing of the form. */
  smooth?: number;
  /** 0..1 how much the depth histogram is spread out (bas-relief compression). */
  equalize?: number;
  /** 0..1 how strongly surface texture (grain, scratches, speckle) is removed. */
  clean?: number;
  /** Radius in cells (at 1024) of slots to fill completely. 0 = keep grooves. */
  pitFill?: number;
  /**
   * Turned (lathe) piece such as a bed leg or baluster: the shape comes from the
   * silhouette — every row is a half-round of that row's radius — instead of the
   * depth model, and the background is cut to 0.
   */
  turned?: boolean;
  /**
   * Cut a plain background (black, white, one flat colour or transparent) to 0.
   * "auto" (default) does it only when the picture's border is one flat colour.
   */
  cutBackground?: boolean | "auto";
  /** Max rise per grid cell at a 1024 grid, in 0..1 height units. */
  maxStep?: number;
};

/** One horizontal + vertical running-sum box blur of radius r (edges clamped). */
function boxPass(src: Float32Array, cols: number, rows: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let y = 0; y < rows; y++) {
    const o = y * cols;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[o + Math.min(cols - 1, Math.max(0, k))]!;
    for (let x = 0; x < cols; x++) {
      tmp[o + x] = s / win;
      s += src[o + Math.min(cols - 1, x + r + 1)]! - src[o + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < cols; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(rows - 1, Math.max(0, k)) * cols + x]!;
    for (let y = 0; y < rows; y++) {
      out[y * cols + x] = s / win;
      s += tmp[Math.min(rows - 1, y + r + 1) * cols + x]! - tmp[Math.max(0, y - r) * cols + x]!;
    }
  }
  return out;
}

/** Gaussian blur approximated by three box passes. O(n) for any sigma. */
export function gaussianBlur(h: Float32Array, cols: number, rows: number, sigma: number): Float32Array {
  if (!(sigma > 0.3)) return h;
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  let out = h;
  for (let i = 0; i < 3; i++) out = boxPass(out, cols, rows, ((i < m ? wl : wu) - 1) / 2);
  return out;
}

function percentile(h: Float32Array, p: number): number {
  const step = Math.max(1, Math.floor(h.length / 200_000));
  const s: number[] = [];
  for (let i = 0; i < h.length; i += step) s.push(h[i]!);
  s.sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]!;
}

/** Stretch to 0..1 ignoring the extreme 0.5 % at each end, so one hot pixel can't flatten the rest. */
export function robustNormalize(h: Float32Array, clip = 0.005): Float32Array {
  const lo = percentile(h, clip);
  const hi = percentile(h, 1 - clip);
  const out = new Float32Array(h.length);
  const d = hi - lo;
  if (!(d > 1e-9)) return out.fill(0.5);
  for (let i = 0; i < h.length; i++) out[i] = Math.min(1, Math.max(0, (h[i]! - lo) / d));
  return out;
}

/** Mix a field with its histogram-equalised self. Spreads crowded depth so the subject gets range. */
export function equalizeMix(h: Float32Array, amount: number, bins = 1024): Float32Array {
  if (!(amount > 0)) return h;
  const hist = new Float64Array(bins);
  for (let i = 0; i < h.length; i++) hist[Math.min(bins - 1, Math.max(0, Math.floor(h[i]! * bins)))]!++;
  const cdf = new Float32Array(bins);
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b]!;
    cdf[b] = acc / h.length;
  }
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!;
    const eq = cdf[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]!;
    out[i] = v * (1 - amount) + eq * amount;
  }
  return out;
}

/** Separable square min/max filter of radius r. */
function rankFilter(h: Float32Array, cols: number, rows: number, r: number, max: boolean): Float32Array {
  if (r < 1) return h;
  const pick = max ? Math.max : Math.min;
  const tmp = new Float32Array(h.length);
  const out = new Float32Array(h.length);
  for (let y = 0; y < rows; y++) {
    const o = y * cols;
    for (let x = 0; x < cols; x++) {
      let v = h[o + x]!;
      for (let k = 1; k <= r; k++) v = pick(v, h[o + Math.max(0, x - k)]!, h[o + Math.min(cols - 1, x + k)]!);
      tmp[o + x] = v;
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let v = tmp[y * cols + x]!;
      for (let k = 1; k <= r; k++) v = pick(v, tmp[Math.max(0, y - k) * cols + x]!, tmp[Math.min(rows - 1, y + k) * cols + x]!);
      out[y * cols + x] = v;
    }
  }
  return out;
}

/** Closing: fills pits and slots narrower than 2r+1 cells (where a cutter can't reach). */
export function closeField(h: Float32Array, cols: number, rows: number, r: number): Float32Array {
  return rankFilter(rankFilter(h, cols, rows, r, true), cols, rows, r, false);
}

/** Opening: removes needles narrower than 2r+1 cells. */
export function openField(h: Float32Array, cols: number, rows: number, r: number): Float32Array {
  return rankFilter(rankFilter(h, cols, rows, r, false), cols, rows, r, true);
}

/**
 * Two-pass chamfer sweeps over 8 neighbours, giving the closest field whose
 * rise per cell is at most `step`.
 * "fill" raises the low side of a cliff, "cap" lowers the high side.
 */
function lipschitz(h: Float32Array, cols: number, rows: number, step: number, fill: boolean): Float32Array {
  const out = Float32Array.from(h);
  const d = step * Math.SQRT2;
  const sgn = fill ? 1 : -1;
  const relax = (i: number, j: number, st: number) => {
    const cand = out[j]! - sgn * st;
    if (sgn * (cand - out[i]!) > 0) out[i] = cand;
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (x > 0) relax(i, i - 1, step);
      if (y > 0) {
        relax(i, i - cols, step);
        if (x > 0) relax(i, i - cols - 1, d);
        if (x < cols - 1) relax(i, i - cols + 1, d);
      }
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (x < cols - 1) relax(i, i + 1, step);
      if (y < rows - 1) {
        relax(i, i + cols, step);
        if (x < cols - 1) relax(i, i + cols + 1, d);
        if (x > 0) relax(i, i + cols - 1, d);
      }
    }
  }
  return out;
}

/** Cap slope at `step` per cell. Averaging fill and cap centres the ramp on the original edge. */
export function limitSlope(h: Float32Array, cols: number, rows: number, step: number): Float32Array {
  if (!(step > 0)) return h;
  const up = lipschitz(h, cols, rows, step, true);
  const down = lipschitz(h, cols, rows, step, false);
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) out[i] = 0.5 * (up[i]! + down[i]!);
  return out;
}


/** Mean filter (single box pass) — the building block of the guided filter. */
function boxMean(h: Float32Array, cols: number, rows: number, r: number): Float32Array {
  return boxPass(h, cols, rows, Math.max(1, Math.round(r)));
}

/**
 * Guided filter (He et al.). Smooths `p` but keeps edges that exist in the guide `I`.
 * O(n) for any radius.
 */
export function guidedFilter(I: Float32Array, p: Float32Array, cols: number, rows: number, r: number, eps: number): Float32Array {
  const n = cols * rows;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i]! * p[i]!;
    II[i] = I[i]! * I[i]!;
  }
  const mI = boxMean(I, cols, rows, r);
  const mp = boxMean(p, cols, rows, r);
  const mIp = boxMean(Ip, cols, rows, r);
  const mII = boxMean(II, cols, rows, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i]! - mI[i]! * mI[i]!;
    const c = mIp[i]! - mI[i]! * mp[i]!;
    a[i] = c / (v + eps);
    b[i] = mp[i]! - a[i]! * mI[i]!;
  }
  const ma = boxMean(a, cols, rows, r);
  const mb = boxMean(b, cols, rows, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i]! * I[i]! + mb[i]!;
  return q;
}

/**
 * Rolling guidance filter (Zhang et al. 2014) with a guided-filter core.
 * Removes texture smaller than ~sigma (wood grain, stone speckle, JPEG noise)
 * and then restores the edges of everything larger (bricks, curtain folds, frame).
 */
export function removeTexture(h: Float32Array, cols: number, rows: number, sigma: number, eps = 0.004, iters = 4): Float32Array {
  if (!(sigma > 0.3)) return h;
  let J = gaussianBlur(h, cols, rows, sigma);
  const r = Math.max(1, Math.round(sigma * 1.5));
  for (let t = 0; t < iters; t++) J = guidedFilter(J, h, cols, rows, r, eps);
  return J;
}

/** Median and spread of the picture's outer ring of pixels. */
function borderStats(luma: Float32Array, cols: number, rows: number): { bg: number; spread: number } {
  const edge: number[] = [];
  for (let x = 0; x < cols; x++) edge.push(luma[x]!, luma[(rows - 1) * cols + x]!);
  for (let y = 1; y < rows - 1; y++) edge.push(luma[y * cols]!, luma[y * cols + cols - 1]!);
  edge.sort((a, b) => a - b);
  const bg = edge[Math.floor(edge.length / 2)]!;
  // 80th percentile of distance from the median: robust to a subject touching the edge.
  const dev = edge.map((v) => Math.abs(v - bg)).sort((a, b) => a - b);
  return { bg, spread: dev[Math.floor(dev.length * 0.8)]! };
}

/**
 * Subject mask (1 = subject, 0 = background), or null if there is no plain background.
 * Background = cells connected to the picture's border that match the border colour
 * (flood fill), so dark detail *inside* the subject is never mistaken for background.
 * A transparent PNG uses its alpha directly.
 */
export function backgroundMask(
  luma: Float32Array,
  cols: number,
  rows: number,
  alpha?: Float32Array | null,
  tol = 0.07,
): Uint8Array | null {
  const n = cols * rows;
  const mask = new Uint8Array(n);
  if (alpha) {
    let k = 0;
    for (let i = 0; i < n; i++) if (alpha[i]! >= 0.5) (mask[i] = 1, k++);
    return k > n * 0.02 && k < n * 0.98 ? mask : null;
  }
  const { bg, spread } = borderStats(luma, cols, rows);
  if (spread > 0.04) return null; // busy border (like a carved frame): nothing to cut
  const soft = gaussianBlur(luma, cols, rows, 1);
  const isBg = (i: number) => Math.abs(soft[i]! - bg) <= tol;
  mask.fill(1);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (mask[i] === 1 && isBg(i)) {
      mask[i] = 0;
      stack.push(i);
    }
  };
  for (let x = 0; x < cols; x++) (seed(x), seed((rows - 1) * cols + x));
  for (let y = 0; y < rows; y++) (seed(y * cols), seed(y * cols + cols - 1));
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % cols;
    if (x > 0) seed(i - 1);
    if (x < cols - 1) seed(i + 1);
    if (i >= cols) seed(i - cols);
    if (i < n - cols) seed(i + cols);
  }
  // Drop specks (noise in the background) with a small opening.
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = mask[i]!;
  const o = openField(f, cols, rows, 1);
  let k = 0;
  for (let i = 0; i < n; i++) (mask[i] = o[i]! > 0.5 ? 1 : 0, (k += mask[i]!));
  return k > n * 0.03 && k < n * 0.97 ? mask : null;
}

/** Fill each row between its outermost subject cells (a turned leg has no holes across). */
function fillRows(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < rows; y++) {
    let a = -1;
    let b = -1;
    for (let x = 0; x < cols; x++) if (mask[y * cols + x]) (a < 0 && (a = x), (b = x));
    if (a >= 0) out.fill(1, y * cols + a, y * cols + b + 1);
  }
  return out;
}

/** Outline of a leg on a plain (or transparent) background, rows filled. Null if none found. */
export function silhouette(luma: Float32Array, cols: number, rows: number, alpha?: Float32Array | null): Uint8Array | null {
  const m = backgroundMask(luma, cols, rows, alpha);
  return m ? fillRows(m, cols, rows) : null;
}

/**
 * Lathe profile from the silhouette. Round parts: z = sqrt(r² − d²) / rMax per row, so bulbs
 * stand proud and necks sit low. Square blocks (the widest straight-sided runs, like the
 * pedestals of a bed leg) get a flat face with chamfered edges instead of a round top.
 */
export function turnedForm(mask: Uint8Array, cols: number, rows: number): Float32Array {
  const left = new Float32Array(rows).fill(NaN);
  const right = new Float32Array(rows).fill(NaN);
  for (let y = 0; y < rows; y++) {
    let a = -1;
    let b = -1;
    for (let x = 0; x < cols; x++) if (mask[y * cols + x]) (a < 0 && (a = x), (b = x));
    if (a >= 0) {
      left[y] = a - 0.5;
      right[y] = b + 0.5;
    }
  }
  const sm = (arr: Float32Array) => {
    const out = Float32Array.from(arr);
    for (let y = 0; y < rows; y++) {
      if (!Number.isFinite(arr[y]!)) continue;
      let s = 0;
      let n = 0;
      for (let k = -2; k <= 2; k++) {
        const v = arr[Math.min(rows - 1, Math.max(0, y + k))]!;
        if (Number.isFinite(v)) (s += v, n++);
      }
      out[y] = s / n;
    }
    return out;
  };
  const L = sm(left);
  const R = sm(right);
  let rMax = 0;
  for (let y = 0; y < rows; y++) if (Number.isFinite(L[y]!)) rMax = Math.max(rMax, (R[y]! - L[y]!) / 2);
  const out = new Float32Array(cols * rows);
  if (!(rMax > 0)) return out;

  // Blocks: runs of rows at ≥ 93 % of the widest width whose edges barely move,
  // at least as long as half the width.
  const block = new Uint8Array(rows);
  const minRun = Math.max(3, Math.round(rMax));
  let start = -1;
  for (let y = 0; y <= rows; y++) {
    const wide =
      y < rows &&
      Number.isFinite(L[y]!) &&
      (R[y]! - L[y]!) / 2 >= rMax * 0.93 &&
      (y === 0 || !Number.isFinite(L[y - 1]!) || (Math.abs(L[y]! - L[y - 1]!) < 0.6 && Math.abs(R[y]! - R[y - 1]!) < 0.6));
    if (wide && start < 0) start = y;
    if (!wide && start >= 0) {
      if (y - start >= minRun) block.fill(1, start, y);
      start = -1;
    }
  }

  for (let y = 0; y < rows; y++) {
    if (!Number.isFinite(L[y]!)) continue;
    const c = (L[y]! + R[y]!) / 2;
    const r = (R[y]! - L[y]!) / 2;
    const cham = Math.max(1, r * 0.2);
    for (let x = 0; x < cols; x++) {
      const d = Math.abs(x - c);
      if (d >= r) continue;
      out[y * cols + x] = block[y]
        ? (Math.min(1, 0.35 + (0.65 * (r - d)) / cham) * r) / rMax // flat face, chamfered edge
        : Math.sqrt(r * r - d * d) / rMax;
    }
  }
  return out;
}

export function composeRelief(input: ReliefInput, opts: ReliefOpts = {}): Float32Array {
  const { luma, depth, cols, rows } = input;
  const n = cols * rows;
  if (luma.length < n) throw new Error("luma short");
  if (depth && depth.length < n) throw new Error("depth short");
  const s = Math.max(cols, rows) / 1024;
  const detailW = Math.min(0.6, Math.max(0, opts.detail ?? 0.35));
  const smooth = Math.max(0, Math.min(4, opts.smooth ?? 0));
  const clean = Math.min(1, Math.max(0, opts.clean ?? 0.5));

  // CLEAN: strip surface texture (grain, scratches, speckle) but keep real edges.
  const structure = clean > 0 ? removeTexture(luma, cols, rows, (1 + 2 * clean) * s, 0.002) : luma;

  // MASK: turned legs always need their outline; other pieces cut a plain background.
  const cut = opts.cutBackground ?? "auto";
  const legMask = opts.turned ? silhouette(luma, cols, rows, input.alpha) : null;
  const subject = legMask ?? (cut === false ? null : backgroundMask(luma, cols, rows, input.alpha));

  // FORM
  let form: Float32Array;
  if (legMask) {
    form = gaussianBlur(turnedForm(legMask, cols, rows), cols, rows, 0.6 + smooth);
  } else {
    let formSrc: Float32Array;
    if (depth) formSrc = guidedFilter(structure, depth, cols, rows, 6 * s, 1e-3);
    else formSrc = structure;
    const formSigma = (depth ? 1 : 10) * s + smooth * 2 * s;
    form = gaussianBlur(formSrc, cols, rows, formSigma);
    if (subject) {
      // Stretch the subject alone over the full range; the background must not use it up.
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < n; i++) if (subject[i]) (lo = Math.min(lo, form[i]!), (hi = Math.max(hi, form[i]!)));
      const d = hi - lo > 1e-9 ? hi - lo : 1;
      const f2 = new Float32Array(n);
      for (let i = 0; i < n; i++) f2[i] = subject[i] ? 0.12 + (0.88 * (form[i]! - lo)) / d : 0;
      form = f2;
    } else {
      form = robustNormalize(form);
    }
    form = equalizeMix(form, opts.equalize ?? (depth ? 0.35 : 0));
  }

  // DETAIL: band-pass of the cleaned picture. Coarse blur removes lighting gradients.
  const fine = gaussianBlur(structure, cols, rows, 0.5 * s);
  const coarse = gaussianBlur(structure, cols, rows, 6 * s);
  let sum = 0;
  let sum2 = 0;
  let cnt = 0;
  const band = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = fine[i]! - coarse[i]!;
    band[i] = v;
    if (subject && !subject[i]) continue;
    sum += v;
    sum2 += v * v;
    cnt++;
  }
  cnt = Math.max(1, cnt);
  const mean = sum / cnt;
  const sd = Math.sqrt(Math.max(1e-12, sum2 / cnt - mean * mean));

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const det = Math.tanh((band[i]! - mean) / (2.5 * sd)); // soft clip to −1..1
    if (subject) {
      // Detail rides on the form (scaled by it) so it fades out at the outline.
      out[i] = subject[i] ? form[i]! * (1 - detailW * 0.5 + det * detailW * 0.5) : 0;
    } else {
      out[i] = form[i]! * (1 - detailW) + (0.5 + 0.5 * det) * detailW;
    }
  }

  // Carvability: optional pit fill, drop needles, cap cliffs, light final blur.
  const rPit = Math.round((opts.pitFill ?? 0) * s);
  let h = rPit > 0 ? closeField(out, cols, rows, rPit) : out;
  h = openField(h, cols, rows, Math.max(1, Math.round(s)));
  h = limitSlope(h, cols, rows, (opts.maxStep ?? 0.09) / s);
  h = gaussianBlur(h, cols, rows, 0.5 * s);
  if (subject) {
    // Background exactly 0, tallest point exactly 1.
    let hi = 0;
    for (let i = 0; i < n; i++) if (subject[i]) hi = Math.max(hi, h[i]!);
    for (let i = 0; i < n; i++) h[i] = subject[i] ? Math.min(1, Math.max(0, h[i]!) / (hi || 1)) : 0;
    return h;
  }
  return robustNormalize(h, 0);
}
