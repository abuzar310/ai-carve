"""
Synthetic training data for the AI Carve relief model.

Every sample is a pair: a picture of a carving (uint8 RGB) and its exact height map
(float32 0..1, high = raised). All shapes are invented here procedurally, so the data
has no copyright or licence strings attached and there is no limit on how much we make.

Carving vocabulary: leaves (midrib + side veins, serrated or lobed), flowers / rosettes,
acanthus-style spiral scrolls, vines, bead strings, moulded frames (ogee, bead, cove),
chip-carved stars (V profile), raised or incised lettering, organic blobs (stand-ins for
figures, clouds, animals), background matting, layered overlaps, mirror symmetry.

Pictures: lit like a photo (directional + fill light, cast shadows, cavity darkening,
wood / stone / metal / painted / plaster finishes, varnish highlights, JPEG, noise,
blur), or as flat colour artwork, or as line art (the "drawing to relief" case).

Run `python relief_synth.py preview out.png` to see a grid of samples.
"""
from __future__ import annotations

import io
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi

SS = 2  # supersampling for anti-aliased masks


# ----------------------------------------------------------------------------- noise
def fbm(n: int, rng: np.random.Generator, base: int = 4, octaves: int = 4, persist: float = 0.5) -> np.ndarray:
    """Fractal value noise, roughly 0..1."""
    out = np.zeros((n, n), np.float32)
    amp, tot = 1.0, 0.0
    cells = base
    for _ in range(octaves):
        g = rng.random((cells + 3, cells + 3)).astype(np.float32)
        z = ndi.zoom(g, (n + 3 * n / cells) / (cells + 3), order=3)
        out += amp * z[:n, :n]
        tot += amp
        amp *= persist
        cells *= 2
    out /= tot
    out -= out.min()
    return out / max(out.max(), 1e-6)


# ----------------------------------------------------------------------------- profiles
def profile(t: np.ndarray, kind: str) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    if kind == "round":  # quarter circle: pillow / tube
        return np.sqrt(1.0 - (1.0 - t) ** 2)
    if kind == "vee":  # chip carving, sharp ridge
        return t
    if kind == "soft":  # smoothstep
        return t * t * (3 - 2 * t)
    if kind == "cushion":
        return np.sin(0.5 * np.pi * t) ** 0.7
    if kind == "flat":  # handled by caller with small edge radius, but keep a shape
        return np.sqrt(1.0 - (1.0 - t) ** 2)
    return t


