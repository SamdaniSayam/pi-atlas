/** Settings store (§34) with versioned localStorage persistence. */
import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  STORAGE_KEY_SETTINGS,
  DEFAULT_PIXEL_WIDTH,
  MIN_PIXEL_WIDTH,
  MAX_PIXEL_WIDTH,
  PIXEL_WIDTH_STEP,
} from "../constants";

export type ThemeSetting = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export interface Settings {
  theme: ThemeSetting;
  /** Digit density: digits per row in the digit viewer. */
  digitDensity: number;
  /** Fold width for colour/shape fields. */
  pixelWidth: number;
  /** Zoom (px per cell) for colour/shape fields. */
  cellSize: number;
  reducedMotion: boolean;
  showDigitLabels: boolean;
  colourBlindSymbols: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  digitDensity: 100,
  pixelWidth: DEFAULT_PIXEL_WIDTH,
  cellSize: 12,
  reducedMotion: false,
  showDigitLabels: true,
  colourBlindSymbols: false,
};

const THEMES: readonly ThemeSetting[] = ["system", "dark", "light"];

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Validate persisted/patched settings so corrupted storage cannot poison the UI. */
export function normalizeSettings(
  input: Partial<Settings> | null | undefined,
): Settings {
  const raw = input ?? {};
  const pixel = boundedInt(raw.pixelWidth, MIN_PIXEL_WIDTH, MAX_PIXEL_WIDTH, DEFAULT_PIXEL_WIDTH);
  const snapped = Math.round(pixel / PIXEL_WIDTH_STEP) * PIXEL_WIDTH_STEP;
  return {
    theme: THEMES.includes(raw.theme as ThemeSetting)
      ? (raw.theme as ThemeSetting)
      : DEFAULT_SETTINGS.theme,
    digitDensity: boundedInt(raw.digitDensity, 40, 200, DEFAULT_SETTINGS.digitDensity),
    pixelWidth: Math.min(MAX_PIXEL_WIDTH, Math.max(MIN_PIXEL_WIDTH, snapped)),
    cellSize: boundedInt(raw.cellSize, 4, 28, DEFAULT_SETTINGS.cellSize),
    reducedMotion: bool(raw.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
    showDigitLabels: bool(raw.showDigitLabels, DEFAULT_SETTINGS.showDigitLabels),
    colourBlindSymbols: bool(raw.colourBlindSymbols, DEFAULT_SETTINGS.colourBlindSymbols),
  };
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persist(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode etc.) — settings stay in-memory
  }
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    const settings = normalizeSettings({ ...get(), ...patch });
    persist(settings);
    set(settings);
  },
  reset: () => {
    persist(DEFAULT_SETTINGS);
    set({ ...DEFAULT_SETTINGS });
  },
}));

/** Resolve `system` against the OS preference (dark when unavailable). */
export function resolveTheme(theme: ThemeSetting): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * The concrete theme used for canvas colours. Components cannot test
 * `theme === "light"` directly: under `system` the OS decides.
 */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useSettings((s) => s.theme);
  const [system, setSystem] = useState<ResolvedTheme>(() => resolveTheme("system"));

  useEffect(() => {
    if (theme !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const sync = (): void => setSystem(mq.matches ? "light" : "dark");
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, [theme]);

  return theme === "system" ? system : theme;
}

/** Apply theme + reduced motion to the document root. */
export function applySettingsToDocument(
  s: Pick<Settings, "theme" | "reducedMotion">,
): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.reducedMotion = s.reducedMotion ? "true" : "false";
  if (s.reducedMotion) {
    root.dataset.forced = "1";
  } else {
    delete root.dataset.forced;
  }
}
