import { pixelsToHeight } from "./height.ts";
import { gcodeSpan, reliefGcode, stepOf } from "./gcode.ts";

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
const cut = {
  widthMm: 100,
  heightMm: 50,
  depthMm: 4,
  bitMm: 25,
  stepPct: 100,
  safeZ: 5,
  feed: 800,
  plunge: 200,
  spindle: 18000,
  passMm: 4,
  cross: false,
  stockMm: 18,
};
ok(Math.abs(stepOf(cut) - 25) < 1e-9, "stepover is bit * pct");
const g = reliefGcode(h, 2, 2, cut);
ok(g.includes("G21"), "mm");
ok(g.includes("M30"), "ends the program");
ok(g.includes("M3 S18000"), "spindle");
ok(g.includes("Z0 = top"), "Z0 is top of stock");
const span = gcodeSpan(g);
ok(Math.abs(span.maxX - 100) < 0.01, "reaches board width");
ok(span.minZ <= 0 && span.minZ >= -4.001, "cut stays in the stock");
ok(g.includes("G1 Z"), "plunges");
const layered = reliefGcode(h, 2, 2, { ...cut, passMm: 2, depthMm: 4 });
ok((layered.match(/\(layer /g) || []).length === 2, "two layers for 4mm at 2mm/pass");
const cross = reliefGcode(h, 2, 2, { ...cut, cross: true });
ok(cross.includes("cross pass"), "optional 90 degree finish");

console.log(`carve gcode.check OK (${n} assertions)`);