# ----------------------------------------------------------------------------- canvas
class Relief:
    def __init__(self, n: int, rng: np.random.Generator):
        self.n = n
        self.rng = rng
        self.h = np.zeros((n, n), np.float32)
        self.ids = np.zeros((n, n), np.int32)
        self.nid = 1

    # masks ------------------------------------------------------------------
    def mask(self, draw_fn) -> np.ndarray:
        n = self.n
        img = Image.new("L", (n * SS, n * SS), 0)
        draw_fn(ImageDraw.Draw(img), SS)
        return np.asarray(img.resize((n, n), Image.BILINEAR), np.float32) / 255.0

    def _crop_mask(self, pts_r, draw_fn) -> np.ndarray:
        """Draw only inside the bounding box of the points (radius-padded), paste into a full mask."""
        n = self.n
        arr = np.asarray([(x, y) for x, y, _ in pts_r], np.float32)
        rad = max(r for _, _, r in pts_r) + 3
        x0 = int(max(0, np.floor(arr[:, 0].min() - rad)))
        y0 = int(max(0, np.floor(arr[:, 1].min() - rad)))
        x1 = int(min(n, np.ceil(arr[:, 0].max() + rad)))
        y1 = int(min(n, np.ceil(arr[:, 1].max() + rad)))
        out = np.zeros((n, n), np.float32)
        if x1 - x0 < 2 or y1 - y0 < 2:
            return out
        w, h = x1 - x0, y1 - y0
        img = Image.new("L", (w * SS, h * SS), 0)
        draw_fn(ImageDraw.Draw(img), x0, y0)
        out[y0:y1, x0:x1] = np.asarray(img.resize((w, h), Image.BILINEAR), np.float32) / 255.0
        return out

    def poly_mask(self, pts) -> np.ndarray:
        pts = [(float(x), float(y)) for x, y in pts]
        return self._crop_mask([(x, y, 0) for x, y in pts],
                               lambda d, x0, y0: d.polygon([((x - x0) * SS, (y - y0) * SS) for x, y in pts], fill=255))

    def disc_mask(self, cx, cy, r) -> np.ndarray:
        return self._crop_mask([(cx, cy, r)], lambda d, x0, y0: d.ellipse(
            [(cx - r - x0) * SS, (cy - r - y0) * SS, (cx + r - x0) * SS, (cy + r - y0) * SS], fill=255))

    def stroke_mask(self, pts, widths) -> np.ndarray:
        """Variable-width stroke: circles along a dense polyline."""
        pr = [(float(x), float(y), max(0.6, float(w) / 2)) for (x, y), w in zip(pts, widths)]

        def fn(d, x0, y0):
            for x, y, r in pr:
                d.ellipse([(x - r - x0) * SS, (y - r - y0) * SS, (x + r - x0) * SS, (y + r - y0) * SS], fill=255)

        return self._crop_mask(pr, fn)

    # adding shapes --------------------------------------------------------------
    def add(self, m: np.ndarray, amp: float, kind: str = "round", edge: float | None = None,
            on_top: float = 0.6, sink: bool = False, tilt: tuple[float, float, float] | None = None) -> np.ndarray | None:
        """Raise (or sink) a shape. `on_top` = how much it sits on whatever is under it (0..1)."""
        inside = m > 0.5
        if inside.sum() < 6:
            return None
        ys, xs = np.nonzero(inside)
        y0, y1 = max(0, ys.min() - 2), min(self.n, ys.max() + 3)
        x0, x1 = max(0, xs.min() - 2), min(self.n, xs.max() + 3)
        sub = inside[y0:y1, x0:x1]
        d = ndi.distance_transform_edt(sub).astype(np.float32)
        dmax = float(d.max())
        R = dmax if edge is None else max(1.0, min(dmax, edge))
        eh = amp * dmax ** 0.0 * profile(d / R, kind)
        if tilt is not None:  # cupped petals / sloped leaves: linear ramp across the shape
            ax, ay, k = tilt
            yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
            ramp = ((xx - ax) * math.cos(k) + (yy - ay) * math.sin(k))
            ramp = (ramp - ramp[sub].min()) / max(1e-6, np.ptp(ramp[sub]))
            eh = eh * (0.75 + 0.5 * ramp)
        soft = m[y0:y1, x0:x1]
        reg = self.h[y0:y1, x0:x1]
        if sink:
            tgt = reg - eh
        else:
            under = reg[sub]
            base = on_top * float(np.percentile(under, 90)) if under.size else 0.0
            tgt = np.maximum(reg, base + eh)
        reg += (tgt - reg) * soft
        self.ids[y0:y1, x0:x1][sub] = self.nid
        self.nid += 1
        return inside

    def groove(self, lines, width: float, depth: float, within: np.ndarray | None) -> None:
        """Carve V/U grooves (veins, midribs) along one polyline or a list of them."""
        if len(lines) == 0:
            return
        if np.ndim(np.asarray(lines[0], dtype=object)) == 1 and np.ndim(lines[0]) == 1:
            lines = [lines]  # a single polyline of (x, y) points
        lines = [[(float(x), float(y)) for x, y in ln] for ln in lines if len(ln) >= 2]
        if not lines:
            return
        pad = int(width * 2 + 4)
        allp = np.array([p for ln in lines for p in ln], np.float32)
        x0 = max(0, int(allp[:, 0].min()) - pad)
        y0 = max(0, int(allp[:, 1].min()) - pad)
        x1 = min(self.n, int(allp[:, 0].max()) + pad + 1)
        y1 = min(self.n, int(allp[:, 1].max()) + pad + 1)
        if x1 - x0 < 2 or y1 - y0 < 2:
            return
        w, h = x1 - x0, y1 - y0
        img = Image.new("L", (w * SS, h * SS), 0)
        d = ImageDraw.Draw(img)
        for ln in lines:
            d.line([((x - x0) * SS, (y - y0) * SS) for x, y in ln], fill=255, width=max(1, int(width * SS)))
        g = np.asarray(img.resize((w, h), Image.BILINEAR), np.float32) / 255.0
        g = ndi.gaussian_filter(g, max(0.6, width * 0.35))
        if within is not None:
            g *= ndi.gaussian_filter(within[y0:y1, x0:x1].astype(np.float32), 1.0)
        self.h[y0:y1, x0:x1] -= depth * g / max(float(g.max()), 1e-6)


# ----------------------------------------------------------------------------- geometry helpers
def bezier(p0, p1, p2, k=40):
    t = np.linspace(0, 1, k)[:, None]
    p0, p1, p2 = (np.asarray(p, np.float32) for p in (p0, p1, p2))
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2


