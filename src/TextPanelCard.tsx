import { useEffect, useRef, useState } from "react";
import { FONTS, SIZE_MAX, SIZE_MIN, sizeProblem, switchTemplate, type FontId, type LetterStyle, type PanelSpec, type Template } from "./lib/textPanel";
import { SURE, applyHit, search, type Hit, type QuranIndex } from "./lib/quranSearch";
import { parseAiReply, type Candidate } from "./lib/aiPick";

let aiOn: Promise<boolean> | null = null;
/** Is smart search set up on this site (GEMINI_API_KEY in Vercel)? */
function smartSearchEnabled(): Promise<boolean> {
  if (!aiOn)
    aiOn = fetch("/api/find")
      .then((r) => (r.ok ? (r.json() as Promise<{ enabled?: boolean }>) : { enabled: false }))
      .then((d) => !!d.enabled)
      .catch(() => false);
  return aiOn;
}
import { loadFont } from "./lib/textRaster";

let quranIndex: Promise<QuranIndex> | null = null;
function loadQuran(): Promise<QuranIndex> {
  if (!quranIndex) {
    quranIndex = fetch("/data/quran.json")
      .catch(() => {
        throw new Error("Couldn’t load the Quran library. Check your connection and try again.");
      })
      .then((r) => {
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
  const [ai, setAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHits, setAiHits] = useState<Hit[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    void smartSearchEnabled().then(setAi);
    // start fetching the library now, so it is usually ready before the first search
    const idle = (window as Window & { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 300));
    idle(() => {
      void loadQuran().catch(() => {});
      void loadFont("naskh").catch(() => {});
      void loadFont("quran").catch(() => {});
    });
  }, []);
  const latestQ = useRef(q);
  latestQ.current = q;
  const smart = async () => {
    const asked = q;
    setAiBusy(true);
    setMsg("");
    try {
      const index = await loadQuran();
      const cands: Candidate[] = search(index, q, 30, 0.45).map((h, id) => ({ id, label: h.label, source: h.source, arabic: h.arabic, kind: h.kind }));
      const r = await fetch("/api/find", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q, candidates: cands.map(({ id, label, source }) => ({ id, label, source })) }),
      });
      const data = (await r.json()) as { text?: string; error?: string };
      if (!r.ok) throw new Error(data.error || "Smart search failed. Try again.");
      if (latestQ.current !== asked) return; // the search changed while the AI was answering
      const picks = parseAiReply(data.text ?? "", cands, index);
      setAiHits(picks);
      if (!picks.length) setMsg("Smart search found nothing in the library either.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };
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
    setAiHits(null);
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
        <small id="find-hint">Type how it sounds in English, type it in Arabic, or give a name like Ar-Rahman, a surah name or a reference like 2:255.</small>
      </label>
      <div aria-live="polite">
        {state === "loading" ? <small>Loading the Quran library (about 0.5&nbsp;MB, once)…</small> : null}
        {state === "searching" ? <small>Searching…</small> : null}
        {state === "error" ? <small className="err">{msg}</small> : null}
        {hits && !state && hits[0]?.kind === "note" ? <small>{hits[0].label}</small> : null}
      {hits && !state && !hits.length && !aiHits?.length ? <small>No close match. Try another spelling, or a reference like 112:1.</small> : null}
      </div>
      {ai && hits && !state && hits[0]?.kind !== "note" && !hits.some((h) => h.score >= SURE) ? (
        <button type="button" className="btn ghost smart" disabled={aiBusy} onClick={() => void smart()}>
          {aiBusy ? "Asking AI…" : "Smart search with AI"}
        </button>
      ) : null}
      {msg && state !== "error" ? <small aria-live="polite">{msg}</small> : null}
      {hits && hits.length && hits[0]?.kind !== "note" && hits.every((h) => h.score < SURE) && !aiHits?.length ? (
        <p className="no-sure" role="note">
          No exact match. The library has the Quran, the 99 Names and common phrases — personal names aren’t in it yet. The
          results below only sound similar; don’t use them unless one is what you meant.
        </p>
      ) : null}
      {(aiHits?.length ? aiHits : hits)?.length && hits?.[0]?.kind !== "note" ? (
        <ul className="hits">
          {(aiHits?.length ? aiHits : hits ?? []).map((h, i) => (
            <li key={i} className={h.ai ? "ai" : h.score >= SURE ? "sure" : ""}>
              <p className="ar" lang="ar" dir="rtl" style={{ fontFamily: `"${FONTS[h.kind === "quran" || h.kind === "surah" ? "quran" : "naskh"].family}", serif` }}>
                {h.arabic}
              </p>
              <p className="meta">
                {h.ai ? (
                  <>
                    <b>AI suggestion</b> · {h.source.replace(/^AI pick · /, "")} · check it before carving
                  </>
                ) : (
                  <>
                    <b className="nums">{Math.round(h.score * 100)}%</b> {h.score >= SURE ? "match" : "close"} · {h.source}
                  </>
                )}
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
  /** settings changed since the last build */
  stale?: boolean;
  /** median letter height of the built panel (0 = not built) */
  letterMm: number;
  onBuild: () => void;
};

export function TextPanelCard({ spec, setSpec, busy, built, letterMm, onBuild, stale }: Props) {
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
          <input type="number" name="panel-width" autoComplete="off" inputMode="decimal" min={SIZE_MIN} max={SIZE_MAX} aria-invalid={!(spec.widthMm >= SIZE_MIN && spec.widthMm <= SIZE_MAX)} aria-describedby="size-err" value={spec.widthMm} onChange={(e) => num("widthMm", e.target.value)} />
        </label>
        <label className="field">
          <span>
            Height <em className="nums">{spec.heightMm}&nbsp;mm</em>
          </span>
          <input type="number" name="panel-height" autoComplete="off" inputMode="decimal" min={SIZE_MIN} max={SIZE_MAX} aria-invalid={!(spec.heightMm >= SIZE_MIN && spec.heightMm <= SIZE_MAX)} aria-describedby="size-err" value={spec.heightMm} onChange={(e) => num("heightMm", e.target.value)} />
        </label>
      </div>
      {sizeProblem(spec) ? (
        <small id="size-err" className="field-err" role="alert">
          {sizeProblem(spec)}
        </small>
      ) : null}

      {spec.template === "grid" ? (
        <label className="field">
          <span>
            Columns <em className="nums">{spec.columns}</em>
          </span>
          <input type="number" name="panel-columns" autoComplete="off" inputMode="numeric" min={1} max={20} value={spec.columns} onChange={(e) => num("columns", e.target.value)} />
        </label>
      ) : null}

      {spec.font === "naskh" && spec.template !== "names99" && /[\u0671\u06d6-\u06dc\u06e1]/.test(spec.lines.join(" ")) ? (
        <p className="font-hint" role="note">
          This looks like Quran text. Its marks show best in the Quran script.{" "}
          <button type="button" className="linkish" onClick={() => set("font", "quran")}>
            Use Quran script
          </button>
        </p>
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
          {spec.style === "vcarve" ? "Carve depth" : "Letters raised by"} <em className="nums">{spec.letterMm.toFixed(1)}&nbsp;mm</em>
        </span>
        <input type="range" min={0.6} max={4} step={0.1} value={spec.letterMm} onChange={(e) => set("letterMm", Number(e.target.value))} />
      </label>

      <label className="toggle">
        <input type="checkbox" checked={spec.frame} onChange={(e) => set("frame", e.target.checked)} />
        Moulded frame
      </label>

      {letterMm > 0 ? (
        <p className={"letter-size" + (letterMm < 6 ? " warn" : "")} role="status">
          Letters about <b className="nums">{letterMm < 10 ? letterMm.toFixed(1) : Math.round(letterMm)}&nbsp;mm</b> tall
          {letterMm < 6 ? " — too small to carve cleanly. Make the panel bigger or use fewer words." : "."}
        </p>
      ) : null}
      {stale ? (
        <p className="stale-note" role="status">
          You changed the panel. Rebuild to update the 3D preview and the downloads.
        </p>
      ) : null}
      <button type="button" className="btn pri" disabled={busy || !!sizeProblem(spec)} onClick={onBuild}>
        {built ? "Rebuild text panel" : "Build text panel"}
      </button>

      <small>
        After building, download the STL, .rlf or TIFF from Export. Check the proof image with someone who reads the script before
        carving.
      </small>
    </div>
  );
}
