/**
 * Build-time resolution for social-preview images.
 *
 * Static hosting cannot inject absolute URLs at crawl time, so index.html keeps
 * a relative `og.png` and a Vite transform rewrites it to an absolute HTTPS URL
 * using VITE_SITE_URL. When the variable is missing or malformed we fall back
 * to the canonical GitHub Pages root rather than emitting a relative URL.
 */

export const CANONICAL_SITE_URL = "https://samdanisayam.github.io/pi-atlas/";
export const SOCIAL_IMAGE = "og.png";

/** Normalize a site root to an absolute HTTPS URL with a trailing slash. */
export function normalizeSiteRoot(raw: string | undefined): string {
  const candidate = (raw ?? "").trim();
  if (!candidate) return CANONICAL_SITE_URL;
  try {
    const withScheme = candidate.includes("://") ? candidate : `https://${candidate}`;
    const url = new URL(withScheme);
    if (url.protocol !== "https:") url.protocol = "https:";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return CANONICAL_SITE_URL;
  }
}

/** Resolve the social image against the (optionally overridden) site root. */
export function absoluteSocialImage(
  rawSiteUrl: string | undefined,
  image = SOCIAL_IMAGE,
): string {
  const root = normalizeSiteRoot(rawSiteUrl);
  try {
    return new URL(image.replace(/^\.\//, ""), root).href;
  } catch {
    return new URL(SOCIAL_IMAGE, CANONICAL_SITE_URL).href;
  }
}
