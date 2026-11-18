/**
 * Pure canvas-2D wish-card renderer. No DOM layout, no network, no images.
 * The same canvas is used for the preview and for the downloaded PNG.
 */
import { APP_NAME, BRAND_HANDLE, BRAND_TAGLINE, SITE_URL } from "../constants";
import { difficultyFor } from "../engine/format";
import { PALETTE } from "../engine/palette";
import { FINE_PRINT, datasetShort, hashString, pickCopy } from "./copy";
import {
  FORMATS,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  cacheKeyFor,
  ellipsizeMiddle,
  fitText,
} from "./layout";
import { drawQr, qrContentFor, type QrContent } from "./qr";
import type { WishCardInput, WishCopy, WishFormat, WishOptions } from "./types";

interface Palette {
  bg: string;
  raised: string;
  line: string;
  text: string;
  dim: string;
  accent: string;
  ink: string;
  paper: string;
  textureAlpha: number;
}

const PALETTES: Record<WishOptions["style"], Palette> = {
  night: {
    bg: "#0A0D12", raised: "#10151D", line: "#222B3A", text: "#E9EEF7",
    dim: "#9AA7BD", accent: "#5EEAD4", ink: "#07090D", paper: "#F1ECE0",
    textureAlpha: 0.05,
  },
  paper: {
    bg: "#F6F2E9", raised: "#FFFDF8", line: "#DDD5C3", text: "#161A22",
    dim: "#4A5468", accent: "#0F766E", ink: "#14181F", paper: "#FBF8F0",
    textureAlpha: 0.06,
  },
};

const FIRST_DIGITS =
  "314159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706" +
  "798253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446";

const CACHE_LIMIT = 6;
const cache = new Map<string, RenderedCard>();

export interface RenderedCard {
  canvas: HTMLCanvasElement;
  qr: QrContent;
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

/** Wait for the three card fonts, but never longer than two seconds. */
export async function waitForFonts(timeoutMs = 2000): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined;
  if (!fonts || typeof fonts.load !== "function") return;
  const specs = [
    '600 80px "Fraunces"',
    '600 26px "Inter"',
    '500 30px "Jetbrains Mono"',
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
  cache.set(key, found); // refresh LRU order
  return found;
}

/** Render a card, reusing one of the six most recent identical cards. */
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
  const palette = PALETTES[options.style];
  const copy = pickCopy(input);
  const seed = hashString(`${input.mode}|${input.query}`);

  drawBackground(ctx, spec.width, spec.height, palette, input.found);
  if (input.found) drawSparkles(ctx, spec.width, spec.height, seed, options.format, input);

  const qr = qrContentFor(input);
  if (options.format === "square") drawSquare(ctx, input, palette, copy, qr, debug);
  else if (options.format === "story") drawStory(ctx, input, palette, copy, qr, debug);
  else drawWide(ctx, input, palette, copy, qr, debug);

  const rendered = { canvas, qr };
  if (!debug) {
    cache.set(key, rendered);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  }
  return rendered;
}

/* ----------------------------- shared drawing ----------------------------- */

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

function font(ctx: CanvasRenderingContext2D, weight: number, size: number, family: string): void {
  ctx.font = `${weight} ${size}px ${family}`;
}

function tracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baseline: number,
  maxWidth: number,
  colour: string,
  size: number,
  spacingEm = 0.2,
): number {
  font(ctx, 600, size, FONT_UI);
  while (size > 12 && measureTracked(ctx, text, spacingEm) > maxWidth) {
    size -= 2;
    font(ctx, 600, size, FONT_UI);
  }
  ctx.fillStyle = colour;
  const spacing = size * spacingEm;
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, baseline);
    cursor += ctx.measureText(ch).width + spacing;
  }
  return cursor;
}

function measureTracked(ctx: CanvasRenderingContext2D, text: string, spacingEm: number): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 16);
  let total = 0;
  for (const ch of text) total += ctx.measureText(ch).width + size * spacingEm;
  return Math.max(0, total - size * spacingEm);
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

