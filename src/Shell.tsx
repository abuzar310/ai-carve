/**
 * The app shell: routes, navigation, and the workspace.
 *
 * The workspace (App.tsx: the engine, AI depth and 3D) loads only when a /create/<workflow> route is
 * first opened, then stays mounted and hidden while you visit Home, Projects or Settings, so a built
 * relief and every setting survive the trip. That is how routes share state (UX_REBUILD Phase 0).
 */
import { lazy, Suspense, useEffect, useRef } from "react";
import { matchRoute, useLocation, type Route } from "./router";
import { Brand, BottomNav, SiteFooter, TopNav, type Section } from "./chrome";
import { CreatePage, HomePage, MissingPage, ProjectPage, ProjectsPage, SettingsPage } from "./pages";

const Workspace = lazy(() => import("./App"));

const TITLES: Record<Route["page"], string> = {
  home: "AI Carve: CNC relief design studio",
  create: "Create · AI Carve",
  projects: "Projects · AI Carve",
  settings: "Settings · AI Carve",
  workspace: "AI Carve",
  project: "Project · AI Carve",
  missing: "Not found · AI Carve",
};

function sectionOf(r: Route): Section | null {
  if (r.page === "home" || r.page === "create" || r.page === "projects" || r.page === "settings") return r.page;
  if (r.page === "project") return "projects";
  return null;
}

export function Shell() {
  const loc = useLocation();
  const route = matchRoute(loc.path);
  const inWs = route.page === "workspace";
  const opened = useRef(false);
  if (inWs) opened.current = true;

  useEffect(() => {
    if (route.page !== "workspace") document.title = TITLES[route.page];
  }, [route.page]);

  // focus the new page's heading after an in-app navigation (screen readers, keyboard users)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (inWs) return;
    const h = document.querySelector<HTMLElement>("#main h1");
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  }, [loc.key, inWs]);

  const at = sectionOf(route);
  let page = null;
  if (route.page === "home") page = <HomePage />;
  else if (route.page === "create") page = <CreatePage />;
  else if (route.page === "projects") page = <ProjectsPage />;
  else if (route.page === "settings") page = <SettingsPage />;
  else if (route.page === "project") page = <ProjectPage id={route.id} />;
  else if (route.page !== "workspace") page = <MissingPage />;

  return (
    <>
      {!inWs ? (
        <div className="site">
          <a className="skip" href="#main">
            Skip to content
          </a>
          <header className="bar site-bar">
            <Brand />
            <TopNav at={at} />
          </header>
          {page}
          {route.page === "home" || route.page === "settings" ? <SiteFooter /> : null}
          <BottomNav at={at} />
        </div>
      ) : null}
      {opened.current ? (
        <div hidden={!inWs} className="ws-host">
          <Suspense fallback={<div className="ws-loading" role="status">Opening the workspace…</div>}>
            <Workspace
              workflow={inWs ? route.workflow : null}
              navKey={loc.key}
              example={inWs ? loc.query.get("example") : null}
              recent={inWs ? loc.query.get("recent") : null}
            />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}
