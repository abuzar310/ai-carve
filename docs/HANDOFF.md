# AI Carve — handoff (updated 3 Oct 2026)

Owner: Mohammed Abuzar (GitHub `abuzar310`). Live: https://ai-carve.vercel.app
Repo: github.com/abuzar310/ai-carve (**public** since 3 Oct 2026; no LICENSE file = all rights reserved). Push to `main` → Vercel deploys.
Latest `main`: see `git log`. **UX rebuild SHIPPED: Phases 0-1 (f4dd446), 2 (c904064), 3 (9ab0d70), 5 (4d189c7), 6 (b06e84e), 7-text (ba59ccf: Projects tabs + Duplicate/Delete + /project/:id for text panels). REMAINING: Phase 4 (dedicated pattern builder; /create/pattern presets star-cross in the text workspace, which works), Phase 7-photo (IndexedDB image storage so photo reliefs become projects), Phase 8 (formal all-screens pass at 390/768/1024/1440; home + workspace already reviewed). Smoke sections 1-11 all green via `node scripts/qa/static-run.mjs` with ONLY=n.** Customers mostly order **name / text plaques**.

## What the site does now
- **Photo relief:** picture → depth (own relief model `public/models/ai-carve-relief-v1`, falls back to
  Depth Anything) → relief → STL / height BMP. Relief mode: background cut from the depth, no grain.
- **Text panel** (exact typesetting, never AI Arabic): numbered steps 1 Design · 2 Text · 3 Size · 4 Look,
  live layout preview, sticky Build bar on phones.
  - Design picker: Names & home · Quran · Dhikr · Boards · Patterns (29+ designs, `designs.ts`, every
    word checked against the Quran library / vetted phrases by `designs.check.ts`).
  - Layouts: plate, 99 Names, word grid, pattern panel. Shapes: rectangle, arch, oval.
  - Frames: classic, stepped double. Corners: flower spray (`ornament.ts`), stars.
  - Patterns (`pattern.ts`, Hankin method): star & cross, khatam, 6-point, 12-point; bands double /
    raised / groove; round centre with text sits inside the central star.
- **Exports:** STL, ArtCAM .rlf, 16-bit TIFF (0.25 mm), height BMP, proof PNG, cut outline DXF,
  **vectors DXF/SVG** (layers LETTERS, PATTERN, CUT_OUTLINE; `vector.ts`).
- Kaggle training via GitHub Actions (`.github/workflows/kaggle-*.yml`, secret `KAGGLE_API_TOKEN`).

