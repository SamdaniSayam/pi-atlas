import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  /** Full-screen sheet below md, centred dialog above. */
  sheet?: boolean;
  maxWidthPx?: number;
}

/** Modal dialog with focus management and Escape handling. */
function DialogShell({ children }: { children: React.ReactNode }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end md:place-items-center p-0 md:p-4"
      role="presentation"
    >
      {children}
    </div>,
    document.body,
  );
}

export default function Dialog({ open, onClose, title, children, wide, sheet, maxWidthPx }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Parents pass inline close callbacks; keep the latest one without making the
  // focus-management effect re-run (and steal focus) on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(
      el?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    );
    const initial = focusables()[0] ?? el;
    initial?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        el?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el?.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !el?.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <DialogShell>
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.55)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          sheet
            ? "panel relative z-10 flex h-full w-full flex-col overflow-hidden !rounded-none md:h-auto md:max-h-[90vh] md:!rounded-[16px]"
            : "panel relative z-10 flex w-full max-h-[85vh] flex-col overflow-hidden md:mx-auto md:max-w-[440px] md:max-h-[80vh]"
        }
        style={{
          boxShadow: "var(--shadow-2)",
          maxWidth: maxWidthPx ?? (wide ? 720 : undefined),
          paddingBottom: "var(--safe-bottom)",
        }}
      >
        <div className="flex items-center justify-between border-b px-5 py-3 shrink-0" style={{ borderColor: "var(--border)" }}>
          <h2 className="m-0 text-lg">{title}</h2>
          <button type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
      </div>
    </DialogShell>
  );
}
