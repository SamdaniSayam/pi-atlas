/** Act 1 — Numbers: search 12, then a long sequence, with live difficulty. */
import { useEffect, useState } from "react";
import { submitExact, pollJob, type ExactResult } from "../data/piApi";
import { useDatasetSize, usePiStore } from "../data/piStore";
import { formatInt, formatMagnitude } from "../engine/format";
import { ActHeader } from "./TourStage";

interface LiveCount {
  total: number;
  first: number | null;
  found: boolean;
  expectedCount: number;
  expectedFirstDepth: number;
}

export default function Act1Numbers() {
  const dataReady = usePiStore((s) => s.status === "ready");
  const size = useDatasetSize();
  const [result12, setResult12] = useState<LiveCount | null>(null);
  const [resultLong, setResultLong] = useState<LiveCount | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!dataReady) return;
    let cancelled = false;
    const run = async (q: string): Promise<LiveCount | null> => {
      const submission = await submitExact(q);
      const api = submission.cached
        ? submission.result
        : (await pollJob<ExactResult>(submission.jobId)).result;
      if (!api) return null;
      return {
        total: api.total,
        first: api.total > 0 ? api.positions[0] : null,
        found: api.total > 0,
        expectedCount: (size - q.length + 1) / 10 ** q.length,
        expectedFirstDepth: 10 ** q.length,
      };
    };
    void Promise.all([run("12"), run("123456")])
      .then(([a, b]) => {
        if (cancelled) return;
        setResult12(a);
        setResultLong(b);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [dataReady, size]);

  return (
    <div>
      <ActHeader title="Everything starts with a hunt">
        <p className="m-0">
          The first thing anyone asks π: <em>is my number in there?</em> Type any
          digits in the Digits explorer and the atlas scans all one billion
          positions in a few seconds. Here are two live searches, run against the
          real dataset right now:
        </p>
      </ActHeader>

      {failed && (
        <p className="mt-4 text-sm" style={{ color: "var(--error)" }} role="alert">
          Local search data is unavailable. Try again in a moment.
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="panel-2 p-4" aria-live="polite">
          <span className="label">Live search · “12”</span>
          {result12 ? (
            <>
              <p className="mb-1 mt-2 text-2xl mono" style={{ color: "var(--accent)" }}>
                pos {formatInt(result12.first ?? 0)}
              </p>
              <p className="m-0 text-sm" style={{ color: "var(--text-2)" }}>
                {formatInt(result12.total)} occurrences. A 2-digit sequence is
                expected about once every {formatMagnitude(result12.expectedFirstDepth)} digits. It appears
                almost immediately.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>Searching…</p>
          )}
        </div>
        <div className="panel-2 p-4" aria-live="polite">
          <span className="label">Live search · “123456”</span>
          {resultLong ? (
            <>
              <p className="mb-1 mt-2 text-2xl mono" style={{ color: resultLong.found ? "var(--accent-2)" : "var(--error)" }}>
                {resultLong.found ? `pos ${formatInt(resultLong.first ?? 0)}` : "not found"}
              </p>
              <p className="m-0 text-sm" style={{ color: "var(--text-2)" }}>
                {resultLong.found
                  ? `${formatInt(resultLong.total)} occurrence(s). Six digits are expected about ${formatInt(Math.round(resultLong.expectedCount))} times in a billion. That is a thousand trials.`
                  : "Six specific digits are expected about once per million spots. A billion spots is a thousand trials, so it should show up somewhere."}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>Searching…</p>
          )}
        </div>
      </div>

      <p className="mb-0 mt-5 text-sm" style={{ color: "var(--text-2)" }}>
        <strong style={{ color: "var(--text)" }}>Why longer is harder:</strong> each extra
        digit divides the chance by 10. One digit turns up every ~1.1 positions, two
        every ~100, six every ~1,000,000, twenty every 10^20, far beyond the reach of
        any dataset we could ever store. One exponential explains the cliff.
      </p>
    </div>
  );
}
