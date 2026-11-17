/** Sharing + PNG export (FR-11, §35). */

/** Copy text to clipboard with a fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export async function shareOrCopy(url: string, title: string): Promise<"shared" | "copied" | "failed"> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ title, url });
      return "shared";
    } catch {
      // user cancelled or share failed — fall through to copy
    }
  }
  const ok = await copyText(url);
  return ok ? "copied" : "failed";
}

/** Load all document fonts before drawing to canvas. */
export async function ensureFonts(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // fonts API unavailable — proceed with fallbacks
  }
}

export interface ExportOptions {
  appName: string;
  mode: string;
  query: string;
  position: string;
  contextBefore: string;
  contextMatch: string;
  contextAfter: string;
  datasetSize: number;
  disclaimer: string;
}

export async function exportSearchPng(opts: ExportOptions): Promise<Blob | null> {
  await ensureFonts();
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const isDark = !document.documentElement.classList.contains("light");
  const bg = isDark ? "#0B0F12" : "#F5F5F0";
  const surface = isDark ? "#11181D" : "#FFFFFF";
  const text = isDark ? "#F1F5F4" : "#182320";
  const text2 = isDark ? "#91A1A5" : "#64716C";
  const accent = isDark ? "#61E6C1" : "#087E68";
  const border = isDark ? "#27343A" : "#DCE3DD";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = accent;
  ctx.font = "600 20px 'JetBrains Mono', monospace";
  ctx.fillText(opts.appName.toUpperCase(), 64, 72);

  ctx.fillStyle = text;
  ctx.font = "600 44px 'Fraunces', Georgia, serif";
  ctx.fillText(opts.mode, 64, 148);

  ctx.fillStyle = text2;
  ctx.font = "400 22px 'Inter', system-ui, sans-serif";
  ctx.fillText(`Query: ${opts.query}`, 64, 196);
  ctx.fillText(`First occurrence: ${opts.position}`, 64, 232);
  ctx.fillText(`Dataset: ${opts.datasetSize.toLocaleString()} decimal digits`, 64, 268);

  // Context card
  const cardY = 310;
  const cardH = 200;
  ctx.fillStyle = surface;
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 64, cardY, W - 128, cardH, 16);
  ctx.fill();
  ctx.stroke();

  const mono = "28px 'JetBrains Mono', monospace";
  ctx.font = mono;
  const before = opts.contextBefore.slice(-14);
  const match = opts.contextMatch.slice(0, 24);
  const after = opts.contextAfter.slice(0, 10);
  const bw = ctx.measureText(before).width;
  const mw = ctx.measureText(match).width;

  const totalW = bw + mw + ctx.measureText(after).width;
  let x = 64 + (W - 128 - totalW) / 2;

  ctx.fillStyle = text2;
  ctx.fillText(before, x, cardY + cardH / 2 + 10);
  x += bw;

  ctx.fillStyle = accent;
  // highlight box
  const pad = 6;
  ctx.fillStyle = isDark ? "rgba(97,230,193,0.12)" : "rgba(8,126,104,0.10)";
  roundRect(ctx, x - pad, cardY + cardH / 2 - 24, mw + pad * 2, 40, 8);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillText(match, x, cardY + cardH / 2 + 10);
  x += mw;

  ctx.fillStyle = text2;
  ctx.fillText(after, x, cardY + cardH / 2 + 10);

  // Footer
  ctx.fillStyle = text2;
  ctx.font = "400 16px 'Inter', system-ui, sans-serif";
  ctx.fillText(opts.disclaimer, 64, H - 56);

  return await new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
