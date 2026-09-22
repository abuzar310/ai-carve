import { useEffect, useMemo, useRef, useState } from "react";
import { reliefGcode, type Cut } from "./lib/gcode";
import { heightToImageData, rasterFromImage } from "./lib/height";
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

export default function App() {
  const [prompt, setPrompt] = useState("Peacock on a teak panel, side view, deep carved feathers");
  const [pic, setPic] = useState<string>("");
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [grid, setGrid] = useState<{ height: Float32Array; cols: number; rows: number } | null>(null);
  const [cut, setCut] = useState<Cut>({
    widthMm: 200,
    heightMm: 200,
    depthMm: 4,
    stepMm: 1.2,
    safeZ: 8,
    feed: 800,
    plunge: 200,
  });
  const depth = useRef<HTMLCanvasElement>(null);
  const path = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function fromImage(src: string) {
    const img = await loadImage(src);
    const next = await rasterFromImage(img, 160, invert);
    setGrid(next);
  }

  async function generate() {
    setErr("");
    setNote("");
    setBusy("Drawing");
    try {
      const q = encodeURIComponent(prompt.trim() + BIAS);
      const seed = Date.now() % 99999;
      const urls = [
        `/imagine/${q}?width=768&height=768&nologo=true&seed=${seed}`,
        `https://image.pollinations.ai/prompt/${q}?width=768&height=768&nologo=true&seed=${seed}`,
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
    // invert is the only rebuild trigger besides a new picture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invert]);

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
    ctx.fillStyle = "#1c1914";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#c56a2c";
    ctx.lineWidth = 1;
    const rows = 36;
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
  }, [grid]);

  const ready = !!grid;

  const files = useMemo(() => {
    if (!grid) return null;
    const nc = reliefGcode(grid.height, grid.cols, grid.rows, cut);
    const stl = reliefStl(grid.height, grid.cols, grid.rows, cut.widthMm, cut.heightMm, cut.depthMm);
    return { nc, stl };
  }, [grid, cut]);

  function saveNc() {
    if (!files) return;
    download("carve.nc", files.nc, "text/plain");
    setNote("carve.nc — copy onto the pen drive and load it on the machine.");
  }

  function saveStl() {
    if (!files) return;
    download("relief.stl", files.stl, "model/stl");
    setNote("relief.stl — open in ArtCAM if you still want their toolpath.");
  }

  function saveHeight() {
    const canvas = depth.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      download("height.png", blob, "image/png");
      setNote("height.png — ArtCAM can read this as a relief bitmap.");
    });
  }

  async function writeDrive() {
    if (!files) return;
    const pick = (window as unknown as { showDirectoryPicker?: () => Promise<{ getFileHandle: (n: string, o?: { create?: boolean }) => Promise<{ createWritable: () => Promise<{ write: (d: BufferSource | Blob | string) => Promise<void>; close: () => Promise<void> }> }> }> }).showDirectoryPicker;
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
      setNote("Wrote carve.nc onto the drive. Take the stick to the machine.");
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
      <header className="head">
        <div>
          <div className="badge">Picture → relief → stick</div>
          <h1>Carve</h1>
          <p>Make the picture. Turn it into a 3D relief. Get a file the CNC will run — no bought design, no ArtCAM unless you want it.</p>
        </div>
      </header>

      <div className="strip" aria-label="Picture, depth, toolpath">
        <div className="cell">
          <span className="tag">1 Picture</span>
          {pic ? <img src={pic} alt="Generated or loaded design" /> : <div className="ph">Generate or drop a photo</div>}
        </div>
        <div className="cell">
          <span className="tag">2 Depth</span>
          {grid ? <canvas ref={depth} /> : <div className="ph">White stays high. Dark is the cut.</div>}
        </div>
        <div className="cell">
          <span className="tag">3 Toolpath</span>
          {grid ? <canvas ref={path} /> : <div className="ph">Raster path the machine will follow</div>}
        </div>
      </div>

      <div className="form">
        <div className="ask">
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What to carve" />
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
            <input type="number" value={cut.widthMm} onChange={(e) => setNum("widthMm", e.target.value)} />
          </label>
          <label>
            Height mm
            <input type="number" value={cut.heightMm} onChange={(e) => setNum("heightMm", e.target.value)} />
          </label>
          <label>
            Depth mm
            <input type="number" value={cut.depthMm} step={0.1} onChange={(e) => setNum("depthMm", e.target.value)} />
          </label>
          <label>
            Stepover mm
            <input type="number" value={cut.stepMm} step={0.1} onChange={(e) => setNum("stepMm", e.target.value)} />
          </label>
          <label>
            Feed
            <input type="number" value={cut.feed} onChange={(e) => setNum("feed", e.target.value)} />
          </label>
          <label>
            Safe Z
            <input type="number" value={cut.safeZ} onChange={(e) => setNum("safeZ", e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            Invert depth
          </label>
        </div>

        <div className="out">
          <button disabled={!ready} onClick={saveNc}>
            Download carve.nc
          </button>
          <button disabled={!ready} onClick={() => void writeDrive()}>
            Write pen drive
          </button>
          <button disabled={!ready} onClick={saveStl}>
            Download relief.stl
          </button>
          <button disabled={!ready} onClick={saveHeight}>
            Download height.png
          </button>
        </div>
        {err ? <p className="err">{err}</p> : null}
        {note ? <p className="ok">{note}</p> : null}
      </div>

      <p className="foot">
        This is a 2.5D relief, the same idea as ArtCAM: one picture becomes height, then a raster toolpath. Put
        <code> carve.nc </code> on the pen drive. If the machine still wants ArtCAM, use the STL or the height bitmap.
        Always dry-run above the wood — feeds and bit size are yours to check.
      </p>
    </div>
  );
}
