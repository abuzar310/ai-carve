export const config = { maxDuration: 60 };

type Req = { method?: string; url?: string; headers: { host?: string } };
type Res = {
  statusCode: number;
  setHeader(k: string, v: string): void;
  end(body?: string | Uint8Array): void;
};

export default async function handler(req: Req, res: Res) {
  if (req.method && req.method !== "GET") {
    res.statusCode = 405;
    res.end("GET only");
    return;
  }
  const q = new URL(req.url || "/", "http://" + (req.headers.host || "localhost")).searchParams;
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
