/**
 * Type in English letters, get exact Arabic from a verified library — no AI.
 *
 * Both the query and every library entry are reduced to a "sound skeleton"
 * (consonants only, spelling variants unified), then scored by edit distance.
 * The Arabic returned is always copied from the library: the Quran (Uthmani
 * text), the 99 Names, or a small list of common phrases.
 */
import { BISMILLAH, NAMES_99, type PanelSpec } from "./textPanel";

/** public/data/quran.json: s = [surah no, Arabic name, transliterated name, [[ayah Arabic, ayah transliteration], ...]] */
export type QuranIndex = { v: number; credit: string; s: [number, string, string, [string, string][]][] };

export type Hit = {
  arabic: string;
  /** "Quran 2:255", "Quran 1:1 (words 3–3)", "99 Names", "Phrase" */
  source: string;
  /** what was matched, in English letters */
  label: string;
  /** 0..1 similarity of the sound skeletons */
  score: number;
  kind: "quran" | "name" | "phrase" | "surah";
};

/** English spellings people use for the 99 Names (same order as NAMES_99). */
export const NAMES_99_EN: readonly string[] = [
  "Allah",
  "Ar-Rahman", "Ar-Rahim", "Al-Malik", "Al-Quddus", "As-Salam", "Al-Mu'min", "Al-Muhaymin", "Al-Aziz", "Al-Jabbar", "Al-Mutakabbir",
  "Al-Khaliq", "Al-Bari", "Al-Musawwir", "Al-Ghaffar", "Al-Qahhar", "Al-Wahhab", "Ar-Razzaq", "Al-Fattah", "Al-Alim", "Al-Qabid",
  "Al-Basit", "Al-Khafid", "Ar-Rafi", "Al-Mu'izz", "Al-Mudhill", "As-Sami", "Al-Basir", "Al-Hakam", "Al-Adl", "Al-Latif",
  "Al-Khabir", "Al-Halim", "Al-Azim", "Al-Ghafur", "Ash-Shakur", "Al-Ali", "Al-Kabir", "Al-Hafiz", "Al-Muqit", "Al-Hasib",
  "Al-Jalil", "Al-Karim", "Ar-Raqib", "Al-Mujib", "Al-Wasi", "Al-Hakim", "Al-Wadud", "Al-Majid", "Al-Ba'ith", "Ash-Shahid",
  "Al-Haqq", "Al-Wakil", "Al-Qawiyy", "Al-Matin", "Al-Waliyy", "Al-Hamid", "Al-Muhsi", "Al-Mubdi", "Al-Mu'id", "Al-Muhyi",
  "Al-Mumit", "Al-Hayy", "Al-Qayyum", "Al-Wajid", "Al-Maajid", "Al-Wahid", "Al-Ahad", "As-Samad", "Al-Qadir", "Al-Muqtadir",
  "Al-Muqaddim", "Al-Mu'akhkhir", "Al-Awwal", "Al-Akhir", "Az-Zahir", "Al-Batin", "Al-Wali", "Al-Muta'ali", "Al-Barr", "At-Tawwab",
  "Al-Muntaqim", "Al-Afuww", "Ar-Ra'uf", "Malik-ul-Mulk", "Dhul-Jalali wal-Ikram", "Al-Muqsit", "Al-Jami", "Al-Ghaniyy", "Al-Mughni", "Al-Mani",
  "Ad-Darr", "An-Nafi", "An-Nur", "Al-Hadi", "Al-Badi", "Al-Baqi", "Al-Warith", "Ar-Rashid", "As-Sabur",
];

