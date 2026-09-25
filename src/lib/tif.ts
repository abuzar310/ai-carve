/** 16-bit greyscale TIFF — ArtCAM File → Open / create relief from image. */

export function reliefTif(h: Float32Array, cols: number, rows: number, widthMm: number, heightMm: number): Uint8Array {
  if (cols < 1 || rows < 1) throw new Error("tif grid out of range");
  if (h.length < cols * rows) throw new Error("tif height short");
  const n = cols * rows;
  const strip = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, Math.min(65535, Math.round((h[i] ?? 0) * 65535)));
    strip[i * 2] = v & 0xff;
    strip[i * 2 + 1] = (v >> 8) & 0xff;
  }
  const dpiX = Math.max(1, (cols * 25.4) / Math.max(widthMm, 0.001));
  const dpiY = Math.max(1, (rows * 25.4) / Math.max(heightMm, 0.001));
  const tags = 12;
  const ifd = 8;
  const ifdSize = 2 + tags * 12 + 4;
  const extra = ifd + ifdSize;
  // rationals + strip
  const rat = extra;
  const dataAt = rat + 16;
  const out = new Uint8Array(dataAt + strip.length);
  const view = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd, true);
  view.setUint16(ifd, tags, true);
  const put = (i: number, tag: number, type: number, count: number, value: number) => {
    const o = ifd + 2 + i * 12;
    view.setUint16(o, tag, true);
    view.setUint16(o + 2, type, true);
    view.setUint32(o + 4, count, true);
    view.setUint32(o + 8, value, true);
  };
  const ratX = Math.round(dpiX * 1000);
  const ratY = Math.round(dpiY * 1000);
  view.setUint32(rat, ratX, true);
  view.setUint32(rat + 4, 1000, true);
  view.setUint32(rat + 8, ratY, true);
  view.setUint32(rat + 12, 1000, true);
  put(0, 256, 3, 1, cols);
  put(1, 257, 3, 1, rows);
  put(2, 258, 3, 1, 16);
  put(3, 259, 3, 1, 1);
  put(4, 262, 3, 1, 1);
  put(5, 273, 4, 1, dataAt);
  put(6, 277, 3, 1, 1);
  put(7, 278, 3, 1, rows);
  put(8, 279, 4, 1, strip.length);
  put(9, 282, 5, 1, rat);
  put(10, 283, 5, 1, rat + 8);
  put(11, 296, 3, 1, 2);
  view.setUint32(ifd + 2 + tags * 12, 0, true);
  out.set(strip, dataAt);
  return out;
}

export function tifSize(buf: Uint8Array): { cols: number; rows: number; bits: number } {
  if (buf[0] !== 0x49 || buf[1] !== 0x49) throw new Error("not little-endian tiff");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const ifd = view.getUint32(4, true);
  const n = view.getUint16(ifd, true);
  let cols = 0;
  let rows = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12;
    const tag = view.getUint16(o, true);
    const val = view.getUint32(o + 8, true);
    if (tag === 256) cols = val;
    if (tag === 257) rows = val;
    if (tag === 258) bits = val;
  }
  return { cols, rows, bits };
}
