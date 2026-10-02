/**
 * Recent text panels: the last builds, kept in this browser only, so a repeat order is one tap away.
 * Stored as plain specs; every entry is cleaned through restoreSpec when read, so old or damaged
 * entries can never break the page.
 */
import { restoreSpec, type PanelSpec } from "./textPanel";

export type Recent = { spec: PanelSpec; at: number };
export { RECENT_KEY, recentTitle, ago } from "./recentLite";
import { RECENT_KEY } from "./recentLite";
export const RECENT_MAX = 12;

/** Same panel? (Ignores nothing: any change in text, size or look makes a new entry.) */
const same = (a: PanelSpec, b: PanelSpec) => JSON.stringify(a) === JSON.stringify(b);

/** Put `spec` first, drop an older copy of the same panel, keep at most RECENT_MAX. */
export function addRecent(list: readonly Recent[], spec: PanelSpec, at: number): Recent[] {
  return [{ spec, at }, ...list.filter((r) => !same(r.spec, spec))].slice(0, RECENT_MAX);
}

export function parseRecent(raw: string | null): Recent[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((r): r is { spec: unknown; at: unknown } => !!r && typeof r === "object" && "spec" in r)
      .map((r) => ({ spec: restoreSpec(JSON.stringify(r.spec)), at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0 }))
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** A short name for a recent panel: its first line of text, or what kind of panel it is. */
