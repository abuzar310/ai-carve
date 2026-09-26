function dim(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Unique BMP + STL. ArtCAM Open an image / Import 3D Model. */
export function artcamNames(widthMm: number, heightMm: number, depthMm: number, now = Date.now(), rand = Math.random) {
  const id = `${now.toString(36)}-${rand().toString(36).slice(2, 6)}`;
  const stem = `carve-${dim(widthMm)}x${dim(heightMm)}-${dim(depthMm)}mm-${id}`;
  return { bmp: `${stem}.bmp`, stl: `${stem}.stl` };
}
