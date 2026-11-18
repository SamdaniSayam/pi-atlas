/**
 * Explore page: digits / dates / letters / colours / shapes (Part A §14).
 * Left: controls · Centre: visualization · Right: results inspector.
 * Bottom: minimap. URL is the source of truth for the active search.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, Link2, Minus, Plus } from "lucide-react";
import { usePiStore, useDatasetSize } from "../data/piStore";
import { useSearch, recordHistory } from "../state/useSearch";
import { useHistory, type SearchMode } from "../state/useHistory";
import { useSettings } from "../state/useSettings";
import { useContextAt } from "../data/digitWindow";
import { formatInt, formatMagnitude, formatOneIn, difficultyFor } from "../engine/format";
import DigitViewer, { type Highlight } from "../components/DigitViewer";
import PixelField, { FieldLegend } from "../components/PixelField";
import Minimap from "../components/Minimap";
import OccurrenceList from "../components/OccurrenceList";
import ResultCard, { StatRow } from "../components/ResultCard";
import OddsRibbon from "../components/OddsRibbon";
import HistoryPanel from "../components/HistoryPanel";
import EmptyState, { ErrorState, LoadingState } from "../components/EmptyState";
import SearchProgress from "../components/SearchProgress";
import { shareOrCopy } from "../lib/share";
import { useToast } from "../components/Toast";
import { buildShareUrl, parsePattern, serializeExplore } from "../lib/url";
import { parseSrc } from "../lib/sharedBanner";
import { datasetWords } from "../wishcard/copy";
import type { SharedBannerResult } from "../lib/sharedBanner";
import PatternPainter, { SHAPE_PRESETS, COLOUR_PRESETS } from "../components/PatternPainter";
import { submitPattern, cancelJob, pollJob, type PatternResult, type PatternMatch } from "../data/piApi";
import { expectedPatternMatches, type PatternSpec } from "../engine/patternSearch";

/** Wish cards load only when a finished result is on screen. */
const WishCardSection = lazy(() =>
  import("../wishcard/WishCardPreview").then((m) => ({ default: m.WishCardSection })),
);
/** Banner code is fetched only for visitors arriving with src=card. */
const SharedBanner = lazy(() => import("../components/SharedBanner"));
function WishCard({ ...props }: ComponentProps<typeof WishCardSection>) {
  return (
    <Suspense fallback={<div className="panel h-16 animate-pulse" aria-label="Wish card loading" />}>
      <WishCardSection {...props} />
    </Suspense>
  );
}

function fromDateHelper(): boolean {
  return new URLSearchParams(window.location.hash.split("?")[1] ?? "").has("d");
}

const MODES: SearchMode[] = ["digits", "dates", "letters", "colors", "shapes"];
const MODE_TITLES: Record<SearchMode, string> = {
  digits: "Number Explorer",
  dates: "Date Explorer",
  letters: "Letter Explorer",
  colors: "Colour Explorer",
  shapes: "Shape Explorer",
};

export default function Explore() {
  const { mode: rawMode } = useParams();
  const mode = (MODES.includes(rawMode as SearchMode) ? rawMode : "digits") as SearchMode;
  const pi = usePiStore();

  useEffect(() => {
    document.title = `${MODE_TITLES[mode]} — π Atlas`;
  }, [mode]);

  if (pi.status === "error") {
    return <ErrorState message={pi.error ?? "Dataset failed to load."} onRetry={() => void pi.retry()} />;
  }
  if (pi.status !== "ready") {
    return <LoadingState label="Contacting the dataset service — verifying and loading the dataset…" progress={pi.progress} />;
  }
  return <ExploreReady mode={mode} />;
}

/* ============================== Ready shell ============================== */

