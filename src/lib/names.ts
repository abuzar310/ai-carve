function dim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Fresh names. ArtCAM Open wants a picture; .rlf is what ArtCAM writes after. */
export function artcamNames(widthMm: number, heightMm: number, depthMm: number, now = Date.now(), rand = Math.random) {
  const id = `${now.toString(36)}-${rand().toString(36).slice(2, 6)}`;
  const stem = `carve-${dim(widthMm)}x${dim(heightMm)}-${dim(depthMm)}mm-${id}`;
  return { bmp: `${stem}.bmp`, tif: `${stem}.tif` };
}
