/**
 * Browser smoke test for AI Carve. Run against a built site:
 *   pnpm build && (npx vite preview --port 4173 --strictPort &) && node scripts/qa/smoke.mjs
 * Env: BASE (default http://localhost:4173), PLAYWRIGHT_BROWSERS_PATH, LOCAL_ORT=1 to serve the
 * ONNX runtime from node_modules when the CDN is blocked (sandbox), OUT (screenshot folder, qa-out),
 * ONLY=1,2,.. to run a subset of sections. Exits 1 on any failure. Grow it with every UX_REBUILD phase.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4173";
const OUT = process.env.OUT ?? "qa-out";
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "\u2713" : "\u2717"} ${msg}`); if (!ok) fails.push(msg); };
const want = (n) => !process.env.ONLY || process.env.ONLY.split(",").includes(String(n));

const ortDir = (() => {
  const base = "node_modules/.pnpm";
  if (!fs.existsSync(base)) return null;
  const hit = fs.readdirSync(base).find((d) => d.startsWith("@huggingface+transformers@"));
  return hit ? path.join(base, hit, "node_modules/@huggingface/transformers/dist/") : null;
})();

async function page(browser, vp = { width: 1280, height: 900 }, mobile = false) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, acceptDownloads: true }); // fresh storage every time
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  if (process.env.LOCAL_ORT && ortDir) {
    await p.route(/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@[^/]+\/dist\/(.+)$/, (r) => {
      const f = r.request().url().split("/dist/")[1];
      return r.fulfill({ path: ortDir + f, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": f.endsWith(".wasm") ? "application/wasm" : "text/javascript" } });
    });
  }
  return p;
}
const ready = async (p, s = 45) => { for (let i = 0; i < s; i++) { await p.waitForTimeout(1000); if (await p.getByText(/relief is ready/i).count()) return true; } return false; };
const responsive = (p, ms = 4000) => Promise.race([p.evaluate(() => 1), new Promise((r) => setTimeout(() => r(0), ms))]);

const browser = await chromium.launch();

// 1. Home at 4 widths: loads, no errors, no sideways scroll
if (want(1)) for (const [w, h, mobile] of [[390, 844, true], [768, 1024, true], [1024, 768, false], [1440, 900, false]]) {
  const p = await page(browser, { width: w, height: h }, mobile);
  await p.goto(BASE); await p.waitForTimeout(1200);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await p.screenshot({ path: `${OUT}/home-${w}.png` });
  check(!p.errors.length, `home ${w}px loads without errors ${p.errors.join(" | ")}`);
  check(!overflow, `home ${w}px has no sideways scroll`);
  await p.context().close();
}

// 2. every route survives a hard refresh (Vercel SPA rewrite) and renders its own page
if (want(2)) {
  const ROUTES = [
    ["/", /CNC relief design studio/],
    ["/create", /What would you like to make/],
    ["/projects", /^Projects$/],
    ["/settings", /^Settings$/],
    ["/create/depth-map", /Depth map upload/],
    ["/no-such-page-xyz", /Page not found/],
  ];
  for (const [route, heading] of ROUTES) {
    const p = await page(browser);
    await p.goto(BASE + route); await p.waitForTimeout(700);
    const ok = await p.getByRole("heading", { name: heading }).count();
    await p.screenshot({ path: `${OUT}/route-${route.replace(/\W+/g, "_") || "root"}.png` });
    check(ok > 0 && !p.errors.length, `route ${route} renders on hard refresh ${p.errors.join(" | ")}`);
    await p.context().close();
  }
  // workspace routes: the engine host mounts on a cold refresh, no crash
  for (const route of ["/create/image", "/create/text", "/create/text/99-names", "/create/pattern", "/create/trace"]) {
    const p = await page(browser);
    await p.goto(BASE + route);
    const host = await p.waitForSelector(".ws-host", { timeout: 15000 }).then(() => true).catch(() => false);
    await p.waitForTimeout(1200);
    check(host && !p.errors.length, `workspace route ${route} mounts on hard refresh ${p.errors.join(" | ")}`);
    await p.context().close();
  }
}

// 3. Home is light: engine, transformers and ORT wasm are NOT fetched on the front door
if (want(3)) {
  const p = await page(browser);
  const heavy = [];
  p.on("request", (r) => { if (/\/assets\/App-|transformers|ort-wasm/.test(r.url())) heavy.push(r.url()); });
  await p.goto(BASE); await p.waitForTimeout(1800);
  check(heavy.length === 0, `home loads no engine/model chunks (${heavy.length} heavy requests)`);
  await p.context().close();
}

// 4. the design list opens fast in the Text workspace, also on a slow phone (fresh storage: this is how the freeze hid)
if (want(4)) {
  const p = await page(browser, { width: 390, height: 844 }, true);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const t0 = Date.now();
  await p.goto(BASE + "/create/text");
  await p.waitForFunction(() => document.querySelectorAll(".design-card").length > 0, null, { timeout: 15000 }).catch(() => {});
  const ms = Date.now() - t0;
  const cards = await p.locator(".design-card").count();
  check(cards > 0 && ms < 8000 && (await responsive(p)), `design list opens in Text on a 6x slower CPU (${cards} cards, ${ms} ms)`);
  await p.context().close();
}

// 5. every Start-a-project example builds a 3D result (Home -> "Try ..." -> workspace auto-builds)
if (want(5)) for (const label of ["Try a carving photo", "Try a name plaque", "Try a star pattern", "Try a drawing"]) {
  const p = await page(browser);
  await p.goto(BASE); await p.waitForTimeout(600);
  const t = p.getByRole("link", { name: label });
  if (!(await t.count())) { check(false, `start card "${label}" present`); await p.context().close(); continue; }
  await t.first().click();
  check(await ready(p), `"${label}" builds a 3D result`);
  check(!p.errors.length, `"${label}" without errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

// 6. a pattern-only panel builds (once refused with "Type some text first") and offers every export
if (want(6)) {
  const p = await page(browser);
  await p.goto(BASE + "/create/pattern"); await p.waitForTimeout(1800);
  const build = p.getByRole("button", { name: /Build text panel|Rebuild text panel/ });
  if (await build.count()) await build.last().click();
  check(await ready(p), "pattern-only panel builds");
  for (const name of [/Download STL/i, /\.rlf/i, /TIFF/i, /Vectors for V-carve/i]) check((await p.getByRole("button", { name }).count()) > 0, `export offered: ${name}`);
  await p.context().close();
}

// 7. Image Relief step workspace (UX_REBUILD Phase 2): picture -> Size, steps jumpable, cards per step
if (want(7)) {
  const p = await page(browser);
  await p.goto(BASE + "/create/image"); await p.waitForTimeout(900);
  check((await p.locator(".ws-steps button").count()) === 4, "workspace has the 4-step rail");
  await p.setInputFiles('input[name="source_image"]', "public/examples/carving.jpg");
  await p.waitForTimeout(1200);
  check((await p.locator('.ws-steps button[aria-current=\"step\"]').innerText().catch(() => "")).includes("Size"), "a new picture moves the rail to Size");
  check(await p.locator('h3:has-text(\"Size\")').isVisible(), "Size card shows on the Size step");
  await p.click('.ws-steps button:has-text(\"Relief\")');
  check(await p.locator("details.adv:not(.trace)").isVisible(), "Advanced settings show under Relief");
  await p.click('.ws-steps button:has-text(\"Image\")');
  check(await p.locator("aside.source").isVisible(), "Source card shows on the Image step");
  check(!p.errors.length, `stepped workspace without errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

// 8. 99 Names honest verification (UX_REBUILD Phase 3): all computed checks pass, proof renders
if (want(8)) {
  const p = await page(browser);
  await p.goto(BASE + "/create/text/99-names"); await p.waitForTimeout(1500);
  check(await p.locator(".verify").isVisible(), "99 Names verification card shows");
  check((await p.locator(".verify .checks li.pass").count()) === 4 && (await p.locator(".verify .checks li.fail").count()) === 0, "all four 99-Names checks pass");
  await p.getByRole("button", { name: /View exact text/ }).click(); await p.waitForTimeout(2500);
  check(await p.locator("img.proof").isVisible(), "exact-text proof image renders");
  check(!p.errors.length, `99 Names route without errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

// 9. Export by purpose + verification (UX_REBUILD Phase 5): computed checks, grouped exports
if (want(9)) {
  const p = await page(browser);
  await p.goto(BASE + "/create/text?example=name");
  let built = false;
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(1000); if (await p.getByText(/relief is ready/i).count()) { built = true; break; } }
  check(built, "name example builds for export checks");
  let four = false;
  for (let i = 0; i < 8; i++) { if ((await p.locator(".exp-checks li.pass").count()) === 4 && (await p.locator(".exp-checks li.fail").count()) === 0) { four = true; break; } await p.waitForTimeout(600); }
  check(four, "all four export verification checks pass");
  const heads = (await p.locator(".exp-groups h3").allInnerTexts()).join(",").toLowerCase();
  check(heads.includes("cnc files") && heads.includes("vectors"), "exports grouped: CNC files and Vectors");
  check(await p.locator("details.exp-more summary").isVisible(), "More exports collapsed");
  check(!p.errors.length, `export step without errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall smoke checks passed");
process.exit(fails.length ? 1 : 0);
