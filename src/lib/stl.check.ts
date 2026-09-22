import { pixelsToHeight } from "./height.ts";
import { reliefStl, stlCount } from "./stl.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const px = new Uint8ClampedArray(9 * 4).fill(255);
for (let i = 0; i < 9; i++) px[i * 4 + 3] = 255;
const h = pixelsToHeight(px, false);
const buf = reliefStl(h, 3, 3, 10, 10, 2);
const count = stlCount(buf);
ok(buf.byteLength === 84 + count * 50, "binary size matches triangle count");
ok(count > 8, "has a surface");

console.log(`carve stl.check OK (${n} assertions)`);
