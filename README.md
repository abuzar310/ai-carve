# Carve

Standalone tool. Not part of the Abuzar monorepo.

Picture → height file for **ArtCAM Pro**. Toolpaths stay in ArtCAM.

1. Generate a picture or drop one
2. Set width / height / depth in millimetres
3. **Download for ArtCAM** → unique `.bmp` + 16-bit `.tif`
4. ArtCAM start → **Open an image** (not Open Existing Model) → the `.bmp`
5. Set Model Size: width/height mm, **Z height** = depth mm
6. **Reliefs → Save Composite → ArtCAM Relief (*.rlf)**

ArtCAM writes the `.rlf`. We give the picture those tutorials open.

```
cd carve
pnpm install
pnpm dev          # http://localhost:3030
pnpm check
```
