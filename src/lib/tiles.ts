/**
 * The depth model resizes every input so its LONG side is ~518 px. A 1:12 bed leg
 * therefore reaches it only ~42 px wide and comes back blurred. For long pictures we
 * run the model on overlapping, nearly square tiles along the long axis and stitch.
 *
 * Each tile's depth is only relative (unknown scale and offset), so tile k is fitted
 * to what is already merged by least squares on the overlap, then feather-blended.
 * Pure functions, no DOM: tested in tiles.check.ts with a fake model.
 */

export type Tile = { x: number; y: number; w: number; h: number };

/** Tiles in grid cells covering cols × rows. One tile when the picture is not long. */
export function planTiles(cols: number, rows: number, maxAspect = 1.6, overlap = 0.3): Tile[] {
  const tall = rows >= cols;
  const long = tall ? rows : cols;
  const short = tall ? cols : rows;
  if (long <= short * maxAspect) return [{ x: 0, y: 0, w: cols, h: rows }];
  const len = Math.min(long, Math.round(short * 1.5));
  const step = Math.max(1, Math.floor(len * (1 - overlap)));
  const count = Math.ceil((long - len) / step) + 1;
  const tiles: Tile[] = [];
  for (let k = 0; k < count; k++) {
    const at = count === 1 ? 0 : Math.round(((long - len) * k) / (count - 1));
    tiles.push(tall ? { x: 0, y: at, w: cols, h: len } : { x: at, y: 0, w: len, h: rows });
  }
  return tiles;
}

/**
 * Merge per-tile depth (each already resampled to its tile's w × h cells, in plan order)
 * into one cols × rows field. Returns raw merged depth (caller normalises).
 */
export function mergeTiles(tiles: Tile[], data: Float32Array[], cols: number, rows: number): Float32Array {
  const acc = new Float32Array(cols * rows);
  const wsum = new Float32Array(cols * rows);
  const tall = rows >= cols;
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k]!;
    const d = data[k]!;
    // Fit a·d + b to the already merged values on the overlap.
    let a = 1;
    let b = 0;
    if (k > 0) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
      for (let yy = 0; yy < t.h; yy++) {
        for (let xx = 0; xx < t.w; xx++) {
          const g = (t.y + yy) * cols + (t.x + xx);
          if (wsum[g]! <= 0) continue;
          const X = d[yy * t.w + xx]!;
          const Y = acc[g]! / wsum[g]!;
          sx += X; sy += Y; sxx += X * X; sxy += X * Y; m++;
        }
      }
      const den = m * sxx - sx * sx;
      if (m > 8 && Math.abs(den) > 1e-12) {
        a = (m * sxy - sx * sy) / den;
        b = (sy - a * sx) / m;
        if (!(a > 0)) {
          // A flipped fit means the overlap had no usable signal: match means instead.
          a = 1;
          b = (sy - sx) / m;
        }
      }
    }
    // Feather: weight rises from the tile's leading edge so seams blend.
    const len = tall ? t.h : t.w;
    const ramp = Math.max(1, Math.round(len * 0.3));
    for (let yy = 0; yy < t.h; yy++) {
      for (let xx = 0; xx < t.w; xx++) {
        const along = tall ? yy : xx;
        const fromStart = k === 0 ? ramp : along + 1;
        const fromEnd = k === tiles.length - 1 ? ramp : len - along;
        const w = Math.min(1, fromStart / ramp, fromEnd / ramp);
        const g = (t.y + yy) * cols + (t.x + xx);
        acc[g] += w * (a * d[yy * t.w + xx]! + b);
        wsum[g] += w;
      }
    }
  }
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = wsum[i]! > 0 ? acc[i]! / wsum[i]! : 0;
  return out;
}
