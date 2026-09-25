/** ArtCAM / Carveco .rlf — header cloned from a shop relief (123abc_router.1). */

export const RLF_UNIT_MM = 0.001;
export const RLF_RANGE_MM = 32.32;
export const RLF_MM_PER_PX = 0.4;
const RLF_RANGE_U = 32320;
const MAGIC = [0x87, 0x65, 0x43, 0x21] as const;
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Empty 120-byte trailer record copied from a shop file ArtCAM does open. */
const FOOT = hex(
  "ffffffffffffffffffffffffffffffffffffffff" +
    "000000000000000000000000000000000000000000000000000000000000000000000000" +
    "000038380000000000000000000000000000000000000000000000000000000000000000" +
    "000000ffffffffffffffffffffffffffffffffffffffffff",
);

export type RlfInfo = {
  cols: number;
  rows: number;
  widthMm: number;
  heightMm: number;
  maxZ: number;
  minZ: number;
  originX: number;
  originY: number;
  originZ: number;
  packed: boolean;
  payloadAt: number;
};

export function rlfGrid(widthMm: number, heightMm: number, maxPx = 1200): { cols: number; rows: number } {
  let cols = Math.max(8, Math.round(widthMm / RLF_MM_PER_PX));
  let rows = Math.max(8, Math.round(heightMm / RLF_MM_PER_PX));
  const m = Math.max(cols, rows);
  if (m > maxPx) {
    const s = maxPx / m;
    cols = Math.max(8, Math.round(cols * s));
    rows = Math.max(8, Math.round(rows * s));
  }
  return { cols, rows };
}

