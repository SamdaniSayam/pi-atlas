/** Session search history (FR-10). Last 20 searches, memory only. */
import { create } from "zustand";
import { MAX_HISTORY_ENTRIES } from "../constants";

export type SearchMode = "digits" | "dates" | "letters" | "colors" | "shapes";

export interface HistoryEntry {
  id: number;
  mode: SearchMode;
  /** Short human-readable query. */
  query: string;
  status: "found" | "not-found";
  /** 1-based first position or null. */
  position: number | null;
  at: number;
}

interface HistoryState {
  entries: HistoryEntry[];
  push: (e: Omit<HistoryEntry, "id" | "at">) => void;
  clear: () => void;
}

let nextId = 1;

export const useHistory = create<HistoryState>((set) => ({
  entries: [],
  push: (e) =>
    set((state) => ({
      entries: [
        { ...e, id: nextId++, at: Date.now() },
        ...state.entries.filter(
          (x) => !(x.mode === e.mode && x.query === e.query),
        ),
      ].slice(0, MAX_HISTORY_ENTRIES),
    })),
  clear: () => set({ entries: [] }),
}));
