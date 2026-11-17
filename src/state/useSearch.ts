/**
 * Search state store (M1, async since D17).
 *
 * Each run submits the search as a job to the π search service, polls with
 * real server-side progress, and converts the raw answer (counts + capped
 * positions) into the result shapes the UI already renders — the odds maths
 * stays client-side. Starting a new search cancels the previous job.
 */
import { create } from "zustand";
import {
  submitExact,
  submitLetters,
  submitDates,
  pollJob,
  cancelJob,
  type ExactResult,
  type LettersResult,
  type DatesResult,
} from "../data/piApi";
import { usePiStore, DEFAULT_DATASET_SIZE } from "../data/piStore";
import { difficultyFor, formatInt } from "../engine/format";
import {
  encodeWord,
  wordProbability,
  type LetterSearchResult,
  type LetterFrameResult,
} from "../engine/lettersSearch";
import { DATE_FORMATS, type DateSearchResult, type DateSearchRow } from "../engine/dates";
import { type DigitsSearchResult } from "../engine/digitsSearch";
import type { useHistory, SearchMode } from "./useHistory";
import { announce } from "../lib/announce";

interface SearchProgress {
  checked: number;
  total: number;
}

export interface SearchState {
  digitsResult: DigitsSearchResult | null;
  lettersResult: LetterSearchResult | null;
  datesResult: DateSearchResult | null;
  searching: boolean;
  progress: SearchProgress | null;
  /** Human-readable failure of the in-flight search (network, timeout…). */
  searchError: string | null;
  selectedOccurrence: number;
  runDigits: (query: string) => Promise<DigitsSearchResult | null>;
  runLetters: (word: string) => Promise<LetterSearchResult | null>;
  runDates: (y: number, m: number, d: number) => Promise<DateSearchResult | null>;
  /** Cancel the currently-running search, if any. */
  cancelSearch: () => Promise<void>;
  setSelectedOccurrence: (n: number) => void;
  clear: () => void;
}

function datasetSize(): number {
  return usePiStore.getState().manifest?.totalDigits ?? DEFAULT_DATASET_SIZE;
}

/** Exact-search odds, client-side (D17). Identical maths to the TS engine. */
function toDigitsResult(query: string, api: ExactResult, size: number): DigitsSearchResult {
  const L = query.length;
  const expectedCount = (size - L + 1) / 10 ** L;
  const found = api.total > 0;
  return {
    query,
    length: L,
    found,
    positions: api.positions,
    total: api.total,
    expectedCount,
    luckRatio: found && expectedCount > 0 ? api.total / expectedCount : 0,
    expectedFirstDepth: 10 ** L,
    longestExistingPrefix: api.longest_existing_prefix,
    longestExistingPrefixPosition: api.longest_existing_prefix_position,
    difficulty: difficultyFor(expectedCount),
  };
}

function toLettersResult(word: string, api: LettersResult, size: number): LetterSearchResult {
  const values = [...word].map((ch) => ch.charCodeAt(0) - 65);
  const p = wordProbability(values);
  const k = values.length;
  const pairsA = Math.floor(size / 2);
  const pairsB = Math.floor((size - 1) / 2);
  const validStarts = Math.max(0, pairsA - k + 1) + Math.max(0, pairsB - k + 1);
  const expectedCount = validStarts * p;
  const frames = api.frames.map((f) => {
    const start = f.frame === "A" ? 0 : 1;
    const fr: LetterFrameResult = {
      frame: f.frame,
      capped: f.capped,
      total: f.total,
      matches: f.positions.map((position) => ({
        frame: f.frame,
        position,
        letterIndex: Math.floor((position - 1 - start) / 2),
      })),
    };
    return fr;
  }) as [LetterFrameResult, LetterFrameResult];
  return {
    word: api.word,
    pairValues: values,
    pairs: encodeWord(api.word),
    frames,
    total: api.total,
    wordProbability: p,
    expectedCount,
    expectedFirstDepth: p > 0 ? 1 / p : Number.POSITIVE_INFINITY,
    luckRatio: expectedCount > 0 ? api.total / expectedCount : 0,
    difficulty: difficultyFor(expectedCount),
  };
}

function toDatesResult(api: DatesResult, size: number): DateSearchResult {
  const rows: DateSearchRow[] = api.rows.map((row) => {
    const spec =
      DATE_FORMATS.find((s) => s.id === row.id) ??
      { id: row.id, label: row.label, encode: () => row.sequence };
    return {
      spec,
      sequence: row.sequence,
      result: toDigitsResult(row.sequence, row.result, size),
    };
  });
  return { rows };
}

/** Cancel whatever job the store is currently waiting on. */
let activeJobId: number | null = null;
/** Monotonic token: only the newest run may write state. */
let runToken = 0;

