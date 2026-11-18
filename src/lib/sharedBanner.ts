/** Pure helpers for the "shared from a Wish Card" banner. No DOM, no network. */

export type SharedBannerResult =
  | { kind: "digits" | "letters"; found: boolean; query: string; position: number | null }
  | { kind: "pixels" | "shapes"; found: boolean; row: number | null; column: number | null }
  | null;

export interface BannerPart {
  text: string;
  mono?: boolean;
}

/** Only the exact, single value `src=card` marks a card visitor. */
export function parseSrc(searchParams: URLSearchParams): boolean {
  return searchParams.getAll("src").length === 1 && searchParams.get("src") === "card";
}

/** Drop every `src` entry, preserving all other parameters and their order. */
export function stripSrc(searchParams: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (key !== "src") out.append(key, value);
  });
  return out;
}

/** Long queries keep their shape without overflowing the banner. */
export function truncateQuery(q: string): string {
  return q.length <= 20 ? q : `${q.slice(0, 8)}…${q.slice(-8)}`;
}

const GENERIC = "Someone shared a search of π with you. Try your own.";

/** Text pieces so the caller can style only the query/position in mono. */
export function bannerParts(result: SharedBannerResult, datasetSizeWords: string): BannerPart[] {
  if (!result) return [{ text: GENERIC }];
  if (!result.found) {
    if (!("query" in result) || !result.query) return [{ text: GENERIC }];
    const size = /digits$/i.test(datasetSizeWords) ? datasetSizeWords : `${datasetSizeWords} digits`;
    return [
      { text: "Someone searched π for " },
      { text: truncateQuery(result.query), mono: true },
      { text: ` and it wasn’t in the first ${size}. Try your own.` },
    ];
  }
  if (result.kind === "digits" || result.kind === "letters") {
    if (result.position === null) return [{ text: GENERIC }];
    return [
      { text: "Someone found " },
      { text: truncateQuery(result.query), mono: true },
      { text: " in π at position " },
      { text: result.position.toLocaleString("en-US"), mono: true },
      { text: ". Try your own." },
    ];
  }
  if (!("row" in result) || !("column" in result)) return [{ text: GENERIC }];
  if (result.row === null || result.column === null) return [{ text: GENERIC }];
  const thing = result.kind === "pixels" ? "pattern" : "shape";
  return [
    { text: `Someone found a ${thing} in π at row ` },
    { text: result.row.toLocaleString("en-US"), mono: true },
    { text: ", column " },
    { text: result.column.toLocaleString("en-US"), mono: true },
    { text: ". Try your own." },
  ];
}

/** Flat copy used by the unit tests and the polite announcement. */
export function buildBannerText(result: SharedBannerResult, datasetSizeWords: string): string {
  return bannerParts(result, datasetSizeWords).map((part) => part.text).join("");
}
