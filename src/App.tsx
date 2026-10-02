import { lazy, Suspense, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { heightToImageData, rasterFromImage } from "./lib/height";
import { applyContrast } from "./lib/refine";
import { composeRelief, silhouette, zeroPlane } from "./lib/relief";
import { activeDepthModel, estimateDepth } from "./lib/depth";
import { PIECES, boardForPiece, circumferenceMm, detectPiece, type Piece } from "./lib/piece";
import { QUALITY, buildRelief, constrainedPreview, fieldCols, isSurfaceOnly, restampRelief, triangleEstimate, type Quality, type ReliefMesh } from "./lib/mesh";
import { writeStlAsync } from "./lib/stl";
import { FULL_TOPOLOGY_TRIS, stlBytesEstimate, validateMesh, validateMeshQuick, validateStl, type MeshReport } from "./lib/validate";
import { reliefBmp } from "./lib/bmp";
import { reliefRlf } from "./lib/rlf";
import { reliefTif } from "./lib/tif";
import { DEFAULT_SPEC, composePanel, gridFor, layoutPanel, missingText, restoreSpec, sizeProblem, type PanelSpec } from "./lib/textPanel";
import { proofPng, rasterPanel } from "./lib/textRaster";
import { outlineDxf } from "./lib/dxf";
import { shapeContour } from "./lib/shape";
import { letterOutlines, vectorsDxf, vectorsSvg, type VectorLayer } from "./lib/vector";
import { TextPanelCard } from "./TextPanelCard";
import { TraceCard } from "./TraceCard";
import { RECENT_KEY, addRecent, parseRecent } from "./lib/recent";
import { MATERIALS, type MaterialId } from "./lib/material";
import { applyDesign, designById, resolveSrc } from "./lib/designs";
import { artcamNames } from "./lib/names";
import { canShareFile, saveFile } from "./lib/download";
import { Link, WORKFLOW_PATH, navigate, type Workflow } from "./router";
import { Brand, TopNav } from "./chrome";
import { WORKFLOW_TITLE, type ExampleId } from "./workflows";
import { PREFS_EVENT, readQuality } from "./lib/prefs";

const ReliefPreview = lazy(async () => {
  const m = await import("./preview");
  return { default: m.ReliefPreview };
});

const BIAS = ", ornamental wood carving relief, high contrast, single subject, no text, no watermark";
const nf = new Intl.NumberFormat();
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

type FileMeta = { name: string; size: number; w: number; h: number };

const QUALITY_HINT: Record<Quality, string> = {
  standard: "512 file",
  high: "1024 grid",
  ultra: "Large pictures",
};

const RELIEF = [
  { id: "subtle", label: "Subtle", hint: "Light cut", depth: 1.5 },
  { id: "balanced", label: "Balanced", hint: "Usual work", depth: 3 },
  { id: "deep", label: "Deep", hint: "Strong carve", depth: 6 },
] as const;

const BUILD_STAGES = ["Preparing image", "Generating depth", "Building 3D relief", "Preparing preview"] as const;
const DRAW_STAGES = ["Generating image", ...BUILD_STAGES] as const;
const TEXT_STAGES = ["Typesetting", "Building 3D relief", "Preparing preview"] as const;
const EXPORT_STAGES = ["Preparing height field", "Building export mesh", "Writing STL", "Validating", "Preparing download"] as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that picture"));
    img.src = src;
  });
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function sayErr(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (/Could not read|not a picture/i.test(m)) return "Unable to process this image. Try JPG, PNG, WebP, or BMP.";
  if (/Image host|Generate failed/i.test(m)) return "The picture could not be generated. Check your connection, or upload a photo instead.";
  if (/WebGL/i.test(m)) return "3D preview unavailable. This browser is not providing WebGL. You can still download the STL.";
  if (/Mesh invalid|STL invalid|STL count/i.test(m)) return "The 3D file could not be written. Try High quality, or a smaller picture.";
  if (/Read failed/i.test(m)) return "The picture could not be processed. Try another image.";
  return m || "Something went wrong. Try again, or upload a different picture.";
}

function bytes(n: number): string {
  if (n < 1024) return `${n}\u00a0B`;
  if (n < 1e6) return `${Math.round(n / 1024)}\u00a0KB`;
  return `${nf1.format(n / 1e6)}\u00a0MB`;
}

