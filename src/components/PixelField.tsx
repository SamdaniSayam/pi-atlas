/**
 * Canvas pixel field for colour/shape exploration (§27, D17 windowed rendering).
 * The served dataset is far too large to materialize: the canvas is viewport
 * sized and draws only the rows currently visible, with digit text fetched on
 * demand from the search service. The scrollable region is a window of
 * FIELD_WINDOW_ROWS rows centred on the focused match.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { colourFor, PALETTE, SHAPE_INK } from "../engine/palette";
import { formatInt } from "../engine/format";
import { useSettings, useResolvedTheme } from "../state/useSettings";
import { getCachedRange, prefetchRange, subscribeDigitWindows } from "../data/digitWindow";

export interface FieldHighlight {
  position: number; // 1-based
  rows: number;
  cols: number;
  primary?: boolean;
}

/** Rows kept in the scrollable window (≈ 50k × 96 cells ≪ dataset size). */
const FIELD_WINDOW_ROWS = 50_000;

interface PixelFieldProps {
  totalDigits: number;
  fieldCols: number;
  /** true = colour mode (10 colours), false = shape mode (binary). */
  colourMode: boolean;
  /** Pattern height used for outline sizing. */
  patternRows?: number;
  patternCols?: number;
  highlights: FieldHighlight[];
  focusPosition?: number | null;
  onCellHover?: (position: number | null) => void;
}

