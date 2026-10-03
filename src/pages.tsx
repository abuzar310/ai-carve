/** The light pages: Home, Create, Projects, Settings. None of them loads the engine, the AI model or 3D. */
import { useEffect, useState } from "react";
import { Link, WORKFLOW_PATH, navigate } from "./router";
import { WORKFLOWS, type WorkflowCard } from "./workflows";
import { RECENT_KEY, ago, duplicateRecent, recentRows, removeRecent, renameRecent, type RecentRow } from "./lib/recentLite";
import { MATERIALS } from "./lib/material";
import { QUALITY_PREFS, clearKey, readMaterial, readQuality, readRaw, writeMaterial, writeQuality, PREFS_EVENT, type QualityPref } from "./lib/prefs";

const KIND_LABEL: Record<RecentRow["kind"], string> = { names99: "99 Names", pattern: "Pattern", text: "Text / Arabic" };

function useRecent(): RecentRow[] {
  const [rows, setRows] = useState<RecentRow[]>(() => recentRows(readRaw(RECENT_KEY)));
  useEffect(() => {
    const again = () => setRows(recentRows(readRaw(RECENT_KEY)));
    window.addEventListener(PREFS_EVENT, again);
    window.addEventListener("focus", again);
    return () => {
      window.removeEventListener(PREFS_EVENT, again);
      window.removeEventListener("focus", again);
    };
  }, []);
  return rows;
}

function changeRecent(next: string | null) {
  if (next === null) return;
  try {
    localStorage.setItem(RECENT_KEY, next);
  } catch {
    return; // private mode: nothing stored, nothing to change
  }
  window.dispatchEvent(new Event(PREFS_EVENT));
}

