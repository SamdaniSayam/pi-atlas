import { useEffect } from "react";
import { create } from "zustand";

interface ToastState {
  message: string | null;
  show: (msg: string) => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (msg) => set({ message: msg }),
}));

/** Transient toast, driven by useToast.show(). */
export default function Toast() {
  const message = useToast((s) => s.message);
  const show = useToast((s) => s.show);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => show(""), 3200);
    return () => window.clearTimeout(t);
  }, [message, show]);

  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))] left-1/2 z-50 -translate-x-1/2 md:bottom-6"
    >
      <div
        className="panel-2 px-4 py-2.5 text-sm"
        style={{ boxShadow: "var(--shadow-2)" }}
      >
        {message}
      </div>
    </div>
  );
}