/** Common phrases: English spellings → Arabic. */
export const PHRASES: readonly { en: readonly string[]; ar: string }[] = [
  { en: ["Bismillah ir-Rahman ir-Rahim", "Bismillahir Rahmanir Rahim", "Bismillah hir rahman nir raheem"], ar: BISMILLAH },
  { en: ["Bismillah"], ar: "بسم الله" },
  { en: ["Alhamdulillah", "Al-hamdu lillah"], ar: "الحمد لله" },
  { en: ["Subhanallah", "Subhan Allah"], ar: "سبحان الله" },
  { en: ["Allahu Akbar"], ar: "الله أكبر" },
  { en: ["La ilaha illallah", "La ilaha illa Allah"], ar: "لا إله إلا الله" },
  { en: ["Muhammad Rasulullah", "Muhammadur Rasulullah"], ar: "محمد رسول الله" },
  { en: ["Shahada", "Kalima", "La ilaha illallah Muhammadur Rasulullah"], ar: "لا إله إلا الله محمد رسول الله" },
  { en: ["Mashallah", "Masha Allah"], ar: "ما شاء الله" },
  { en: ["Inshallah", "In sha Allah"], ar: "إن شاء الله" },
  { en: ["Astaghfirullah"], ar: "أستغفر الله" },
  { en: ["Subhanallahi wa bihamdihi"], ar: "سبحان الله وبحمده" },
  { en: ["La hawla wa la quwwata illa billah"], ar: "لا حول ولا قوة إلا بالله" },
  { en: ["Hasbunallahu wa ni'mal wakil"], ar: "حسبنا الله ونعم الوكيل" },
  { en: ["Tawakkaltu ala Allah"], ar: "توكلت على الله" },
  { en: ["Sallallahu alayhi wa sallam", "Salallahu alaihi wasallam"], ar: "صلى الله عليه وسلم" },
  { en: ["Assalamu alaikum", "As-salamu alaykum"], ar: "السلام عليكم" },
  { en: ["Jazakallah khair", "Jazak Allahu khayran"], ar: "جزاك الله خيرا" },
  { en: ["Barakallah", "Barak Allahu fik"], ar: "بارك الله فيك" },
  { en: ["Ya Allah"], ar: "يا الله" },
  { en: ["Muhammad"], ar: "محمد" },
];

/** Well-known passages by name → surah:ayah. */
const PASSAGES: readonly { en: readonly string[]; ref: [number, number] }[] = [
  { en: ["Ayatul Kursi", "Ayat al-Kursi", "Ayat ul Kursi"], ref: [2, 255] },
];

// ---------------------------------------------------------------- sound skeleton

const SUN = "(th|t|d|dh|r|z|s|sh|n)";

/** Consonant skeleton: lowercase, unify spellings, drop vowels and repeated letters. */
export function skeleton(raw: string): string {
  let s = raw.replace(/AA/g, "'"); // Tanzil writes ʿayn as AA
  s = s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  // al- before a sun letter is spoken as the letter doubled: Tanzil "alrrahmani", people "ar-rahman"
  s = s.replace(new RegExp(`\\bal${SUN}\\1`, "g"), "a$1$1");
  s = s.replace(/dh/g, "th").replace(/ph/g, "f").replace(/v/g, "w").replace(/ck/g, "k");
  // South Asian spellings: Kausar / Kawthar, Zikr / Dhikr, Taubah / Tawbah
  s = s.replace(/th/g, "s").replace(/z/g, "s").replace(/aw/g, "au").replace(/ay(?![aeiou])/g, "ai");
  s = s.replace(/[^a-z]/g, "");
  s = s.replace(/[aeiou]/g, "");
  s = s.replace(/(.)\1+/g, "$1");
  return s;
}

