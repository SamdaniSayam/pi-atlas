/**
 * Development-only wish-card gallery. Compiled only in dev/E2E builds; the
 * production route is absent. Draws real cards with layout boxes and decodes
 * every QR code with jsQR so regressions are visible immediately.
 */
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { renderWishCard, type RenderedCard } from "../render";
import { FORMATS } from "../layout";
import type { WishCardInput, WishFormat, WishMode, WishOptions, WishStyle } from "../types";

const PLATE: Record<WishFormat, { x: number; y: number; size: number }> = {
  square: { x: 836, y: 836, size: 172 },
  story: { x: (1080 - 260) / 2, y: 1300, size: 260 },
  wide: { x: 872, y: 120, size: 220 },
};

const MODES: WishMode[] = ["digits", "letters", "pixels", "shapes"];
const FORMAT_LIST: WishFormat[] = ["square", "story", "wide"];

function url(path: string): string {
  return new URL(path, location.origin + location.pathname).toString();
}

function sample(mode: WishMode, found: boolean, format: WishFormat, style: WishStyle, hideQuery = false): WishCardInput {
  const base: WishCardInput = {
    mode,
    found,
    query: mode === "digits" ? "12" : mode === "letters" ? "PI" : "1x2:[1,2]",
    count: found ? 19800 : 0,
    firstPosition: found ? 148 : null,
    expected: 9999,
    expectedDepthLog10: 24,
    datasetSize: 1_000_000_000,
    longestPrefix: found ? null : { prefix: mode === "digits" ? "12" : "P", position: 148 },
    context: found && (mode === "digits" || mode === "letters")
      ? { text: "..." + (mode === "digits" ? "3141592653589793238462643" : "150815080432") + "...", matchStart: 9, matchLength: mode === "digits" ? 2 : 4 }
      : null,
    frame: mode === "letters" ? "A" : undefined,
    shareUrl: url(
      mode === "digits" ? "#/explore/digits?q=12"
        : mode === "letters" ? "#/explore/letters?q=PI"
          : `#/explore/${mode === "pixels" ? "colors" : "shapes"}?p=${encodeURIComponent("[1,2]")}&pr=1&pc=2`,
    ),
    hideQuery,
  };
  if (mode === "pixels" || mode === "shapes") {
    base.pattern = {
      rows: 1,
      cols: 2,
      cells: [1, 2],
      kind: mode === "pixels" ? "color" : "shape",
      exact: true,
      region: found ? { rows: 3, cols: 4, values: [1, 2, 3, 4, 5, 1, 2, 6, 7, 8, 9, 0], matchRow: 1, matchCol: 1 } : undefined,
    };
  }
  void format;
  void style;
  return base;
}

interface CardState {
  id: string;
  label: string;
  format: WishFormat;
  rendered: RenderedCard | null;
  qrOk: boolean | null;
  qrText: string;
}

function CanvasMount({ card }: { card: CardState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !card.rendered) return;
    const canvas = card.rendered.canvas;
    canvas.style.width = "240px";
    canvas.style.height = "auto";
    el.replaceChildren(canvas);
  }, [card.rendered]);
  return <div ref={ref} data-testid={`gallery-canvas-${card.id}`} />;
}

function decodeQr(canvas: HTMLCanvasElement, format: WishFormat): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const plate = PLATE[format];
  const data = ctx.getImageData(plate.x, plate.y, plate.size, plate.size).data;
  return jsQR(data, plate.size, plate.size, { inversionAttempts: "dontInvert" }) !== null;
}

export default function WishGallery() {
  const [cards, setCards] = useState<CardState[]>(() => {
    const out: CardState[] = [];
    for (const mode of MODES) {
      for (const found of [true, false]) {
        for (const format of FORMAT_LIST) {
          out.push({
            id: `${mode}-${found ? "found" : "missing"}-${format}`,
            label: `${mode} · ${found ? "found" : "not found"} · ${format}`,
            format,
            rendered: null,
            qrOk: null,
            qrText: "",
          });
        }
      }
    }
    for (const mode of MODES) {
      out.push({
        id: `${mode}-paper`,
        label: `${mode} · Paper example`,
        format: "square",
        rendered: null,
        qrOk: null,
        qrText: "",
      });
    }
    out.push({
      id: "digits-hidden",
      label: "digits · hidden query",
      format: "square",
      rendered: null,
      qrOk: null,
      qrText: "",
    });
    return out;
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const card of cards) {
        const mode = card.id.split("-")[0] as WishMode;
        const found = card.id.includes("found") && !card.id.includes("missing");
        const format = FORMAT_LIST.includes(card.format) ? card.format : "square";
        const style: WishStyle = card.id.endsWith("-paper") ? "paper" : "night";
        const hideQuery = card.id === "digits-hidden";
        const options: WishOptions = { format, style, hideQuery };
        const rendered = await renderWishCard(sample(mode, found, format, style, hideQuery), options, true);
        if (cancelled) return;
        const qrOk = decodeQr(rendered.canvas, format);
        setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, rendered, qrOk, qrText: rendered.qr.text } : c)));
      }
    };
    void run();
    return () => { cancelled = true; };
    // cards is built once; rendering every card on mount is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="p-4">
      <h1 className="text-2xl">Wish card gallery (dev only)</h1>
      <p className="text-sm" style={{ color: "var(--text-2)" }}>
        {FORMATS.square.width}×{FORMATS.square.height} · {FORMATS.story.height} tall · {FORMATS.wide.width}×{FORMATS.wide.height}.
        {" "}Every card is rendered with layout boxes and its QR code is decoded locally.
      </p>
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {cards.map((card) => (
          <article key={card.id} className="panel p-3">
            <h2 className="m-0 text-sm font-semibold">{card.label}</h2>
            <p className="m-0 mt-1 text-xs" data-testid={`qr-status-${card.id}`} data-qr-text={card.qrText}>
              {card.qrOk === null ? "checking…" : card.qrOk ? "QR OK" : "QR FAIL"}
            </p>
            <CanvasMount card={card} />
          </article>
        ))}
      </div>
    </section>
  );
}