function ExploreReady({ mode }: { mode: SearchMode }) {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const showShared = parseSrc(params);
  const datasetSize = useDatasetSize();
  const digitsResult = useSearch((s) => s.digitsResult);
  const lettersResult = useSearch((s) => s.lettersResult);
  const searching = useSearch((s) => s.searching);
  const searchError = useSearch((s) => s.searchError);
  const pattern = usePatternResult();

  // Banner copy is built only from app-computed results; the URL is a gate.
  let sharedResult: SharedBannerResult = null;
  let sharedReady = false;
  const urlQuery = params.get("q");
  const urlPattern = parsePattern(params.get("p"));
  if (!urlQuery && !urlPattern) {
    sharedReady = true;
  } else if (mode === "digits" && urlQuery) {
    if (searchError) sharedReady = true;
    else if (digitsResult && !searching && digitsResult.query === urlQuery) {
      sharedReady = true;
      sharedResult = {
        kind: "digits",
        found: digitsResult.found,
        query: digitsResult.query,
        position: digitsResult.found ? digitsResult.positions[0] ?? null : null,
      };
    }
  } else if (mode === "letters" && urlQuery) {
    if (searchError) sharedReady = true;
    else if (lettersResult && !searching && lettersResult.word.toUpperCase() === urlQuery.toUpperCase()) {
      sharedReady = true;
      const frame = lettersResult.frames.find((f) => f.total > 0);
      sharedResult = {
        kind: "letters",
        found: lettersResult.total > 0,
        query: lettersResult.word,
        position: frame?.matches[0]?.position ?? null,
      };
    }
  } else if ((mode === "colors" || mode === "shapes") && urlPattern) {
    const spec = pattern.spec;
    const samePattern = spec
      && spec.rows === Number(params.get("pr") ?? 1)
      && spec.cols === Number(params.get("pc") ?? 1)
      && JSON.stringify(spec.cells) === JSON.stringify(urlPattern);
    if (samePattern && !pattern.searching) {
      sharedReady = true;
      const match = pattern.matches[0];
      sharedResult = {
        kind: mode === "colors" ? "pixels" : "shapes",
        found: pattern.total > 0,
        row: match ? match.row + 1 : null,
        column: match ? match.col + 1 : null,
      };
    }
  } else {
    // Dates and other modes have no card copy; the generic message is enough.
    sharedReady = true;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{`${MODE_TITLES[mode]} — π Atlas`}</h1>
      <ModeTabs mode={mode} />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {mode === "digits" && <DigitsPanel params={params} />}
          {mode === "dates" && <DatesPanel />}
          {mode === "letters" && <LettersPanel params={params} />}
          {mode === "colors" && <PatternPanel colourMode params={params} />}
          {mode === "shapes" && <PatternPanel colourMode={false} params={params} />}
        </div>
        <div className="flex min-h-[420px] flex-col gap-3 lg:h-[calc(100vh_-_220px)] lg:min-h-[520px]">
          {showShared && (
            <div className="shared-banner-slot -mx-1 lg:mx-auto lg:max-w-[720px]">
              <Suspense fallback={null}>
                <SharedBanner
                  mode={mode}
                  result={sharedResult}
                  datasetSizeWords={datasetWords(datasetSize)}
                  ready={sharedReady}
                />
              </Suspense>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {mode === "digits" && <DigitStage />}
            {mode === "dates" && <DigitStage />}
            {mode === "letters" && <LettersStage />}
            {(mode === "colors" || mode === "shapes") && <PatternStage colourMode={mode === "colors"} mode={mode} />}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          {mode === "digits" && <DigitsInspector />}
          {mode === "dates" && <DatesInspector />}
          {mode === "letters" && <LettersInspector />}
          {(mode === "colors" || mode === "shapes") && <PatternInspector mode={mode} />}
          <HistoryPanel />
        </div>
      </div>
    </div>
  );
}

function ModeTabs({ mode }: { mode: SearchMode }) {
  const navigate = useNavigate();
  return (
    <nav aria-label="Explorer modes" className="flex flex-wrap gap-1.5">
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          className="chip"
          aria-current={m === mode ? "page" : undefined}
          onClick={() => navigate(`/explore/${m}`)}
          style={m === mode ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
        >
          {MODE_TITLES[m].replace(" Explorer", "")}
        </button>
      ))}
      <span className="ml-auto hidden self-center text-sm md:block" style={{ color: "var(--text-2)" }}>
        {MODE_TITLES[mode]}
      </span>
    </nav>
  );
}

/* ============================== Digits ============================== */

