/**
 * Pure canvas-2D wish-card renderer. No DOM layout, no network, no images.
 * `collectible` is the tier-art default; `clean` keeps the original flat layout
 * with the new copy and no tier decoration. One canvas is drawn at a time.
 */
import { APP_NAME, BRAND_HANDLE, BRAND_TAGLINE, SITE_URL } from "../constants";
import { PALETTE } from "../engine/palette";
import { pickCopy } from "./copy";
import { formatDepth } from "./depth";
import {
  FORMATS, FONT_DISPLAY, FONT_MONO, FONT_UI, LAYOUTS,
  cacheKeyFor, ellipsizeMiddle, fitText, layoutBoxes, qrPlateFor,
  type FormatLayout, type TextBox,
} from "./layout";
import { drawQr, qrContentFor, type QrContent } from "./qr";
import { THEMES, type TierTheme } from "./themes";
import type { WishCardInput, WishCopy, WishFormat, WishOptions } from "./types";

const FIRST_DIGITS =
  "314159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706" +
  "798253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446";

const CACHE_LIMIT = 6;
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
  const theme = THEMES[input.tier];
  const cardInput = { ...input, style: options.style };
  const copy = pickCopy(cardInput);
  const boxes = layoutBoxes(options.format, cardInput);
  const seed = hash(`${cardInput.mode}|${cardInput.query}|${cardInput.tier}|${cardInput.subject}`);
  const qr = qrContentFor(cardInput);

  if (options.style === "clean") {
    drawClean(ctx, cardInput, copy, theme, qr, options.format, debug);
  } else {
    drawCollectible(ctx, cardInput, copy, theme, qr, options.format, seed, boxes, debug);
  }

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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
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

/** Letter-spaced uppercase text, with per-character fallback. */
function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  maxWidth: number,
  colour: string,
  maxSize: number,
  minSize: number,
  spacingEm: number,
  family = FONT_UI,
): number {
  let size = maxSize;
  for (; size > minSize; size -= 2) {
    setFont(ctx, 600, size, family);
    const spacing = size * spacingEm;
    if (letterSpacing(ctx, `${spacing}px`)) {
      if (ctx.measureText(text).width <= maxWidth) break;
    } else if (measureTracked(ctx, text, spacing) <= maxWidth) break;
  }
  setFont(ctx, 600, size, family);
  const spacing = size * spacingEm;
  ctx.fillStyle = colour;
  if (letterSpacing(ctx, `${spacing}px`)) {
    ctx.fillText(text, x, baseline);
    letterSpacing(ctx, "0px");
  } else {
    let cursor = x;
    for (const ch of text) {
      ctx.fillText(ch, cursor, baseline);
      cursor += ctx.measureText(ch).width + spacing;
    }
  }
  return x + Math.min(maxWidth, size * text.length * (1 + spacingEm));
}

function linesFor(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface ParagraphOptions {
  weight: number;
  family: string;
  maxSize: number;
  minSize: number;
  maxLines: number;
  lineHeight: number;
  colour: string | CanvasGradient;
  align?: CanvasTextAlign;
}

/** Fit a paragraph into a box using both width and height. Returns font size. */
function paragraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  opts: ParagraphOptions,
): number {
  let size = opts.maxSize;
  let lines: string[] = [];
  for (; size >= opts.minSize; size -= 2) {
    setFont(ctx, opts.weight, size, opts.family);
    lines = linesFor(ctx, text, box.w);
    if (lines.length <= opts.maxLines && lines.length * size * opts.lineHeight <= box.h) break;
  }
  if (size < opts.minSize) {
    size = opts.minSize;
    setFont(ctx, opts.weight, size, opts.family);
    lines = linesFor(ctx, text, box.w);
  }
  const room = Math.max(1, Math.floor(box.h / (size * opts.lineHeight)));
  const shown = lines.slice(0, Math.min(opts.maxLines, room));
  ctx.textAlign = opts.align ?? "left";
  ctx.fillStyle = opts.colour;
  const anchor = ctx.textAlign === "center" ? box.x + box.w / 2 : box.x;
  shown.forEach((line, i) => {
    const last = i === shown.length - 1;
    ctx.fillText(last ? ellipsizeMiddle(ctx, line, box.w) : line, anchor, box.y + size + i * size * opts.lineHeight);
  });
  ctx.textAlign = "left";
  return size;
}

