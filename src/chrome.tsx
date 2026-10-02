/** Site chrome shared by every page: brand, top navigation, phone bottom navigation, footer. */
import { Link } from "./router";

export type Section = "home" | "create" | "projects" | "settings";

const NAV: { id: Section; label: string; to: string }[] = [
  { id: "home", label: "Home", to: "/" },
  { id: "create", label: "Create", to: "/create" },
  { id: "projects", label: "Projects", to: "/projects" },
  { id: "settings", label: "Settings", to: "/settings" },
];

export function Brand() {
  return (
    <Link className="brand" to="/" translate="no" aria-label="AI Carve home">
      <span className="kicker">AI Carve</span>
      <span className="word">Carve</span>
    </Link>
  );
}

/** Desktop and tablet: links in the top bar. Hidden on phones, where the bottom bar takes over. */
export function TopNav({ at }: { at: Section | null }) {
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map((n) => (
        <Link key={n.id} to={n.to} aria-current={at === n.id ? "page" : undefined}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

/** Phones, outside a project only: Home · Projects · Create · More. */
export function BottomNav({ at }: { at: Section | null }) {
  const items: { id: Section; label: string; to: string; icon: string }[] = [
    { id: "home", label: "Home", to: "/", icon: "M4 11 12 4l8 7v9h-5v-6H9v6H4z" },
    { id: "projects", label: "Projects", to: "/projects", icon: "M4 6h6l2 2h8v11H4z" },
    { id: "create", label: "Create", to: "/create", icon: "M12 5v14M5 12h14" },
    { id: "settings", label: "More", to: "/settings", icon: "M5 7h14M5 12h14M5 17h14" },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map((n) => (
        <Link key={n.id} to={n.to} aria-current={at === n.id ? "page" : undefined} className={n.id === "create" ? "is-create" : undefined}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d={n.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="foot-brand">
        <p className="kicker">AI Carve</p>
        <p className="foot-line">Photo, text or pattern to 3D relief, STL, .rlf and vectors</p>
        <p>Turn a picture, a name or a verse into a carving file for ArtCAM and other CNC software.</p>
      </div>
      <div className="foot-copy" id="how">
        <h2>How it works</h2>
        <p>
          Photo relief: upload a picture. Light areas rise, dark areas sink; choose detail and depth, then download the STL. Text panel: pick 99 Names, a
          name plate or a word grid, type or search the Arabic (Find Arabic), build, then download the STL, the ArtCAM .rlf or a 16-bit TIFF.
        </p>
      </div>
      <div className="foot-copy" id="help-copy">
        <h2>Help</h2>
        <p>
          Photos: keep invert off for normal carvings; turn it on only to cut the design into the wood like an engraving. Use a sharp picture at least 800
          px wide. Text panels: the card shows how tall the letters will be — keep them above 6 mm. Download the proof image and have someone who reads the
          script check it before carving. In ArtCAM, the .rlf opens as a ready relief.
        </p>
      </div>
      <div className="foot-copy" id="formats">
        <h2>Supported formats</h2>
        <p>
          Upload JPG, PNG, WebP, or BMP. Export binary STL for Import 3D Model and an optional 8-bit height BMP; text panels also give an ArtCAM relief
          (.rlf) and a 16-bit TIFF at 0.25 mm, a proof PNG, a cut outline DXF and layered vectors (DXF / SVG).
        </p>
      </div>
      <div className="foot-copy" id="privacy">
        <h2>Privacy</h2>
        <p>
          Pictures and the 3D work stay in this browser; Carve does not upload them. Two optional features send text to outside services: Smart search
          sends only the English words you type to Google Gemini, and “Describe a design” sends your description to an image service.
        </p>
      </div>
    </footer>
  );
}
