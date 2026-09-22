import { luma, pixelsToHeight } from "./height.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(Math.abs(luma(255, 255, 255) - 1) < 1e-6, "white is 1");
ok(luma(0, 0, 0) === 0, "black is 0");
const px = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
const h = pixelsToHeight(px, false);
ok(h[0] === 1 && h[1] === 0, "white stays high");
ok(pixelsToHeight(px, true)[0] === 0, "invert makes white deep");

console.log(`carve height.check OK (${n} assertions)`);
