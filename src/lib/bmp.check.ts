import { bmpSize, reliefBmp } from "./bmp.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const h = new Float32Array([0, 1, 0.5, 0.25]);
const buf = reliefBmp(h, 2, 2, 200, 200);
const info = bmpSize(buf);
ok(buf[0] === 0x42 && buf[1] === 0x4d, "BM");
ok(info.cols === 2 && info.rows === 2, "dims");
ok(info.bits === 24, "24-bit");
ok(info.ppmX === 10 && info.ppmY === 10, "size in header");
ok(buf[62] === 0 && buf[65] === 255, "top row black then white");

console.log(`carve bmp.check OK (${n} assertions)`);
