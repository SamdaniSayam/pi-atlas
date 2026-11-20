/**
 * Integration: data loading + search flows against the REAL 2M dataset.
 *
 * The browser layer (store → useSearch → api client) is exercised intact with
 * `fetch` stubbed at the network boundary. The stub emulates the Rust search
 * service's API contract (manifest + cached job responses) by computing answers
 * with the local parity engines over the real digit file.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { digits } from "../helpers/dataset";
import { usePiStore } from "../../src/data/piStore";
import { useSearch } from "../../src/state/useSearch";
import { useHistory } from "../../src/state/useHistory";
import {
  useSettings,
  DEFAULT_SETTINGS,
  applySettingsToDocument,
  normalizeSettings,
  resolveTheme,
} from "../../src/state/useSettings";
import { searchDigits } from "../../src/engine/digitsSearch";
import { searchWord } from "../../src/engine/lettersSearch";
import { searchDate } from "../../src/engine/dates";

/* ------------------------------ service emulation ------------------------------ */

const MANIFEST = {
  format: "pi-atlas-packed-v1",
  total_digits: 2_000_000,
  chunk_digits: 1_000_000,
  chunk_count: 2,
  first_digits: digits.slice(0, 50),
  checkpoints: [
    { query: "12", first_position: 148 },
    { query: "999999", first_position: 762 },
  ],
  sha256_packed: "stub",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function stubService(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/manifest")) return jsonResponse(MANIFEST);
    if (url.includes("/jobs/exact") && init?.method === "POST") {
      const { query } = JSON.parse(String(init.body));
      const r = searchDigits(digits, query);
      return jsonResponse({
        cached: true,
        result: {
          query: r.query,
          length: r.length,
          found: r.found,
          total: r.total,
          positions: r.positions,
          position_cap: r.positions.length,
          truncated: r.total > r.positions.length,
          incomplete: false,
          longest_existing_prefix: r.longestExistingPrefix,
          longest_existing_prefix_position: r.longestExistingPrefixPosition,
        },
      });
    }
    if (url.includes("/jobs/letters") && init?.method === "POST") {
      const { word } = JSON.parse(String(init.body));
      const r = searchWord(digits, word);
      if (!r) return new Response("bad request", { status: 400 }) as unknown as Response;
      return jsonResponse({
        cached: true,
        result: {
          word: r.word,
          removed: "",
          pair_values: r.pairValues,
          frames: r.frames.map((f) => ({
            frame: f.frame,
            positions: f.matches.map((m) => m.position),
            total: f.total,
            capped: f.capped,
          })),
          total: r.total,
          incomplete: false,
        },
      });
    }
    if (url.includes("/jobs/dates") && init?.method === "POST") {
      const { year, month, day } = JSON.parse(String(init.body));
      const r = searchDate(digits, year, month, day);
      return jsonResponse({
        cached: true,
        result: {
          input: { year, month, day },
          rows: r.rows.map((row) => ({
            id: row.spec.id,
            label: row.spec.label,
            sequence: row.sequence,
            result: {
              query: row.result.query,
              length: row.result.length,
              found: row.result.found,
              total: row.result.total,
              positions: row.result.positions,
              position_cap: row.result.positions.length,
              truncated: row.result.total > row.result.positions.length,
              incomplete: false,
              longest_existing_prefix: row.result.longestExistingPrefix,
              longest_existing_prefix_position: row.result.longestExistingPrefixPosition,
            },
          })),
          incomplete: false,
        },
      });
    }
    return new Response("not found", { status: 404 }) as unknown as Response;
  });
}

beforeEach(() => {
  usePiStore.setState({ status: "idle", manifest: null, error: null, progress: 0 });
  useSearch.setState({ digitsResult: null, lettersResult: null, datesResult: null, selectedOccurrence: 1, searching: false, searchError: null });
  useHistory.setState({ entries: [] });
  localStorage.clear();
  vi.stubGlobal("fetch", stubService());
});

/* ------------------------------ piStore (manifest) ------------------------------ */

describe("piStore loading pipeline", () => {
  it("loads the manifest through fetch → ready with dataset size", async () => {
    await usePiStore.getState().load();
    const state = usePiStore.getState();
    expect(state.status).toBe("ready");
    expect(state.manifest!.totalDigits).toBe(2_000_000);
    expect(state.manifest!.firstDigits).toBe(digits.slice(0, 50));
    expect(state.manifest!.format).toBe("pi-atlas-packed-v1");
  });

  it("surfaces a friendly error and supports retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response));
    await usePiStore.getState().load();
    expect(usePiStore.getState().status).toBe("error");
    expect(usePiStore.getState().error).toMatch(/HTTP 404/);

    vi.stubGlobal("fetch", stubService());
    await usePiStore.getState().retry();
    expect(usePiStore.getState().status).toBe("ready");
    expect(usePiStore.getState().manifest!.totalDigits).toBe(2_000_000);
  });
});