def leaf_outline(base, tip, bend, width, rng, lobes=0, serr=0.0, sharp=1.0):
    """Leaf / petal polygon around a bent spine. Returns (polygon, spine)."""
    base = np.asarray(base, np.float32)
    tip = np.asarray(tip, np.float32)
    v = tip - base
    L = float(np.hypot(*v)) + 1e-6
    nrm = np.array([-v[1], v[0]], np.float32) / L
    mid = (base + tip) / 2 + nrm * bend * L
    spine = bezier(base, mid, tip, 48)
    tang = np.gradient(spine, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-6
    side = np.stack([-tang[:, 1], tang[:, 0]], 1)
    s = np.linspace(0, 1, len(spine))
    w = width * np.sin(np.pi * np.clip(s, 0, 1)) ** sharp
    w *= 1 - 0.35 * s ** 3  # narrower toward the tip
    if lobes:
        w *= 1 + 0.35 * np.abs(np.sin(lobes * np.pi * s))
    if serr > 0:
        w *= 1 + serr * (np.sin(28 * np.pi * s) > 0)
    left = spine + side * w[:, None] * (1 + 0.1 * rng.standard_normal())
    right = spine - side * w[:, None]
    poly = np.concatenate([left, right[::-1]], 0)
    return [tuple(p) for p in poly], spine


# ----------------------------------------------------------------------------- motifs
def m_leaf(r: Relief, cx, cy, size, ang, amp, rng, veins=True):
    L = size
    base = (cx, cy)
    tip = (cx + L * math.cos(ang), cy + L * math.sin(ang))
    poly, spine = leaf_outline(base, tip, rng.uniform(-0.25, 0.25), L * rng.uniform(0.18, 0.35), rng,
                               lobes=int(rng.choice([0, 0, 3, 4, 5])), serr=rng.choice([0, 0, 0.12]),
                               sharp=rng.uniform(0.6, 1.2))
    k = rng.choice(["round", "soft", "cushion"])
    tilt = (cx, cy, ang) if rng.random() < 0.5 else None
    inside = r.add(r.poly_mask(poly), amp, k, tilt=tilt)
    if inside is None or not veins:
        return
    w = max(1.0, L * 0.025)
    r.groove(spine[3:-3], w, amp * rng.uniform(0.25, 0.5), inside)
    if rng.random() < 0.7:
        tang = spine[-1] - spine[0]
        tang /= np.linalg.norm(tang) + 1e-6
        side = np.array([-tang[1], tang[0]])
        veins_l = []
        for i in range(6, len(spine) - 8, 7):
            for sgn in (1, -1):
                a = spine[i]
                b = a + (side * sgn * 0.8 + tang * 0.6) * L * 0.18
                veins_l.append([tuple(a), tuple(b)])
        r.groove(veins_l, w * 0.7, amp * 0.18, inside)


def m_flower(r: Relief, cx, cy, rad, amp, rng):
    npet = int(rng.integers(5, 13))
    off = rng.uniform(0, 2 * math.pi)
    layers = 2 if rng.random() < 0.5 else 1
    for layer in range(layers):
        R = rad * (1 - 0.35 * layer)
        for i in range(npet):
            a = off + (i + 0.5 * layer) * 2 * math.pi / npet
            tip = (cx + R * math.cos(a), cy + R * math.sin(a))
            poly, spine = leaf_outline((cx, cy), tip, rng.uniform(-0.08, 0.08), R * rng.uniform(0.25, 0.42), rng,
                                       sharp=rng.uniform(0.4, 0.8))
            ins = r.add(r.poly_mask(poly), amp * (0.8 + 0.3 * layer), "round", tilt=(cx, cy, a), on_top=0.45)
            if ins is not None and rng.random() < 0.5:
                r.groove(spine[8:-6], max(1.0, R * 0.02), amp * 0.2, ins)
    cr = rad * rng.uniform(0.18, 0.3)
    r.add(r.disc_mask(cx, cy, cr), amp * 0.6, "round", on_top=0.5)
    if rng.random() < 0.6:  # stippled centre
        for _ in range(int(rng.integers(5, 14))):
            a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0, cr * 0.75)
            r.add(r.disc_mask(cx + d * math.cos(a), cy + d * math.sin(a), cr * 0.18), amp * 0.25, "round", on_top=1.0)


def m_scroll(r: Relief, cx, cy, size, amp, rng):
    turns = rng.uniform(1.2, 2.4)
    b = rng.uniform(0.12, 0.25)
    th = np.linspace(0, turns * 2 * math.pi, 220)
    rr = size * np.exp(-b * th)
    a0 = rng.uniform(0, 2 * math.pi)
    sgn = rng.choice([-1, 1])
    xs = cx + rr * np.cos(a0 + sgn * th)
    ys = cy + rr * np.sin(a0 + sgn * th)
    wid = size * rng.uniform(0.08, 0.16) * np.linspace(1.0, 0.35, len(th))
    pts = list(zip(xs, ys))
    ins = r.add(r.stroke_mask(pts, wid), amp, "round", on_top=0.5)
    if ins is not None and rng.random() < 0.6:
        r.groove(pts[5:-20], max(1.0, size * 0.015), amp * 0.25, ins)
    for i in range(10, len(pts) - 40, int(rng.integers(25, 45))):  # leaves off the scroll
        x, y = pts[i]
        ang = math.atan2(y - cy, x - cx) + rng.uniform(-0.6, 0.6)
        m_leaf(r, x, y, size * rng.uniform(0.35, 0.6), ang, amp * 0.8, rng, veins=rng.random() < 0.5)


