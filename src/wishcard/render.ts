/**
 * Pure canvas-2D wish-card renderer. One flat "Royal Observatory Plate" is
 * shared by both styles: `collectible` uses the tier's dark heritage palette,
 * `clean` uses Archival Ivory Parchment. No DOM layout, no network, no images,
 * no gradients, no glow, no decorative sparkles. One canvas is drawn at a time.
 */
import { BRAND_HANDLE, SITE_URL } from "../constants";
import { PALETTE } from "../engine/palette";
import { editionTag, pickCopy } from "./copy";
import {
  FORMATS, FONT_DISPLAY, FONT_MONO, FONT_UI, LAYOUTS,
  cacheKeyFor, ellipsizeMiddle, fitText, layoutBoxes, qrPlateFor,
  type FormatLayout, type TextBox,
} from "./layout";
import { drawQr, qrContentFor, type QrContent } from "./qr";
import { themeFor, type TierTheme } from "./themes";
import type { WishCardInput, WishCopy, WishFormat, WishOptions } from "./types";

const CACHE_LIMIT = 6;
/** Keep the Greek letter lowercase; only the Latin word is a wordmark. */
const CARD_WORDMARK = "π ATLAS";
const cache = new Map<string, RenderedCard>();

export interface RenderedCard {
  canvas: HTMLCanvasElement;
  qr: QrContent;
  boxes: TextBox[];
}

