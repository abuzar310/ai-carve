import {
  quranMarks,
  sizeProblem,
  switchTemplate,
  BISMILLAH,
  DEFAULT_SPEC,
  NAMES_99,
  NAMES_99_ROWS,
  composePanel,
  distanceInside,
  fitText,
  gridFor,
  layoutPanel,
  type Layout,
  type Masks,
  type Measure,
  type PanelSpec,
} from "./textPanel.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};

// ---- the 99 Names: complete, unique, and spelled the way the earlier AI images got wrong
ok(NAMES_99.length === 100, `الله + 99 names (${NAMES_99.length})`);
ok(new Set(NAMES_99).size === 100, "no duplicate names");
ok(NAMES_99[0] === "الله", "board starts with الله");
for (const must of ["المتكبر", "الآخر", "الرؤوف", "العفو", "الغني", "المغني", "ذو الجلال والإكرام", "مالك الملك", "البارئ", "المؤمن"])
  ok(NAMES_99.includes(must), `contains ${must}`);
for (const bad of ["الأخر", "الرووف", "الغنئ", "المغنئ", "المتكير", "ذوالجلال"]) ok(!NAMES_99.some((x) => x.includes(bad)), `no misspelling ${bad}`);
ok(NAMES_99.indexOf("العفو") === NAMES_99.indexOf("المنتقم") + 1 && NAMES_99.indexOf("الرؤوف") === NAMES_99.indexOf("العفو") + 1, "العفو sits between المنتقم and الرؤوف");
ok(NAMES_99[NAMES_99.length - 1] === "الصبور", "board ends with الصبور");
ok(NAMES_99_ROWS.reduce((a, r) => a + r.length, 0) === 100, "the board has 100 tiles");
ok(NAMES_99_ROWS[7]![8] === 2, "ذو الجلال والإكرام gets a double-width tile");

// ---- layouts
const names = layoutPanel(DEFAULT_SPEC);
ok(names.tiles.length === 100, `names99 tiles (${names.tiles.length})`);
const textItems = names.items.filter((i) => i.role === "text");
ok(textItems.length === 100 && textItems[0]!.text === "الله", "one name per tile, الله first");
ok(names.items.some((i) => i.role === "header" && i.text === BISMILLAH), "Bismillah header");
ok(names.stars.length === 2 && names.frameMm > 20, "header stars and a frame on a 600 mm board");
const first = names.tiles[0]!;
const second = names.tiles[1]!;
ok(first.x0 > second.x0, "tiles run right-to-left");
const dhul = textItems.find((i) => i.text === "ذو الجلال والإكرام")!;
ok(dhul.box.x1 - dhul.box.x0 > (first.x1 - first.x0) * 1.7, "double tile is about twice as wide");
for (const t of names.tiles) ok(t.x0 >= 0 && t.x1 <= 600 && t.y0 >= 0 && t.y1 <= 600 && t.x1 > t.x0 && t.y1 > t.y0, "tile inside the board");

const plate: PanelSpec = { ...DEFAULT_SPEC, template: "plate", widthMm: 300, heightMm: 120, lines: ["Mohammed Abuzar", "", "AI Carve"], header: "" };
const pl = layoutPanel(plate);
ok(pl.items.length === 2 && pl.tiles.length === 0, "plate: blank lines dropped, no tiles");
ok(pl.items[0]!.box.y1 <= pl.items[1]!.box.y0 + 1e-9, "plate lines stack top to bottom");
{
  const pitems = layoutPanel({ ...plate, lines: ["بسم الله", "Mohammed Abuzar Khan"] }).items;
  const two = fitText(pitems, (s, _f, z) => s.length * 0.55 * z);
  const cap0 = (pitems[0]!.box.y1 - pitems[0]!.box.y0) * 0.8; // Arabic line
  ok(Math.abs(two[0]!.sizeMm - cap0) < 1e-6, "a short plate line fills its own row height");
  ok(two[0]!.sizeMm > two[1]!.sizeMm * 1.05, "a long plate line is set smaller, not the whole plate");
}

const grid: PanelSpec = { ...DEFAULT_SPEC, template: "grid", widthMm: 400, heightMm: 300, lines: ["a", "b", "c", "d", "e"], columns: 2, header: "" };
const gl = layoutPanel(grid);
ok(gl.tiles.length === 5, `grid: 5 words → 5 tiles (${gl.tiles.length})`);
ok(gl.items.every((i) => i.role === "text"), "grid without header has no header item");

