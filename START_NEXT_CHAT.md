# AI Carve — start the next session (updated 3 Oct 2026, end of the big session)

## 0. BEFORE the new chat (2 minutes, do not skip)
1. REVOKE the two tokens pasted in the old chat: the GitHub PAT (github_pat_11BY3SV3…, admin on
   ALL repos) and the Vercel token (vcp_2a5n87…). Both are burned.
2. Create a NEW fine-grained GitHub token: ONLY the ai-carve repo, Contents + Workflows
   read/write, short expiry.

## 1. Paste this as the first message of the new chat
---
I'm continuing work on AI Carve (github.com/abuzar310/ai-carve, live at https://ai-carve.vercel.app).
GitHub token (fine-grained, ONLY ai-carve, Contents read/write, short expiry):
<paste the NEW token here — actually paste it, not this placeholder>

Clone the repo, then read before doing anything:
1. docs/HANDOFF.md — current state, shipped phases, bug ledger, sandbox tricks, the queue.
2. docs/UX_REBUILD.md — the plan of record.
3. /mnt/skills/public/frontend-design/SKILL.md before any UI work; my skills repos
   (claude-skills-backup: ui-ux-pro-max, web-design-guidelines, agent-reach) for reference.

The gate before EVERY push: pnpm check · npx tsc --noEmit · pnpm build · browser smoke
(node scripts/qa/static-run.mjs, sections with ONLY=n) · look at screens at 390/768/1024/1440.
The live site must work after every push. Arabic only from the library and real fonts; only
honest, computed verification ticks. One chat at a time on this repo; git fetch and compare
before pushing. Work the queue in docs/HANDOFF.md in order, report after each shipped chunk,
don't ask me to continue.
---

## 2. Where everything stands (so the new chat can sanity-check)
- Live + green: shell/routing, Image Relief step workspace, 99 Names verification (99/99 +
  Allah structural) with export guard on ALL six carving formats, Export Center with
  drift-aware verification, Depth-map workflow, paste/camera/drag inputs, Projects
  (tabs/rename/duplicate/delete, /project/:id), Learn, structured data.
- Test floor: 16 browser smoke sections (scripts/qa/smoke.mjs via static-run.mjs) + 24 unit
  files (pnpm check). All green at HEAD.
- Bug ledger: 2×P1 fixed with regressions (stale exports; drift-blind verification line);
  input exclusivity proven (smoke 16); dblclick STL = not a bug.

## 3. The queue, in order (details + methods in docs/HANDOFF.md)
1. Bug-hunt pass 2: chaos matrix (rapid clicks, navigate/refresh mid-build), invalid and
   extreme input grid, performance pass.
2. Phase 4: dedicated Pattern Builder at /create/pattern (engine exists; UI is the work).
3. IndexedDB project persistence (photo reliefs as saved projects; migrate carve.recent.v1).
4. Quran typography sweep over the 13 library designs (method in handoff), then decide the
   mark-aware default (?typo=mark already proven on Fatiha + the reported panel).
5. Four Quls layout fix: its line BOXES overlap (layoutPanel sections), separate from type.
6. Formal accessibility pass (keyboard, focus, reduced motion).

## 4. Sandbox survival notes (cost real time once; do not rediscover)
- chromium + `vite preview` together get KILLED silently. Use scripts/qa/static-run.mjs
  (in-process server + smoke, one node process), ONLY=n to chunk under ~45 s per tool call.
- Chromium lives at PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; HF/CDN blocked → LOCAL_ORT=1.
- JSX text does NOT process \uXXXX escapes — write real characters (caught by screenshot once).
- Edit scripts: assert each anchor count==1 and WRITE INCREMENTALLY — an all-or-nothing
  script that dies mid-way silently applies nothing.
- Always LOOK at a built page/screenshot before pushing; tsc + unit green is not proof.