/** Library side only: Tanzil spells the case ending ("ahadun"); people type "ahad". */
function trWord(w: string): string {
  return w.length >= 5 ? w.replace(/([^aeiou'])[aiu]n$/i, "$1") : w;
}
const trSkeleton = (t: string) => skeleton(t.split(/\s+/).map(trWord).join(" "));
const trSound = (t: string) => sound(t.split(/\s+/).map(trWord).join(" "));

/** Like skeleton(), but keeps the vowels (as a / i / u), so "abuzar" and "baseer" differ. */
export function sound(raw: string): string {
  let s = raw.replace(/AA/g, "'");
  s = s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(new RegExp(`\\bal${SUN}\\1`, "g"), "a$1$1");
  s = s.replace(/dh/g, "th").replace(/ph/g, "f").replace(/v/g, "w").replace(/ck/g, "k");
  s = s.replace(/th/g, "s").replace(/z/g, "s").replace(/aw/g, "au").replace(/ay(?![aeiou])/g, "ai");
  s = s.replace(/[^a-z]/g, "");
  s = s.replace(/[ei]/g, "i").replace(/[ou]/g, "u");
  return s.replace(/(.)\1+/g, "$1");
}

/** Consonants decide most of the score; vowels break ties a skeleton cannot (short words especially). */
function score(qSkel: string, qSound: string, skel: string, snd: string): number {
  const c = similarity(qSkel, skel);
  if (c < 0.6) return 0.65 * c; // cannot reach the 0.75 "close" list: skip the vowel pass
  const v = similarity(qSound, snd);
  const sc = 0.65 * c + 0.35 * v;
  // a very short consonant skeleton is easy to hit by chance: only "sure" if the vowels agree too
  return qSkel.length <= 4 && v < 0.85 ? Math.min(sc, 0.9) : sc;
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] ?? 0;
}

export function similarity(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  return m ? 1 - lev(a, b) / m : 1;
}

/**
 * The Uthmani text follows the King Fahd Complex convention, which borrows U+0657 / U+0656 / U+065E
 * for open fathatan / kasratan / dammatan. Amiri Quran draws those code points as other marks (or not
 * at all), so map them to the proper Unicode open-tanween marks before showing or carving.
 */
export function forFont(t: string): string {
  return t.replace(/\u0657/g, "\u08f0").replace(/\u0656/g, "\u08f2").replace(/\u065e/g, "\u08f1");
}

/** Pause and ayah-end marks: kept in full ayahs, dropped from a few picked-out words. */
const PAUSE = /[\u06d6-\u06dc\u06de\u06e9]/g;

// ---------------------------------------------------------------- search

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arNum = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] ?? d);

function ayahText(index: QuranIndex, s: number, a: number): string | null {
  const ayah = index.s[s - 1]?.[3][a - 1];
  return ayah ? ayah[0] : null;
}

