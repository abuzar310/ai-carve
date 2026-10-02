/**
 * Material look for the 3D preview: per-vertex colours for wood, stone and metal, so a client can see
 * the carving in teak or marble before it is cut. Procedural (no image textures): wood grain runs
 * along the board's width with gentle waves, marble gets soft veins. Lower areas are shaded a little
 * darker, as a carving is in real light, so the relief still reads. Pure: runs in `pnpm check`.
 */
export type MaterialId = "classic" | "teak" | "walnut" | "rosewood" | "marble" | "sandstone" | "brass";

export const MATERIALS: readonly { id: MaterialId; label: string; roughness: number; metalness: number }[] = [
  { id: "classic", label: "Height tint", roughness: 0.38, metalness: 0.03 },
  { id: "teak", label: "Teak", roughness: 0.55, metalness: 0 },
  { id: "walnut", label: "Walnut", roughness: 0.5, metalness: 0 },
  { id: "rosewood", label: "Rosewood", roughness: 0.45, metalness: 0 },
  { id: "marble", label: "White marble", roughness: 0.22, metalness: 0 },
  { id: "sandstone", label: "Sandstone", roughness: 0.9, metalness: 0 },
  { id: "brass", label: "Brass", roughness: 0.32, metalness: 0.75 },
];

type RGB = readonly [number, number, number];
const PALETTE: Record<Exclude<MaterialId, "classic">, { light: RGB; dark: RGB; kind: "wood" | "marble" | "stone" | "metal" }> = {
  teak: { light: [0.78, 0.55, 0.3], dark: [0.55, 0.35, 0.17], kind: "wood" },
  walnut: { light: [0.5, 0.34, 0.22], dark: [0.3, 0.19, 0.12], kind: "wood" },
  rosewood: { light: [0.52, 0.24, 0.17], dark: [0.3, 0.12, 0.09], kind: "wood" },
  marble: { light: [0.94, 0.93, 0.91], dark: [0.62, 0.62, 0.64], kind: "marble" },
  sandstone: { light: [0.86, 0.72, 0.54], dark: [0.72, 0.58, 0.42], kind: "stone" },
  brass: { light: [0.9, 0.72, 0.38], dark: [0.62, 0.45, 0.2], kind: "metal" },
};

/** Cheap smooth noise from a few sines (deterministic, no texture). */
function wave(x: number, y: number): number {
  return Math.sin(x * 0.031 + Math.sin(y * 0.017) * 2.1) * 0.5 + Math.sin(x * 0.011 - y * 0.023) * 0.35 + Math.sin(y * 0.041 + x * 0.007) * 0.15;
}

/**
 * Colours for `n` vertices (xyz in `positions`, mm). The first `topN` are the carved surface;
 * the rest (sides, base) get the material's darker tone.
 */
export function materialColors(positions: ArrayLike<number>, n: number, topN: number, zLo: number, zSpan: number, id: Exclude<MaterialId, "classic">): Float32Array {
  const p = PALETTE[id];
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const z = positions[i * 3 + 2] ?? 0;
    let m: number; // 0 = light tone, 1 = dark tone
    if (p.kind === "wood") {
      // growth rings: bands across y, bent by slow waves, sharpened a little
      const r = y * 0.55 + wave(x, y) * 9;
      const ring = 0.5 + 0.5 * Math.sin(r);
      m = 0.25 + 0.55 * ring ** 3 + 0.1 * (0.5 + 0.5 * Math.sin(x * 0.9 + y * 0.13));
    } else if (p.kind === "marble") {
      // thin veins where a turbulent field crosses zero
      const v = Math.abs(Math.sin((x + y) * 0.035 + wave(x * 1.7, y * 1.7) * 3.2));
      m = v < 0.08 ? 0.75 * (1 - v / 0.08) : 0.06 * (0.5 + 0.5 * wave(x * 3, y * 3));
    } else if (p.kind === "stone") {
      m = 0.3 + 0.25 * (0.5 + 0.5 * wave(x * 2.3, y * 2.3)) + 0.12 * (0.5 + 0.5 * Math.sin(x * 7.1 + y * 5.3));
    } else {
      m = 0.25 + 0.15 * (0.5 + 0.5 * wave(x * 0.6, y * 0.6));
    }
    m = Math.min(1, Math.max(0, m));
    // carved depth: lower areas a little darker (as in real light); sides and base darker still
    const t = i < topN ? Math.min(1, Math.max(0, (z - zLo) / (zSpan || 1))) : 0;
    const shade = i < topN ? 0.78 + 0.22 * t : 0.6;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(1, (p.light[c]! * (1 - m) + p.dark[c]! * m) * shade);
  }
  return out;
}