function DigitsPanel({ params }: { params: URLSearchParams }) {
  const run = useSearch((s) => s.runDigits);
  const searching = useSearch((s) => s.searching);
  const progress = useSearch((s) => s.progress);
  const navigate = useNavigate();
  const initial = params.get("q") ?? "";
  const history = useHistory.getState();
  const autoRan = useRef(false);

  // Deep links: restore the search from ?q= (run once on mount)
  useEffect(() => {
    if (autoRan.current || !initial) return;
    autoRan.current = true;
    void run(initial).then((result) => {
      recordHistory(history, "digits", initial, !!result?.found, result?.found ? result.positions[0] : null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const examples = ["12", "999999", "314159", "07041776"];
  return (
    <section className="panel p-4" aria-label="Number search">
      <h2 className="m-0 text-lg">Search digits</h2>
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem("q") as HTMLInputElement);
          const q = input.value.replace(/[^0-9]/g, "").slice(0, 20);
          if (!q) return;
          input.value = q;
          void run(q).then((result) => {
            navigate(`/explore/digits?q=${encodeURIComponent(q)}${serializeExplore({ mode: "digits", query: q })}`, { replace: false });
            if (result) {
              recordHistory(history, "digits", q, result.found, result.found ? result.positions[0] : null);
            }
          });
        }}
      >
        <label htmlFor="digits-q" className="label">Digits (1–20)</label>
        <input
          id="digits-q"
          name="q"
          className="field"
          inputMode="numeric"
          defaultValue={initial}
          placeholder="e.g. 12345"
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      <SearchProgress progress={progress} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {examples.map((q) => (
          <button
            key={q}
            type="button"
            className="chip mono"
            disabled={searching}
            onClick={() => {
              void run(q).then((result) => {
                navigate(`/explore/digits?q=${q}`);
                if (result) {
                  recordHistory(history, "digits", q, result.found, result.found ? result.positions[0] : null);
                }
              });
            }}
          >
            {q}
          </button>
        ))}
      </div>
      <p className="mb-0 mt-3 text-xs" style={{ color: "var(--text-2)" }}>
        Positions are 1-based decimal positions (first digit after the point is position 1). Overlapping matches count.
      </p>
    </section>
  );
}

function DigitStage() {
  const size = useDatasetSize();
  const result = useSearch((s) => s.digitsResult);
  const selected = useSearch((s) => s.selectedOccurrence);
  const setSelected = useSearch((s) => s.setSelectedOccurrence);

  const highlights: Highlight[] = useMemo(() => {
    if (!result?.found) return [];
    return result.positions.map((pos, i) => ({
      start: pos,
      length: result.length,
      primary: i + 1 === selected,
    }));
  }, [result, selected]);

  const focus = result?.found ? result.positions[selected - 1] ?? null : null;
  const viewport = 2000; // digits shown around focus in the viewer
  const viewportStart = focus ? Math.max(1, focus - viewport / 2) : 1;
  const viewportEnd = viewportStart + viewport;

  const matchPositions = result?.found ? result.positions : [];

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-y-1.5 border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <span className="label">
          {focus ? `Focus: position ${formatInt(focus)}` : "Digit stream"}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost !min-h-[44px]"
            disabled={!result?.found || selected <= 1}
            onClick={() => setSelected(selected - 1)}
            aria-label="Previous occurrence"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="text-sm mono" aria-live="polite" data-testid="occurrence-counter">
            {result?.found ? `${formatInt(selected)} / ${formatInt(result.total)}` : "— / —"}
          </span>
          <button
            type="button"
            className="btn btn-ghost !min-h-[44px]"
            disabled={!result?.found || selected >= result.total}
            onClick={() => setSelected(selected + 1)}
            aria-label="Next occurrence"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-[300px] flex-1">
        <DigitViewer
          totalDigits={size}
          density={100}
          highlights={highlights}
          focusPosition={focus}
        />
      </div>
      <div className="border-t px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <Minimap
          datasetSize={size}
          viewportStart={viewportStart}
          viewportEnd={viewportEnd}
          matches={matchPositions}
          selectedPosition={focus}
          onSeek={() => setSelected(1)}
        />
      </div>
    </div>
  );
}

function DigitsInspector() {
  const result = useSearch((s) => s.digitsResult);
  const selected = useSearch((s) => s.selectedOccurrence);
  const searching = useSearch((s) => s.searching);
  const toast = useToast((s) => s.show);

  // Hooks must be unconditional — derive defensively before the empty state.
  const pos =
    result && result.found ? result.positions[selected - 1] ?? result.positions[0] : null;
  const context = useContextAt(pos, result?.length ?? 0);

  if (!result) {
    return (
      <section className="panel p-4" aria-label="Results">
        <EmptyState title="Search the stream">
          Enter digits on the left — try <span className="mono">12</span> for a quick
          first find.
        </EmptyState>
      </section>
    );
  }

  const share = async () => {
    const url = buildShareUrl(`/explore/digits`, { mode: "digits", query: result.query, occurrence: selected });
    const how = await shareOrCopy(url, "π Atlas search");
    toast(how === "copied" ? "Link copied to clipboard" : how === "shared" ? "Shared" : "Could not share the link");
  };

  return (
    <>
      <ResultCard
        found={result.found}
        title={`Query “${result.query}”`}
        difficulty={result.difficulty}
      >
        {result.found && pos ? (
          <>
            <StatRow label={selected === 1 ? "First occurrence" : "Current occurrence"} value={`position ${formatInt(pos)}`} />
            <StatRow label="Occurrences in dataset" value={formatInt(result.total)} />
            <StatRow label="Expected under model" value={`≈ ${formatMagnitude(result.expectedCount)}`} hint="uniform random digits" />
            <StatRow label="Luck ratio" value={`${result.luckRatio.toFixed(2)}×`} hint="actual vs expected" />
            <StatRow label="Expected first find depth" value={`≈ ${formatMagnitude(result.expectedFirstDepth)}`} />
          </>
        ) : (
          <StatRow label="Occurrences in dataset" value="none" />
        )}
      </ResultCard>

      {!result.found && result.longestExistingPrefix > 0 && (
        <section className="panel p-4" aria-label="Closest prefix">
          <h3 className="m-0 text-base">Closest find</h3>
          <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>
            The longest existing prefix is{" "}
            <strong className="mono" style={{ color: "var(--accent)" }}>
              {result.query.slice(0, result.longestExistingPrefix)}
            </strong>{" "}
            ({result.longestExistingPrefix} digits), first at position{" "}
            {formatInt(result.longestExistingPrefixPosition)}.
          </p>
        </section>
      )}

      {result.found && (
        <section className="panel p-4" aria-label="Matches and context">
          <OccurrenceList
            positions={result.positions}
            selected={selected}
            onSelect={(i) => useSearch.getState().setSelectedOccurrence(i)}
            capped={result.positions.length < result.total}
            total={result.total}
          />
          {context && pos && (
            <div className="mt-3">
              <span className="label">Context at position {formatInt(pos)}</span>
              <p className="mono mb-0 mt-1 overflow-hidden text-sm" style={{ wordBreak: "break-all" }} aria-hidden="true">
                <span style={{ color: "var(--text-2)" }}>{context.before}</span>
                <span style={{ background: "var(--accent)", color: "var(--bg)", borderRadius: 3, padding: "0 2px" }}>{context.match}</span>
                <span style={{ color: "var(--text-2)" }}>{context.after}</span>
              </p>
              <span className="sr-only">
                Surrounding digits: {context.before}, match {context.match}, then {context.after}.
              </span>
            </div>
          )}
        </section>
      )}

      <section className="flex gap-2" aria-label="Share">
        <button type="button" className="btn flex-1" onClick={() => void share()}>
          <Link2 size={15} aria-hidden="true" /> Copy link
        </button>
      </section>
      <WishCard
        mode="digits"
        result={result}
        searching={searching}
        occurrence={selected}
        fromDateHelper={fromDateHelper()}
      />
    </>
  );
}

/* ============================== Dates ============================== */

function DatesPanel() {
  const runDates = useSearch((s) => s.runDates);
  const searching = useSearch((s) => s.searching);
  const progress = useSearch((s) => s.progress);
  const navigate = useNavigate();
  const history = useHistory.getState();
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const [date, setDate] = useState(() => {
    const q = params.get("q");
    return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : "2000-01-01";
  });
  const autoRan = useRef(false);

  // Deep links: restore the date search from ?q=YYYY-MM-DD
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [y, m, d] = date.split("-").map(Number);
      void runDates(y, m, d).then((result) => {
        const found = result?.rows.find((r) => r.result.found);
        recordHistory(history, "dates", date, !!found, found?.result.positions[0] ?? null);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <section className="panel p-4" aria-label="Date search">
      <h2 className="m-0 text-lg">Search a date</h2>
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const [y, m, d] = date.split("-").map(Number);
          void runDates(y, m, d).then((result) => {
            navigate(`/explore/dates?q=${date}`);
            const found = result?.rows.find((r) => r.result.found);
            recordHistory(history, "dates", date, !!found, found?.result.positions[0] ?? null);
          });
        }}
      >
        <label htmlFor="date-q" className="label">Pick a date (validated, leap years included)</label>
        <input
          id="date-q"
          type="date"
          className="field"
          value={date}
          min="0001-01-01"
          max="9999-12-31"
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={searching}>
          {searching ? "Searching…" : "Search six formats"}
        </button>
      </form>
      <SearchProgress progress={progress} />
      <p className="mb-0 mt-3 text-xs" style={{ color: "var(--text-2)" }}>
        Every encoding is searched: DDMMYYYY, MMDDYYYY, YYYYMMDD, DDMMYY, MMDDYY, YYMMDD — duplicates removed.
      </p>
    </section>
  );
}

