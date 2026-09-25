import { useEffect, useRef, useState } from "react";
import { heightToImageData, normalizeHeight, rasterFromImage } from "./lib/height";
import { reliefBmp } from "./lib/bmp";
import { artcamNames } from "./lib/names";
import { rlfGrid } from "./lib/rlf";

const BIAS = ", ornamental wood carving relief, high contrast, single subject, no text, no watermark";

function download(name: string, data: string | ArrayBuffer | Uint8Array | Blob, type: string) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that picture"));
    img.src = src;
  });
}

export default function App() {
  const [prompt, setPrompt] = useState("Peacock on a teak panel, side view, deep carved feathers");
  const [pic, setPic] = useState("");
  const [invert, setInvert] = useState(false);
  const [normalize, setNormalize] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const [cutPass, setCutPass] = useState(0);
  const [grid, setGrid] = useState<{ height: Float32Array; cols: number; rows: number } | null>(null);
  const [board, setBoard] = useState({ widthMm: 200, heightMm: 200, depthMm: 4 });
  const depth = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!err && !note) return;
    const t = window.setTimeout(() => {
      setErr("");
      setNote("");
    }, 5000);
    return () => window.clearTimeout(t);
  }, [err, note]);

  async function fromImage(src: string) {
    const img = await loadImage(src);
    const next = await rasterFromImage(img, 220, invert);
    setGrid({ ...next, height: normalize ? normalizeHeight(next.height) : next.height });
    setCutPass((n) => n + 1);
  }

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
    } finally {
      setBusy("");
    }
  }

  async function onFile(file: File) {
    setErr("");
    const url = URL.createObjectURL(file);
    if (pic.startsWith("blob:")) URL.revokeObjectURL(pic);
    setPic(url);
    setBusy("Reading");
    try {
      await fromImage(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Read failed");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (!pic) return;
    fromImage(pic).catch((e) => setErr(e instanceof Error ? e.message : "Read failed"));
    // invert / normalize rebuilds depth from the same picture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invert, normalize]);

  useEffect(() => {
    const canvas = depth.current;
    if (!canvas || !grid) return;
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    canvas.getContext("2d")?.putImageData(heightToImageData(grid.height, grid.cols, grid.rows), 0, 0);
  }, [grid]);

  const ready = !!grid;

  async function saveArtcam() {
    if (!grid) return;
    setBusy("Relief");
    try {
      const { cols, rows } = rlfGrid(board.widthMm, board.heightMm);
      let h = grid.height;
      let c = cols;
      let r = rows;
      if (pic) {
        const img = await loadImage(pic);
        const next = await rasterFromImage(img, cols, invert, rows);
        h = normalize ? normalizeHeight(next.height) : next.height;
        c = next.cols;
        r = next.rows;
      }
      const { bmp } = artcamNames(board.widthMm, board.heightMm, board.depthMm);
      download(bmp, reliefBmp(h, c, r, board.widthMm, board.heightMm), "image/bmp");
      setNote(
        `${bmp} ready. In ArtCAM Open, set Files of type to Bitmap (*.bmp). Then Image size = ${board.widthMm} × ${board.heightMm} mm. Then Reliefs → Create Relief from Bitmap, height ${board.depthMm} mm.`,
      );
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
          <div className="mark">Picture → ArtCAM relief</div>
          <h1>Carve</h1>
          <p className="lede">ArtCAM Open Existing Model is for a picture, not an .rlf. We give you a .bmp.</p>
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
        <div className={"cell" + (grid ? " has-art" : "") + (busy ? " busy" : "")}>
          <span className="tag">Depth</span>
          {grid ? <canvas key={"d" + cutPass} ref={depth} /> : <div className="ph">{busy ? "Reading height…" : "White stays high. Dark is the cut."}</div>}
        </div>
      </div>
      <div className={"bar" + (busy ? " on" : "")} aria-hidden>
        <i />
      </div>

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
          <button className="pri" disabled={!ready} onClick={() => void saveArtcam()}>
            Download BMP for ArtCAM
          </button>
        </div>
        <p className={"toast" + (err ? " on err" : note ? " on ok" : "")} role="status">
          {err || note}
        </p>
        <ol className="steps">
          <li>
            Download. You get one <code>.bmp</code> — do not open any <code>.rlf</code>.
          </li>
          <li>
            ArtCAM start screen → Open Existing Model. In the box, set <b>Files of type</b> to{" "}
            <b>Bitmap (*.bmp)</b> (not ArtCAM Model).
          </li>
          <li>
            Pick the download. Choose <b>Image size</b> and type the Width / Height mm from this page.
          </li>
          <li>
            Reliefs → Create Relief from Bitmap. Height = Depth mm. Toolpath after that.
          </li>
        </ol>
      </div>
    </div>
  );
}
