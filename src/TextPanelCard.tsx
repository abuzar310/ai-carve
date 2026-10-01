import { BISMILLAH, FONTS, type FontId, type LetterStyle, type PanelSpec, type Template } from "./lib/textPanel";

const TEMPLATES: { id: Template; label: string; hint: string }[] = [
  { id: "names99", label: "99 Names", hint: "Bismillah + grid" },
  { id: "plate", label: "Name plate", hint: "Lines of text" },
  { id: "grid", label: "Word grid", hint: "One word per tile" },
];
const STYLES: { id: LetterStyle; label: string; hint: string }[] = [
  { id: "raised", label: "Raised", hint: "Rounded, sculpted" },
  { id: "vcarve", label: "V-carve", hint: "Cut in, 60° bit" },
  { id: "flat", label: "Flat", hint: "Straight walls" },
];

type Props = {
  spec: PanelSpec;
  setSpec: (f: (s: PanelSpec) => PanelSpec) => void;
  busy: boolean;
  built: boolean;
  onBuild: () => void;
  onRlf: () => void;
  onTif: () => void;
  onProof: () => void;
};

export function TextPanelCard({ spec, setSpec, busy, built, onBuild, onRlf, onTif, onProof }: Props) {
  const set = <K extends keyof PanelSpec>(k: K, v: PanelSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const num = (k: "widthMm" | "heightMm" | "columns", raw: string) => {
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0) set(k, v);
  };
  return (
    <div className="card text-panel">
      <h3>Text panel</h3>
      <div className="seg" role="group" aria-label="Template">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={spec.template === t.id}
            onClick={() =>
              setSpec((s) => ({
                ...s,
                template: t.id,
                header: t.id === "names99" ? BISMILLAH : t.id === "plate" ? "" : s.header === BISMILLAH ? "" : s.header,
                lines: t.id === "plate" && !s.lines.length ? ["بسم الله"] : s.lines,
              }))
            }
          >
            <strong>{t.label}</strong>
            <span>{t.hint}</span>
          </button>
        ))}
      </div>

      {spec.template === "names99" ? (
        <small>
          All 99 Names with الله, in the traditional order and correct spelling, typeset with a real Arabic font, so every dot and
          hamza is exact.
        </small>
      ) : (
        <label className="field">
          <span>{spec.template === "plate" ? "Text (one line per row)" : "Words (one per tile)"}</span>
          <textarea
            dir="auto"
            value={spec.lines.join("\n")}
            onChange={(e) => set("lines", e.target.value.split("\n"))}
            placeholder={spec.template === "plate" ? "بسم الله\nMohammed Abuzar" : "الرحمن\nالرحيم\nالملك"}
          />
        </label>
      )}

      {spec.template !== "plate" ? (
        <label className="field">
          <span>Header (optional)</span>
          <input type="text" dir="auto" value={spec.header} onChange={(e) => set("header", e.target.value)} />
        </label>
      ) : null}

      <div className="pair">
        <label className="field">
          <span>
            Width <em className="nums">{spec.widthMm}&nbsp;mm</em>
          </span>
          <input type="number" inputMode="decimal" min={20} value={spec.widthMm} onChange={(e) => num("widthMm", e.target.value)} />
        </label>
        <label className="field">
          <span>
            Height <em className="nums">{spec.heightMm}&nbsp;mm</em>
          </span>
          <input type="number" inputMode="decimal" min={20} value={spec.heightMm} onChange={(e) => num("heightMm", e.target.value)} />
        </label>
      </div>

      {spec.template === "grid" ? (
        <label className="field">
          <span>
            Columns <em className="nums">{spec.columns}</em>
          </span>
          <input type="number" inputMode="numeric" min={1} max={20} value={spec.columns} onChange={(e) => num("columns", e.target.value)} />
        </label>
      ) : null}

      <label className="field">
        <span>Font</span>
        <select value={spec.font} onChange={(e) => set("font", e.target.value as FontId)}>
          {(Object.keys(FONTS) as FontId[]).map((f) => (
            <option key={f} value={f}>
              {FONTS[f].label}
            </option>
          ))}
        </select>
      </label>

      <div className="seg" role="group" aria-label="Letter style">
        {STYLES.map((s) => (
          <button key={s.id} type="button" aria-pressed={spec.style === s.id} onClick={() => set("style", s.id)}>
            <strong>{s.label}</strong>
            <span>{s.hint}</span>
          </button>
        ))}
      </div>

      <label className="field">
        <span>
          {spec.style === "vcarve" ? "Carve depth" : "Letter height"} <em className="nums">{spec.letterMm.toFixed(1)}&nbsp;mm</em>
        </span>
        <input type="range" min={0.6} max={4} step={0.1} value={spec.letterMm} onChange={(e) => set("letterMm", Number(e.target.value))} />
      </label>

      <label className="toggle">
        <input type="checkbox" checked={spec.frame} onChange={(e) => set("frame", e.target.checked)} />
        Moulded frame
      </label>

      <button type="button" className="btn pri" disabled={busy} onClick={onBuild}>
        {built ? "Rebuild text panel" : "Build text panel"}
      </button>

      {built ? (
        <div className="actions two text-exports">
          <button type="button" className="btn ghost" disabled={busy} onClick={onRlf}>
            ArtCAM relief (.rlf)
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={onTif}>
            16-bit TIFF
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={onProof}>
            Proof image
          </button>
        </div>
      ) : null}
      <small>
        The .rlf and TIFF are made at 0.25&nbsp;mm detail. Download the proof image and have someone who reads the script check it
        before carving.
      </small>
    </div>
  );
}
