import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Compass, Hash, Type, Palette, Shapes, Sparkles } from "lucide-react";
import { usePiStore, useDatasetSize } from "../data/piStore";
import { submitExact, pollJob, fetchStats, type DigitStats, type ExactResult } from "../data/piApi";
import { useDigitWindow } from "../data/digitWindow";
import { APP_NAME, CHI_SQUARE_95_DF9 } from "../constants";
import { formatInt, formatMagnitude } from "../engine/format";
import { colourFor } from "../engine/palette";
import { useSettings } from "../state/useSettings";
import { computeOdds } from "../engine/odds";
import SearchInput from "../components/SearchInput";

/** Animated field of digits drawn from the real dataset. */
function DigitRain() {
  const status = usePiStore((s) => s.status);
  const rain = useDigitWindow(1, 2048);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let offset = 0;
    const cols = Math.min(90, Math.floor(window.innerWidth / 22));
    const rows = 26;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const src = rain ?? "314159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706";
      const cell = w / cols;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const fade = 1 - Math.abs(r - rows * 0.45) / (rows * 0.75);
          ctx.fillStyle = `rgba(97, 230, 193, ${(0.05 + fade * 0.16).toFixed(3)})`;
          const idx = (r * cols + c + offset) % (src.length - 1);
          ctx.font = "13px 'JetBrains Mono', monospace";
          ctx.fillText(src[idx], c * cell, 20 + r * (h - 30) / rows);
        }
      }
    };

    const tick = () => {
      if (!reduceMotion) offset = (offset + cols) % 1_900_000;
      draw();
      raf = requestAnimationFrame(tick);
    };
    if (reduceMotion) {
      draw();
    } else {
      raf = requestAnimationFrame(tick);
    }
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [rain, reduceMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      style={{
        maskImage: "radial-gradient(ellipse at 50% 45%, transparent 18%, black 72%)",
        WebkitMaskImage: "radial-gradient(ellipse at 50% 45%, transparent 18%, black 72%)",
        opacity: status === "ready" ? 1 : 0.5,
        transition: "opacity 600ms ease",
      }}
    />
  );
}

function Hero() {
  const status = usePiStore((s) => s.status);
  return (
    <section className="relative overflow-hidden rounded-[24px]" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      <DigitRain />
      <div className="relative z-10 flex flex-col items-center px-6 py-16 text-center md:py-24">
        <p className="eyebrow mb-4">AN ATLAS OF A BILLION DIGITS</p>
        <h1 className="m-0" style={{ fontSize: "clamp(40px, 7vw, 64px)", lineHeight: 1.05 }}>
          Is everything hiding in&nbsp;π?
        </h1>
        <p className="mt-5 max-w-xl text-base" style={{ color: "var(--text-2)" }}>
          Explore one billion digits. Search for your numbers, your words, colours,
          and shapes. See what appears, and what probability says about what does not.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/explore/digits" className="btn btn-primary no-underline">
            <Compass size={17} aria-hidden="true" />
            Explore π
          </Link>
          <Link to="/tour" className="btn no-underline">
            <Sparkles size={16} aria-hidden="true" />
            Take the tour
          </Link>
        </div>
        <p className="mt-6 text-xs mono" style={{ color: "var(--text-2)" }} aria-live="polite">
          {status === "ready" && "✓ 1,000,000,000 decimal digits · verified · served live"}
          {status === "loading" && "Loading local dataset…"}
          {status === "error" && "Local dataset unavailable. Some features are unavailable."}
          {status === "idle" && "one billion decimal digits · verified · served live"}
        </p>
      </div>
    </section>
  );
}

