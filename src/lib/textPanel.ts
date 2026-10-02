/**
 * Text & panel reliefs — exact, typeset lettering. No depth guessing, so every
 * dot, hamza and madda the font draws is carved exactly.
 *
 *   PanelSpec → layoutPanel → (browser) rasterPanel: fitText + canvas masks
 *             → composePanel (heights in mm) → normalized field → buildRelief / RLF / TIFF
 *
 * Everything here is pure (no DOM), so it runs in `pnpm check`.
 */
import { gaussianBlur } from "./relief";
import { cornerParts, drawParts, drawTube, pocketArc, type Pocket, type Pt } from "./ornament";

export type LetterStyle = "raised" | "vcarve" | "flat";
export type Template = "plate" | "names99" | "grid";
export type FontId = "naskh" | "quran";
export type FrameStyle = "classic" | "stepped";
/** Corner decoration: "stars" = two rosettes in the header (header templates only). */
export type Corners = "none" | "stars" | "flowers";
export type Box = { x0: number; y0: number; x1: number; y1: number };

export const FONTS: Record<FontId, { family: string; url: string; label: string }> = {
  naskh: { family: "CarveAmiri", url: "/fonts/Amiri-Bold.ttf", label: "Naskh (Amiri)" },
  quran: { family: "CarveAmiriQuran", url: "/fonts/AmiriQuran-Regular.ttf", label: "Quran script (Amiri Quran)" },
};

export const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";

/** الله followed by the 99 Names in the order narrated by al-Tirmidhi. */
export const NAMES_99: readonly string[] = [
  "الله",
  "الرحمن", "الرحيم", "الملك", "القدوس", "السلام", "المؤمن", "المهيمن", "العزيز", "الجبار", "المتكبر",
  "الخالق", "البارئ", "المصور", "الغفار", "القهار", "الوهاب", "الرزاق", "الفتاح", "العليم", "القابض",
  "الباسط", "الخافض", "الرافع", "المعز", "المذل", "السميع", "البصير", "الحكم", "العدل", "اللطيف",
  "الخبير", "الحليم", "العظيم", "الغفور", "الشكور", "العلي", "الكبير", "الحفيظ", "المقيت", "الحسيب",
  "الجليل", "الكريم", "الرقيب", "المجيب", "الواسع", "الحكيم", "الودود", "المجيد", "الباعث", "الشهيد",
  "الحق", "الوكيل", "القوي", "المتين", "الولي", "الحميد", "المحصي", "المبدئ", "المعيد", "المحيي",
  "المميت", "الحي", "القيوم", "الواجد", "الماجد", "الواحد", "الأحد", "الصمد", "القادر", "المقتدر",
  "المقدم", "المؤخر", "الأول", "الآخر", "الظاهر", "الباطن", "الوالي", "المتعالي", "البر", "التواب",
  "المنتقم", "العفو", "الرؤوف", "مالك الملك", "ذو الجلال والإكرام", "المقسط", "الجامع", "الغني", "المغني", "المانع",
  "الضار", "النافع", "النور", "الهادي", "البديع", "الباقي", "الوارث", "الرشيد", "الصبور",
];

/** Units per row for the 99 Names board: 7 rows of 11, then row 8 with "ذو الجلال والإكرام" twice as wide, then 13. */
export const NAMES_99_ROWS: readonly (readonly number[])[] = [
  ...Array.from({ length: 7 }, () => Array<number>(11).fill(1)),
  [1, 1, 1, 1, 1, 1, 1, 1, 2, 1],
  Array<number>(13).fill(1),
];

export type PanelSpec = {
  template: Template;
  widthMm: number;
  heightMm: number;
  /** plate: one entry per line · grid: one entry per tile · names99: ignored */
  lines: string[];
  /** Header text across the top ("" for none). names99 defaults to the Bismillah. */
  header: string;
  font: FontId;
  style: LetterStyle;
  /** Raised height (raised / flat) or V-carve depth of the lettering, mm. */
  letterMm: number;
  frame: boolean;
  /** Moulding shape when `frame` is on. */
  frameStyle: FrameStyle;
  corners: Corners;
  /** grid only */
  columns: number;
};

