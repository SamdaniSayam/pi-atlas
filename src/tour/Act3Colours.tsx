/** Act 3 — Colours: the stream morphs into a colour field; a real pattern search. */
import { useEffect, useRef, useState } from "react";
import { colourFor } from "../engine/palette";
import { submitPattern, pollJob, type PatternResult } from "../data/piApi";
import { useDigitWindow } from "../data/digitWindow";
import { formatInt, formatOneIn } from "../engine/format";
import { ActHeader } from "./TourStage";
import { useSettings } from "../state/useSettings";

const W = 36;
const ROWS = 8;

export default function Act3Colours() {
  const theme = useSettings((s) => s.theme);
  const light = theme === "light";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [morph, setMorph] = useState(0); // 0 = raw digits, 1 = full colour field
  const [result, setResult] = useState<{ total: number; first: number | null } | null>(null);
  const [failed, setFailed] = useState(false);

  const slice = useDigitWindow(1, W * ROWS);

  // Morph animation (respects reduced motion via the 0→1 jump below)
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setMorph(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1600);
      setMorph(p < 0.5 ? 0 : 1);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Draw the field
  useEffect(() => {
    if (!slice) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cell = 16;
    canvas.width = W * cell * dpr;
    canvas.height = ROWS * cell * dpr;
    canvas.style.width = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${Math.round(cell * 0.62)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < W; c += 1) {
        const d = Number(slice[r * W + c]);
        const x = c * cell;
        const y = r * cell;
        const useColour = morph > 0.5;
        ctx.fillStyle = useColour ? colourFor(d, light) : "transparent";
        if (useColour) ctx.fillRect(x, y, cell, cell);
        const textVisible = morph < 0.5 || useColour;
        if (!useColour) {
          ctx.fillStyle = light ? "#182320" : "#91a1a5";
        } else {
          // readable text on colour swatches
          ctx.fillStyle = light ? "#ffffff" : "#0b0f12";
        }
        if (textVisible) ctx.fillText(String(d), x + cell / 2, y + cell / 2 + 1);
      }
    }
  }, [slice, morph, light]);

  // Real pattern search: horizontal pair 1-2
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const submission = await submitPattern({
        rows: 1,
        cols: 2,
        cells: [1, 2],
        colour_mode: true,
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
  }, []);

  return (
    <div>
      <ActHeader title="Ten colours, one ocean">
        <p className="m-0">
          Give every digit a colour and the stream becomes a landscape. Below, the
          first 288 digits of π switch between their values and their colours. Then a
          real search looks for the horizontal pair{" "}
          <span className="panel-2 mono px-1.5 py-0.5 text-xs">1&nbsp;2</span> somewhere in
          a billion cells:
        </p>
      </ActHeader>

      <div className="mt-5 overflow-hidden rounded-xl" style={{ border: "1px solid var(--border)" }}>
        <canvas ref={canvasRef} aria-label="Colour field of the first 288 digits of π, morphing between digits and colours" role="img" />
      </div>

      <div className="panel-2 mt-4 p-4" aria-live="polite">
        <span className="label">Live search · horizontal pair 1-2</span>
        {result ? (
          <p className="mb-0 mt-2 text-sm">
            <strong className="mono" style={{ color: "var(--accent)" }}>
              {result.first !== null ? `pos ${formatInt(result.first)}` : "not found"}
            </strong>{" "}
            · {formatInt(result.total)}+ matches. Chance {formatOneIn(1 / 100)} per spot,
            so the dataset is flooded with them.
          </p>
        ) : failed ? (
          <p className="mb-0 mt-2 text-sm" style={{ color: "var(--error)" }} role="alert">
            Local search data is unavailable. Try again in a moment.
          </p>
        ) : (
          <p className="mb-0 mt-2 text-sm" style={{ color: "var(--text-2)" }}>Searching…</p>
        )}
      </div>

      <p className="mb-0 mt-5 text-sm" style={{ color: "var(--text-2)" }}>
        <strong style={{ color: "var(--text)" }}>Colours are digits in disguise:</strong>{" "}
        every pattern you paint is a sequence of digit constraints. The Probability
        section of each result tells you exactly how rare your pattern should be, and
        the search engine shows what π actually contains.
      </p>
    </div>
  );
}
