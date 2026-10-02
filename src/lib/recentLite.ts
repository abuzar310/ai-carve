/**
 * Recent builds for display only (Home, Projects): titles, sizes and ages, without the text engine.
 * Opening one still goes through recent.ts / restoreSpec in the workspace.
 */
import type { PanelSpec } from "./textPanel";

export const RECENT_KEY = "carve.recent.v1";

type TitleSpec = Pick<PanelSpec, "lines" | "template" | "header">;

export function recentTitle(spec: TitleSpec): string {
  const first = spec.lines.map((l) => l.trim()).find(Boolean);
  if (spec.template === "names99") return "99 Names of Allah";
  if (first) return first.length > 28 ? first.slice(0, 27) + "…" : first;
  if (spec.template === "pattern") return "Pattern panel";
  return spec.header.trim() ? spec.header.trim().slice(0, 28) : "Text panel";
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export type RecentRow = { at: number; title: string; kind: "names99" | "pattern" | "text"; widthMm: number; heightMm: number; rtl: boolean };

/** Read the stored list defensively: anything odd is skipped, never thrown. */
export function recentRows(raw: string | null): RecentRow[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(v)) return [];
    const rows: RecentRow[] = [];
    for (const r of v) {
      if (!r || typeof r !== "object") continue;
      const at = (r as { at?: unknown }).at;
      const s = (r as { spec?: unknown }).spec as Partial<PanelSpec> | undefined;
      if (typeof at !== "number" || !Number.isFinite(at) || !s || typeof s !== "object") continue;
      const lines = Array.isArray(s.lines) ? s.lines.filter((l): l is string => typeof l === "string") : [];
      const template = typeof s.template === "string" ? s.template : "plate";
      const header = typeof s.header === "string" ? s.header : "";
      const title = recentTitle({ lines, template: template as PanelSpec["template"], header });
      const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
      rows.push({
        at,
        title,
        kind: template === "names99" ? "names99" : template === "pattern" ? "pattern" : "text",
        widthMm: num(s.widthMm),
        heightMm: num(s.heightMm),
        rtl: /[\u0600-\u06ff]/.test(title),
      });
    }
    return rows.slice(0, 12);
  } catch {
    return [];
  }
}