// ---- text fitting (stand-in measure: 0.55 em per character)
const measure: Measure = (t, _f, s) => t.length * 0.55 * s;
const ops = fitText(names.items, measure);
const tileOps = ops.filter((o) => o.role === "text");
const sizes = tileOps.map((o) => o.sizeMm);
const common = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)]!;
ok(tileOps.filter((o) => Math.abs(o.sizeMm - common) < 1e-6).length >= 60, "most names share one letter size");
for (const o of tileOps) {
  const it = textItems.find((i) => o.text === i.text || i.text.includes(o.text))!;
  ok(measure(o.text, o.font, o.sizeMm) <= it.box.x1 - it.box.x0 + 1e-6, `"${o.text}" fits its tile`);
}
// a long two-word name in a narrow tile goes on two lines instead of becoming tiny
const narrow = layoutPanel({ ...grid, widthMm: 300, heightMm: 300, columns: 4, lines: ["ab", "cd", "ef", "gh", "ij", "kl", "مالك الملك", "mn", "op", "qr", "st", "uv"] });
const nops = fitText(narrow.items, measure);
ok(nops.filter((o) => o.text === "مالك" || o.text === "الملك").length === 2, "long two-word name splits onto two lines");
ok(nops.find((o) => o.text === "مالك")!.sizeMm > nops.find((o) => o.text === "ab")!.sizeMm * 0.35, "the split name stays readable, not tiny");

// ---- distance transform
{
  const c = 41, r = 21;
  const m = new Uint8Array(c * r);
  for (let y = 5; y <= 15; y++) for (let x = 5; x <= 35; x++) m[y * c + x] = 1;
  const d = distanceInside(m, c, r);
  ok(d[0] === 0, "outside pixels are 0");
  ok(Math.abs(d[10 * c + 20]! - 6) < 1e-6, `centre of an 11-px-tall bar is 6 px in (${d[10 * c + 20]})`);
  ok(Math.abs(d[5 * c + 20]! - 1) < 1e-6, "edge pixel is 1 px in");
  const disk = new Uint8Array(101 * 101);
  for (let y = 0; y < 101; y++) for (let x = 0; x < 101; x++) disk[y * 101 + x] = (x - 50) ** 2 + (y - 50) ** 2 <= 40 * 40 ? 1 : 0;
  const dd = distanceInside(disk, 101, 101);
  ok(Math.abs(dd[50 * 101 + 50]! - 41) < 1.01, `disk centre ≈ radius (${dd[50 * 101 + 50]})`);
}

// ---- relief composition on synthetic masks
function rectMask(lay: Layout, cols: number, rows: number, boxes: { x0: number; y0: number; x1: number; y1: number }[]): Float32Array {
  const mm = lay.widthMm / cols;
  const out = new Float32Array(cols * rows);
  for (const b of boxes)
    for (let y = Math.floor(b.y0 / mm); y < Math.ceil(b.y1 / mm); y++)
      for (let x = Math.floor(b.x0 / mm); x < Math.ceil(b.x1 / mm); x++) out[y * cols + x] = 1;
  return out;
}
const { cols, rows } = gridFor(600, 600, 300);
ok(cols === 300 && rows === 300, "grid keeps square pixels");
const lay = layoutPanel(DEFAULT_SPEC);
const strokes = lay.items.filter((i) => i.role === "text").map((i) => {
  const cx = (i.box.x0 + i.box.x1) / 2, cy = (i.box.y0 + i.box.y1) / 2;
  return { x0: cx - 12, y0: cy - 2, x1: cx + 12, y1: cy + 2 };
});
const masks: Masks = { text: rectMask(lay, cols, rows, strokes), header: new Float32Array(cols * rows), stars: new Float32Array(cols * rows) };
const at = (h: Float32Array, xMm: number, yMm: number) => h[Math.floor(yMm / 2) * cols + Math.floor(xMm / 2)]!;
const raised = composePanel(lay, masks, cols, rows, "raised", 1.8);
const t0 = lay.tiles[0]!;
const tcx = (t0.x0 + t0.x1) / 2, tcy = (t0.y0 + t0.y1) / 2;
const hs = raised.heightsMm;
ok(raised.h.length === cols * rows && Math.min(...raised.h) === 0 && Math.abs(Math.max(...raised.h) - 1) < 1e-6, "field normalized to 0..1");
ok(raised.depthMm > 5 && raised.depthMm < 9, `relief range is real millimetres (${raised.depthMm})`);
ok(at(hs, tcx, tcy) > at(hs, tcx, t0.y0 + 4) + 1.2, "raised letters stand ~1.8 mm above the tile face");
ok(at(hs, tcx, t0.y0 + 4) > at(hs, (t0.x0 + lay.tiles[1]!.x1) / 2, tcy) + 0.8, "tile face above the groove between tiles");
ok(at(hs, 6, 300) > at(hs, tcx, t0.y0 + 4), "frame moulding is the tallest part at the edge");
const carved = composePanel(lay, masks, cols, rows, "vcarve", 1.8);
ok(at(carved.heightsMm, tcx, tcy) < at(carved.heightsMm, tcx, t0.y0 + 4) - 1.0, "V-carved letters sink below the tile face");
const noFrame = composePanel(layoutPanel({ ...DEFAULT_SPEC, frame: false }), masks, cols, rows, "raised", 1.8);
ok(noFrame.depthMm < raised.depthMm, "without a frame the relief is shallower");
ok(raised.h.every((v) => Number.isFinite(v)), "no NaN in the field");

