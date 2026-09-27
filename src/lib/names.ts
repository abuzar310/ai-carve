const EXT = /\.(png|jpe?g|webp|gif|bmp|tif{1,2}|heic|svg)$/i;
const BLANK = /^(generated-image|image|photo|picture|untitled|download)$/;

function dim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Short folder-safe stem from a file name or a prompt. */
export function sourceStem(raw: string): string {
  let s = raw.trim().replace(/\\/g, "/");
  s = s.slice(s.lastIndexOf("/") + 1);
  s = s.replace(EXT, "");
  s = s.replace(/^carve[-_ ]+/i, "");
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s || BLANK.test(s)) return "relief";
  if (s.length > 28) s = s.slice(0, 28).replace(/-+$/, "");
  return s;
}

/** STL / BMP named after the picture (or prompt), plus size. */
export function artcamNames(source: string, widthMm: number, heightMm: number, depthMm: number) {
  const stem = `${sourceStem(source)}-${dim(widthMm)}x${dim(heightMm)}-${dim(depthMm)}mm`;
  return { bmp: `${stem}.bmp`, stl: `${stem}.stl` };
}
