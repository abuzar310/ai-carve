/** 8-bit greyscale BMP — ArtCAM Pro File → Open Existing Model. */

export function reliefBmp(h: Float32Array, cols: number, rows: number): Uint8Array {
  if (cols < 1 || rows < 1) throw new Error("bmp grid out of range");
  if (h.length < cols * rows) throw new Error("bmp height short");
  const rowBytes = (cols + 3) & ~3;
  const pixels = rowBytes * rows;
  const pal = 256 * 4;
  const off = 14 + 40 + pal;
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
  view.setUint16(28, 8, true);
  view.setUint32(34, pixels, true);
  for (let i = 0; i < 256; i++) {
    const o = 54 + i * 4;
    out[o] = out[o + 1] = out[o + 2] = i;
  }
  for (let y = 0; y < rows; y++) {
    const src = (rows - 1 - y) * cols;
    const dst = off + y * rowBytes;
    for (let x = 0; x < cols; x++) {
      out[dst + x] = Math.max(0, Math.min(255, Math.round((h[src + x] ?? 0) * 255)));
    }
  }
  return out;
}

export function bmpSize(buf: Uint8Array): { cols: number; rows: number; bits: number } {
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error("not a BMP");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { cols: view.getInt32(18, true), rows: Math.abs(view.getInt32(22, true)), bits: view.getUint16(28, true) };
}
