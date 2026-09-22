# Carve

Standalone tool. Not part of the Abuzar monorepo.

Type what you want carved → get a picture → turn it into a 3D relief → download a file the CNC can run.

1. **Generate** a picture (or drop one you already have)
2. Check the **depth** map (white stays high, dark is the cut)
3. Download **carve.nc** onto the pen drive, or **Write pen drive**
4. Optional: **relief.stl** / **height.png** if you still want ArtCAM

This is a 2.5D relief (same idea as ArtCAM), not a free-standing sculpture. Dry-run above the wood before the first real cut.

```
cd carve
pnpm install
pnpm dev          # http://localhost:3030
pnpm check
```