function QuickExperiment() {
  const status = usePiStore((s) => s.status);
  const digitCount = useDatasetSize();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ q: string; pos: number | null; total: number } | null>(null);

  const run = (q: string) => {
    if (status !== "ready" || busy) return;
    setBusy(true);
    void (async () => {
      try {
        const submission = await submitExact(q);
        const api = submission.cached
          ? submission.result
          : (await pollJob<ExactResult>(submission.jobId)).result;
        setResult({ q, pos: api && api.total > 0 ? api.positions[0] : null, total: api?.total ?? 0 });
      } catch {
        setResult({ q, pos: null, total: 0 });
      } finally {
        setBusy(false);
      }
      navigate(`/explore/digits?q=${encodeURIComponent(q)}`);
    })();
  };

  return (
    <section className="panel mt-6 p-6" aria-label="Quick experiment">
      <h2 className="m-0 text-xl">Try it now</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>
        Any sequence of digits. A birthday, a phone number, a lucky pattern.
      </p>
      <div className="mt-4">
        <SearchInput
          onSubmit={run}
          placeholder="Try a number, date, or sequence..."
          label="Quick search"
          buttonLabel="Search"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {["12", "999999", "314159"].map((q) => (
          <button key={q} type="button" className="chip mono" onClick={() => run(q)} disabled={status !== "ready" || busy}>
            {q}
          </button>
        ))}
        <Link to="/explore/dates" className="chip no-underline" style={{ color: "var(--text-2)" }}>
          Your birthday →
        </Link>
      </div>
      {result && (
        <p className="mb-0 mt-4 text-sm" aria-live="polite">
          {result.pos !== null ? (
            <>
              <strong className="mono" style={{ color: "var(--accent)" }}>{result.q}</strong> first
              appears at decimal position{" "}
              <strong className="mono">{formatInt(result.pos)}</strong>{" "}
              ({formatInt(result.total)} occurrence{result.total === 1 ? "" : "s"}).
            </>
          ) : (
            <>
              <strong className="mono">{result.q}</strong> does not appear in the first{" "}
              {formatInt(digitCount)} digits.
            </>
          )}
        </p>
      )}
      {status !== "ready" && (
        <p className="mb-0 mt-4 text-xs" style={{ color: "var(--text-2)" }}>
          {status === "error"
            ? "Local dataset unavailable. Searches are paused."
            : "Loading local dataset. Searches unlock as soon as it is ready."}
        </p>
      )}
    </section>
  );
}

const EXPLORERS = [
  {
    to: "/explore/digits",
    Icon: Hash,
    title: "Digits",
    text: "Hunt any number and see where it hides, with the odds behind every find.",
  },
  {
    to: "/explore/letters",
    Icon: Type,
    title: "Letters",
    text: "Words are encoded as digit pairs. Search both alignments of the stream.",
  },
  {
    to: "/explore/colors",
    Icon: Palette,
    title: "Colours",
    text: "Ten digits, ten colours. Paint a pattern and scan a billion cells.",
  },
  {
    to: "/explore/shapes",
    Icon: Shapes,
    title: "Shapes",
    text: "Binary π: 0–4 is black, 5–9 is white. Draw a shape and look for it.",
  },
];

function ExplorerCards() {
  const theme = useSettings((s) => s.theme);
  const light = theme === "light";
  return (
    <section aria-label="Four explorers" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {EXPLORERS.map(({ to, Icon, title, text }) => (
        <motion.div key={to} whileHover={{ y: -3 }} className="min-w-0">
          <Link
            to={to}
            className="panel group flex h-full min-w-0 flex-col gap-3 p-5 no-underline"
            style={{ color: "var(--text)" }}
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <Icon size={17} aria-hidden="true" style={{ color: "var(--accent)" }} />
              </span>
              <h3 className="m-0 text-lg">{title}</h3>
              <ArrowRight
                size={15}
                aria-hidden="true"
                className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--accent)" }}
              />
            </div>
            <MiniViz kind={title} light={light} />
            <p className="mb-0 text-sm" style={{ color: "var(--text-2)" }}>{text}</p>
          </Link>
        </motion.div>
      ))}
    </section>
  );
}