function DatesInspector() {
  const result = useSearch((s) => s.datesResult);
  const navigate = useNavigate();
  if (!result) {
    return (
      <section className="panel p-4" aria-label="Results">
        <EmptyState title="Pick a date">
          Try a birthday or an anniversary — six encodings are searched at once.
        </EmptyState>
      </section>
    );
  }

  const openInDigits = (sequence: string) => {
    void useSearch.getState().runDigits(sequence).then((r) => {
      // d=1 marks date-helper digit searches so the wish card can default to
      // Hide my digits. Old shared links without d keep working unchanged.
      navigate(`/explore/digits?q=${sequence}&d=1`);
      if (r) recordHistory(useHistory.getState(), "digits", sequence, r.found, r.found ? r.positions[0] : null);
    });
  };

  const foundChip = (row: (typeof result.rows)[number]) => (
    <button
      type="button"
      className="chip !min-h-[36px]"
      onClick={() => openInDigits(row.sequence)}
      title={`Open in Number Explorer — ${formatInt(row.result.total)} occurrence(s)`}
    >
      pos {formatInt(row.result.positions[0])} · ×{formatInt(row.result.total)}
    </button>
  );

  return (
    <section className="panel p-4" aria-label="Date results">
      <h3 className="m-0 text-base">Format comparison</h3>
      {/* Compact cards on small screens */}
      <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0 md:hidden">
        {result.rows.map((row) => (
          <li
            key={row.spec.id}
            className="panel-2 flex min-w-0 items-center justify-between gap-3 p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold">{row.spec.id}</div>
              <div className="mono truncate text-xs" style={{ color: "var(--text-2)" }}>
                {row.sequence}
              </div>
            </div>
            <span className="shrink-0">
              {row.result.found ? (
                foundChip(row)
              ) : (
                <span className="text-sm" style={{ color: "var(--text-2)" }}>absent</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {/* Full table on md+ */}
      <div className="mt-3 hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Date encoding search results</caption>
          <thead>
            <tr style={{ color: "var(--text-2)" }}>
              <th scope="col" className="py-1.5 text-left font-medium">Format</th>
              <th scope="col" className="py-1.5 text-left font-medium">Digits</th>
              <th scope="col" className="py-1.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.spec.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="py-1.5 pr-2">{row.spec.id}</td>
                <td className="py-1.5 pr-2 mono">{row.sequence}</td>
                <td className="py-1.5 text-right">
                  {row.result.found ? (
                    foundChip(row)
                  ) : (
                    <span style={{ color: "var(--text-2)" }}>absent</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-0 mt-3 text-xs" style={{ color: "var(--text-2)" }}>
        Select a found encoding to open it in the Number Explorer with full occurrence lists.
      </p>
    </section>
  );
}

/* ============================== Letters ============================== */

function LettersPanel({ params }: { params: URLSearchParams }) {
  const runLetters = useSearch((s) => s.runLetters);
  const searching = useSearch((s) => s.searching);
  const progress = useSearch((s) => s.progress);
  const navigate = useNavigate();
  const history = useHistory.getState();
  const [word, setWord] = useState(params.get("q") ?? "");
  const autoRan = useRef(false);

  // Deep links: restore the word search from ?q=
  useEffect(() => {
    if (autoRan.current || !params.get("q")) return;
    autoRan.current = true;
    void runLetters(params.get("q")!).then((result) => {
      if (result) {
        recordHistory(history, "letters", result.word, result.total > 0, result.frames[0].matches[0]?.position ?? null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const search = (w: string) => {
    void runLetters(w).then((result) => {
      navigate(`/explore/letters?q=${encodeURIComponent(w)}`);
      if (result) recordHistory(history, "letters", result.word, result.total > 0, result.frames[0].matches[0]?.position ?? null);
    });
  };

  return (
    <section className="panel p-4" aria-label="Letter search">
      <h2 className="m-0 text-lg">Search a word</h2>
      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (word) search(word);
        }}
      >
        <label htmlFor="word-q" className="label">Word (1–12 letters, A–Z)</label>
        <input
          id="word-q"
          className="field"
          defaultValue={word}
          placeholder="e.g. PI"
          autoComplete="off"
          maxLength={20}
          onChange={(e) => setWord(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!word || searching}>
          {searching ? "Searching…" : "Search both frames"}
        </button>
      </form>
      <SearchProgress progress={progress} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["PI", "ATLAS", "HELLO", "ZZZ"].map((w) => (
          <button key={w} type="button" className="chip" onClick={() => { setWord(w); search(w); }}>
            {w}
          </button>
        ))}
      </div>
      <p className="mb-0 mt-3 text-xs" style={{ color: "var(--text-2)" }}>
        Encoding: pairs of digits mod 26 → 00=A … 25=Z. Frame A starts at digit 1, Frame B at digit 2.
      </p>
    </section>
  );
}

function LettersStage() {
  const size = useDatasetSize();
  const result = useSearch((s) => s.lettersResult);
  const [frameTab, setFrameTab] = useState<"A" | "B">("A");
  const [selected, setSelected] = useState(1);

  const frame = result?.frames[frameTab === "A" ? 0 : 1];
  const focus = frame?.matches[selected - 1]?.position ?? null;

  if (!result) {
    return (
      <div className="panel h-full">
        <EmptyState title="Encode a word">
          Each letter becomes a two-digit pair (PI → 15 08). Both alignments of the
          stream are searched with real KMP matching.
        </EmptyState>
      </div>
    );
  }

  const highlights: Highlight[] = (frame?.matches ?? []).map((m, i) => ({
    start: m.position,
    length: result.pairValues.length * 2,
    primary: i + 1 === selected,
  }));

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-y-1.5 border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex gap-1.5" role="tablist" aria-label="Letter frame">
          {(["A", "B"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={frameTab === f}
              className="chip"
              onClick={() => { setFrameTab(f); setSelected(1); }}
              style={frameTab === f ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            >
              Frame {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn btn-ghost !min-h-[44px]" disabled={!frame || selected <= 1} onClick={() => setSelected(selected - 1)} aria-label="Previous match">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="mono text-sm">{frame ? `${formatInt(selected)} / ${formatInt(frame.total)}` : "— / —"}</span>
          <button type="button" className="btn btn-ghost !min-h-[44px]" disabled={!frame || selected >= frame.total} onClick={() => setSelected(selected + 1)} aria-label="Next match">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-[300px] flex-1">
        <DigitViewer totalDigits={size} density={100} highlights={highlights} focusPosition={focus} />
      </div>
      <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="label">Encoding of “{result.word}”:</span>
          {result.pairs.map((p, i) => (
            <span key={i} className="panel-2 px-2 py-1 text-xs">
              {p.letter} = <strong className="mono">{p.pair}</strong>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LettersInspector() {
  const result = useSearch((s) => s.lettersResult);
  const searching = useSearch((s) => s.searching);
  if (!result) return null;
  return (
    <>
      <ResultCard found={result.total > 0} title={`Word “${result.word}”`} difficulty={result.difficulty}>
        <StatRow label="Total matches (both frames)" value={formatInt(result.total)} />
        <StatRow label="Word probability" value={formatOneIn(result.wordProbability)} hint="encoding-aware" />
        <StatRow label="Expected first find depth" value={`≈ ${formatMagnitude(result.expectedFirstDepth)}`} />
        <StatRow label="Expected occurrences" value={`≈ ${formatMagnitude(result.expectedCount)}`} />
      </ResultCard>
      {result.frames.map((fr) => (
        <section key={fr.frame} className="panel p-4" aria-label={`Frame ${fr.frame} results`}>
          <h3 className="m-0 text-base">
            Frame {fr.frame} <span className="text-sm" style={{ color: "var(--text-2)" }}>· {formatInt(fr.total)} matches</span>
          </h3>
          {fr.total > 0 ? (
            <ol className="mb-0 mt-2 max-h-40 list-inside list-decimal overflow-y-auto pl-1 text-sm mono">
              {fr.matches.slice(0, 500).map((m, i) => (
                <li key={i} className="py-0.5">
                  pair #{formatInt(m.letterIndex + 1)} · pos {formatInt(m.position)}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mb-0 mt-2 text-sm" style={{ color: "var(--text-2)" }}>
              Not present in this alignment.
            </p>
          )}
        </section>
      ))}
      <section className="panel-2 p-4 text-xs" style={{ color: "var(--text-2)" }} aria-label="Encoding bias note">
        <strong style={{ color: "var(--text)" }}>Why some letters are rarer:</strong> pairs reduce
        mod 26, so A–V are hit by 4 pair-values (p = 0.04) while W–Z are hit by only 3
        (p = 0.03). Expected odds above use the per-letter probabilities of your actual
        word — not an equal-letter assumption.
      </section>
      <WishCard
        mode="letters"
        result={result}
        searching={searching}
        occurrence={1}
        fromDateHelper={fromDateHelper()}
      />
    </>
  );
}

/* ============================== Colour & shape ============================== */

function PatternPanel({ colourMode, params }: { colourMode: boolean; params: URLSearchParams }) {
  const fieldWidth = useSettings((s) => s.pixelWidth);
  const [rows, setRows] = useState(() => Number(params.get("pr")) || (colourMode ? 1 : 2));
  const [cols, setCols] = useState(() => Number(params.get("pc")) || (colourMode ? 2 : 3));
  const [cells, setCells] = useState<number[]>(() => {
    const parsed = params.get("p");
    if (parsed) {
      try {
        const arr = JSON.parse(parsed) as number[];
        if (Array.isArray(arr) && arr.length > 0) return arr;
      } catch { /* ignore */ }
    }
    return colourMode ? [1, 2] : [1, 1, 0, 1, 1, 0, 1, 1, 0];
  });
  const [exact, setExact] = useState(() => params.get("exact") !== "0");
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<{ checked: number; total: number } | null>(null);
  // Per-instance job handle for the cancel button (was module-scope shared state).
  const activePatternJobId = useRef<number | null>(null);
  const navigate = useNavigate();
  const history = useHistory.getState();
  const toast = useToast((s) => s.show);

  const size = useDatasetSize();
  const spec: PatternSpec = { rows, cols, cells, colourMode };
  const minCells = 2;
  const maxCells = colourMode ? 8 : 24;
  const expected = expectedPatternMatches(spec, fieldWidth, size);
  const diff = difficultyFor(expected);

  // keep cells length in sync with grid size
  useEffect(() => {
    const target = rows * cols;
    setCells((prev) => {
      if (prev.length === target) return prev;
      const next = prev.slice(0, target);
      while (next.length < target) next.push(-1);
      return next;
    });
  }, [rows, cols]);

  const setGridSize = (r: number, c: number) => {
    setRows(r);
    setCols(c);
  };

  const startSearch = useCallback(async () => {
    setSearching(true);
    setPatternSearching(true);
    setProgress(null);
    let apiResult: PatternResult;
    try {
      const submission = await submitPattern({
        rows: spec.rows,
        cols: spec.cols,
        cells: spec.cells,
        colour_mode: spec.colourMode,
        field_cols: fieldWidth,
        match_cap: 200_000,
      });
      if (submission.cached) {
        apiResult = submission.result;
      } else {
        activePatternJobId.current = submission.jobId;
        const settled = await pollJob<PatternResult>(submission.jobId, {
          onProgress: (checked, total) => setProgress({ checked, total }),
        });
        if (settled.status === "cancelled") {
          setSearching(false);
          setPatternSearching(false);
          setProgress(null);
          return;
        }
        if (settled.status === "timeout") {
          setSearching(false);
          setPatternSearching(false);
          setProgress(null);
          toast("The pattern search hit its time limit and stopped early — results would be incomplete.");
          return;
        }
        if (settled.status === "failed" || !settled.result) {
          setSearching(false);
          setPatternSearching(false);
          setProgress(null);
          toast(settled.error ?? "The pattern search failed.");
          return;
        }
        apiResult = settled.result;
      }
    } catch (err) {
      setSearching(false);
      setPatternSearching(false);
      setProgress(null);
      toast(err instanceof Error ? err.message : "The pattern search failed.");
      return;
    }
    activePatternJobId.current = null;
    setSearching(false);
    setPatternSearching(false);
    setProgress(null);

    const matches: PatternMatch[] = apiResult.matches;
    patternResultStore.matches = matches;
    patternResultStore.total = apiResult.total;
    patternResultStore.capped = apiResult.capped;
    patternResultStore.selected = apiResult.total > 0 ? 0 : -1;
    patternResultStore.spec = { ...spec };
    patternResultStore.exact = exact;
    patternResultStore.fieldWidth = fieldWidth;
    patternResultStore.bump();

    navigate(
      `/explore/${colourMode ? "colors" : "shapes"}?${new URLSearchParams({
        p: JSON.stringify(spec.cells),
        pr: String(spec.rows),
        pc: String(spec.cols),
        exact: exact ? "1" : "0",
        w: String(fieldWidth),
      })}`,
    );
    recordHistory(
      history,
      colourMode ? "colors" : "shapes",
      `${spec.rows}×${spec.cols} ${colourMode ? "colour" : "shape"} pattern`,
      apiResult.total > 0,
      matches[0]?.position ?? null,
    );
    toast(
      apiResult.total === 0
        ? "No match found in the dataset"
        : `${formatInt(apiResult.total)} match${apiResult.total === 1 ? "" : "es"} found`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, exact, colourMode, size, fieldWidth, navigate, toast]);

  // Deep links: auto-run the pattern search when ?p= is present (once on mount).
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !params.get("p")) return;
    autoRan.current = true;
    void startSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="panel p-4" aria-label={colourMode ? "Colour pattern" : "Shape pattern"}>
      <h2 className="m-0 text-lg">{colourMode ? "Paint a colour pattern" : "Draw a shape"}</h2>
      <p className="mt-1 text-xs" style={{ color: "var(--text-2)" }}>
        {colourMode
          ? "Each digit is a colour; dashed cells are wildcards that match anything. Two to eight constrained cells."
          : "Digits 0–4 are black, 5–9 white. Paint your shape and scan the binary stream."}
      </p>
      <div className="mt-3">
        <PatternPainter
          rows={rows}
          cols={cols}
          cells={cells}
          onChange={setCells}
          onResize={setGridSize}
          colourMode={colourMode}
          allowWildcard={colourMode}
          expectedMatches={expected}
          difficultyLabel={diff.label}
          difficultyDescription={diff.description}
          minCells={minCells}
          maxCells={maxCells}
          presets={colourMode ? COLOUR_PRESETS : SHAPE_PRESETS}
          searching={searching}
          progress={progress}
          onCancel={() => {
            setSearching(false);
            setPatternSearching(false);
            setProgress(null);
            if (activePatternJobId.current !== null) {
              void cancelJob(activePatternJobId.current).catch(() => undefined);
              activePatternJobId.current = null;
            }
          }}
          onSearch={() => void startSearch()}
          disabled={false}
        />
        {!colourMode && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={exact}
              onChange={(e) => setExact(e.target.checked)}
              className="h-4 w-4"
            />
            <span>
              Exact mode
              <span className="block text-xs" style={{ color: "var(--text-2)" }}>
                {exact
                  ? "Unpainted cells must also be white (5–9)."
                  : "Ink-only: unpainted cells are wildcards."}
              </span>
            </span>
          </label>
        )}
      </div>
    </section>
  );
}

/** Plain observable store for pattern results (service → UI). */
const patternResultStore = {
  matches: [] as PatternMatch[],
  total: 0,
  capped: false,
  searching: false,
  selected: -1,
  spec: null as PatternSpec | null,
  exact: true,
  fieldWidth: 48,
  listeners: new Set<() => void>(),
  bump() {
    this.listeners.forEach((l) => l());
  },
};

function setPatternSearching(value: boolean) {
  patternResultStore.searching = value;
  patternResultStore.bump();
}

function usePatternResult() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    patternResultStore.listeners.add(l);
    return () => {
      patternResultStore.listeners.delete(l);
    };
  }, []);
  return patternResultStore;
}

function PatternStage({ colourMode, mode }: { colourMode: boolean; mode: SearchMode }) {
  const size = useDatasetSize();
  const store = usePatternResult();
  const settings = useSettings();

  const highlights = store.spec
    ? store.matches.map((match, i) => ({
        position: match.position,
        rows: store.spec!.rows,
        cols: store.spec!.cols,
        primary: i === store.selected,
      }))
    : [];

  const focus = store.selected >= 0 && store.matches[store.selected]
    ? store.matches[store.selected].position
    : null;

  const viewportSpan = 100 * store.fieldWidth;
  const viewportStart = focus ? Math.max(1, focus - viewportSpan / 2) : 1;
  const viewportEnd = viewportStart + viewportSpan;

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-y-1.5 border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <span className="label">
          {focus ? `Focus: position ${formatInt(focus)}` : `${colourMode ? "Colour" : "Shape"} field · width ${store.fieldWidth}`}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-ghost !min-h-[44px]"
            onClick={() => settings.update({ cellSize: Math.max(4, settings.cellSize - 2) })}
            aria-label="Zoom out"
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-ghost !min-h-[44px]"
            onClick={() => settings.update({ cellSize: Math.min(28, settings.cellSize + 2) })}
            aria-label="Zoom in"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-ghost !min-h-[44px]"
            disabled={store.selected <= 0}
            onClick={() => {
              store.selected -= 1;
              store.bump();
            }}
            aria-label="Previous match"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <span className="mono text-sm" aria-live="polite">
            {store.total > 0 ? `${formatInt(store.selected + 1)} / ${formatInt(store.total)}` : "— / —"}
          </span>
          <button
            type="button"
            className="btn btn-ghost !min-h-[44px]"
            disabled={store.selected < 0 || store.selected >= store.total - 1}
            onClick={() => {
              store.selected += 1;
              store.bump();
            }}
            aria-label="Next match"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-[300px] flex-1">
        <PixelField
          totalDigits={size}
          fieldCols={settings.pixelWidth}
          colourMode={colourMode}
          patternRows={store.spec?.rows ?? 1}
          patternCols={store.spec?.cols ?? 1}
          highlights={highlights}
          focusPosition={focus}
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <FieldLegend colourMode={colourMode} />
        <span className="text-xs" style={{ color: "var(--text-2)" }}>{mode}</span>
      </div>
      <div className="border-t px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <Minimap
          datasetSize={size}
          viewportStart={viewportStart}
          viewportEnd={viewportEnd}
          matches={store.matches.map((m) => m.position)}
          selectedPosition={focus}
          onSeek={(pos) => {
            const idx = store.matches.findIndex((m) => m.position >= pos);
            if (idx >= 0) {
              store.selected = idx;
              store.bump();
            }
          }}
        />
      </div>
    </div>
  );
}

function PatternInspector({ mode }: { mode: SearchMode }) {
  const store = usePatternResult();
  const toast = useToast((s) => s.show);
  const size = useDatasetSize();
  const patternResult = useMemo<PatternResult>(() => ({
    total: store.total,
    matches: store.matches,
    capped: store.capped,
    incomplete: false,
    anchors: 0,
    constrained_cells: store.spec?.cells.filter((v) => v !== -1).length ?? 0,
    field_cols: store.fieldWidth,
    rows: store.spec?.rows ?? 0,
    cols: store.spec?.cols ?? 0,
    colour_mode: store.spec?.colourMode ?? mode === "colors",
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [store.total, store.matches, store.capped, store.spec, store.fieldWidth, mode]);

  if (!store.spec) {
    return (
      <section className="panel p-4" aria-label="Results">
        <EmptyState title="Paint and search">
          Draw a pattern on the left and press <strong>Search pattern</strong>. The
          worker scans all valid anchors — never across row boundaries.
        </EmptyState>
      </section>
    );
  }

  const constrained = store.spec.cells.filter((v) => v !== -1).length;
  const base = store.spec.colourMode ? 10 : 2;
  const probability = 1 / base ** constrained;

  const share = async () => {
    const url = buildShareUrl(`/explore/${mode}`, {
      mode,
      pattern: store.spec?.cells,
      patternRows: store.spec?.rows,
      patternCols: store.spec?.cols,
      fieldWidth: store.fieldWidth,
    });
    const how = await shareOrCopy(url, "π Atlas pattern");
    toast(how === "copied" ? "Link copied" : how === "shared" ? "Shared" : "Could not share");
  };

  return (
    <>
      <ResultCard found={store.total > 0} title="Pattern search" difficulty={difficultyFor(expectedPatternMatches(store.spec, store.fieldWidth, size))}>
        <StatRow label="Matches in dataset" value={store.capped ? `${formatInt(store.total)} (list capped)` : formatInt(store.total)} />
        <StatRow label="Constrained cells" value={`${constrained} of ${base}^${constrained} variants`} />
        <StatRow label="Chance per anchor" value={formatOneIn(probability)} />
        <StatRow label="Valid anchors" value={formatInt(Math.max(0, Math.floor(size / store.fieldWidth) - store.spec.rows + 1) * (store.fieldWidth - store.spec.cols + 1))} />
      </ResultCard>

      <OddsRibbon probability={probability} note="idealised model" />

      <section className="flex gap-2" aria-label="Share">
        <button type="button" className="btn flex-1" onClick={() => void share()}>
          <Link2 size={15} aria-hidden="true" /> Copy link
        </button>
      </section>

      <section className="panel-2 p-4 text-xs" style={{ color: "var(--text-2)" }}>
        Matches never wrap across row boundaries: every pattern row is anchored inside
        a single row of the field. The probability model treats digits as independent
        and uniform — an approximation, not a proven property of π.
      </section>
      <WishCard
        mode={mode === "colors" ? "pixels" : "shapes"}
        result={patternResult}
        spec={store.spec}
        exact={store.exact}
        fieldWidth={store.fieldWidth}
        datasetSize={size}
        searching={store.searching}
        occurrence={store.selected + 1}
        fromDateHelper={fromDateHelper()}
      />
    </>
  );
}
