/**
 * Runs smoke.mjs against the built dist/ from an in-process static server (SPA fallback),
 * all in ONE node process. Use this in sandboxes where chromium + `vite preview` together
 * get killed by a resource ceiling. Honors ONLY=n to run a subset of sections, and
 * SCRIPT=other.mjs to run a different probe script against the same server.
 *   pnpm build && PLAYWRIGHT_BROWSERS_PATH=... node scripts/qa/static-run.mjs
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const DIST = path.resolve("dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json", ".wasm": "application/wasm", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".ttf": "font/ttf", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = path.join(DIST, p);
  if (!path.extname(p) || !existsSync(f)) f = path.join(DIST, "index.html");
  try {
    const b = readFileSync(f);
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream" });
    res.end(b);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => srv.listen(4195, r));
process.env.BASE = "http://localhost:4195";
try {
  // SCRIPT=path/to/probe.mjs runs another Playwright script against the same server (default: smoke.mjs)
  await import(process.env.SCRIPT ? pathToFileURL(path.resolve(process.env.SCRIPT)).href : "./smoke.mjs");
} finally {
  srv.close();
}
