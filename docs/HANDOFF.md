# AI Carve — handoff (updated 2 Oct 2026)

Owner: Mohammed Abuzar (GitHub `abuzar310`). Live: https://ai-carve.vercel.app
Repo: github.com/abuzar310/ai-carve (private). Push to `main` → Vercel deploys.
Latest `main`: `3c627ff`. Customers mostly order **name / text plaques**.

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

## Verify (the gate before every push)
`pnpm check` (24 suites) · `npx tsc --noEmit` · `pnpm build` · Playwright on a 390 px phone.
Sandbox: Chromium in `/opt/pw-browsers`; HF/CDN/Vercel blocked (serve ORT wasm via page.route).
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
1. **Home toolbox + example gallery** — tool cards (Photo → relief, Text plaque, Pattern panel,
   Sketch → vectors, Depth map → relief) with our own before/after renders and "Try this example"
   buttons that load a sample instantly. Original design; do not copy competitors' pages or images.
2. ~~Sketch / logo → vectors~~ — DONE: "Trace to vectors" card under Image (`TraceCard.tsx`, `traceBitmap`).
3. **Depth map → relief** — upload an existing height map (skip the AI), plus show/download the AI
   depth map next to the photo.
4. **Photo prep** — 4-corner perspective straighten and crop (photos of carvings taken at an angle);
   auto "cut background" off when the picture has a frame (the user's 99 Names photo).
5. **Recent projects** — local history (IndexedDB) to reopen past builds.
6. **Material preview** — wood / marble / stone look in the 3D view, for showing clients.
7. **UI languages** — Urdu, Arabic, Hindi (market: India / Middle East).
From Carveco research: add a **background level (zero plane)** control to photo relief; ArtCAM PAF
licences expire through 2026 — market AI Carve's .rlf export to ArtCAM shops. Carveco's Weave tool =
our interlaced bands idea.
Also open: interlaced pattern bands, more corner ornaments, names dictionary (needs an Arabic reader).