export const DEFAULT_SPEC: PanelSpec = {
  template: "names99",
  widthMm: 600,
  heightMm: 600,
  lines: [],
  header: BISMILLAH,
  font: "naskh",
  style: "raised",
  letterMm: 1.8,
  frame: true,
  frameStyle: "stepped",
  corners: "flowers",
  columns: 4,
};

/** Change template, resetting what belongs to the old one (the 99 Names board uses Naskh + Bismillah). */
export function switchTemplate(spec: PanelSpec, t: Template): PanelSpec {
  if (t === "names99") return { ...spec, template: t, header: BISMILLAH, font: "naskh" };
  if (t === "plate") return { ...spec, template: t, header: "", lines: spec.lines.some((l) => l.trim()) ? spec.lines : ["بسم الله"] };
  return { ...spec, template: t, header: spec.header === BISMILLAH ? "" : spec.header };
}

export const SIZE_MIN = 30;
export const SIZE_MAX = 3000;
/** What is wrong with the panel size, in words for the user, or null. */
export function sizeProblem(spec: PanelSpec): string | null {
  for (const [k, v] of [["Width", spec.widthMm], ["Height", spec.heightMm]] as const)
    if (!(v >= SIZE_MIN && v <= SIZE_MAX)) return `${k} must be between ${SIZE_MIN} and ${SIZE_MAX} mm.`;
  return null;
}

/**
 * Pasted Uthmani Quran text (King Fahd Complex encoding) borrows U+0657 / U+0656 / U+065E for open
 * fathatan / kasratan / dammatan; map them to the proper Unicode marks the fonts draw. Indo-Pak text uses
 * U+0657 for "ulta pesh", so the first two are only mapped when the text is clearly Uthmani
 * (alif wasla or the Uthmani sukun). U+065E is only ever open dammatan.
 */
export function quranMarks(t: string): string {
  const u = t.replace(/\u065e/g, "\u08f1");
  return /[\u0671\u06e1]/.test(u) ? u.replace(/\u0657/g, "\u08f0").replace(/\u0656/g, "\u08f2") : u;
}

/** Read text-panel settings saved in the browser; anything missing, unknown or out of range falls back to the default. */
export function restoreSpec(saved: string | null): PanelSpec {
  let o: Record<string, unknown>;
  try {
    o = saved ? (JSON.parse(saved) as Record<string, unknown>) : {};
    if (!o || typeof o !== "object") o = {};
  } catch {
    o = {};
  }
  const d = DEFAULT_SPEC;
  const pick = <T,>(v: unknown, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);
  const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
  return {
    template: pick(o.template, ["names99", "plate", "grid"] as const, d.template),
    widthMm: num(o.widthMm, 1, 10000, d.widthMm),
    heightMm: num(o.heightMm, 1, 10000, d.heightMm),
    lines: Array.isArray(o.lines) ? o.lines.filter((l): l is string => typeof l === "string").slice(0, 200).map((l) => l.slice(0, 500)) : d.lines,
    header: typeof o.header === "string" ? o.header.slice(0, 500) : d.header,
    font: pick(o.font, ["naskh", "quran"] as const, d.font),
    style: pick(o.style, ["raised", "vcarve", "flat"] as const, d.style),
    letterMm: num(o.letterMm, 0.6, 4, d.letterMm),
    frame: typeof o.frame === "boolean" ? o.frame : d.frame,
    frameStyle: pick(o.frameStyle, ["classic", "stepped"] as const, d.frameStyle),
    corners: pick(o.corners, ["none", "stars", "flowers"] as const, d.corners),
    columns: Math.round(num(o.columns, 1, 20, d.columns)),
  };
}

