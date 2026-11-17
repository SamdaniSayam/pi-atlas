/**
 * Virtualized digit stream viewer (§27, D17 windowed rendering).
 * Rows of `density` digits; digit text is fetched from the search service in
 * 2 KB buckets and cached (`digitWindow`), so the browser never holds the
 * full dataset. Rows whose buckets are still in flight render placeholder dots.
 */
import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatInt } from "../engine/format";
import { useDigitWindow } from "../data/digitWindow";

interface Highlight {
  start: number; // 1-based position
  length: number;
  primary?: boolean;
}

export default function DigitViewer({
  totalDigits,
  density,
  highlights,
  onPositionClick,
  focusPosition,
}: {
  totalDigits: number;
  density: number;
  highlights: Highlight[];
  onPositionClick?: (position: number) => void;
  focusPosition?: number | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(totalDigits / density);

  const highlightMap = useMemo(() => {
    const map = new Map<number, "match" | "primary">();
    for (const h of highlights) {
      for (let i = 0; i < h.length; i += 1) {
        const pos = h.start + i;
        if (pos >= 1 && pos <= totalDigits) {
          map.set(pos, h.primary ? "primary" : "match");
        }
      }
    }
    return map;
  }, [highlights, totalDigits]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 8,
  });

  // Navigate to a focused position (selected match)
  useEffect(() => {
    if (!focusPosition) return;
    const row = Math.floor((focusPosition - 1) / density);
    virtualizer.scrollToIndex(row, { align: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPosition, density]);

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      style={{ contain: "strict" }}
      tabIndex={0}
      role="region"
      aria-label="Digit stream. Scroll to explore; rows are labelled with starting position."
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "PageDown") {
          e.preventDefault();
          parentRef.current?.scrollBy({ top: e.key === "PageDown" ? 300 : 60 });
        } else if (e.key === "ArrowUp" || e.key === "PageUp") {
          e.preventDefault();
          parentRef.current?.scrollBy({ top: e.key === "PageUp" ? -300 : -60 });
        }
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((vRow) => {
          const rowStart = vRow.index * density + 1;
          const remaining = totalDigits - rowStart + 1;
          return (
            <DigitRow
              key={vRow.key}
              density={density}
              rowStart={rowStart}
              rowLength={Math.min(density, Math.max(0, remaining))}
              translateY={vRow.start}
              size={vRow.size}
              highlightMap={highlightMap}
              onPositionClick={onPositionClick}
            />
          );
        })}
      </div>
    </div>
  );
}

function DigitRow({
  density,
  rowStart,
  rowLength,
  translateY,
  size,
  highlightMap,
  onPositionClick,
}: {
  density: number;
  rowStart: number;
  rowLength: number;
  translateY: number;
  size: number;
  highlightMap: Map<number, "match" | "primary">;
  onPositionClick?: (position: number) => void;
}) {
  const rowDigits = useDigitWindow(rowStart, rowLength);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: size,
        transform: `translateY(${translateY}px)`,
      }}
      className="flex items-center gap-3 px-3"
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onPositionClick?.(rowStart)}
        className="shrink-0 select-none border-0 bg-transparent p-0 text-right text-xs"
        style={{
          color: "var(--text-2)",
          fontFamily: "var(--font-mono)",
          minWidth: 64,
          cursor: onPositionClick ? "pointer" : "default",
        }}
        aria-label={`Row starting at decimal position ${formatInt(rowStart)}`}
      >
        {formatInt(rowStart)}
      </button>
      <div
        aria-hidden="true"
        className="mono select-none text-[15px] leading-none"
        style={{ letterSpacing: "0.14em" }}
      >
        {[...(rowDigits ?? "·".repeat(density))].map((d, i) => {
          const pos = rowStart + i;
          const hl = highlightMap.get(pos);
          return (
            <span
              key={pos}
              style={{
                color:
                  hl === "primary" ? "var(--bg)" : hl === "match" ? "var(--accent)" : rowDigits ? "var(--text)" : "var(--text-2)",
                background: hl === "primary" ? "var(--accent)" : "transparent",
                borderRadius: hl === "primary" ? 3 : 0,
                fontWeight: hl ? 700 : 400,
              }}
            >
              {d}
            </span>
          );
        })}
      </div>
      <span className="sr-only">
        {rowDigits
          ? `Digits at positions ${formatInt(rowStart)} to ${formatInt(rowStart + rowDigits.length - 1)}: ${rowDigits}`
          : `Digits at positions ${formatInt(rowStart)} to ${formatInt(rowStart + rowLength - 1)}: loading…`}
      </span>
    </div>
  );
}

export type { Highlight };
