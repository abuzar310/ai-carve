# Paste this as the first message of the new chat (after creating a NEW GitHub token)

I'm continuing work on AI Carve (github.com/abuzar310/ai-carve, live at https://ai-carve.vercel.app).
GitHub token (fine-grained, ONLY the ai-carve repo, Contents + Workflows read/write, short expiry):
<paste the NEW token here>

Clone the repo, then read these before doing anything:
1. docs/HANDOFF.md — current state, rules, how to test.
2. docs/UX_REBUILD.md — the UX / information-architecture rebuild plan (the job).
Also read /mnt/skills/public/frontend-design/SKILL.md before any UI work.

Do Phase 0 (store + router + Vercel SPA rewrite, no visible change), then Phase 1 (navigation, Home,
Create). Rules: don't rebuild the engine; the live site must work after every push; Arabic only from
the library and real fonts; only honest verification ticks; before every push run pnpm check,
npx tsc --noEmit, pnpm build and pnpm qa, and look at every screen at 390/768/1024/1440 px.
Keep looping through the phases without asking me; report what shipped after each phase.