export type TextItem = {
  text: string;
  font: FontId;
  box: Box;
  /** Items in a group share one letter size (the typical tile fits; long ones shrink alone). */
  group: string;
  role: "header" | "text";
  allowSplit: boolean;
};
export type Star = { cx: number; cy: number; r: number };
export type Layout = {
  widthMm: number;
  heightMm: number;
  frameMm: number;
  frameStyle: FrameStyle;
  beads: Box[];
  /** Raised lines that are not rectangles (the arcs closing corner pockets). */
  arcs: Pt[][];
  /** Corner pockets that hold a flower spray. */
  pockets: Pocket[];
  tiles: Box[];
  items: TextItem[];
  stars: Star[];
};

const inset = (b: Box, d: number): Box => ({ x0: b.x0 + d, y0: b.y0 + d, x1: b.x1 - d, y1: b.y1 - d });

function headerParts(spec: PanelSpec, x0: number, x1: number, y0: number, h: number) {
  const box: Box = { x0, y0, x1, y1: y0 + h };
  const r = Math.min(h * 0.24, (x1 - x0) * 0.045);
  let stars: Star[] = [];
  let pockets: Pocket[] = [];
  let side = r * 1.2; // text inset from each end
  if (spec.corners === "stars") {
    stars = [
      { cx: x0 + r * 1.9, cy: y0 + h / 2, r },
      { cx: x1 - r * 1.9, cy: y0 + h / 2, r },
    ];
    side = r * 4.2;
  } else if (spec.corners === "flowers") {
    // pockets in the two top corners, closed by a quarter arc, as on classic 99 Names boards
    const pr = Math.min(h * 0.97, (x1 - x0) * 0.17);
    pockets = [
      { cx: x0, cy: y0, sx: 1, sy: 1, r: pr },
      { cx: x1, cy: y0, sx: -1, sy: 1, r: pr },
    ];
    side = pr * 1.02;
  }
  const item: TextItem = {
    text: spec.header,
    font: "quran",
    box: { x0: x0 + side, y0: y0 + h * 0.08, x1: x1 - side, y1: y0 + h * 0.92 },
    group: "header",
    role: "header",
    allowSplit: false,
  };
  return { box, stars, pockets, item };
}

/**
 * The text box for one plate line. Corner pockets only cut into the top and bottom of the plate,
 * so a line may give up some height to gain width: try trimming the band from each end and keep
 * the box that allows the largest letters for this text (estimated, ~0.5 em per character).
 */
function lineBox(band: Box, pad: number, pockets: readonly Pocket[], text: string, gap: number): Box {
  const plain = (y0: number, y1: number): Box => {
    const side = Math.max(pad, pockets.length ? pocketReach(pockets, y0, y1) + gap : 0);
    return { x0: band.x0 + side, y0, x1: band.x1 - side, y1 };
  };
  const y0 = band.y0 + pad;
  const y1 = band.y1 - pad;
  if (!pockets.length) return plain(y0, y1);
  const em = Math.max(1, [...text].length * 0.5);
  const words = Math.min(4, text.trim().split(/\s+/).length);
  const hh = y1 - y0;
  let best = plain(y0, y1);
  let bestSize = -1;
  for (let a = 0; a <= 0.4001; a += 0.05) {
    for (let c = 0; c <= 0.4001; c += 0.05) {
      const box = plain(y0 + a * hh, y1 - c * hh);
      // a long line may wrap (fitText does that): k lines share the height and split the width
      let size = 0;
      for (let k = 1; k <= words; k++) size = Math.max(size, Math.min((box.y1 - box.y0) / (1 + 1.35 * (k - 1)), ((box.x1 - box.x0) * k) / em));
      if (size > bestSize + 1e-9) {
        bestSize = size;
        best = box;
      }
    }
  }
  return best;
}

