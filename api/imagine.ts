import type { IncomingMessage, ServerResponse } from "node:http";

export const config = { maxDuration: 60 };

function query(req: IncomingMessage): URLSearchParams {
  const host = req.headers.host || "localhost";
  return new URL(req.url || "/", "http://" + host).searchParams;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method && req.method !== "GET") {
    res.statusCode = 405;
    res.end("GET only");
    return;
  }
  const q = query(req);
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
  const buf = Buffer.from(await up.arrayBuffer());
  res.statusCode = up.status;
  res.setHeader("content-type", up.headers.get("content-type") || "image/jpeg");
  res.setHeader("cache-control", "no-store");
  res.end(buf);
}
