# Carve

Standalone tool. Not part of the Abuzar monorepo.

Picture → height file for **ArtCAM Pro**. Toolpaths stay in ArtCAM.

1. Generate a picture or drop one
2. Set width / height / depth in millimetres
3. **Download BMP for ArtCAM** → one unique `carve-…bmp`
4. ArtCAM start → **Open Existing Model**. Set **Files of type** to **Bitmap (*.bmp)**
5. **Image size** = the millimetres on this page
6. **Reliefs → Create Relief from Bitmap**, height = depth

ArtCAM Open Existing Model opens pictures and `.art` models, not `.rlf`.

```
cd carve
pnpm install
pnpm dev          # http://localhost:3030
pnpm check
```