/** How far the corner pockets reach into a band [y0, y1] from the left/right edge. */
function pocketReach(pockets: readonly Pocket[], y0: number, y1: number): number {
  let reach = 0;
  for (const p of pockets) {
    // nearest y of the band to the pocket's corner
    const dy = p.sy === 1 ? Math.max(0, y0 - p.cy) : Math.max(0, p.cy - y1);
    if (dy < p.r) reach = Math.max(reach, Math.sqrt(p.r * p.r - dy * dy));
  }
  return reach;
}

/** Rows of tiles right-to-left (Arabic reading order), each row split by its units. */
function tileRows(rowsUnits: readonly (readonly number[])[], x0: number, x1: number, y0: number, y1: number): Box[][] {
  const rh = (y1 - y0) / rowsUnits.length;
  return rowsUnits.map((units, r) => {
    const tot = units.reduce((a, b) => a + b, 0);
    const cw = (x1 - x0) / tot;
    let x = x1;
    return units.map((u) => {
      const b: Box = { x0: x - u * cw, y0: y0 + r * rh, x1: x, y1: y0 + (r + 1) * rh };
      x -= u * cw;
      return b;
    });
  });
}

export function layoutPanel(spec: PanelSpec): Layout {
  const W = spec.widthMm;
  const H = spec.heightMm;
  const m = Math.min(W, H);
  const frameMm = spec.frame ? +((spec.frameStyle === "stepped" ? 0.062 : 0.043) * m).toFixed(2) : 0;
  const pad = spec.frame ? 0.012 * m : 0.02 * m;
  const inner: Box = { x0: frameMm + pad, y0: frameMm + pad, x1: W - frameMm - pad, y1: H - frameMm - pad };
  const iw = inner.x1 - inner.x0;
  const ih = inner.y1 - inner.y0;
  const gap = Math.max(0.6, 0.0027 * m);
  const out: Layout = { widthMm: W, heightMm: H, frameMm, frameStyle: spec.frameStyle, beads: [], arcs: [], pockets: [], tiles: [], items: [], stars: [] };

  if (spec.template === "plate") {
    out.beads.push(inner);
    if (spec.corners === "flowers") {
      // a flower spray in each corner; keep them small enough to leave room for the name
      const pr = Math.min(0.38 * Math.min(iw, ih), 0.2 * Math.max(iw, ih));
      out.pockets = [
        { cx: inner.x0, cy: inner.y0, sx: 1, sy: 1, r: pr },
        { cx: inner.x1, cy: inner.y0, sx: -1, sy: 1, r: pr },
        { cx: inner.x0, cy: inner.y1, sx: 1, sy: -1, r: pr },
        { cx: inner.x1, cy: inner.y1, sx: -1, sy: -1, r: pr },
      ];
      out.arcs = out.pockets.map((p) => pocketArc(p));
    }
    const lines = spec.lines.map((s) => s.trim()).filter(Boolean);
    const n = Math.max(1, lines.length);
    const lh = ih / n;
    lines.forEach((t, i) => {
      const band = { x0: inner.x0, y0: inner.y0 + i * lh, x1: inner.x1, y1: inner.y0 + (i + 1) * lh };
      const pad = Math.min(lh, iw) * 0.08;
      out.items.push({
        text: t,
        font: spec.font,
        box: lineBox(band, pad, out.pockets, t, 0.02 * iw),
        group: `plate${i}`, // each line fills its own row (a name plate mixes sizes)
        role: "text",
        allowSplit: false,
      });
    });
    out.items = out.items.map((it) => ({ ...it, text: quranMarks(it.text) }));
    return out;
  }

  const words = spec.template === "names99" ? [...NAMES_99] : spec.lines.map((s) => s.trim()).filter(Boolean);
  const header = spec.template === "names99" && !spec.header.trim() ? BISMILLAH : spec.header.trim();
  let gridTop = inner.y0;
  if (header) {
    const hh = 0.22 * ih;
    const hp = headerParts({ ...spec, header }, inner.x0, inner.x1, inner.y0, hh);
    out.beads.push(hp.box);
    out.stars.push(...hp.stars);
    out.pockets.push(...hp.pockets);
    out.arcs.push(...hp.pockets.map((p) => pocketArc(p)));
    out.items.push(hp.item);
    gridTop = inner.y0 + hh + 0.013 * ih;
  }
  const gridBox: Box = { x0: inner.x0, y0: gridTop, x1: inner.x1, y1: inner.y1 };
  out.beads.push(gridBox);

  let units: readonly (readonly number[])[];
  if (spec.template === "names99") units = NAMES_99_ROWS;
  else {
    const c = Math.max(1, Math.round(spec.columns));
    const rows = Math.max(1, Math.ceil(words.length / c));
    units = Array.from({ length: rows }, (_, r) => Array<number>(Math.min(c, words.length - r * c) || c).fill(1));
  }
  const rows = tileRows(units, gridBox.x0, gridBox.x1, gridBox.y0, gridBox.y1);
  let k = 0;
  rows.forEach((row, ri) => {
    const small = spec.template === "names99" && ri === rows.length - 1;
    for (const b of row) {
      const tile = inset(b, gap);
      out.tiles.push(tile);
      const word = words[k++];
      if (!word) continue;
      out.items.push({
        text: word,
        font: spec.font,
        box: inset(tile, Math.max(1, (tile.x1 - tile.x0) * 0.05)),
        group: small ? "small" : "tile",
        role: "text",
        allowSplit: true,
      });
    }
  });
  out.items = out.items.map((it) => ({ ...it, text: quranMarks(it.text) }));
  return out;
}

