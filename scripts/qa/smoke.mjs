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
    ["/learn", /How AI Carve works/],
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
  for (const route of ["/create/image", "/create/text", "/create/text/99-names", "/create/pattern", "/create/trace", "/create/depth-map"]) {
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
  for (let i = 0; i < 8; i++) { if ((await p.locator(".exp-checks li.pass").count()) >= 4 && (await p.locator(".exp-checks li.fail").count()) === 0) { four = true; break; } await p.waitForTimeout(600); }
  check(four, "all four export verification checks pass");
  const heads = (await p.locator(".exp-groups h3").allInnerTexts()).join(",").toLowerCase();
  check(heads.includes("cnc files") && heads.includes("vectors"), "exports grouped: CNC files and Vectors");
  check(await p.locator("details.exp-more summary").isVisible(), "More exports collapsed");
  check(!p.errors.length, `export step without errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

// 10. Depth map upload (UX_REBUILD Phase 6): a height map becomes the relief with no model
if (want(10)) {
  const p = await page(browser);
  await p.goto(BASE + "/create/depth-map"); await p.waitForTimeout(1000);
  check(await p.getByRole("heading", { name: "Upload a height map" }).isVisible(), "depth-map flow shows its own heading");
  await p.setInputFiles('input[name="source_image"]', "public/examples/carving.jpg");
  let built = false;
  for (let i = 0; i < 20; i++) { await p.waitForTimeout(1000); if (await p.getByText(/relief is ready/i).count()) { built = true; break; } }
  check(built, "height map builds a relief without the model");
  check((await p.getByText(/Height map used directly/).count()) > 0, "direct-use note shows");
  check(!p.errors.length, `depth-map flow without errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

// 11. Projects: tabs, duplicate, delete, /project/:id (UX_REBUILD Phase 7, text projects)
if (want(11)) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("carve.recent.v1", JSON.stringify([
      { spec: { lines: ["Smoke plate"], template: "plate", header: "", widthMm: 300, heightMm: 120 }, at: 2000 },
      { spec: { lines: [], template: "pattern", header: "", widthMm: 400, heightMm: 400 }, at: 1000 },
    ]));
  });
  const p = await ctx.newPage();
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + "/projects"); await p.waitForTimeout(700);
  check((await p.locator(".proj-tabs button").count()) === 4 && (await p.locator(".recent-item").count()) === 2, "projects: tabs and rows");
  await p.click('.proj-tabs button:has-text("Pattern")'); await p.waitForTimeout(300);
  check((await p.locator(".recent-item").count()) === 1, "projects: type tab filters");
  await p.click('.proj-tabs button:has-text("All")');
  await p.locator(".recent-acts .linkish", { hasText: "Duplicate" }).first().click(); await p.waitForTimeout(400);
  check((await p.locator(".recent-item").count()) === 3, "projects: duplicate adds a copy");
  await p.locator(".recent-acts .danger").first().click(); await p.waitForTimeout(400);
  check((await p.locator(".recent-item").count()) === 2, "projects: delete removes after confirm");
  await p.goto(BASE + "/project/2000"); await p.waitForTimeout(1200);
  check(p.url().includes("/create/text") && !p.errors.length, `project link opens the workspace ${p.errors.join(" | ")}`);
  await ctx.close();
}

// 12. Line-clearance verification (full ink incl. vowel marks): fires on a cramped two-line
// Bismillah panel, stays green on a clean single-line build
if (want(12)) {
  const SPEC_TIGHT = JSON.stringify({ template: "plate", widthMm: 300, heightMm: 120, font: "quran", style: "raised", letterMm: 1.8, frame: true, frameStyle: "stepped", corners: "flowers", footer: "", sections: false, columns: 4, pattern: "star8", repeats: 3, band: "double", medallion: "none", shape: "rect",
    header: "\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u064e\u0651\u0647\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0670\u0646\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650",
    lines: ["\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u064e\u0651\u0647\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0670\u0646\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650", "\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u064e\u0651\u0647\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0670\u0646\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650"] });
  const ctx = await browser.newContext();
  await ctx.addInitScript((sp) => { localStorage.setItem("carve.textSpec.v1", sp); localStorage.setItem("carve.mode", "text"); }, SPEC_TIGHT);
  const p = await ctx.newPage();
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(BASE + "/create/text"); await p.waitForTimeout(1200);
  await p.getByRole("button", { name: /Build text panel/ }).last().click();
  for (let i = 0; i < 28; i++) { await p.waitForTimeout(1000); if (await p.getByText(/relief is ready/i).count()) break; }
  const li = p.locator(".exp-checks li", { hasText: /vowel marks/ }).first();
  check((await li.getAttribute("class")) === "fail", "cramped two-line panel: touching vowel marks flagged red");
  check(!p.errors.length, `line-clearance check without errors ${p.errors.join(" | ")}`);
  await ctx.close();
  const p2 = await page(browser);
  await p2.goto(BASE + "/create/text?example=name");
  for (let i = 0; i < 28; i++) { await p2.waitForTimeout(1000); if (await p2.getByText(/relief is ready/i).count()) break; }
  const li2 = p2.locator(".exp-checks li", { hasText: /Clear space between lines/ }).first();
  check((await li2.getAttribute("class")) === "pass", "clean build: line clearance green");
  await p2.context().close();
}

