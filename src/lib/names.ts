function dim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** One unique BMP. ArtCAM Open an image. */
export function artcamNames(widthMm: number, heightMm: number, depthMm: number, now = Date.now(), rand = Math.random) {
  const id = `${now.toString(36)}-${rand().toString(36).slice(2, 6)}`;
  return { bmp: `carve-${dim(widthMm)}x${dim(heightMm)}-${dim(depthMm)}mm-${id}.bmp` };
}
