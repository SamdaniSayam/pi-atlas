/** Fixed card sizes, text fitting, naming and cache keys. */
import type { WishCardInput, WishFormat, WishOptions } from "./types";

export interface FormatSpec {
  width: number;
  height: number;
  margin: number;
}

export const FORMATS: Record<WishFormat, FormatSpec> = {
  square: { width: 1080, height: 1080, margin: 72 },
  story: { width: 1080, height: 1920, margin: 72 },
  wide: { width: 1200, height: 630, margin: 48 },
};

export const FONT_DISPLAY = '"Fraunces", Georgia, serif';
export const FONT_UI = '"Inter", system-ui, -apple-system, sans-serif';
export const FONT_MONO = '"Jetbrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

type Measurer = Pick<CanvasRenderingContext2D, "font" | "measureText">;

/**
 * Largest integer font size (step-sized) at which `text` fits `maxWidth`.
 * The returned size is always in [minSize, maxSize] and the measurer's font is
 * left set to that size. Callers ellipsise separately if minSize still overflows.
 */
export function fitText(
  ctx: Measurer,
  text: string,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  step = 2,
): number {
  const font = ctx.font || "600 16px sans-serif";
  const match = /^(.*?\b)(\d+(?:\.\d+)?)px(\b.*)$/.exec(font);
  const prefix = match ? match[1] : "600 ";
  const suffix = match ? match[3] : " sans-serif";
  const cappedMax = Math.max(minSize, maxSize);
  for (let size = cappedMax; size > minSize; size -= step) {
    ctx.font = `${prefix}${size}px${suffix}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  ctx.font = `${prefix}${minSize}px${suffix}`;
  return minSize;
}

/** Middle-ellipsis so the beginning and end of a long query stay recognisable. */
export function ellipsizeMiddle(ctx: Measurer, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const n = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, n)}${ell}${text.slice(text.length - n)}`;
    if (ctx.measureText(candidate).width <= maxWidth) lo = n;
    else hi = n - 1;
  }
  return `${text.slice(0, lo)}${ell}${text.slice(text.length - lo)}`;
}

/** URL-safe, deterministic file slug. Never leaks the raw query when hidden. */
export function slugFor(input: WishCardInput): string {
  if (input.hideQuery) return "hidden";
  if (input.pattern) return `r${input.pattern.rows}x${input.pattern.cols}`;
  const slug = input.query.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  return slug || "search";
}

export function fileNameFor(input: WishCardInput, format: WishFormat): string {
  return `pi-atlas-wish-${input.mode}-${slugFor(input)}-${format}.png`;
}

/** LRU key: same search + same options + same selected occurrence. */
export function cacheKeyFor(input: WishCardInput, options: WishOptions): string {
  return [input.mode, input.query, options.format, options.style, options.hideQuery ? 1 : 0, input.firstPosition ?? 0].join("|");
}