// 13. Image input options: upload + paste buttons, Ctrl+V paste loads a picture, drop still works
if (want(13)) {
  const p = await page(browser);
  await p.goto(BASE + "/create/image"); await p.waitForTimeout(900);
  check((await p.getByRole("button", { name: "Upload image" }).isVisible()) && (await p.getByRole("button", { name: "Paste image" }).isVisible()), "upload and paste buttons offered");
  check((await p.getByText(/paste \(Ctrl\+V\)/).count()) > 0, "hint names drag-drop and paste");
  await p.evaluate(async () => {
    const r = await fetch("/examples/carving.jpg");
    const f = new File([await r.blob()], "paste.jpg", { type: "image/jpeg" });
    const dt = new DataTransfer(); dt.items.add(f);
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt }));
  });
  await p.waitForTimeout(1500);
  check((await p.locator('.ws-steps button[aria-current="step"]').innerText().catch(() => "")).includes("Size"), "Ctrl+V paste loads the picture");
  check(!p.errors.length, `image input options without errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

// 14. Learn page + Home positioning strips + project Rename (brief sections 3-6, 11)
if (want(14)) {
  const p = await page(browser);
  await p.goto(BASE + "/learn"); await p.waitForTimeout(700);
  check(await p.getByRole("heading", { name: /Exact Arabic/ }).isVisible() && (await p.locator(".faq dt").count()) >= 6, "Learn: exact-Arabic section and FAQ");
  check(await p.locator('nav.nav a[aria-current="page"]', { hasText: "Learn" }).isVisible(), "Learn active in the top nav");
  await p.goto(BASE + "/"); await p.waitForTimeout(800);
  check((await p.locator(".arabic-strip").count()) === 1, "Home carries the exact-Arabic strip");
  check(!p.errors.length, `learn/home without errors ${p.errors.join(" | ")}`);
  await p.context().close();
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { localStorage.setItem("carve.recent.v1", JSON.stringify([{ spec: { lines: ["Salam"], template: "plate", header: "", widthMm: 300, heightMm: 120 }, at: 4242 }])); });
  const p2 = await ctx.newPage();
  p2.on("dialog", (d) => d.accept("Majlis door"));
  await p2.goto(BASE + "/projects"); await p2.waitForTimeout(700);
  await p2.locator(".recent-acts .linkish", { hasText: "Rename" }).first().click(); await p2.waitForTimeout(400);
  check((await p2.locator(".recent-title").first().innerText()).includes("Majlis door"), "project Rename updates the shown title");
  await ctx.close();
}

// 15. REGRESSION (bug hunt P1): a text export can never ship a stale build.
// Old behavior: change a size after building and .rlf/TIFF/vectors silently exported the
// previous relief while the verification line stayed green. Now the line goes red and the
// save is refused with an actionable message.
if (want(15)) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const p = await ctx.newPage();
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(BASE + "/create/text?example=name");
  let built = false;
  for (let i = 0; i < 30; i++) { await p.waitForTimeout(1000); if (await p.getByText(/relief is ready/i).count()) { built = true; break; } }
  check(built, "stale-export: name example builds");
  const w = p.locator('input[name="panel-width"]').first();
  await w.fill("777"); await w.dispatchEvent("change"); await p.waitForTimeout(800);
  check((await p.locator(".exp-checks li.fail", { hasText: /press Rebuild/ }).count()) === 1, "stale-export: drift turns the verification line red");
  let dl = 0; p.on("download", () => dl++);
  await p.getByRole("button", { name: /ArtCAM relief/ }).click();
  await p.waitForTimeout(4000);
  check(dl === 0, "stale-export: .rlf refused while stale");
  check((await p.getByText(/Settings changed since this relief was built/).count()) > 0, "stale-export: actionable message shown");
  check(!p.errors.length, `stale-export guard without errors ${p.errors.join(" | ")}`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall smoke checks passed");
process.exit(fails.length ? 1 : 0);
