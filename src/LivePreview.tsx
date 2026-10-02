import { useEffect, useRef, useState } from "react";
import { layoutPanel, sizeProblem, type PanelSpec } from "./lib/textPanel";
import { letterHeight, proofPng } from "./lib/textRaster";

/**
 * A quick drawing of the panel as it will be laid out (same layout and fitted letters as the
 * carving), redrawn shortly after each change, so the design can be seen before building.
 */
export function LivePreview({ spec }: { spec: PanelSpec }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [letters, setLetters] = useState(0);
  const last = useRef<string | null>(null);
  const key = JSON.stringify(spec);
  useEffect(() => {
    if (sizeProblem(spec)) return;
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      const lay = layoutPanel(spec);
      letterHeight(lay).then((mm) => live && setLetters(mm), () => {});
      proofPng(lay, 720)
        .then((blob) => {
          if (!live) return;
          const u = URL.createObjectURL(blob);
          if (last.current) URL.revokeObjectURL(last.current);
          last.current = u;
          setUrl(u);
        })
        .catch(() => {})
        .finally(() => live && setBusy(false));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => () => void (last.current && URL.revokeObjectURL(last.current)), []);
  if (sizeProblem(spec)) return null;
  return (
    <figure className="live-preview" aria-busy={busy}>
      {url ? (
        <img src={url} alt="Layout preview of the panel" style={{ aspectRatio: `${spec.widthMm} / ${spec.heightMm}` }} />
      ) : (
        <div className="live-preview-empty" style={{ aspectRatio: `${spec.widthMm} / ${spec.heightMm}` }} />
      )}
      <figcaption>
        Layout preview{busy ? " · updating…" : ""} · {spec.widthMm} × {spec.heightMm} mm
        {letters > 0 ? (
          <span className={letters < 6 ? "lp-warn" : undefined}>
            {" "}· letters about <b className="nums">{letters < 10 ? letters.toFixed(1) : Math.round(letters)}&nbsp;mm</b>
            {letters < 6 ? " — too small to carve cleanly: make the panel bigger or use fewer words" : ""}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
