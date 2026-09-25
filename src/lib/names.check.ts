import { artcamNames } from "./names.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const a = artcamNames(1_758_816_000_000, () => 0.123456);
const b = artcamNames(1_758_816_000_001, () => 0.987654);
ok(a.bmp.endsWith(".bmp") && a.rlf.endsWith(".rlf"), "extensions");
ok(!/\.\w+_\d+$/.test(a.bmp) && !/\.\w+_\d+$/.test(a.rlf), "no suffix after ext");
ok(a.bmp !== b.bmp && a.rlf !== b.rlf, "different each time");
ok(/^carve-[a-z0-9]+-[a-z0-9]+\.bmp$/.test(a.bmp), "bmp shape");
ok(/^carve-[a-z0-9]+-[a-z0-9]+\.rlf$/.test(a.rlf), "rlf shape");
ok(a.bmp.replace(/\.bmp$/, "") === a.rlf.replace(/\.rlf$/, ""), "paired stem");

console.log(`carve names.check OK (${n} assertions)`);
