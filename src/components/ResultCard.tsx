/** Result card showing found/not-found status and key statistics. */
import { Check, X } from "lucide-react";
import type { ReactNode } from "react";
import { formatInt, formatMagnitude, formatOneIn, type DifficultyInfo } from "../engine/format";

export function StatusBadge({ found }: { found: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold"
      style={{
        background: found ? "color-mix(in srgb, var(--success) 14%, transparent)" : "color-mix(in srgb, var(--error) 12%, transparent)",
        color: found ? "var(--success)" : "var(--error)",
        border: `1px solid ${found ? "color-mix(in srgb, var(--success) 40%, transparent)" : "color-mix(in srgb, var(--error) 40%, transparent)"}`,
      }}
    >
      {found ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
      {found ? "FOUND" : "NOT FOUND"}
    </span>
  );
}

export function StatRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm" style={{ color: "var(--text-2)" }}>
        {label}
        {hint && <span className="sr-only"> ({hint})</span>}
      </span>
      <span className="stat-num text-right text-sm font-medium">{value}</span>
    </div>
  );
}

export default function ResultCard({
  found,
  title,
  difficulty,
  children,
}: {
  found: boolean;
  title: string;
  difficulty?: DifficultyInfo;
  children: ReactNode;
}) {
  return (
    <section className="panel p-4" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="m-0 text-base">{title}</h3>
        <StatusBadge found={found} />
      </div>
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        {children}
      </div>
      {difficulty && (
        <p className="mb-0 mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
          <strong style={{ color: "var(--text)" }}>{difficulty.label}.</strong> {difficulty.description}
        </p>
      )}
    </section>
  );
}

export { formatInt, formatMagnitude, formatOneIn };
