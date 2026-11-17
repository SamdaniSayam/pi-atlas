/**
 * Guided tour stage (FR-09): four acts, each driven by real searches
 * against the dataset service. Real data, no prerecorded results.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, SkipForward, RotateCcw } from "lucide-react";
import { usePiStore } from "../data/piStore";
import { ErrorState, LoadingState } from "../components/EmptyState";
import Act1Numbers from "./Act1Numbers";
import Act2Letters from "./Act2Letters";
import Act3Colours from "./Act3Colours";
import Act4Shapes from "./Act4Shapes";

const ACTS = [
  { id: 1, title: "Act 1 · Numbers", Comp: Act1Numbers },
  { id: 2, title: "Act 2 · Words", Comp: Act2Letters },
  { id: 3, title: "Act 3 · Colours", Comp: Act3Colours },
  { id: 4, title: "Act 4 · Shapes", Comp: Act4Shapes },
];

export default function TourStage() {
  const pi = usePiStore();
  const [act, setAct] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = `Guided tour — π Atlas`;
  }, []);

  if (pi.status === "error") {
    return <ErrorState message={pi.error ?? "Dataset failed to load."} onRetry={() => void pi.retry()} />;
  }
  if (pi.status !== "ready") {
    return <LoadingState label="Preparing the tour — contacting the dataset service…" progress={pi.progress} />;
  }

  const Current = ACTS[act].Comp;

  return (
    <div className="mx-auto max-w-3xl">
      {/* progress */}
      <div className="mb-4 flex items-center gap-2" aria-label={`Tour progress: act ${act + 1} of 4`}>
        {ACTS.map((a, i) => (
          <button
            key={a.id}
            type="button"
            className="flex h-9 min-w-0 flex-1 items-center"
            style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer" }}
            onClick={() => setAct(i)}
            aria-label={`Go to ${a.title}`}
            aria-current={i === act ? "step" : undefined}
          >
            <span
              className="block h-1.5 w-full rounded-full"
              style={{ background: i <= act ? "var(--accent)" : "var(--border)" }}
            />
          </button>
        ))}
      </div>

      <p className="eyebrow mb-2">{ACTS[act].title}</p>

      <div className="panel min-h-[380px] p-6" aria-live="polite">
        <Current />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={act === 0} onClick={() => setAct(act - 1)}>
          <ChevronLeft size={15} aria-hidden="true" /> Previous
        </button>
        {act < ACTS.length - 1 ? (
          <button type="button" className="btn btn-primary" onClick={() => setAct(act + 1)}>
            Next <ChevronRight size={15} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => navigate("/explore/digits")}>
            Start exploring <ChevronRight size={15} aria-hidden="true" />
          </button>
        )}
        <Link to="/" className="btn no-underline">
          <SkipForward size={15} aria-hidden="true" /> Skip tour
        </Link>
        <button type="button" className="btn btn-ghost ml-auto" onClick={() => setAct(0)}>
          <RotateCcw size={15} aria-hidden="true" /> Restart
        </button>
      </div>
    </div>
  );
}

export function ActHeader({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h2 className="m-0" style={{ fontSize: "clamp(24px, 3.5vw, 30px)" }}>{title}</h2>
      <div className="mt-3 text-[15px]" style={{ color: "var(--text-2)" }}>{children}</div>
    </>
  );
}
