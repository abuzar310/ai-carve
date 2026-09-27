import { useEffect, useMemo, useRef, useState } from "react";
import { heightToImageData, normalizeHeight, rasterFromImage, resampleHeight } from "./lib/height";
import { refineHeight } from "./lib/refine";
import { QUALITY, buildRelief, constrainedPreview, fieldCols, previewCols, triangleEstimate, type Quality } from "./lib/mesh";
import { writeStlAsync } from "./lib/stl";
import { FULL_TOPOLOGY_TRIS, formatReport, stlBytesEstimate, validateMesh, validateMeshQuick, validateStl } from "./lib/validate";
import { reliefBmp } from "./lib/bmp";
import { artcamNames } from "./lib/names";
import { canShareFile, saveFile } from "./lib/download";
import { ReliefPreview } from "./preview";

const BIAS = ", ornamental wood carving relief, high contrast, single subject, no text, no watermark";

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

export default function App() {
  const [prompt, setPrompt] = useState("Peacock on a teak panel, side view, deep carved feathers");
  const [pic, setPic] = useState("");
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
  const mobile = constrainedPreview();
  const shareOk = useMemo(() => canShareFile(), []);

  useEffect(() => {
    if (!err && !note) return;
    const t = window.setTimeout(() => {
      setErr("");
      setNote("");
    }, 6000);
    return () => window.clearTimeout(t);
  }, [err, note]);

  async function fromImage(src: string) {
    setBusy("Preparing image");
    const img = await loadImage(src);
    setBusy("Generating depth");
    await tick();
    const srcMax = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const cols = fieldCols(quality, srcMax);
    const next = await rasterFromImage(img, cols, invert);
    const height = normalize ? normalizeHeight(next.height) : next.height;
    setRaw({ height, cols: next.cols, rows: next.rows });
    setCutPass((n) => n + 1);
    setView((v) => ({ kind: "persp", n: v.n + 1 }));
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
    setBusy("Drawing");
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
      await fromImage(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Generate failed");
      setBusy("");
    }
  }

  async function onFile(file: File) {
    setErr("");
    const url = URL.createObjectURL(file);
    if (pic.startsWith("blob:")) URL.revokeObjectURL(pic);
    setPic(url);
    try {
      await fromImage(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Read failed");
      setBusy("");
    }
  }

  useEffect(() => {
    if (!pic) return;
    fromImage(pic).catch((e) => {
      setErr(e instanceof Error ? e.message : "Read failed");
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
      const { stl } = artcamNames(board.widthMm, board.heightMm, board.depthMm);
      const blob = new Blob([buf], { type: "model/stl" });
      setBusy("Download ready");
      await saveFile(stl, blob, "model/stl");
      setNote(formatReport(stlR));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "STL failed");
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
      const { bmp } = artcamNames(board.widthMm, board.heightMm, board.depthMm);
      await saveFile(bmp, new Blob([reliefBmp(h, c, r, board.widthMm, board.heightMm) as BlobPart], { type: "image/bmp" }), "image/bmp");
      setNote(bmp);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Relief failed");
    } finally {
      setBusy("");
    }
  }

  function setNum(key: keyof typeof board, raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setBoard((b) => ({ ...b, [key]: n }));
  }

  return (
    <div className="shell">
      <header className="rail">
        <div>
          <div className="mark">Picture → 3D relief → STL</div>
          <h1>Carve</h1>
          <p className="lede">Upload or generate a picture, see the solid relief, then download a CNC-ready STL.</p>
        </div>
        <div className={"spindle" + (busy ? " run" : " idle")} aria-live="polite">
          <i />
          {busy || (ready ? "Ready" : "Idle")}
        </div>
      </header>

      <div
        className={"strip" + (cutPass ? " cut" : "")}
        aria-label="Picture and depth"
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
        <span key={cutPass} className="bit" aria-hidden />
        <div className={"cell" + (pic ? " has-art" : "") + (over ? " drop" : "") + (busy && !pic ? " busy" : "")}>
          <span className="tag">Picture</span>
          {pic ? <img key={pic} src={pic} alt="Design to carve" /> : <div className="ph">{busy ? "Drawing…" : "Generate, drop a photo, or pick one"}</div>}
        </div>
        <div className={"cell" + (raw ? " has-art" : "") + (busy ? " busy" : "")}>
          <span className="tag">Depth</span>
          {raw ? <canvas key={"d" + cutPass} ref={depth} /> : <div className="ph">{busy ? "Generating depth…" : "White stays high. Dark is the cut."}</div>}
        </div>
      </div>
      <div className={"bar" + (busy ? " on" : "")} aria-hidden>
        <i />
      </div>

      <section className={"stage" + (mesh ? " has-art" : "")} aria-label="3D relief">
        <span className="tag">3D relief</span>
        {mesh ? (
          <ReliefPreview key={cutPass} mesh={mesh} wireframe={wireframe} showBase={showBase} tint={tint} view={view.kind} viewTick={view.n} />
        ) : (
          <div className="ph">{busy ? busy + "…" : "The solid model appears here after a picture is loaded."}</div>
        )}
        {mesh && (
          <div className="views">
            <button type="button" onClick={() => goView("persp")}>Perspective</button>
            <button type="button" onClick={() => goView("fit")}>Fit</button>
            <button type="button" onClick={() => goView("front")}>Front</button>
            <button type="button" onClick={() => goView("top")}>Top</button>
            <button type="button" onClick={() => goView("side")}>Side</button>
            <button type="button" onClick={() => goView("persp")}>Reset</button>
            <button type="button" aria-pressed={wireframe} onClick={() => setWireframe((v) => !v)}>
              Wire
            </button>
            <button type="button" aria-pressed={showBase} onClick={() => setShowBase((v) => !v)}>
              Base
            </button>
            <button type="button" aria-pressed={tint} onClick={() => setTint((v) => !v)}>
              Depth
            </button>
          </div>
        )}
      </section>
      {report && (
        <p className={"stats" + (report.ok ? "" : " bad")}>
          {report.ok ? "MESH VALID" : "MESH INVALID"} · preview {previewGrid?.cols}×{previewGrid?.rows} · field{" "}
          {raw?.cols}×{raw?.rows} · {report.triangles.toLocaleString()} on screen · export{" "}
          {raw ? triangleEstimate(raw.cols, raw.rows).toLocaleString() : "—"} tris · {report.size[0].toFixed(1)} × {report.size[1].toFixed(1)} ×{" "}
          {report.size[2].toFixed(2)} mm · Z {report.zMin.toFixed(2)}…{report.zMax.toFixed(2)} · relief {report.topSpan.toFixed(2)} mm
        </p>
      )}

      <div className="bench">
        <div className="ask">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What to carve"
            aria-label="What to carve"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
                e.preventDefault();
                void generate();
              }
            }}
          />
          <button className="go" disabled={!!busy} onClick={() => void generate()}>
            {busy || "Generate"}
          </button>
          <button className="ghost" type="button" onClick={() => fileRef.current?.click()}>
            Use a photo
          </button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </div>

        <div className="knobs">
          <label>
            Width mm
            <input type="number" inputMode="decimal" value={board.widthMm} onChange={(e) => setNum("widthMm", e.target.value)} />
          </label>
          <label>
            Height mm
            <input type="number" inputMode="decimal" value={board.heightMm} onChange={(e) => setNum("heightMm", e.target.value)} />
          </label>
          <label>
            Depth mm
            <input type="number" inputMode="decimal" value={board.depthMm} step={0.1} onChange={(e) => setNum("depthMm", e.target.value)} />
          </label>
          <label>
            Base mm
            <input type="number" inputMode="decimal" value={board.baseMm} step={0.1} onChange={(e) => setNum("baseMm", e.target.value)} />
          </label>
          <label>
            Contrast
            <input type="number" inputMode="decimal" value={contrast} step={0.05} min={0.4} max={3} onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n > 0) setContrast(n);
            }} />
          </label>
          <label>
            Smooth
            <input type="number" inputMode="decimal" value={smooth} step={1} min={0} max={4} onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0) setSmooth(Math.round(n));
            }} />
          </label>
          <label>
            Quality
            <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              {(Object.keys(QUALITY) as Quality[]).map((k) => (
                <option key={k} value={k}>
                  {QUALITY[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            Invert depth
          </label>
          <label className="check">
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
            Normalize
          </label>
        </div>

        <div className="out">
          <button className="pri" disabled={!ready || !!busy} onClick={() => requestStl()}>
            {shareOk ? "Share / Save STL" : "Download STL"}
          </button>
          <button className="sec" disabled={!ready || !!busy} onClick={() => void saveArtcam()}>
            Download BMP
          </button>
        </div>
        {raw && (
          <p className="export-est">
            {QUALITY[quality].label} · {triangleEstimate(raw.cols, raw.rows).toLocaleString()} triangles · ~
            {(stlBytesEstimate(triangleEstimate(raw.cols, raw.rows)) / 1e6).toFixed(1)} MB STL
          </p>
        )}
        {warn && (
          <div className="warn" role="dialog" aria-label="Large export">
            <p>
              Ultra export is approximately {warn.mb.toFixed(0)} MB and may be slow on mobile devices.
            </p>
            <div className="out">
              <button className="pri" type="button" onClick={() => void saveStl()}>
                Download Ultra
              </button>
              <button
                className="sec"
                type="button"
                onClick={() => {
                  setWarn(null);
                  setQuality("high");
                }}
              >
                Use High instead
              </button>
              <button className="sec" type="button" onClick={() => setWarn(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        <ol className="steps">
          <li>Upload or generate a picture</li>
          <li>Check the 3D relief — rotate so the depth is obvious</li>
          <li>Set size, depth, base, and quality (Standard = test, High = CNC, Ultra ≈ 1–2M tris when the picture is sharp enough)</li>
          <li>Download STL for ArtCAM Import 3D Model, or BMP for Open an image</li>
        </ol>
        <p className={"toast" + (err ? " on err" : note ? " on ok" : "")} role="status">
          {err || note}
        </p>
      </div>
    </div>
  );
}
