/** Settings store (§34) with versioned localStorage persistence. */
import { create } from "zustand";
import { STORAGE_KEY_SETTINGS, DEFAULT_PIXEL_WIDTH } from "../constants";

export type ThemeSetting = "system" | "dark" | "light";

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

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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
    const next = { ...get(), ...patch };
    const { update: _u, reset: _r, ...settings } = next;
    persist(settings);
    set(patch as Partial<SettingsState>);
  },
  reset: () => {
    persist(DEFAULT_SETTINGS);
    set({ ...DEFAULT_SETTINGS });
  },
}));

/** Apply theme + reduced motion to the document root. */
export function applySettingsToDocument(s: Settings): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.reducedMotion = s.reducedMotion ? "true" : "false";
  if (s.reducedMotion) {
    root.dataset.forced = "1";
  } else {
    delete root.dataset.forced;
  }
}
