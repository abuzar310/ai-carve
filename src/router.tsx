/**
 * A tiny history router (no dependency): the current path + query, navigate(), and <Link>.
 * Every route is served by index.html (vite preview does this; on Vercel the rewrite in vercel.json).
 */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

export type Loc = { path: string; query: URLSearchParams; key: number };

let key = 0;
let cached: { href: string; loc: Loc } | null = null;
const listeners = new Set<() => void>();

function read(): Loc {
  const href = location.pathname + location.search;
  if (!cached || cached.href !== href) {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    cached = { href, loc: { path, query: new URLSearchParams(location.search), key } };
  }
  return cached.loc;
}

function emit() {
  cached = null;
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    key++;
    emit();
  });
}

/** Go to `to`. `replace` swaps the current entry (used to keep the URL in step with the workspace). */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const now = location.pathname + location.search;
  if (to === now) return;
  if (opts.replace) history.replaceState(null, "", to);
  else {
    key++;
    history.pushState(null, "", to);
    window.scrollTo(0, 0);
  }
  emit();
}

export function useLocation(): Loc {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    read,
  );
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean };

/** An <a> that navigates in-page; modifier clicks and middle clicks still open a new tab. */
export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return <a href={to} onClick={go} {...rest} />;
}

/** The workflows that open the workspace, and the route of each. */
export type Workflow = "image" | "text" | "names99" | "pattern" | "trace" | "depth";
export const WORKFLOW_PATH: Record<Workflow, string> = {
  image: "/create/image",
  text: "/create/text",
  names99: "/create/text/99-names",
  pattern: "/create/pattern",
  trace: "/create/trace",
  depth: "/create/depth-map",
};

export type Route =
  | { page: "home" }
  | { page: "create" }
  | { page: "projects" }
  | { page: "settings" }
  | { page: "workspace"; workflow: Workflow }
  | { page: "project"; id: string }
  | { page: "missing" };

export function matchRoute(path: string): Route {
  if (path === "/") return { page: "home" };
  if (path === "/create") return { page: "create" };
  if (path === "/projects") return { page: "projects" };
  if (path === "/settings") return { page: "settings" };
  for (const w of ["image", "text", "names99", "pattern", "trace", "depth"] as const) if (path === WORKFLOW_PATH[w]) return { page: "workspace", workflow: w };
  const p = /^\/project\/([\w-]{1,64})$/.exec(path);
  if (p) return { page: "project", id: p[1]! };
  return { page: "missing" };
}
