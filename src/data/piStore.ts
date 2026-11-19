/**
 * π dataset store (FR-01, D17).
 *
 * The browser never holds the digit text: `load()` fetches only the manifest
 * from the search service (format id, total size, first digits, checkpoints,
 * whole-file SHA-256). Integrity is the service's job — it refuses to start on
 * any checksum mismatch. Digit windows are fetched on demand via `digitWindow`.
 */
import { create } from "zustand";
import { fetchManifest, type ManifestInfo } from "./piApi";

export type DataStatus = "idle" | "loading" | "ready" | "error";

/** The branded dataset size, used only until the manifest answers. */
export const DEFAULT_DATASET_SIZE = 1_000_000_000;

interface PiState {
  status: DataStatus;
  progress: number;
  error: string | null;
  manifest: ManifestInfo | null;
  load: () => Promise<void>;
  retry: () => Promise<void>;
}

export const usePiStore = create<PiState>((set, get) => ({
  status: "idle",
  progress: 0,
  error: null,
  manifest: null,
  load: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading", progress: 0.2, error: null });
    try {
      const manifest = await fetchManifest();
      set({ manifest, progress: 1, status: "ready" });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error while loading the local dataset.";
      set({ status: "error", error: message });
    }
  },
  retry: async () => {
    set({ status: "idle" });
    await get().load();
  },
}));

/** Total digits of the served dataset (fallback only pre-load). */
export function useDatasetSize(): number {
  return usePiStore((s) => s.manifest?.totalDigits ?? DEFAULT_DATASET_SIZE);
}
