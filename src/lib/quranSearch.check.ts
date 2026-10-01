import { readFileSync } from "node:fs";
import { BISMILLAH, NAMES_99 } from "./textPanel.ts";
import { NAMES_99_EN, SURE, search, skeleton, similarity, type QuranIndex } from "./quranSearch.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => {
  n++;
  if (!cond) throw new Error("FAIL: " + msg);
};
const index = JSON.parse(readFileSync(new URL("../../public/data/quran.json", import.meta.url), "utf8")) as QuranIndex;
const plain = (s: string) => s.replace(/[\u064b-\u0655\u0670\u06d6-\u06ed\u0640\u0671]/g, (c) => (c === "\u0671" ? "ا" : ""));

// the library itself
ok(index.s.length === 114, "114 surahs");
ok(index.s.reduce((a, c) => a + c[3].length, 0) === 6236, "6236 ayahs");
ok(NAMES_99_EN.length === NAMES_99.length, "an English spelling for every name");

// spelling variants land on the same skeleton
ok(skeleton("Ar-Rahman") === skeleton("alrrahmani"), "ar-rahman = Tanzil alrrahmani");
ok(skeleton("Dhul Jalal") === skeleton("thul jalal"), "dh = th");
ok(similarity(skeleton("raheem"), skeleton("rahim")) === 1, "ee = i");

const top = (q: string) => {
  const t0 = performance.now();
  const r = search(index, q);
  const ms = performance.now() - t0;
  ok(ms < 2000, `"${q}" searched in ${Math.round(ms)} ms`);
  return r;
};

let r = top("bismillah ir rahman ir raheem");
ok(r[0]!.score >= SURE && plain(r[0]!.arabic).startsWith("بسم"), `bismillah → ${r[0]?.arabic} (${r[0]?.source})`);
r = top("qul huwallahu ahad");
ok(r[0]!.source === "Quran 112:1" && r[0]!.score >= SURE, `qul huwallahu ahad → ${r[0]?.source} ${r[0]?.score.toFixed(2)}`);
r = top("alhamdulillahi rabbil alamin");
ok(r.some((h) => h.source.startsWith("Quran 1:2") && h.score >= SURE), `alhamdulillahi rabbil alamin → 1:2 (${r[0]?.source})`);
r = top("qul a'udhu bi rabbil falaq");
ok(r[0]!.source === "Quran 113:1", `qul a'udhu bi rabbil falaq → ${r[0]?.source}`);
r = top("ar rahman");
ok(r[0]!.arabic === "الرحمن" && r[0]!.score === 1, "ar rahman → الرحمن (99 Names)");
r = top("al afuw");
ok(r[0]!.arabic === "العفو", `al afuw → ${r[0]?.arabic}`);
r = top("dhul jalali wal ikram");
ok(r[0]!.arabic === "ذو الجلال والإكرام", `dhul jalali wal ikram → ${r[0]?.arabic}`);
r = top("mashallah");
ok(r[0]!.arabic === "ما شاء الله", "mashallah → ما شاء الله");
r = top("2:255");
ok(r.length === 1 && plain(r[0]!.arabic).startsWith("الله لا إله إلا هو الحي القيوم"), "2:255 is Ayat al-Kursi");
r = top("ayatul kursi");
ok(r[0]!.source === "Quran 2:255", `ayatul kursi → ${r[0]?.source}`);
r = top("112:1-4");
ok(r[0]!.arabic.includes("﴿٤﴾") && plain(r[0]!.arabic).startsWith("قل هو الله أحد"), "112:1-4 gives the whole surah with ayah numbers");
r = top("surah ikhlas");
ok(r[0]!.kind === "surah" && r[0]!.source.includes("112"), `surah ikhlas → ${r[0]?.source}`);
r = top("surah kausar");
ok(r[0]?.source.includes("108") === true, `surah kausar → ${r[0]?.source}`);
r = top("zikr");
ok(r.length > 0, "zikr finds something");
r = top("allahu la ilaha illa huwa alhayyul qayyum");
ok(r.some((h) => h.source.startsWith("Quran 2:255") || h.source.startsWith("Quran 3:2")), `start of Ayat al-Kursi found (${r[0]?.source})`);
// a person's name that is not in the library must never look like a sure match (bug: "abuzar" → بصير 100%)
for (const name of ["abuzar", "abuzer", "zubair", "basir khan"]) {
  r = top(name);
  ok(r.every((h) => h.score < SURE), `"${name}" is not a sure match (${r[0]?.arabic} ${r[0] ? Math.round(r[0].score * 100) : ""}%)`);
}
r = top("baseer");
ok(r.some((h) => plain(h.arabic).includes("بصير") && h.score >= SURE), "baseer still finds بصير");
// KFGQPC open-tanween code points are mapped to the Unicode open tanween marks the font can draw
r = top("36:58");
ok(!/[\u0656\u0657\u065e]/.test(r[0]!.arabic), "36:58 has no KFGQPC tanween code points");
ok(r[0]!.arabic.includes("\u08f1") && r[0]!.arabic.includes("\u08f0") && r[0]!.arabic.includes("\u08f2"), "36:58 uses open dammatan, fathatan and kasratan");
for (const h of search(index, "baseer")) ok(!/[\u0656\u0657\u065e]/.test(h.arabic), "word results are mapped too");
// references with Arabic-Indic digits, and helpful notes for impossible ones (written before the code)
r = top("١١٢:١");
ok(r.length === 1 && r[0]!.source === "Quran 112:1", "Arabic-Indic digits work as a reference");
r = top("999:1");
ok(r.length === 1 && r[0]!.kind === "note" && /114/.test(r[0]!.label), "surah 999 explains the Quran has 114 surahs");
r = top("2:0");
ok(r.length === 1 && r[0]!.kind === "note" && /start at 1/i.test(r[0]!.label), "ayah 0 explains numbering starts at 1");
r = top("112:9");
ok(r.length === 1 && r[0]!.kind === "note" && /4 ayahs/.test(r[0]!.label), "112:9 explains Surah 112 has 4 ayahs");
// typing in Arabic finds the library text (vowel marks ignored)
r = top("الرحمن");
ok(r[0]!.arabic === "الرحمن" && r[0]!.score === 1, "Arabic query finds the 99 Names entry");
r = top("ربي زدني علما");
ok(r.some((h) => h.source.startsWith("Quran 20:114") && h.score >= SURE), `Arabic words find 20:114 (${r[0]?.source})`);
r = top("لا تحزن ان الله معنا");
ok(r.some((h) => h.source.startsWith("Quran 9:40") && h.score >= SURE), `Arabic without hamza still finds 9:40 (${r[0]?.source})`);
r = top("xyzzy qwrtp");
ok(r.every((h) => h.score < SURE), "nonsense never counts as a sure match");
ok(search(index, "") .length === 0, "empty query → nothing");
// every hit's Arabic is copied from the library, never made up
const lib = new Set<string>([...NAMES_99, BISMILLAH]);
for (const h of search(index, "rabbi zidni ilma")) ok(h.kind !== "quran" || index.s.some(([, , , a]) => a.some(([t]) => t.includes(h.arabic.split(" ")[0]!))) || lib.has(h.arabic), "hit text comes from the library");

