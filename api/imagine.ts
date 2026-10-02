export const config = { maxDuration: 60 };

type Req = { method?: string; url?: string; headers: Record<string, string | string[] | undefined> };
type Res = {
  statusCode: number;
  setHeader(k: string, v: string): void;
  end(body?: string | Uint8Array): void;
};


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

export default async function handler(req: Req, res: Res) {
  if (req.method && req.method !== "GET") {
    res.statusCode = 405;
    res.end("GET only");
    return;
  }
  if (foreignOrigin(req.headers)) {
    res.statusCode = 403;
    res.end("not allowed from another website");
    return;
  }
  if (overLimit(clientIp(req.headers), 12, 60_000)) {
    res.statusCode = 429;
    res.end("too many pictures, wait a minute");
    return;
  }
  const q = new URL(req.url || "/", "http://" + String(req.headers.host || "localhost")).searchParams;
  const prompt = (q.get("prompt") || "").trim().slice(0, 800);
  if (!prompt) {
    res.statusCode = 400;
    res.end("missing prompt");
    return;
  }
  const seed = q.get("seed") || String(Date.now() % 99999);
  const up = await fetch(
    "https://image.pollinations.ai/prompt/" +
      encodeURIComponent(prompt) +
      "?width=768&height=768&nologo=true&seed=" +
      encodeURIComponent(seed),
  );
  res.statusCode = up.status;
  res.setHeader("content-type", up.headers.get("content-type") || "image/jpeg");
  res.setHeader("cache-control", "no-store");
  res.end(new Uint8Array(await up.arrayBuffer()));
}
