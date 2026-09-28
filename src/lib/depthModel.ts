/**
 * Which depth model to run.
 *
 * "relief"  = AI Carve's own model, fine-tuned on carved reliefs (training/ folder). It is used
 *             automatically once its files sit in public/models/<RELIEF_MODEL_ID>/.
 * "general" = the stock Depth Anything V2 Small from Hugging Face (the fallback).
 *
 * `?depth=general` or `?depth=relief` in the page URL forces one, for side-by-side checks.
 * Bump RELIEF_MODEL_ID (v1 -> v2) when a retrained model is shipped, so browsers that
 * cached the old files fetch the new ones.
 */

export const RELIEF_MODEL_ID = "ai-carve-relief-v1";
export const LOCAL_MODEL_PATH = "/models/";
export const GENERAL_MODEL_ID = "onnx-community/depth-anything-v2-small";

export type DepthChoice = "relief" | "general";

export function chooseDepthModel(search: string, reliefAvailable: boolean): DepthChoice {
  const q = new URLSearchParams(search).get("depth");
  if (q === "general") return "general";
  return reliefAvailable ? "relief" : "general";
}

type FetchLike = (url: string, init?: { cache?: "no-cache" }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * True only if the relief model's config is really there. Checking the JSON (not just the
 * status) matters: a dev server answers unknown paths with index.html and status 200.
 */
export async function reliefModelAvailable(fetchFn: FetchLike, base = LOCAL_MODEL_PATH): Promise<boolean> {
  try {
    const r = await fetchFn(`${base}${RELIEF_MODEL_ID}/config.json`, { cache: "no-cache" });
    if (!r.ok) return false;
    const j = (await r.json()) as { model_type?: unknown } | null;
    return !!j && j.model_type === "depth_anything";
  } catch {
    return false;
  }
}
