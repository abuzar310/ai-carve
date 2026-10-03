/**
 * 99 Names verification (UX_REBUILD Phase 3).
 * Every line is computed from layoutPanel(spec) — the exact layout that is rastered and carved.
 * No decorative ticks: a line only shows ✓ when the code just checked it.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { layoutPanel, verifyNames99, type PanelSpec } from "./lib/textPanel";
import { proofPng } from "./lib/textRaster";

function Line({ pass, children }: { pass: boolean; children: ReactNode }) {
  return (
    <li className={pass ? "pass" : "fail"}>
      <i aria-hidden="true">{pass ? "\u2713" : "\u2717"}</i> {children}
    </li>
  );
}

export function NamesVerify({ spec }: { spec: PanelSpec }) {
  const res = useMemo(() => {
    try {
      return { ok: true as const, v: verifyNames99(spec) };
    } catch {
      return { ok: false as const };
    }
  }, [spec]);

  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => void (proof && URL.revokeObjectURL(proof)), [proof]);
  if (!res.ok) return null;

  return (
    <div className="card verify">
      <h3>Checked against the library</h3>
      <ul className="checks">
        <Line pass={res.v.namesFound === 99 && res.v.namesOrdered}>
          Names verified: {res.v.namesFound} / 99, in the library’s reading order
        </Line>
        <Line pass={res.v.allahFirst}>الله opens the panel — a structural check, counted apart from the 99</Line>
        <Line pass={res.v.noDup}>No name repeated</Line>
        <Line pass={res.v.allLibrary}>Every word comes from the library — nothing typed, nothing AI-made</Line>
      </ul>
      <p className="meta">Computed from the exact layout that is carved, each time the design changes.</p>
      <button
        type="button"
        className="btn ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const b = await proofPng(layoutPanel(spec));
            setProof((old) => {
              if (old) URL.revokeObjectURL(old);
              return URL.createObjectURL(b);
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Rendering\u2026" : proof ? "Refresh exact text" : "View exact text"}
      </button>
      {proof ? <img className="proof" src={proof} alt="Black-on-white proof of the exact lettering" /> : null}
    </div>
  );
}
