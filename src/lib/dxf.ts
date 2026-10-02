/**
 * The panel's cut outline as a DXF file (AutoCAD R12, the version every CNC program reads:
 * ArtCAM, Aspire, VCarve, Fusion). One closed polyline in millimetres on layer "CUT_OUTLINE",
 * Y pointing up with (0, 0) at the panel's bottom-left corner, matching the relief files.
 */
import { shapeContour, type Shape } from "./shape";

export function outlineDxf(shape: Shape, widthMm: number, heightMm: number): string {
  const path = shapeContour(shape, widthMm, heightMm, 0, 360);
  // the contour repeats its first point at the end; a closed polyline does not need it
  const pts = path.slice(0, -1);
  const f = (v: number) => (Math.abs(v) < 5e-7 ? "0" : v.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$INSUNITS");
  g(70, 4); // millimetres
  g(9, "$EXTMIN");
  g(10, 0);
  g(20, 0);
  g(9, "$EXTMAX");
  g(10, f(widthMm));
  g(20, f(heightMm));
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, 1);
  g(0, "LAYER");
  g(2, "CUT_OUTLINE");
  g(70, 0);
  g(62, 1); // red
  g(6, "CONTINUOUS");
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  g(0, "POLYLINE");
  g(8, "CUT_OUTLINE");
  g(66, 1);
  g(10, 0);
  g(20, 0);
  g(30, 0);
  g(70, 1); // closed
  for (const [x, y] of pts) {
    g(0, "VERTEX");
    g(8, "CUT_OUTLINE");
    g(10, f(x));
    g(20, f(heightMm - y)); // DXF Y points up
    g(30, 0);
  }
  g(0, "SEQEND");
  g(8, "CUT_OUTLINE");
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}
