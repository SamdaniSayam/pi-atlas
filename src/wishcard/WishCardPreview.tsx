/** Small live preview plus the result-card actions. Loaded only on demand. */
import { useEffect, useRef, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { announce } from "../lib/announce";
import { useDatasetSize } from "../data/piStore";
import { useToast } from "../components/Toast";
import type { DigitsSearchResult } from "../engine/digitsSearch";
import type { LetterSearchResult } from "../engine/lettersSearch";
import type { PatternSpec } from "../engine/patternSearch";
import type { PatternResult } from "../data/piApi";
import { buildCaption } from "./caption";
import { fileNameFor } from "./layout";
import { renderWishCard, whenIdle, type RenderedCard } from "./render";
import { downloadCard, prepareCardFile, shareCard } from "./share";
import { DEFAULT_WISH_OPTIONS, type WishCardInput, type WishOptions } from "./types";
import {
  buildWishInputForDigits,
  buildWishInputForLetters,
  buildWishInputForPattern,
  datasetWords,
  pickCopy,
} from "./index";
import WishCardDialog from "./WishCardDialog";

export type WishCardSectionProps =
  | {
      mode: "digits";
      result: DigitsSearchResult;
      searching: boolean;
      occurrence: number;
      fromDateHelper: boolean;
    }
  | {
      mode: "letters";
      result: LetterSearchResult;
      searching: boolean;
      occurrence: number;
      fromDateHelper: boolean;
    }
  | {
      mode: "pixels" | "shapes";
      result: PatternResult;
      spec: PatternSpec;
      exact: boolean;
      fieldWidth: number;
      datasetSize: number;
      searching: boolean;
      occurrence: number;
      fromDateHelper: boolean;
    };

/** Canvas mounted from the renderer, shown at CSS width 240 px. */
export function WishCardPreview({
  rendered,
  input,
}: {
  rendered: RenderedCard | null;
  input: WishCardInput | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!rendered) {
      el.replaceChildren();
      return;
    }
    const canvas = rendered.canvas;
    canvas.style.width = "240px";
    canvas.style.height = "auto";
    canvas.style.display = "block";
    el.replaceChildren(canvas);
  }, [rendered]);

  if (!rendered) {
    return (
      <div
        className="h-[240px] w-[240px] animate-pulse rounded-lg"
        style={{ background: "var(--surface-2)" }}
      />
    );
  }
  const copy = pickCopy(input!);
  const detail = input!.found
    ? `${copy.thing} ${input!.query}, first at position ${input!.firstPosition ?? "—"}.`
    : `${copy.thing} ${input!.query}, not found in the first ${datasetWords(input!.datasetSize)} digits.`;
  return (
    <div
      role="img"
      aria-label={`Wish card: ${copy.headline} ${detail}`}
      className="w-[240px] overflow-hidden rounded-lg"
      style={{ border: "1px solid var(--border)" }}
    >
      <div ref={host} />
    </div>
  );
}

export function WishCardSection(props: WishCardSectionProps) {
  const { mode, result, searching, occurrence, fromDateHelper } = props;
  const pattern = "spec" in props ? props : null;
  const spec = pattern?.spec ?? null;
  const exact = pattern?.exact ?? true;
  const fieldWidth = pattern?.fieldWidth ?? 0;
  const storeSize = useDatasetSize();
  const datasetSize = pattern?.datasetSize ?? storeSize;
  const toast = useToast((s) => s.show);
  const [options, setOptions] = useState<WishOptions>(() => ({
    ...DEFAULT_WISH_OPTIONS,
    hideQuery: fromDateHelper,
  }));
  const [input, setInput] = useState<WishCardInput | null>(null);
  const [rendered, setRendered] = useState<RenderedCard | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  // Build the exact data contract from the existing result object.
  useEffect(() => {
    let cancelled = false;
    const build = async (): Promise<WishCardInput> => {
      if (mode === "digits") {
        return buildWishInputForDigits(result, occurrence, fromDateHelper, options.hideQuery, datasetSize);
      }
      if (mode === "letters") {
        return buildWishInputForLetters(result, options.hideQuery, datasetSize);
      }
      return buildWishInputForPattern(
        result, spec!, exact, fieldWidth, datasetSize, mode, options.hideQuery,
      );
    };
    void build().then((value) => {
      if (!cancelled) setInput(value);
    });
    return () => { cancelled = true; };
  }, [mode, result, occurrence, fromDateHelper, options.hideQuery, spec, exact, fieldWidth, datasetSize]);

  // Debounce 300 ms, then render in idle time and prepare the PNG File early.
  useEffect(() => {
    if (!input) return;
    let cancelled = false;
    let cancelIdle: () => void = () => undefined;
    setRendered(null);
    setFile(null);
    const timer = window.setTimeout(() => {
      cancelIdle = whenIdle(() => {
        void renderWishCard(input, options)
          .then(async (card) => {
            if (cancelled) return;
            setRendered(card);
            const prepared = await prepareCardFile(card.canvas, fileNameFor(input, options.format));
            if (!cancelled) {
              setFile(prepared);
              announce("Wish card ready");
            }
          })
          .catch(() => {
            if (!cancelled) toast("Couldn’t make the card. Try again.");
          });
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelIdle();
    };
  }, [input, options, toast]);

  // Shortcut: w opens the dialog, except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "w" || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      setDialogOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const filename = input ? fileNameFor(input, options.format) : "pi-atlas-wish.png";

  return (
    <section className="panel p-4" aria-label="Your wish card">
      <h3 className="m-0 text-base">Your wish card</h3>
      <div className="mt-3">
        <WishCardPreview rendered={rendered} input={input} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={searching || !rendered}
          onClick={() => rendered && void downloadCard(rendered.canvas, filename, toast)}
        >
          <Download size={15} aria-hidden="true" /> {searching ? "Searching…" : "Download"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={searching || !rendered}
          onClick={() => rendered && void shareCard(
            file,
            input ? buildCaption(input) : "",
            rendered.canvas,
            filename,
            toast,
          )}
        >
          <Share2 size={15} aria-hidden="true" /> {searching ? "Searching…" : "Share"}
        </button>
        <button
          ref={opener}
          type="button"
          className="btn btn-ghost underline"
          disabled={searching}
          onClick={() => setDialogOpen(true)}
        >
          {searching ? "Searching…" : "Customize"}
        </button>
      </div>
      {input && (
        <WishCardDialog
          open={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
            window.setTimeout(() => opener.current?.focus(), 0);
          }}
          input={input}
          options={options}
          onChange={setOptions}
          rendered={rendered}
          file={file}
          fromDateHelper={fromDateHelper}
        />
      )}
    </section>
  );
}