// ---------------------------------------------------------------- text fitting

/** Width of `text` set at `sizeMm`, in mm. The browser measures with canvas; tests use a stand-in. */
export type Measure = (text: string, font: FontId, sizeMm: number) => number;
export type DrawOp = { text: string; font: FontId; cx: number; baseline: number; sizeMm: number; role: "header" | "text"; /** measured ink height (browser only) */ inkMm?: number };

const LINE_CAP = 0.62; // single line: letter size ≤ 62 % of the box height
const LINE_CAP_ARABIC = 0.8; // Arabic letters sit lower in the em than Latin capitals, so they may use more of it
const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;
const capOf = (it: TextItem) => (it.box.y1 - it.box.y0) * (it.role === "text" && ARABIC.test(it.text) && !/[A-Za-z]/.test(it.text) ? LINE_CAP_ARABIC : LINE_CAP);
const SPLIT_BELOW = 0.72; // a two-word name smaller than this × the group size goes on two lines

function fits(measure: Measure, it: TextItem, size: number): boolean {
  return measure(it.text, it.font, size) <= it.box.x1 - it.box.x0;
}

export function fitText(items: readonly TextItem[], measure: Measure): DrawOp[] {
  const ops: DrawOp[] = [];
  const groups = new Map<string, TextItem[]>();
  for (const it of items) groups.set(it.group, [...(groups.get(it.group) ?? []), it]);
  for (const [, group] of groups) {
    const cap = Math.min(...group.map(capOf));
    const slack = group.length >= 9 ? Math.max(2, Math.floor(group.length / 9)) : 0;
    let base = cap;
    while (base > cap * 0.15 && group.filter((g) => fits(measure, g, base)).length < group.length - slack) base *= 0.97;
    for (const it of group) {
      const bw = it.box.x1 - it.box.x0;
      const bh = it.box.y1 - it.box.y0;
      const cx = (it.box.x0 + it.box.x1) / 2;
      const cy = (it.box.y0 + it.box.y1) / 2;
      let size = Math.min(base, capOf(it));
      while (size > base * 0.2 && !fits(measure, it, size)) size *= 0.97;
      const words = it.text.split(" ");
      if (it.group.startsWith("plate") && words.length >= 4 && size < capOf(it) * 0.9) {
        // sentences / ayahs squeezed by the width; short phrases and names keep their one row
        // a long plate line: wrap onto the number of lines that gives the biggest letters
        const LH = 1.5; // line pitch in em (room for Arabic marks above and below)
        let best = { size, lines: [it.text] };
        for (let k = 2; k <= Math.min(6, words.length); k++) {
          const lines = balance(words, k);
          let s2 = bh / (k * LH);
          while (s2 > 0.5 && Math.max(...lines.map((l) => measure(l, it.font, s2))) > bw) s2 *= 0.97;
          if (s2 > best.size * 1.05) best = { size: s2, lines };
        }
        if (best.lines.length > 1) {
          const top = cy - (best.lines.length * LH * best.size) / 2;
          best.lines.forEach((l, i) => ops.push({ text: l, font: it.font, cx, baseline: top + (i * LH + 1) * best.size, sizeMm: best.size, role: it.role }));
          continue;
        }
      }
      if (it.allowSplit && words.length >= 2 && size < base * SPLIT_BELOW) {
        const mid = Math.ceil(words.length / 2);
        const l1 = words.slice(0, mid).join(" ");
        const l2 = words.slice(mid).join(" ");
        let s2 = Math.min(base * 0.92, bh / 2.3);
        while (s2 > base * 0.2 && Math.max(measure(l1, it.font, s2), measure(l2, it.font, s2)) > bw) s2 *= 0.97;
        ops.push({ text: l1, font: it.font, cx, baseline: cy - 0.22 * s2, sizeMm: s2, role: it.role });
        ops.push({ text: l2, font: it.font, cx, baseline: cy + 0.92 * s2, sizeMm: s2, role: it.role });
        continue;
      }
      ops.push({ text: it.text, font: it.font, cx, baseline: cy + 0.32 * size, sizeMm: size, role: it.role });
    }
  }
  return ops;
}

