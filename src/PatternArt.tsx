import { useMemo } from "react";
import { patternSegments, type PatternKind } from "./lib/pattern";

/**
 * A live drawing of a star pattern (the same geometry the carving uses), for cards and buttons.
 * Lines are drawn twice, dark then light, so they read as a carved band on the wood colour.
 */
export function PatternArt({ kind, repeats, ratio = 1, medallion = false, className }: { kind: PatternKind; repeats: number; ratio?: number; medallion?: boolean; className?: string }) {
  const W = 100 * Math.max(1, ratio);
  const H = 100 * Math.max(1, 1 / ratio);
  const segs = useMemo(() => patternSegments(kind, { x0: 0, y0: 0, x1: W, y1: H }, repeats), [kind, repeats, W, H]);
  const d = useMemo(() => segs.map(([[ax, ay], [bx, by]]) => `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`).join(""), [segs]);
  let r = 0;
  if (medallion) {
    let near = Infinity;
    for (const [[ax, ay], [bx, by]] of segs) {
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((W / 2 - ax) * dx + (H / 2 - ay) * dy) / (dx * dx + dy * dy || 1e-12)));
      near = Math.min(near, Math.hypot(W / 2 - ax - t * dx, H / 2 - ay - t * dy));
    }
    r = Math.max(6, near - 4);
  }
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="#7a5428" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      <path d={d} fill="none" stroke="#f0d6aa" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      {medallion ? <circle cx={W / 2} cy={H / 2} r={r} fill="#d4ae78" stroke="#7a5428" strokeOpacity={0.6} strokeWidth={1.6} /> : null}
    </svg>
  );
}
