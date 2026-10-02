/**
 * Browser smoke test for AI Carve. Run against a built site:
 *   pnpm build && (npx vite preview --port 4173 --strictPort &) && node scripts/qa/smoke.mjs
 * Env: BASE (default http://localhost:4173), PLAYWRIGHT_BROWSERS_PATH, LOCAL_ORT=1 to serve the
 * ONNX runtime from node_modules when the CDN is blocked (sandbox), OUT (screenshot folder, qa-out).
 * Exits 1 on any failure. Grow this file with every phase of docs/UX_REBUILD.md.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4173";
const OUT = process.env.OUT ?? "qa-out";
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) fails.push(msg); };

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

// 1. first screen at 4 widths: loads, no errors, no sideways scroll
for (const [w, h, mobile] of [[390, 844, true], [768, 1024, true], [1024, 768, false], [1440, 900, false]]) {
  const p = await page(browser, { width: w, height: h }, mobile);
  await p.goto(BASE); await p.waitForTimeout(1200);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await p.screenshot({ path: `${OUT}/home-${w}.png` });
  check(!p.errors.length, `home ${w}px loads without errors ${p.errors.join(" | ")}`);
  check(!overflow, `home ${w}px has no sideways scroll`);
  await p.context().close();
}

// 2. the design list opens fast, also on a slow phone (fresh storage: this is how the freeze hid)
{
  const p = await page(browser, { width: 390, height: 844 }, true);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await p.goto(BASE); await p.waitForTimeout(1500);
  const t0 = Date.now();
  await p.getByRole("button", { name: "Make a text panel" }).evaluate((e) => e.click());
  await p.waitForFunction(() => document.querySelectorAll(".design-card").length > 0, null, { timeout: 15000 }).catch(() => {});
  const ms = Date.now() - t0;
  check(ms < 6000 && (await responsive(p)), `design list opens on a 6× slower CPU (${ms} ms)`);
  await p.context().close();
}

// 3. every example tile builds a result
for (const tile of ["Photo to relief", "Name plaque", "Star pattern", "Trace a drawing"]) {
  const p = await page(browser);
  await p.goto(BASE); await p.waitForTimeout(800);
  const t = p.getByRole("button", { name: new RegExp(tile) });
  if (!(await t.count())) { check(false, `tile "${tile}" present`); await p.context().close(); continue; }
  await t.click();
  check(await ready(p), `tile "${tile}" builds a 3D result`);
  check(!p.errors.length, `tile "${tile}" without errors ${p.errors.join(" | ")}`);
  await p.context().close();
}

// 4. a pattern-only design builds (it was once refused with "Type some text first")
{
  const p = await page(browser);
  await p.goto(BASE);
  await p.getByRole("button", { name: "Make a text panel" }).click(); await p.waitForTimeout(1000);
  await p.getByRole("button", { name: "Patterns", exact: true }).click();
  await p.getByRole("button", { name: /Star and cross/ }).first().click(); await p.waitForTimeout(800);
  await p.getByRole("button", { name: /Build text panel|Rebuild text panel/ }).last().click();
  check(await ready(p), "pattern-only design (Star and cross) builds");
  // exports offered once built
  for (const name of [/Download STL/i, /\.rlf/i, /TIFF/i, /Vectors for V-carve/i]) check((await p.getByRole("button", { name }).count()) > 0, `export offered: ${name}`);
  await p.context().close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall smoke checks passed");
process.exit(fails.length ? 1 : 0);
