/** PNG export, native share, and caption copy. All work happens on-device. */
import { APP_NAME } from "../constants";
import { copyText } from "../lib/share";

export type CardToast = (message: string) => void;

export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  try {
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  } catch {
    return null;
  }
}

export async function prepareCardFile(canvas: HTMLCanvasElement, filename: string): Promise<File | null> {
  const blob = await canvasToBlob(canvas);
  return blob ? new File([blob], filename, { type: "image/png" }) : null;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Download the PNG; iOS Safari's ignored download attribute opens a tab. */
export async function downloadCard(canvas: HTMLCanvasElement, filename: string, toast: CardToast): Promise<void> {
  const blob = await canvasToBlob(canvas);
  if (!blob) {
    toast("Couldn’t make the card. Try again.");
    return;
  }
  const url = URL.createObjectURL(blob);
  if (isIos()) {
    window.open(url, "_blank", "noopener");
    toast("Long-press the image to save");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Card saved");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Share the prepared File inside the click gesture, with a safe fallback. */
export async function shareCard(
  file: File | null,
  caption: string,
  canvas: HTMLCanvasElement,
  filename: string,
  toast: CardToast,
): Promise<void> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (file && nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: APP_NAME, text: caption });
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      // fall back to download + copied caption
    }
  }
  await downloadCard(canvas, filename, toast);
  const copied = await copyText(caption);
  toast(copied ? "Card saved and caption copied" : "Card saved, but the caption could not be copied");
}