function RecentList({ rows, limit, actions }: { rows: RecentRow[]; limit?: number; actions?: boolean }) {
  const now = Date.now();
  return (
    <ul className="recent-list">
      {rows.slice(0, limit).map((r) => (
        <li key={r.at} className="recent-item">
          <Link to={`/project/${r.at}`} className="recent-row">
            <span className="recent-title" dir="auto" lang={r.rtl ? "ar" : undefined}>
              {r.title}
            </span>
            <span className="recent-meta nums">
              {KIND_LABEL[r.kind]}, {r.widthMm} × {r.heightMm} mm, {ago(r.at, now)}
            </span>
            <span className="recent-open">Open</span>
          </Link>
          {actions ? (
            <div className="recent-acts">
              <button type="button" className="linkish" onClick={() => changeRecent(duplicateRecent(readRaw(RECENT_KEY), r.at, Date.now()))}>
                Duplicate
              </button>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  const name = window.prompt("Project name (leave empty to use the design’s own title):", r.named ? r.title : "");
                  if (name !== null) changeRecent(renameRecent(readRaw(RECENT_KEY), r.at, name));
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="linkish danger"
                onClick={() => {
                  if (window.confirm(`Delete “${r.title}”? This cannot be undone.`)) changeRecent(removeRecent(readRaw(RECENT_KEY), r.at));
                }}
              >
                Delete
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}


/** /learn — what AI Carve does and how, in plain words. Static: no engine, no model. */
export function LearnPage() {
  return (
    <main id="main" className="page learn">
      <h1>How AI Carve works</h1>
      <p className="lede">From a picture or a text to a file your CNC machine can carve, in five steps.</p>
      <ol className="how">
        <li><b>01 Start</b> Upload, drag, paste or photograph a picture — or pick a text design: names, Quran verses, the 99 Names, star patterns.</li>
        <li><b>02 Shape</b> Photos become depth with an AI model (or your own height map, no AI). Text is typeset exactly from real Arabic fonts — never drawn by an image model.</li>
        <li><b>03 Size</b> Width, height, relief depth and base, all in millimetres. Width and height follow the picture’s proportions.</li>
        <li><b>04 Inspect</b> Turn the 3D relief, check it in wood or stone preview, read the verification list: a tick only appears when code just checked it.</li>
        <li><b>05 Export</b> STL for any CNC software, ArtCAM .rlf, 16-bit TIFF, vectors as DXF and SVG, and a proof image.</li>
      </ol>
      <h2>Exact Arabic. Not AI-generated glyphs.</h2>
      <p>
        Arabic here never comes from an image model guessing at letterforms. Every word is verified Unicode from the Quran library or vetted
        lists, rendered through real Arabic fonts into geometry. The 99 Names panel is checked against the library on every change —
        100 of 100 words, in reading order, nothing repeated — and a black-on-white proof shows the exact lettering before you carve.
      </p>
      <p>
        <Link className="btn pri" to={WORKFLOW_PATH.names99}>Open the 99 Names panel</Link>
      </p>
      <h2>Files you get</h2>
      <p>
        <b>CNC &amp; 3D:</b> STL (every CNC program and slicer) · ArtCAM relief .rlf · 16-bit TIFF height map at 0.25 mm.
        <br />
        <b>Vectors:</b> DXF and SVG with letters, pattern lines and the cut outline on separate layers.
        <br />
        <b>Checking:</b> proof PNG and height BMP.
      </p>
      <p className="meta">
        All values are millimetres. An STL file itself carries no unit — AI Carve writes millimetre values and the export panel says so,
        so set your CNC software to mm when importing.
      </p>
      <h2>Common questions</h2>
      <dl className="faq">
        <dt>Is it free?</dt>
        <dd>Yes. Building and every export are free.</dd>
        <dt>Where do my pictures go?</dt>
        <dd>Nowhere. The relief is built in your browser; pictures are not uploaded to a server.</dd>
        <dt>Does it work with ArtCAM, Aspire or Carveco?</dt>
        <dd>Yes — open the STL, or use the native .rlf and 16-bit TIFF exports made at 0.25 mm detail.</dd>
        <dt>Can I 3D-print a panel?</dt>
        <dd>Yes: give it a base thickness in the Size step so the mesh is a closed solid, then print the STL.</dd>
        <dt>Where are my projects saved?</dt>
        <dd>In this browser. The last 12 text and pattern panels appear under Projects; photo reliefs are not saved yet.</dd>
        <dt>Which picture works best?</dt>
        <dd>A sharp, evenly lit photo of a carving or artwork. JPG, PNG, WebP or BMP — drag and drop or paste works too.</dd>
      </dl>
      <p>
        <Link className="btn pri" to="/create">Start a project</Link>
      </p>
    </main>
  );
}

/** /project/:id — a project link opens the workspace at that saved design. */
export function ProjectPage({ id }: { id: string }) {
  useEffect(() => {
    navigate(`${WORKFLOW_PATH.text}?recent=${id}`, { replace: true });
  }, [id]);
  return null;
}

function StartCard({ w }: { w: WorkflowCard }) {
  return (
    <li className="wf-card">
      <Link to={WORKFLOW_PATH[w.id]} className="wf-main">
        <img src={w.img} alt={w.imgAlt} width={480} height={300} decoding="async" />
        <span className="wf-text">
          <span className="wf-title">{w.title}</span>
          <span className="wf-does">{w.does}</span>
          <span className="wf-gives">{w.gives}</span>
        </span>
      </Link>
      <Link to={`${WORKFLOW_PATH[w.id]}?example=${w.example}`} className="wf-try">
        {w.exampleLabel}
      </Link>
    </li>
  );
}

export function HomePage() {
  const rows = useRecent();
  return (
    <main id="main" className="page home">
      <section className="hero" aria-labelledby="home-title">
        <h1 id="home-title">CNC relief design studio</h1>
        <p className="lede">
          Make a carving file from a name, a Quran verse, a photo or a star pattern. Arabic is typeset exactly from real fonts. Files open in ArtCAM,
          Aspire, Carveco and any CNC software that reads STL.
        </p>
        <Link to="/create" className="btn pri hero-cta">
          New project
        </Link>
      </section>

      <section className="strip" aria-label="How it works">
        <p className="meta">
          <b>How it works:</b> start from a picture or a text · shape the relief · size it in millimetres · inspect in 3D · export
          CNC files. <Link to="/learn">The five steps, explained</Link>.
        </p>
      </section>
      <section className="strip arabic-strip" aria-label="Exact Arabic">
        <img src="/examples/ex-name.webp" alt="Carved name plaque with flower corners" width={480} height={300} loading="lazy" decoding="async" />
        <div>
          <h2>Exact Arabic. Not AI-generated glyphs.</h2>
          <p className="meta">
            Verified Unicode, real Arabic fonts, and a 99 Names panel checked 100 of 100 against the library on every change — with a
            proof of the exact lettering before you carve. <Link to={WORKFLOW_PATH.names99}>Open 99 Names</Link>
          </p>
        </div>
      </section>


      <section className="block" aria-labelledby="start-title">
        <h2 id="start-title">Start a project</h2>
        <ul className="wf-grid">
          {WORKFLOWS.map((w) => (
            <StartCard key={w.id} w={w} />
          ))}
        </ul>
      </section>

      {rows.length ? (
        <section className="block" aria-labelledby="recent-title">
          <div className="block-head">
      <h2 id="recent-title">Recent</h2>
            <Link to="/projects" className="linkish">
              All projects
            </Link>
          </div>
          <RecentList rows={rows} limit={4} />
        </section>
      ) : null}

      <section className="block files" aria-labelledby="files-title">
        <h2 id="files-title">Files you get</h2>
        <dl className="file-groups">
          <div>
            <dt>For carving</dt>
            <dd>STL, ArtCAM relief (.rlf), 16-bit TIFF height map</dd>
          </div>
          <div>
            <dt>For V-carving and cutting</dt>
            <dd>Layered DXF and SVG vectors, cut outline DXF</dd>
          </div>
          <div>
            <dt>For checking</dt>
            <dd>Proof picture of the exact lettering, height BMP</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

export function CreatePage() {
  return (
    <main id="main" className="page create">
      <h1>What would you like to make?</h1>
      <ul className="choose">
        {WORKFLOWS.map((w) => (
          <li key={w.id}>
            <Link to={WORKFLOW_PATH[w.id]} className="choose-row">
              <img src={w.img} alt="" width={480} height={300} decoding="async" />
              <span className="wf-text">
                <span className="wf-title">{w.title}</span>
                <span className="wf-does">{w.does}</span>
                <span className="wf-gives">{w.gives}</span>
              </span>
            </Link>
            {w.id === "text" ? (
              <Link to={WORKFLOW_PATH.names99} className="choose-sub">
                Go straight to the 99 Names panel
              </Link>
            ) : null}
          </li>
        ))}
        <li>
          <Link to={WORKFLOW_PATH.depth} className="choose-row">
            <img src="/examples/ex-photo.webp" alt="" width={480} height={300} decoding="async" />
            <span className="wf-text">
              <span className="wf-title">Depth map</span>
              <span className="wf-does">Already have a height map? It becomes the relief directly — no AI.</span>
              <span className="wf-gives">White is high, black is deep</span>
            </span>
          </Link>
        </li>
      </ul>
    </main>
  );
}

const TABS = [
  ["all", "All"],
  ["text", "Text / Arabic"],
  ["names99", "99 Names"],
  ["pattern", "Pattern"],
] as const;

export function ProjectsPage() {
  const rows = useRecent();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const shown = tab === "all" ? rows : rows.filter((r) => r.kind === tab);
  return (
    <main id="main" className="page projects">
      <h1>Projects</h1>
      <p className="lede">Text and pattern panels you build are kept in this browser, the last 12. Photo reliefs are not saved yet.</p>
      {rows.length ? (
        <div className="proj-tabs" role="group" aria-label="Project type">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {rows.length ? (
        shown.length ? (
          <RecentList rows={shown} actions />
        ) : (
          <p className="meta">No {TABS.find(([id]) => id === tab)?.[1].toLowerCase()} projects yet.</p>
        )
      ) : (
        <div className="empty-note">
          <p>No projects yet. Build a text or pattern panel and it will be listed here.</p>
          <Link to="/create" className="btn pri">
            New project
          </Link>
        </div>
      )}
    </main>
  );
}

export function SettingsPage() {
  const [quality, setQ] = useState<QualityPref>(readQuality);
  const [material, setM] = useState(() => {
    const m = readMaterial();
    return MATERIALS.some((x) => x.id === m) ? m! : "classic";
  });
  const rows = useRecent();
  const [cleared, setCleared] = useState(false);
  return (
    <main id="main" className="page settings">
      <h1>Settings</h1>
      <p className="lede">Kept in this browser only.</p>

      <section className="set-row" aria-labelledby="units-h">
        <h2 id="units-h">Units</h2>
        <p>Millimetres. Every size and every export is in mm.</p>
      </section>

      <section className="set-row" aria-labelledby="quality-h">
        <h2 id="quality-h">Photo relief quality</h2>
        <p>Used for new photo reliefs. You can still change it in each project.</p>
        <div className="seg three" role="radiogroup" aria-labelledby="quality-h">
          {QUALITY_PREFS.map((q) => (
            <button
              key={q.id}
              type="button"
              role="radio"
              aria-checked={quality === q.id}
              aria-pressed={quality === q.id}
              onClick={() => {
                setQ(q.id);
                writeQuality(q.id);
              }}
            >
              <strong>{q.label}</strong>
              <span>{q.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="set-row" aria-labelledby="mat-h">
        <h2 id="mat-h">3D preview material</h2>
        <p>Only changes how the preview looks. Exported files are the same.</p>
        <select
          className="field"
          name="pref-material"
          aria-labelledby="mat-h"
          value={material}
          onChange={(e) => {
            setM(e.target.value);
            writeMaterial(e.target.value);
          }}
        >
          {MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </section>

      <section className="set-row" aria-labelledby="data-h">
        <h2 id="data-h">Saved projects</h2>
        <p>
          {rows.length ? `${rows.length} recent ${rows.length === 1 ? "design" : "designs"} in this browser.` : cleared ? "Cleared." : "Nothing saved yet."}
        </p>
        <button
          type="button"
          className="btn ghost"
          disabled={!rows.length}
          onClick={() => {
            if (!window.confirm("Remove the recent designs list from this browser?")) return;
            clearKey(RECENT_KEY);
            setCleared(true);
          }}
        >
          Clear recent designs
        </button>
      </section>
    </main>
  );
}


export function MissingPage() {
  return (
    <main id="main" className="page">
      <h1>Page not found</h1>
      <p className="lede">This address does not lead anywhere in AI Carve.</p>
      <p className="actions-row">
        <Link to="/" className="btn pri">
          Go home
        </Link>
        <Link to="/projects" className="btn ghost">
          Projects
        </Link>
      </p>
    </main>
  );
}
