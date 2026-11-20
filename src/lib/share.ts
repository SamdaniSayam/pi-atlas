/** Clipboard and native share helpers. PNG export lives in `src/wishcard/`. */

/** Copy text to clipboard with a fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    try {
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      // Always remove the fallback node, even if select()/execCommand throws.
      ta.remove();
    }
  }
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

export async function shareOrCopy(url: string, title: string): Promise<ShareOutcome> {
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, url });
      return "shared";
    } catch (err) {
      // Closing the native share sheet is not a failure: never silently copy
      // over the user's clipboard in that case.
      if (err instanceof Error && err.name === "AbortError") return "cancelled";
      // Any other share failure falls through to the clipboard fallback.
    }
  }
  const ok = await copyText(url);
  return ok ? "copied" : "failed";
}
