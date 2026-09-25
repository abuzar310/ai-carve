/** Fresh id each download so Windows never writes carve.rlf → carve.rlf_3. */
export function artcamNames(now = Date.now(), rand = Math.random) {
  const id = `${now.toString(36)}-${rand().toString(36).slice(2, 6)}`;
  return { bmp: `carve-${id}.bmp`, rlf: `carve-${id}.rlf` };
}
