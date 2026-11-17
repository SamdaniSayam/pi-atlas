import { AlertCircle } from "lucide-react";

export default function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid h-full min-h-[240px] place-items-center p-8 text-center">
      <div className="max-w-sm">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>π</span>
        </div>
        <h3 className="m-0 text-lg">{title}</h3>
        {children && <div className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="grid h-full min-h-[240px] place-items-center p-8 text-center">
      <div className="max-w-md">
        <AlertCircle aria-hidden="true" size={36} style={{ color: "var(--error)" }} className="mx-auto mb-3" />
        <h3 className="m-0 text-lg">Something went wrong</h3>
        <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>{message}</p>
        {onRetry && (
          <button type="button" className="btn mt-4" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function LoadingState({ label, progress }: { label: string; progress?: number }) {
  return (
    <div className="grid h-full min-h-[240px] place-items-center p-8 text-center" role="status" aria-label={label}>
      <div>
        <div
          aria-hidden="true"
          className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full"
          style={{ border: "3px solid var(--border)", borderTopColor: "var(--accent)" }}
        />
        <p className="m-0 text-sm" style={{ color: "var(--text-2)" }}>{label}</p>
        {progress !== undefined && (
          <div
            className="mx-auto mt-3 h-1.5 w-48 overflow-hidden rounded-full"
            style={{ background: "var(--border)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.round(progress * 100)}%`, background: "var(--accent)" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
