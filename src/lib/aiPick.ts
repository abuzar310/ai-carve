/**
 * AI-assisted lookup that can never put AI-written Arabic on a carving.
 *
 * The model only sees English: the user's words and a numbered list of library
 * candidates. It may answer with candidate ids and Quran references — nothing
 * else is read. Each id / reference is checked against the library, and the
 * Arabic shown is copied from the library.
 */
import { byReference, type Hit, type QuranIndex } from "./quranSearch";

export type Candidate = { id: number; label: string; source: string; arabic: string; kind: Hit["kind"] };

export function buildPrompt(query: string, candidates: readonly Candidate[]): string {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 300);
  const list = candidates
    .slice(0, 40)
    .map((c) => `[${c.id}] ${c.label.slice(0, 90)} — ${c.source}`)
    .join("\n");
  return [
    "You help find Islamic text in a fixed library. The user typed English: a transliteration (how it sounds), a name, or a description of a verse.",
    "Pick the candidates that are what the user means, best first. You may also give Quran references (surah:ayah or surah:ayah-ayah) you are sure about, for example when the user describes a verse by meaning.",
    "Never write Arabic. Never invent ids. If nothing fits, return empty lists.",
    'Reply with JSON only: {"ids": [numbers], "refs": ["2:153"]}',
    "",
    `User typed: ${q}`,
    "",
    "Candidates:",
    list || "(none)",
  ].join("\n");
}

const REF = /^\s*(\d{1,3})\s*:\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*$/;

export function parseAiReply(text: string, candidates: readonly Candidate[], index: QuranIndex | null): Hit[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let data: { ids?: unknown; refs?: unknown };
  try {
    data = JSON.parse(m[0]) as typeof data;
  } catch {
    return [];
  }
  const out: Hit[] = [];
  const seen = new Set<string>();
  const add = (h: Hit) => {
    if (seen.has(h.source + h.arabic)) return;
    seen.add(h.source + h.arabic);
    out.push(h);
  };
  const byId = new Map(candidates.map((c) => [c.id, c]));
  for (const id of Array.isArray(data.ids) ? data.ids.slice(0, 8) : []) {
    if (typeof id !== "number" || !Number.isInteger(id)) continue;
    const c = byId.get(id);
    if (c) add({ arabic: c.arabic, source: `AI pick · ${c.source}`, label: c.label, score: 1, kind: c.kind, ai: true });
  }
  for (const ref of Array.isArray(data.refs) ? data.refs.slice(0, 5) : []) {
    if (typeof ref !== "string" || !REF.test(ref)) continue;
    for (const h of byReference(index, ref.trim())) add({ ...h, source: `AI pick · ${h.source}`, ai: true });
  }
  return out;
}