function trisLabel(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function stagesFor(busy: string, text = false): readonly string[] {
  if (!busy) return [];
  if (text && (TEXT_STAGES as readonly string[]).includes(busy)) return TEXT_STAGES;
  if (busy === "Generating image" || busy === "Drawing") return DRAW_STAGES;
  if (/STL|export|Validat|Download|height field|Relief/i.test(busy)) return EXPORT_STAGES;
  return BUILD_STAGES;
}

/** The start tiles: our own results, each loads a real example. */
const STARTS: { id: string; title: string; hint: string; img: string; file?: string; design?: string }[] = [
  { id: "photo", title: "Photo to relief", hint: "A carving photo, rebuilt in 3D", img: "/examples/ex-photo.webp", file: "/examples/carving.jpg" },
  { id: "name", title: "Name plaque", hint: "Exact Arabic, flower corners", img: "/examples/ex-name.webp", design: "name-plate" },
  { id: "pattern", title: "Star pattern", hint: "Allah in a 12-point star", img: "/examples/ex-pattern.webp", design: "allah-sunburst" },
  { id: "trace", title: "Trace a drawing", hint: "Sketch or logo to DXF / SVG", img: "/examples/ex-trace.webp", file: "/examples/logo.png" },
];

type Active = Exclude<Workflow, "depth">;
/** Which workspace mode each workflow route uses (Phase 0/1: the same workspace, pre-set). */
const MODE_OF: Record<Active, "photo" | "text"> = { image: "photo", trace: "photo", text: "text", names99: "text", pattern: "text" };

type Props = {
  /** The workflow route being shown, or null while the workspace is hidden behind another page. */
  workflow: Active | null;
  /** Bumped on every push / back / forward navigation. */
  navKey: number;
  /** ?example=photo|name|pattern|trace: load that example and build it */
  example: string | null;
  /** ?recent=<time>: open that recent design */
  recent: string | null;
};

export default function App({ workflow, navKey, example, recent }: Props) {
  const [prompt, setPrompt] = useState("Peacock on a teak panel, side view, deep carved feathers");
  const [pic, setPic] = useState("");
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [invert, setInvert] = useState(false);
  const [normalize, setNormalize] = useState(true);
  const [contrast, setContrast] = useState(1);
  const [smooth, setSmooth] = useState(0);
  const [clean, setClean] = useState(0.5);
  const [detail, setDetail] = useState(0.35);
  const [quality, setQuality] = useState<Quality>(readQuality);
  const [tint, setTint] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const [cutPass, setCutPass] = useState(0);
  // depth: undefined = not estimated yet (turned legs don't need it), null = model unavailable.
  const [raw, setRaw] = useState<{
    height: Float32Array;
    alpha: Float32Array | null;
    depth: Float32Array | null | undefined;
    cols: number;
    rows: number;
    invert: boolean;
    /** Which model made `depth`: the relief-trained one needs much less picture clean-up. */
    depthKind?: "relief" | "general";
    /** Text panels: the field is already the exact relief, so no depth / clean-up passes. */
    exact?: boolean;
  } | null>(null);
  // typed text-panel work survives a refresh (stored only in this browser)
  const stored = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const [material, setMaterial] = useState<MaterialId>(() => {
    const m = stored("carve.material");
    return MATERIALS.some((x) => x.id === m) ? (m as MaterialId) : "classic";
  });
  useEffect(() => {
    try {
      localStorage.setItem("carve.material", material);
    } catch {
      /* private mode */
    }
  }, [material]);
  const [mode, setMode] = useState<"photo" | "text">(() => (stored("carve.mode") === "text" ? "text" : "photo"));
  const [textSpec, setTextSpec] = useState<PanelSpec>(() => restoreSpec(stored("carve.textSpec.v1")));
  useEffect(() => {
    try {
      localStorage.setItem("carve.textSpec.v1", JSON.stringify(textSpec));
      localStorage.setItem("carve.mode", mode);
    } catch {
      /* private mode or full storage: nothing is remembered, nothing breaks */
    }
  }, [textSpec, mode]);
  /** The settings the current 3D relief was built from: downloads use these, not unbuilt edits. */
  const [builtSpec, setBuiltSpec] = useState<PanelSpec | null>(null);
  const [letterMm, setLetterMm] = useState(0);
  const [flatPic, setFlatPic] = useState(false);
  const lastImg = useRef<HTMLImageElement | null>(null);
  const [traceImg, setTraceImg] = useState<HTMLImageElement | null>(null);
  /** Background level (zero plane), 0 = off. Photo relief only. */
  const [zeroLevel, setZeroLevel] = useState(0);
  /** set by an example tile: build the text panel once the new spec is in state */
  const [buildSoon, setBuildSoon] = useState(false);
  /** bumped to open the Trace card */
  const [traceOpen, setTraceOpen] = useState(0);
  const [cutBg, setCutBg] = useState(true);
  const [board, setBoard] = useState({ widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 0 });
  const [wireframe, setWireframe] = useState(false);
  const [showBase, setShowBase] = useState(true);
  const [piece, setPiece] = useState<Piece>("panel");
  const [panelStep, setPanelStep] = useState<"image" | "size" | "relief" | "export">("image");
  const hadPicRef = useRef(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [legDia, setLegDia] = useState(50);
  const [turned, setTurned] = useState(true);
  const turnedOn = piece === "leg" && turned;
  const sizedFor = useRef("");
  const [view, setView] = useState<{ kind: "fit" | "front" | "top" | "side" | "persp"; n: number }>({ kind: "persp", n: 0 });
  const [warn, setWarn] = useState<{ mb: number; tris: number } | null>(null);
  const warnFirst = useRef<HTMLButtonElement>(null);
  const warnFrom = useRef<HTMLElement | null>(null);
  const closeWarn = () => {
    setWarn(null);
    warnFrom.current?.focus();
  };
  useEffect(() => {
    if (!warn) return;
    warnFrom.current = document.activeElement as HTMLElement | null;
    warnFirst.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeWarn();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [warn]);
  const goView = (kind: "fit" | "front" | "top" | "side" | "persp") => setView((v) => ({ kind, n: v.n + 1 }));
  const depth = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wellRef = useRef<HTMLElement>(null);
  const mobile = constrainedPreview();
  const shareOk = useMemo(() => canShareFile(), []);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(""), 6000);
    return () => window.clearTimeout(t);
  }, [note]);

  async function fromImage(src: string) {
    setBusy("Preparing image");
    const img = await loadImage(src);
    setFileMeta((m) => ({
      name: m?.name || "Picture",
      size: m?.size || 0,
      w: img.naturalWidth || img.width,
      h: img.naturalHeight || img.height,
    }));
    setBusy("Generating depth");
    await tick();
    const srcMax = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const cols = fieldCols(quality, srcMax);
    const next = await rasterFromImage(img, cols, invert);
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    let kind = piece;
    if (sizedFor.current !== src) {
      // New picture: work out what kind of piece it is and keep its proportions.
      sizedFor.current = src;
      kind = detectPiece(iw, ih);
      setPiece(kind);
      setImgSize({ w: iw, h: ih });
      setBoard((b) => ({ ...b, ...boardForPiece(kind, iw, ih) }));
    }
    lastImg.current = img;
    setTraceImg(img);
    {
      // a picture that is nearly one colour carves as a nearly flat board
      const h = next.height;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < h.length; i++) {
        sum += h[i] ?? 0;
        sq += (h[i] ?? 0) ** 2;
      }
      const mean = sum / h.length;
      setFlatPic(Math.sqrt(Math.max(0, sq / h.length - mean * mean)) < 0.02);
    }
    // A turned leg takes its shape from the outline, so the depth model is skipped
    // (it is estimated later only if the user switches turned mode off).
    const needDepth = !(kind === "leg" && turned);
    let dep: Float32Array | null | undefined;
    if (needDepth) {
      dep = await estimateDepth(img, iw, ih, next.cols, next.rows, (s) => setBusy(s));
      if (dep && invert) dep = dep.map((v) => 1 - v);
      if (!dep) setNote((n) => (n ? n + " " : "") + "Depth model unavailable: relief uses picture brightness only.");
    }
    setBusy("Building 3D relief");
    setRaw({ height: next.height, alpha: next.alpha, depth: dep, depthKind: dep ? activeDepthModel ?? "general" : undefined, cols: next.cols, rows: next.rows, invert });
    setCutPass((n) => n + 1);
    setView((v) => ({ kind: "persp", n: v.n + 1 }));
    setBusy("Preparing preview");
    await tick();
    setBusy("");
  }

  const [fieldOpts, setFieldOpts] = useState({ contrast, smooth, normalize, clean, detail });
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFieldOpts((prev) =>
        prev.contrast === contrast &&
        prev.smooth === smooth &&
        prev.normalize === normalize &&
        prev.clean === clean &&
        prev.detail === detail
          ? prev
          : { contrast, smooth, normalize, clean, detail },
      );
    }, 180);
    return () => window.clearTimeout(t);
  }, [contrast, smooth, normalize, clean, detail]);

  const refined = useMemo(() => {
    if (!raw) return null;
    if (raw.exact) return raw.height;
    const h = composeRelief(
      { luma: raw.height, alpha: raw.alpha, depth: raw.depth ?? null, cols: raw.cols, rows: raw.rows },
      {
        smooth: fieldOpts.smooth,
        clean: fieldOpts.clean,
        detail: fieldOpts.detail,
        turned: turnedOn,
        cutBackground: cutBg ? "auto" : false,
        depthKind: raw.depthKind,
      },
    );
    // A turned leg keeps its background at exactly 0, so contrast is not applied to it.
    return turnedOn ? h : zeroPlane(applyContrast(h, fieldOpts.contrast), zeroLevel);
  }, [raw, fieldOpts, turnedOn, cutBg, zeroLevel]);

  // Turned mode switched off (or piece changed) on a picture whose depth was skipped: estimate it now.
  useEffect(() => {
    if (!raw || raw.depth !== undefined || turnedOn || !lastImg.current) return;
    let live = true;
    const img = lastImg.current;
    const r = raw;
    void (async () => {
      setBusy("Generating depth");
      let dep = await estimateDepth(img, img.naturalWidth || img.width, img.naturalHeight || img.height, r.cols, r.rows, (s) => setBusy(s));
      if (dep && r.invert) dep = dep.map((v) => 1 - v);
      if (!dep) setNote("Depth model unavailable: relief uses picture brightness only.");
      if (live) setRaw((cur) => (cur === r ? { ...r, depth: dep ?? null, depthKind: dep ? activeDepthModel ?? "general" : undefined } : cur));
      setBusy("");
    })();
    return () => {
      live = false;
    };
  }, [raw, turnedOn]);

  // Turned mode needs the leg's outline: warn when the background is too busy to find it.
  const legOutlineMissing = useMemo(
    () => !!raw && turnedOn && !silhouette(raw.height, raw.cols, raw.rows, raw.alpha),
    [raw, turnedOn],
  );
  useEffect(() => {
    if (legOutlineMissing)
      setNote("Couldn't find the leg's outline. Use a plain or transparent background, or switch Turned off.");
  }, [legOutlineMissing]);

  const [meshBoard, setMeshBoard] = useState(board);
  useEffect(() => {
    const t = window.setTimeout(() => setMeshBoard(board), 180);
    return () => window.clearTimeout(t);
  }, [board]);

  const meshRef = useRef<ReliefMesh | null>(null);
  const [rev, setRev] = useState(0);
  const [verdict, setVerdict] = useState<MeshReport | null>(null);
  const mesh = rev > 0 ? meshRef.current : null;

  useEffect(() => {
    if (!raw || !refined) {
      meshRef.current = null;
      setVerdict(null);
      setRev((n) => n + 1);
      return;
    }
    const prev = meshRef.current;
    let built: ReliefMesh;
    if (
      prev &&
      prev.meta.cols === raw.cols &&
      prev.meta.rows === raw.rows &&
      isSurfaceOnly(prev.meta.baseMm) === isSurfaceOnly(meshBoard.baseMm)
    ) {
      restampRelief(prev, refined, meshBoard);
      built = prev;
    } else {
      built = buildRelief(refined, raw.cols, raw.rows, meshBoard);
      meshRef.current = built;
    }
    setVerdict(built.meta.triangleCount > FULL_TOPOLOGY_TRIS ? validateMeshQuick(built) : validateMesh(built));
    setRev((n) => n + 1);
  }, [raw, refined, meshBoard]);

  const meshLag =
    meshBoard.widthMm !== board.widthMm ||
    meshBoard.heightMm !== board.heightMm ||
    meshBoard.depthMm !== board.depthMm ||
    meshBoard.baseMm !== board.baseMm ||
    fieldOpts.contrast !== contrast ||
    fieldOpts.smooth !== smooth ||
    fieldOpts.normalize !== normalize ||
    fieldOpts.clean !== clean ||
    fieldOpts.detail !== detail;

  async function generate() {
    setErr("");
    setNote("");
    setBusy("Generating image");
    try {
      const text = prompt.trim() + BIAS;
      const seed = Date.now() % 99999;
      const urls = [
        `/api/imagine?prompt=${encodeURIComponent(text)}&seed=${seed}`,
        `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?width=768&height=768&nologo=true&seed=${seed}`,
      ];
      let blob: Blob | null = null;
      let last = "Generate failed";
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("Image host said " + res.status);
          const next = await res.blob();
          if (!next.type.startsWith("image/")) throw new Error("That was not a picture");
          blob = next;
          break;
        } catch (e) {
          last = e instanceof Error ? e.message : last;
        }
      }
      if (!blob) throw new Error(last);
      const url = URL.createObjectURL(blob);
      if (pic.startsWith("blob:")) URL.revokeObjectURL(pic);
      setPic(url);
      setFileMeta({ name: "Generated image", size: blob.size, w: 0, h: 0 });
      await fromImage(url);
    } catch (e) {
      setRaw(null);
      setErr(sayErr(e));
      setBusy("");
    }
  }

  async function onFile(file: File) {
    setErr("");
    setNote("");
    const url = URL.createObjectURL(file);
    if (pic.startsWith("blob:")) URL.revokeObjectURL(pic);
    setPic(url);
    setFileMeta({ name: file.name, size: file.size, w: 0, h: 0 });
    try {
      await fromImage(url);
    } catch (e) {
      setRaw(null);
      setErr(sayErr(e));
      setBusy("");
    }
  }

  function clearPic() {
    if (pic.startsWith("blob:")) URL.revokeObjectURL(pic);
    sizedFor.current = "";
    setImgSize(null);
    setPiece("panel");
    setPic("");
    setRaw(null);
    setFlatPic(false);
    setFileMeta(null);
    setWarn(null);
    setErr("");
    setNote("");
    setBusy("");
  }

  useEffect(() => {
    if (!pic) return;
    fromImage(pic).catch((e) => {
      setRaw(null);
      setErr(sayErr(e));
      setBusy("");
    });
    // invert and quality rebuild the raster. Strength and size stay on the same field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invert, quality]);

  useEffect(() => {
    const canvas = depth.current;
    if (!canvas || !refined || !raw) return;
    canvas.width = raw.cols;
    canvas.height = raw.rows;
    canvas.getContext("2d")?.putImageData(heightToImageData(refined, raw.cols, raw.rows), 0, 0);
  }, [refined, raw]);

  const ready = !!mesh;
  /** nothing uploaded or built yet: show only what is needed to start (examples, upload, mode) */
  const empty = !pic && !raw;
  const exportTris = raw ? triangleEstimate(raw.cols, raw.rows, isSurfaceOnly(board.baseMm)) : 0;
  const exportMb = raw ? stlBytesEstimate(exportTris) / 1e6 : 0;
  const thickMm = board.depthMm + board.baseMm;

  async function saveStl() {
    if (!mesh || !refined || !raw) return;
    setErr("");
    setNote("");
    setWarn(null);
    let out: ReturnType<typeof buildRelief> | null = null;
    try {
      setBusy("Preparing height field");
      await tick();
      setBusy("Building export mesh");
      await tick();
      out = mesh;
      if (out.meta.cols !== raw.cols || out.meta.rows !== raw.rows) {
        throw new Error("Export mesh does not match the preview");
      }
      setBusy("Validating");
      await tick();
      const meshR = out.meta.triangleCount > FULL_TOPOLOGY_TRIS ? validateMeshQuick(out) : validateMesh(out);
      if (!meshR.ok) throw new Error(meshR.errors[0] || "Mesh invalid");
      setBusy("Writing STL");
      await tick();
      const buf = await writeStlAsync(out, 48_000, async () => {
        setBusy("Writing STL");
        await tick();
      });
      setBusy("Validating");
      await tick();
      const expected = out.meta.triangleCount;
      const stlR =
        expected > FULL_TOPOLOGY_TRIS
          ? validateStl(buf, undefined, { surfaceOnly: isSurfaceOnly(mesh.meta.baseMm) })
          : validateStl(buf, out);
      if (stlR.triangles !== expected) throw new Error("STL count != mesh");
      if (!stlR.ok) throw new Error(stlR.errors[0] || "STL invalid");
      out = null;
      setBusy("Preparing download");
      await tick();
      const { stl } = artcamNames(exportSource(), board.widthMm, board.heightMm, board.depthMm, board.baseMm);
      const blob = new Blob([buf], { type: "model/stl" });
      setBusy("Download ready");
      const how = await saveFile(stl, blob, "model/stl");
      setNote(
        how === "shared"
          ? `STL shared · ${board.widthMm} × ${board.heightMm} × ${thickMm} mm`
          : `STL downloaded · ${board.widthMm} × ${board.heightMm} × ${thickMm} mm`,
      );
    } catch (e) {
      setErr(sayErr(e));
    } finally {
      out = null;
      setBusy("");
    }
  }

  function requestStl() {
    if (!raw) return;
    if (meshLag) return;
    if (verdict && !verdict.ok) {
      setErr(verdict.errors[0] || "This relief did not pass the solid check, so the STL was not saved.");
      return;
    }
    const tris = triangleEstimate(raw.cols, raw.rows, isSurfaceOnly(board.baseMm));
    const mb = stlBytesEstimate(tris) / 1e6;
    if (mb >= 80) {
      setWarn({ mb, tris });
      return;
    }
    void saveStl();
  }

  async function saveArtcam() {
    if (!raw) return;
    setErr("");
    setNote("");
    setBusy("Relief");
    try {
      const h = refined ?? raw.height;
      const c = raw.cols;
      const r = raw.rows;
      const { bmp } = artcamNames(exportSource(), board.widthMm, board.heightMm, board.depthMm, board.baseMm);
      await saveFile(bmp, new Blob([reliefBmp(h, c, r, board.widthMm, board.heightMm) as BlobPart], { type: "image/bmp" }), "image/bmp");
      setNote("Height map downloaded. Use this if ArtCAM asks to open an image.");
    } catch (e) {
      setErr(sayErr(e));
    } finally {
      setBusy("");
    }
  }

  /** Width and height stay in the picture's proportions, so a design is never squashed. */
  function setSide(key: "widthMm" | "heightMm", rawVal: string) {
    const n = Number(rawVal);
    if (!Number.isFinite(n) || n <= 0) return;
    if (!imgSize) return setNum(key, rawVal);
    const r = imgSize.h / imgSize.w;
    const round = (v: number) => Math.max(1, Math.round(v * 2) / 2);
    setBoard((b) =>
      key === "widthMm" ? { ...b, widthMm: n, heightMm: round(n * r) } : { ...b, heightMm: n, widthMm: round(n / r) },
    );
  }

  function choosePiece(p: Piece) {
    setPiece(p);
    if (imgSize) setBoard((b) => ({ ...b, ...boardForPiece(p, imgSize.w, imgSize.h) }));
  }

  function setNum(key: keyof typeof board, rawVal: string) {
    const n = Number(rawVal);
    if (!Number.isFinite(n) || n < 0 || (n === 0 && key !== "baseMm")) return;
    setBoard((b) => ({ ...b, [key]: n }));
  }

  function pickFile() {
    fileRef.current?.click();
  }

  function exportSource() {
    if (raw?.exact) return textSpec.template === "names99" ? "99-names-panel" : "text-panel";
    const n = fileMeta?.name || "";
    if (n && !/^generated image$/i.test(n)) return n;
    return prompt;
  }

  function newProject() {
    clearPic();
    setMode("photo");
    setTextSpec(DEFAULT_SPEC);
    setLetterMm(0);
    setBoard({ widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 0 });
    setContrast(1);
    setClean(0.5);
    setDetail(0.35);
    setSmooth(0);
    setInvert(false);
    setNormalize(true);
    setQuality(readQuality());
  }

  /** Photo relief ↔ text panel. The other mode's 3D result is cleared; a loaded photo is kept for coming back. */
  const photoBoard = useRef<typeof board | null>(null);
  function switchMode(m: "photo" | "text") {
    if (m === mode) return;
    setErr("");
    if (m === "text") photoBoard.current = board;
    else if (photoBoard.current) setBoard(photoBoard.current);
    setMode(m);
    if (raw && (m === "photo") === !!raw.exact) setRaw(null);
  }

  /** Typeset the panel and build the exact relief at `longSide` samples on the long edge. */
  async function textField(longSide: number, spec: PanelSpec = textSpec) {
    const lay = layoutPanel(spec);
    const { cols, rows } = gridFor(spec.widthMm, spec.heightMm, longSide);
    const { masks, ops } = await rasterPanel(lay, cols, rows);
    const out = composePanel(lay, masks, cols, rows, spec.style, spec.letterMm);
    const sizes = ops.filter((o) => o.role === "text").map((o) => o.inkMm ?? o.sizeMm * 0.75).sort((a, b) => a - b);
    const letterMm = sizes.length ? sizes[Math.floor(sizes.length / 2)]! : 0;
    return { ...out, cols, rows, letterMm };
  }

  /**
   * After a build, bring the 3D result into view (on phones the settings sit below it).
   * Polls the page instead of hooking React renders: the 3D preview re-renders an
   * unpredictable number of times, and its mounting can cut a smooth scroll short.
   */
  function revealResult() {
    const started = performance.now();
    const inView = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.top >= -2 && r.top < window.innerHeight * 0.5;
    };
    // the moment the person scrolls or touches, stop: never fight the user
    let userMoved = false;
    const stop = () => (userMoved = true);
    const opts = { passive: true, once: true } as const;
    let glidedAt = 0;
    const step = () => {
      const now = performance.now();
      if (userMoved || now - started > 8000) return cleanup();
      const el = document.querySelector(".result-bar");
      if (!el || document.querySelector(".veil")) return void window.setTimeout(step, 120);
      if (!glidedAt) {
        glidedAt = now;
        window.addEventListener("wheel", stop, opts);
        window.addEventListener("touchstart", stop, opts);
        window.addEventListener("keydown", stop, opts);
        // an instant jump: a smooth scroll needs animation frames, and a busy 3D preview can starve them
        if (!inView(el)) el.scrollIntoView({ behavior: "auto", block: "start" });
        return void window.setTimeout(step, 700);
      }
      // layout changes (3D canvas mounting, scroll anchoring) can pull the page away: settle it for ~2 s
      if (!inView(el)) el.scrollIntoView({ behavior: "auto", block: "start" });
      if (now - glidedAt < 2100) return void window.setTimeout(step, 350);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
    window.setTimeout(step, 120);
  }

  /** Start tiles: load a real example so a first visit shows a finished carving in seconds. */
  async function tryPicture(path: string, name: string, thenTrace = false) {
    try {
      const blob = await (await fetch(path)).blob();
      if (mode !== "photo") switchMode("photo");
      await onFile(new File([blob], name, { type: blob.type || "image/png" }));
      if (thenTrace) setTraceOpen((n) => n + 1);
    } catch {
      setErr("The example could not be loaded. Check your connection and try again.");
    }
  }
  function tryDesign(id: string) {
    const d = designById(id);
    let spec = d ? applyDesign(d, null, textSpec) : null;
    if (!spec || !d) return;
    // a name design leaves the name to the customer: the example uses a vetted phrase, never typed Arabic
    if (d.ask === "name") spec = { ...spec, lines: [resolveSrc({ phrase: "Muhammad" }, null) ?? ""] };
    switchMode("text");
    setTextSpec(spec);
    setBuildSoon(true);
  }
  useEffect(() => {
    if (buildSoon && mode === "text" && !busy) {
      setBuildSoon(false);
      void buildText();
    }
    // buildText reads the spec that is now in state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildSoon, mode, textSpec, busy]);

  /* ---- routes: the URL picks the workflow; the workflow follows the URL (UX_REBUILD Phase 0/1) ---- */
  const wfRef = useRef<Active>(workflow ?? (mode === "text" ? "text" : "image"));
  if (workflow) wfRef.current = workflow;
  const applied = useRef("");
  const lastMode = useRef(mode);
  /** the mode an entry asked for: until it lands, the URL is not moved (both effects see the old mode first) */
  const pendingMode = useRef<"photo" | "text" | null>(null);
  useEffect(() => {
    if (!workflow) return;
    document.title = `${WORKFLOW_TITLE[workflow]} · AI Carve`;
    // once per navigation (StrictMode runs effects twice in development)
    const sig = `${navKey}|${workflow}|${example ?? ""}|${recent ?? ""}`;
    if (applied.current === sig) return;
    applied.current = sig;
    const path = WORKFLOW_PATH[workflow];
    const want = MODE_OF[workflow];
    if (want !== mode) {
      pendingMode.current = want;
      switchMode(want);
    }
    const ex = STARTS.find((t) => t.id === (example as ExampleId | null));
    if (ex) {
      navigate(path, { replace: true }); // a refresh must not run the example again
      if (busy) return;
      if (ex.design) tryDesign(ex.design);
      else void tryPicture(ex.file!, ex.file!.split("/").pop()!, ex.id === "trace");
      return;
    }
    if (recent) {
      navigate(path, { replace: true });
      let hit: PanelSpec | undefined;
      try {
        hit = parseRecent(localStorage.getItem(RECENT_KEY)).find((r) => String(r.at) === recent)?.spec;
      } catch {
        /* private mode */
      }
      if (hit && !busy) {
        setTextSpec(hit);
        setBuildSoon(true);
      }
      return;
    }
    // a workflow route opened without an example keeps the work in progress, unless it is the wrong kind
    if (workflow === "names99" && textSpec.template !== "names99") {
      const d = designById("names99");
      const spec = d ? applyDesign(d, null, textSpec) : null;
      if (spec) setTextSpec(spec);
    } else if (workflow === "pattern" && textSpec.template !== "pattern") {
      const d = designById("star-cross");
      const spec = d ? applyDesign(d, null, textSpec) : null;
      if (spec) setTextSpec(spec);
    } else if (workflow === "trace" && lastImg.current) {
      setTraceOpen((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow, navKey, example, recent]);
  // the workspace's own mode switch moves the URL along (replace: no extra history entries)
  useEffect(() => {
    if (pendingMode.current) {
      if (mode === pendingMode.current) pendingMode.current = null;
      lastMode.current = mode;
      return;
    }
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    if (!workflow || MODE_OF[workflow] === mode) return;
    navigate(mode === "text" ? WORKFLOW_PATH.text : WORKFLOW_PATH.image, { replace: true });
  }, [mode, workflow]);
  // a newly added picture moves the side menu to Size; removing it returns to Image (steps stay jumpable)
  useEffect(() => {
    if (pic && !hadPicRef.current && wfRef.current !== "trace") setPanelStep("size");
    if (!pic) setPanelStep("image");
    hadPicRef.current = !!pic;
  }, [pic]);
  // Trace workflow: a newly loaded drawing opens the Trace card
  useEffect(() => {
    if (traceImg && wfRef.current === "trace") setTraceOpen((n) => n + 1);
  }, [traceImg]);
  // Settings changed on another page (the workspace stays mounted)
  useEffect(() => {
    const onPrefs = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== "carve.material") return;
      const m = stored("carve.material");
      if (MATERIALS.some((x) => x.id === m)) setMaterial(m as MaterialId);
    };
    window.addEventListener(PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_EVENT, onPrefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function buildText() {
    setErr("");
    setNote("");
    setBusy("Typesetting");
    try {
      await tick();
      if (missingText(textSpec)) throw new Error("Type some text first.");
      const bad = sizeProblem(textSpec);
      if (bad) throw new Error(bad);
      const f = await textField(mobile ? 1024 : QUALITY.ultra.field);
      setBusy("Building 3D relief");
      await tick();
      setBoard({ widthMm: textSpec.widthMm, heightMm: textSpec.heightMm, depthMm: f.depthMm, baseMm: 0 });
      setRaw({ height: f.h, alpha: null, depth: null, cols: f.cols, rows: f.rows, invert: false, exact: true });
      setBuiltSpec(textSpec);
      try {
        // remembered in this browser only, for repeat orders (Recent tab in the design picker)
        localStorage.setItem(RECENT_KEY, JSON.stringify(addRecent(parseRecent(localStorage.getItem(RECENT_KEY)), textSpec, Date.now())));
      } catch {
        /* private mode or full storage: nothing to remember */
      }
      revealResult();
      setLetterMm(f.letterMm);
      setCutPass((n) => n + 1);
      setView((v) => ({ kind: "persp", n: v.n + 1 }));
      setBusy("Preparing preview");
      await tick();
    } catch (e) {
      setErr(sayErr(e));
    } finally {
      setBusy("");
    }
  }

  async function saveTextRelief(kind: "rlf" | "tif") {
    setErr("");
    setNote("");
    setBusy("Relief");
    const spec = builtSpec ?? textSpec;
    try {
      await tick();
      const long = Math.min(4096, Math.round(Math.max(spec.widthMm, spec.heightMm) / 0.25));
      const f = await textField(long, spec);
      const depth = board.depthMm; // same depth as the preview and the STL, so every file name agrees
      const stem = artcamNames(exportSource(), spec.widthMm, spec.heightMm, depth, 0).bmp.replace(/\.bmp$/, "");
      if (kind === "rlf") {
        const bytes = reliefRlf(f.h, f.cols, f.rows, spec.widthMm, spec.heightMm, depth);
        await saveFile(`${stem}.rlf`, new Blob([bytes as BlobPart], { type: "application/octet-stream" }), "application/octet-stream");
        setNote(`ArtCAM relief downloaded · ${f.cols} × ${f.rows} · ${depth} mm`);
      } else {
        const bytes = reliefTif(f.h, f.cols, f.rows, spec.widthMm, spec.heightMm);
        await saveFile(`${stem}.tif`, new Blob([bytes as BlobPart], { type: "image/tiff" }), "image/tiff");
        setNote(`16-bit TIFF downloaded · set the relief height to ${depth} mm in ArtCAM`);
      }
    } catch (e) {
      setErr(sayErr(e));
    } finally {
      setBusy("");
    }
  }

  async function saveOutline() {
    setErr("");
    try {
      const ps = builtSpec ?? textSpec;
      const shape = ps.template === "plate" || ps.template === "pattern" ? ps.shape : "rect";
      const stem = artcamNames(exportSource(), ps.widthMm, ps.heightMm, board.depthMm, 0).bmp.replace(/\.bmp$/, "");
      const dxf = outlineDxf(shape, ps.widthMm, ps.heightMm);
      await saveFile(`${stem}-outline.dxf`, new Blob([dxf], { type: "application/dxf" }), "application/dxf");
      setNote(`Cut outline downloaded · ${ps.widthMm} × ${ps.heightMm} mm · use it for the profile cut`);
    } catch (e) {
      setErr(sayErr(e));
    }
  }

  /** Letter outlines, pattern centre lines and the cut outline as vectors, for V-carve toolpaths. */
  async function saveVectors(fmt: "dxf" | "svg") {
    setErr("");
    try {
      setBusy("Tracing letters");
      const ps = builtSpec ?? textSpec;
      const lay = layoutPanel(ps);
      const W = ps.widthMm;
      const H = ps.heightMm;
      // about 0.1 mm per pixel, capped so phones keep enough memory
      const { cols, rows } = gridFor(W, H, Math.min(2800, Math.ceil(Math.max(W, H) / 0.1)));
      const { masks } = await rasterPanel(lay, cols, rows);
      const ink = new Float32Array(cols * rows);
      for (let i = 0; i < ink.length; i++) ink[i] = Math.max(masks.text[i] ?? 0, masks.header[i] ?? 0);
      const letters = letterOutlines(ink, cols, rows, W);
      const layers: VectorLayer[] = [{ name: "LETTERS", color: 7, closed: true, paths: letters }];
      if (lay.pattern) {
        const med = lay.medallion;
        const clear = (x: number, y: number) =>
          (!med || Math.hypot(x - med.cx, y - med.cy) > med.r) && !lay.pockets.some((q) => Math.hypot(x - q.cx, y - q.cy) < q.r);
        const segs = lay.pattern.segs.filter(([[ax, ay], [bx, by]]) => clear((ax + bx) / 2, (ay + by) / 2));
        layers.push({ name: "PATTERN", color: 5, closed: false, paths: segs.map(([a, b]) => [a, b]) });
      }
      const shape = ps.template === "plate" || ps.template === "pattern" ? ps.shape : "rect";
      layers.push({ name: "CUT_OUTLINE", color: 1, closed: true, paths: [shapeContour(shape, W, H, 0, 360).slice(0, -1)] });
      const stem = artcamNames(exportSource(), W, H, board.depthMm, 0).bmp.replace(/\.bmp$/, "");
      if (fmt === "dxf") await saveFile(`${stem}-vectors.dxf`, new Blob([vectorsDxf(layers, W, H)], { type: "application/dxf" }), "application/dxf");
      else await saveFile(`${stem}-vectors.svg`, new Blob([vectorsSvg(layers, W, H)], { type: "image/svg+xml" }), "image/svg+xml");
      const parts = [`${letters.length} letter outlines`, lay.pattern ? "pattern lines" : "", "cut outline"].filter(Boolean).join(", ");
      setNote(`Vectors downloaded (${fmt.toUpperCase()}) · ${parts}, in mm on separate layers`);
    } catch (e) {
      setErr(sayErr(e));
    } finally {
      setBusy("");
    }
  }

  async function saveProof() {
    setErr("");
    try {
      setBusy("Typesetting");
      const ps = builtSpec ?? textSpec;
      const blob = await proofPng(layoutPanel(ps));
      await saveFile(`${ps.template === "names99" ? "99-names-panel" : "text-panel"}-${ps.widthMm}x${ps.heightMm}-proof.png`, blob, "image/png");
      setNote("Proof image downloaded. Check every word before carving.");
    } catch (e) {
      setErr(sayErr(e));
    } finally {
      setBusy("");
    }
  }

  async function regenerate() {
    if (mode === "text") return buildText();
    if (!pic) return;
    setErr("");
    setNote("");
    try {
      await fromImage(pic);
    } catch (e) {
      setErr(sayErr(e));
      setBusy("");
    }
  }

  const step = !pic && !raw ? "source" : busy && !ready ? "generate" : /STL|shared|downloaded/i.test(note) ? "export" : ready ? "relief" : "generate";

  async function toggleFull() {
    const el = wellRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      setErr("This browser would not open a fullscreen preview.");
    }
  }

  const reliefKind = RELIEF.find((r) => r.depth === board.depthMm)?.id ?? "custom";
  const stageList = stagesFor(busy, mode === "text");
  const exportLabel = shareOk ? "Share / Save STL" : "Download STL";
  const stageI = stageList.indexOf(busy === "Download ready" ? "Preparing download" : busy);

  return (
    <div className="app">
      <a className="skip" href="#workspace">Skip to workspace</a>
      <input
        ref={fileRef}
        hidden
        type="file"
        name="source_image"
        autoComplete="off"
        accept="image/jpeg,image/png,image/webp,image/bmp,image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />

      <header className="bar">
        <Link className="ws-back" to="/create" aria-label="Back to Create">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <Brand />
        <h1 className="ws-title">{WORKFLOW_TITLE[workflow ?? wfRef.current]}</h1>
        <TopNav at="create" />
        <div className="top-actions">
          <div className={"status" + (busy ? " run" : ready ? "" : " idle")} aria-live="polite">
            <i />
            {busy ? `${busy}…` : ready ? "Ready" : mode === "text" ? "Build a text panel" : "Add a picture"}
          </div>
          {ready ? (
            <button type="button" className="btn pri hide-phone" disabled={!!busy || meshLag || verdict?.ok === false} onClick={() => requestStl()}>
              {exportLabel}
            </button>
          ) : null}
        </div>
      </header>

      {mode === "text" ? (
      <nav className="path" aria-label="Workflow">
        <b className={step === "source" ? "now" : pic ? "did" : ""}>Source</b>
        <span aria-hidden="true">→</span>
        <b className={step === "generate" ? "now" : ready ? "did" : ""}>Generate</b>
        <span aria-hidden="true">→</span>
        <b className={step === "relief" ? "now" : step === "export" ? "did" : ""}>3D relief</b>
        <span aria-hidden="true">→</span>
        <b className={step === "export" ? "now" : ""}>Export</b>
      </nav>
      ) : null}

      <main id="workspace" className={"work" + (mode === "photo" ? " stepped" : "")}>
        {mode === "photo" ? (
          <nav className="ws-steps" aria-label="Steps">
            {(
              [
                ["image", "Image", !!pic],
                ["size", "Size", !!pic],
                ["relief", "Relief", ready],
                ["export", "Export", false],
              ] as const
            ).map(([id, label, done]) => (
              <button
                key={id}
                type="button"
                aria-current={panelStep === id ? "step" : undefined}
                className={panelStep === id ? "now" : done ? "did" : ""}
                onClick={() => setPanelStep(id)}
              >
                {label}
                {done ? <i aria-hidden="true">✓</i> : null}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="stage">
        {ready && !busy ? (
          <div className="result-bar">
            <div>
              <h2 className="result">Your 3D relief is ready</h2>
              <p className="meta nums">
                {QUALITY[quality].label} · {board.widthMm} × {board.heightMm} mm · {board.depthMm} mm relief
                {exportMb ? ` · ~${exportMb < 1 ? `${Math.round(exportMb * 1000)}\u00a0KB` : `${nf1.format(exportMb)}\u00a0MB`}` : ""}
                <button type="button" className="linkish phone-only" disabled={!!busy} onClick={() => void regenerate()}>
                  Regenerate
                </button>
                <button type="button" className="linkish phone-only" disabled={!!busy} onClick={newProject}>
                  New project
                </button>
              </p>
            </div>
            <div className="result-acts">
              <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void regenerate()}>
                Regenerate
              </button>
              <button type="button" className="btn ghost" disabled={!!busy} onClick={newProject}>
                New project
              </button>
            </div>
          </div>
        ) : pic && mode === "photo" && !ready && !busy ? (
          <p className="result">Ready to generate your relief.</p>
        ) : null}
        <section
          ref={wellRef}
          className="well"
          aria-label={mesh ? "3D relief" : "Upload an image"}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void onFile(f);
          }}
        >
          {mesh ? (
            <Suspense fallback={<div className="gl ph">Loading 3D preview…</div>}>
              <ReliefPreview key={cutPass} source={meshRef} rev={rev} wireframe={wireframe} showBase={showBase} tint={tint} view={view.kind} viewTick={view.n} material={material} />
            </Suspense>
          ) : pic && mode === "photo" ? (
            <div className="drop">
              <div>
                <h2>{err ? "Unable to process this image" : "Ready to generate your relief"}</h2>
                <p>
                  {err
                    ? "Try JPG, PNG, WebP, or BMP. You can replace the source image and try again."
                    : "Carve will build a 3D relief from the source image."}
                </p>
                <button type="button" className="btn pri" onClick={() => void regenerate()} disabled={!!busy}>
                  Generate 3D model
                </button>
              </div>
            </div>
          ) : (
            <div className={"drop" + (over ? " on" : "")}>
              <div>
                {mode === "text" ? (
                  <>
                    <h2>Text panel</h2>
                    <p>Choose a template and type your text in the Text panel card, then build. Lettering is typeset exactly, no AI guessing.</p>
                    <button type="button" className="btn pri" onClick={() => void buildText()} disabled={!!busy}>
                      Build text panel
                    </button>
                    <p className="hint">
                      <button type="button" className="linkish" onClick={() => switchMode("photo")}>
                        Back to photo relief
                      </button>
                    </p>
                  </>
                ) : (
                  <>
                    <h2>Create your 3D relief</h2>
                    <p>Start from a picture, or type a name, a verse or the 99 Names. Or tap an example to see it carved.</p>
                    <ul className="starts" aria-label="Examples">
                      {STARTS.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            className="start"
                            disabled={!!busy}
                            onClick={() => (t.design ? tryDesign(t.design) : void tryPicture(t.file!, t.file!.split("/").pop()!, t.id === "trace"))}
                          >
                            <img src={t.img} alt="" width={480} height={300} loading="lazy" decoding="async" />
                            <span className="start-title">{t.title}</span>
                            <span className="start-hint">{t.hint}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="choice">
                      <button type="button" className="btn pri" onClick={pickFile} disabled={!!busy}>
                        Upload image
                      </button>
                      <button type="button" className="btn on-dark" onClick={() => switchMode("text")} disabled={!!busy}>
                        Make a text panel
                      </button>
                    </div>
                    <p className="hint">Photos: JPG, PNG, WebP, or BMP — drag and drop works too. Text panels: names, Quran verses, the 99 Names.</p>
                  </>
                )}
              </div>
            </div>
          )}

          {mesh ? <p className="well-hint">Drag to turn · pinch to zoom</p> : null}

          {mesh ? (
            <div className="info nums">
              <b>
                {board.widthMm} × {board.heightMm} × {thickMm}&nbsp;mm
              </b>
            </div>
          ) : null}

          {busy ? (
            <div className="veil" role="status" aria-live="polite">
              <div>
                <strong>{busy}…</strong>
                <ol className="stages">
                  {stageList.map((s, j) => {
                    const cls = j === stageI ? "on" : j < stageI ? "did" : "";
                    const mark = j < stageI ? "✓" : j === stageI ? "●" : "○";
                    return (
                      <li key={s} className={cls}>
                        {mark} {s}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          ) : null}
        </section>

        {mesh ? (
          <div className="hud" role="toolbar" aria-label="3D views">
            <p className="hint-turn">Drag to orbit · pinch or scroll to zoom</p>
            <button type="button" className="chip" aria-pressed={view.kind === "persp"} onClick={() => goView("persp")}>
              Perspective
            </button>
            <button type="button" className="chip" aria-pressed={view.kind === "top"} onClick={() => goView("top")}>
              Top
            </button>
            <button type="button" className="chip" aria-pressed={view.kind === "front"} onClick={() => goView("front")}>
              Front
            </button>
            <button type="button" className="chip" aria-pressed={view.kind === "side"} onClick={() => goView("side")}>
              Side
            </button>
            <button type="button" className="chip" onClick={() => goView("fit")}>
              Fit
            </button>
            <button type="button" className="chip" onClick={() => goView("persp")}>
              Reset
            </button>
            <button type="button" className="chip" aria-pressed={wireframe} onClick={() => setWireframe((v) => !v)}>
              Wireframe
            </button>
            <button type="button" className="chip" aria-pressed={showBase} onClick={() => setShowBase((v) => !v)}>
              Base
            </button>
            <button type="button" className="chip" aria-pressed={tint} onClick={() => setTint((v) => !v)}>
              Tint
            </button>
            <button type="button" className="chip" onClick={() => void toggleFull()}>
              Fullscreen
            </button>
            <label className="chip chip-select">
              <span className="sr-only">Material</span>
              <select name="material" value={material} onChange={(e) => setMaterial(e.target.value as MaterialId)} aria-label="Preview material">
                {MATERIALS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === "classic" ? "Material: height tint" : `Material: ${m.label}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        </div>

        <aside className="rail">
          <div className="card mode-card">
            <div className="seg two" role="group" aria-label="What to make">
              <button type="button" aria-pressed={mode === "photo"} onClick={() => switchMode("photo")} disabled={!!busy}>
                <strong>Photo relief</strong>
                <span>From a picture</span>
              </button>
              <button type="button" aria-pressed={mode === "text"} onClick={() => switchMode("text")} disabled={!!busy}>
                <strong>Text panel</strong>
                <span>Names, verses, plates</span>
              </button>
            </div>
          </div>
        {pic && mode === "photo" ? (
          <aside className="source card" hidden={panelStep !== "image"} aria-label="Source image">
            <h2>Source image</h2>
            <figure>
              <img src={pic} alt={fileMeta?.name || "Design to carve"} width={fileMeta?.w || 512} height={fileMeta?.h || 512} />
              <figcaption>
                <p className="source-name">{fileMeta?.name || "Picture"}</p>
                <p className="meta nums">
                  {fileMeta?.size ? bytes(fileMeta.size) : ""}
                  {fileMeta?.w ? `${fileMeta.size ? " · " : ""}${fileMeta.w} × ${fileMeta.h} px` : ""}
                </p>
                {flatPic ? (
                  <p className="meta warn" role="note">
                    This picture is almost one flat colour, so the relief will be nearly flat. Use a picture with clear light and dark areas.
                  </p>
                ) : null}
                {fileMeta?.w && Math.max(fileMeta.w, fileMeta.h) < 500 ? (
                  <p className="meta warn" role="note">
                    Small picture, so the carving will look soft. Use one at least 800&nbsp;px wide for sharp detail.
                  </p>
                ) : null}
              </figcaption>
            </figure>
            <div className="actions two">
              <button type="button" className="btn ghost" onClick={pickFile} disabled={!!busy}>
                Replace
              </button>
              <button type="button" className="btn ghost" onClick={clearPic} disabled={!!busy}>
                Remove
              </button>
            </div>
            <canvas ref={depth} hidden />
          </aside>
        ) : null}
          {mode === "text" ? (
            <TextPanelCard
              spec={textSpec}
              setSpec={setTextSpec}
              busy={!!busy}
              built={!!raw?.exact}
              stale={!!raw?.exact && !!builtSpec && JSON.stringify(builtSpec) !== JSON.stringify(textSpec)}
              letterMm={raw?.exact ? letterMm : 0}
              onBuild={() => void buildText()}
            />
          ) : null}
          {mode === "photo" && !empty ? (
            <>
          <div className="card" hidden={panelStep !== "size"}>
            <h3>Piece</h3>
            <div className="seg" role="group" aria-label="Kind of piece">
              {PIECES.map((p) => (
                <button key={p.id} type="button" aria-pressed={piece === p.id} onClick={() => choosePiece(p.id)}>
                  <strong>{p.label}</strong>
                  <span>{p.hint}</span>
                </button>
              ))}
            </div>
            <small>
              {imgSize ? "Picked from the picture's shape. " : ""}Size follows the picture's proportions: {board.widthMm} × {board.heightMm} mm.
            </small>
            {piece === "leg" ? (
              <label className="toggle">
                <input type="checkbox" name="turned" checked={turned} onChange={(e) => setTurned(e.target.checked)} />
                Turned (round) leg: shape from the outline, background cut to 0
              </label>
            ) : null}
            {piece === "leg" ? (
              <label className="field">
                <span>
                  Rotary leg diameter <em className="nums">{legDia}&nbsp;mm</em>
                </span>
                <div className="pair">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    value={legDia}
                    onChange={(e) => {
                      const d = Number(e.target.value);
                      if (Number.isFinite(d) && d > 0) setLegDia(d);
                    }}
                  />
                  <button type="button" className="btn ghost" onClick={() => setSide("widthMm", String(circumferenceMm(legDia)))}>
                    Wrap once around
                  </button>
                </div>
                <small>
                  Carving flat? Ignore this. For a rotary / 4th-axis machine, this sets the width to π × diameter
                  ({circumferenceMm(legDia)} mm) so ArtCAM or Aspire can wrap the relief around the leg.
                </small>
              </label>
            ) : null}
          </div>

            </>
          ) : null}

          {mode === "photo" && !empty ? (
          <div className="card" hidden={panelStep !== "size"}>
            <h3>Size</h3>
              <div className="pair">
                <label className="field">
                  <span>
                    Width <em className="nums">{board.widthMm}&nbsp;mm</em>
                  </span>
                  <input type="number" name="width-mm" autoComplete="off" inputMode="decimal" min={1} value={board.widthMm} onChange={(e) => setSide("widthMm", e.target.value)} />
                </label>
                <label className="field">
                  <span>
                    Height <em className="nums">{board.heightMm}&nbsp;mm</em>
                  </span>
                  <input type="number" name="height-mm" autoComplete="off" inputMode="decimal" min={1} value={board.heightMm} onChange={(e) => setSide("heightMm", e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>
                  Relief depth <em className="nums">{board.depthMm}&nbsp;mm</em>
                </span>
                <input type="number" name="depth-mm" autoComplete="off" inputMode="decimal" min={0.1} step={0.1} value={board.depthMm} onChange={(e) => setNum("depthMm", e.target.value)} />
              </label>
              <label className="field">
                <span>
                  Base thickness <em className="nums">{board.baseMm}&nbsp;mm</em>
                </span>
                <input type="number" name="base-mm" autoComplete="off" inputMode="decimal" min={0} step={0.1} value={board.baseMm} onChange={(e) => setNum("baseMm", e.target.value)} />
                <small>0 = relief surface only, ready for ArtCAM / Aspire. Add a base only for 3D printing.</small>
              </label>
              <label className="field">
                <span>
                  Overall height <em className="nums">{thickMm}&nbsp;mm</em>
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.2}
                  step={0.1}
                  value={thickMm}
                  onChange={(e) => {
                    const z = Number(e.target.value);
                    if (!Number.isFinite(z) || z <= board.baseMm) return;
                    setBoard((b) => ({ ...b, depthMm: Math.round((z - b.baseMm) * 100) / 100 }));
                  }}
                />
                <small>Base plus relief. This is the block height in the STL.</small>
              </label>
            <p className="meta">Width and height follow the picture’s shape: change one and the other follows.</p>
          </div>
          ) : null}

          {mode === "photo" && !empty ? (
          <div className="card" hidden={panelStep !== "relief"}>
            <h3>Relief</h3>
            <div className="seg" role="group" aria-label="Relief depth">
              {RELIEF.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={reliefKind === r.id}
                  onClick={() => setBoard((b) => ({ ...b, depthMm: r.depth }))}
                >
                  <strong>{r.label}</strong>
                  <span>{r.hint}</span>
                </button>
              ))}
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              <span>
                Background level <em className="nums">{zeroLevel ? `${Math.round(zeroLevel * 100)}%` : "off"}</em>
              </span>
              <input type="range" name="zero-plane" min={0} max={0.6} step={0.01} value={zeroLevel} onChange={(e) => setZeroLevel(Number(e.target.value))} />
              <small>For bumpy backgrounds: slide right until the background is flat. Too far starts cutting thin parts of the subject — watch the 3D view.</small>
            </label>
            <label className="toggle">
              <input type="checkbox" name="invert" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              Invert light and dark
            </label>
          </div>
          ) : null}

          {mode === "photo" && !empty ? (
          <div hidden={panelStep !== "image"}>
            <TraceCard img={traceImg} name={exportSource()} openSignal={traceOpen} />
          </div>
          ) : null}

          <details className="card adv" hidden={empty || (mode === "photo" && panelStep !== "relief")}>
            <summary>Advanced settings</summary>
            <label className="toggle" style={{ marginTop: 12 }}>
              <input type="checkbox" name="cut-background" checked={cutBg} onChange={(e) => setCutBg(e.target.checked)} />
              Cut plain background to 0 (when the picture has one)
            </label>
            <div className="row" style={{ marginTop: 12 }}>
              <div>
                <h3>Resolution</h3>
                <div className="seg" role="group" aria-label="Resolution">
                  {(Object.keys(QUALITY) as Quality[]).map((k) => (
                    <button key={k} type="button" aria-pressed={quality === k} disabled={!!busy} onClick={() => startTransition(() => setQuality(k))}>
                      <strong>{QUALITY[k].label}</strong>
                      <span>{QUALITY_HINT[k]}</span>
                    </button>
                  ))}
                </div>
                <p className="meta" style={{ marginTop: 8 }}>
                  {quality === "high"
                    ? "1024 across the picture. A smaller photo is placed on that grid. It does not gain new detail."
                    : quality === "ultra"
                      ? "Keeps up to 1280 from a picture that is already larger than 1024."
                      : "Explicit 512 grid. Same solid, smaller file."}
                </p>
              </div>
              {raw ? (
                <p className="meta nums">
                  Depth field {raw.cols} × {raw.rows}
                  {mesh ? ` · ${nf.format(mesh.meta.triangleCount)} triangles` : ""}
                </p>
              ) : null}
              <label className="field">
                <span>
                  Depth strength <em>{contrast}</em>
                </span>
                <div className="slide">
                  <input
                    type="range"
                    min={0.4}
                    max={3}
                    step={0.05}
                    value={contrast}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n > 0) setContrast(n);
                    }}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    step={0.05}
                    min={0.4}
                    max={3}
                    value={contrast}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n > 0) setContrast(n);
                    }}
                  />
                </div>
                <small>Stretches the height range. 1 is neutral.</small>
              </label>
              <label className="field">
                <span>
                  Smoothing <em>{smooth}</em>
                </span>
                <div className="slide">
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={1}
                    value={smooth}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) setSmooth(Math.round(n));
                    }}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    step={1}
                    min={0}
                    max={4}
                    value={smooth}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) setSmooth(Math.round(n));
                    }}
                  />
                </div>
                <small>Leave this at 0 for a light cleanup. Higher values soften the ornament.</small>
              </label>
              <label className="field">
                <span>
                  Clean texture <em>{clean}</em>
                </span>
                <div className="slide">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={clean}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setClean(Math.min(1, Math.max(0, n)));
                    }}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    step={0.05}
                    min={0}
                    max={1}
                    value={clean}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setClean(Math.min(1, Math.max(0, n)));
                    }}
                  />
                </div>
                <small>Removes wood grain, stone marks and scratches. Keeps bricks, folds and lettering.</small>
              </label>
              <label className="field">
                <span>
                  Fine detail <em>{detail}</em>
                </span>
                <div className="slide">
                  <input
                    type="range"
                    min={0}
                    max={0.6}
                    step={0.05}
                    value={detail}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setDetail(Math.min(0.6, Math.max(0, n)));
                    }}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    step={0.05}
                    min={0}
                    max={0.6}
                    value={detail}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setDetail(Math.min(0.6, Math.max(0, n)));
                    }}
                  />
                </div>
                <small>How much picture detail sits on top of the 3D shape.</small>
              </label>
              <button
                type="button"
                className="btn ghost full"
                onClick={() => {
                  setBoard({
                    ...(imgSize ? boardForPiece(piece, imgSize.w, imgSize.h) : { widthMm: 100, heightMm: 100 }),
                    depthMm: 3,
                    baseMm: 0,
                  });
                  setContrast(1);
                  setClean(0.5);
                  setDetail(0.35);
                  setSmooth(0);
                  setInvert(false);
                  setNormalize(true);
                  setQuality("high");
                }}
              >
                Reset settings
              </button>
              {pic ? (
                <button type="button" className="btn ghost full" onClick={newProject} disabled={!!busy}>
                  New project
                </button>
              ) : null}
            </div>
          </details>

          {mode === "photo" ? (
          <details className="card gen" hidden={panelStep !== "image"}>
            <summary>Or describe a design</summary>
            <div className="row" style={{ marginTop: 12 }}>
              <label className="field">
                <span>What to carve</span>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Peacock on a teak panel…"
                  aria-label="What to carve"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
                      e.preventDefault();
                      void generate();
                    }
                  }}
                />
              </label>
              <button type="button" className="btn ink full" disabled={!!busy} onClick={() => void generate()}>
                Generate image
              </button>
            </div>
          </details>
          ) : null}

          <div className="card" hidden={(!ready && !busy && !pic) || (mode === "photo" && panelStep !== "export")}>
            {ready ? (
              <>
                <p className="ready-title">{verdict?.ok ? "STL valid" : "Check the relief"}</p>
                <p className="export-dim nums">
                  {board.widthMm} × {board.heightMm} × {thickMm}&nbsp;mm
                </p>
                <p className="meta nums">
                  Relief {board.depthMm}&nbsp;mm · {board.baseMm > 0 ? <>Base {board.baseMm}&nbsp;mm</> : "No base (surface only)"}
                  <br />
                  {raw?.cols} × {raw?.rows}
                  <br />
                  {mesh ? nf.format(mesh.meta.triangleCount) : trisLabel(exportTris)} triangles ·{" "}
                  {exportMb < 1 ? `${Math.round(exportMb * 1000)}\u00a0KB` : `${nf1.format(exportMb)}\u00a0MB`}
                </p>
                {verdict && !verdict.ok ? <p className="meta">{verdict.errors[0]}</p> : null}
                {mobile && raw && raw.cols >= 700 ? (
                  <p className="meta">This preview is the full relief. Saving the STL is easier on a computer.</p>
                ) : null}
                <div className="actions" style={{ marginTop: 12 }}>
                  <button type="button" className="btn pri full hide-phone" disabled={!!busy || meshLag || verdict?.ok === false} onClick={() => requestStl()}>
                    {exportLabel}
                  </button>
                  {raw?.exact ? (
                    <>
                      <button type="button" className="btn ghost full" disabled={!!busy} onClick={() => void saveTextRelief("rlf")}>
                        ArtCAM relief (.rlf)
                      </button>
                      <button type="button" className="btn ghost full" disabled={!!busy} onClick={() => void saveTextRelief("tif")}>
                        16-bit TIFF
                      </button>
                      <p className="meta">.rlf and TIFF are made at 0.25&nbsp;mm detail, finer than the STL.</p>
                      <button type="button" className="btn ghost full" disabled={!!busy} onClick={() => void saveOutline()}>
                        Cut outline (.dxf)
                      </button>
                      <p className="meta">The panel's edge as a vector, for the profile cut{(builtSpec ?? textSpec).shape !== "rect" && ((builtSpec ?? textSpec).template === "plate" || (builtSpec ?? textSpec).template === "pattern") ? " around the arch or oval" : ""}.</p>
                      <button type="button" className="btn ghost full" disabled={!!busy} onClick={() => void saveVectors("dxf")}>
                        Vectors for V-carve (.dxf)
                      </button>
                      <p className="meta">
                        Letter outlines{(builtSpec ?? textSpec).template === "pattern" ? ", pattern centre lines" : ""} and the cut outline on separate layers, in mm.{" "}
                        <button type="button" className="linkish" disabled={!!busy} onClick={() => void saveVectors("svg")}>
                          Also as SVG
                        </button>
                      </p>
                      <button type="button" className="btn ghost full" disabled={!!busy} onClick={() => void saveProof()}>
                        Proof image
                      </button>
                      <p className="meta">Check the spelling with someone who reads the script before carving.</p>
                    </>
                  ) : null}
                  <button type="button" className="btn ghost full" disabled={!!busy} onClick={() => void saveArtcam()}>
                    Height map for ArtCAM
                  </button>
                  <p className="meta">Optional. Use this only if ArtCAM asks to open an image instead of an STL.</p>
                </div>
              </>
            ) : (
              <>
                <h3>Export</h3>
                <p className="meta">
                  {pic
                    ? "The relief is building. Download appears here when it is ready."
                    : mode === "text"
                      ? "Build the text panel first. The STL, .rlf and TIFF downloads will appear here."
                      : "Upload an image first. The STL download will appear here."}
                </p>
              </>
            )}
          </div>

          {err ? (
            <div className="banner err" role="alert">
              <p>{err}</p>
              <button type="button" className="linkish" onClick={() => setErr("")}>
                Dismiss
              </button>
            </div>
          ) : null}
          {note ? (
            <div className="banner ok" role="status">
              <p>{note}</p>
            </div>
          ) : null}
        </aside>
      </main>


      {ready ? (
        <div className="sticky">
          <button type="button" className="btn pri full" disabled={!!busy || meshLag || verdict?.ok === false} onClick={() => requestStl()}>
            {exportLabel}
          </button>
        </div>
      ) : null}
      {err ? (
        <div className="banner err toast" role="alert">
          <p>{err}</p>
        </div>
      ) : note ? (
        <div className="banner ok toast" role="status">
          <p>{note}</p>
        </div>
      ) : null}

      {warn ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="warn-title" aria-describedby="warn-body" onKeyDown={(e) => e.key === "Escape" && closeWarn()}>
          <div className="card">
            <h2 id="warn-title">Large STL</h2>
            <p id="warn-body">
              This file is about {nf1.format(warn.mb)}&nbsp;MB ({nf.format(warn.tris)} triangles). The preview is this same relief. Phones can struggle to save it.
            </p>
            <div className="actions" style={{ marginTop: 12 }}>
              <button ref={warnFirst} type="button" className="btn pri full" onClick={() => void saveStl()}>
                Download anyway
              </button>
              {raw?.exact ? (
                <button
                  type="button"
                  className="btn ghost full"
                  onClick={() => {
                    closeWarn();
                    void saveTextRelief("rlf");
                  }}
                >
                  Get the .rlf instead (smaller, opens in ArtCAM)
                </button>
              ) : quality !== "standard" ? (
                <button
                  type="button"
                  className="btn ghost full"
                  onClick={() => {
                    closeWarn();
                    startTransition(() => setQuality(quality === "ultra" ? "high" : "standard"));
                  }}
                >
                  {quality === "ultra" ? "Use High instead" : "Use Standard (about ¼ the size)"}
                </button>
              ) : null}
              <button type="button" className="btn ghost full" onClick={closeWarn}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
