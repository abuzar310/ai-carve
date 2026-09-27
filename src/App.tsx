import { lazy, Suspense, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { heightToImageData, normalizeHeight, rasterFromImage, resampleHeight } from "./lib/height";
import { refineHeight } from "./lib/refine";
import { QUALITY, buildRelief, constrainedPreview, fieldCols, previewCols, triangleEstimate, type Quality } from "./lib/mesh";
import { writeStlAsync } from "./lib/stl";
import { FULL_TOPOLOGY_TRIS, stlBytesEstimate, validateMesh, validateMeshQuick, validateStl } from "./lib/validate";
import { reliefBmp } from "./lib/bmp";
import { artcamNames } from "./lib/names";
import { canShareFile, saveFile } from "./lib/download";

const ReliefPreview = lazy(async () => {
  const m = await import("./preview");
  return { default: m.ReliefPreview };
});

const BIAS = ", ornamental wood carving relief, high contrast, single subject, no text, no watermark";
const nf = new Intl.NumberFormat();
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

type FileMeta = { name: string; size: number; w: number; h: number };

const QUALITY_HINT: Record<Quality, string> = {
  standard: "Draft",
  high: "Shop work",
  ultra: "Finest field",
};

const RELIEF = [
  { id: "subtle", label: "Subtle", hint: "Light cut", depth: 1.5 },
  { id: "balanced", label: "Balanced", hint: "Usual work", depth: 3 },
  { id: "deep", label: "Deep", hint: "Strong carve", depth: 6 },
] as const;

const BUILD_STAGES = ["Preparing image", "Generating depth", "Building 3D relief", "Preparing preview"] as const;
const DRAW_STAGES = ["Generating image", ...BUILD_STAGES] as const;
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
  if (/Could not read|not a picture/i.test(m)) return "That file could not be opened as an image. Use JPG, PNG, or WebP.";
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

function stagesFor(busy: string): readonly string[] {
  if (!busy) return [];
  if (busy === "Generating image" || busy === "Drawing") return DRAW_STAGES;
  if (/STL|export|Validat|Download|height field|Relief/i.test(busy)) return EXPORT_STAGES;
  return BUILD_STAGES;
}

export default function App() {
  const [prompt, setPrompt] = useState("Peacock on a teak panel, side view, deep carved feathers");
  const [pic, setPic] = useState("");
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [invert, setInvert] = useState(false);
  const [normalize, setNormalize] = useState(true);
  const [contrast, setContrast] = useState(1.15);
  const [smooth, setSmooth] = useState(0);
  const [quality, setQuality] = useState<Quality>("high");
  const [tint, setTint] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const [cutPass, setCutPass] = useState(0);
  const [raw, setRaw] = useState<{ height: Float32Array; cols: number; rows: number } | null>(null);
  const [board, setBoard] = useState({ widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 2 });
  const [wireframe, setWireframe] = useState(false);
  const [showBase, setShowBase] = useState(true);
  const [view, setView] = useState<{ kind: "fit" | "front" | "top" | "side" | "persp"; n: number }>({ kind: "persp", n: 0 });
  const [warn, setWarn] = useState<{ mb: number; tris: number } | null>(null);
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
    const height = normalize ? normalizeHeight(next.height) : next.height;
    setBusy("Building 3D relief");
    await tick();
    setRaw({ height, cols: next.cols, rows: next.rows });
    setCutPass((n) => n + 1);
    setView((v) => ({ kind: "persp", n: v.n + 1 }));
    setBusy("Preparing preview");
    await tick();
    setBusy("");
  }

  const refined = useMemo(
    () => (raw ? refineHeight(raw.height, raw.cols, raw.rows, { contrast, smooth }) : null),
    [raw, contrast, smooth],
  );

  const previewGrid = useMemo(() => {
    if (!raw || !refined) return null;
    const cols = previewCols(quality, mobile, raw.cols);
    const rows = Math.max(2, Math.round((raw.rows * cols) / raw.cols));
    return { height: resampleHeight(refined, raw.cols, raw.rows, cols, rows), cols, rows };
  }, [raw, refined, quality, mobile]);

  const mesh = useMemo(
    () => (previewGrid ? buildRelief(previewGrid.height, previewGrid.cols, previewGrid.rows, board) : null),
    [previewGrid, board],
  );

  const report = useMemo(
    () => (mesh ? (mesh.meta.triangleCount > FULL_TOPOLOGY_TRIS ? validateMeshQuick(mesh) : validateMesh(mesh)) : null),
    [mesh],
  );

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
      setErr(sayErr(e));
      setBusy("");
    }
  }

  function clearPic() {
    if (pic.startsWith("blob:")) URL.revokeObjectURL(pic);
    setPic("");
    setRaw(null);
    setFileMeta(null);
    setWarn(null);
    setErr("");
    setNote("");
    setBusy("");
  }

  useEffect(() => {
    if (!pic) return;
    fromImage(pic).catch((e) => {
      setErr(sayErr(e));
      setBusy("");
    });
    // invert / normalize / quality rebuilds depth from the same picture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invert, normalize, quality]);

  useEffect(() => {
    const canvas = depth.current;
    if (!canvas || !refined || !raw) return;
    canvas.width = raw.cols;
    canvas.height = raw.rows;
    canvas.getContext("2d")?.putImageData(heightToImageData(refined, raw.cols, raw.rows), 0, 0);
  }, [refined, raw]);

  const ready = !!mesh;
  const exportTris = raw ? triangleEstimate(raw.cols, raw.rows) : 0;
  const exportMb = raw ? stlBytesEstimate(exportTris) / 1e6 : 0;
  const thickMm = board.depthMm + board.baseMm;

  async function saveStl() {
    if (!refined || !raw) return;
    setErr("");
    setNote("");
    setWarn(null);
    let out: ReturnType<typeof buildRelief> | null = null;
    try {
      setBusy("Preparing height field");
      await tick();
      setBusy("Building export mesh");
      await tick();
      out = buildRelief(refined, raw.cols, raw.rows, board);
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
      const stlR = expected > FULL_TOPOLOGY_TRIS ? validateStl(buf) : validateStl(buf, out);
      if (stlR.triangles !== expected) throw new Error("STL count != mesh");
      if (!stlR.ok) throw new Error(stlR.errors[0] || "STL invalid");
      out = null;
      setBusy("Preparing download");
      await tick();
      const { stl } = artcamNames(exportSource(), board.widthMm, board.heightMm, board.depthMm);
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
    const tris = triangleEstimate(raw.cols, raw.rows);
    const mb = stlBytesEstimate(tris) / 1e6;
    if (quality === "ultra" && raw.cols >= 600) {
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
      const { bmp } = artcamNames(exportSource(), board.widthMm, board.heightMm, board.depthMm);
      await saveFile(bmp, new Blob([reliefBmp(h, c, r, board.widthMm, board.heightMm) as BlobPart], { type: "image/bmp" }), "image/bmp");
      setNote("Height map downloaded. Use this if ArtCAM asks to open an image.");
    } catch (e) {
      setErr(sayErr(e));
    } finally {
      setBusy("");
    }
  }

  function setNum(key: keyof typeof board, rawVal: string) {
    const n = Number(rawVal);
    if (!Number.isFinite(n) || n <= 0) return;
    setBoard((b) => ({ ...b, [key]: n }));
  }

  function pickFile() {
    fileRef.current?.click();
  }

  function exportSource() {
    const n = fileMeta?.name || "";
    if (n && !/^generated image$/i.test(n)) return n;
    return prompt;
  }

  function newProject() {
    clearPic();
    setBoard({ widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 2 });
    setContrast(1.15);
    setSmooth(0);
    setInvert(false);
    setNormalize(true);
    setQuality("high");
  }

  async function regenerate() {
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

  const step = !pic ? "source" : busy && !ready ? "generate" : /STL|shared|downloaded/i.test(note) ? "export" : ready ? "relief" : "generate";

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
  const stageList = stagesFor(busy);
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
        <a className="brand" href="#workspace" translate="no">
          <span className="kicker">AI Carve</span>
          <h1 className="word">Carve</h1>
        </a>
        <nav className="nav" aria-label="Product">
          <a href="#workspace" aria-current={!pic || step !== "export" ? "page" : undefined}>Create</a>
          <a href="#how">How it works</a>
          <a href="#help-copy">Help</a>
        </nav>
        <details className="menu">
          <summary>Menu</summary>
          <nav aria-label="Product menu" onClick={(e) => (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open")}>
            <a href="#workspace">Create</a>
            <a href="#how">How it works</a>
            <a href="#help-copy">Help</a>
          </nav>
        </details>
        <div className="top-actions">
          <div className={"status" + (busy ? " run" : ready ? "" : " idle")} aria-live="polite">
            <i />
            {busy ? `${busy}…` : ready ? "Ready" : "Add a picture"}
          </div>
          {ready ? (
            <button type="button" className="btn pri hide-phone" disabled={!!busy} onClick={() => requestStl()}>
              {exportLabel}
            </button>
          ) : null}
        </div>
      </header>

      <nav className="path" aria-label="Workflow">
        <b className={step === "source" ? "now" : pic ? "did" : ""}>Source</b>
        <span aria-hidden="true">→</span>
        <b className={step === "generate" ? "now" : ready ? "did" : ""}>Generate</b>
        <span aria-hidden="true">→</span>
        <b className={step === "relief" ? "now" : step === "export" ? "did" : ""}>3D relief</b>
        <span aria-hidden="true">→</span>
        <b className={step === "export" ? "now" : ""}>Export</b>
      </nav>

      <main id="workspace" className={"work" + (pic ? " has-source" : "")}>
        {pic ? (
          <aside className="source card" aria-label="Source image">
            <h2>Source image</h2>
            <figure>
              <img src={pic} alt={fileMeta?.name || "Design to carve"} width={fileMeta?.w || 512} height={fileMeta?.h || 512} />
              <figcaption>
                <p className="source-name">{fileMeta?.name || "Picture"}</p>
                <p className="meta nums">
                  {fileMeta?.size ? bytes(fileMeta.size) : ""}
                  {fileMeta?.w ? `${fileMeta.size ? " · " : ""}${fileMeta.w} × ${fileMeta.h} px` : ""}
                </p>
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
        ) : pic && !ready && !busy ? (
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
              <ReliefPreview key={cutPass} mesh={mesh} wireframe={wireframe} showBase={showBase} tint={tint} view={view.kind} viewTick={view.n} />
            </Suspense>
          ) : pic ? (
            <div className="drop">
              <div>
                <h2>{err ? "Unable to process this image" : "Ready to generate your relief"}</h2>
                <p>
                  {err
                    ? "Try JPG, PNG, or WebP. You can replace the source image and try again."
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
                <h2>Create your 3D relief</h2>
                <p>Upload an image to begin. Light areas become the raised carving.</p>
                <button type="button" className="btn pri" onClick={pickFile} disabled={!!busy}>
                  Upload image
                </button>
                <p className="hint">JPG, PNG, WebP, or BMP. Drag and drop works too.</p>
              </div>
            </div>
          )}

          {mesh ? <p className="well-hint">Drag to turn · pinch to zoom</p> : null}

          {mesh && report ? (
            <div className="info nums">
              <b>
                {QUALITY[quality].label} · {board.widthMm} × {board.heightMm}&nbsp;mm
              </b>
              <br />
              Relief {board.depthMm}&nbsp;mm · Base {board.baseMm}&nbsp;mm
              <br />
              {trisLabel(exportTris)} triangles · ~
              {exportMb < 1 ? `${Math.round(exportMb * 1000)}\u00a0KB` : `${nf1.format(exportMb)}\u00a0MB`}
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
          </div>
        ) : null}
        </div>

        <aside className="rail">
          <div className="card">
            <h3>Detail</h3>
            <div className="seg" role="group" aria-label="Detail quality">
              {(Object.keys(QUALITY) as Quality[]).map((k) => (
                <button key={k} type="button" aria-pressed={quality === k} disabled={!!busy} onClick={() => startTransition(() => setQuality(k))}>
                  <strong>{QUALITY[k].label}</strong>
                  <span>{QUALITY_HINT[k]}</span>
                </button>
              ))}
            </div>
            <p className="meta" style={{ marginTop: 10 }}>
              {quality === "ultra"
                ? "Finest sampling from your picture. Large STL on a sharp photo."
                : quality === "high"
                  ? "Use this for ArtCAM Import 3D Model."
                  : "Fewer triangles. Check size and depth first."}
            </p>
          </div>

          <div className="card">
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
          </div>

          <div className="card">
            <h3>Image</h3>
            <label className="toggle">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              Invert light and dark
            </label>
            <label className="toggle">
              <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
              Stretch to full depth
            </label>
          </div>

          <details className="card adv">
            <summary>Advanced settings</summary>
            <div className="row" style={{ marginTop: 12 }}>
              <div className="pair">
                <label className="field">
                  <span>
                    Width <em className="nums">{board.widthMm}&nbsp;mm</em>
                  </span>
                  <input type="number" inputMode="decimal" min={1} value={board.widthMm} onChange={(e) => setNum("widthMm", e.target.value)} />
                </label>
                <label className="field">
                  <span>
                    Height <em className="nums">{board.heightMm}&nbsp;mm</em>
                  </span>
                  <input type="number" inputMode="decimal" min={1} value={board.heightMm} onChange={(e) => setNum("heightMm", e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>
                  Relief depth <em className="nums">{board.depthMm}&nbsp;mm</em>
                </span>
                <input type="number" inputMode="decimal" min={0.1} step={0.1} value={board.depthMm} onChange={(e) => setNum("depthMm", e.target.value)} />
              </label>
              <label className="field">
                <span>
                  Base thickness <em className="nums">{board.baseMm}&nbsp;mm</em>
                </span>
                <input type="number" inputMode="decimal" min={0.1} step={0.1} value={board.baseMm} onChange={(e) => setNum("baseMm", e.target.value)} />
              </label>
              <label className="field">
                <span>
                  Contrast <em>{contrast}</em>
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
                <small>How strongly light and dark become height.</small>
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
                <small>0 keeps sharp edges. Higher values soften the relief.</small>
              </label>
              <button
                type="button"
                className="btn ghost full"
                onClick={() => {
                  setBoard({ widthMm: 100, heightMm: 100, depthMm: 3, baseMm: 2 });
                  setContrast(1.15);
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

          <details className="card gen">
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

          <div className="card">
            {ready ? (
              <>
                <p className="ready-title">Ready to export</p>
                <p className="export-dim nums">
                  STL · {board.widthMm} × {board.heightMm} × {thickMm}&nbsp;mm
                </p>
                <p className="meta nums">
                  {QUALITY[quality].label} · ~{trisLabel(exportTris)} triangles · ~
                  {exportMb < 1 ? `${Math.round(exportMb * 1000)}\u00a0KB` : `${nf1.format(exportMb)}\u00a0MB`}
                </p>
                <div className="actions" style={{ marginTop: 12 }}>
                  <button type="button" className="btn pri full hide-phone" disabled={!!busy} onClick={() => requestStl()}>
                    {exportLabel}
                  </button>
                  <button type="button" className="btn ghost full" disabled={!!busy} onClick={() => void saveArtcam()}>
                    Height map for ArtCAM
                  </button>
                  <p className="meta">Optional. Use this only if ArtCAM asks to open an image instead of an STL.</p>
                </div>
              </>
            ) : (
              <>
                <h3>Export</h3>
                <p className="meta">{pic ? "The relief is building. Download appears here when it is ready." : "Upload an image first. The STL download will appear here."}</p>
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

      <footer className="foot">
        <div className="foot-brand">
          <p className="kicker">AI Carve</p>
          <p className="foot-line">Image → 3D relief → STL</p>
          <p>Turn a picture into a solid carving file for ArtCAM.</p>
        </div>
        <div>
          <h2>Product</h2>
          <nav aria-label="Product">
            <a href="#workspace">Create</a>
            <a href="#how">How it works</a>
          </nav>
        </div>
        <div>
          <h2>Resources</h2>
          <nav aria-label="Resources">
            <a href="#help-copy">Help</a>
            <a href="#formats">Supported formats</a>
          </nav>
        </div>
        <div>
          <h2>Legal</h2>
          <nav aria-label="Legal">
            <a href="#privacy">Privacy</a>
          </nav>
        </div>
        <div className="foot-copy" id="how">
          <h2>How it works</h2>
          <p>Upload an image. Light areas rise, dark areas sink. Choose detail and relief, then download an STL for ArtCAM Import 3D Model.</p>
        </div>
        <div className="foot-copy" id="help-copy">
          <h2>Help</h2>
          <p>If the subject looks sunk, invert light and dark. Ultra makes a large file on a sharp photo. Height BMP is only needed if ArtCAM asks to open an image.</p>
        </div>
        <div className="foot-copy" id="formats">
          <h2>Supported formats</h2>
          <p>Upload JPG, PNG, WebP, or BMP. Export binary STL for Import 3D Model, plus an optional 8-bit height BMP.</p>
        </div>
        <div className="foot-copy" id="privacy">
          <h2>Privacy</h2>
          <p>Pictures stay in this browser. Carve does not write them to a shop database.</p>
        </div>
      </footer>

      {ready ? (
        <div className="sticky">
          <button type="button" className="btn pri full" disabled={!!busy} onClick={() => requestStl()}>
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
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="warn-title">
          <div className="card">
            <h2 id="warn-title">Large Ultra export</h2>
            <p>
              This file is about {nf1.format(warn.mb)}&nbsp;MB ({nf.format(warn.tris)} triangles). Phones can struggle. Save Ultra on a computer.
            </p>
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn pri full" onClick={() => void saveStl()}>
                Download Ultra
              </button>
              <button
                type="button"
                className="btn ghost full"
                onClick={() => {
                  setWarn(null);
                  setQuality("high");
                }}
              >
                Use High instead
              </button>
              <button type="button" className="btn ghost full" onClick={() => setWarn(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
