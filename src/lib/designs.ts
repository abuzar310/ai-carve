/**
 * Ready-made designs for the Text panel. A design never contains typed Arabic: every line points at
 * the Quran library (surah:ayah, optionally a word range) or at the vetted phrase list, and is
 * resolved from there when it is picked. `designs.check.ts` verifies each one against the library.
 */
import { BISMILLAH, DEFAULT_SPEC, NAMES_99, type PanelSpec } from "./textPanel";
import { PHRASES, forFont, type QuranIndex } from "./quranSearch";

export type Category = "home" | "quran" | "dhikr" | "boards" | "patterns";
export const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: "home", label: "Names & home" },
  { id: "quran", label: "Quran" },
  { id: "dhikr", label: "Dhikr" },
  { id: "boards", label: "Boards" },
  { id: "patterns", label: "Patterns" },
];

/** Where a line of text comes from. */
export type Src =
  | { phrase: string } // PHRASES entry, by its first English name
  | { ref: string; words?: [number, number]; key?: string; mark?: boolean } // Quran library; `key` = expected letters, checked by tests
  | { bismillah: true }
  | { name: number } // NAMES_99 entry (0 = الله)
  | { title: keyof typeof TITLES }
  | { surahTitle: number } // "سورة" + the surah's name from the library
  | { refLabel: string }; // "البقرة ٢٥٥" made from the library's surah name

export type Design = {
  id: string;
  title: string;
  /** One short line on what it is for. */
  hint: string;
  category: Category;
  /** What the card shows (resolved Arabic is shown once the library has loaded). */
  preview: Src;
  spec: Partial<PanelSpec>;
  header?: Src;
  lines?: Src[];
  footer?: Src;
  /** The customer types this part (a name). */
  ask?: "name";
};

/**
 * Short headings that are not Quran text or a phrase. Kept here, plain letters, checked by a person
 * who reads Arabic; designs.check.ts makes sure nothing else sneaks in.
 */
export const TITLES = {
  ayatKursi: "آية الكرسي",
} as const;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arNum = (n: number) => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] ?? d);
/** Pause marks (and the rub-el-hizb sign) belong in full ayahs only. */
const PAUSE = /[\u06d6-\u06dc\u06de\u06e9]/g;

const plaque = (w: number, h: number, more: Partial<PanelSpec> = {}): Partial<PanelSpec> => ({
  template: "plate",
  widthMm: w,
  heightMm: h,
  font: "quran",
  frame: true,
  frameStyle: "stepped",
  corners: "flowers",
  sections: false,
  header: "",
  footer: "",
  ...more,
});

/** A star-pattern panel; `more` adds a medallion, a different band or frame. */
const pat = (w: number, h: number, pattern: PanelSpec["pattern"], repeats: number, more: Partial<PanelSpec> = {}): Partial<PanelSpec> => ({
  template: "pattern",
  widthMm: w,
  heightMm: h,
  pattern,
  repeats,
  band: "double",
  medallion: "none",
  frame: true,
  frameStyle: "stepped",
  corners: "none",
  header: "",
  footer: "",
  sections: false,
  ...more,
});