/** Split words into k lines of similar length (in characters), keeping their order. */
function balance(words: readonly string[], k: number): string[] {
  const total = words.reduce((a, w) => a + w.length + 1, -1);
  const lines: string[] = [];
  let cur: string[] = [];
  let len = 0;
  words.forEach((w, i) => {
    const left = words.length - i;
    const linesLeft = k - lines.length;
    if (cur.length && (len + w.length + 1 > total / k * 1.08 || left < linesLeft) && lines.length < k - 1) {
      lines.push(cur.join(" "));
      cur = [];
      len = 0;
    }
    cur.push(w);
    len += w.length + (cur.length > 1 ? 1 : 0);
  });
  if (cur.length) lines.push(cur.join(" "));
  return lines;
}

// ---------------------------------------------------------------- distance transform

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher, lower envelope of parabolas). */
function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  const sect = (q: number, p: number) => ((f[q] ?? 0) + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < n; q++) {
    let s = sect(q, v[k] ?? 0);
    while (s <= (z[k] ?? -Infinity)) {
      k--;
      s = sect(q, v[k] ?? 0);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? Infinity) < q) k++;
    const p = v[k] ?? 0;
    d[q] = (q - p) * (q - p) + (f[p] ?? 0);
  }
}

/** Distance (px) from each inside pixel to the nearest outside pixel; 0 outside. */
export function distanceInside(inside: Uint8Array, cols: number, rows: number): Float32Array {
  const BIG = 1e20;
  const n = Math.max(cols, rows);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const g = new Float64Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) g[i] = inside[i] ? BIG : 0;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) f[y] = g[y * cols + x] ?? 0;
    dt1(f, rows, d, v, z);
    for (let y = 0; y < rows; y++) g[y * cols + x] = d[y] ?? 0;
  }
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) f[x] = g[y * cols + x] ?? 0;
    dt1(f, cols, d, v, z);
    for (let x = 0; x < cols; x++) out[y * cols + x] = Math.sqrt(d[x] ?? 0);
  }
  return out;
}

// ---------------------------------------------------------------- relief