async function cancelActiveJob(): Promise<void> {
  const id = activeJobId;
  activeJobId = null;
  if (id !== null) {
    try {
      await cancelJob(id);
    } catch {
      // best effort: the job may already be done
    }
  }
}

export const useSearch = create<SearchState>((set) => {
  const progressCb = (token: number) => (checked: number, total: number) => {
    if (token === runToken) set({ progress: { checked, total } });
  };

  /** Submit + poll + convert. Returns the converted result or null. */
  async function runJob<T extends ExactResult | LettersResult | DatesResult, R>(
    kindLabel: string,
    submit: () => Promise<
      { cached: true; result: T } | { cached: false; jobId: number }
    >,
    convert: (result: T) => R,
  ): Promise<R | null> {
    const token = ++runToken;
    await cancelActiveJob();
    set({ searching: true, progress: null, searchError: null });
    try {
      const submission = await submit();
      if (submission.cached) {
        const converted = convert(submission.result);
        if (token === runToken) {
          set({ searching: false, progress: null, selectedOccurrence: 1 });
        }
        return converted;
      }
      const jobId = submission.jobId;
      activeJobId = jobId;
      const settled = await pollJob<T>(jobId, { onProgress: progressCb(token) });
      if (token !== runToken) return null; // superseded
      activeJobId = null;
      if (settled.status === "cancelled") {
        set({ searching: false, progress: null });
        return null;
      }
      if (settled.status === "timeout") {
        set({ searching: false, progress: null, searchError: "The search hit its time limit and stopped early — results would be incomplete. Narrow the query or try again." });
        return null;
      }
      if (settled.status === "failed" || !settled.result) {
        set({ searching: false, progress: null, searchError: settled.error ?? `The ${kindLabel} search failed.` });
        return null;
      }
      const converted = convert(settled.result);
      set({ searching: false, progress: null, selectedOccurrence: 1 });
      return converted;
    } catch (err) {
      if (token !== runToken) return null;
      activeJobId = null;
      const message = err instanceof Error ? err.message : "Search request failed.";
      set({ searching: false, progress: null, searchError: message });
      return null;
    }
  }

  return {
    digitsResult: null,
    lettersResult: null,
    datesResult: null,
    searching: false,
    progress: null,
    searchError: null,
    selectedOccurrence: 1,

    runDigits: async (query) => {
      const cleaned = query.replace(/[^0-9]/g, "").slice(0, 20);
      if (!cleaned) {
        set({ digitsResult: null, selectedOccurrence: 1 });
        return null;
      }
      const size = datasetSize();
      const result = await runJob(
        "digits",
        () => submitExact(cleaned),
        (api) => toDigitsResult(cleaned, api, size),
      );
      if (!result) return null;
      set({ digitsResult: result, lettersResult: null, datesResult: null });
      announce(
        result.found
          ? `Found ${cleaned} at position ${formatInt(result.positions[0])}. ${formatInt(result.total)} occurrences.`
          : `${cleaned} was not found in the dataset.`,
      );
      return result;
    },

    runLetters: async (word) => {
      const size = datasetSize();
      const result = await runJob(
        "letters",
        () => submitLetters(word),
        (api) => toLettersResult(api.word, api, size),
      );
      if (!result) return null;
      set({ lettersResult: result, digitsResult: null, datesResult: null });
      announce(
        result.total > 0
          ? `Found ${result.word} ${formatInt(result.total)} times across both frames.`
          : `${result.word} was not found in either frame.`,
      );
      return result;
    },

    runDates: async (y, m, d) => {
      const size = datasetSize();
      const result = await runJob(
        "dates",
        () => submitDates(y, m, d),
        (api) => toDatesResult(api, size),
      );
      if (!result) return null;
      set({ datesResult: result, digitsResult: null, lettersResult: null });
      const found = result.rows.filter((r) => r.result.found);
      announce(
        found.length > 0
          ? `${found.length} of ${result.rows.length} date formats found.`
          : "No date format was found in the dataset.",
      );
      return result;
    },

    cancelSearch: async () => {
      await cancelActiveJob();
      set({ searching: false, progress: null });
    },

    setSelectedOccurrence: (n) => set({ selectedOccurrence: Math.max(1, n) }),
    clear: () =>
      set({ digitsResult: null, lettersResult: null, datesResult: null, selectedOccurrence: 1, searchError: null }),
  };
});

/** Record a completed search in session history. */
export function recordHistory(
  history: ReturnType<typeof useHistory.getState>,
  mode: SearchMode,
  query: string,
  found: boolean,
  position: number | null,
): void {
  history.push({ mode, query, status: found ? "found" : "not-found", position });
}

export { contextAt } from "../engine/digitsSearch";
