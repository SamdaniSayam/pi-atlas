/**
 * Probability helpers (FR-07, odds model).
 * All calculations use log10 arithmetic so huge spaces never overflow.
 */

export interface OddsModel {
  colours: number;
  width: number;
  height: number;
  pixels: number;
  /** log10 of the expected search space: pixels × log10(colours). */
  log10Space: number;
  /** Probability of a match at a random valid location. */
  probability: number;
  /** log10 of 1/probability (equals log10Space when probability fits). */
  log10OneIn: number;
}

export function computeOdds(colours: number, width: number, height: number): OddsModel {
  const pixels = width * height;
  const log10Space = pixels * Math.log10(colours);
  // probability may underflow to 0 for huge spaces; keep both representations
  const probability = pixels === 0 ? 1 : Math.pow(10, -log10Space);
  return {
    colours,
    width,
    height,
    pixels,
    log10Space,
    probability,
    log10OneIn: log10Space,
  };
}

export interface DatasetComparison {
  /** log10 of the number of valid anchor positions in a 2M-digit stream. */
  log10Anchors: number;
  /** log10 of expected matches = log10Anchors - log10Space. */
  log10ExpectedMatches: number;
  /** Human description of whether a match is expected in the dataset. */
  verdict: string;
}

export function compareToDataset(
  odds: OddsModel,
  datasetSize = 2_000_000,
  cols = odds.width,
): DatasetComparison {
  const anchors = Math.max(1, (datasetSize / cols) * (cols - odds.width + 1) * 1);
  // Valid horizontal anchors per row ≈ (cols - width + 1); rows ≈ dataset / cols.
  const validAnchors = Math.max(1, (datasetSize / cols) * Math.max(1, cols - odds.width + 1));
  const log10Anchors = Math.log10(validAnchors);
  const log10Expected = log10Anchors - odds.log10Space;
  let verdict: string;
  if (log10Expected >= 0.3) {
    verdict = "Expected to appear many times in the dataset.";
  } else if (log10Expected >= -0.3) {
    verdict = "Right at the edge of what the dataset can hold. A match would be a coin flip.";
  } else if (log10Expected > -3) {
    verdict = "A match would be lucky. It is not expected in this dataset.";
  } else {
    verdict = "Astronomically beyond the dataset. Do not expect to find this.";
  }
  void anchors;
  return {
    log10Anchors,
    log10ExpectedMatches: log10Expected,
    verdict,
  };
}

/**
 * Largest pixel count that is still *expected* to be findable within the
 * dataset: colours^pixels ≲ anchors  →  pixels ≈ log10(anchors)/log10(colours).
 */
export function maxFindablePixels(colours: number, datasetSize = 2_000_000): number {
  const log10Anchors = Math.log10(datasetSize);
  if (colours <= 1) return Number.POSITIVE_INFINITY;
  return Math.floor(log10Anchors / Math.log10(colours));
}

export interface MagnitudeAnchor {
  label: string;
  log10: number;
  approximate: boolean;
}

/** Real-world reference quantities for the comparison ribbon. */
export const MAGNITUDE_ANCHORS: MagnitudeAnchor[] = [
  { label: "Seconds in a day", log10: Math.log10(86_400), approximate: false },
  { label: "Grains of sand on Earth", log10: 19, approximate: true },
  { label: "Stars in the observable universe", log10: 22, approximate: true },
  { label: "Atoms in a grain of sand", log10: 19, approximate: true },
  { label: "Atoms in the observable universe", log10: 80, approximate: true },
  { label: "A Googol", log10: 100, approximate: false },
];

export function digitsCount(log10: number): number {
  return Math.floor(log10) + 1;
}
