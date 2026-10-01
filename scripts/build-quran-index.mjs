// Builds public/data/quran.json from the quran-json package (CC BY-SA 4.0, Risan Bagja Pradana).
// Arabic: Uthmani text, The Noble Qur'an Encyclopedia (quranenc.com). Transliteration: tanzil.net.
// Usage: node scripts/build-quran-index.mjs <path-to-quran-json/dist>
import { readFileSync, writeFileSync } from "node:fs";
const dir = process.argv[2] ?? "node_modules/quran-json/dist";
const ar = JSON.parse(readFileSync(`${dir}/quran.json`, "utf8"));
const tr = JSON.parse(readFileSync(`${dir}/quran_transliteration.json`, "utf8"));
const s = ar.map((c, i) => [c.id, c.name, tr[i].transliteration, c.verses.map((v, j) => [v.text, tr[i].verses[j].transliteration])]);
const out = {
  v: 1,
  credit: "Quran text: The Noble Qur'an Encyclopedia (quranenc.com), Uthmani script. Transliteration: tanzil.net. Packaged by quran-json (Risan Bagja Pradana), CC BY-SA 4.0.",
  s,
};
writeFileSync("public/data/quran.json", JSON.stringify(out));
console.log("surahs", s.length, "ayahs", s.reduce((a, c) => a + c[3].length, 0));
