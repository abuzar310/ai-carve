import { pixelsToHeight } from "./height.ts";
import { gcodeSpan, reliefGcode } from "./gcode.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const px = new Uint8ClampedArray(4 * 4);
for (let i = 0; i < 4; i++) {
  const v = i < 2 ? 255 : 0;
  px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
  px[i * 4 + 3] = 255;
}
const h = pixelsToHeight(px, false);
const g = reliefGcode(h, 2, 2, {
  widthMm: 100,
  heightMm: 50,
  depthMm: 4,
  stepMm: 25,
  safeZ: 5,
  feed: 800,
  plunge: 200,
});
ok(g.includes("G21"), "mm");
ok(g.includes("M30"), "ends the program");
const span = gcodeSpan(g);
ok(Math.abs(span.maxX - 100) < 0.01, "reaches board width");
ok(span.minZ <= 0 && span.minZ >= -4.001, "cut stays in the stock");
ok(g.includes("G1 Z"), "plunges");

console.log(`carve gcode.check OK (${n} assertions)`);
