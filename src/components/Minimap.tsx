/**
 * Minimap (§27): compact strip of the full 2M-digit range showing match
 * density, viewport, selected match; click-to-navigate and drag-to-scrub.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatInt } from "../engine/format";

export default function Minimap({
  datasetSize,
  viewportStart,
  viewportEnd,
  matches,
  selectedPosition,
  onSeek,
}: {
  datasetSize: number;
  viewportStart: number;
  viewportEnd: number;
  matches: number[];
  selectedPosition: number | null;
  onSeek: (position: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const safeSize = Math.max(1, Math.trunc(datasetSize) || 1);

  // Bucket matches into 200 columns for the density strip
  const BUCKETS = 200;
  const density = useMemo(() => {
    const buckets = new Int32Array(BUCKETS);
    for (const m of matches) {
      const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor(((m - 1) / safeSize) * BUCKETS)));
      buckets[idx] += 1;
    }
    const max = Math.max(1, ...buckets);
    return { buckets, max };
  }, [matches, safeSize]);

  const pct = useCallback(
    (pos: number) => Math.min(100, Math.max(0, ((pos - 1) / safeSize) * 100)),
    [safeSize],
  );

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeek(Math.max(1, Math.round(ratio * safeSize)));
    },
    [safeSize, onSeek],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => seekFromEvent(e.clientX);
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, seekFromEvent]);

  const seekBy = (delta: number): void => {
    onSeek(Math.min(safeSize, Math.max(1, Math.round(viewportStart + delta))));
  };

  return (
    <div className="select-none px-1">
      <div className="mb-1 flex justify-between text-[0.7rem]" style={{ color: "var(--text-2)" }}>
        <span>pos 1</span>
        <span aria-hidden="true">minimap · {formatInt(matches.length)} matches plotted</span>
        <span>{formatInt(datasetSize)}</span>
      </div>
      <div
        ref={ref}
        role="slider"
        aria-label="Dataset position"
        aria-valuemin={1}
        aria-valuemax={safeSize}
        aria-valuenow={Math.min(safeSize, Math.max(1, viewportStart))}
        aria-valuetext={`Viewing positions ${formatInt(viewportStart)} to ${formatInt(viewportEnd)}`}
        tabIndex={0}
        className="relative h-9 cursor-pointer overflow-hidden rounded-lg"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        onPointerDown={(e) => {
          setDragging(true);
          seekFromEvent(e.clientX);
        }}
        onKeyDown={(e) => {
          const step = Math.max(1, (viewportEnd - viewportStart) / 2);
          if (e.key === "ArrowRight") {
            e.preventDefault();
            seekBy(step);
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            seekBy(-step);
          }
        }}
      >
        {/* density strip */}
        <div className="absolute inset-0 flex items-end gap-px px-px pb-0.5" aria-hidden="true">
          {Array.from(density.buckets).map((v, i) =>
            v > 0 ? (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.max(8, (v / density.max) * 100)}%`,
                  background: "color-mix(in srgb, var(--accent-2) 60%, transparent)",
                  borderRadius: 1,
                }}
              />
            ) : (
              <div key={i} style={{ flex: 1 }} />
            ),
          )}
        </div>

        {/* viewport window */}
        <div
          className="absolute top-0 h-full"
          aria-hidden="true"
          style={{
            left: `${pct(viewportStart)}%`,
            width: `${Math.max(0.6, pct(viewportEnd) - pct(viewportStart))}%`,
            background: "color-mix(in srgb, var(--text) 10%, transparent)",
            border: "1.5px solid var(--text-2)",
            borderRadius: 4,
          }}
        />

        {/* matches as ticks */}
        {matches.slice(0, 1000).map((m, i) => (
          <div
            key={`${m}-${i}`}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${pct(m)}%`,
              top: 0,
              width: 2,
              height: "30%",
              background: selectedPosition === m ? "var(--accent)" : "var(--accent)",
              opacity: selectedPosition === m ? 1 : 0.5,
              borderRadius: 1,
            }}
          />
        ))}

        {/* selected match pin */}
        {selectedPosition && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${pct(selectedPosition)}%`,
              top: -2,
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "7px solid var(--accent)",
            }}
          />
        )}
      </div>
    </div>
  );
}
