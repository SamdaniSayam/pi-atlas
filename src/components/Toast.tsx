import { useEffect } from "react";
import { create } from "zustand";

interface ToastState {
  message: string | null;
  /** Bumped on every show() so an identical message still restarts the timer. */
  seq: number;
  show: (msg: string) => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  seq: 0,
  show: (msg) => set((s) => ({ message: msg, seq: s.seq + 1 })),
}));

/**
 * Transient toast, driven by useToast.show(). The live region stays mounted so
 * screen readers register it before the first message; only the contents swap.
 */
export default function Toast() {
  const message = useToast((s) => s.message);
  const seq = useToast((s) => s.seq);
  const show = useToast((s) => s.show);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => show(""), 3200);
    return () => window.clearTimeout(t);
  }, [message, seq, show]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 md:bottom-6"
      style={{ display: message ? undefined : "none" }}
    >
      {message && (
        <div className="panel-2 px-4 py-2.5 text-sm" style={{ boxShadow: "var(--shadow-2)" }}>
          {message}
        </div>
      )}
    </div>
  );
}
