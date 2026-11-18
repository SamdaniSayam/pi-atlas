/** Share caption and query-free URL used when "Hide my digits" is on. */
import { BRAND_HASHTAG } from "../constants";
import { oneIn } from "./tiers";
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

/** The caption's link never carries the banner marker, even if one was added. */
export function stripSrcCard(url: string): string {
  const strip = (fragment: string) =>
    fragment
      .replace(/([?&])src=[^&]*/g, (_, sep: string) => (sep === "?" ? "?" : ""))
      .replace(/\?&/, "?")
      .replace(/\?$/, "");
  try {
    const u = new URL(url);
    u.hash = strip(u.hash);
    u.search = strip(u.search);
    return u.toString();
  } catch {
    return strip(url);
  }
}

/** Caption used by Copy caption and by the native share sheet. */
export function buildCaption(input: WishCardInput, shareUrl = input.shareUrl): string {
  const display = input.hideQuery ? "my secret digits" : input.query;
  const base = input.hideQuery ? stripQueryFromUrl(shareUrl) : shareUrl;
  const url = stripSrcCard(base);
  const p = (input.firstPosition ?? 0).toLocaleString("en-US");
  const D = input.datasetWords;
  const n = oneIn(input.expected);
  let body: string;
  switch (input.tier) {
    case "gold":
      body = `Legendary find! ${display} is in π at position ${p}. Only a 1 in ${n} chance in ${D}.`;
      break;
    case "silver":
      body = `Rare find! ${display} is in π at position ${p}.`;
      break;
    case "aurora":
      body = `I found ${display} in π at position ${p}!`;
      break;
    case "twilight":
      body = `${display} wasn’t in the first ${D} of π. Still special.`;
      break;
  }
  const dedication = input.dedication ? ` For ${input.dedication}.` : "";
  return `${body}${dedication} Try yours: ${url} ${BRAND_HASHTAG} #pi`;
}
