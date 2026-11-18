/** Fixed card sizes, layout boxes, text fitting, naming and cache keys. */
import { BRAND_HANDLE } from "../constants";
import type { WishCardInput, WishFormat, WishOptions } from "./types";

export interface FormatSpec {
  width: number;
  height: number;
  margin: number;
}

export const FORMATS: Record<WishFormat, FormatSpec> = {
  square: { width: 1080, height: 1080, margin: 72 },
  story: { width: 1080, height: 1920, margin: 72 },
  wide: { width: 1200, height: 630, margin: 24 },
};

export const FONT_DISPLAY = '"Fraunces", Georgia, serif';
export const FONT_UI = '"Inter", system-ui, -apple-system, sans-serif';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

type Measurer = Pick<CanvasRenderingContext2D, "font" | "measureText">;

/** A drawable text box. Boxes are checked by the dev gallery, not by users. */
export interface TextBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minSize: number;
  decorative?: boolean;
}

interface Rect { x: number; y: number; w: number; h: number }
interface Plate { x: number; y: number; size: number }

export interface FormatLayout {
  header: Rect;
  pill: Rect;
  headline: Rect;
  subline: Rect;
  plate: Rect;
  odds: Rect;
  quote: Rect;
  attribution: Rect;
  footer: Rect;
  qr: Plate;
  tag: Rect;
  scan: Rect;
  site: Rect;
  handle: Rect;
  fine: Rect;
}

export const LAYOUTS: Record<WishFormat, FormatLayout> = {
  square: {
    header: { x: 72, y: 72, w: 520, h: 58 },
    pill: { x: 72, y: 190, w: 380, h: 52 },
    headline: { x: 72, y: 250, w: 936, h: 190 },
    subline: { x: 72, y: 455, w: 936, h: 85 },
    plate: { x: 72, y: 560, w: 936, h: 160 },
    odds: { x: 72, y: 740, w: 936, h: 50 },
    quote: { x: 72, y: 800, w: 716, h: 74 },
    attribution: { x: 72, y: 876, w: 716, h: 24 },
    footer: { x: 72, y: 880, w: 716, h: 88 },
    qr: { x: 836, y: 836, size: 172 },
    tag: { x: 800, y: 72, w: 208, h: 58 },
    scan: { x: 72, y: 912, w: 716, h: 26 },
    site: { x: 72, y: 940, w: 716, h: 26 },
    handle: { x: 72, y: 966, w: 300, h: 18 },
    fine: { x: 72, y: 986, w: 716, h: 20 },
  },
  story: {
    header: { x: 72, y: 240, w: 520, h: 58 },
    pill: { x: 72, y: 330, w: 380, h: 52 },
    headline: { x: 72, y: 410, w: 936, h: 270 },
    subline: { x: 72, y: 700, w: 936, h: 100 },
    plate: { x: 72, y: 840, w: 936, h: 260 },
    odds: { x: 72, y: 1130, w: 936, h: 60 },
    quote: { x: 72, y: 1220, w: 936, h: 80 },
    attribution: { x: 72, y: 1302, w: 936, h: 26 },
    footer: { x: 72, y: 1330, w: 936, h: 250 },
    qr: { x: 72, y: 1330, size: 220 },
    tag: { x: 800, y: 240, w: 208, h: 58 },
    scan: { x: 320, y: 1370, w: 688, h: 40 },
    site: { x: 320, y: 1424, w: 688, h: 40 },
    handle: { x: 320, y: 1474, w: 688, h: 30 },
    fine: { x: 72, y: 1560, w: 936, h: 20 },
  },
  wide: {
    header: { x: 72, y: 48, w: 360, h: 52 },
    pill: { x: 72, y: 118, w: 300, h: 44 },
    headline: { x: 72, y: 175, w: 688, h: 125 },
    subline: { x: 72, y: 310, w: 688, h: 60 },
    plate: { x: 72, y: 385, w: 688, h: 110 },
    odds: { x: 72, y: 510, w: 688, h: 35 },
    quote: { x: 72, y: 552, w: 688, h: 36 },
    attribution: { x: 72, y: 590, w: 688, h: 16 },
    footer: { x: 800, y: 360, w: 328, h: 140 },
    qr: { x: 872, y: 120, size: 220 },
    tag: { x: 800, y: 48, w: 328, h: 40 },
    scan: { x: 800, y: 360, w: 328, h: 30 },
    site: { x: 800, y: 394, w: 328, h: 30 },
    handle: { x: 800, y: 428, w: 328, h: 26 },
    fine: { x: 800, y: 462, w: 328, h: 30 },
  },
};

/** QR plate for a card's own style. The default collectible layout is fixed. */
export function qrPlateFor(format: WishFormat, style: WishCardInput["style"]): Plate {
  if (style === "clean" && format === "story") return { x: (1080 - 260) / 2, y: 1300, size: 260 };
  return LAYOUTS[format].qr;
}

/** All text boxes in draw order. Decorative art is absent by design. */
export function layoutBoxes(format: WishFormat, input: WishCardInput): TextBox[] {
  const L = LAYOUTS[format];
  const boxes: TextBox[] = [
    { id: "header", ...L.header, minSize: 26 },
    { id: "tag", ...L.tag, minSize: 16 },
    { id: "pill", ...L.pill, minSize: format === "wide" ? 16 : 20 },
    { id: "headline", ...L.headline, minSize: format === "wide" ? 18 : 56 },
    { id: "subline", ...L.subline, minSize: format === "wide" ? 18 : 24 },
    { id: "odds", ...L.odds, minSize: format === "wide" ? 16 : 20 },
    { id: "quote", ...L.quote, minSize: format === "wide" ? 18 : 22 },
    { id: "attribution", ...L.attribution, minSize: 16 },
    { id: "scan", ...L.scan, minSize: 16 },
    { id: "site", ...L.site, minSize: format === "wide" ? 14 : 20 },
    { id: "fine", ...L.fine, minSize: 14 },
  ];
  if (BRAND_HANDLE) boxes.push({ id: "handle", ...L.handle, minSize: 14 });
  if (input.dedication) {
    // An overlay on the hero plate, not a competing text region.
    boxes.push({
      id: "dedication",
      x: L.plate.x + 24,
      y: L.plate.y - 16,
      w: Math.min(360, 44 + input.dedication.length * 15),
      h: 32,
      minSize: 18,
      decorative: true,
    });
  }
  return boxes;
}

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

/** LRU key: every visible choice plus the selected occurrence. */
export function cacheKeyFor(input: WishCardInput, options: WishOptions): string {
  return [
    input.tier, input.subject, input.dedication, options.style, options.format,
    options.hideQuery ? 1 : 0, input.mode, input.query, input.firstPosition ?? 0,
  ].join("|");
}
