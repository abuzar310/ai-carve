#!/usr/bin/env python3
"""Render a binary STL's top view as PNG - the forensics tool that diagnosed the
3 Oct customer panel (two Bismillah lines whose vowel marks touched).

  python3 scripts/qa/stl-top.py file.stl out.png [--dense]

Default: vertex scatter (fast, any mesh). --dense: snap vertices to the app's own
height lattice for a fully readable heightmap (use for AI Carve exports; the grid
is inferred from the triangle count, 2*(gx-1)*(gy-1) top triangles).
Needs numpy + Pillow. Also prints z-range and triangle count; letters plateau near
the relief depth, the frame bead is the global max - threshold inside the body,
never against the global max (that mistake cost an hour once).
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
dense = "--dense" in sys.argv
raw = open(src, "rb").read()
n = int.from_bytes(raw[80:84], "little")
rec = np.frombuffer(raw, dtype=np.dtype([("n", "<3f4"), ("v", "<9f4"), ("a", "<u2")]), count=n, offset=84)
v = rec["v"].reshape(-1, 3)
x, y, z = v[:, 0], v[:, 1], v[:, 2]
print(f"triangles {n:,} | x {x.min():.2f}..{x.max():.2f} | y {y.min():.2f}..{y.max():.2f} | z {z.min():.3f}..{z.max():.3f}")
W = 1500
H = max(1, int(W * (y.max() - y.min()) / max(1e-6, (x.max() - x.min()))))
gx = np.clip(((x - x.min()) / (x.max() - x.min()) * (W - 1)).astype(int), 0, W - 1)
gy = np.clip(((y - y.min()) / (y.max() - y.min()) * (H - 1)).astype(int), 0, H - 1)
img = np.zeros((H, W), np.float32)
np.maximum.at(img, (gy, gx), z)
im = Image.fromarray((img[::-1] / max(1e-6, img.max()) * 255).astype(np.uint8))
if dense:
    im = im.filter(ImageFilter.MaxFilter(3))
im.save(out)
print("wrote", out)