/** Tiny live visualization per explorer card, drawn from real data. */
function MiniViz({ kind, light }: { kind: string; light: boolean }) {
  const windowed = useDigitWindow(1, 48);
  const slice = windowed ?? "31415926535897932384626433832795028841971693993751".slice(0, 48);

  if (kind === "Colours") {
    return (
      <div className="grid gap-0.5" aria-hidden="true" style={{ gridTemplateColumns: "repeat(16, 1fr)" }}>
        {[...slice].map((d, i) => (
          <div key={i} className="aspect-square rounded-[2px]" style={{ background: colourFor(Number(d), light) }} />
        ))}
      </div>
    );
  }
  if (kind === "Shapes") {
    return (
      <div className="grid gap-0.5" aria-hidden="true" style={{ gridTemplateColumns: "repeat(16, 1fr)" }}>
        {[...slice].map((d, i) => (
          <div
            key={i}
            className="aspect-square rounded-[2px]"
            style={{ background: Number(d) < 5 ? (light ? "#0a0d10" : "#0a0d10") : light ? "#ffffff" : "#f1f5f4", border: "1px solid var(--border)" }}
          />
        ))}
      </div>
    );
  }
  if (kind === "Letters") {
    const words = slice.match(/.{1,2}/g)?.slice(0, 12) ?? [];
    return (
      <div className="mono overflow-hidden min-w-0 text-xs leading-6" aria-hidden="true" style={{ color: "var(--text-2)" }}>
        {words.map((pair, i) => {
          const v = Number(pair) % 26;
          return (
            <span key={i} style={{ color: v === 15 ? "var(--accent)" : undefined }}>
              {String.fromCharCode(65 + v)}
            </span>
          );
        })}
      </div>
    );
  }
  return (
    <div className="mono overflow-hidden min-w-0 text-xs leading-6" aria-hidden="true" style={{ color: "var(--text-2)", whiteSpace: "nowrap", letterSpacing: "0.18em" }}>
      {slice}
    </div>
  );
}

function BigQuestion() {
  const status = usePiStore((s) => s.status);
  const [stats, setStats] = useState<DigitStats | null>(null);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;
    fetchStats()
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [status]);
  return (
    <section className="panel mt-6 grid gap-6 p-6 md:grid-cols-2 md:p-8" aria-label="The big question">
      <div>
        <p className="eyebrow mb-3">THE BIG QUESTION</p>
        <h2 className="m-0" style={{ fontSize: "clamp(26px, 4vw, 32px)" }}>Does π contain everything?</h2>
        <p className="mt-4 text-[15px]" style={{ color: "var(--text-2)" }}>
          Probably, and that is the interesting part. If the digits of π behave like
          a fair random stream (a property called <strong>normality</strong>), then any
          short pattern you can name must appear somewhere, and most do appear
          remarkably early. But this remains a hypothesis: no one has ever proved
          that π is normal. A probability argument is not a proof. It is an
          expectation, and this atlas lets you test that expectation directly.
        </p>
        <p className="mb-0 mt-3 text-[15px]" style={{ color: "var(--text-2)" }}>
          Every result here is computed locally from the actual dataset. Nothing is
          hardcoded, so what you find is what π really contains.
        </p>
      </div>
      <div className="panel-2 self-start p-5">
        <h3 className="m-0 text-sm" style={{ color: "var(--text-2)" }}>Live digit balance</h3>
        {stats ? (
          <>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full" aria-hidden="true">
              {stats.counts.map((c, i) => (
                <div key={i} style={{ flex: c, background: colourFor(i, false) }} />
              ))}
            </div>
            <dl className="mb-0 mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt style={{ color: "var(--text-2)" }}>Chi-square (9 df)</dt>
              <dd className="m-0 text-right mono">{stats.chiSquare.toFixed(2)}</dd>
              <dt style={{ color: "var(--text-2)" }}>95% threshold</dt>
              <dd className="m-0 text-right mono">{CHI_SQUARE_95_DF9}</dd>
              <dt style={{ color: "var(--text-2)" }}>Verdict</dt>
              <dd className="m-0 text-right" style={{ color: stats.chiSquare <= CHI_SQUARE_95_DF9 ? "var(--success)" : "var(--warning)" }}>
                {stats.chiSquare <= CHI_SQUARE_95_DF9 ? "consistent" : "deviating"}
              </dd>
            </dl>
            <p className="mb-0 mt-3 text-xs" style={{ color: "var(--text-2)" }}>
              Consistency with a uniform model does not prove randomness or normality.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--text-2)" }} role="status">
            {status === "error" ? "Dataset failed to load." : "Loading dataset…"}
          </p>
        )}
      </div>
    </section>
  );
}