/** Foil gradient at 115° across a box, with evenly spaced theme stops. */
function foilGradient(
  ctx: CanvasRenderingContext2D,
  theme: TierTheme,
  box: { x: number; y: number; w: number; h: number },
): CanvasGradient {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rad = (115 * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const length = Math.abs(box.w * dx) + Math.abs(box.h * dy);
  const gradient = ctx.createLinearGradient(
    cx - (dx * length) / 2, cy - (dy * length) / 2,
    cx + (dx * length) / 2, cy + (dy * length) / 2,
  );
  theme.foil.forEach((stop, i) => gradient.addColorStop(i / (theme.foil.length - 1), stop));
  return gradient;
}

/** Flat concentric rings approximate a soft radial glow and keep PNGs small. */
function glowRings(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, hex: string, alpha: number): void {
  const steps = 20;
  for (let i = steps; i >= 1; i -= 1) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radius * i) / steps, 0, Math.PI * 2);
    ctx.fillStyle = rgba(hex, alpha / steps);
    ctx.fill();
  }
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: deterministic grain and sparkle placement. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, curved = true): void {
  const a = size * 0.16;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  if (curved) {
    ctx.quadraticCurveTo(x + a, y - a, x + size, y);
    ctx.quadraticCurveTo(x + a, y + a, x, y + size);
    ctx.quadraticCurveTo(x - a, y + a, x - size, y);
    ctx.quadraticCurveTo(x - a, y - a, x, y - size);
  } else {
    ctx.lineTo(x + a, y - a);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + a, y + a);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - a, y + a);
    ctx.lineTo(x - size, y);
    ctx.lineTo(x - a, y - a);
  }
  ctx.closePath();
  ctx.fill();
}

function overlaps(box: TextBox, x: number, y: number, size: number, pad = 10): boolean {
  return x + size + pad > box.x && x - size - pad < box.x + box.w &&
    y + size + pad > box.y && y - size - pad < box.y + box.h;
}

function debugBox(ctx: CanvasRenderingContext2D, box: TextBox): void {
  ctx.strokeStyle = "rgba(255,80,80,0.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
}

/* --------------------------- collectible layers --------------------------- */

function drawCollectibleBackground(ctx: CanvasRenderingContext2D, w: number, h: number, theme: TierTheme): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, theme.bg0);
  bg.addColorStop(1, theme.bg1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  glowRings(ctx, w * 0.7, h * 0.18, w * 0.7, theme.glow, 0.3);
  glowRings(ctx, w * 0.12, h, w * 0.55, theme.glow2, 0.18);
}

function drawGiantPi(ctx: CanvasRenderingContext2D, w: number, h: number, theme: TierTheme): void {
  ctx.save();
  ctx.globalAlpha = 0.05;
  setFont(ctx, 600, Math.min(820, Math.round(h * 0.76)), FONT_DISPLAY);
  ctx.textAlign = "center";
  ctx.fillStyle = theme.text;
  ctx.fillText("π", w * 0.7, h * 0.6 + 240);
  ctx.restore();
}

function drawDigitTexture(ctx: CanvasRenderingContext2D, w: number, h: number, theme: TierTheme, input: WishCardInput): void {
  const near = input.hideQuery ? FIRST_DIGITS : input.context?.text ?? FIRST_DIGITS;
  if (!near) return;
  const segment = near.slice(0, 24).replace(/\D/g, "").padEnd(24, "3").slice(0, 24);
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = theme.text;
  setFont(ctx, 500, 18, FONT_MONO);
  let text = "";
  while (ctx.measureText(text + segment).width < w + 40) text += segment;
  for (let y = 24; y < h; y += 48) ctx.fillText(text, -20, y);
  ctx.restore();
}

