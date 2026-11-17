/** Difficulty / odds ribbon used across explorers. */
import { Gauge } from "lucide-react";
import { formatMagnitude, type DifficultyInfo } from "../engine/format";

export default function DifficultyMeter({
  difficulty,
  expected,
}: {
  difficulty: DifficultyInfo;
  expected: number;
}) {
  const level = difficulty.level;
  const colour =
    level === "very-common"
      ? "var(--success)"
      : level === "likely"
        ? "var(--accent-2)"
        : level === "unlikely"
          ? "var(--warning)"
          : "var(--error)";
  return (
    <div className="panel-2 p-3" aria-label={`Difficulty: ${difficulty.label}`}>
      <div className="mb-2 flex items-center gap-2">
        <Gauge size={16} aria-hidden="true" style={{ color: colour }} />
        <span className="text-sm font-semibold" style={{ color: colour }}>
          {difficulty.label}
        </span>
        <span className="ml-auto text-xs" style={{ color: "var(--text-2)" }}>
          ≈ {formatMagnitude(expected)} expected
        </span>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {(["very-common", "likely", "unlikely", "practically-impossible"] as const).map((l) => (
          <div
            key={l}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: l === level ? colour : "var(--border)" }}
          />
        ))}
      </div>
      <p className="mb-0 mt-2 text-xs" style={{ color: "var(--text-2)" }}>
        {difficulty.description}
      </p>
    </div>
  );
}