/** Run a callback in browser idle time; the returned function cancels it. */
export function whenIdle(fn: () => void): () => void {
  const w = window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(fn, { timeout: 800 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 0);
  return () => window.clearTimeout(id);
}

/** Wait for the card fonts, but never longer than two seconds. */
export async function waitForFonts(timeoutMs = 2000): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (!fonts || typeof fonts.load !== "function") return;
  const specs = [
    '600 80px "Fraunces"',
    '400 30px "Fraunces"',
    '500 28px "Inter"',
    '600 24px "Inter"',
    '500 28px "JetBrains Mono"',
  ];
  const loads = Promise.all(specs.map((spec) => fonts.load(spec).catch(() => undefined)));
  await Promise.race([
    loads,
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

export function clearWishCardCache(): void {
  cache.clear();
}

function cached(key: string): RenderedCard | null {
  const found = cache.get(key);
  if (!found) return null;
  cache.delete(key);
  cache.set(key, found);
  return found;
}

/** Render one card. Debug renders bypass the six-card LRU (used by the gallery). */
export async function renderWishCard(
  input: WishCardInput,
  options: WishOptions,
  debug = false,
): Promise<RenderedCard> {
  const key = cacheKeyFor(input, options);
  if (!debug) {
    const hit = cached(key);
    if (hit) return hit;
  }
  await waitForFonts();
  const spec = FORMATS[options.format];
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  ctx.imageSmoothingEnabled = false;
  const cardInput = { ...input, style: options.style };
  const theme = themeFor(input.tier, options.style);
  const copy = pickCopy(cardInput);
  const boxes = layoutBoxes(options.format, cardInput);
  const qr = qrContentFor(cardInput);

  drawPlate(ctx, cardInput, copy, theme, qr, options.format, options.style);
  if (debug) boxes.forEach((box) => debugBox(ctx, box));

  const rendered = { canvas, qr, boxes };
  if (!debug) {
    cache.set(key, rendered);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }
  return rendered;
}

/* ------------------------------ primitives -------------------------------- */

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function setFont(ctx: CanvasRenderingContext2D, weight: number, size: number, family: string): void {
  ctx.font = `${weight} ${size}px ${family}`;
}

function letterSpacing(ctx: CanvasRenderingContext2D, value: string): boolean {
  const holder = ctx as unknown as { letterSpacing?: string };
  if (typeof holder.letterSpacing === "string") {
    holder.letterSpacing = value;
    return true;
  }
  return false;
}

function measureTracked(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + spacing;
  return Math.max(0, total - spacing);
}

function textWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  if (letterSpacing(ctx, `${spacing}px`)) return ctx.measureText(text).width;
  return measureTracked(ctx, text, spacing);
}

/** Tracked-out uppercase text centred inside a box, with per-character fallback. */
function trackedCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  colour: string,
  maxSize: number,
  minSize: number,
  spacingEm: number,
  family = FONT_UI,
): void {
  let size = maxSize;
  for (; size > minSize; size -= 2) {
    setFont(ctx, 600, size, family);
    if (textWidth(ctx, text, size * spacingEm) <= box.w) break;
  }
  setFont(ctx, 600, size, family);
  const spacing = size * spacingEm;
  const width = textWidth(ctx, text, spacing);
  const startX = box.x + (box.w - width) / 2;
  const baseline = box.y + box.h / 2 + size * 0.35;
  ctx.fillStyle = colour;
  if (letterSpacing(ctx, `${spacing}px`)) {
    ctx.fillText(text, startX, baseline);
    letterSpacing(ctx, "0px");
  } else {
    let cursor = startX;
    for (const ch of text) {
      ctx.fillText(ch, cursor, baseline);
      cursor += ctx.measureText(ch).width + spacing;
    }
  }
}

/** Draw up to three coloured runs on one centred line. */
function centredRuns(
  ctx: CanvasRenderingContext2D,
  runs: Array<{ text: string; colour: string }>,
  box: { x: number; y: number; w: number; h: number },
  size: number,
  weight: number,
  family: string,
): void {
  setFont(ctx, weight, size, family);
  const fitted = runs.map((run) => ({ ...run, text: ellipsizeMiddle(ctx, run.text, box.w) }));
  const widths = fitted.map((run) => ctx.measureText(run.text).width);
  const gap = size * 0.4;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (fitted.length - 1);
  let cursor = box.x + Math.max(0, (box.w - total) / 2);
  const baseline = box.y + box.h / 2 + size * 0.35;
  fitted.forEach((run, i) => {
    ctx.fillStyle = run.colour;
    ctx.fillText(run.text, cursor, baseline);
    cursor += widths[i] + gap;
  });
}

function debugBox(ctx: CanvasRenderingContext2D, box: TextBox): void {
  ctx.strokeStyle = "rgba(255,80,80,0.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
}

/* --------------------------- archival plate frame ------------------------- */

function registrationTicks(
  ctx: CanvasRenderingContext2D,
  frame: { x: number; y: number; w: number; h: number },
  theme: TierTheme,
): void {
  const len = 16;
  const gap = 6;
  ctx.save();
  ctx.strokeStyle = rgba(theme.accent, 0.55);
  ctx.lineWidth = 1;
  const corners: Array<[number, number, number, number]> = [
    [frame.x + gap, frame.y + gap, 1, 1],
    [frame.x + frame.w - gap, frame.y + gap, -1, 1],
    [frame.x + gap, frame.y + frame.h - gap, 1, -1],
    [frame.x + frame.w - gap, frame.y + frame.h - gap, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFrame(ctx: CanvasRenderingContext2D, L: FormatLayout, theme: TierTheme): void {
  const f = L.frame;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.line;
  ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
  const inset = 8;
  ctx.strokeStyle = rgba(theme.text, 0.18);
  ctx.strokeRect(f.x + inset + 0.5, f.y + inset + 0.5, f.w - inset * 2 - 1, f.h - inset * 2 - 1);
  registrationTicks(ctx, f, theme);
  ctx.strokeStyle = theme.line;
  ctx.beginPath();
  ctx.moveTo(f.x + inset, L.headerRuleY + 0.5);
  ctx.lineTo(f.x + f.w - inset, L.headerRuleY + 0.5);
  ctx.moveTo(f.x + inset, L.footerRuleY + 0.5);
  ctx.lineTo(f.x + f.w - inset, L.footerRuleY + 0.5);
  ctx.stroke();
  ctx.restore();
}

/* --------------------------------- zones ---------------------------------- */

function drawHeader(
  ctx: CanvasRenderingContext2D,
  L: FormatLayout,
  theme: TierTheme,
  format: WishFormat,
  input: WishCardInput,
): void {
  const cy = L.header.y + L.header.h / 2;
  setFont(ctx, 600, format === "wide" ? 30 : 40, FONT_DISPLAY);
  ctx.fillStyle = theme.text;
  ctx.fillText(CARD_WORDMARK, L.header.x, cy + 2);

  setFont(ctx, 500, format === "wide" ? 16 : 22, FONT_MONO);
  ctx.fillStyle = theme.dim;
  const tag = editionTag(input.datasetSize);
  const fitted = ellipsizeMiddle(ctx, tag, L.tag.w);
  ctx.fillText(fitted, L.tag.x + L.tag.w - ctx.measureText(fitted).width, cy + 2);
}

function drawTier(
  ctx: CanvasRenderingContext2D,
  L: FormatLayout,
  theme: TierTheme,
  format: WishFormat,
  label: string,
): void {
  trackedCentered(
    ctx, label, L.tier, theme.accent,
    format === "wide" ? 22 : format === "story" ? 30 : 28,
    format === "wide" ? 14 : 18,
    0.18,
  );
}

function cellColour(value: number, kind: "color" | "shape", theme: TierTheme): string | null {
  if (value < 0) return null;
  if (kind === "color") return PALETTE[value % 10].dark;
  return value >= 5 ? theme.text : theme.bg;
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  theme: TierTheme,
  L: FormatLayout,
  debug: boolean,
): void {
  const { x, y, w, h } = L.hero;
  const p = input.pattern!;
  const region = input.found && p.region
    ? p.region
    : { rows: p.rows, cols: p.cols, values: p.cells, matchRow: 0, matchCol: 0 };
  const maxCell = Math.min(56, (w - 96) / region.cols, (h - 120) / region.rows);
  const cell = Math.max(8, Math.floor(maxCell));
  const gridW = region.cols * cell;
  const gridH = region.rows * cell;
  const gx = x + (w - gridW) / 2;
  const gy = y + (h - gridH) / 2 - 12;
  for (let r = 0; r < region.rows; r += 1) {
    for (let c = 0; c < region.cols; c += 1) {
      const colour = cellColour(region.values[r * region.cols + c] ?? -1, p.kind, theme);
      const px = gx + c * cell;
      const py = gy + r * cell;
      if (colour) {
        ctx.fillStyle = colour;
        ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
      } else {
        ctx.strokeStyle = theme.dim;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
        ctx.setLineDash([]);
      }
    }
  }
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  if (input.found) {
    ctx.strokeRect(gx + region.matchCol * cell, gy + region.matchRow * cell, p.cols * cell, p.rows * cell);
  } else {
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(gx + (region.cols - p.cols) * cell / 2, gy + (region.rows - p.rows) * cell / 2,
      p.cols * cell, p.rows * cell);
    ctx.setLineDash([]);
  }
  setFont(ctx, 500, 18, FONT_UI);
  ctx.fillStyle = theme.dim;
  ctx.textAlign = "center";
  ctx.fillText(p.kind === "shape" ? "your shape" : "your pattern", x + w / 2, y + h - 12);
  ctx.textAlign = "left";
  if (debug) debugBox(ctx, { id: "hero", ...L.hero, minSize: 0, decorative: true });
}

function drawHero(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  theme: TierTheme,
  L: FormatLayout,
  format: WishFormat,
  debug: boolean,
): void {
  if (input.pattern) {
    drawPattern(ctx, input, theme, L, debug);
  } else {
    const { x, y, w, h } = L.hero;
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    if (input.mode === "letters") {
      const word = input.hideQuery ? "•".repeat(Math.min(12, input.query.length || 1)) : input.query.toUpperCase();
      setFont(ctx, 600, 120, FONT_DISPLAY);
      const size = fitText(ctx, word, w - 48, format === "wide" ? 74 : 120, format === "wide" ? 36 : 48);
      ctx.fillStyle = theme.text;
      ctx.fillText(word, cx, cy);
      if (!input.hideQuery && size >= 68) {
        const pairs = [...word].map((ch) => String(ch.charCodeAt(0) - 65).padStart(2, "0"));
        setFont(ctx, 500, 18, FONT_MONO);
        const widths = pairs.map((pair) => ctx.measureText(pair).width);
        const total = widths.reduce((a, b) => a + b, 0) + 12 * (pairs.length - 1);
        let cursor = cx - total / 2;
        ctx.fillStyle = theme.accent;
        pairs.forEach((pair, i) => {
          ctx.fillText(pair, cursor + widths[i] / 2, cy + size * 0.72);
          cursor += widths[i] + 12;
        });
      }
    } else {
      const text = input.hideQuery ? "•".repeat(Math.min(20, input.query.length || 1)) : input.query;
      setFont(ctx, 500, 120, FONT_MONO);
      fitText(ctx, text, w - 48, format === "wide" ? 82 : 128, format === "wide" ? 36 : 44);
      ctx.fillStyle = theme.text;
      ctx.fillText(text, cx, cy);
    }
    ctx.restore();
    if (debug) debugBox(ctx, { id: "hero", ...L.hero, minSize: 0, decorative: true });
  }
}

function drawContext(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  theme: TierTheme,
  L: FormatLayout,
  format: WishFormat,
): void {
  setFont(ctx, 500, format === "wide" ? 17 : format === "story" ? 24 : 22, FONT_MONO);
  const context = input.context;
  if (input.hideQuery) {
    if (!context) return;
    ctx.fillStyle = theme.dim;
    const label = "Context hidden by request";
    ctx.fillText(label, L.context.x + (L.context.w - ctx.measureText(label).width) / 2,
      L.context.y + L.context.h / 2 + 7);
    return;
  }
  if (!context) {
    if (input.tier !== "twilight" || !input.longestPrefix) return;
    ctx.fillStyle = theme.dim;
    const label = ellipsizeMiddle(ctx, `Closest prefix: ${input.longestPrefix.prefix}`, L.context.w);
    ctx.fillText(label, L.context.x + (L.context.w - ctx.measureText(label).width) / 2,
      L.context.y + L.context.h / 2 + 7);
    return;
  }
  const before = `…${context.text.slice(0, context.matchStart)}`;
  const match = ` [ ${context.text.slice(context.matchStart, context.matchStart + context.matchLength)} ] `;
  const after = `${context.text.slice(context.matchStart + context.matchLength)}…`;
  const size = fitText(ctx, before + match + after, L.context.w, format === "wide" ? 17 : 24, 12);
  centredRuns(ctx, [
    { text: before, colour: theme.dim },
    { text: match, colour: theme.accent },
    { text: after, colour: theme.dim },
  ], L.context, size, 500, FONT_MONO);
}

function drawFact(
  ctx: CanvasRenderingContext2D,
  copy: WishCopy,
  theme: TierTheme,
  L: FormatLayout,
  format: WishFormat,
): void {
  // The zone-2 label already says UNCHARTED; do not repeat it in the fact line.
  const isUncharted = copy.tierLabel === "Twilight";
  const lead = isUncharted ? "" : copy.headline;
  const full = lead ? `${lead} ${copy.factLine}` : copy.factLine;
  setFont(ctx, 600, format === "wide" ? 19 : format === "story" ? 26 : 24, FONT_UI);
  const size = fitText(ctx, full, L.fact.w, format === "wide" ? 19 : 26, 14);
  centredRuns(ctx, lead
    ? [
        { text: lead, colour: theme.dim },
        { text: copy.factLine, colour: theme.text },
      ]
    : [{ text: copy.factLine, colour: theme.text }], L.fact, size, 600, FONT_UI);
}

interface FooterColumn {
  x: number;
  w: number;
  dedicationY: number;
  scanY: number;
  siteY: number;
  fineY: number;
  dedSize: number;
  scanSize: number;
  siteSize: number;
  fineSize: number;
}

function footerColumn(L: FormatLayout, format: WishFormat, style: WishCardInput["style"]): FooterColumn {
  if (style === "clean" && format === "story") {
    const c = L.cleanFooter;
    return {
      x: c.x, w: c.w,
      dedicationY: c.y + 24, scanY: c.y + 92, siteY: c.y + 132, fineY: c.y + 176,
      dedSize: 16, scanSize: 13, siteSize: 13, fineSize: 11,
    };
  }
  return {
    x: L.dedication.x, w: L.dedication.w,
    dedicationY: L.dedication.y + L.dedication.h * 0.72,
    scanY: L.scan.y + L.scan.h * 0.72,
    siteY: L.site.y + L.site.h * 0.72,
    fineY: L.fine.y + L.fine.h * 0.72,
    dedSize: format === "wide" ? 16 : 20,
    scanSize: format === "wide" ? 14 : 18,
    siteSize: format === "wide" ? 15 : 20,
    fineSize: format === "wide" ? 13 : 16,
  };
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  copy: WishCopy,
  theme: TierTheme,
  L: FormatLayout,
  format: WishFormat,
  style: WishCardInput["style"],
  qr: QrContent,
): void {
  const column = footerColumn(L, format, style);
  const site = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
  let cursor = column.dedicationY;
  if (input.dedication) {
    setFont(ctx, 600, column.dedSize, FONT_UI);
    ctx.fillStyle = theme.accent;
    ctx.fillText(ellipsizeMiddle(ctx, copy.dedicationPill, column.w),
      column.x, cursor);
    cursor = column.siteY;
  } else {
    cursor = column.siteY;
  }

  setFont(ctx, 500, column.siteSize, FONT_MONO);
  ctx.fillStyle = theme.text;
  ctx.fillText(ellipsizeMiddle(ctx, site, column.w), column.x, cursor);

  if (BRAND_HANDLE) {
    setFont(ctx, 600, column.fineSize, FONT_UI);
    ctx.fillStyle = theme.accent;
    ctx.fillText(BRAND_HANDLE, column.x, column.fineY - column.fineSize * 1.6);
  }

  if (format !== "wide") {
    setFont(ctx, 400, column.scanSize, FONT_UI);
    ctx.fillStyle = theme.dim;
    ctx.fillText("Scan to find yours", column.x, column.scanY);
  }

  setFont(ctx, 400, column.fineSize, FONT_UI);
  ctx.fillStyle = theme.dim;
  ctx.fillText(ellipsizeMiddle(ctx, copy.finePrint, column.w),
    column.x, column.fineY);

  const plate = qrPlateFor(format, style);
  ctx.save();
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(plate.x - 7.5, plate.y - 7.5, plate.size + 15, plate.size + 15);
  ctx.restore();
  drawQr(ctx, qr, plate.x, plate.y, plate.size);

  if (format === "wide") {
    setFont(ctx, 400, column.scanSize, FONT_UI);
    ctx.fillStyle = theme.dim;
    ctx.textAlign = "center";
    ctx.fillText("Scan to find yours", L.scan.x + L.scan.w / 2, L.scan.y + L.scan.h * 0.72);
    ctx.textAlign = "left";
  }
}

/** Draw the single archival plate shared by collectible and clean styles. */
function drawPlate(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  copy: WishCopy,
  theme: TierTheme,
  qr: QrContent,
  format: WishFormat,
  style: WishCardInput["style"],
): void {
  const { width: w, height: h } = FORMATS[format];
  const L = LAYOUTS[format];
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);
  drawFrame(ctx, L, theme);
  drawHeader(ctx, L, theme, format, input);
  drawTier(ctx, L, theme, format, copy.eyebrow);
  drawHero(ctx, input, theme, L, format, false);
  drawContext(ctx, input, theme, L, format);
  drawFact(ctx, copy, theme, L, format);
  drawFooter(ctx, input, copy, theme, L, format, style, qr);
}
