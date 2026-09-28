import { boardForPiece, circumferenceMm, detectPiece } from "./piece.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

ok(detectPiece(1254, 1254) === "panel", "square is a panel");
ok(detectPiece(800, 1200) === "panel", "mild portrait is a panel");
ok(detectPiece(300, 1500) === "leg", "1:5 tall is a leg");
ok(detectPiece(1600, 400) === "border", "4:1 wide is a border strip");

const leg = boardForPiece("leg", 300, 1500);
ok(leg.heightMm === 300 && leg.widthMm === 60, `leg keeps 1:5 (${leg.widthMm}×${leg.heightMm})`);
const border = boardForPiece("border", 1600, 400);
ok(border.widthMm === 300 && border.heightMm === 75, `border keeps 4:1 (${border.widthMm}×${border.heightMm})`);
const sq = boardForPiece("panel", 1254, 1254);
ok(sq.widthMm === 100 && sq.heightMm === 100, "square panel is 100×100");
ok(boardForPiece("leg", 300, 1500, 450).heightMm === 450, "custom long side");
ok(circumferenceMm(50) === 157.1, "π × 50 mm");

console.log(`carve piece.check OK (${n} assertions)`);