function ProbabilityTeaser() {
  const [pixels, setPixels] = useState(6);
  const datasetSize = useDatasetSize();
  const odds = computeOdds(10, pixels, 1);
  const expected = odds.log10Space;
  const log10Spots = Math.log10(datasetSize);
  return (
    <section className="panel mt-6 p-6 md:p-8" aria-label="Probability teaser">
      <p className="eyebrow mb-3">PROBABILITY TEASER</p>
      <h2 className="m-0" style={{ fontSize: "clamp(24px, 3.5vw, 32px)" }}>How rare is rare?</h2>
      <p className="mt-3 max-w-2xl text-[15px]" style={{ color: "var(--text-2)" }}>
        A specific pattern of coloured digits has a 1 in 10<sup>n</sup> chance of
        appearing at any given spot. Slide the length and watch the odds explode.
      </p>
      <label className="mt-6 block max-w-md">
        <span className="label mb-1 flex justify-between">
          <span>Pattern length</span>
          <span className="mono">{pixels} cells</span>
        </span>
        <input type="range" min={1} max={20} value={pixels} onChange={(e) => setPixels(Number(e.target.value))} className="w-full" />
      </label>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="panel-2 p-4">
          <span className="label">Chance at one spot</span>
          <p className="mb-0 mt-1 text-lg mono" style={{ color: "var(--accent)" }}>1 in {formatMagnitude(10 ** Math.min(expected, 300))}</p>
        </div>
        <div className="panel-2 p-4">
          <span className="label">Spots in the dataset</span>
          <p className="mb-0 mt-1 text-lg mono">≈ {formatInt(datasetSize)}</p>
        </div>
        <div className="panel-2 p-4">
          <span className="label">Expected finds</span>
          <p className="mb-0 mt-1 text-lg mono" style={{ color: expected > log10Spots ? "var(--error)" : "var(--success)" }}>
            {expected >= log10Spots + 1 ? "≈ none" : `≈ ${formatMagnitude(10 ** Math.max(0, log10Spots - expected))}`}
          </p>
        </div>
      </div>
      <Link to="/probability" className="mt-5 inline-flex items-center gap-1.5 text-sm no-underline" style={{ color: "var(--accent)" }}>
        Open the Probability Laboratory <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </section>
  );
}

const TOUR_ACTS = [
  { n: "Act 1", title: "Numbers", text: "Search 12, then chase something absurdly long." },
  { n: "Act 2", title: "Words", text: "Letters become digit pairs; find your name in π." },
  { n: "Act 3", title: "Colours", text: "Watch the stream morph into ten coloured seas." },
  { n: "Act 4", title: "Shapes", text: "Draw in black and white and hunt your drawing." },
];

function TourSection() {
  return (
    <section className="mt-6" aria-label="Guided tour">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">GUIDED TOUR</p>
          <h2 className="m-0" style={{ fontSize: "clamp(24px, 3.5vw, 32px)" }}>Four experiments</h2>
        </div>
        <Link to="/tour" className="btn no-underline">
          Start the tour
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TOUR_ACTS.map((a) => (
          <div key={a.n} className="panel p-5">
            <p className="eyebrow mb-2">{a.n}</p>
            <h3 className="m-0 text-lg">{a.title}</h3>
            <p className="mb-0 mt-2 text-sm" style={{ color: "var(--text-2)" }}>{a.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  useEffect(() => {
    document.title = `${APP_NAME} · is everything hiding in π?`;
  }, []);
  return (
    <div className="flex flex-col gap-0 pb-8">
      <Hero />
      <QuickExperiment />
      <ExplorerCards />
      <BigQuestion />
      <ProbabilityTeaser />
      <TourSection />
      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
        <span>{APP_NAME} · one billion digits, searched locally on your device · no tracking</span>
        <nav aria-label="Footer" className="flex gap-4">
          <Link to="/about" className="no-underline" style={{ color: "var(--text-2)" }}>About</Link>
          <Link to="/about#methodology" className="no-underline" style={{ color: "var(--text-2)" }}>Methodology</Link>
          <Link to="/about#privacy" className="no-underline" style={{ color: "var(--text-2)" }}>Privacy</Link>
        </nav>
      </footer>
    </div>
  );
}
