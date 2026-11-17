/** Virtualized occurrence list with previous/next navigation. */
import { useEffect, useRef, useState } from "react";
import { formatInt } from "../engine/format";

const PAGE = 50;

export default function OccurrenceList({
  positions,
  selected,
  onSelect,
  capped,
  total,
}: {
  positions: number[];
  selected: number;
  onSelect: (occurrenceIndex: number) => void;
  capped: boolean;
  total: number;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [visible, setVisible] = useState(PAGE);

  useEffect(() => {
    // Reset the window when a new result set arrives.
    setVisible(PAGE);
  }, [positions]);

  useEffect(() => {
    // Make sure the selected occurrence is inside the visible window.
    setVisible((v) => Math.max(v, selected));
  }, [selected]);

  useEffect(() => {
    const el = listRef.current?.children[selected - 1] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (total === 0) {
    return (
      <p className="m-0 text-sm" style={{ color: "var(--text-2)" }}>
        No occurrences to list.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="label">
          Occurrences {capped ? `(first ${formatInt(positions.length)} of ${formatInt(total)} shown)` : `(${formatInt(total)})`}
        </span>
        {capped && (
          <span className="text-xs" style={{ color: "var(--warning)" }}>
            list capped
          </span>
        )}
      </div>
      <ul
        ref={listRef}
        className="m-0 max-h-56 list-none overflow-y-auto p-0"
        aria-label="Occurrence positions"
      >
        {positions.slice(0, visible).map((pos, i) => (
          <li key={pos}>
            <button
              type="button"
              onClick={() => onSelect(i + 1)}
              aria-current={selected === i + 1 ? "true" : undefined}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm no-underline"
              style={{
                background: selected === i + 1 ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
                color: selected === i + 1 ? "var(--accent)" : "var(--text)",
                fontFamily: "var(--font-mono)",
              }}
            >
              <span>#{formatInt(i + 1)}</span>
              <span>pos {formatInt(pos)}</span>
            </button>
          </li>
        ))}
      </ul>
      {visible < positions.length && (
        <button
          type="button"
          className="btn mt-2 w-full"
          onClick={() => setVisible((v) => v + PAGE)}
        >
          Show more ({formatInt(positions.length - visible)} remaining)
        </button>
      )}
    </div>
  );
}
