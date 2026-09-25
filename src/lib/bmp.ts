/** 24-bit Windows BMP — ArtCAM start screen Open Existing Model / File → Open. */

export function reliefBmp(
  h: Float32Array,
  cols: number,
  rows: number,
  widthMm = cols * 0.4,
  heightMm = rows * 0.4,
): Uint8Array {
  if (cols < 1 || rows < 1) throw new Error("bmp grid out of range");
  if (h.length < cols * rows) throw new Error("bmp height short");
  const rowBytes = (cols * 3 + 3) & ~3;
  const pixels = rowBytes * rows;
  const off = 14 + 40;
  const out = new Uint8Array(off + pixels);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, out.length, true);
  view.setUint32(10, off, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, cols, true);
  view.setInt32(22, rows, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixels, true);
  view.setInt32(38, Math.max(1, Math.round((cols * 1000) / Math.max(widthMm, 0.001))), true);
  view.setInt32(42, Math.max(1, Math.round((rows * 1000) / Math.max(heightMm, 0.001))), true);
  for (let y = 0; y < rows; y++) {
    const src = (rows - 1 - y) * cols;
    const dst = off + y * rowBytes;
    for (let x = 0; x < cols; x++) {
      const g = Math.max(0, Math.min(255, Math.round((h[src + x] ?? 0) * 255)));
      const o = dst + x * 3;
      out[o] = out[o + 1] = out[o + 2] = g;
    }
  }
  return out;
}

export function bmpSize(buf: Uint8Array): { cols: number; rows: number; bits: number; ppmX: number; ppmY: number } {
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error("not a BMP");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    cols: view.getInt32(18, true),
    rows: Math.abs(view.getInt32(22, true)),
    bits: view.getUint16(28, true),
    ppmX: view.getInt32(38, true),
    ppmY: view.getInt32(42, true),
  };
}