export const DESIGNS: readonly Design[] = [
  // ---- names & home
  {
    id: "name-plate",
    title: "Name plate",
    hint: "A name with flower corners",
    category: "home",
    preview: { phrase: "Muhammad" },
    spec: plaque(300, 120, { font: "naskh" }),
    lines: [],
    ask: "name",
  },
  {
    id: "home-bismillah",
    title: "Home name with Bismillah",
    hint: "Family name under a Bismillah",
    category: "home",
    preview: { bismillah: true },
    spec: plaque(400, 200, { font: "naskh" }),
    header: { bismillah: true },
    lines: [],
    ask: "name",
  },
  {
    id: "enter-in-peace",
    title: "Enter in peace",
    hint: "Door plaque · 15:46",
    category: "home",
    preview: { ref: "15:46" },
    spec: plaque(400, 150, { corners: "flowers" }),
    lines: [{ ref: "15:46", key: "ادخلوها بسلم ءامنين" }],
  },
  {
    id: "from-my-lord",
    title: "This is from the grace of my Lord",
    hint: "Home or shop · 27:40",
    category: "home",
    preview: { ref: "27:40", words: [20, 23] },
    spec: plaque(400, 150),
    lines: [{ ref: "27:40", words: [20, 23], key: "هذا من فضل رب" }],
  },
  {
    id: "mashallah",
    title: "Masha'Allah, la quwwata illa billah",
    hint: "Door plaque · 18:39",
    category: "home",
    preview: { ref: "18:39", words: [6, 12] },
    spec: plaque(450, 150),
    lines: [{ ref: "18:39", words: [6, 12], key: "ما شاء الله لا قوه الا بالله" }],
  },
  {
    id: "parents",
    title: "My Lord, have mercy on them",
    hint: "For parents · 17:24",
    category: "home",
    preview: { ref: "17:24", words: [7, 12] },
    spec: plaque(450, 180),
    lines: [{ ref: "17:24", words: [7, 12], key: "وقل رب ارحمهما كما ربيان صغيرا" }],
  },
  {
    id: "knowledge",
    title: "My Lord, increase me in knowledge",
    hint: "Study room or school · 20:114",
    category: "home",
    preview: { ref: "20:114", words: [14, 17] },
    spec: plaque(400, 150),
    lines: [{ ref: "20:114", words: [14, 17], key: "وقل رب زدن علما" }],
  },

  // ---- Quran
  {
    id: "ayat-kursi",
    title: "Ayat al-Kursi",
    hint: "The Throne Verse · 2:255",
    category: "quran",
    preview: { ref: "2:255", words: [1, 4] },
    spec: plaque(600, 420),
    header: { title: "ayatKursi" },
    lines: [{ ref: "2:255" }],
    footer: { refLabel: "2:255" },
  },
  {
    id: "ikhlas",
    title: "Surah Al-Ikhlas",
    hint: "Four short ayahs",
    category: "quran",
    preview: { surahTitle: 112 },
    spec: plaque(400, 400),
    header: { surahTitle: 112 },
    lines: [{ ref: "112:1", mark: true }, { ref: "112:2", mark: true }, { ref: "112:3", mark: true }, { ref: "112:4", mark: true }],
  },
  {
    id: "fatiha",
    title: "Surah Al-Fatiha",
    hint: "The Opening",
    category: "quran",
    preview: { surahTitle: 1 },
    spec: plaque(500, 560),
    header: { surahTitle: 1 },
    lines: [{ ref: "1:2-7" }],
  },
  {
    id: "four-quls",
    title: "The Four Quls",
    hint: "Al-Kafirun, Al-Ikhlas, Al-Falaq, An-Nas",
    category: "quran",
    preview: { phrase: "Bismillah ir-Rahman ir-Rahim" },
    spec: plaque(600, 800, { sections: true }),
    header: { bismillah: true },
    lines: [{ ref: "109:1-6" }, { ref: "112:1-4" }, { ref: "113:1-5" }, { ref: "114:1-6" }],
  },
  {
    id: "ease",
    title: "With hardship comes ease",
    hint: "94:5",
    category: "quran",
    preview: { ref: "94:5" },
    spec: plaque(400, 150),
    lines: [{ ref: "94:5", key: "فان مع العسر يسرا" }],
  },
  {
    id: "hearts",
    title: "In the remembrance of Allah",
    hint: "Hearts find rest · 13:28",
    category: "quran",
    preview: { ref: "13:28", words: [7, 11] },
    spec: plaque(450, 150),
    lines: [{ ref: "13:28", words: [7, 11], key: "الا بذكر الله تطمين القلوب" }],
  },
  {
    id: "tawakkul",
    title: "Whoever relies upon Allah",
    hint: "65:3",
    category: "quran",
    preview: { ref: "65:3", words: [6, 11] },
    spec: plaque(450, 150),
    lines: [{ ref: "65:3", words: [6, 11], key: "ومن يتوكل عل الله فهو حسبه" }],
  },
  {
    id: "rabbana-atina",
    title: "Rabbana atina",
    hint: "Dua · 2:201",
    category: "quran",
    preview: { ref: "2:201", words: [4, 7] },
    spec: plaque(500, 220),
    lines: [{ ref: "2:201", words: [4, 14], key: "ربنا ءاتنا في الدنيا حسنه وف الاخره حسنه وقنا عذاب النار" }],
  },

  // ---- dhikr
  {
    id: "bismillah",
    title: "Bismillah",
    hint: "Long plaque",
    category: "dhikr",
    preview: { bismillah: true },
    spec: plaque(600, 180, { corners: "flowers" }),
    lines: [{ bismillah: true }],
  },
  {
    id: "shahada",
    title: "Shahada (Kalima)",
    hint: "Two lines",
    category: "dhikr",
    preview: { phrase: "La ilaha illallah" },
    spec: plaque(400, 260, { font: "naskh" }),
    lines: [{ phrase: "La ilaha illallah" }, { phrase: "Muhammad Rasulullah" }],
  },
  {
    id: "mashallah-tabarak",
    title: "Masha'Allah · Tabarak Allah",
    hint: "Two lines",
    category: "dhikr",
    preview: { phrase: "Mashallah" },
    spec: plaque(300, 260, { font: "naskh" }),
    lines: [{ phrase: "Mashallah" }, { ref: "7:54", words: [29, 30], key: "تبارك الله" }],
  },
  {
    id: "inna-lillahi",
    title: "Inna lillahi",
    hint: "2:156",
    category: "dhikr",
    preview: { ref: "2:156", words: [6, 10] },
    spec: plaque(450, 150),
    lines: [{ ref: "2:156", words: [6, 10], key: "انا لله وانا اليه رجعون" }],
  },

  // ---- boards
  {
    id: "names99",
    title: "99 Names of Allah",
    hint: "Bismillah + 100 tiles",
    category: "boards",
    preview: { name: 0 },
    spec: { template: "names99", widthMm: 600, heightMm: 600, font: "naskh", header: BISMILLAH, frame: true, frameStyle: "stepped", corners: "flowers" },
  },
  {
    id: "tasbih-board",
    title: "Tasbih board",
    hint: "Four dhikr tiles",
    category: "boards",
    preview: { phrase: "Subhanallah" },
    spec: { template: "grid", widthMm: 400, heightMm: 400, columns: 2, font: "naskh", header: BISMILLAH, frame: true, frameStyle: "stepped", corners: "flowers" },
    lines: [{ phrase: "Subhanallah" }, { phrase: "Alhamdulillah" }, { phrase: "La ilaha illallah" }, { phrase: "Allahu Akbar" }],
  },
  {
    id: "allah-muhammad",
    title: "Allah · Muhammad",
    hint: "Two tiles",
    category: "boards",
    preview: { phrase: "Muhammad" },
    spec: { template: "grid", widthMm: 500, heightMm: 260, columns: 2, font: "naskh", header: "", frame: true, frameStyle: "classic", corners: "none" },
    lines: [{ name: 0 }, { phrase: "Muhammad" }],
  },

  // ---- shaped plaques
  {
    id: "arch-name",
    title: "Arch name plaque",
    hint: "Bismillah in the arch, name below",
    category: "home",
    preview: { phrase: "Muhammad" },
    spec: plaque(300, 400, { font: "naskh", shape: "arch" }),
    header: { bismillah: true },
    lines: [],
    ask: "name",
  },
  {
    id: "oval-mashallah",
    title: "Oval Masha'Allah",
    hint: "Classic oval plaque",
    category: "dhikr",
    preview: { phrase: "Mashallah" },
    spec: plaque(400, 260, { font: "naskh", shape: "oval", corners: "none", frameStyle: "classic" }),
    lines: [{ phrase: "Mashallah" }],
  },

  // ---- geometric patterns (lines are exact geometry; text only in a medallion)
  {
    id: "allah-sunburst",
    title: "Allah in a 12-point star",
    hint: "Round centre, star rays around it",
    category: "patterns",
    preview: { name: 0 },
    spec: pat(500, 500, "star12", 1, { medallion: "circle", font: "naskh" }),
    lines: [{ name: 0 }],
  },
  {
    id: "star-cross",
    title: "Star and cross",
    hint: "Woven over and under, 8-point stars",
    category: "patterns",
    preview: { name: 0 },
    spec: pat(400, 400, "star8", 3, { frameStyle: "classic", band: "woven" }),
  },
  {
    id: "khatam-door",
    title: "Khatam door panel",
    hint: "Tall panel for doors and cabinets",
    category: "patterns",
    preview: { name: 0 },
    spec: pat(400, 800, "octagon8", 2),
  },
  {
    id: "muhammad-star",
    title: "Muhammad in an 8-point star",
    hint: "Star-and-cross with a round centre",
    category: "patterns",
    preview: { phrase: "Muhammad" },
    spec: pat(500, 500, "star8", 2, { medallion: "circle", font: "naskh" }),
    lines: [{ phrase: "Muhammad" }],
  },
  {
    id: "mashallah-khatam",
    title: "Masha'Allah in a khatam star",
    hint: "8-point stars around the centre",
    category: "patterns",
    preview: { phrase: "Mashallah" },
    spec: pat(500, 500, "octagon8", 1.5, { medallion: "circle", font: "naskh" }),
    lines: [{ phrase: "Mashallah" }],
  },
  {
    id: "rosette-wall",
    title: "12-point rosettes",
    hint: "Rich wall panel",
    category: "patterns",
    preview: { name: 0 },
    spec: pat(600, 600, "star12", 2),
  },
  {
    id: "hex-screen",
    title: "Hexagon screen",
    hint: "6-point stars, cut as grooves",
    category: "patterns",
    preview: { name: 0 },
    spec: pat(400, 600, "star6", 3, { band: "groove", frameStyle: "classic" }),
  },
];

