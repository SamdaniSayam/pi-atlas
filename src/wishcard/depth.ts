/** Superscript "10^n" label used by the not-found depth line. */
export function formatDepth(log10: number): string {
  const k = Math.max(1, Math.round(Number.isFinite(log10) ? log10 : 1));
  const superscript: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  };
  return `10${String(k).split("").map((d) => superscript[d]).join("")}`;
}
