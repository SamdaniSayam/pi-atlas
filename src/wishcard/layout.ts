/** Fixed card sizes, five-zone layout boxes, text fitting, naming and cache keys. */
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

/**
 * Zone 1 header + rule, zone 2 tier label, zone 3 hero + context,
 * zone 4 factual line, zone 5 split footer. Boxes carry the text only; footer
 * lines are centred on their QR plate. Hairlines and registration ticks are
 * drawn from `frame` and rule Ys.
 */
export interface FormatLayout {
  frame: Rect;
  headerRuleY: number;
  footerRuleY: number;
  header: Rect;
  tag: Rect;
  tier: Rect;
  hero: Rect;
  context: Rect;
  fact: Rect;
  dedication: Rect;
  scan: Rect;
  site: Rect;
  fine: Rect;
  /** Footer text column for the clean style, which centres its QR plate. */
  cleanFooter: Rect;
  qr: Plate;
}

export const LAYOUTS: Record<WishFormat, FormatLayout> = {
  square: {
    frame: { x: 28, y: 28, w: 1024, h: 1024 },
    headerRuleY: 164,
    footerRuleY: 790,
    header: { x: 96, y: 92, w: 420, h: 48 },
    tag: { x: 616, y: 92, w: 368, h: 48 },
    tier: { x: 120, y: 196, w: 840, h: 48 },
    hero: { x: 120, y: 290, w: 840, h: 286 },
    context: { x: 120, y: 600, w: 840, h: 52 },
    fact: { x: 120, y: 692, w: 840, h: 52 },
    dedication: { x: 96, y: 832, w: 640, h: 34 },
    scan: { x: 96, y: 880, w: 640, h: 28 },
    site: { x: 96, y: 918, w: 640, h: 30 },
    fine: { x: 96, y: 968, w: 640, h: 28 },
    cleanFooter: { x: 96, y: 832, w: 640, h: 164 },
    qr: { x: 836, y: 836, size: 172 },
  },
  story: {
    frame: { x: 28, y: 28, w: 1024, h: 1864 },
    headerRuleY: 328,
    footerRuleY: 1290,
    header: { x: 96, y: 256, w: 420, h: 48 },
    tag: { x: 616, y: 256, w: 368, h: 48 },
    tier: { x: 120, y: 380, w: 840, h: 52 },
    hero: { x: 120, y: 500, w: 840, h: 520 },
    context: { x: 120, y: 1060, w: 840, h: 56 },
    fact: { x: 120, y: 1160, w: 840, h: 56 },
    dedication: { x: 320, y: 1327, w: 664, h: 36 },
    scan: { x: 320, y: 1387, w: 664, h: 30 },
    site: { x: 320, y: 1437, w: 664, h: 34 },
    fine: { x: 320, y: 1499, w: 664, h: 40 },
    cleanFooter: { x: 96, y: 1330, w: 280, h: 212 },
    qr: { x: 72, y: 1330, size: 220 },
  },
  wide: {
    frame: { x: 20, y: 20, w: 1160, h: 590 },
    headerRuleY: 108,
    footerRuleY: 474,
    header: { x: 64, y: 48, w: 360, h: 36 },
    tag: { x: 760, y: 48, w: 376, h: 36 },
    tier: { x: 64, y: 124, w: 672, h: 34 },
    hero: { x: 64, y: 180, w: 672, h: 168 },
    context: { x: 64, y: 362, w: 672, h: 40 },
    fact: { x: 64, y: 414, w: 672, h: 36 },
    dedication: { x: 64, y: 488, w: 672, h: 26 },
    scan: { x: 872, y: 356, w: 220, h: 26 },
    site: { x: 64, y: 520, w: 672, h: 26 },
    fine: { x: 64, y: 552, w: 672, h: 24 },
    cleanFooter: { x: 64, y: 488, w: 672, h: 88 },
    qr: { x: 872, y: 120, size: 220 },
  },
};

/** QR plate for a card's own style. Both styles use fixed archival plates. */
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
    { id: "tier", ...L.tier, minSize: format === "wide" ? 14 : 20 },
    { id: "hero", ...L.hero, minSize: format === "wide" ? 24 : 56 },
    { id: "context", ...L.context, minSize: 16 },
    { id: "fact", ...L.fact, minSize: 18 },
    { id: "scan", ...L.scan, minSize: 14 },
    { id: "site", ...L.site, minSize: format === "wide" ? 14 : 18 },
    { id: "fine", ...L.fine, minSize: 12 },
  ];
  if (BRAND_HANDLE) boxes.push({ id: "handle", ...L.site, minSize: 12 });
  if (input.dedication) boxes.push({ id: "dedication", ...L.dedication, minSize: 16 });
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
