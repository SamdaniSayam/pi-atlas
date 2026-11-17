/** Screen-reader live announcements. */

let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement {
  if (!region) {
    region = document.createElement("div");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
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
  el.textContent = "";
  window.setTimeout(() => {
    el.textContent = message;
  }, 30);
}