function headline(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  firstBaseline: number,
  maxWidth: number,
  maxLines: number,
  maxSize: number,
  minSize: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  for (let size = maxSize; size >= minSize; size -= 2) {
    font(ctx, 600, size, FONT_DISPLAY);
    const lines = linesFor(ctx, text, maxWidth);
    if (lines.length <= maxLines) {
      lines.forEach((line, i) => ctx.fillText(line, x, firstBaseline + i * size * 1.05));
      return;
    }
  }
  font(ctx, 600, minSize, FONT_DISPLAY);
  const lines = linesFor(ctx, text, maxWidth).slice(0, maxLines);
  lines.forEach((line, i) => {
    const last = i === lines.length - 1;
    const shown = last ? ellipsizeMiddle(ctx, line, maxWidth) : line;
    ctx.fillText(shown, x, firstBaseline + i * minSize * 1.05);
  });
}

function labelValue(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  colWidth: number,
  labelBaseline: number,
  valueBaseline: number,
  palette: Palette,
  valueSize: number,
): void {
  font(ctx, 600, 20, FONT_UI);
  const labelSize = fitText(ctx, label.toUpperCase(), colWidth, 20, 12);
  ctx.fillStyle = palette.dim;
  ctx.fillText(label.toUpperCase(), x, labelBaseline - (20 - labelSize));
  font(ctx, 600, valueSize, FONT_DISPLAY);
  fitText(ctx, value, colWidth, valueSize, 18);
  ctx.fillStyle = palette.text;
  ctx.fillText(value, x, valueBaseline);
}

function countLabel(count: number): string {
  if (count >= 200_000) return "200,000+";
  return count.toLocaleString("en-US");
}

function depthLabel(log10: number): string {
  const map: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  };
  return `10${String(Math.max(1, Math.round(log10))).split("").map((d) => map[d]).join("")}`;
}

function statsFor(input: WishCardInput): Array<[string, string]> {
  if (!input.found) {
    const closest = input.longestPrefix
      ? `${input.longestPrefix.prefix} @ ${input.longestPrefix.position.toLocaleString("en-US")}`
      : "none";
    return [
      ["Expected depth", depthLabel(input.expectedDepthLog10)],
      ["Closest", closest],
      ["Searched", datasetShort(input.datasetSize)],
    ];
  }
  if (input.mode === "digits") {
    const luck = input.expected > 0 ? input.count / input.expected : 0;
    return [
      ["Position", (input.firstPosition ?? 0).toLocaleString("en-US")],
      ["Occurrences", countLabel(input.count)],
      ["Luck", `${luck >= 100 ? luck.toFixed(0) : luck.toFixed(2)}×`],
    ];
  }
  if (input.mode === "letters") {
    return [
      ["Position", (input.firstPosition ?? 0).toLocaleString("en-US")],
      ["Occurrences", countLabel(input.count)],
      ["Frame", input.frame ?? "A"],
    ];
  }
  const region = input.pattern?.region;
  const where = region ? `r${region.matchRow + 1}, c${region.matchCol + 1}` : "—";
  return [
    ["First at", where],
    ["Matches", countLabel(input.count)],
    ["Difficulty", difficultyFor(input.expected).label],
  ];
}

function drawStats(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  xs: number[],
  colWidth: number,
  labelBaseline: number,
  valueBaseline: number,
  palette: Palette,
  valueSize: number,
): void {
  const stats = statsFor(input);
  stats.forEach(([label, value], i) => labelValue(ctx, label, value, xs[i], colWidth, labelBaseline, valueBaseline, palette, valueSize));
}