function drawTierEffects(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  theme: TierTheme,
  tier: WishCardInput["tier"],
  format: WishFormat,
  seed: number,
  boxes: TextBox[],
): void {
  const rand = seeded(seed ^ 0x5f3759df);
  if (tier === "gold") {
    ctx.save();
    ctx.strokeStyle = rgba(theme.foil[0], 0.06);
    ctx.lineWidth = 2;
    const ox = w * 0.78;
    const oy = h * 0.14;
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(angle) * w, oy + Math.sin(angle) * w);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (tier === "aurora") {
    glowRings(ctx, w * 0.24, h * 0.36, w * 0.32, theme.glow, 0.18);
    glowRings(ctx, w * 0.82, h * 0.72, w * 0.28, theme.glow2, 0.18);
  }
  if (tier === "twilight") {
    ctx.save();
    for (let i = 0; i < 60; i += 1) {
      const x = rand() * w;
      const y = rand() * h * 0.6;
      const size = 1 + rand() * 2;
      ctx.globalAlpha = 0.3 + rand() * 0.5;
      ctx.fillStyle = theme.foil[i % theme.foil.length];
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 0.24;
    const band = ctx.createLinearGradient(0, h, 0, h * 0.78);
    band.addColorStop(0, rgba(theme.glow2, 0.24));
    band.addColorStop(1, rgba(theme.glow2, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    ctx.restore();
  }
  const sparkles = tier === "gold" ? 22 : tier === "silver" ? 14 : tier === "aurora" ? 10 : 0;
  const count = format === "wide" ? Math.floor(sparkles / 2) : sparkles;
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const size = 10 + Math.floor(rand() * 17);
    let x = 0;
    let y = 0;
    let ok = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      x = size + rand() * (w - size * 2);
      y = size + rand() * (h - size * 2);
      ok = !boxes.some((box) => overlaps(box, x, y, size));
      if (ok) break;
    }
    if (!ok) continue;
    ctx.globalAlpha = 0.45 + rand() * 0.4;
    ctx.fillStyle = theme.foil[Math.floor(rand() * theme.foil.length)];
    star(ctx, x, y, size);
  }
  ctx.restore();

  if (tier === "gold" || tier === "silver") {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const rad = (115 * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const length = Math.abs(w * dx) + Math.abs(h * dy);
    const cx = w / 2;
    const cy = h / 2;
    const sheen = ctx.createLinearGradient(
      cx - (dx * length) / 2, cy - (dy * length) / 2,
      cx + (dx * length) / 2, cy + (dy * length) / 2,
    );
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.42, "rgba(255,255,255,0)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.16)");
    sheen.addColorStop(0.58, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    if (tier === "gold") {
      const rainbow = ctx.createLinearGradient(
        cx - (dx * length) / 2, cy - (dy * length) / 2,
        cx + (dx * length) / 2, cy + (dy * length) / 2,
      );
      // Warm foil-only hues: a green/blue stop here tinted the card's corner
      // and broke the tier colour-family check in the gallery.
      [30, 45, 60, 35].forEach((hue, i) => rainbow.addColorStop(i / 3, `hsla(${hue},90%,70%,0.08)`));
      ctx.fillStyle = rainbow;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }
}

function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, theme: TierTheme, format: WishFormat): void {
  const inset = format === "wide" ? 20 : 28;
  ctx.save();
  roundRect(ctx, inset, inset, w - inset * 2, h - inset * 2, 44);
  ctx.lineWidth = 4;
  ctx.strokeStyle = foilGradient(ctx, theme, { x: inset, y: inset, w: w - inset * 2, h: h - inset * 2 });
  ctx.stroke();
  const inner = inset + 16;
  roundRect(ctx, inner, inner, w - inner * 2, h - inner * 2, 32);
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(theme.text, 0.25);
  ctx.stroke();
  ctx.restore();
}

function drawHeaderCollectible(
  ctx: CanvasRenderingContext2D,
  theme: TierTheme,
  L: FormatLayout,
  format: WishFormat,
  copy: WishCopy,
): void {
  const size = format === "wide" ? 44 : 56;
  const cy = L.header.y + L.header.h / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(L.header.x + size / 2, cy, size / 2, 0, Math.PI * 2);
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  setFont(ctx, 600, size * 0.62, FONT_DISPLAY);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = theme.text;
  ctx.fillText("π", L.header.x + size / 2, cy + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  setFont(ctx, 600, format === "wide" ? 32 : 40, FONT_DISPLAY);
  ctx.fillText(APP_NAME, L.header.x + size + 18, cy + 14);
  ctx.restore();

  ctx.save();
  roundRect(ctx, L.tag.x, L.tag.y, L.tag.w, L.tag.h, 999);
  ctx.lineWidth = 2;
  ctx.strokeStyle = foilGradient(ctx, theme, L.tag);
  ctx.stroke();
  setFont(ctx, 500, format === "wide" ? 16 : 22, FONT_MONO);
  ctx.fillStyle = theme.text;
  const label = ellipsizeMiddle(ctx, copy.collectorTag, L.tag.w - 28);
  ctx.fillText(label, L.tag.x + 14, L.tag.y + L.tag.h / 2 + 7);
  ctx.restore();
}

function drawTierPill(
  ctx: CanvasRenderingContext2D,
  theme: TierTheme,
  L: FormatLayout,
  format: WishFormat,
  text: string,
): void {
  ctx.save();
  roundRect(ctx, L.pill.x, L.pill.y, L.pill.w, L.pill.h, 999);
  ctx.fillStyle = foilGradient(ctx, theme, L.pill);
  ctx.fill();
  ctx.fillStyle = theme.pillText;
  star(ctx, L.pill.x + 28, L.pill.y + L.pill.h / 2, 9, false);
  setFont(ctx, 600, format === "wide" ? 16 : 24, FONT_UI);
  tracked(ctx, text, L.pill.x + 50, L.pill.y + L.pill.h / 2 + 8, L.pill.w - 66, theme.pillText,
    format === "wide" ? 16 : 24, 14, 0.18);
  ctx.restore();
}

function drawAccentedLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: { x: number; y: number; w: number; h: number },
  size: number,
  weight: number,
  family: string,
  colour: string,
  accent: string,
): void {
  setFont(ctx, weight, size, family);
  const fitted = ellipsizeMiddle(ctx, text, box.w);
  const baseline = box.y + Math.min(size, box.h);
  const parts = fitted.split(/(\d[\d,]+\+?|\d+)/g);
  let cursor = box.x;
  ctx.textAlign = "left";
  parts.forEach((part) => {
    if (!part) return;
    ctx.fillStyle = /^\d/.test(part) ? accent : colour;
    ctx.fillText(part, cursor, baseline);
    cursor += ctx.measureText(part).width;
  });
}

function cellColour(value: number, kind: "color" | "shape", theme: TierTheme): string | null {
  if (value < 0) return null;
  if (kind === "color") return PALETTE[value % 10].dark;
  return value >= 5 ? theme.text : theme.bg0;
}

function drawHeroPlate(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  theme: TierTheme,
  L: FormatLayout,
  debug: boolean,
): void {
  const { x, y, w, h } = L.plate;
  ctx.save();
  roundRect(ctx, x, y, w, h, 28);
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, "rgba(255,255,255,0.10)");
  fill.addColorStop(1, "rgba(255,255,255,0.03)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = rgba(theme.foil[0], 0.6);
  ctx.stroke();
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 25);
  ctx.clip();

  if (input.pattern) {
    drawPattern(ctx, input, theme, L);
  } else if (input.mode === "letters") {
    drawLetters(ctx, input, theme, L);
  } else {
    const text = input.hideQuery ? "•".repeat(Math.min(20, input.query.length || 1)) : input.query;
    setFont(ctx, 500, 120, FONT_MONO);
    fitText(ctx, text, w - 48, 120, 40);
    ctx.textAlign = "center";
    ctx.fillStyle = theme.text;
    ctx.fillText(text, x + w / 2, y + h / 2 + 14);
    ctx.textAlign = "left";
  }
  ctx.restore();
  if (debug) debugBox(ctx, { id: "plate", ...L.plate, minSize: 0, decorative: true });

  if (input.dedication) {
    const label = `For ${input.dedication}`;
    ctx.save();
    setFont(ctx, 600, 18, FONT_UI);
    const width = Math.min(L.plate.w - 48, ctx.measureText(label).width + 44);
    const bx = L.plate.x + 24;
    const by = L.plate.y - 16;
    roundRect(ctx, bx, by, width, 32, 999);
    ctx.fillStyle = theme.bg1;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = foilGradient(ctx, theme, { x: bx, y: by, w: width, h: 32 });
    ctx.stroke();
    ctx.fillStyle = theme.text;
    ctx.fillText(ellipsizeMiddle(ctx, label, width - 28), bx + 14, by + 22);
    ctx.restore();
  }
}

function drawLetters(ctx: CanvasRenderingContext2D, input: WishCardInput, theme: TierTheme, L: FormatLayout): void {
  const { x, y, w, h } = L.plate;
  const word = input.hideQuery ? "•".repeat(Math.min(12, input.query.length || 1)) : input.query.toUpperCase();
  setFont(ctx, 600, 120, FONT_DISPLAY);
  const size = fitText(ctx, word, w - 48, 120, 48);
  const showPairs = size >= 68 && !input.hideQuery;
  ctx.textAlign = "center";
  ctx.fillStyle = theme.text;
  ctx.fillText(word, x + w / 2, y + h / 2 + (showPairs ? -4 : size * 0.3));
  if (showPairs) {
    const pairs = [...word].map((ch) => String(ch.charCodeAt(0) - 65).padStart(2, "0"));
    setFont(ctx, 500, 18, FONT_MONO);
    const widths = pairs.map((pair) => ctx.measureText(pair).width);
    const total = widths.reduce((a, b) => a + b, 0) + 12 * (pairs.length - 1);
    let cursor = x + (w - total) / 2;
    pairs.forEach((pair, i) => {
      ctx.fillStyle = theme.accent;
      ctx.fillText(pair, cursor + widths[i] / 2, y + h / 2 + 42);
      cursor += widths[i] + 12;
    });
  }
  ctx.textAlign = "left";
}

function drawPattern(ctx: CanvasRenderingContext2D, input: WishCardInput, theme: TierTheme, L: FormatLayout): void {
  const { x, y, w, h } = L.plate;
  const p = input.pattern!;
  const region = input.found && p.region
    ? p.region
    : { rows: p.rows, cols: p.cols, values: p.cells, matchRow: 0, matchCol: 0 };
  const maxCell = Math.min(56, (w - 72) / region.cols, (h - 72) / region.rows);
  const cell = Math.max(8, Math.floor(maxCell));
  const gridW = region.cols * cell;
  const gridH = region.rows * cell;
  const gx = x + (w - gridW) / 2;
  const gy = y + 12 + (h - gridH - 34) / 2;
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
  ctx.lineWidth = 3;
  if (input.found) {
    ctx.strokeRect(gx + region.matchCol * cell, gy + region.matchRow * cell, p.cols * cell, p.rows * cell);
  } else {
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(gx + (region.cols - p.cols) * cell / 2, gy + (region.rows - p.rows) * cell / 2, p.cols * cell, p.rows * cell);
    ctx.setLineDash([]);
  }
  setFont(ctx, 600, 20, FONT_UI);
  ctx.textAlign = "center";
  ctx.fillStyle = theme.dim;
  ctx.fillText(p.kind === "shape" ? "your shape" : "your pattern", x + w / 2, y + h - 16);
  ctx.textAlign = "left";
}

function drawQuote(
  ctx: CanvasRenderingContext2D,
  copy: WishCopy,
  theme: TierTheme,
  L: FormatLayout,
  format: WishFormat,
): void {
  ctx.save();
  ctx.globalAlpha = 0.25;
  setFont(ctx, 400, format === "wide" ? 100 : 160, FONT_DISPLAY);
  ctx.fillStyle = theme.accent;
  ctx.fillText("“", L.quote.x - 4, L.quote.y + (format === "wide" ? 40 : 66));
  ctx.restore();
  paragraph(ctx, copy.quote.text, L.quote, {
    weight: 400,
    family: FONT_DISPLAY,
    maxSize: format === "wide" ? 22 : 30,
    minSize: format === "wide" ? 18 : 22,
    maxLines: format === "wide" ? 1 : 2,
    lineHeight: 1.2,
    colour: theme.text,
  });
  ctx.save();
  setFont(ctx, 500, format === "wide" ? 14 : 20, FONT_UI);
  ctx.fillStyle = theme.dim;
  ctx.fillText(copy.quote.by ?? "— Pi Atlas", L.attribution.x, L.attribution.y + 16);
  ctx.restore();
}

function drawFooterCollectible(
  ctx: CanvasRenderingContext2D,
  copy: WishCopy,
  theme: TierTheme,
  L: FormatLayout,
  format: WishFormat,
): void {
  const site = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
  ctx.save();
  if (format === "square") {
    setFont(ctx, 600, 26, FONT_UI);
    ctx.fillStyle = theme.text;
    ctx.fillText(BRAND_TAGLINE, L.header.x, L.header.y + L.header.h + 36);
    setFont(ctx, 400, 22, FONT_UI);
    ctx.fillStyle = theme.dim;
    ctx.fillText("Scan to search yours", L.scan.x, L.scan.y + 18);
    setFont(ctx, 500, 24, FONT_MONO);
    ctx.fillStyle = theme.text;
    ctx.fillText(ellipsizeMiddle(ctx, site, L.site.w), L.site.x, L.site.y + 20);
    if (BRAND_HANDLE) {
      setFont(ctx, 600, 18, FONT_UI);
      ctx.fillStyle = theme.accent;
      ctx.fillText(BRAND_HANDLE, L.handle.x, L.handle.y + 14);
    }
    setFont(ctx, 400, 18, FONT_UI);
    ctx.fillStyle = theme.dim;
    ctx.fillText(copy.finePrint, L.fine.x, L.fine.y + 14);
  } else if (format === "story") {
    setFont(ctx, 600, 26, FONT_UI);
    ctx.fillStyle = theme.text;
    ctx.fillText(BRAND_TAGLINE, L.scan.x, L.scan.y - 12);
    setFont(ctx, 400, 24, FONT_UI);
    ctx.fillStyle = theme.dim;
    ctx.fillText("Scan to search yours", L.scan.x, L.scan.y + 24);
    setFont(ctx, 500, 28, FONT_MONO);
    ctx.fillStyle = theme.text;
    ctx.fillText(ellipsizeMiddle(ctx, site, L.site.w), L.site.x, L.site.y + 22);
    if (BRAND_HANDLE) {
      setFont(ctx, 600, 20, FONT_UI);
      ctx.fillStyle = theme.accent;
      ctx.fillText(BRAND_HANDLE, L.handle.x, L.handle.y + 20);
    }
    setFont(ctx, 400, 18, FONT_UI);
    ctx.fillStyle = theme.dim;
    ctx.fillText(copy.finePrint, L.fine.x, L.fine.y + 14);
  } else {
    setFont(ctx, 400, 16, FONT_UI);
    ctx.fillStyle = theme.dim;
    ctx.fillText("Scan to search yours", L.scan.x, L.scan.y + 16);
    setFont(ctx, 500, 16, FONT_MONO);
    ctx.fillStyle = theme.text;
    ctx.fillText(ellipsizeMiddle(ctx, site, L.site.w), L.site.x, L.site.y + 16);
    if (BRAND_HANDLE) {
      setFont(ctx, 600, 14, FONT_UI);
      ctx.fillStyle = theme.accent;
      ctx.fillText(BRAND_HANDLE, L.handle.x, L.handle.y + 14);
    }
    setFont(ctx, 400, 14, FONT_UI);
    ctx.fillStyle = theme.dim;
    ctx.fillText(copy.finePrint, L.fine.x, L.fine.y + 14);
  }
  ctx.restore();
}

function drawCollectible(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  copy: WishCopy,
  theme: TierTheme,
  qr: QrContent,
  format: WishFormat,
  seed: number,
  boxes: TextBox[],
  debug: boolean,
): void {
  const { width: w, height: h } = FORMATS[format];
  const L = LAYOUTS[format];
  drawCollectibleBackground(ctx, w, h, theme);
  drawGiantPi(ctx, w, h, theme);
  drawDigitTexture(ctx, w, h, theme, input);
  // Grain removed: even at 2% opacity the seeded noise dominated PNG size.
  // See DECISIONS.md (W-D9).
  drawTierEffects(ctx, w, h, theme, input.tier, format, seed, boxes);
  drawFrame(ctx, w, h, theme, format);
  drawHeaderCollectible(ctx, theme, L, format, copy);
  drawTierPill(ctx, theme, L, format, copy.eyebrow);
  paragraph(ctx, copy.headline, L.headline, {
    weight: 600,
    family: FONT_DISPLAY,
    maxSize: format === "square" ? 84 : format === "story" ? 96 : 60,
    minSize: format === "wide" ? 18 : 56,
    maxLines: format === "wide" ? 2 : 3,
    lineHeight: 1.04,
    colour: foilGradient(ctx, theme, L.headline),
  });
  paragraph(ctx, copy.subline, L.subline, {
    weight: 500,
    family: FONT_UI,
    maxSize: format === "wide" ? 22 : 30,
    minSize: format === "wide" ? 18 : 24,
    maxLines: 2,
    lineHeight: 1.25,
    colour: theme.dim,
  });
  drawHeroPlate(ctx, input, theme, L, debug);
  setFont(ctx, 600, format === "wide" ? 20 : 28, FONT_UI);
  drawAccentedLine(ctx, copy.odds, L.odds, format === "wide" ? 20 : 28, 600, FONT_UI, theme.text, theme.accent);
  drawQuote(ctx, copy, theme, L, format);
  drawFooterCollectible(ctx, copy, theme, L, format);
  drawQr(ctx, qr, L.qr.x, L.qr.y, L.qr.size);
  if (debug) boxes.forEach((box) => debugBox(ctx, box));
}

/* ------------------------------- clean style ------------------------------ */

interface CleanPalette {
  bg: string;
  raised: string;
  line: string;
  text: string;
  dim: string;
  accent: string;
  ink: string;
  paper: string;
}

function cleanPalette(theme: TierTheme): CleanPalette {
  return {
    bg: theme.bg0,
    raised: theme.bg1,
    line: rgba(theme.text, 0.15),
    text: theme.text,
    dim: theme.dim,
    accent: theme.accent,
    ink: theme.bg0,
    paper: theme.text,
  };
}

function cleanCountLabel(count: number): string {
  return count >= 200_000 ? "200,000+" : count.toLocaleString("en-US");
}

function cleanStats(input: WishCardInput): Array<[string, string]> {
  if (!input.found) {
    return [
      ["Expected depth", formatDepth(input.expectedDepthLog10)],
      ["Closest", input.longestPrefix
        ? `${input.longestPrefix.prefix} @ ${input.longestPrefix.position.toLocaleString("en-US")}`
        : "none"],
      ["Searched", input.datasetWords],
    ];
  }
  if (input.mode === "digits" || input.mode === "letters") {
    const luck = input.expected > 0 ? input.count / input.expected : 0;
    return [
      ["Position", (input.firstPosition ?? 0).toLocaleString("en-US")],
      ["Occurrences", cleanCountLabel(input.count)],
      ["Luck", `${luck >= 100 ? luck.toFixed(0) : luck.toFixed(2)}×`],
    ];
  }
  const region = input.pattern?.region;
  return [
    ["First at", region ? `r${region.matchRow + 1}, c${region.matchCol + 1}` : "—"],
    ["Matches", cleanCountLabel(input.count)],
    ["Frame", input.frame ?? "A"],
  ];
}

function drawCleanStats(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  xs: number[],
  colWidth: number,
  labelBaseline: number,
  valueBaseline: number,
  palette: CleanPalette,
  valueSize: number,
): void {
  cleanStats(input).forEach(([label, value], i) => {
    setFont(ctx, 600, 20, FONT_UI);
    fitText(ctx, label.toUpperCase(), colWidth, 20, 12);
    ctx.fillStyle = palette.dim;
    ctx.fillText(label.toUpperCase(), xs[i], labelBaseline);
    setFont(ctx, 600, valueSize, FONT_DISPLAY);
    fitText(ctx, value, colWidth, valueSize, 18);
    ctx.fillStyle = palette.text;
    ctx.fillText(value, xs[i], valueBaseline);
  });
}

function drawCleanContext(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  x: number,
  y: number,
  width: number,
  size: number,
  palette: CleanPalette,
): void {
  setFont(ctx, 500, size, FONT_MONO);
  if (input.hideQuery) {
    ctx.fillStyle = palette.dim;
    ctx.fillText("Context hidden by request", x, y);
    return;
  }
  if (!input.context) {
    ctx.fillStyle = palette.dim;
    ctx.fillText("Context unavailable at this position", x, y);
    return;
  }
  const { text, matchStart, matchLength } = input.context;
  const before = text.slice(0, matchStart);
  const match = text.slice(matchStart, matchStart + matchLength);
  const after = text.slice(matchStart + matchLength);
  fitText(ctx, text, width, size, 12);
  const bw = ctx.measureText(before).width;
  const mw = ctx.measureText(match).width;
  const start = x + Math.max(0, (width - ctx.measureText(text).width) / 2);
  ctx.fillStyle = palette.dim;
  ctx.fillText(before, start, y);
  ctx.fillStyle = palette.accent;
  ctx.fillText(match, start + bw, y);
  ctx.fillRect(start + bw, y + 5, mw, 2);
  ctx.fillStyle = palette.dim;
  ctx.fillText(after, start + bw + mw, y);
}

function drawCleanFooter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  palette: CleanPalette,
  copy: WishCopy,
): void {
  const site = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
  setFont(ctx, 600, 22, FONT_UI);
  ctx.fillStyle = palette.text;
  ctx.fillText(BRAND_TAGLINE, x, y);
  setFont(ctx, 400, 22, FONT_UI);
  ctx.fillStyle = palette.dim;
  ctx.fillText("Scan to search yours", x, y + 34);
  setFont(ctx, 500, 24, FONT_MONO);
  fitText(ctx, site, width, 24, 14);
  ctx.fillStyle = palette.text;
  ctx.fillText(site, x, y + 68);
  let cursor = y + 98;
  if (BRAND_HANDLE) {
    setFont(ctx, 600, 20, FONT_UI);
    ctx.fillStyle = palette.accent;
    ctx.fillText(BRAND_HANDLE, x, cursor);
    cursor += 28;
  }
  setFont(ctx, 400, 16, FONT_UI);
  ctx.fillStyle = palette.dim;
  ctx.fillText(copy.finePrint, x, cursor);
}

