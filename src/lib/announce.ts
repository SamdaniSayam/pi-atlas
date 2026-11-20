/** Screen-reader live announcements. */

let region: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function ensureRegion(): HTMLElement | null {
  if (typeof document === "undefined" || !document.body) return null;
  if (!region || !region.isConnected) {
    region = document.createElement("div");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    region.className = "visually-hidden";
    region.style.position = "absolute";
    region.style.width = "1px";
    region.style.height = "1px";
    region.style.margin = "-1px";
    region.style.overflow = "hidden";
    region.style.clip = "rect(0 0 0 0)";
    region.style.whiteSpace = "nowrap";
    document.body.appendChild(region);
  }
  return region;
}

export function announce(message: string): void {
  const el = ensureRegion();
  if (!el) return;
  // A pending older message must never overwrite a newer announcement.
  if (timer !== null) clearTimeout(timer);
  el.textContent = "";
  timer = setTimeout(() => {
    el.textContent = message;
    timer = null;
  }, 30);
}