export type Masks = {
  /** coverage 0..1 of the lettering */
  text: Float32Array;
  header: Float32Array;
  stars: Float32Array;
};

/** Rows for `cols` with square pixels. */
export function gridFor(widthMm: number, heightMm: number, longSide: number): { cols: number; rows: number } {
  const k = longSide / Math.max(widthMm, heightMm);
  return { cols: Math.max(8, Math.round(widthMm * k)), rows: Math.max(8, Math.round(heightMm * k)) };
}

function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  if (x <= (xs[0] ?? 0)) return ys[0] ?? 0;
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1] ?? 0;
    const b = xs[i] ?? 0;
    if (x <= b) return (ys[i - 1] ?? 0) + (((ys[i] ?? 0) - (ys[i - 1] ?? 0)) * (x - a)) / (b - a || 1);
  }
  return ys[ys.length - 1] ?? 0;
}

const FRAME_U = [0, 0.05, 0.12, 0.3, 0.42, 0.58, 0.72, 0.86, 1] as const;
const FRAME_Z = [4.2, 5.6, 6.0, 7.2, 6.9, 4.6, 4.4, 3.0, 1.0] as const;
/** Wider double moulding: outer ogee, flat band, a raised inner step, then down to the field. */
const STEP_U = [0, 0.04, 0.1, 0.2, 0.27, 0.34, 0.5, 0.56, 0.6, 0.7, 0.76, 0.8, 0.9, 1] as const;
const STEP_Z = [4.4, 5.8, 6.6, 7.4, 7.0, 5.6, 5.6, 6.6, 6.9, 6.6, 5.0, 3.6, 3.2, 1.0] as const;
const FIELD = 1.0;
const TILE_RISE = 1.6;

function binary(c: Float32Array): Uint8Array {
  const b = new Uint8Array(c.length);
  for (let i = 0; i < c.length; i++) b[i] = (c[i] ?? 0) > 0.5 ? 1 : 0;
  return b;
}

/**
 * Heights in mm, then normalized to 0..1. `depthMm` is the real relief range, so
 * buildRelief / RLF reproduce the exact millimetres.
 */
