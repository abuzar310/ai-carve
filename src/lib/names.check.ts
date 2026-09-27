import { artcamNames, sourceStem } from "./names.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(sourceStem("carve-ornament.bmp") === "ornament", "file stem");
ok(sourceStem("/tmp/My Photo (1).JPG") === "my-photo-1", "sanitize");
ok(sourceStem("Generated image") === "relief", "generated fallback");
ok(sourceStem("Peacock on a teak panel, side view").startsWith("peacock-on-a-teak") && sourceStem("Peacock on a teak panel, side view").length <= 28, "prompt");

const a = artcamNames("carve-ornament.bmp", 100, 100, 3);
ok(a.stl === "ornament-100x100-3mm.stl", "stl from image");
ok(a.bmp === "ornament-100x100-3mm.bmp", "bmp from image");
ok(a.stl === artcamNames("carve-ornament.bmp", 100, 100, 3).stl, "stable");
ok(!a.stl.includes("muj") && !/\d{6,}/.test(a.stl), "no random id");

const b = artcamNames("Peacock on a teak panel", 200, 200, 4);
ok(b.stl.startsWith("peacock-") && b.stl.endsWith(".stl"), "prompt stl");
ok(!("tif" in a) && !a.bmp.includes(".rlf"), "no rlf");

console.log(`carve names.check OK (${n} assertions)`);
