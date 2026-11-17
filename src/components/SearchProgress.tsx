import { formatInt } from "../engine/format";

/**
 * Progress for a running search. The worker reports dataset digits prepared
 * (chunk download + SHA-256 + WASM residency); once that reaches 100% the scan
 * itself runs, so the bar holds at 100% until results arrive.
 */
export default function SearchProgress({
  progress,
}: {
  progress: { checked: number; total: number } | null;
}) {
  if (!progress || progress.total <= 0) return null;
  const pct = Math.min(100, Math.round((progress.checked / progress.total) * 100));
  return (
    <div className="mt-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-2)" }}>
        <span>{pct < 100 ? "Preparing dataset…" : "Scanning dataset…"}</span>
        <span className="mono">
          {formatInt(progress.checked)} / {formatInt(progress.total)}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--border)" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}
