import { artcamNames } from "./names.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const a = artcamNames(200, 200, 4, 1_758_816_000_000, () => 0.123456);
const b = artcamNames(200, 200, 4, 1_758_816_000_001, () => 0.987654);
ok(a.bmp.endsWith(".bmp"), "bmp");
ok(!("tif" in a) && !a.bmp.includes(".rlf"), "one bmp, no rlf");
ok(a.bmp !== b.bmp, "different each time");
ok(/^carve-200x200-4mm-[a-z0-9]+-[a-z0-9]+\.bmp$/.test(a.bmp), "size in name");

console.log(`carve names.check OK (${n} assertions)`);