function drawContext(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  x: number,
  y: number,
  width: number,
  size: number,
  palette: Palette,
): void {
  ctx.font = `500 ${size}px ${FONT_MONO}`;
  if (input.hideQuery) {
    ctx.fillStyle = palette.dim;
    ctx.fillText("Context hidden by request", x, y);
    return;
  }
  if (input.mode === "pixels" || input.mode === "shapes") {
    const region = input.pattern?.region;
    const pos = input.firstPosition?.toLocaleString("en-US") ?? "—";
    const text = region
      ? `Row ${region.matchRow + 1} · Column ${region.matchCol + 1} · Position ${pos}`
      : `Position ${pos}`;
    font(ctx, 500, size, FONT_MONO);
    fitText(ctx, text, width, size, 12);
    ctx.fillStyle = palette.dim;
    ctx.fillText(text, x, y);
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
  font(ctx, 500, size, FONT_MONO);
  fitText(ctx, text, width, size, 12);
  const bw = ctx.measureText(before).width;
  const mw = ctx.measureText(match).width;
  const aw = ctx.measureText(after).width;
  const start = x + Math.max(0, (width - (bw + mw + aw)) / 2);
  ctx.fillStyle = palette.dim;
  ctx.fillText(before, start, y);
  ctx.fillStyle = palette.accent;
  ctx.fillText(match, start + bw, y);
  ctx.fillRect(start + bw, y + 5, mw, 2);
  ctx.fillStyle = palette.dim;
  ctx.fillText(after, start + bw + mw, y);
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  palette: Palette,
  align: CanvasTextAlign = "left",
  compact = false,
): number {
  const site = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
  ctx.textAlign = align;
  const anchor = align === "center" ? x + width / 2 : x;
  const taglineSize = compact ? 22 : 26;
  font(ctx, 600, taglineSize, FONT_UI);
  fitText(ctx, BRAND_TAGLINE, width, taglineSize, 14);
  ctx.fillStyle = palette.text;
  ctx.fillText(BRAND_TAGLINE, anchor, y);
  font(ctx, 400, 22, FONT_UI);
  ctx.fillStyle = palette.dim;
  ctx.fillText("Scan to search yours", anchor, y + 34);
  font(ctx, 500, 24, FONT_MONO);
  fitText(ctx, site, width, 24, 14);
  ctx.fillStyle = palette.text;
  ctx.fillText(site, anchor, y + 68);
  let cursor = y + 98;
  if (BRAND_HANDLE) {
    font(ctx, 600, 20, FONT_UI);
    ctx.fillStyle = palette.accent;
    ctx.fillText(BRAND_HANDLE, anchor, cursor);
    cursor += 28;
  }
  font(ctx, 400, 16, FONT_UI);
  ctx.fillStyle = palette.dim;
  ctx.fillText(FINE_PRINT, anchor, cursor);
  ctx.textAlign = "left";
  return cursor;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  palette: Palette,
  found: boolean,
): void {
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, w, h);
  const glowColour = found ? palette.accent : "#7C89A2";
  // Concentric flat rings approximate the soft glow. Unlike a smooth gradient
  // they repeat exact colours across large areas, which keeps the PNG small.
  const steps = 24;
  const baseAlpha = found ? 0.22 : 0.2;
  for (let i = steps; i >= 1; i -= 1) {
    ctx.beginPath();
    ctx.arc(w * 0.7, h * 0.18, (w * 0.7 * i) / steps, 0, Math.PI * 2);
    ctx.fillStyle = rgba(glowColour, baseAlpha / steps);
    ctx.fill();
  }
}

function drawTextureWithDigits(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  palette: Palette,
  input: WishCardInput,
): void {
  const near = input.context?.text ?? FIRST_DIGITS;
  if (!near) return;
  // A single short repeated segment, drawn identically on every row. The
  // repetition keeps the PNG small while still reading as real π digits.
  const segment = near.slice(0, 24).replace(/\D/g, "").padEnd(24, "3").slice(0, 24);
  ctx.save();
  ctx.globalAlpha = palette.textureAlpha;
  ctx.fillStyle = palette.text;
  font(ctx, 500, 18, FONT_MONO);
  let text = "";
  while (ctx.measureText(text + segment).width < w + 40) text += segment;
  for (let y = 24; y < h; y += 48) ctx.fillText(text, -20, y);
  ctx.restore();
}

