import { reliefTif, tifSize } from "./tif.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const h = new Float32Array([0, 1, 0.5, 0.25]);
const buf = reliefTif(h, 2, 2, 20, 20);
const info = tifSize(buf);
ok(info.cols === 2 && info.rows === 2, "dims");
ok(info.bits === 16, "16-bit");
ok(buf[0] === 0x49 && buf[1] === 0x49, "little-endian TIFF");
ok(buf[2] === 42, "tiff magic");

console.log(`carve tif.check OK (${n} assertions)`);