export default function PixelField({
  totalDigits,
  fieldCols,
  colourMode,
  patternRows = 1,
  patternCols = 1,
  highlights,
  focusPosition,
  onCellHover,
}: PixelFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellSize = useSettings((s) => s.cellSize);
  const theme = useResolvedTheme();
  const [version, force] = useReducer((x: number) => x + 1, 0);

  const totalRows = Math.floor(totalDigits / fieldCols);
  const focusRow = focusPosition ? Math.floor((focusPosition - 1) / fieldCols) : 0;
  const windowRows = Math.max(1, Math.min(FIELD_WINDOW_ROWS, totalRows));
  const windowStartRow = Math.max(
    0,
    Math.min(Math.max(0, totalRows - windowRows), focusRow - Math.floor(windowRows / 2)),
  );
  const fieldH = windowRows * cellSize;
  const fieldW = fieldCols * cellSize;

  // Re-draw whenever a needed bucket of digits arrives.
  useEffect(() => subscribeDigitWindows(force), []);

  // Scroll to the focused highlight within the window.
  useEffect(() => {
    if (!focusPosition) return;
    const el = scrollRef.current;
    if (!el) return;
    const targetY = (focusRow - windowStartRow) * cellSize - el.clientHeight / 2;
    el.scrollTo({ top: Math.max(0, targetY), left: 0, behavior: "smooth" });
  }, [focusPosition, fieldCols, cellSize, focusRow, windowStartRow]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const scroll = scrollRef.current;
    if (!canvas || !scroll) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const light = theme === "light";
    // Cap the backing store at 2× even on high-DPI devices to limit memory.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scrollTop = scroll.scrollTop;
    const scrollH = scroll.clientHeight;
    const scrollW = scroll.clientWidth;

    const firstVisible = windowStartRow + Math.floor(scrollTop / cellSize) - 1;
    const firstRow = Math.max(windowStartRow, firstVisible);
    const lastRow = Math.min(
      windowStartRow + windowRows,
      windowStartRow + Math.ceil((scrollTop + scrollH) / cellSize) + 1,
    );
    const firstCol = Math.max(0, Math.floor(scroll.scrollLeft / cellSize) - 1);
    const lastCol = Math.min(fieldCols, Math.ceil((scroll.scrollLeft + scrollW) / cellSize) + 1);

    // Canvas is viewport-sized; the tall spacer defines the scroll extent.
    canvas.width = Math.max(1, fieldW * dpr);
    canvas.height = Math.max(1, scrollH * dpr);
    canvas.style.width = `${fieldW}px`;
    canvas.style.height = `${scrollH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = light ? "#dfe4df" : "#0d1317";
    ctx.fillRect(0, 0, fieldW, scrollH);

    const needStart = firstRow * fieldCols + 1;
    const needCount = (lastRow - firstRow) * fieldCols;
    prefetchRange(needStart, needCount);
    const digits = getCachedRange(needStart, needCount);

    if (digits) {
      for (let r = firstRow; r < lastRow; r += 1) {
        const rowOffset = (r - firstRow) * fieldCols;
        for (let c = firstCol; c < lastCol; c += 1) {
          const d = Number(digits[rowOffset + c]);
          if (Number.isNaN(d)) continue;
          const x = c * cellSize;
          // The canvas is sticky at the viewport top; its y=0 is the window's
          // first row, not row 0 of the whole dataset. Already-scrolled pixels
          // sit above the sticky canvas.
          const y = (r - windowStartRow) * cellSize - scrollTop;
          ctx.fillStyle = colourMode ? colourFor(d, light) : d < 5 ? SHAPE_INK.black : SHAPE_INK.white;
          ctx.fillRect(x, y, cellSize, cellSize);
        }
      }
    }

    // Outlines (visible ones only)
    for (const h of highlights) {
      const hRow = Math.floor((h.position - 1) / fieldCols);
      const hCol = (h.position - 1) % fieldCols;
      if (hRow < firstRow || hRow >= lastRow) continue;
      drawOutline(
        ctx,
        hCol,
        (hRow - windowStartRow) * cellSize - scrollTop,
        h.cols ?? patternCols,
        h.rows ?? patternRows,
        cellSize,
        h.primary ? (light ? "#087E68" : "#61E6C1") : "rgba(150,160,170,0.55)",
        h.primary ? 2.5 : 1.2,
      );
    }
  }, [
    theme,
    cellSize,
    fieldCols,
    fieldW,
    colourMode,
    highlights,
    patternRows,
    patternCols,
    windowStartRow,
    windowRows,
  ]);

  useEffect(() => {
    draw();
    const scroll = scrollRef.current;
    if (!scroll) return;
    scroll.addEventListener("scroll", draw, { passive: true });
    const ro = new ResizeObserver(draw);
    ro.observe(scroll);
    return () => {
      scroll.removeEventListener("scroll", draw);
      ro.disconnect();
    };
  }, [draw, version]);

  // Hover → position info
  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onCellHover) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / cellSize);
    // The canvas is sticky at the viewport top and paints row r at
    // (r - windowStartRow) * cellSize - scrollTop, so invert that mapping:
    // the row under the cursor includes the already-scrolled distance.
    const y = Math.floor((e.clientY - rect.top + scroll.scrollTop) / cellSize);
    const absRow = windowStartRow + y;
    if (x < 0 || y < 0 || x >= fieldCols || absRow >= windowStartRow + windowRows || absRow >= totalRows) {
      onCellHover(null);
      return;
    }
    onCellHover(absRow * fieldCols + x + 1);
  };

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto"
      style={{ contain: "strict" }}
      tabIndex={0}
      role="region"
      aria-label={
        colourMode
          ? "Colour field of π digits. Each digit is drawn as a colour."
          : "Black and white field of π digits. Digits 0 to 4 are black, 5 to 9 are white."
      }
    >
      <div style={{ height: fieldH, position: "relative" }}>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMove}
          onMouseLeave={() => onCellHover?.(null)}
          style={{
            display: "block",
            imageRendering: "pixelated",
            position: "sticky",
            top: 0,
          }}
        />
      </div>
      <span className="sr-only">
        Showing rows {formatInt(windowStartRow + 1)} to {formatInt(windowStartRow + windowRows)} of{" "}
        {formatInt(totalRows)} rows of {fieldCols} cells. Use the occurrence list to navigate to
        matches; this canvas is a visual companion.
      </span>
    </div>
  );
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  col: number,
  top: number,
  cols: number,
  rows: number,
  cellSize: number,
  colour: string,
  width: number,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.strokeRect(col * cellSize - width / 2, top - width / 2, cols * cellSize + width, rows * cellSize + width);
}

/** Legend swatches for the current mode. */
export function FieldLegend({ colourMode }: { colourMode: boolean }) {
  const light = useResolvedTheme() === "light";
  if (!colourMode) {
    return (
      <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-2)" }}>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ background: SHAPE_INK.black, border: "1px solid var(--border)" }} />
          0–4
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ background: SHAPE_INK.white, border: "1px solid var(--border)" }} />
          5–9
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs" style={{ color: "var(--text-2)" }}>
      {PALETTE.map((p) => (
        <span key={p.digit} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: light ? p.light : p.dark, border: "1px solid var(--border)" }}
          />
          {p.digit}
        </span>
      ))}
    </div>
  );
}

export { formatInt };
