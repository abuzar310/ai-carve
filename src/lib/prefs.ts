/**
 * Preferences kept in this browser (Settings page). Light: no engine imports.
 * The workspace listens for PREFS_EVENT so a change applies without a reload.
 */
export const PREFS_EVENT = "carve:prefs";
export type QualityPref = "standard" | "high" | "ultra";
export const QUALITY_PREFS: readonly { id: QualityPref; label: string; hint: string }[] = [
  { id: "standard", label: "Standard", hint: "Fastest, smallest files" },
  { id: "high", label: "High", hint: "Usual work" },
  { id: "ultra", label: "Ultra", hint: "Large pictures, big files" },
];

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: nothing is remembered, nothing breaks */
  }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: k }));
}

export function readQuality(): QualityPref {
  const v = get("carve.quality");
  return QUALITY_PREFS.some((q) => q.id === v) ? (v as QualityPref) : "high";
}
export const writeQuality = (q: QualityPref) => set("carve.quality", q);
export const readMaterial = () => get("carve.material");
export const writeMaterial = (m: string) => set("carve.material", m);
export const readRaw = get;
export const clearKey = (k: string) => set(k, null);
