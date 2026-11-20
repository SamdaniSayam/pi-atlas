/**
 * 2-D pattern matching over the digit stream (FR-05, FR-06).
 *
 * The digit stream is folded into rows of `cols` cells.
 *   Colour mode: digit → cell value 0–9 (base 10).
 *   Shape mode:  digit 0–4 → 0 (black), 5–9 → 1 (white) (base 2).
 *
 * Wildcards are -1. A pattern row must never match across a row boundary:
 * row r of the pattern anchors at (row, col) with col + patternCols <= cols.
 */

export interface PatternCell {
  /** Cell value or -1 for wildcard. */
  value: number;
}

export interface PatternSpec {
  rows: number;
  cols: number;
  /** rows*cols values, -1 = wildcard. */
  cells: number[];
  /** true = colour mode (base 10), false = shape mode (base 2). */
  colourMode: boolean;
}

export interface PatternSearchOptions {
  /** Fold width of the field. */
  fieldCols: number;
  /** Dataset length in digits. */
  datasetSize: number;
  /** Max stored match positions (counting always continues). */
  matchCap: number;
  /** Called after each chunk: (checked, total). */
  onProgress?: (checked: number, total: number) => void;
  /** Called to poll cancellation between chunks. */
  isCancelled?: () => boolean;
  /** Chunk size in rows. */
  chunkRows?: number;
}

export interface PatternMatch {
  /** 1-based decimal position of the top-left cell of the match. */
  position: number;
  row: number;
  col: number;
}

export interface PatternSearchResult {
  matches: PatternMatch[];
  total: number;
  capped: boolean;
  /** Number of valid anchor positions examined. */
  anchors: number;
  cancelled: boolean;
}

export function digitToCellValue(digit: number, colourMode: boolean): number {
  if (colourMode) return digit;
  return digit < 5 ? 0 : 1;
}

/** Expected number of matches under the uniform model. */
export function expectedPatternMatches(
  spec: PatternSpec,
  fieldCols: number,
  datasetSize: number,
): number {
  const base = spec.colourMode ? 10 : 2;
  let constrained = 0;
  for (const v of spec.cells) if (v !== -1) constrained += 1;
  const rows = Math.floor(datasetSize / fieldCols);
  const anchors = Math.max(0, rows - spec.rows + 1) * Math.max(0, fieldCols - spec.cols + 1);
  return anchors / base ** constrained;
}

export function countConstrained(cells: number[]): number {
  let n = 0;
  for (const v of cells) if (v !== -1) n += 1;
  return n;
}

/**
 * Scan the digit stream for the pattern.
 * `digits` is the raw decimal string; conversion to cell values happens inline.
 */
export function searchPattern(
  digits: string,
  spec: PatternSpec,
  opts: PatternSearchOptions,
): PatternSearchResult {
  const { fieldCols: cols } = opts;
  const chunkRows = Math.max(1, Math.trunc(opts.chunkRows ?? 2048));
  const matchCap = Math.max(0, Math.trunc(opts.matchCap));
  const pRows = Math.trunc(spec.rows);
  const pCols = Math.trunc(spec.cols);
  const base = spec.colourMode ? 10 : 2;

  if (cols <= 0 || pRows <= 0 || pCols <= 0 || pCols > cols) {
    return { matches: [], total: 0, capped: false, anchors: 0, cancelled: false };
  }

  const totalRows = Math.floor(digits.length / cols);
  // The pattern needs pRows complete rows below the anchor. Anchoring on the
  // last partial row would read past the end of the dataset (NaN on the
  // last row, out-of-range char codes beyond it).
  const lastRow = totalRows - pRows;
  const matches: PatternMatch[] = [];
  let total = 0;
  let capped = false;
  let anchors = 0;

  // Precompute per-pattern-row constraint list: (cellIndexInRow, value)
  const rowConstraints: Array<Array<[number, number]>> = [];
  for (let r = 0; r < pRows; r += 1) {
    const list: Array<[number, number]> = [];
    for (let c = 0; c < pCols; c += 1) {
      const v = spec.cells[r * pCols + c];
      if (v !== -1) list.push([c, v]);
    }
    rowConstraints.push(list);
  }

  let cancelled = false;
  let row = 0;
  while (row <= lastRow && !cancelled) {
    const endRow = Math.min(lastRow + 1, row + chunkRows);
    for (; row < endRow; row += 1) {
      const rowStart = row * cols;
      const maxCol = cols - pCols;
      for (let col = 0; col <= maxCol; col += 1) {
        anchors += 1;
        let ok = true;
        for (let pr = 0; pr < pRows && ok; pr += 1) {
          const constraints = rowConstraints[pr];
          if (constraints.length === 0) continue;
          const lineStart = rowStart + (pr) * cols + col;
          for (const [pc, pv] of constraints) {
            const d = digits.charCodeAt(lineStart + pc) - 48;
            const cell = colourBase(d, base);
            if (cell !== pv) {
              ok = false;
              break;
            }
          }
        }
        if (ok) {
          total += 1;
          if (matches.length < matchCap) {
            matches.push({ position: rowStart + col + 1, row, col });
          } else {
            capped = true;
          }
        }
      }
    }
    opts.onProgress?.(anchors, estimatedAnchors(spec, cols, totalRows));
    if (opts.isCancelled?.()) cancelled = true;
  }

  return { matches, total, capped, anchors, cancelled };
}

function colourBase(digit: number, base: number): number {
  if (base === 10) return digit;
  return digit < 5 ? 0 : 1;
}

function estimatedAnchors(spec: PatternSpec, cols: number, totalRows: number): number {
  return Math.max(0, totalRows - spec.rows + 1) * Math.max(0, cols - spec.cols + 1);
}

/** Difficulty label inputs for pattern searches. */
export function patternDifficulty(
  spec: PatternSpec,
  fieldCols: number,
  datasetSize: number,
): number {
  return expectedPatternMatches(spec, fieldCols, datasetSize);
}
