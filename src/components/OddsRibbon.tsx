/** Compact odds ribbon: shows one-in-X probability for pattern searches. */
import { formatOneIn } from "../engine/format";

export default function OddsRibbon({
  probability,
  note,
}: {
  probability: number;
  note?: string;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs"
      style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
    >
      <span>
        Chance at a random spot:{" "}
        <strong className="stat-num" style={{ color: "var(--text)" }}>
          {formatOneIn(probability)}
        </strong>
      </span>
      {note && <span>{note}</span>}
    </div>
  );
}
