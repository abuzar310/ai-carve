# Carve

Standalone tool. Not part of the Abuzar monorepo.

Picture → height file for **ArtCAM Pro**. Toolpaths stay in ArtCAM.

1. Generate a picture or drop one
2. Set width / height / depth in millimetres
3. **Download for ArtCAM** → `carve.bmp` (and `carve.rlf`)
4. In ArtCAM Pro: **Open Existing Model** → `carve.bmp`
5. **Reliefs → Create Relief from Bitmap**, height = your depth

ArtCAM Pro rejects a `.rlf` it does not know (including files named `.rlf_3`). BMP is the format this build already opens.

```
cd carve
pnpm install
pnpm dev          # http://localhost:3030
pnpm check
```
