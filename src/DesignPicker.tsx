import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, DESIGNS, applyDesign, resolveSrc, type Category, type Design } from "./lib/designs";
import { FONTS, type PanelSpec } from "./lib/textPanel";
import type { QuranIndex } from "./lib/quranSearch";
import { loadFont } from "./lib/textRaster";
import { PatternArt } from "./PatternArt";

type Props = {
  spec: PanelSpec;
  setSpec: (f: (s: PanelSpec) => PanelSpec) => void;
  loadQuran: () => Promise<QuranIndex>;
  /** Called after a design is put into the panel. */
  onPicked: (d: Design) => void;
  startOpen: boolean;
};

const size = (d: Design) => `${d.spec.widthMm ?? 600} × ${d.spec.heightMm ?? 600} mm`;

/** A small carved plaque: the design's proportions, frame and Arabic, drawn with the carving font. */
function Plaque({ d, text, small }: { d: Design; text: string; small?: boolean }) {
  const w = d.spec.widthMm ?? 600;
  const h = d.spec.heightMm ?? 600;
  const ratio = Math.min(2.6, Math.max(d.spec.template === "pattern" ? 0.5 : 0.75, w / h));
  const font = FONTS[d.spec.font === "quran" ? "quran" : "naskh"].family;
  const long = [...text].length > 18;
  const pattern = d.spec.template === "pattern";
  const medallion = pattern && d.spec.medallion === "circle";
  return (
    <span
      className={"plaque" + (small ? " small" : "") + (d.spec.corners === "flowers" ? " flowers" : "") + (d.spec.shape && d.spec.shape !== "rect" ? " " + d.spec.shape : "")}
      style={{ aspectRatio: String(ratio) }}
      aria-hidden="true"
    >
      <span className={"plaque-face" + (pattern ? " has-pattern" : "")} style={{ fontFamily: `${font}, "Amiri", serif` }} dir="rtl">
        {pattern ? <PatternArt className="plaque-pattern" kind={d.spec.pattern ?? "star8"} repeats={d.spec.repeats ?? 3} ratio={w / h} medallion={medallion} /> : null}
        {!pattern || medallion ? <span className={long ? "plaque-text long" : "plaque-text"}>{text}</span> : null}
      </span>
    </span>
  );
}

export function DesignPicker({ spec, setSpec, loadQuran, onPicked, startOpen }: Props) {
  const [open, setOpen] = useState(startOpen);
  const [cat, setCat] = useState<Category>("home");
  const [index, setIndex] = useState<QuranIndex | null>(null);
  const [picked, setPicked] = useState<Design | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // fonts for the previews, and the library for Quran previews (already prefetched by the app)
    void loadFont("naskh").catch(() => {});
    void loadFont("quran").catch(() => {});
    if (!index) loadQuran().then(setIndex, () => {});
  }, [open, index, loadQuran]);

  const shown = useMemo(() => DESIGNS.filter((d) => d.category === cat), [cat]);
  const previewOf = (d: Design) => resolveSrc(d.preview, index) ?? (d.ask === "name" ? "محمد" : "…");

  async function pick(d: Design) {
    setErr(null);
    setBusy(d.id);
    try {
      let next = applyDesign(d, index, spec);
      if (!next) {
        const idx = await loadQuran();
        setIndex(idx);
        next = applyDesign(d, idx, spec);
      }
      if (!next) throw new Error("This design’s text could not be found in the Quran library.");
      const ready = next;
      setSpec(() => ready);
      setPicked(d);
      setOpen(false);
      onPicked(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t load this design. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <div className="design-chosen">
        {picked ? <Plaque d={picked} text={previewOf(picked)} small /> : null}
        <div className="design-chosen-text">
          {picked ? (
            <>
              <strong>{picked.title}</strong>
              <span>
                {picked.ask === "name" ? "Type the name below, then build." : "Change anything below, then build."}
              </span>
            </>
          ) : (
            <>
              <strong>Ready-made designs</strong>
              <span>Plaques, verses and boards to start from.</span>
            </>
          )}
        </div>
        <button type="button" className="btn ghost" onClick={() => setOpen(true)} aria-expanded="false" aria-controls="design-list">
          {picked ? "Change" : "Browse"}
        </button>
      </div>
    );
  }

  return (
    <section className="designs" aria-label="Ready-made designs">
      <div className="designs-head">
        <strong>Start from a design</strong>
        <button type="button" className="linkish" onClick={() => setOpen(false)} aria-expanded="true" aria-controls="design-list">
          Hide
        </button>
      </div>
      <div className="design-cats" role="group" aria-label="Design type">
        {CATEGORIES.map((c) => (
          <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <ul className="design-list" id="design-list">
        {shown.map((d) => (
          <li key={d.id}>
            <button type="button" className="design-card" onClick={() => void pick(d)} disabled={!!busy} aria-busy={busy === d.id}>
              <Plaque d={d} text={previewOf(d)} />
              <span className="design-title">{d.title}</span>
              <span className="design-hint">{d.hint}</span>
              <span className="design-size nums">{busy === d.id ? "Loading…" : size(d)}</span>
            </button>
          </li>
        ))}
      </ul>
      {err ? (
        <p className="field-err" role="alert">
          {err}
        </p>
      ) : null}
    </section>
  );
}
