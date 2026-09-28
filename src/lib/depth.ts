import { normalizeHeight, resampleHeight } from "./height.ts";
import { mergeTiles, planTiles } from "./tiles.ts";

/**
 * Monocular depth in the browser (Depth Anything V2 Small, ~27–50 MB, cached by the
 * browser after the first run). Output is 0..1 with NEAR = 1, which is exactly
 * relief height. Returns null if the model can't load, so the app still works.
 */

const MODEL = "onnx-community/depth-anything-v2-small";
const INPUT_LONG_SIDE = 518; // the model's native size; bigger input only costs time

type DepthPipe = (img: unknown) => Promise<{ predicted_depth: { data: ArrayLike<number>; dims: number[] } }>;
let pipePromise: Promise<DepthPipe> | null = null;

async function loadPipe(onStatus?: (s: string) => void): Promise<DepthPipe> {
  const tf = await import("@huggingface/transformers");
  tf.env.allowLocalModels = false;
  const progress = (p: { status?: string; progress?: number }) => {
    if (p.status === "progress" && typeof p.progress === "number") {
      onStatus?.(`Downloading depth model ${Math.round(p.progress)}%`);
    }
  };
  const hasGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  if (hasGpu) {
    try {
      return (await tf.pipeline("depth-estimation", MODEL, {
        device: "webgpu",
        dtype: "fp16",
        progress_callback: progress,
      })) as unknown as DepthPipe;
    } catch (e) {
      console.warn("carve: WebGPU depth failed, falling back to WASM", e);
    }
  }
  return (await tf.pipeline("depth-estimation", MODEL, {
    device: "wasm",
    dtype: "q8",
    progress_callback: progress,
  })) as unknown as DepthPipe;
}

export async function estimateDepth(
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  cols: number,
  rows: number,
  onStatus?: (s: string) => void,
): Promise<Float32Array | null> {
  try {
    if (!pipePromise) {
      pipePromise = loadPipe(onStatus).catch((e) => {
        pipePromise = null;
        throw e;
      });
    }
    const pipe = await pipePromise;
    const { RawImage } = await import("@huggingface/transformers");

    // Long pictures (legs, border strips) are cut into overlapping near-square tiles,
    // because the model shrinks every input to ~518 px on its long side.
    const tiles = planTiles(cols, rows);
    const sx = srcW / cols;
    const sy = srcH / rows;
    const parts: Float32Array[] = [];
    for (let k = 0; k < tiles.length; k++) {
      const t = tiles[k]!;
      onStatus?.(tiles.length > 1 ? `Estimating depth ${k + 1}/${tiles.length}` : "Estimating depth");
      const tw = t.w * sx;
      const th = t.h * sy;
      const scale = INPUT_LONG_SIDE / Math.max(tw, th, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(8, Math.round(tw * scale));
      canvas.height = Math.max(8, Math.round(th * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, t.x * sx, t.y * sy, tw, th, 0, 0, canvas.width, canvas.height);
      const out = await pipe(RawImage.fromCanvas(canvas));
      const d = out.predicted_depth;
      const h = d.dims[d.dims.length - 2]!;
      const w = d.dims[d.dims.length - 1]!;
      const data = Float32Array.from(d.data);
      if (data.length < w * h || !data.every(Number.isFinite)) return null;
      parts.push(resampleHeight(data, w, h, t.w, t.h));
    }
    return normalizeHeight(tiles.length === 1 ? parts[0]! : mergeTiles(tiles, parts, cols, rows));
  } catch (e) {
    console.warn("carve: depth model unavailable, using picture brightness", e);
    return null;
  }
}
