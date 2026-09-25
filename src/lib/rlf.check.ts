import { parseRlf, reliefRlf, rlfGrid, rlfHasMagic, rlfUnits } from "./rlf.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

const cols = 4;
const rows = 3;
const h = new Float32Array([0, 0.5, 1, 1, 0.25, 0.75, 0, 0, 1, 1, 0.5, 0]);
const buf = reliefRlf(h, cols, rows, 40, 30, 8, new Date(Date.UTC(2026, 8, 25, 12, 0, 0)));
const info = parseRlf(buf);
ok(info.cols === 4 && info.rows === 3, "dims");
ok(info.packed, "packed flag like the shop file");
ok(Math.abs(info.widthMm - 40) < 1e-6, "width mm");
ok(Math.abs(info.heightMm - 30) < 1e-6, "height mm");
ok(Math.abs(info.maxZ - 8) < 1e-6, "depth");
ok(Math.abs(info.originX + 20) < 1e-4, "centred X");
ok(Math.abs(info.originY + 15) < 1e-4, "centred Y");
ok(rlfHasMagic(buf), "ArtCAM footer 87654321");
ok(new TextDecoder("latin1").decode(buf).includes("RELIEF FILE"), "text header");
ok(new TextDecoder("latin1").decode(buf).includes("25 SEP 2026 12.00.00"), "date stamp");
const u = rlfUnits(buf);
ok(u.length === 12, "12 samples");
ok(u[2] === 8000, "white is 8.000 mm");
ok(u[0] === 0, "black is 0");
ok(u[1] === 4000, "mid is 4.000 mm");
ok(rlfGrid(200, 200).cols === 500 && rlfGrid(200, 200).rows === 500, "square 0.4 mm/px");
ok(rlfGrid(200, 200, 200).cols === 200, "cap long side");

console.log(`carve rlf.check OK (${n} assertions)`);