function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function stamp(d = new Date()): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${dd} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}.${mm}.${ss}`;
}

function ascii(s: string): number[] {
  const out = new Array<number>(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function pNum(n: number): number[] {
  const s = (Object.is(n, -0) ? 0 : n).toFixed(6);
  if (s.length > 255) throw new Error("rlf number too long");
  return [s.length, ...ascii(s)];
}

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function fmt2(n: number): string {
  return n.toFixed(2);
}
function fmt3(n: number): string {
  return n.toFixed(3);
}

function i16beBytes(v: number): [number, number] {
  const u = v & 0xffff;
  return [(u >> 8) & 0xff, u & 0xff];
}

/** TGA-style 16-bit RLE, big-endian samples (0.001 mm). */
export function packRlfHeights(u: Int16Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < u.length) {
    let j = i + 1;
    while (j < u.length && j - i < 128 && u[j] === u[i]) j++;
    const run = j - i;
    if (run >= 3) {
      out.push(0x80 | (run - 1), ...i16beBytes(u[i] ?? 0));
      i = j;
      continue;
    }
    let k = i;
    while (k < u.length && k - i < 128) {
      if (k + 2 < u.length && u[k] === u[k + 1] && u[k] === u[k + 2]) break;
      k++;
    }
    if (k === i) k = i + 1;
    const n = k - i;
    out.push(n - 1);
    for (let t = 0; t < n; t++) out.push(...i16beBytes(u[i + t] ?? 0));
    i = k;
  }
  return Uint8Array.from(out);
}

export function unpackRlfHeights(buf: Uint8Array, need: number): Int16Array {
  const out = new Int16Array(need);
  let i = 0;
  let n = 0;
  while (i < buf.length && n < need) {
    const h = buf[i++] ?? 0;
    if (h & 0x80) {
      const cnt = (h & 0x7f) + 1;
      const hi = buf[i++] ?? 0;
      const lo = buf[i++] ?? 0;
      let v = (hi << 8) | lo;
      if (v & 0x8000) v -= 0x10000;
      for (let k = 0; k < cnt && n < need; k++) out[n++] = v;
    } else {
      const cnt = (h & 0x7f) + 1;
      for (let k = 0; k < cnt && n < need; k++) {
        const hi = buf[i++] ?? 0;
        const lo = buf[i++] ?? 0;
        let v = (hi << 8) | lo;
        if (v & 0x8000) v -= 0x10000;
        out[n++] = v;
      }
    }
  }
  return out;
}

/** White-high 0..1 field → ArtCAM relief (0.001 mm units, origin centred). */
export function reliefRlf(
  h: Float32Array,
  cols: number,
  rows: number,
  widthMm: number,
  heightMm: number,
  depthMm: number,
  when = new Date(),
): Uint8Array {
  if (cols < 1 || rows < 1 || cols > 0xffff || rows > 0xffff) throw new Error("rlf grid out of range");
  if (h.length < cols * rows) throw new Error("rlf height short");
  const maxZ = Math.max(0, depthMm);
  const minZ = 0;
  const originX = -widthMm / 2;
  const originY = -heightMm / 2;
  const originZ = 0;
  const text =
    `\r\n  Relief  RELIEF FILE   Relief                          ${stamp(when)}\r\n` +
    `  Relief is ${cols} pixels wide by ${rows} pixels high\r\n` +
    `  In real units the relief is ${fmt2(widthMm)}mm wide by ${fmt2(heightMm)}mm high\r\n` +
    `  Maximum height in the relief is ${fmt2(maxZ)}mm, minimum height is ${fmt2(minZ)}mm\r\n` +
    `  Position of the relief is X:${fmt3(originX)}mm Y:${fmt3(originY)}mm Z:${fmt3(originZ)}mm\r\n` +
    `  Vertical resolution for points in the relief is 0.0010mm\r\n` +
    `  Maximum height range which can be represented in the relief is +/- 32.320mm\r\n`;
  const meta = [
    0x02, 0x06, 0x00, 0x01,
    ...u16be(cols),
    ...u16be(rows),
    0x01,
    ...pNum(widthMm),
    ...pNum(heightMm),
    ...pNum(maxZ),
    ...pNum(minZ),
    ...pNum(0),
    0x01, 0x02, 0x00, 0x28,
    ...pNum(originX),
    ...pNum(originY),
    ...pNum(originZ),
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  ];
  const n = cols * rows;
  const units = new Int16Array(n);
  const scale = maxZ / RLF_UNIT_MM;
  for (let i = 0; i < n; i++) {
    units[i] = Math.max(-RLF_RANGE_U, Math.min(RLF_RANGE_U, Math.round((h[i] ?? 0) * scale)));
  }
  const packed = packRlfHeights(units);
  const feet = 8;
  const out = new Uint8Array(text.length + 1 + meta.length + packed.length + feet * FOOT.length + MAGIC.length);
  let o = 0;
  for (const c of ascii(text)) out[o++] = c;
  out[o++] = 0x1a;
  for (const c of meta) out[o++] = c;
  out.set(packed, o);
  o += packed.length;
  for (let i = 0; i < feet; i++) {
    out.set(FOOT, o);
    o += FOOT.length;
  }
  for (const c of MAGIC) out[o++] = c;
  return out;
}

function pRead(buf: Uint8Array, i: number): { s: string; n: number } {
  const len = buf[i] ?? 0;
  if (i + 1 + len > buf.length) throw new Error("rlf pascal overrun");
  let s = "";
  for (let k = 0; k < len; k++) s += String.fromCharCode(buf[i + 1 + k] ?? 0);
  return { s, n: i + 1 + len };
}

export function parseRlf(buf: Uint8Array): RlfInfo {
  if (buf.length < 32) throw new Error("rlf too small");
  let sub = -1;
  for (let i = 0; i < Math.min(buf.length, 2048); i++) {
    if (buf[i] === 0x1a) {
      sub = i;
      break;
    }
  }
  if (sub < 0) throw new Error("rlf missing header end");
  const head = new TextDecoder("latin1").decode(buf.subarray(0, sub));
  if (!head.includes("RELIEF FILE")) throw new Error("not an ArtCAM relief");
  let i = sub + 1;
  i += 4;
  const cols = ((buf[i] ?? 0) << 8) | (buf[i + 1] ?? 0);
  const rows = ((buf[i + 2] ?? 0) << 8) | (buf[i + 3] ?? 0);
  i += 4;
  const packed = buf[i++] === 1;
  const widthMm = Number(pRead(buf, i).s);
  i = pRead(buf, i).n;
  const heightMm = Number(pRead(buf, i).s);
  i = pRead(buf, i).n;
  const maxZ = Number(pRead(buf, i).s);
  i = pRead(buf, i).n;
  const minZ = Number(pRead(buf, i).s);
  i = pRead(buf, i).n;
  i = pRead(buf, i).n;
  i += 4;
  const originX = Number(pRead(buf, i).s);
  i = pRead(buf, i).n;
  const originY = Number(pRead(buf, i).s);
  i = pRead(buf, i).n;
  const originZ = Number(pRead(buf, i).s);
  i = pRead(buf, i).n;
  i += 7;
  return { cols, rows, widthMm, heightMm, maxZ, minZ, originX, originY, originZ, packed, payloadAt: i };
}

export function rlfHasMagic(buf: Uint8Array): boolean {
  const n = buf.length;
  return n >= 4 && buf[n - 4] === 0x87 && buf[n - 3] === 0x65 && buf[n - 2] === 0x43 && buf[n - 1] === 0x21;
}

export function rlfUnits(buf: Uint8Array): Int16Array {
  const info = parseRlf(buf);
  const n = info.cols * info.rows;
  const payload = buf.subarray(info.payloadAt, buf.length - 4 - 8 * FOOT.length);
  return unpackRlfHeights(payload, n);
}
