/** Local QR generation with the `qrcode` library; no network, no image service. */
import QRCode from "qrcode";
import { stripQueryFromUrl } from "./caption";
import type { WishCardInput } from "./types";

const MAX_VERSION = 9;

export interface QrContent {
  text: string;
  /** True when the full share link was shortened to keep the QR scannable. */
  shortened: boolean;
}

/** Explorer URL for the same mode with no search parameters at all. */
export function explorerUrl(shareUrl: string): string {
  try {
    const u = new URL(shareUrl);
    u.hash = u.hash.split("?")[0];
    u.search = "";
    return u.toString();
  } catch {
    return shareUrl.split("?")[0];
  }
}

/**
 * Choose the QR payload. A version >= 10 symbol is too dense for the small
 * card plate, so long links fall back to the parameter-free explorer URL.
 */
export function qrContentFor(input: WishCardInput): QrContent {
  const preferred = input.hideQuery ? stripQueryFromUrl(input.shareUrl) : input.shareUrl;
  try {
    const qr = QRCode.create(preferred, { errorCorrectionLevel: "M" });
    if (qr.version <= MAX_VERSION) return { text: preferred, shortened: false };
  } catch {
    // fall through to the short URL
  }
  return { text: explorerUrl(input.shareUrl), shortened: true };
}

/** White plate with a 4-module quiet zone, drawn with integer-size squares. */
export function drawQr(
  ctx: CanvasRenderingContext2D,
  content: QrContent,
  x: number,
  y: number,
  plateSize: number,
): void {
  const qr = QRCode.create(content.text, { errorCorrectionLevel: "M" });
  const count = qr.modules.size;
  const padding = Math.max(8, Math.round(plateSize * 0.07));
  const inner = plateSize - padding * 2;
  const module = Math.max(4, Math.floor(inner / (count + 8)));
  const quiet = 4 * module;
  const qrSize = count * module + quiet * 2;
  const left = x + (plateSize - qrSize) / 2;
  const top = y + (plateSize - qrSize) / 2;
  const radius = Math.min(16, plateSize / 8);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, plateSize, plateSize, radius);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0A0D12";
  const data = qr.modules.data;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (data[row * count + col]) {
        ctx.fillRect(
          Math.round(left + quiet + col * module),
          Math.round(top + quiet + row * module),
          module,
          module,
        );
      }
    }
  }
  ctx.restore();
}
