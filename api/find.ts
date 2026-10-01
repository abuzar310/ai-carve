/**
 * POST /api/find  { q, candidates: [{ id, label, source }] }  →  { text }  (the model's JSON reply)
 * GET  /api/find  →  { enabled }
 *
 * The model only sees English and may only answer with candidate ids / Quran
 * references; the browser validates the reply against the library (src/lib/aiPick.ts)
 * and copies the Arabic from there. The key lives in Vercel env: GEMINI_API_KEY
 * (optional GEMINI_MODEL). Self-contained on purpose: api/ files are compiled one by one.
 */
export const config = { maxDuration: 20 };

type Req = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader(k: string, v: string): void; end(body?: string): void };
type Cand = { id: number; label: string; source: string };

/** Must stay identical to buildPrompt in src/lib/aiPick.ts (checked by aiPick.check.ts). */
export function buildPrompt(query: string, candidates: readonly Cand[]): string {
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

function send(res: Res, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req: Req, res: Res) {
  const key = process.env.GEMINI_API_KEY;
  if (req.method === "GET") return send(res, 200, { enabled: !!key });
  if (req.method !== "POST") return send(res, 405, { error: "GET or POST only" });
  if (!key) return send(res, 503, { error: "Smart search is not set up on this site." });
  let body = req.body as { q?: unknown; candidates?: unknown } | string | undefined;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body) as { q?: unknown; candidates?: unknown };
    } catch {
      return send(res, 400, { error: "bad JSON" });
    }
  }
  const q = typeof body?.q === "string" ? body.q : "";
  const raw = Array.isArray(body?.candidates) ? body.candidates : [];
  const candidates: Cand[] = raw
    .slice(0, 40)
    .filter((c): c is Cand => !!c && typeof c === "object" && Number.isInteger((c as Cand).id))
    .map((c) => ({ id: c.id, label: String(c.label ?? "").slice(0, 120), source: String(c.source ?? "").slice(0, 80) }));
  if (!q.trim() || q.length > 300) return send(res, 400, { error: "Type 1–300 characters." });
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const up = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: buildPrompt(q, candidates) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 256, responseMimeType: "application/json" },
      }),
      signal: ctl.signal,
    });
    const data = (await up.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
    if (!up.ok) return send(res, 502, { error: data.error?.message || `AI service error ${up.status}` });
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return send(res, 200, { text });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error && e.name === "AbortError" ? "The AI took too long. Try again." : "AI service unreachable." });
  } finally {
    clearTimeout(timer);
  }
}