function drawClean(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  copy: WishCopy,
  theme: TierTheme,
  qr: QrContent,
  format: WishFormat,
  debug: boolean,
): void {
  const { width: W, margin: M } = FORMATS[format];
  const palette = cleanPalette(theme);
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, FORMATS[format].height);
  glowRings(ctx, W * 0.7, FORMATS[format].height * 0.18, W * 0.7, theme.accent, 0.2);
  drawDigitTexture(ctx, W, FORMATS[format].height, theme, input);

  if (format === "square") {
    drawCleanHeader(ctx, M, 106, W - M, palette, 56, 40, 22, input.datasetWords);
    tracked(ctx, copy.eyebrow, M, 205, W - 2 * M, palette.accent, 26, 16, 0.2);
    paragraph(ctx, copy.headline, { x: M, y: 250, w: W - 2 * M, h: 190 }, {
      weight: 600, family: FONT_DISPLAY, maxSize: 80, minSize: 44,
      maxLines: 2, lineHeight: 1.05, colour: palette.text,
    });
    drawHeroPlate(ctx, input, theme, LAYOUTS.square, debug);
    drawCleanStats(ctx, input, [M, M + 312, M + 624], 288, 700, 752, palette, 44);
    drawCleanContext(ctx, input, M, 815, W - 2 * M, 30, palette);
    drawCleanFooter(ctx, M, 890, 716, palette, copy);
    drawQr(ctx, qr, qrPlateFor(format, "clean").x, qrPlateFor(format, "clean").y, qrPlateFor(format, "clean").size);
  } else if (format === "story") {
    drawCleanHeader(ctx, M, 280, W - M, palette, 56, 40, 22, input.datasetWords);
    tracked(ctx, copy.eyebrow, M, 400, W - 2 * M, palette.accent, 26, 16, 0.2);
    paragraph(ctx, copy.headline, { x: M, y: 440, w: W - 2 * M, h: 200 }, {
      weight: 600, family: FONT_DISPLAY, maxSize: 92, minSize: 48,
      maxLines: 2, lineHeight: 1.05, colour: palette.text,
    });
    drawHeroPlate(ctx, input, theme, LAYOUTS.story, debug);
    drawCleanStats(ctx, input, [M, M + 312, M + 624], 288, 1100, 1160, palette, 48);
    drawCleanContext(ctx, input, M, 1235, W - 2 * M, 28, palette);
    drawCleanFooter(ctx, M, 1300, 320, palette, copy);
    const plate = qrPlateFor(format, "clean");
    drawQr(ctx, qr, plate.x, plate.y, plate.size);
  } else {
    drawCleanHeader(ctx, M, 92, 700, palette, 44, 32, 18, input.datasetWords);
    tracked(ctx, copy.eyebrow, M, 150, 700 - 2 * M, palette.accent, 20, 14, 0.2);
    paragraph(ctx, copy.headline, { x: M, y: 175, w: 700 - 2 * M, h: 120 }, {
      weight: 600, family: FONT_DISPLAY, maxSize: 64, minSize: 32,
      maxLines: 2, lineHeight: 1.05, colour: palette.text,
    });
    drawHeroPlate(ctx, input, theme, LAYOUTS.wide, debug);
    drawCleanStats(ctx, input, [M, M + 216, M + 432], 208, 500, 545, palette, 34);
    if (input.mode === "digits" || input.mode === "letters") {
      drawCleanContext(ctx, input, M, 585, 700 - 2 * M, 18, palette);
    }
    const plate = qrPlateFor(format, "clean");
    drawQr(ctx, qr, plate.x, plate.y, plate.size);
    ctx.textAlign = "center";
    setFont(ctx, 600, 18, FONT_UI);
    ctx.fillStyle = palette.text;
    ctx.fillText("Scan to search yours", 982, 375);
    const site = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
    setFont(ctx, 500, 18, FONT_MONO);
    fitText(ctx, site, 320, 18, 12);
    ctx.fillText(site, 982, 410);
    setFont(ctx, 600, 20, FONT_UI);
    ctx.fillStyle = palette.accent;
    ctx.fillText(BRAND_TAGLINE, 982, 452);
    setFont(ctx, 400, 16, FONT_UI);
    ctx.fillStyle = palette.dim;
    ctx.fillText(copy.finePrint, 982, 510);
    ctx.textAlign = "left";
  }
  if (debug) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,80,80,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(M, format === "wide" ? 48 : 72, W - 2 * M, FORMATS[format].height - (format === "wide" ? 96 : 144));
    ctx.restore();
  }
}

function drawCleanHeader(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  right: number,
  palette: CleanPalette,
  logoSize: number,
  wordmarkSize: number,
  rightSize: number,
  dataset: string,
): void {
  ctx.beginPath();
  ctx.arc(x + logoSize / 2, y, logoSize / 2, 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "center";
  setFont(ctx, 600, logoSize * 0.62, FONT_DISPLAY);
  ctx.fillStyle = palette.text;
  ctx.fillText("π", x + logoSize / 2, y + 8);
  ctx.textAlign = "left";
  setFont(ctx, 600, wordmarkSize, FONT_DISPLAY);
  ctx.fillText(APP_NAME, x + logoSize + 18, y + wordmarkSize * 0.35);
  ctx.textAlign = "right";
  setFont(ctx, 500, rightSize, FONT_MONO);
  const label = `${dataset} searched`;
  fitText(ctx, label, right - x - 420, rightSize, 11);
  ctx.fillStyle = palette.dim;
  ctx.fillText(label, right, y + rightSize * 0.35);
  ctx.textAlign = "left";
}
