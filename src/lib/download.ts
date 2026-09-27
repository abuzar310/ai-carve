let lastUrl = "";

function revokeLater(url: string, ms = 60_000) {
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    if (lastUrl === url) lastUrl = "";
  }, ms);
}

export function canShareFile(): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare) return false;
  try {
    return nav.canShare({ files: [new File([new Blob(["x"])], "t.stl", { type: "model/stl" })] });
  } catch {
    return false;
  }
}

/** Keep the object URL until Safari/Chrome has started the download. iPhone prefers Web Share. */
export async function saveFile(name: string, data: Blob, type: string): Promise<"shared" | "downloaded"> {
  if (lastUrl) {
    URL.revokeObjectURL(lastUrl);
    lastUrl = "";
  }
  const file = data instanceof File ? data : new File([data], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return "shared";
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(file);
  lastUrl = url;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 0);
  revokeLater(url);
  return "downloaded";
}
