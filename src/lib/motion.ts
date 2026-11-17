/** Shared motion presets that respect reduced-motion preferences. */
import type { Transition, Variants } from "framer-motion";

export function useMotionPrefs(): { transition: Transition; variants: Variants } {
  return {
    transition: { duration: 0.22, ease: "easeOut" },
    variants: {
      hidden: { opacity: 0, y: 6 },
      visible: { opacity: 1, y: 0 },
    },
  };
}