def m_vine(r: Relief, p0, p2, amp, rng):
    p0 = np.asarray(p0, np.float32)
    p2 = np.asarray(p2, np.float32)
    mid = (p0 + p2) / 2 + rng.normal(0, 0.25, 2) * np.linalg.norm(p2 - p0)
    pts = bezier(p0, mid, p2, 120)
    L = float(np.linalg.norm(p2 - p0))
    w = np.full(len(pts), L * rng.uniform(0.02, 0.04))
    r.add(r.stroke_mask([tuple(p) for p in pts], w), amp * 0.6, "round", on_top=0.3)
    tang = np.gradient(pts, axis=0)
    for k, i in enumerate(range(8, len(pts) - 8, int(rng.integers(12, 22)))):
        t = tang[i]
        a = math.atan2(t[1], t[0]) + (1 if k % 2 else -1) * rng.uniform(0.5, 1.2)
        m_leaf(r, pts[i][0], pts[i][1], L * rng.uniform(0.12, 0.2), a, amp * 0.8, rng)
    if rng.random() < 0.5:
        m_flower(r, p2[0], p2[1], L * rng.uniform(0.1, 0.16), amp, rng)


def m_beads(r: Relief, pts, rad, amp, rng):
    kind = rng.choice(["round", "cushion"])
    elong = rng.random() < 0.35
    for i, (x, y) in enumerate(pts):
        if elong and i % 2:
            continue
        rr = rad * (0.6 if (elong and i % 2 == 0 and rng.random() < 0) else 1)
        r.add(r.disc_mask(x, y, rr), amp, kind, on_top=0.8)


def molding_profile(rng) -> np.ndarray:
    """Random 1-D moulding cross-section (outer edge -> inner edge), 0..1."""
    parts = []
    for _ in range(int(rng.integers(2, 5))):
        n = int(rng.integers(20, 60))
        t = np.linspace(0, 1, n)
        k = rng.choice(["bead", "cove", "flat", "slope", "ogee"])
        lvl = rng.uniform(0.3, 1.0)
        if k == "bead":
            seg = lvl * (0.6 + 0.4 * np.sqrt(np.clip(1 - (2 * t - 1) ** 2, 0, 1)))
        elif k == "cove":
            seg = lvl * (1 - 0.5 * np.sqrt(np.clip(1 - (2 * t - 1) ** 2, 0, 1)))
        elif k == "flat":
            seg = np.full(n, lvl)
        elif k == "slope":
            seg = lvl * (1 - 0.6 * t)
        else:
            seg = lvl * (0.5 + 0.5 * np.cos(np.pi * t))
        parts.append(seg)
    p = np.concatenate(parts)
    p[:4] *= np.linspace(0.2, 1, 4)  # rounded outer arris
    return p


def m_frame(r: Relief, band: float, amp: float, rng):
    n = r.n
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    if rng.random() < 0.7:
        dout = np.minimum(np.minimum(xx, n - 1 - xx), np.minimum(yy, n - 1 - yy))
    else:  # oval / round frame
        c = (n - 1) / 2
        rr = np.hypot((xx - c) / c, (yy - c) / c)
        dout = (1 - rr) * c
    prof = molding_profile(rng)
    u = dout / band
    inside = (u >= 0) & (u < 1)
    val = np.interp(np.clip(u, 0, 1), np.linspace(0, 1, len(prof)), prof).astype(np.float32)
    r.h = np.where(inside, np.maximum(r.h, amp * val), r.h)
    r.ids[inside] = r.nid
    r.nid += 1
    return dout


def m_chip_star(r: Relief, cx, cy, rad, amp, rng):
    k = int(rng.integers(4, 13))
    inner = rng.uniform(0.25, 0.55)
    off = rng.uniform(0, math.pi)
    pts = []
    for i in range(2 * k):
        rr = rad if i % 2 == 0 else rad * inner
        a = off + i * math.pi / k
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    sink = rng.random() < 0.45
    r.add(r.poly_mask(pts), amp, "vee", sink=sink, on_top=0.8)


