/** Act 4 — Shapes: binary π, draw a plus, run a real search. */
import { useEffect, useState } from "react";
import { submitPattern, pollJob, type PatternResult } from "../data/piApi";
import { useDigitWindow } from "../data/digitWindow";
import { useDatasetSize } from "../data/piStore";
import { formatInt, formatOneIn, difficultyFor } from "../engine/format";
import { ActHeader } from "./TourStage";
import { SHAPE_PRESETS } from "../components/PatternPainter";

const W = 36;
const ROWS = 6;

export default function Act4Shapes() {
  const size = useDatasetSize();
  const [result, setResult] = useState<{ total: number; first: number | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const plus = SHAPE_PRESETS[0];

  // Binary field preview
  const slice = useDigitWindow(1, W * ROWS);

  // Real search for the Plus preset (3×3, ink-only: wildcards around the ink)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const submission = await submitPattern({
        rows: 3,
        cols: 3,
        cells: plus.cells,
        colour_mode: false,
        field_cols: W,
        match_cap: 1000,
      });
      const api = submission.cached
        ? submission.result
        : (await pollJob<PatternResult>(submission.jobId)).result;
      if (cancelled || !api) return;
      setResult({ total: api.total, first: api.matches[0]?.position ?? null });
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [plus.cells]);

  const expected = (size / W) / 2 ** 5; // 5 black cells in the plus, ink-only
  const diff = difficultyFor(expected);

  return (
    <div>
      <ActHeader title="Draw and discover">
        <p className="m-0">
          Collapse each digit to black (0–4) or white (5–9) and π becomes a
          black-and-white canvas. Paint any shape and the atlas scans every valid
          anchor. It never crosses row boundaries. Here is the binary stream:
        </p>
      </ActHeader>

      <div
        className="mt-5 grid gap-0.5 overflow-hidden rounded-xl p-2"
        style={{ border: "1px solid var(--border)", gridTemplateColumns: `repeat(${W}, 1fr)`, width: "fit-content" }}
        role="img"
        aria-label="Black and white field of the first 216 digits of π"
      >
        {(slice ?? "").padEnd(W * ROWS, "·").split("").map((d, i) => (
          <div
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: 1,
              background: d === "·" ? "transparent" : Number(d) < 5 ? "#0a0d10" : "#f1f5f4",
              border: "1px solid var(--border)",
            }}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <div>
          <span className="label">The shape being hunted</span>
          <div className="mt-2 grid gap-0.5" style={{ gridTemplateColumns: "repeat(3, 1fr)", width: "fit-content" }}>
            {plus.cells.map((v, i) => (
              <div
                key={i}
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 2,
                  background: v === 1 ? "#f1f5f4" : v === 0 ? "#0a0d10" : "transparent",
                  border: v === -1 ? "1px dashed var(--border)" : "1px solid var(--border)",
                }}
              />
            ))}
          </div>
        </div>
        <div className="panel-2 flex-1 p-4" aria-live="polite">
          <span className="label">Live search · Plus preset</span>
          {result ? (
            <p className="mb-0 mt-2 text-sm">
              <strong className="mono" style={{ color: result.total > 0 ? "var(--accent)" : "var(--error)" }}>
                {result.first !== null ? `pos ${formatInt(result.first)}` : "not found"}
              </strong>{" "}
              · {formatInt(result.total)} match{result.total === 1 ? "" : "es"}.{" "}
              {diff.label.toLowerCase()}: {formatOneIn(1 / expected)} per anchor under the model.
            </p>
          ) : failed ? (
            <p className="mb-0 mt-2 text-sm" style={{ color: "var(--error)" }} role="alert">
              Local search data is unavailable. Try again in a moment.
            </p>
          ) : (
            <p className="mb-0 mt-2 text-sm" style={{ color: "var(--text-2)" }}>Searching…</p>
          )}
        </div>
      </div>

      <p className="mb-0 mt-5 text-sm" style={{ color: "var(--text-2)" }}>
        <strong style={{ color: "var(--text)" }}>The cliff edge:</strong> a 2-cell shape
        is everywhere; 6 constrained cells are already rare; 12 are practically
        impossible inside a billion digits. The Probability Laboratory lets you test
        that cliff with your own pictures. Try it after the tour.
      </p>
    </div>
  );
}
