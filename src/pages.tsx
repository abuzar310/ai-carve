/** The light pages: Home, Create, Projects, Settings. None of them loads the engine, the AI model or 3D. */
import { useEffect, useState } from "react";
import { Link, WORKFLOW_PATH } from "./router";
import { WORKFLOWS, type WorkflowCard } from "./workflows";
import { RECENT_KEY, ago, recentRows, type RecentRow } from "./lib/recentLite";
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

function RecentList({ rows, limit }: { rows: RecentRow[]; limit?: number }) {
  const now = Date.now();
  return (
    <ul className="recent-list">
      {rows.slice(0, limit).map((r) => (
        <li key={r.at}>
          <Link to={`${WORKFLOW_PATH.text}?recent=${r.at}`} className="recent-row">
            <span className="recent-title" dir="auto" lang={r.rtl ? "ar" : undefined}>
              {r.title}
            </span>
            <span className="recent-meta nums">
              {KIND_LABEL[r.kind]}, {r.widthMm} × {r.heightMm} mm, {ago(r.at, now)}
            </span>
            <span className="recent-open">Open</span>
          </Link>
        </li>
      ))}
    </ul>
  );
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

export function ProjectsPage() {
  const rows = useRecent();
  return (
    <main id="main" className="page projects">
      <h1>Projects</h1>
      <p className="lede">Text and pattern panels you build are kept in this browser, the last 12. Photo reliefs are not saved yet.</p>
      {rows.length ? (
        <RecentList rows={rows} />
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