/** Exact Arabic for a reference like "2:255", "112:1-4", "surah ikhlas", "ayatul kursi". */
function byReference(index: QuranIndex | null, q: string): Hit[] {
  const out: Hit[] = [];
  const m = q.trim().match(/^(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/);
  if (m && index) {
    const s = Number(m[1]);
    const a = Number(m[2]);
    const b = Math.max(a, Number(m[3] ?? a));
    const parts: string[] = [];
    for (let k = a; k <= b; k++) {
      const t = ayahText(index, s, k);
      if (t) parts.push(b > a ? `${t} ﴿${arNum(k)}﴾` : t);
    }
    if (parts.length) out.push({ arabic: forFont(parts.join(" ")), source: `Quran ${s}:${a}${b > a ? "-" + b : ""}`, label: q.trim(), score: 1, kind: "quran" });
  }
  return out;
}

type Prepared = { full: string; fullV: string; sk: string[]; sv: string[]; arW: string[]; trW: string[] }[][];
const prepared = new WeakMap<QuranIndex, Prepared>();
/** Skeletons and sound forms of every ayah, worked out once per loaded library. */
function prepare(index: QuranIndex): Prepared {
  let p = prepared.get(index);
  if (!p) {
    p = index.s.map(([, , , ayahs]) =>
      ayahs.map(([ar, tr]) => {
        const trW = tr.split(/\s+/);
        return { full: trSkeleton(tr), fullV: trSound(tr), sk: trW.map((w) => skeleton(trWord(w))), sv: trW.map((w) => sound(trWord(w))), arW: ar.split(/\s+/), trW };
      }),
    );
    prepared.set(index, p);
  }
  return p;
}

export function search(index: QuranIndex | null, query: string, limit = 6): Hit[] {
  const q = query.trim();
  if (!q) return [];
  const refs = byReference(index, q);
  if (refs.length) return refs;
  const qs = skeleton(q);
  const qv = sound(q);
  if (qs.length < 2) return [];
  const hits: Hit[] = [];
  const push = (h: Hit) => {
    if (h.score >= 0.6) hits.push(h);
  };

  NAMES_99_EN.forEach((en, i) => {
    const ya = "ya " + en.replace(/^(a[lnrstdz]h?)-/i, "");
    const sc = Math.max(score(qs, qv, skeleton(en), sound(en)), score(qs, qv, skeleton(ya), sound(ya)));
    push({ arabic: NAMES_99[i] ?? "", source: "99 Names", label: en, score: sc, kind: "name" });
  });
  for (const p of PHRASES) push({ arabic: p.ar, source: "Phrase", label: p.en[0] ?? "", score: Math.max(...p.en.map((e) => score(qs, qv, skeleton(e), sound(e)))), kind: "phrase" });

  if (index) {
    for (const p of PASSAGES) {
      const sc = Math.max(...p.en.map((e) => score(qs, qv, skeleton(e), sound(e))));
      const t = ayahText(index, p.ref[0], p.ref[1]);
      if (t) push({ arabic: forFont(t), source: `Quran ${p.ref[0]}:${p.ref[1]}`, label: p.en[0] ?? "", score: sc, kind: "quran" });
    }
    const qq = skeleton(q.replace(/^(surah|surat|sura)\s+/i, ""));
    for (const [n, name, en, ayahs] of index.s) {
      const qqv = sound(q.replace(/^(surah|surat|sura)\s+/i, ""));
      const bare = en.replace(/^a[lnrstdz]h?-/i, "");
      const sc = Math.max(score(qq, qqv, skeleton(en), sound(en)), score(qq, qqv, skeleton(bare), sound(bare)));
      if (sc >= 0.85 && ayahs.length <= 12)
        push({
          arabic: forFont(ayahs.map(([t], k) => `${t} ﴿${arNum(k + 1)}﴾`).join(" ")),
          source: `Surah ${en} (${n}) · ${name}`,
          label: `Surah ${en}`,
          score: sc,
          kind: "surah",
        });
    }
    // ayahs and runs of words inside ayahs
    const qLen = qs.length;
    const prep = prepare(index);
    index.s.forEach(([n, , , ayahs], si) => {
      ayahs.forEach(([ar, tr], ai) => {
        const P = prep[si]![ai]!;
        if (Math.abs(P.full.length - qLen) <= qLen * 0.35) push({ arabic: forFont(ar), source: `Quran ${n}:${ai + 1}`, label: tr, score: score(qs, qv, P.full, P.fullV), kind: "quran" });
        const { arW, trW, sk, sv } = P;
        if (arW.length !== trW.length || trW.length < 2) return;
        let best = { sc: 0, i: 0, j: 0 };
        for (let i = 0; i < sk.length; i++) {
          let joined = "";
          let joinedV = "";
          for (let j = i; j < sk.length; j++) {
            joined += sk[j];
            joinedV += sv[j];
            if (joined.length > qLen * 1.35 + 1) break;
            if (joined.length < qLen * 0.65) continue;
            const sc = score(qs, qv, joined, joinedV.replace(/(.)\1+/g, "$1"));
            if (sc > best.sc) best = { sc, i, j };
          }
        }
        if (best.sc >= 0.75 && !(best.i === 0 && best.j === sk.length - 1)) {
          push({
            arabic: forFont(arW.slice(best.i, best.j + 1).join(" ").replace(PAUSE, "").trim()),
            source: `Quran ${n}:${ai + 1} (word${best.j > best.i ? "s" : ""} ${best.i + 1}${best.j > best.i ? "–" + (best.j + 1) : ""})`,
            label: trW.slice(best.i, best.j + 1).join(" "),
            score: best.sc,
            kind: "quran",
          });
        }
      });
    });
  }

  // best first; the same Arabic only once (keep the earliest source: names/phrases, then the first ayah)
  hits.sort((a, b) => b.score - a.score || order(a) - order(b));
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of hits) {
    const key = h.arabic.replace(/[\u064b-\u0655\u0670\u06d6-\u06ed\u0640]/g, "").replace(/\u0671/g, "ا");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}
const order = (h: Hit) => ({ name: 0, phrase: 1, surah: 2, quran: 3 })[h.kind];

/** A match this close is treated as the intended text (the UI still shows it for confirmation). */
export const SURE = 0.95;

/** Put a picked result into the panel. Quran text is Uthmani script, so it switches to the Amiri Quran font. */
export function applyHit(spec: PanelSpec, hit: Hit, target: "line" | "header"): PanelSpec {
  const quranFont = hit.kind === "quran" || hit.kind === "surah";
  if (target === "header") return { ...spec, header: hit.arabic };
  if (spec.template === "names99") return spec;
  return { ...spec, lines: [...spec.lines.filter((l) => l.trim()), hit.arabic], font: quranFont ? "quran" : spec.font };
}
