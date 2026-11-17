import { Sun, Moon, Monitor } from "lucide-react";
import { useSettings, type ThemeSetting } from "../state/useSettings";

const ORDER: ThemeSetting[] = ["system", "dark", "light"];
const ICONS = { system: Monitor, dark: Moon, light: Sun } as const;

/** Cycles system → dark → light. */
export default function ThemeToggle() {
  const theme = useSettings((s) => s.theme);
  const update = useSettings((s) => s.update);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = ICONS[theme];
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => update({ theme: next })}
      aria-label={`Theme: ${theme}. Switch to ${next} theme`}
      title={`Theme: ${theme}`}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
