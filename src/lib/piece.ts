/**
 * What kind of piece a picture is, judged from its shape, and a board size that
 * keeps the picture's proportions (a tall bed-leg design must not be squashed square).
 */

export const PIECES = [
  { id: "panel", label: "Panel", hint: "Wall art, doors", longMm: 100 },
  { id: "leg", label: "Leg / column", hint: "Tall and narrow", longMm: 300 },
  { id: "border", label: "Border strip", hint: "Long and flat", longMm: 300 },
] as const;

export type Piece = (typeof PIECES)[number]["id"];

/** Height ÷ width at or above this is a leg; at or below its inverse, a border strip. */
export const LONG_RATIO = 2;

export function detectPiece(imgW: number, imgH: number): Piece {
  const r = Math.max(1, imgH) / Math.max(1, imgW);
  if (r >= LONG_RATIO) return "leg";
  if (r <= 1 / LONG_RATIO) return "border";
  return "panel";
}

function round(mm: number): number {
  return Math.max(1, Math.round(mm * 2) / 2);
}

/** Board in mm with the picture's aspect ratio; the long side is the piece's default (or `longMm`). */
export function boardForPiece(piece: Piece, imgW: number, imgH: number, longMm?: number): { widthMm: number; heightMm: number } {
  const w = Math.max(1, imgW);
  const h = Math.max(1, imgH);
  const long = longMm && longMm > 0 ? longMm : PIECES.find((p) => p.id === piece)!.longMm;
  if (h >= w) return { widthMm: round((long * w) / h), heightMm: round(long) };
  return { widthMm: round(long), heightMm: round((long * h) / w) };
}

/** Rotary helper: flat width that wraps once around a round leg of this diameter. */
export function circumferenceMm(diameterMm: number): number {
  return Math.round(Math.PI * Math.max(0, diameterMm) * 10) / 10;
}