## Added on 2–3 Oct 2026 (all live)
Trace to vectors (TraceCard) · background level / zero plane · home example tiles (public/examples) ·
woven star patterns · Recent designs (lib/recent.ts) · preview materials (lib/material.ts) ·
security guard on api/* + headers · design-list freeze fix (no cqi font sizes) · calmer start
(settings hidden until a picture/build) · og:image, robots.txt, sitemap · repo made public.

## Shipped 3 Oct 2026 - UX rebuild Phase 0+1 (f4dd446, live)
Router (`src/router.tsx`, no dependency) - app shell (`src/Shell.tsx`) with top nav + mobile bottom
nav (hidden inside a workspace) - pages (`src/pages.tsx`: Home, Create, Projects, Settings, Depth-map
soon, Not-found) - `vercel.json` SPA rewrite (deep routes survive refresh, `/api/*` excluded).
State is shared across routes by keeping the engine (App.tsx) mounted-but-hidden and passing the
route as props (no store rewrite; every localStorage key unchanged). Home ships no engine/model
chunks (App + transformers are lazy). `smoke.mjs` migrated to the new routes; `ONLY=1..6` runs a
subset of sections.

## Shipped 3 Oct 2026 - UX rebuild Phases 2, 3, 5, 6 (all live)
Phase 2: Image Relief step workspace (jumpable rail Image-Size-Relief-Export, Size card with
proportion-locked W/H + overall height, Advanced under Relief). Phase 3: 99 Names honest
verification computed from layoutPanel on every change + [View exact text] proof inline.
Phase 5: export verification (validate verdict, meshLag, mesh size MEASURED vs settings,
triangles) + groups CNC files / Vectors / More exports. Phase 6: /create/depth-map is real -
model skipped, brightness IS the height, Soon page deleted. smoke.mjs sections 7-10 cover them.

## Verify (the gate before every push)
**`pnpm qa`** = browser smoke test (`scripts/qa/smoke.mjs`, 22 checks: home at 390/768/1024/1440,
design list on a 6× slower CPU, every example tile builds, pattern-only design builds, exports offered).
Run after `pnpm build` + `npx vite preview --port 4173 --strictPort &` in the same command; in the
sandbox add `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers LOCAL_ORT=1`.
`pnpm check` (24 suites) · `npx tsc --noEmit` · `pnpm build` · Playwright on a 390 px phone.
Sandbox: Chromium in `/opt/pw-browsers`; HF/CDN/Vercel blocked (serve ORT wasm via page.route).
Always load the built page in a browser before pushing: a use-before-define in App.tsx once crashed the whole page while tsc and all unit tests passed.
Use `node scripts/qa/static-run.mjs` (in-process static server + smoke in ONE node process, honors ONLY=n) in sandboxes. JSX text does NOT process \\uXXXX escapes - write real characters or they render literally (caught by screenshot once).
Field report (a customer STL, 3 Oct): a plate with header + two fully voweled Bismillah lines
looks like 'overwritten type' because fitText sizes lines by bare-alif height, so tashkeel from
adjacent lines interleaves. The file itself was valid and matched its spec (two lines at the two
band sizes); the collision is real on the carved piece. Guard shipped: rasterPanel measures each
line's FULL ink (marks included) and returns tightLines + inkRatio; the export verification shows
'touching vowel marks' in red with the fix choices. A root redesign (mark-aware caps / line pitch)
would change approved designs' look - owner's call, see UX_REBUILD open items.
Bug-hunt loop status (3 Oct, end of session): pass 1 complete. FIXED P1 stale text exports +
P1 drift-blind verification line (exportBlock() at the shared boundary; smoke 15). Input
exclusivity PROVEN deterministic (synchronous busyRef claim; smoke 16: same-frame double
paste -> first wins, second gets the note). Dblclick STL: tested, not a bug. Suite now 16
browser sections + 24 unit files, all green on the shipping build. NEXT SESSION, in order:
(1) bug-hunt pass 2: chaos matrix (rapid clicks, nav-during-build, refresh mid-op), the
invalid/extreme-input grid, perf pass; (2) Phase 4 dedicated Pattern Builder; (3) IndexedDB
project persistence; (4) 13-design Quran typography sweep (method below) then the mark-aware
default decision; (5) Four Quls box-overlap layout fix; (6) formal accessibility pass.
Bug-hunt pass 2, chunk 1 (3 Oct, chaos matrix): FIXED P1 cross-workflow landing - a photo still
building when the person opened Text landed there as "ready", every check green; a text build
still running when they opened Image landed there with no picture. Builds are now numbered jobs
(jobRef/newJob/isCurrent/cancelJobs in App.tsx): switching workflow, clearing the picture or a newer
build moves the number on and a finished stale job drops its result; cancel also releases the
busyRef claim (a click+navigate in one frame left it held). Depth runs are serialized in depth.ts
and skip tiles once unwanted. Backstop: `foreign` (relief kind != workspace) is dropped and
refused by exportBlock(); saveStl is gated itself (the large-file "Download anyway" bypassed
requestStl). An example opened from another workflow is no longer dropped by the build it cancels.
Smoke 17 locks both directions (fails on the old code, passes now). Smoke 16 flake (3 in 5 on the
old code) root-caused: the first model load blocks the main thread ~17 s in the sandbox, so the
note's 6 s auto-hide fired before the query; 16 now reads the note when it renders.
CHECKED CLEAN: refresh mid-build (photo/text), Build x10 in one frame, example then back then
another example, Invert toggled mid-build (result hashed against a clean build).
PERF LEDGER (for the perf pass): first photo build freezes the page ~17 s (progress text stuck on
"Downloading relief model 100%"): inference runs on the main thread - try ORT wasm proxy (worker).
Minor: Image "Reset settings" sets quality High, ignoring the Settings default (newProject uses
readQuality()). Suite: 17 browser sections + 24 unit files.
Bug-hunt pass 2, chunk 2 (input grid): FIXED a 4000x24 px strip planned 171 depth runs on the main
thread (minutes frozen) - planTiles caps at MAX_TILES=12 (up to a 1:12 leg unchanged). FIXED a fully
transparent / one-colour picture got a shape invented by the depth model with green checks - flat
pictures skip the model, carve flat, warning in the result bar on every step (the 6 s note could
expire while the page was busy). FIXED photo sizes accepted 1e300 mm (non-finite STL) - PHOTO_MAX
3000 mm sides (proportional), 500 mm depth/base. CLEAN: non-image, empty, truncated JPEG, 1 px,
9000 px, SVG, GIF. Smoke 18 locks it. Section 10 timing drift (5->16 s) was the sandbox: old and new
builds interleaved time identically.
START NEXT CHAT with a FRESH repo-only token - the ones used so far are burned and must be
revoked (GitHub all-repos PAT + a Vercel vcp token were pasted in chat).
Production-hardening brief status (3 Oct): Phases 1-3 DONE (state verified; 99/99 semantics via
shared compareNames99/verifyNames99 with Allah as a structural line; every carving export guarded
at save time, proof deliberately open, no cached verified flag anywhere). Phase 8 audience line and
Phase 9 structured data (SoftwareApplication + Learn FAQPage) DONE. Still open from that brief:
Phase 4 dedicated Pattern Builder; Phase 5 IndexedDB project persistence; Phase 6 full Quran
typography sweep (method below); Phase 7 formal accessibility pass.
Typography sweep results (3 Oct, evidence for the default decision): under ?typo=mark the
reported two-line panel and Al-Fatiha go red -> green (Fatiha 24mm -> 19mm via measured line
pitch, not shrinking); Al-Ikhlas and stock Bismillah are pixel-stable (20mm -> 20mm). Al-Fatiha
is the SECOND shipped design that fails clearance today. Four Quls fails in both modes: its
line boxes overlap in layoutPanel (sections) - fix the boxes, not the type. Before flipping the
default: run this sweep over all 13 Quran designs (the node enumerator can't hydrate them;
build each in the browser, compare clearance class + 'Letters about N mm').
Typography follow-ups: mark-aware line fitting is implemented behind ?typo=mark (full ink incl.
tashkeel must fit each line's band; wrapped blocks scale as one). Proven on the reported two-line
panel (clearance red -> green); owner approval pending before it becomes the default (see
outputs montage from 3 Oct). Four Quls stays red in BOTH modes: its line boxes themselves
overlap - a layoutPanel sections issue, separate fix.
Sandbox quirk (cost half a session): chromium + `vite preview` together get killed by a resource
ceiling with NO output. Fix: serve `dist/` from a tiny in-process node http server with SPA fallback
in the SAME process as Playwright (one node process), or run `smoke.mjs` in chunks with `ONLY=n`.
Playwright quirk: the sticky Build bar blocks `locator.click()` on phones — scroll to centre and use
`page.mouse.click`. Background servers die between tool calls: start `vite preview` in the same command.

## Rules learned
- One chat at a time on this repo. `git fetch` and compare before pushing.
- Arabic only from fonts / the Quran library / vetted lists. Tests check every word.
- Write tests first; render and *look* at results (patterns and ornaments were tuned by eye).
- Never paste tokens in chat. Revoke the ones already pasted (GitHub, Vercel, Kaggle).

## Competitor research (Oct 2026)
**WeSculpt** (wesculpt.ai): a "toolbox" home of tool cards with before/after images — Image → depth map,
Depth map → 3D relief (STL/VSM), image repair (upscale), image correction (straighten), extract lines
(to vectors/SVG), AI image design, image → 3D model. Industry switcher (wood, stone, jade, jewelry,
hot stamping) with per-industry case pages and testimonials. Job history, credits/pricing, API, ZBrush
plugin, 9 UI languages.
**Meshy / 3D AI Studio relief tools:** depth and base thickness in mm, plate size, solid (print) vs
planar (CNC) mesh, invert for moulds, smoothing, depth cutoff, mesh stats, free with no account.
**ReliefMaker:** two engines (fast local free / better paid), 3D preview, height scale, STL.

**Where AI Carve already wins:** exact Arabic/Quran text, ready Islamic designs, star patterns,
ornaments, ArtCAM .rlf + 16-bit TIFF + layered vectors, runs in the browser (private), free.

## Roadmap (from the research, in order)
1. ~~Home toolbox + example gallery~~ DONE: four start tiles on the empty stage (`STARTS` in App.tsx,
   images + example inputs in `public/examples/`), each loads a real example and builds it.
   Was: **Home toolbox + example gallery** — tool cards (Photo → relief, Text plaque, Pattern panel,
   Sketch → vectors, Depth map → relief) with our own before/after renders and "Try this example"
   buttons that load a sample instantly. Original design; do not copy competitors' pages or images.
2. ~~Sketch / logo → vectors~~ — DONE: "Trace to vectors" card under Image (`TraceCard.tsx`, `traceBitmap`).
3. **Depth map → relief** — upload an existing height map (skip the AI), plus show/download the AI
   depth map next to the photo.
4. **Photo prep** — 4-corner perspective straighten and crop (photos of carvings taken at an angle);
   auto "cut background" off when the picture has a frame (the user's 99 Names photo).
5. ~~Recent projects~~ DONE: Recent tab in the design picker (`lib/recent.ts`, localStorage `carve.recent.v1`, last 12 builds).
6. ~~Material preview~~ DONE: Material picker in the 3D view chips (`lib/material.ts`: teak, walnut, rosewood, marble, sandstone, brass).
7. **UI languages** — Urdu, Arabic, Hindi (market: India / Middle East).
From Carveco research: ~~background level (zero plane)~~ DONE (Relief card slider, `zeroPlane` in relief.ts); ArtCAM PAF
licences expire through 2026 — market AI Carve's .rlf export to ArtCAM shops. Carveco's Weave tool → DONE as the "Woven" band style (`weaveFull` + `drawWoven` in pattern.ts).
Also open: more corner ornaments, names dictionary (needs an Arabic reader).
