/** Act 2 — Words: the two-digit encoding, both frames, encoding bias. */
import { useEffect, useState } from "react";
import { submitLetters, pollJob, type LettersResult } from "../data/piApi";
import { wordProbability } from "../engine/lettersSearch";
import { formatInt, formatMagnitude, formatOneIn } from "../engine/format";
import { ActHeader } from "./TourStage";

export default function Act2Letters() {
  const [result, setResult] = useState<LettersResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const submission = await submitLetters("PI");
      const api = submission.cached
        ? submission.result
        : (await pollJob<LettersResult>(submission.jobId)).result;
      if (!cancelled && api) setResult(api);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const probability = wordProbability([15, 8]); // P=15, I=08

  return (
    <div>
      <ActHeader title="Words become numbers">
        <p className="m-0">
          Take two digits, reduce mod 26, and you get a letter:{" "}
          <span className="mono">00=A … 25=Z</span>. The word <strong>PI</strong> is
          the pairs <span className="mono">15 08</span>. Because pairs can start at
          digit 1 or digit 2, the stream has two independent alignments — frame A and
          frame B. Both are searched here, live:
        </p>
      </ActHeader>

      {failed && (
        <p className="mt-4 text-sm" style={{ color: "var(--error)" }} role="alert">
          The search service is unreachable — try again in a moment.
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {result?.frames.map((fr) => (
          <div key={fr.frame} className="panel-2 p-4" aria-live="polite">
            <span className="label">Frame {fr.frame} · “PI”</span>
            <p className="mb-1 mt-2 text-2xl mono" style={{ color: fr.total > 0 ? "var(--accent)" : "var(--error)" }}>
              {fr.total > 0 ? `pos ${formatInt(fr.positions[0])}` : "absent"}
            </p>
            <p className="m-0 text-sm" style={{ color: "var(--text-2)" }}>
              {formatInt(fr.total)} match{fr.total === 1 ? "" : "es"} in this alignment.
            </p>
          </div>
        ))}
        {!result && !failed && <p className="text-sm" style={{ color: "var(--text-2)" }}>Searching…</p>}
      </div>

      {result && (
        <p className="mb-0 mt-5 text-sm" style={{ color: "var(--text-2)" }}>
          <strong style={{ color: "var(--text)" }}>A hidden bias:</strong> because pairs
          wrap mod 26, the values 0–21 get four pair-images each (26, 52, 78 too) while
          22–25 get only three. So an <strong>A–V</strong> has probability 4/100 per
          aligned pair, but <strong>W–Z</strong> only 3/100. “PI” (both in A–V) has
          probability {formatOneIn(probability)} per aligned position — expected first
          find near position {formatMagnitude(1 / probability)}. The atlas always uses
          these true per-letter probabilities, never an equal-letter assumption.
        </p>
      )}
    </div>
  );
}