export function composePanel(
  layout: Layout,
  masks: Masks,
  cols: number,
  rows: number,
  style: LetterStyle,
  letterMm: number,
): { h: Float32Array; depthMm: number; heightsMm: Float32Array } {
  const mmPx = layout.widthMm / cols;
  const n = cols * rows;
  const h = new Float32Array(n).fill(FIELD);
  const k = layout.frameMm > 0 ? Math.min(1, Math.max(0.35, layout.frameMm / 26)) : 0;

  // frame moulding
  if (layout.frameMm > 0) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const d = Math.min(x, cols - 1 - x, y, rows - 1 - y) * mmPx;
        if (d < layout.frameMm) {
          const z = layout.frameStyle === "stepped" ? interp(d / layout.frameMm, STEP_U, STEP_Z) : interp(d / layout.frameMm, FRAME_U, FRAME_Z);
          h[y * cols + x] = FIELD + (z - FIELD) * k;
        }
      }
    }
  }

  // beads around the header and the grid
  const bw = Math.max(0.6, 1.8 * (k || 0.6));
  for (const b of layout.beads) {
    const x0 = Math.max(0, Math.floor((b.x0 - bw - 2) / mmPx));
    const x1 = Math.min(cols - 1, Math.ceil((b.x1 + bw + 2) / mmPx));
    const y0 = Math.max(0, Math.floor((b.y0 - bw - 2) / mmPx));
    const y1 = Math.min(rows - 1, Math.ceil((b.y1 + bw + 2) / mmPx));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = (x + 0.5) * mmPx;
        const py = (y + 0.5) * mmPx;
        const inX = px >= b.x0 - bw && px <= b.x1 + bw;
        const inY = py >= b.y0 - bw && py <= b.y1 + bw;
        if (!inX || !inY) continue;
        const d = Math.min(Math.abs(px - b.x0), Math.abs(px - b.x1), Math.abs(py - b.y0), Math.abs(py - b.y1));
        if (d < bw) {
          const i = y * cols + x;
          const z = FIELD + 1.6 * Math.sqrt(Math.max(0, 1 - (d / bw) ** 2)) * Math.max(0.6, k);
          if (z > (h[i] ?? 0)) h[i] = z;
        }
      }
    }
  }

  // arcs closing the corner pockets: the same round bead as the box lines
  for (const a of layout.arcs) drawTube(h, cols, rows, mmPx, a, FIELD, 1.6 * Math.max(0.6, k), bw * 2);

  // tiles: raised faces with a soft bevel
  if (layout.tiles.length) {
    const tm = new Uint8Array(n);
    const r = Math.max(0.6, 1.6 * Math.max(0.5, k));
    for (const t of layout.tiles) {
      const x0 = Math.max(0, Math.floor(t.x0 / mmPx));
      const x1 = Math.min(cols - 1, Math.ceil(t.x1 / mmPx));
      const y0 = Math.max(0, Math.floor(t.y0 / mmPx));
      const y1 = Math.min(rows - 1, Math.ceil(t.y1 / mmPx));
      for (let y = y0; y <= y1; y++) {
        const py = (y + 0.5) * mmPx;
        for (let x = x0; x <= x1; x++) {
          const px = (x + 0.5) * mmPx;
          const dx = Math.max(t.x0 + r - px, 0, px - (t.x1 - r));
          const dy = Math.max(t.y0 + r - py, 0, py - (t.y1 - r));
          if (px >= t.x0 && px <= t.x1 && py >= t.y0 && py <= t.y1 && dx * dx + dy * dy <= r * r) tm[y * cols + x] = 1;
        }
      }
    }
    const dt = distanceInside(tm, cols, rows);
    const bevel = 1.4;
    for (let i = 0; i < n; i++) {
      if (!tm[i]) continue;
      const face = FIELD + TILE_RISE * Math.min(1, ((dt[i] ?? 0) * mmPx) / bevel) ** 0.7;
      if (face > (h[i] ?? 0)) h[i] = face;
    }
  }

  // lettering
  const addRounded = (mask: Float32Array, height: number, roundMm: number) => {
    const b = binary(mask);
    const dt = distanceInside(b, cols, rows);
    for (let i = 0; i < n; i++) {
      if (!b[i]) continue;
      const u = Math.min(1, ((dt[i] ?? 0) * mmPx) / roundMm);
      h[i] = (h[i] ?? 0) + height * Math.sqrt(Math.max(0, 1 - (1 - u) ** 2));
    }
  };
  if (style === "vcarve") {
    const b = binary(masks.text);
    const dt = distanceInside(b, cols, rows);
    const slope = 1.73; // 60° V-bit
    for (let i = 0; i < n; i++) if (b[i]) h[i] = (h[i] ?? 0) - Math.min((dt[i] ?? 0) * mmPx * slope, letterMm);
  } else if (style === "flat") {
    addRounded(masks.text, letterMm, Math.max(mmPx * 0.8, 0.25));
  } else {
    addRounded(masks.text, letterMm, Math.max(mmPx * 1.5, 0.75));
  }
  addRounded(masks.header, letterMm * 1.6, Math.max(mmPx * 2, 1.3));
  addRounded(masks.stars, letterMm * 1.2, Math.max(mmPx * 2, 2.5));
  // corner flower sprays, drawn exactly (heights relative to the field)
  for (const p of layout.pockets) drawParts(h, cols, rows, mmPx, cornerParts("flowers", p, letterMm * 1.5), FIELD);

  const sm = gaussianBlur(h, cols, rows, 0.6);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const z = sm[i] ?? 0;
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  const range = Math.max(1e-6, hi - lo);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ((sm[i] ?? 0) - lo) / range;
  return { h: out, depthMm: +range.toFixed(2), heightsMm: sm };
}
