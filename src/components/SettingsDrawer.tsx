import { useSettings, DEFAULT_SETTINGS } from "../state/useSettings";
import Dialog from "./Dialog";
import {
  MIN_PIXEL_WIDTH,
  MAX_PIXEL_WIDTH,
  PIXEL_WIDTH_STEP,
} from "../constants";

export default function SettingsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const s = useSettings();
  return (
    <Dialog open={open} onClose={onClose} title="Settings">
      <div className="flex flex-col gap-5">
        <fieldset className="m-0 border-0 p-0">
          <legend className="label mb-2">Theme</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Theme">
            {(["system", "dark", "light"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className="chip"
                role="radio"
                aria-checked={s.theme === t}
                onClick={() => s.update({ theme: t })}
                style={
                  s.theme === t
                    ? { borderColor: "var(--accent)", color: "var(--accent)" }
                    : undefined
                }
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="label mb-1 block">Digit density (digits per row)</span>
          <input
            type="range"
            className="w-full"
            min={40}
            max={200}
            step={20}
            value={s.digitDensity}
            onChange={(e) => s.update({ digitDensity: Number(e.target.value) })}
            aria-valuetext={`${s.digitDensity} digits per row`}
          />
        </label>

        <label className="block">
          <span className="label mb-1 block">Field width ({s.pixelWidth} cells)</span>
          <input
            type="range"
            className="w-full"
            min={MIN_PIXEL_WIDTH}
            max={MAX_PIXEL_WIDTH}
            step={PIXEL_WIDTH_STEP}
            value={s.pixelWidth}
            onChange={(e) => s.update({ pixelWidth: Number(e.target.value) })}
            aria-valuetext={`${s.pixelWidth} cells per row`}
          />
        </label>

        <label className="block">
          <span className="label mb-1 block">Cell size (zoom)</span>
          <input
            type="range"
            className="w-full"
            min={4}
            max={28}
            value={s.cellSize}
            onChange={(e) => s.update({ cellSize: Number(e.target.value) })}
            aria-valuetext={`${s.cellSize} pixels per cell`}
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">Show digit labels in colour field</span>
          <input
            type="checkbox"
            checked={s.showDigitLabels}
            onChange={(e) => s.update({ showDigitLabels: e.target.checked })}
            className="h-5 w-5"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            Colour-blind symbols
            <span className="block text-xs" style={{ color: "var(--text-2)" }}>
              Show digit symbols next to colours
            </span>
          </span>
          <input
            type="checkbox"
            checked={s.colourBlindSymbols}
            onChange={(e) => s.update({ colourBlindSymbols: e.target.checked })}
            className="h-5 w-5"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            Reduced motion
            <span className="block text-xs" style={{ color: "var(--text-2)" }}>
              Minimise animations
            </span>
          </span>
          <input
            type="checkbox"
            checked={s.reducedMotion}
            onChange={(e) => s.update({ reducedMotion: e.target.checked })}
            className="h-5 w-5"
          />
        </label>

        <button
          type="button"
          className="btn"
          onClick={() => s.reset()}
        >
          Reset to defaults
        </button>
        <p className="m-0 text-xs" style={{ color: "var(--text-2)" }}>
          Settings are stored only in your browser (key {`"${"pi-atlas:settings:v1"}"`}). Nothing is sent anywhere.
        </p>
      </div>
    </Dialog>
  );
}

export { DEFAULT_SETTINGS };
