/** Pure rarity-tier logic. No DOM, no randomness, no logging. */
import { describeMagnitude } from "../engine/format";
import type { WishCardInput, WishTier } from "./types";

/** Expected-match counts at or below which a found result becomes rare. */
export const TIER_THRESHOLDS = { gold: 0.01, silver: 1 } as const;

/** Short names used in the result heading and the line under the preview. */
export const TIER_LABELS: Record<WishTier, string> = {
  gold: "Legendary",
  silver: "Rare",
  aurora: "Lucky",
  twilight: "Twilight",
};

/** Uppercase pill text; twilight has a near-miss variant. */
export function tierPill(input: Pick<WishCardInput, "tier" | "query" | "longestPrefix">): string {
  if (input.tier === "gold") return "LEGENDARY FIND";
  if (input.tier === "silver") return "RARE FIND";
  if (input.tier === "aurora") return "LUCKY FIND";
  const prefix = input.longestPrefix?.prefix.length ?? 0;
  return prefix >= input.query.length - 1 ? "SO CLOSE" : "BEYOND THE HORIZON";
}

/**
 * Rarity from the result alone. A missing query is always twilight; otherwise
 * the expected number of random-digit matches decides. Invalid expectations
 * are treated as 1 (aurora) and never logged.
 */
export function tierFor(input: Pick<WishCardInput, "found" | "expected">): WishTier {
  if (!input.found) return "twilight";
  const expected = Number.isFinite(input.expected) && input.expected > 0 ? input.expected : 1;
  if (expected < TIER_THRESHOLDS.gold) return "gold";
  if (expected < TIER_THRESHOLDS.silver) return "silver";
  return "aurora";
}

/**
 * "Only a 1 in N chance" text for rare finds. P = 1 - e^-expected is the
 * probability of at least one match under the same random-digit model.
 */
export function oneIn(expected: number): string {
  const safe = Number.isFinite(expected) && expected > 0 ? expected : 1;
  const probability = 1 - Math.exp(-safe);
  return describeMagnitude(Math.round(1 / probability));
}