console.log(`carve quranSearch.check OK (${n} assertions)`);

// ---- picking a result puts the exact Arabic into the panel (written before applyHit existed)
import { applyHit } from "./quranSearch.ts";
import { DEFAULT_SPEC } from "./textPanel.ts";
{
  const plateSpec = { ...DEFAULT_SPEC, template: "plate" as const, lines: ["Mohammed", ""], header: "", font: "naskh" as const };
  const ayah = { arabic: "إِنَّا لِلَّهِ وَإِنَّآ إِلَيۡهِ رَٰجِعُونَ", source: "Quran 2:156 (words 6–10)", label: "", score: 1, kind: "quran" as const };
  const a = applyHit(plateSpec, ayah, "line");
  ok(a.lines.length === 2 && a.lines[1] === ayah.arabic && a.lines[0] === "Mohammed", "adds the Arabic as a new line, dropping blank lines");
  ok(a.font === "quran", "Quran (Uthmani) text switches the font to Amiri Quran");
  ok(plateSpec.lines.length === 2 && plateSpec.font === "naskh", "the old spec is not changed");
  const name = { arabic: "اللطيف", source: "99 Names", label: "Al-Latif", score: 1, kind: "name" as const };
  const b = applyHit(plateSpec, name, "line");
  ok(b.font === "naskh", "a name or phrase keeps the chosen font");
  const gridSpec = { ...DEFAULT_SPEC, template: "grid" as const, lines: [], header: "" };
  const c = applyHit(gridSpec, ayah, "header");
  ok(c.header === ayah.arabic && c.lines.length === 0, "header target sets the header only");
  const n99 = applyHit({ ...DEFAULT_SPEC }, name, "line");
  ok(n99.template === "names99" && n99.lines.length === 0, "the 99 Names board ignores added lines");
}
console.log(`carve quranSearch.check applyHit OK (${n} assertions)`);