// ---- switching templates (written before switchTemplate existed)
{
  const fromQuran: PanelSpec = { ...DEFAULT_SPEC, template: "plate", font: "quran", lines: ["إِنَّا لِلَّهِ"], header: "" };
  const s99 = switchTemplate(fromQuran, "names99");
  ok(s99.template === "names99" && s99.font === "naskh" && s99.header === BISMILLAH, "99 Names resets to the Naskh font and the Bismillah");
  const sPlate = switchTemplate(DEFAULT_SPEC, "plate");
  ok(sPlate.header === "" && sPlate.lines.length === 1, "plate: no header, a starter line");
  const sGrid = switchTemplate({ ...DEFAULT_SPEC, lines: ["a", "b"] }, "grid");
  ok(sGrid.header === "" && sGrid.lines.join() === "a,b", "grid keeps typed words and drops the 99 Names header");
}
// ---- panel size limits, shown next to the fields (written before sizeProblem existed)
ok(sizeProblem(DEFAULT_SPEC) === null, "600 × 600 mm is fine");
ok(/width/i.test(sizeProblem({ ...DEFAULT_SPEC, widthMm: 5000 }) ?? ""), "5000 mm wide is refused, naming the width");
ok(/height/i.test(sizeProblem({ ...DEFAULT_SPEC, heightMm: 10 }) ?? ""), "10 mm tall is refused, naming the height");
ok(/30.*3000/.test(sizeProblem({ ...DEFAULT_SPEC, widthMm: 20 }) ?? ""), "the message gives the allowed range");
ok(sizeProblem({ ...DEFAULT_SPEC, widthMm: 30, heightMm: 3000 }) === null, "the limits themselves are allowed");
// ---- pasted Quran text (written before quranMarks / plate wrapping existed)
{
  const uthmani = "سِنَةٞ وَلَا نَوۡمٞۚ قَوۡلٗا مِّن رَّبّٖ ٱللَّهُ";
  const u = quranMarks(uthmani);
  ok(!/[\u0656\u0657\u065e]/.test(u) && /\u08f0/.test(u) && /\u08f1/.test(u) && /\u08f2/.test(u), "Uthmani paste: open tanween mapped to U+08F0/1/2");
  const indopak = "لَهٗ مَا فِی السَّمٰوٰتِ";
  ok(quranMarks(indopak) === indopak, "Indo-Pak text (ulta pesh U+0657, no Uthmani marks) is left exactly as typed");
  ok(quranMarks("سَلَٰمٞ") === "سَلَٰم\u08f1", "U+065E is always open dammatan");
  const pl = layoutPanel({ ...DEFAULT_SPEC, template: "plate", header: "", lines: [uthmani] });
  ok(!/[\u0656\u0657\u065e]/.test(pl.items[0]!.text), "plate text goes through quranMarks");
}
{
  const long = "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp";
  const lay = layoutPanel({ ...DEFAULT_SPEC, template: "plate", widthMm: 600, heightMm: 300, header: "", lines: [long] });
  const m = (s: string, _f: string, z: number) => s.length * 0.55 * z;
  const ops = fitText(lay.items, m);
  const one = (lay.items[0]!.box.x1 - lay.items[0]!.box.x0) / (long.length * 0.55);
  ok(ops.length >= 2, `a long plate line wraps onto ${ops.length} lines`);
  ok(ops[0]!.sizeMm > one * 1.4, `wrapped text is much bigger than one squeezed line (${ops[0]!.sizeMm.toFixed(1)} vs ${one.toFixed(1)} mm)`);
  ok(ops.every((o) => m(o.text, "", o.sizeMm) <= lay.items[0]!.box.x1 - lay.items[0]!.box.x0 + 1e-6), "every wrapped line fits the width");
  ok(ops.map((o) => o.text).join(" ") === long, "wrapping keeps every word, in order");
  const top = Math.min(...ops.map((o) => o.baseline - o.sizeMm)), bottom = Math.max(...ops.map((o) => o.baseline + o.sizeMm * 0.4));
  ok(top >= lay.items[0]!.box.y0 - 1e-6 && bottom <= lay.items[0]!.box.y1 + 1e-6, "wrapped block stays inside its box");
  const short = fitText(layoutPanel({ ...DEFAULT_SPEC, template: "plate", header: "", lines: ["بسم الله"] }).items, m);
  ok(short.length === 1, "a short line stays on one line");
}
console.log(`carve textPanel.check OK (${n} assertions)`);
