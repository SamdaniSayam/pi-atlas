/** Share caption and query-free URL used when "Hide my digits" is on. */
import { BRAND_HASHTAG } from "../constants";
import { datasetWords } from "./copy";
import type { WishCardInput } from "./types";

/** Remove the q/p parameters used by digits, letters and pattern searches. */
export function stripQueryFromUrl(url: string): string {
  const strip = (fragment: string) =>
    fragment
      .replace(/([?&])(?:q|p)=[^&]*/g, (_, sep: string) => (sep === "?" ? "?" : ""))
      .replace(/\?&/, "?")
      .replace(/\?$/, "");
  try {
    const u = new URL(url);
    u.hash = strip(u.hash);
    return u.toString();
  } catch {
    return strip(url);
  }
}

/** Caption used by Copy caption and by the native share sheet. */
export function buildCaption(input: WishCardInput, shareUrl = input.shareUrl): string {
  const display = input.hideQuery ? "my secret digits" : input.query;
  const url = input.hideQuery ? stripQueryFromUrl(shareUrl) : shareUrl;
  const tail = `Try yours: ${url} ${BRAND_HASHTAG} #pi`;
  return input.found
    ? `I searched π for ${display} and found it at position ${input.firstPosition?.toLocaleString("en-US") ?? "—"}! ${tail}`
    : `I searched π for ${display}. Not in the first ${datasetWords(input.datasetSize)} digits! ${tail}`;
}
