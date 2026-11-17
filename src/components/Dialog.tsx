import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
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

export default function Dialog({ open, onClose, title, children, wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    )?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

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
        className="panel relative z-10 w-full md:max-w-[440px] md:mx-auto flex flex-col max-h-[85vh] md:max-h-[80vh] overflow-hidden"
        style={{ boxShadow: "var(--shadow-2)", maxWidth: wide ? 720 : undefined, paddingBottom: "var(--safe-bottom)" }}
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