function seeded(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const a = size * 0.16;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + a, y - a);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + a, y + a);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - a, y + a);
  ctx.lineTo(x - size, y);
  ctx.lineTo(x - a, y - a);
  ctx.closePath();
  ctx.fill();
}

function drawSparkles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  format: WishFormat,
  input: WishCardInput,
): void {
  const rand = seeded(seed);
  const paletteColours = input.pattern
    ? PALETTE.map((p) => p.dark)
    : ["#5EEAD4", "#65BCEB", "#A78BFA", "#E7BD72"];
  const plateTop = format === "wide" ? 310 : format === "story" ? 660 : 470;
  const plateBottom = format === "wide" ? 460 : format === "story" ? 1020 : 650;
  ctx.save();
  for (let i = 0; i < 14; i += 1) {
    const size = 10 + Math.floor(rand() * 17);
    const alpha = 0.5 + rand() * 0.4;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = paletteColours[Math.floor(rand() * paletteColours.length)];
    let x: number;
    let y: number;
    if (i < 7) {
      x = w * (0.62 + rand() * 0.31);
      y = Math.max(plateTop * 0.45, h * 0.15 + rand() * h * 0.06);
    } else {
      const left = i % 2 === 0;
      x = left ? 48 + rand() * 70 : w - 48 - rand() * 70;
      y = (i % 4 < 2 ? plateTop - 10 : plateBottom + 10) + (rand() - 0.5) * 16;
    }
    star(ctx, x, y, size);
  }
  ctx.restore();
}

function drawHeroPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: Palette,
  input: WishCardInput,
  debug: boolean,
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 24);
  ctx.fillStyle = palette.raised;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.line;
  ctx.stroke();
  ctx.beginPath();
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 22);
  ctx.clip();

  if (input.pattern) {
    drawPattern(ctx, x, y, w, h, palette, input);
  } else if (input.mode === "letters") {
    drawLetters(ctx, x, y, w, h, palette, input);
  } else {
    const text = input.hideQuery ? "•".repeat(Math.min(20, input.query.length || 1)) : input.query;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    font(ctx, 500, 120, FONT_MONO);
    fitText(ctx, text, w - 48, 120, 40);
    ctx.fillStyle = palette.text;
    ctx.fillText(text, x + w / 2, y + h / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  if (debug) debugBox(ctx, x, y, w, h);
  ctx.restore();
}

function drawLetters(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: Palette,
  input: WishCardInput,
): void {
  const word = input.hideQuery ? "•".repeat(Math.min(12, input.query.length || 1)) : input.query.toUpperCase();
  ctx.textAlign = "center";
  font(ctx, 600, 120, FONT_DISPLAY);
  const size = fitText(ctx, word, w - 48, 120, 48);
  const showPairs = size >= 68 && !input.hideQuery;
  ctx.fillStyle = palette.text;
  ctx.fillText(word, x + w / 2, y + h / 2 + (showPairs ? -4 : size * 0.3));
  if (showPairs) {
    const pairs = [...word].map((ch) => String(ch.charCodeAt(0) - 65).padStart(2, "0"));
    const widths = pairs.map((pair) => {
      font(ctx, 500, 18, FONT_MONO);
      return ctx.measureText(pair).width;
    });
    const total = widths.reduce((a, b) => a + b, 0) + 12 * (pairs.length - 1);
    let cursor = x + (w - total) / 2;
    pairs.forEach((pair, i) => {
      ctx.fillStyle = palette.accent;
      ctx.fillText(pair, cursor + widths[i] / 2, y + h / 2 + 42);
      cursor += widths[i] + 12;
    });
  }
  ctx.textAlign = "left";
}

function cellColour(value: number, kind: "color" | "shape", palette: Palette): string | null {
  if (value < 0) return null;
  if (kind === "color") return PALETTE[value % 10].dark;
  return value >= 5 ? palette.paper : palette.ink;
}

function drawPattern(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: Palette,
  input: WishCardInput,
): void {
  const p = input.pattern!;
  const kind = p.kind;
  const region = input.found && p.region ? p.region : { rows: p.rows, cols: p.cols, values: p.cells, matchRow: 0, matchCol: 0 };
  const maxCell = Math.min(56, (w - 72) / region.cols, (h - 72) / region.rows);
  const cell = Math.max(8, Math.floor(maxCell));
  const gridW = region.cols * cell;
  const gridH = region.rows * cell;
  const gx = x + (w - gridW) / 2;
  const gy = y + 12 + (h - gridH - 34) / 2;
  for (let r = 0; r < region.rows; r += 1) {
    for (let c = 0; c < region.cols; c += 1) {
      const value = region.values[r * region.cols + c];
      const colour = cellColour(value ?? -1, kind, palette);
      const px = gx + c * cell;
      const py = gy + r * cell;
      if (colour) {
        ctx.fillStyle = colour;
        ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
      } else {
        ctx.strokeStyle = palette.dim;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
        ctx.setLineDash([]);
      }
    }
  }
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  const outlineX = gx + region.matchCol * cell;
  const outlineY = gy + region.matchRow * cell;
  if (input.found) ctx.strokeRect(outlineX, outlineY, p.cols * cell, p.rows * cell);
  else {
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(gx + (region.cols - p.cols) * cell / 2, gy + (region.rows - p.rows) * cell / 2, p.cols * cell, p.rows * cell);
    ctx.setLineDash([]);
  }
  ctx.textAlign = "center";
  font(ctx, 600, 20, FONT_UI);
  fitText(ctx, kind === "shape" ? "your shape" : "your pattern", w - 40, 20, 12);
  ctx.fillStyle = palette.dim;
  ctx.fillText(kind === "shape" ? "your shape" : "your pattern", x + w / 2, y + h - 16);
  ctx.textAlign = "left";
}

function debugBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.strokeStyle = "rgba(255,80,80,0.9)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  right: number,
  palette: Palette,
  logoSize: number,
  wordmarkSize: number,
  rightSize: number,
  datasetSize: number,
): void {
  const cy = y;
  ctx.beginPath();
  ctx.arc(x + logoSize / 2, cy, logoSize / 2, 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  font(ctx, 600, logoSize * 0.62, FONT_DISPLAY);
  ctx.fillStyle = palette.text;
  ctx.fillText("π", x + logoSize / 2, cy + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  font(ctx, 600, wordmarkSize, FONT_DISPLAY);
  ctx.fillText(APP_NAME, x + logoSize + 18, cy + wordmarkSize * 0.35);
  ctx.textAlign = "right";
  font(ctx, 500, rightSize, FONT_MONO);
  const label = `${datasetShort(datasetSize)} searched`;
  fitText(ctx, label, right - x, rightSize, 11);
  ctx.fillStyle = palette.dim;
  ctx.fillText(label, right, cy + rightSize * 0.35);
  ctx.textAlign = "left";
}

/* ------------------------------- formats ---------------------------------- */

function drawSquare(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  palette: Palette,
  copy: WishCopy,
  qr: QrContent,
  debug: boolean,
): void {
  const { width: W, margin: M } = FORMATS.square;
  drawTextureWithDigits(ctx, W, FORMATS.square.height, palette, input);
  drawHeader(ctx, M, 106, W - M, palette, 56, 40, 22, input.datasetSize);
  tracked(ctx, copy.eyebrow, M, 205, W - 2 * M, palette.accent, 26);
  headline(ctx, copy.headline, M, 330, W - 2 * M, 2, 80, 44, palette.text);
  drawHeroPlate(ctx, M, 470, W - 2 * M, 180, palette, input, debug);
  drawStats(ctx, input, [M, M + 312, M + 624], 288, 700, 752, palette, 44);
  drawContext(ctx, input, M, 815, W - 2 * M, 30, palette);
  drawFooter(ctx, M, 890, 716, palette);
  drawQr(ctx, qr, 836, 836, 172);
  if (debug) {
    debugBox(ctx, M, 72, W - 2 * M, 68);
    debugBox(ctx, M, 180, W - 2 * M, 40);
    debugBox(ctx, M, 250, W - 2 * M, 190);
    debugBox(ctx, M, 680, W - 2 * M, 80);
    debugBox(ctx, M, 785, W - 2 * M, 45);
    debugBox(ctx, M, 860, 716, 148);
  }
}

function drawStory(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  palette: Palette,
  copy: WishCopy,
  qr: QrContent,
  debug: boolean,
): void {
  const { width: W, margin: M } = FORMATS.story;
  drawTextureWithDigits(ctx, W, FORMATS.story.height, palette, input);
  drawHeader(ctx, M, 280, W - M, palette, 56, 40, 22, input.datasetSize);
  tracked(ctx, copy.eyebrow, M, 400, W - 2 * M, palette.accent, 26);
  headline(ctx, copy.headline, M, 510, W - 2 * M, 2, 92, 48, palette.text);
  drawHeroPlate(ctx, M, 660, W - 2 * M, 360, palette, input, debug);
  drawStats(ctx, input, [M, M + 312, M + 624], 288, 1100, 1160, palette, 48);
  drawContext(ctx, input, M, 1235, W - 2 * M, 28, palette);
  drawFooter(ctx, M, 1300, 320, palette, "left", true);
  drawQr(ctx, qr, (W - 260) / 2, 1300, 260);
  if (debug) {
    debugBox(ctx, M, 220, W - 2 * M, 1360);
    debugBox(ctx, M, 660, W - 2 * M, 360);
  }
}

function drawWide(
  ctx: CanvasRenderingContext2D,
  input: WishCardInput,
  palette: Palette,
  copy: WishCopy,
  qr: QrContent,
  debug: boolean,
): void {
  const { width: W, margin: M } = FORMATS.wide;
  drawTextureWithDigits(ctx, W, FORMATS.wide.height, palette, input);
  drawHeader(ctx, M, 92, 700, palette, 44, 32, 18, input.datasetSize);
  tracked(ctx, copy.eyebrow, M, 150, 700 - 2 * M, palette.accent, 20);
  headline(ctx, copy.headline, M, 220, 700 - 2 * M, 2, 64, 32, palette.text);
  drawHeroPlate(ctx, M, 310, 700 - 2 * M, 150, palette, input, debug);
  drawStats(ctx, input, [M, M + 216, M + 432], 208, 500, 545, palette, 34);
  if (input.mode === "digits" || input.mode === "letters") {
    drawContext(ctx, input, M, 585, 700 - 2 * M, 18, palette);
  }
  drawQr(ctx, qr, 872, 120, 220);
  ctx.textAlign = "center";
  font(ctx, 600, 18, FONT_UI);
  ctx.fillStyle = palette.text;
  ctx.fillText("Scan to search yours", 982, 375);
  const site = SITE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
  font(ctx, 500, 18, FONT_MONO);
  fitText(ctx, site, 320, 18, 12);
  ctx.fillStyle = palette.text;
  ctx.fillText(site, 982, 410);
  font(ctx, 600, 20, FONT_UI);
  ctx.fillStyle = palette.accent;
  ctx.fillText(BRAND_TAGLINE, 982, 452);
  if (BRAND_HANDLE) {
    font(ctx, 600, 16, FONT_UI);
    ctx.fillStyle = palette.accent;
    ctx.fillText(BRAND_HANDLE, 982, 480);
  }
  font(ctx, 400, 14, FONT_UI);
  ctx.fillStyle = palette.dim;
  ctx.fillText(FINE_PRINT, 982, 510);
  ctx.textAlign = "left";
  if (debug) {
    debugBox(ctx, M, 48, 700 - 2 * M, 534);
    debugBox(ctx, 792, 96, 360, 438);
  }
}
