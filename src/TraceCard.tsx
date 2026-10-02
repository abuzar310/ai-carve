import { useEffect, useMemo, useState } from "react";
import { saveFile } from "./lib/download";
import { traceBitmap, vectorsDxf, vectorsSvg, type Pt } from "./lib/vector";

/** Brightness 0..1 of the picture, at most `longSide` pixels on its long side. */
function luminance(img: HTMLImageElement, longSide = 1200): { lum: Float32Array; cols: number; rows: number } {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const k = Math.min(1, longSide / Math.max(iw, ih));
  const cols = Math.max(8, Math.round(iw * k));
  const rows = Math.max(8, Math.round(ih * k));
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; // transparent logos trace as ink on white
  ctx.fillRect(0, 0, cols, rows);
  ctx.drawImage(img, 0, 0, cols, rows);
  const d = ctx.getImageData(0, 0, cols, rows).data;
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!) / 255;
  return { lum, cols, rows };
}

/** Line drawings and logos → closed vector outlines (DXF / SVG) for V-carve and profile toolpaths. */
export function TraceCard({ img, name }: { img: HTMLImageElement | null; name: string }) {
  const [open, setOpen] = useState(false);
  const [threshold, setThreshold] = useState(0.5);
  const [invert, setInvert] = useState(false);
  const [speck, setSpeck] = useState(1);
  const [widthMm, setWidthMm] = useState(300);
  const [loops, setLoops] = useState<Pt[][]>([]);
  const [note, setNote] = useState("");
  const pic = useMemo(() => (img && open ? luminance(img) : null), [img, open]);
  const heightMm = pic ? +((widthMm * pic.rows) / pic.cols).toFixed(1) : 0;

  useEffect(() => {
    if (!pic) return;
    const t = setTimeout(() => setLoops(traceBitmap(pic.lum, pic.cols, pic.rows, { threshold, invert, widthMm, minAreaMm2: speck })), 200);
    return () => clearTimeout(t);
  }, [pic, threshold, invert, widthMm, speck]);

  const d = useMemo(() => loops.map((l) => "M" + l.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") + "Z").join(""), [loops]);
  const points = loops.reduce((s, l) => s + l.length, 0);

  async function download(fmt: "dxf" | "svg") {
    const layers = [
      { name: "TRACE", color: 7, closed: true, paths: loops },
      { name: "CUT_OUTLINE", color: 1, closed: true, paths: [[[0, 0], [widthMm, 0], [widthMm, heightMm], [0, heightMm]] as Pt[]] },
    ];
    const stem = (name || "trace").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 40) || "trace";
    const file = `${stem}-${Math.round(widthMm)}x${Math.round(heightMm)}mm-vectors.${fmt}`;
    if (fmt === "dxf") await saveFile(file, new Blob([vectorsDxf(layers, widthMm, heightMm)], { type: "application/dxf" }), "application/dxf");
    else await saveFile(file, new Blob([vectorsSvg(layers, widthMm, heightMm)], { type: "image/svg+xml" }), "image/svg+xml");
    setNote(`${fmt.toUpperCase()} downloaded: ${loops.length} shapes, ${widthMm} × ${heightMm} mm.`);
  }

  return (
    <details className="card adv trace" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Trace to vectors (line art, logos)</summary>
      {!img ? (
        <p className="meta">Upload a drawing or logo first.</p>
      ) : (
        <div className="trace-body">
          <p className="meta">For sketches, logos and calligraphy scans: the dark lines become closed outlines you can V-carve or profile in ArtCAM, Aspire, VCarve or Fusion.</p>
          {pic ? (
            <div className="trace-preview" style={{ aspectRatio: `${pic.cols} / ${pic.rows}` }}>
              <svg viewBox={`0 0 ${widthMm} ${heightMm}`} role="img" aria-label={`Traced outlines: ${loops.length} shapes`}>
                <path d={d} fillRule="evenodd" />
              </svg>
            </div>
          ) : null}
          <p className="meta nums" role="status">
            {loops.length} shapes, {points.toLocaleString()} points
          </p>
          <label className="field">
            <span>
              Ink threshold <em className="nums">{Math.round(threshold * 100)}%</em>
            </span>
            <input type="range" min={0.15} max={0.9} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            <small>Raise it for faint pencil; lower it if paper texture shows up.</small>
          </label>
          <label className="field">
            <span>
              Ignore specks smaller than <em className="nums">{speck}&nbsp;mm²</em>
            </span>
            <input type="range" min={0} max={20} step={0.5} value={speck} onChange={(e) => setSpeck(Number(e.target.value))} />
          </label>
          <div className="pair keep">
            <label className="field">
              <span>Width (mm)</span>
              <input type="number" name="trace-width" inputMode="decimal" min={10} max={3000} value={widthMm} onChange={(e) => { const v = Number(e.target.value); if (v >= 10 && v <= 3000) setWidthMm(v); }} />
            </label>
            <label className="field">
              <span>Height</span>
              <input type="text" readOnly value={`${heightMm} mm`} aria-label="Height follows the picture" />
            </label>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            Light lines on a dark background
          </label>
          <div className="pair keep">
            <button type="button" className="btn pri" disabled={!loops.length} onClick={() => void download("dxf")}>
              Download DXF
            </button>
            <button type="button" className="btn ghost" disabled={!loops.length} onClick={() => void download("svg")}>
              SVG
            </button>
          </div>
          {note ? <p className="meta">{note}</p> : null}
        </div>
      )}
    </details>
  );
}
