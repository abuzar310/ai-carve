# Carve

Standalone tool. Not part of the Abuzar monorepo.

Type or drop a picture → 3D relief → **relief.rlf** for ArtCAM, **carve.nc** for the stick.

1. **Generate** a picture (or drop one you already have)
2. Check the **depth** map (white stays high, dark is the cut — same as ArtCAM / LinuxCNC image-to-gcode)
3. Set board **width / height / depth**. ArtCAM relief uses those millimetres.
4. Download **relief.rlf** and open it in ArtCAM (`File → Import Relief`)
5. Download **carve.nc** onto the pen drive (or **carve.tap** for Mach3), or **Write pen drive**
6. Optional: **relief.stl** / **height.png**

Same 2.5D raster shops use: layers so the bit is not asked to take full depth in one go, stepover as a percent of the bit (about 20% for a finish pass), optional second pass at 90°. Dry-run above the wood before the first real cut.

```
cd carve
pnpm install
pnpm dev          # http://localhost:3030
pnpm check
```

Vercel: import `abuzar310/ai-carve`. The site is a static Vite app; Generate goes through `/api/imagine` (60s). Depth, STL, `relief.rlf`, and `carve.nc` are built in the browser, so they work without a database. "Write pen drive" needs Chrome/Edge on HTTPS (Vercel is HTTPS).
