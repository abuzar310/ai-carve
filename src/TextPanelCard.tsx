import { useEffect, useRef, useState } from "react";
import { FONTS, switchTemplate, type FontId, type LetterStyle, type PanelSpec, type Template } from "./lib/textPanel";
import { SURE, applyHit, search, type Hit, type QuranIndex } from "./lib/quranSearch";
import { loadFont } from "./lib/textRaster";

let quranIndex: Promise<QuranIndex> | null = null;
function loadQuran(): Promise<QuranIndex> {
  if (!quranIndex) {
    quranIndex = fetch("/data/quran.json").then((r) => {
      if (!r.ok) throw new Error("Couldn’t load the Quran library. Check your connection and try again.");
      return r.json() as Promise<QuranIndex>;
    });
    quranIndex.catch(() => (quranIndex = null));
  }
  return quranIndex;
}

function FindArabic({ spec, setSpec }: { spec: PanelSpec; setSpec: Props["setSpec"] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [state, setState] = useState<"" | "loading" | "searching" | "error">("");
  const [msg, setMsg] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const run = async (query: string) => {
    if (query.trim().length < 2) return setHits(null);
    try {
      setState("loading");
      const [index] = await Promise.all([loadQuran(), loadFont("quran"), loadFont("naskh")]);
      setState("searching");
      await new Promise((r) => setTimeout(r, 0));
      setHits(search(index, query));
      setState("");
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(q), 450);
    return () => window.clearTimeout(timer.current);
  }, [q]);
  const lines = spec.template !== "names99";
  return (
    <div className="find-arabic">
      <label className="field">
        <span>Find Arabic</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              window.clearTimeout(timer.current);
              void run(q);
            }
          }}
          name="find-arabic"
          placeholder="inna lillahi wa inna ilayhi rajiun…"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="find-hint"
        />
        <small id="find-hint">Type how it sounds in English, a name like Ar-Rahman, a surah name, or a reference like 2:255.</small>
      </label>
      <div aria-live="polite">
        {state === "loading" ? <small>Loading the Quran library…</small> : null}
        {state === "searching" ? <small>Searching…</small> : null}
        {state === "error" ? <small className="err">{msg}</small> : null}
        {hits && !state && !hits.length ? <small>No close match. Try another spelling, or a reference like 112:1.</small> : null}
      </div>
      {hits && hits.length && hits.every((h) => h.score < SURE) ? (
        <p className="no-sure" role="note">
          No exact match. The library has the Quran, the 99 Names and common phrases — personal names aren’t in it yet. The
          results below only sound similar; don’t use them unless one is what you meant.
        </p>
      ) : null}
      {hits && hits.length ? (
        <ul className="hits">
          {hits.map((h, i) => (
            <li key={i} className={h.score >= SURE ? "sure" : ""}>
              <p className="ar" lang="ar" dir="rtl" style={{ fontFamily: `"${FONTS[h.kind === "quran" || h.kind === "surah" ? "quran" : "naskh"].family}", serif` }}>
                {h.arabic}
              </p>
              <p className="meta">
                <b className="nums">{Math.round(h.score * 100)}%</b> {h.score >= SURE ? "match" : "close"} · {h.source}
              </p>
              <div className="hit-acts">
                {lines ? (
                  <button type="button" className="btn ghost" onClick={() => setSpec((s) => applyHit(s, h, "line"))}>
                    Add as line
                  </button>
                ) : null}
                <button type="button" className="btn ghost" onClick={() => setSpec((s) => applyHit(s, h, "header"))}>
                  Use as header
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <small className="credit">Quran text: quranenc.com (Uthmani) · transliteration: tanzil.net · CC BY-SA 4.0</small>
    </div>
  );
}

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
            onClick={() => setSpec((s) => switchTemplate(s, t.id))
            }
          >
            <strong>{t.label}</strong>
            <span>{t.hint}</span>
          </button>
        ))}
      </div>

      <FindArabic spec={spec} setSpec={setSpec} />

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
            name="panel-text"
            autoComplete="off"
            value={spec.lines.join("\n")}
            onChange={(e) => set("lines", e.target.value.split("\n"))}
            placeholder={spec.template === "plate" ? "بسم الله\nMohammed Abuzar…" : "الرحمن\nالرحيم\nالملك…"}
          />
        </label>
      )}

      {spec.template !== "plate" ? (
        <label className="field">
          <span>Header (optional)</span>
          <input type="text" dir="auto" name="panel-header" autoComplete="off" value={spec.header} onChange={(e) => set("header", e.target.value)} />
        </label>
      ) : null}

      <div className="pair">
        <label className="field">
          <span>
            Width <em className="nums">{spec.widthMm}&nbsp;mm</em>
          </span>
          <input type="number" name="panel-width" autoComplete="off" inputMode="decimal" min={20} value={spec.widthMm} onChange={(e) => num("widthMm", e.target.value)} />
        </label>
        <label className="field">
          <span>
            Height <em className="nums">{spec.heightMm}&nbsp;mm</em>
          </span>
          <input type="number" name="panel-height" autoComplete="off" inputMode="decimal" min={20} value={spec.heightMm} onChange={(e) => num("heightMm", e.target.value)} />
        </label>
      </div>

      {spec.template === "grid" ? (
        <label className="field">
          <span>
            Columns <em className="nums">{spec.columns}</em>
          </span>
          <input type="number" name="panel-columns" autoComplete="off" inputMode="numeric" min={1} max={20} value={spec.columns} onChange={(e) => num("columns", e.target.value)} />
        </label>
      ) : null}

      <label className="field">
        <span>Font</span>
        <select name="panel-font" value={spec.font} onChange={(e) => set("font", e.target.value as FontId)}>
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
