import { useEffect, useMemo, useRef, useState } from "react";
import { reliefGcode, stepOf, type Cut } from "./lib/gcode";
import { heightToImageData, normalizeHeight, rasterFromImage } from "./lib/height";
import { reliefStl } from "./lib/stl";

const BIAS = ", ornamental wood carving relief, high contrast, single subject, no text, no watermark";

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
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

type DirPicker = () => Promise<{
  getFileHandle: (n: string, o?: { create?: boolean }) => Promise<{
    createWritable: () => Promise<{ write: (d: BufferSource | Blob | string) => Promise<void>; close: () => Promise<void> }>;
  }>;
}>;

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
  const [canDrive, setCanDrive] = useState(false);
  const [grid, setGrid] = useState<{ height: Float32Array; cols: number; rows: number } | null>(null);
  const [cut, setCut] = useState<Cut>({
    widthMm: 200,
    heightMm: 200,
    depthMm: 4,
    bitMm: 6,
    stepPct: 20,
    safeZ: 8,
    feed: 800,
    plunge: 200,
    spindle: 18000,
    passMm: 1.5,
    cross: false,
    stockMm: 18,
  });
  const depth = useRef<HTMLCanvasElement>(null);
  const path = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCanDrive(typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function");
  }, []);

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

  useEffect(() => {
    const canvas = path.current;
    if (!canvas || !grid) return;
    const w = 360;
    const h = Math.round((w * grid.rows) / grid.cols);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#10140f";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#d78900";
    ctx.lineWidth = 1;
    const rows = Math.min(48, Math.max(16, Math.round(cut.heightMm / Math.max(stepOf(cut), 0.4))));
    for (let iy = 0; iy <= rows; iy++) {
      ctx.beginPath();
      for (let ix = 0; ix <= 80; ix++) {
        const i = iy % 2 === 0 ? ix : 80 - ix;
        const x = (i / 80) * (grid.cols - 1);
        const y = (iy / rows) * (grid.rows - 1);
        const z = grid.height[Math.round(y) * grid.cols + Math.round(x)] ?? 0;
        const px = (i / 80) * w;
        const py = (iy / rows) * h - z * 18;
        if (ix === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }, [grid, cut]);

  const ready = !!grid;
  const files = useMemo(() => {
    if (!grid) return null;
    return {
      nc: reliefGcode(grid.height, grid.cols, grid.rows, cut),
      stl: reliefStl(grid.height, grid.cols, grid.rows, cut.widthMm, cut.heightMm, cut.depthMm),
    };
  }, [grid, cut]);

  function stockWarn() {
    return cut.depthMm >= cut.stockMm ? " Depth is at or through the stock — check thickness." : "";
  }
  function saveNc() {
    if (!files) return;
    download("carve.nc", files.nc, "text/plain");
    setNote("carve.nc downloaded. Copy it onto the pen drive." + stockWarn());
  }
  function saveTap() {
    if (!files) return;
    download("carve.tap", files.nc, "text/plain");
    setNote("carve.tap downloaded (same path, Mach3 name)." + stockWarn());
  }
  function saveStl() {
    if (!files) return;
    download("relief.stl", files.stl, "model/stl");
    setNote("relief.stl — open in ArtCAM if you still want their toolpath.");
  }
  function saveHeight() {
    depth.current?.toBlob((blob) => {
      if (!blob) return;
      download("height.png", blob, "image/png");
      setNote("height.png — ArtCAM can read this as a relief bitmap.");
    });
  }
  async function writeDrive() {
    if (!files) return;
    const pick = (window as unknown as { showDirectoryPicker?: DirPicker }).showDirectoryPicker;
    if (!pick) {
      saveNc();
      return;
    }
    try {
      const dir = await pick();
      const handle = await dir.getFileHandle("carve.nc", { create: true });
      const out = await handle.createWritable();
      await out.write(files.nc);
      await out.close();
      setNote("Wrote carve.nc onto the drive." + stockWarn());
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setErr(e instanceof Error ? e.message : "Drive write failed");
    }
  }
  function setNum(key: keyof Cut, raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setCut((c) => ({ ...c, [key]: n }));
  }

  return (
    <div className="shell">
      <header className="rail">
        <div>
          <div className="mark">Picture · relief · stick</div>
          <h1>Carve</h1>
          <p className="lede">Type what you want in the wood. Get a file the CNC will run.</p>
        </div>
        <div className={"spindle" + (busy ? " run" : " idle")} aria-live="polite">
          <i />
          {busy || (ready ? "Ready" : "Idle")}
        </div>
      </header>

      <div
        className={"strip" + (cutPass ? " cut" : "")}
        aria-label="Picture, depth, toolpath"
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
        <div className={"cell" + (grid ? " has-art" : "") + (busy ? " busy" : "")}>
          <span className="tag">Path</span>
          {grid ? <canvas key={"p" + cutPass} ref={path} /> : <div className="ph">{busy ? "Plotting…" : "Raster the machine will follow"}</div>}
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
            <input type="number" inputMode="decimal" value={cut.widthMm} onChange={(e) => setNum("widthMm", e.target.value)} />
          </label>
          <label>
            Height mm
            <input type="number" inputMode="decimal" value={cut.heightMm} onChange={(e) => setNum("heightMm", e.target.value)} />
          </label>
          <label>
            Depth mm
            <input type="number" inputMode="decimal" value={cut.depthMm} step={0.1} onChange={(e) => setNum("depthMm", e.target.value)} />
          </label>
          <label>
            Stock mm
            <input type="number" inputMode="decimal" value={cut.stockMm} onChange={(e) => setNum("stockMm", e.target.value)} />
          </label>
          <label>
            Bit mm
            <input type="number" inputMode="decimal" value={cut.bitMm} step={0.1} onChange={(e) => setNum("bitMm", e.target.value)} />
          </label>
          <label>
            Stepover % of bit
            <input type="number" inputMode="decimal" value={cut.stepPct} onChange={(e) => setNum("stepPct", e.target.value)} />
          </label>
          <label>
            Pass mm
            <input type="number" inputMode="decimal" value={cut.passMm} step={0.1} onChange={(e) => setNum("passMm", e.target.value)} />
          </label>
          <label>
            Feed mm/min
            <input type="number" inputMode="decimal" value={cut.feed} onChange={(e) => setNum("feed", e.target.value)} />
          </label>
          <label>
            Plunge mm/min
            <input type="number" inputMode="decimal" value={cut.plunge} onChange={(e) => setNum("plunge", e.target.value)} />
          </label>
          <label>
            Spindle RPM
            <input type="number" inputMode="decimal" value={cut.spindle} onChange={(e) => setNum("spindle", e.target.value)} />
          </label>
          <label>
            Safe Z mm
            <input type="number" inputMode="decimal" value={cut.safeZ} onChange={(e) => setNum("safeZ", e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            Invert depth
          </label>
          <label className="check">
            <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
            Normalize
          </label>
          <label className="check">
            <input type="checkbox" checked={cut.cross} onChange={(e) => setCut((c) => ({ ...c, cross: e.target.checked }))} />
            Also cut across
          </label>
        </div>

        <div className="out">
          <button className="pri" disabled={!ready} onClick={saveNc}>
            Download carve.nc
          </button>
          {canDrive ? (
            <button className="pri" disabled={!ready} onClick={() => void writeDrive()}>
              Write pen drive
            </button>
          ) : null}
          <button className="sec" disabled={!ready} onClick={saveTap}>
            carve.tap
          </button>
          <button className="sec" disabled={!ready} onClick={saveStl}>
            relief.stl
          </button>
          <button className="sec" disabled={!ready} onClick={saveHeight}>
            height.png
          </button>
        </div>
        <p className={"toast" + (err ? " on err" : note ? " on ok" : "")} role="status">
          {err || note}
        </p>
        <p className="foot">
          Z0 is the top of the board. Stepover is {stepOf(cut).toFixed(2)} mm ({cut.stepPct}% of a {cut.bitMm} mm
          bit). Put <code>carve.nc</code> on the stick. Dry-run above the board before the first real cut.
        </p>
      </div>
    </div>
  );
}
