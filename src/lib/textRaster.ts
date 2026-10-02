/**
 * Browser side of text panels: load the Amiri fonts, let the browser shape the
 * Arabic (joining, dots, hamza, madda, tashkeel) on a canvas, and turn what it
 * draws into coverage masks for composePanel.
 */
import { cornerParts } from "./ornament";
import { FONTS, fitText, type DrawOp, type FontId, type Layout, type Masks, type Star } from "./textPanel";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const loading = new Map<FontId, Promise<void>>();

/** Overridable for tests / Node (the browser uses OffscreenCanvas + FontFace). */
const env: { canvas: ((w: number, h: number) => Ctx) | null; font: ((id: FontId) => Promise<void>) | null } = { canvas: null, font: null };
export function configureRaster(o: { canvas?: (w: number, h: number) => Ctx; font?: (id: FontId) => Promise<void> }): void {
  if (o.canvas) env.canvas = o.canvas;
  if (o.font) env.font = o.font;
}

export function loadFont(id: FontId): Promise<void> {
  if (env.font) return env.font(id);
  let p = loading.get(id);
  if (!p) {
    const f = FONTS[id];
    p = (async () => {
      const face = new FontFace(f.family, `url(${f.url})`);
      await face.load();
      document.fonts.add(face);
    })();
    loading.set(id, p);
    p.catch(() => loading.delete(id));
  }
  return p;
}

function canvas2d(w: number, h: number): Ctx {
  if (env.canvas) return env.canvas(w, h);
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true });
    if (c) return c;
  }
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  const c = el.getContext("2d", { willReadFrequently: true });
  if (!c) throw new Error("This browser cannot draw text for the panel.");
  return c;
}

const fontCss = (f: FontId, px: number) => `${px.toFixed(2)}px "${FONTS[f].family}"`;

function drawOps(ctx: Ctx, ops: readonly DrawOp[], pxmm: number): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "rtl";
  for (const o of ops) {
    ctx.font = fontCss(o.font, o.sizeMm * pxmm);
    ctx.fillText(o.text, o.cx * pxmm, o.baseline * pxmm);
  }
}

function drawStars(ctx: Ctx, stars: readonly Star[], pxmm: number): void {
  for (const s of stars) {
    ctx.beginPath();
    for (let k = 0; k < 16; k++) {
      const r = (k % 2 === 0 ? s.r : s.r * 0.45) * pxmm;
      const a = (k * Math.PI) / 8 - Math.PI / 2;
      const x = s.cx * pxmm + r * Math.cos(a);
      const y = s.cy * pxmm + r * Math.sin(a);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/** Average the alpha of each ss×ss block into a 0..1 coverage grid. */
function coverage(data: Uint8ClampedArray, ss: number, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows);
  const w = cols * ss;
  const k = 1 / (255 * ss * ss);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let dy = 0; dy < ss; dy++) {
        const row = (y * ss + dy) * w;
        for (let dx = 0; dx < ss; dx++) s += data[(row + x * ss + dx) * 4 + 3] ?? 0;
      }
      out[y * cols + x] = s * k;
    }
  }
  return out;
}

/** Fonts used by a layout, plus the header font. */
async function fontsFor(layout: Layout): Promise<void> {
  const ids = new Set<FontId>(layout.items.map((i) => i.font));
  await Promise.all([...ids].map(loadFont));
}

export async function rasterPanel(layout: Layout, cols: number, rows: number): Promise<{ masks: Masks; ops: DrawOp[] }> {
  await fontsFor(layout);
  const ss = cols * rows * 4 <= 16_000_000 ? 2 : 1;
  const W = cols * ss;
  const H = rows * ss;
  const pxmm = W / layout.widthMm;
  const ctx = canvas2d(W, H);
  ctx.direction = "rtl";
  const measure = (t: string, f: FontId, sizeMm: number) => {
    ctx.font = fontCss(f, sizeMm * pxmm);
    return ctx.measureText(t).width / pxmm;
  };
  const ops = fitText(layout.items, measure);
  for (const o of ops) {
    ctx.font = fontCss(o.font, o.sizeMm * pxmm);
    // height of a tall letter (alif / capital H) at this size: marks stacked above the letters don't count
    const m = ctx.measureText(/[\u0600-\u06ff]/.test(o.text) ? "ا" : "H");
    const ink = (m.actualBoundingBoxAscent ?? 0) + (m.actualBoundingBoxDescent ?? 0);
    if (ink > 0) o.inkMm = ink / pxmm;
  }
  const pass = (draw: () => void) => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#fff";
    draw();
    return coverage(ctx.getImageData(0, 0, W, H).data, ss, cols, rows);
  };
  const text = pass(() => drawOps(ctx, ops.filter((o) => o.role === "text"), pxmm));
  const header = pass(() => drawOps(ctx, ops.filter((o) => o.role === "header"), pxmm));
  const stars = pass(() => drawStars(ctx, layout.stars, pxmm));
  return { masks: { text, header, stars }, ops };
}

/** Flat black-on-white proof of the exact lettering, for checking spelling before carving. */
export async function proofPng(layout: Layout, longSide = 2000): Promise<Blob> {
  await fontsFor(layout);
  const k = longSide / Math.max(layout.widthMm, layout.heightMm);
  const W = Math.round(layout.widthMm * k);
  const H = Math.round(layout.heightMm * k);
  const ctx = canvas2d(W, H);
  ctx.direction = "rtl";
  const measure = (t: string, f: FontId, sizeMm: number) => {
    ctx.font = fontCss(f, sizeMm * k);
    return ctx.measureText(t).width / k;
  };
  const ops = fitText(layout.items, measure);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9b79c";
  ctx.lineWidth = Math.max(1, k * 0.6);
  for (const t of layout.tiles) ctx.strokeRect(t.x0 * k, t.y0 * k, (t.x1 - t.x0) * k, (t.y1 - t.y0) * k);
  for (const b of layout.beads) ctx.strokeRect(b.x0 * k, b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
  for (const a of layout.arcs) {
    ctx.beginPath();
    a.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
    ctx.stroke();
  }
  // corner ornaments: their outlines, so the proof shows where they sit
  ctx.strokeStyle = "#a88b5f";
  for (const p of layout.pockets) {
    for (const part of cornerParts("flowers", p, 1)) {
      ctx.beginPath();
      const pts = part.kind === "dome" ? part.poly : part.path;
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
      if (part.kind === "dome") ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.fillStyle = "#1e140a";
  drawOps(ctx, ops, k);
  ctx.fillStyle = "#8a6a3a";
  drawStars(ctx, layout.stars, k);
  if ("convertToBlob" in ctx.canvas) return (ctx.canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
  return new Promise((res, rej) => (ctx.canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error("Proof image failed"))), "image/png"));
}
