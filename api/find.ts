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

// ---- abuse guard (vibe-sec audit): refuse other websites, and cap calls per visitor per instance.
// Vercel keeps warm instances, so this stops casual loops; the real spending cap belongs on the
// provider key itself (set a quota in Google AI Studio). Self-contained: api/ files compile alone.
const HITS = new Map<string, number[]>();
function clientIp(h: Record<string, string | string[] | undefined>): string {
  const f = h["x-forwarded-for"];
  return (Array.isArray(f) ? f[0] : f)?.split(",")[0]?.trim() || String(h["x-real-ip"] ?? "unknown");
}
/** true when the call comes from another website (a browser sends Origin on cross-site requests) */
function foreignOrigin(h: Record<string, string | string[] | undefined>): boolean {
  const o = h["origin"];
  const origin = Array.isArray(o) ? o[0] : o;
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    const self = String(h["host"] ?? "").split(":")[0];
    return !(host === self || host === "localhost" || host === "127.0.0.1" || host === "ai-carve.vercel.app" || /^ai-carve(-[a-z0-9-]+)?\.vercel\.app$/.test(host));
  } catch {
    return true;
  }
}
function overLimit(ip: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (HITS.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  HITS.set(ip, recent);
  if (HITS.size > 5000) HITS.clear(); // keep memory bounded
  return recent.length > max;
}


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
  if (foreignOrigin(req.headers)) return send(res, 403, { error: "Not allowed from another website." });
  if (overLimit(clientIp(req.headers), 20, 60_000)) return send(res, 429, { error: "Too many searches. Wait a minute and try again." });
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
