import { luma, normalizeHeight, pixelsToHeight, resampleHeight } from "./height.ts";

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
const mid = new Float32Array([0.2, 0.6]);
const nrm = normalizeHeight(mid);
ok(Math.abs(nrm[0]) < 1e-6 && Math.abs(nrm[1] - 1) < 1e-6, "normalize stretches to 0..1");

const ramp = new Float32Array([0, 1, 0, 1]);
const rs = resampleHeight(ramp, 2, 2, 3, 3);
ok(Math.abs((rs[4] ?? 0) - 0.5) < 1e-6, "bilinear centre");
ok(resampleHeight(ramp, 2, 2, 2, 2) === ramp, "same size is identity");

console.log(`carve height.check OK (${n} assertions)`);