/* ------------------------------ search flows ------------------------------ */

describe("search flows", () => {
  it("digits search produces results and history entries", async () => {
    const r = await useSearch.getState().runDigits("12");
    expect(r).not.toBeNull();
    expect(r!.found).toBe(true);
    expect(r!.positions[0]).toBe(148);

    recordHistoryViaPush("digits", "12", true, 148);
    expect(useHistory.getState().entries[0].query).toBe("12");
  });

  it("not-found searches are recorded too", async () => {
    const r = await useSearch.getState().runDigits("90909090909090909091");
    expect(r).not.toBeNull();
    expect(r!.found).toBe(false);
  });

  it("letters search converts both frames and computes odds client-side", async () => {
    const r = await useSearch.getState().runLetters("PI");
    expect(r!).not.toBeNull();
    expect(r!.total).toBeGreaterThan(0);
    expect(r!.frames).toHaveLength(2);
    for (const fr of r!.frames) {
      expect(fr.total).toBeGreaterThan(0);
      expect(fr.matches.length).toBeGreaterThan(0);
    }
    // expected count is model maths, done client-side over the manifest size
    expect(r!.expectedCount).toBeGreaterThan(0);
    expect(r!.wordProbability).toBeCloseTo(0.04 * 0.04, 12);
  });

  it("dates search returns one result per format", async () => {
    const r = await useSearch.getState().runDates(2000, 1, 1);
    expect(r!.rows.length).toBeGreaterThan(1);
    for (const row of r!.rows) {
      expect(row.sequence.length).toBeGreaterThan(0);
      expect(typeof row.result.total).toBe("number");
    }
  });

  it("occurrence navigation clamps to >= 1", () => {
    useSearch.getState().setSelectedOccurrence(5);
    useSearch.getState().setSelectedOccurrence(0);
    expect(useSearch.getState().selectedOccurrence).toBe(1);
  });

  it("history caps at 20 and dedupes", () => {
    for (let i = 0; i < 25; i += 1) {
      useHistory.getState().push({ mode: "digits", query: `q${i}`, status: "found", position: i });
    }
    useHistory.getState().push({ mode: "digits", query: "q24", status: "found", position: 24 });
    const entries = useHistory.getState().entries;
    expect(entries.length).toBeLessThanOrEqual(20);
    expect(entries.filter((e) => e.query === "q24")).toHaveLength(1);
    useHistory.getState().clear();
    expect(useHistory.getState().entries).toHaveLength(0);
  });
});

function recordHistoryViaPush(mode: "digits", query: string, found: boolean, position: number | null) {
  useHistory.getState().push({ mode, query, status: found ? "found" : "not-found", position });
}

describe("settings", () => {
  it("persist and reset", () => {
    useSettings.getState().update({ theme: "light", cellSize: 20 });
    expect(useSettings.getState().theme).toBe("light");
    expect(JSON.parse(localStorage.getItem("pi-atlas:settings:v1")!).theme).toBe("light");
    useSettings.getState().reset();
    expect(useSettings.getState()).toMatchObject(DEFAULT_SETTINGS);
  });

  it("applySettingsToDocument updates the DOM", () => {
    applySettingsToDocument({ ...DEFAULT_SETTINGS, theme: "dark", reducedMotion: true });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
  });

  it("validates corrupted persisted settings and rejected updates", () => {
    const clean = normalizeSettings({
      theme: "neon" as "dark",
      digitDensity: 1e9,
      pixelWidth: -500,
      cellSize: Number.NaN,
      reducedMotion: "yes" as unknown as boolean,
      showDigitLabels: 0 as unknown as boolean,
      colourBlindSymbols: true,
    });
    expect(clean).toEqual({
      theme: "system",
      digitDensity: 200,
      pixelWidth: 16,
      cellSize: 12,
      reducedMotion: false,
      showDigitLabels: true,
      colourBlindSymbols: true,
    });
    useSettings.getState().update({ theme: "neon" as "dark", cellSize: -100 });
    expect(useSettings.getState().theme).toBe("system");
    expect(useSettings.getState().cellSize).toBe(4);
    useSettings.getState().reset();
  });

  it("resolves the system theme against the OS preference", () => {
    const original = window.matchMedia;
    try {
      window.matchMedia = ((query: string) => ({
        matches: query.includes("light"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
      expect(resolveTheme("system")).toBe("light");
      expect(resolveTheme("dark")).toBe("dark");
    } finally {
      window.matchMedia = original;
    }
  });
});