def m_text(r: Relief, amp, rng):
    fonts = ["DejaVuSans-Bold.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSerif.ttf", "DejaVuSans.ttf"]
    word = "".join(rng.choice(list("ABCDEFGHIJKLMNOPRSTUVWXYZ"), int(rng.integers(3, 8))))
    if rng.random() < 0.4:
        word = word.capitalize()
    n = r.n
    size = int(n * rng.uniform(0.12, 0.22))
    font = None
    for f in rng.permutation(fonts):
        try:
            font = ImageFont.truetype(str(f), size * SS)
            break
        except OSError:
            continue
    if font is None:
        return
    def fn(d, s):
        bb = d.textbbox((0, 0), word, font=font)
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        x = (n * s - w) / 2 + rng.uniform(-0.1, 0.1) * n * s
        y = rng.uniform(0.2, 0.7) * n * s
        d.text((x - bb[0], y - bb[1]), word, font=font, fill=255)
    m = r.mask(fn)
    sink = rng.random() < 0.4
    r.add(m, amp, "vee" if sink or rng.random() < 0.3 else "round", sink=sink, edge=None if sink else size * 0.12)


def m_blob(r: Relief, cx, cy, rad, amp, rng):
    n = r.n
    noise = fbm(n, rng, base=int(rng.integers(3, 7)), octaves=3)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    d = np.hypot((xx - cx) / rad, (yy - cy) / (rad * rng.uniform(0.6, 1.4)))
    field = (1 - d) + 0.5 * (noise - 0.5)
    m = (field > 0).astype(np.float32)
    m = ndi.gaussian_filter(m, 1.0)
    ins = r.add(m, amp, rng.choice(["round", "cushion", "soft"]), on_top=0.5)
    if ins is not None and rng.random() < 0.7:  # inner modelling: sub-bumps, folds
        detail = ndi.gaussian_filter(fbm(n, rng, base=int(rng.integers(6, 14)), octaves=2), 1.5) - 0.5
        r.h += np.where(ins, detail * amp * rng.uniform(0.2, 0.5), 0).astype(np.float32)


