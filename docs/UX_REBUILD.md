# AI Carve — UX / information-architecture rebuild (the plan of record)

Owner's goal: AI Carve must stop feeling like "one giant page with every feature" and feel like
"a simple CNC carving application where I choose what I want to make, follow a clear workflow,
inspect the 3D result, and export the correct CNC files."

Mental model: **Home → Create → choose workflow → step workspace → 3D preview → verify → export.**

## Non-negotiables
1. **Do not rebuild the engine.** Reuse `src/lib/*` (relief, mesh, stl, validate, rlf, tif, bmp,
   dxf, vector, textPanel, textRaster, ornament, pattern, shape, designs, quranSearch, recent,
   material, depth, depthModel). This is a UI/IA rebuild only. Every existing feature survives.
2. **Ship in phases. The live site must work after every push.** No multi-day broken states.
3. **Arabic only from Unicode sources + real fonts** (Quran library, vetted phrases, NAMES_99).
   Never an AI image as the Arabic source.
4. **Verification must be honest.** Show a tick only if code actually checked it. No decorative
   ticks ("RTL verified", "Unicode verified" are NOT real checks — don't show them).
   Real checks available: names.check logic (99/99 present, order, no duplicates, matches library),
   designs' library match, `validate.ts` mesh checks, export mesh == preview mesh, dimensions, units.
5. **Done = seen in a real browser** at 390 / 768 / 1024 / 1440 px, not "it compiles".
6. Restrained CAD/CAM look in the existing palette (paper, dark stage, brass). No AI-startup
   gradients, glass, or decorative animation. Read `/mnt/skills/public/frontend-design/SKILL.md`
   before UI work (and the owner's `ui-ux-pro-max` / `web-design-guidelines` skills if installed).

## Corrections to the original brief (agreed with the owner)
- **Image Relief steps are a side menu, not gates.** Upload → 3D preview appears at once (as today).
  Size / Relief / Export are steps you can jump between; no forced "Continue" before seeing a result.
- **Bottom navigation hides inside an active project** (mobile). There: top bar (back + name),
  viewer, current controls, one sticky primary action. Nothing may cover buttons or the viewer.
- **Routing needs a Vercel SPA rewrite** (`vercel.json`): everything except `/api/*` and real files
  → `/index.html`, or refreshing `/create/text` gives 404. Test a hard refresh on every route.
- **Settings page contents (defined):** units display (always mm), default quality, default preview
  material, default frame/corners for text, clear Recent/projects, (later) interface language.
- **Features in the brief that do not exist yet** (build them in their phase, don't fake them):
  Depth-map upload workflow; Projects with Duplicate/Delete/"available exports"; persistent project
  IDs for `/project/:id`; photo projects (need the image stored → IndexedDB).
- **Browser tests become permanent**: `scripts/qa/smoke.mjs` (Playwright) grows with every phase.

## Feature map (existing → new home)
| Existing feature | Where it is now | New location |
|---|---|---|
| Upload / drag-drop photo, auto depth → relief | App.tsx `onFile`, depth.ts, relief.ts | Create → Image Relief → step Image |
| Piece (panel / leg / border), size follows picture | App.tsx Piece card, piece.ts | Image Relief → Size |
| Relief depth Subtle/Balanced/Deep, Background level (zeroPlane) | App.tsx Relief card | Image Relief → Relief |
| Invert, Cut plain background | App.tsx Image card | Image Relief → Relief (Invert) / Advanced (cut) |
| Contrast, smooth, normalize, clean, detail, quality, base | App.tsx Advanced settings | Advanced: Height processing / Mesh |
| "Or describe a design" (api/imagine) | App.tsx gen card | Create → Image Relief → step Image (secondary) |
| Trace to vectors | TraceCard.tsx | Create → Trace Logo (own workflow) |
| Text panel: steps Design/Text/Size/Look, live preview | TextPanelCard.tsx, LivePreview.tsx | Create → Text / Arabic workspace |
| Design picker (Names & home, Quran, Dhikr, Boards, Patterns, Recent) | DesignPicker.tsx, designs.ts | Text/Arabic first screen (cards); Patterns → Pattern workflow |
| 99 Names template + verification | textPanel.ts NAMES_99, names.ts | Create → Text / Arabic → 99 Names (dedicated flow) |
| Find Arabic / Smart search | TextPanelCard FindArabic, quranSearch.ts, aiPick.ts | Text workflow → Text step |
| Frames, corners (flower spray), shapes (rect/arch/oval) | textPanel.ts, ornament.ts, shape.ts | Text & Pattern → Look |
| Pattern panels (4 patterns, bands incl. Woven, medallion) | textPanel.ts template "pattern", pattern.ts, PatternArt.tsx | Create → Pattern (own workflow) |
| 3D viewer (views, wireframe, base, tint, fullscreen) | preview.tsx | Workspace centre, all workflows |
| Material preview (teak … brass) — preview only | material.ts, preview.tsx | Viewer toolbar |
| Exports STL / .rlf / 16-bit TIFF / BMP / proof PNG / cut DXF / vectors DXF+SVG | App.tsx export card | Export step: CNC (STL, RLF, TIFF) · Vectors (DXF, SVG) · Advanced (BMP, proof, others) |
| STL validation verdict | validate.ts, App.tsx | Export → Verification panel |
| Recent designs (text) | recent.ts (localStorage carve.recent.v1) | Home "Recent" + Projects page (extend) |
| Example tiles (4) | App.tsx STARTS, public/examples | Home "Start a project" cards |
| Saved work across refresh | App.tsx localStorage carve.textSpec.v1, carve.mode | Store layer (Phase 0) |
| API abuse guard, security headers | api/*.ts, vercel.json | unchanged |

## Phase plan (each phase: pnpm check · tsc · build · smoke.mjs at 4 widths · look at every screen · push)
**Phase 0 — foundations (no visible change)**
- Move App.tsx state (42 useState) into a store (React context + reducer, or Zustand if justified)
  with the same localStorage keys, so routes can share it. Behaviour identical.
- Router (react-router or a tiny history router) with routes below; vercel.json SPA rewrite.
- `scripts/qa/smoke.mjs` runs in CI-like fashion locally. Done when: site identical, all tests green,
  hard refresh on every route works.

**Phase 1 — shell: navigation, Home, Create**
- Desktop top nav: Home · Create · Projects · Settings. Mobile bottom nav: Home · Projects · Create · More
  (hidden inside an active project).
- Home: "AI Carve — CNC Relief Design Studio", one primary [+ New project], Start-a-project cards
  (Image Relief, Text / Arabic, Pattern, Depth Map *(coming in Phase 6 — card says so or is hidden)*,
  Trace Logo), Recent. Lightweight: no Quran library, no model, no 3D on Home.
- Create: "What would you like to make?" → five options → their routes. Until a workflow is rebuilt,
  its route may open the current workspace pre-set to that mode (keeps the site working).
- Done when: a first-time user on a phone can tell what to tap; Lighthouse-ish check: Home loads no
  heavy chunks; all old features still reachable.

**Phase 2 — Image Relief workspace** (left steps · centre viewer · right settings · bottom action;
mobile: top bar, viewer, controls, sticky action). Steps: Image · Size (W/H, keep proportions, relief
depth, base, **total thickness shown**) · Relief · Export. Advanced collapsed and grouped.

**Phase 3 — Text / Arabic + 99 Names**: first screen cards (99 Names · Quran · Dhikr · Name Plaque ·
Custom Text) from designs.ts; 99 Names flow with an honest verification panel and [View exact text]
(proofPng).

**Phase 4 — Pattern builder** (patterns incl. Woven, size, band, centre, frame, depth).

**Phase 5 — Export by purpose + verification**: [Export CNC files] (STL, RLF, TIFF) · [Export vectors]
(DXF, SVG) · Advanced (BMP, proof…). Verification: mesh valid, dimensions, units mm, triangles,
STL validated, export geometry == preview geometry. Friendly errors + collapsed technical details.

**Phase 6 — Trace Logo workflow + NEW Depth Map upload** (height map in → relief, skip AI).

**Phase 7 — Projects + Settings**: project model {id, type, name, spec, image (IndexedDB), thumb,
updatedAt}; tabs All/Text/Relief/Pattern; Open/Duplicate/Delete; `/project/:id`. Migrate
carve.recent.v1. Settings as defined above.

**Phase 8 — full visual QA** at 390/768/1024/1440, fix everything; performance pass (lazy chunks).

## Routes
`/` · `/create` · `/create/image` · `/create/text` · `/create/text/99-names` · `/create/pattern` ·
`/create/depth-map` · `/create/trace` · `/projects` · `/project/:id` · `/settings`

## Known pitfalls (all hit in practice)
- Never size text in CSS container units (cqi) in lists of Arabic previews: froze the design list 5 s+.
- Use-before-define in a component (e.g. calling a helper defined later) crashes the page while tsc and
  all unit tests pass → always load the built page in a browser.
- Playwright: sticky bottom bars intercept `locator.click()` on phones → scroll to centre and use
  `page.mouse.click`; WebGL canvas never "stable" → screenshot with `clip` of its bounding box.
- Test with a fresh browser context (saved localStorage hid the freeze) and with CPU throttled 6×.
