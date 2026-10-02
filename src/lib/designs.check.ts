import fs from "fs";
import { CATEGORIES, DESIGNS, TITLES, applyDesign, resolveSrc, type Src } from "./designs";
import { PHRASES, arabicKey, type QuranIndex } from "./quranSearch";
import { BISMILLAH, NAMES_99, fitText, layoutPanel, sizeProblem } from "./textPanel";

let n = 0;
function ok(cond: unknown, msg: string): void {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
}

const index = JSON.parse(fs.readFileSync(new URL("../../public/data/quran.json", import.meta.url), "utf8")) as QuranIndex;

// every Arabic word a design may carve must come from the library, the phrase list, the 99 Names or the titles
const known = new Set<string>();
const addWords = (t: string) => arabicKey(t).split(" ").filter(Boolean).forEach((w) => known.add(w));
for (const [, , , ayahs] of index.s) for (const [ar] of ayahs) addWords(ar);
for (const s of index.s) addWords(s[1]);
PHRASES.forEach((p) => addWords(p.ar));
NAMES_99.forEach(addWords);
Object.values(TITLES).forEach(addWords);
addWords(BISMILLAH);
known.add(arabicKey("سورة"));

ok(new Set(DESIGNS.map((d) => d.id)).size === DESIGNS.length, "design ids are unique");
ok(DESIGNS.length >= 18, `a real catalogue (${DESIGNS.length} designs)`);
for (const c of CATEGORIES) ok(DESIGNS.filter((d) => d.category === c.id).length >= 3, `"${c.label}" has designs`);

const srcs = (d: (typeof DESIGNS)[number]): Src[] => [d.preview, ...(d.header ? [d.header] : []), ...(d.lines ?? []), ...(d.footer ? [d.footer] : [])];

for (const d of DESIGNS) {
  const spec = applyDesign(d, index);
  ok(spec, `${d.id}: resolves with the library`);
  if (!spec) continue;
  for (const src of srcs(d)) {
    const t = resolveSrc(src, index);
    ok(t && t.trim(), `${d.id}: every line has text`);
    for (const w of arabicKey(t ?? "").split(" ").filter(Boolean)) ok(known.has(w), `${d.id}: "${w}" comes from the library / phrases`);
    if ("ref" in src && src.key) ok(arabicKey(t!.replace(/﴿[^﴾]*﴾/g, "")) === src.key, `${d.id}: ${src.ref} ${src.words?.join("-") ?? ""} is exactly "${src.key}" (got "${arabicKey(t!)}")`);
    if ("ref" in src && src.words) ok(!/[\u06d6-\u06dc\u06de\u06e9]/.test(t!), `${d.id}: no pause marks in a partial ayah`);
  }
  const patternOnly = spec.template === "pattern" && spec.medallion === "none";
  if (d.ask === "name") ok(spec.lines.length === 0, `${d.id}: the name is left for the customer`);
  else if (patternOnly) ok(spec.lines.length === 0, `${d.id}: a pattern panel without a centre carries no text`);
  else if (spec.template !== "names99") ok(spec.lines.length > 0 && spec.lines.every((l) => l.trim()), `${d.id}: lines filled`);
  ok(!sizeProblem(spec), `${d.id}: its size is allowed`);
  if (spec.template === "pattern") {
    const lay = layoutPanel(spec);
    ok((lay.pattern?.segs.length ?? 0) > 20, `${d.id}: has its star pattern`);
    ok((lay.pattern?.bandMm ?? 0) >= 3, `${d.id}: bands at least 3 mm wide`);
  }
  if (patternOnly) continue;

  // lays out, and with a stand-in measure the letters are a carvable size
  const lay = layoutPanel(spec.lines.length || d.ask !== "name" ? spec : { ...spec, lines: ["Abuzar"] });
  const ops = fitText(lay.items, (s, _f, z) => [...s].length * 0.48 * z);
  const body = ops.filter((o) => o.role === "text");
  ok(body.length > 0, `${d.id}: has text to carve`);
  const smallest = Math.min(...body.map((o) => o.sizeMm));
  ok(smallest >= 8, `${d.id}: smallest text about ${smallest.toFixed(1)} mm (needs ≥ 8 at the suggested size)`);
}

// specific shapes
{
  const ik = applyDesign(DESIGNS.find((d) => d.id === "ikhlas")!, index)!;
  ok(ik.lines.length === 4 && ik.lines[0]!.endsWith("﴿١﴾") && ik.lines[3]!.endsWith("﴿٤﴾"), "Al-Ikhlas: four ayahs, each with its number");
  ok(ik.header.includes("الإخلاص") || arabicKey(ik.header).includes("الاخلاص"), "Al-Ikhlas: title from the library's surah name");
  const ak = applyDesign(DESIGNS.find((d) => d.id === "ayat-kursi")!, index)!;
  ok(arabicKey(ak.lines[0]!).startsWith(arabicKey("الله لا إله إلا هو الحي القيوم")), "Ayat al-Kursi text from 2:255");
  ok(ak.footer.includes("٢٥٥"), "Ayat al-Kursi reference line");
  const lay = layoutPanel(ak);
  const ops = fitText(lay.items, (s, _f, z) => [...s].length * 0.48 * z);
  ok(ops.filter((o) => o.role === "text").length >= 4, `Ayat al-Kursi wraps onto several lines (${ops.length})`);
  const q = applyDesign(DESIGNS.find((d) => d.id === "four-quls")!, index)!;
  const ql = layoutPanel(q);
  ok(q.lines.length === 4 && ql.arcs.length >= 4 + 3, "Four Quls: four sections with dividers between them");
}

// without the library: phrase designs still work, Quran ones wait for it
ok(applyDesign(DESIGNS.find((d) => d.id === "shahada")!, null), "phrase designs need no library");
ok(applyDesign(DESIGNS.find((d) => d.id === "ayat-kursi")!, null) === null, "Quran designs wait for the library");
ok(resolveSrc({ ref: "999:1" }, index) === null && resolveSrc({ ref: "2:999" }, index) === null, "bad references give nothing, not a guess");
const keepStyle = applyDesign(DESIGNS.find((d) => d.id === "shahada")!, index, { ...applyDesign(DESIGNS[0]!, index)!, style: "vcarve", letterMm: 2.5 })!;
ok(keepStyle.style === "vcarve" && keepStyle.letterMm === 2.5, "picking a design keeps the letter style and depth");

console.log(`carve designs.check OK (${n} assertions)`);
