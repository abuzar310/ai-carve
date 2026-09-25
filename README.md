# Carve

Standalone tool. Not part of the Abuzar monorepo.

Picture → **relief.rlf**. Toolpaths stay in ArtCAM.

1. Generate a picture or drop one you already have
2. Set **width / height / depth** in millimetres
3. Download **relief.rlf**
4. ArtCAM: `File → Import Relief`

```
cd carve
pnpm install
pnpm dev          # http://localhost:3030
pnpm check
```

Vercel: import `abuzar310/ai-carve`. Generate goes through `/api/imagine` (60s). The `.rlf` is built in the browser.