# ----------------------------------------------------------------------------- layouts
def make_relief(n: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    r = Relief(n, rng)
    style = rng.choice(["panel", "floral", "scrolls", "border", "rosette", "allover", "lettering", "organic"],
                       p=[0.2, 0.17, 0.15, 0.12, 0.1, 0.12, 0.06, 0.08])
    mirror = rng.random() < (0.55 if style in ("panel", "floral", "scrolls", "rosette") else 0.2)
    lo = 0.0
    if rng.random() < 0.5 and style not in ("border",):
        band = n * rng.uniform(0.05, 0.14)
        m_frame(r, band, rng.uniform(0.5, 1.0), rng)
        lo = band
    span = n - 2 * lo
    cx = cy = n / 2

    def rp():
        return lo + rng.uniform(0.1, 0.9) * span

    if style == "panel":
        m_flower(r, cx, cy, span * rng.uniform(0.12, 0.22), 0.8, rng)
        for _ in range(int(rng.integers(2, 5))):
            m_scroll(r, rp(), rp(), span * rng.uniform(0.12, 0.22), 0.6, rng)
        for _ in range(int(rng.integers(2, 6))):
            m_leaf(r, rp(), rp(), span * rng.uniform(0.12, 0.3), rng.uniform(0, 2 * math.pi), 0.6, rng)
    elif style == "floral":
        for _ in range(int(rng.integers(1, 4))):
            m_vine(r, (rp(), rp()), (rp(), rp()), 0.7, rng)
        for _ in range(int(rng.integers(1, 4))):
            m_flower(r, rp(), rp(), span * rng.uniform(0.08, 0.18), 0.8, rng)
    elif style == "scrolls":
        for _ in range(int(rng.integers(2, 6))):
            m_scroll(r, rp(), rp(), span * rng.uniform(0.12, 0.3), 0.7, rng)
    elif style == "border":
        # strip across the middle with repeating motif + mouldings
        hgt = n * rng.uniform(0.3, 0.6)
        y0 = (n - hgt) / 2
        yy = np.arange(n, dtype=np.float32)[:, None] * np.ones((1, n), np.float32)
        band = (yy >= y0) & (yy <= y0 + hgt)
        r.h[band] = 0.15
        k = int(rng.integers(3, 8))
        step = n / k
        motif = rng.choice(["flower", "leaf", "beads", "star", "scroll"])
        for i in range(k):
            x = (i + 0.5) * step
            y = n / 2
            if motif == "flower":
                m_flower(r, x, y, min(step, hgt) * 0.4, 0.8, rng)
            elif motif == "leaf":
                m_leaf(r, x - step * 0.4, y, step * 0.8, rng.uniform(-0.4, 0.4), 0.7, rng)
            elif motif == "beads":
                m_beads(r, [(x, y)], min(step, hgt) * 0.3, 0.7, rng)
            elif motif == "star":
                m_chip_star(r, x, y, min(step, hgt) * 0.42, 0.7, rng)
            else:
                m_scroll(r, x, y, min(step, hgt) * 0.45, 0.7, rng)
        if rng.random() < 0.7:
            nb = int(n / (hgt * 0.12))
            xs = np.linspace(0, n, nb)
            for yb in (y0 + hgt * 0.06, y0 + hgt * 0.94):
                m_beads(r, [(x, yb) for x in xs], hgt * 0.05, 0.5, rng)
    elif style == "rosette":
        m_flower(r, cx, cy, span * rng.uniform(0.25, 0.4), 0.9, rng)
        if rng.random() < 0.6:
            ring = span * rng.uniform(0.38, 0.46)
            k = int(rng.integers(12, 40))
            m_beads(r, [(cx + ring * math.cos(2 * math.pi * i / k), cy + ring * math.sin(2 * math.pi * i / k))
                        for i in range(k)], span * 0.025, 0.6, rng)
        for _ in range(int(rng.integers(0, 4))):
            m_chip_star(r, rp(), rp(), span * rng.uniform(0.05, 0.1), 0.5, rng)
    elif style == "allover":
        for _ in range(int(rng.integers(6, 16))):
            f = rng.choice(["leaf", "flower", "star", "blob", "bead"])
            if f == "leaf":
                m_leaf(r, rp(), rp(), span * rng.uniform(0.08, 0.2), rng.uniform(0, 6.3), 0.6, rng)
            elif f == "flower":
                m_flower(r, rp(), rp(), span * rng.uniform(0.05, 0.12), 0.7, rng)
            elif f == "star":
                m_chip_star(r, rp(), rp(), span * rng.uniform(0.04, 0.1), 0.5, rng)
            elif f == "blob":
                m_blob(r, rp(), rp(), span * rng.uniform(0.06, 0.14), 0.6, rng)
            else:
                m_beads(r, [(rp(), rp())], span * 0.03, 0.5, rng)
    elif style == "lettering":
        m_text(r, 0.8, rng)
        for _ in range(int(rng.integers(0, 3))):
            m_leaf(r, rp(), rp(), span * rng.uniform(0.1, 0.2), rng.uniform(0, 6.3), 0.5, rng)
    else:  # organic
        for _ in range(int(rng.integers(1, 4))):
            m_blob(r, rp(), rp(), span * rng.uniform(0.12, 0.3), 0.8, rng)
        for _ in range(int(rng.integers(0, 4))):
            m_leaf(r, rp(), rp(), span * rng.uniform(0.1, 0.25), rng.uniform(0, 6.3), 0.6, rng)

    h = r.h
    ids = r.ids
    if mirror:
        h = np.maximum(h, h[:, ::-1])
        ids = np.where(ids > 0, ids, ids[:, ::-1])
        if style == "rosette" and rng.random() < 0.5:
            h = np.maximum(h, h[::-1, :])
            ids = np.where(ids > 0, ids, ids[::-1, :])
    if rng.random() < 0.3:  # background matting / punch texture
        bg = h < 0.02
        tex = ndi.gaussian_filter(rng.random((n, n)).astype(np.float32), 0.8)
        h = h + bg * (tex - tex.mean()) * rng.uniform(0.02, 0.06)
    if rng.random() < 0.15:  # the whole relief carved on a gently curved/sloped ground
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
        h = h + rng.uniform(0.05, 0.2) * np.sin(np.pi * (xx if rng.random() < 0.5 else yy))
    h = ndi.gaussian_filter(h.astype(np.float32), rng.uniform(0.5, 1.1))
    h -= h.min()
    # A few stacked peaks (flower centres) must not squash everything else: soft-clip the top 0.5 %.
    top = max(float(np.percentile(h, 99.5)), 1e-6)
    h = h / top
    h = np.where(h > 1, 1 + 0.2 * np.tanh((h - 1) / 0.2), h)
    h /= max(float(h.max()), 1e-6)
    return h.astype(np.float32), ids


# ----------------------------------------------------------------------------- materials
PALETTES = {
    "teak": [(0.55, 0.33, 0.16), (0.38, 0.2, 0.08)],
    "walnut": [(0.36, 0.23, 0.14), (0.2, 0.12, 0.07)],
    "oak": [(0.75, 0.58, 0.36), (0.55, 0.38, 0.2)],
    "bass": [(0.88, 0.8, 0.62), (0.75, 0.64, 0.45)],
    "mahogany": [(0.5, 0.22, 0.14), (0.3, 0.1, 0.06)],
    "rosewood": [(0.32, 0.14, 0.1), (0.16, 0.07, 0.05)],
    "marble": [(0.93, 0.92, 0.9), (0.7, 0.7, 0.72)],
    "sandstone": [(0.82, 0.68, 0.5), (0.65, 0.52, 0.38)],
    "granite": [(0.45, 0.45, 0.47), (0.25, 0.25, 0.27)],
    "gold": [(0.95, 0.75, 0.3), (0.6, 0.4, 0.1)],
    "bronze": [(0.55, 0.38, 0.2), (0.25, 0.18, 0.1)],
    "plaster": [(0.95, 0.94, 0.9), (0.85, 0.84, 0.8)],
    "mdf": [(0.72, 0.58, 0.42), (0.62, 0.48, 0.34)],
    "resin": [(0.3, 0.3, 0.32), (0.18, 0.18, 0.2)],
}
WOODS = ["teak", "walnut", "oak", "bass", "mahogany", "rosewood"]


def albedo(n, rng, kind, h):
    a, b = (np.array(c, np.float32) for c in PALETTES[kind])
    jitter = rng.normal(1, 0.08, 3).astype(np.float32)
    a, b = np.clip(a * jitter, 0, 1), np.clip(b * jitter, 0, 1)
    if kind in WOODS or kind == "mdf":
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
        ang = rng.uniform(0, math.pi)
        u = xx * math.cos(ang) + yy * math.sin(ang)
        warp = fbm(n, rng, base=3, octaves=3)
        f = rng.uniform(8, 40) if kind != "mdf" else 2
        rings = 0.5 + 0.5 * np.sin(2 * math.pi * (u * f + warp * rng.uniform(1, 4)))
        rings = rings ** rng.uniform(1, 3)
        fine = fbm(n, rng, base=int(n / 6), octaves=1) if kind != "mdf" else fbm(n, rng, base=int(n / 3), octaves=1)
        t = np.clip(0.6 * rings + 0.4 * fine, 0, 1)
    elif kind == "marble":
        nz = fbm(n, rng, base=3, octaves=5)
        t = np.abs(np.sin(8 * nz + rng.uniform(0, 6))) ** 6
        t = 1 - t
    else:
        t = fbm(n, rng, base=int(rng.integers(4, 30)), octaves=3)
    col = b[None, None] + (a - b)[None, None] * t[..., None]
    if rng.random() < 0.25:  # painted / gilded background different from the carving
        bgc = rng.random(3).astype(np.float32) * 0.6 + 0.1
        bg = (h < 0.03)[..., None]
        col = np.where(bg, bgc[None, None] * (0.8 + 0.2 * t[..., None]), col)
    return col.astype(np.float32)


def cast_shadow(z, az, el, steps=40):
    n = z.shape[0]
    dx, dy = math.cos(az), math.sin(az)
    tan_el = math.tan(el)
    Y, X = np.mgrid[0:n, 0:n]
    lit = np.ones((n, n), np.float32)
    for s in range(1, steps):
        xi = np.clip(X + int(round(s * dx * 1.5)), 0, n - 1)
        yi = np.clip(Y + int(round(s * dy * 1.5)), 0, n - 1)
        lit = np.minimum(lit, np.clip(1 - (z[yi, xi] - z - s * 1.5 * tan_el) * 0.6, 0, 1))
    return ndi.gaussian_filter(lit, 1.0)


def render(h: np.ndarray, ids: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    n = h.shape[0]
    mode = rng.choice(["photo", "flat", "lines"], p=[0.82, 0.11, 0.07])
    if mode == "flat":
        pal = rng.random((int(ids.max()) + 1, 3)).astype(np.float32)
        pal[0] = rng.random(3) * 0.3 + (0.7 if rng.random() < 0.5 else 0.0)
        img = pal[ids]
        if rng.random() < 0.6:  # tonal shading painted on by the artist
            img *= (0.6 + 0.4 * h[..., None])
        if rng.random() < 0.6:
            e = ndi.morphological_gradient(ids, size=3) > 0
            img[e] = rng.random() * 0.2
    elif mode == "lines":
        g = np.hypot(*np.gradient(ndi.gaussian_filter(h, 1.0)))
        e = (ndi.morphological_gradient(ids, size=3) > 0) | (g > np.percentile(g, rng.uniform(88, 96)))
        e = ndi.binary_dilation(e, iterations=int(rng.integers(0, 2)))
        img = np.ones((n, n, 3), np.float32) * rng.uniform(0.85, 1.0)
        img[e] = rng.uniform(0.0, 0.25)
    else:
        z = h * rng.uniform(0.02, 0.1) * n
        gy, gx = np.gradient(z)
        N = np.stack([-gx, -gy, np.ones_like(z)], -1)
        N /= np.linalg.norm(N, axis=-1, keepdims=True)
        az = rng.uniform(0, 2 * math.pi) if rng.random() < 0.4 else rng.normal(-2.2, 0.6)  # mostly from above-left
        el = math.radians(rng.uniform(15, 70))
        L = np.array([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)], np.float32)
        lam = np.clip(N @ L, 0, 1)
        sh = cast_shadow(z, az, el) if rng.random() < 0.85 else 1.0
        kind = rng.choice(list(PALETTES), p=None)
        if rng.random() < 0.5:
            kind = rng.choice(WOODS)
        alb = albedo(n, rng, kind, h)
        cav = np.clip((ndi.gaussian_filter(h, n * 0.01) - h) * rng.uniform(5, 25), 0, 1)
        alb *= (1 - cav[..., None] * rng.uniform(0.2, 0.8))  # dirt / antique wax in crevices
        amb = rng.uniform(0.15, 0.45)
        light = amb + (1 - amb) * (lam * sh)
        if rng.random() < 0.5:  # fill light
            az2 = az + math.pi + rng.normal(0, 0.8)
            L2 = np.array([math.cos(0.6) * math.cos(az2), math.cos(0.6) * math.sin(az2), math.sin(0.6)], np.float32)
            light = light + rng.uniform(0.1, 0.35) * np.clip(N @ L2, 0, 1)
        img = alb * light[..., None]
        shiny = {"gold": 0.8, "bronze": 0.5, "resin": 0.4, "marble": 0.3}.get(kind, rng.uniform(0.0, 0.35))
        if shiny > 0.02:
            H = L + np.array([0, 0, 1], np.float32)
            H /= np.linalg.norm(H)
            spec = np.clip(N @ H, 0, 1) ** rng.uniform(10, 80)
            tint = np.array(PALETTES[kind][0], np.float32) if kind in ("gold", "bronze") else np.ones(3, np.float32)
            shadow = sh if isinstance(sh, np.ndarray) else np.ones_like(z)
            img = img + shiny * (spec * shadow)[..., None] * tint
        # vignette + exposure + white balance
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n - 0.5
        img *= (1 - rng.uniform(0, 0.35) * (xx ** 2 + yy ** 2) * 2)[..., None]
        img *= rng.uniform(0.8, 1.3) * rng.normal(1, 0.05, 3).astype(np.float32)
    img = np.clip(img, 0, 1) ** rng.uniform(0.8, 1.2)
    if rng.random() < 0.5:
        img = ndi.gaussian_filter(img, (rng.uniform(0.3, 1.2), rng.uniform(0.3, 1.2), 0))
    img = img + rng.normal(0, rng.uniform(0, 0.03), img.shape).astype(np.float32)
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    if rng.random() < 0.7:  # JPEG artefacts like a phone photo from WhatsApp
        buf = io.BytesIO()
        out.save(buf, "JPEG", quality=int(rng.integers(35, 95)))
        out = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    return np.asarray(out)


def sample(n: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    h, ids = make_relief(n, rng)
    return render(h, ids, rng), h


def write_dataset(out_dir: str, count: int, n: int = 518, start: int = 0, workers: int | None = None) -> None:
    """Write count samples as NNNNNN.jpg (picture) + NNNNNN.png (16-bit height)."""
    from concurrent.futures import ProcessPoolExecutor

    os.makedirs(out_dir, exist_ok=True)
    seeds = list(range(start, start + count))
    with ProcessPoolExecutor(workers or os.cpu_count()) as ex:
        for i, _ in enumerate(ex.map(_write_one, [(out_dir, n, s) for s in seeds], chunksize=8)):
            if (i + 1) % 500 == 0:
                print(f"  {i + 1}/{count} samples", flush=True)


def _write_one(args):
    out_dir, n, seed = args
    img, h = sample(n, seed)
    Image.fromarray(img).save(os.path.join(out_dir, f"{seed:06d}.jpg"), quality=95)
    Image.fromarray((h * 65535).astype(np.uint16)).save(os.path.join(out_dir, f"{seed:06d}.png"))
    return seed


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "preview":
        k, n = 6, 256
        tiles = []
        for s in range(k * 2):
            img, h = sample(n, 1000 + s)
            hv = np.repeat((h * 255).astype(np.uint8)[..., None], 3, -1)
            tiles.append(np.concatenate([img, hv], 1))
        rows = [np.concatenate(tiles[i:i + 2], 1) for i in range(0, len(tiles), 2)]
        Image.fromarray(np.concatenate(rows, 0)).save(sys.argv[2])
        print("wrote", sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == "write":
        write_dataset(sys.argv[2], int(sys.argv[3]))