// ---------------------------------------------------------------- resolving

/** Arabic for one source, or null when it needs the library and the library is not loaded (or the reference is wrong). */
export function resolveSrc(src: Src, index: QuranIndex | null): string | null {
  if ("bismillah" in src) return BISMILLAH;
  if ("name" in src) return NAMES_99[src.name] ?? null;
  if ("title" in src) return TITLES[src.title];
  if ("phrase" in src) {
    const p = PHRASES.find((x) => x.en[0] === src.phrase);
    return p ? p.ar : null;
  }
  if (!index) return null;
  if ("surahTitle" in src) {
    const s = index.s[src.surahTitle - 1];
    return s ? `سورة ${s[1]}` : null;
  }
  if ("refLabel" in src) {
    const m = src.refLabel.match(/^(\d+):(\d+)(?:-(\d+))?$/);
    const s = m ? index.s[Number(m[1]) - 1] : undefined;
    if (!m || !s) return null;
    return `${s[1]} ${arNum(Number(m[2]))}${m[3] ? "–" + arNum(Number(m[3])) : ""}`;
  }
  const m = src.ref.match(/^(\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const s = index.s[Number(m[1]) - 1];
  if (!s) return null;
  const a = Number(m[2]);
  const b = Number(m[3] ?? a);
  const parts: string[] = [];
  for (let k = a; k <= b; k++) {
    const ayah = s[3][k - 1];
    if (!ayah) return null;
    let t = ayah[0];
    if (src.words) {
      t = t.split(/\s+/).slice(src.words[0] - 1, src.words[1]).join(" ").replace(PAUSE, "").trim();
      if (!t) return null;
    }
    parts.push(b > a || src.mark ? `${t} ﴿${arNum(k)}﴾` : t);
  }
  return forFont(parts.join(" "));
}

/**
 * The panel for a design. Lines the customer types (a name) are left empty. Returns null if any
 * Quran text is needed but the library is not loaded yet.
 */
export function applyDesign(d: Design, index: QuranIndex | null, keep?: PanelSpec): PanelSpec | null {
  const r = (x: Src | undefined) => (x ? resolveSrc(x, index) : "");
  const header = r(d.header);
  const footer = r(d.footer);
  const lines = (d.lines ?? []).map((l) => resolveSrc(l, index));
  if (header === null || footer === null || lines.some((l) => l === null)) return null;
  const base = { ...DEFAULT_SPEC, style: keep?.style ?? DEFAULT_SPEC.style, letterMm: keep?.letterMm ?? DEFAULT_SPEC.letterMm };
  return {
    ...base,
    header: "",
    footer: "",
    sections: false,
    ...d.spec,
    ...(d.header ? { header } : {}),
    ...(d.footer ? { footer } : {}),
    lines: lines as string[],
  } as PanelSpec;
}

export const designById = (id: string): Design | undefined => DESIGNS.find((d) => d.id === id);
