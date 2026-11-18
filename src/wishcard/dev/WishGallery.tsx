/**
 * Development-only wish-card gallery. Compiled only in dev/E2E builds; the
 * production route is absent. Renders ONE full-size card at a time, checks it,
 * keeps a small thumbnail, then frees the canvas before the next card.
 */
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { renderWishCard } from "../render";
import { FORMATS, qrPlateFor } from "../layout";
import { THEMES } from "../themes";
import type { TextBox } from "../layout";
import type { WishCardInput, WishFormat, WishOptions, WishStyle, WishTier } from "../types";
import { datasetWordsWithDigits } from "../copy";

const FORMAT_LIST: WishFormat[] = ["square", "story", "wide"];
const STYLE_LIST: WishStyle[] = ["collectible", "clean"];
const TIERS: WishTier[] = ["gold", "silver", "aurora", "twilight"];

function url(path: string): string {
  return new URL(path, location.origin + location.pathname).toString();
}

function make(patch: Partial<WishCardInput> & { tier: WishTier }): WishCardInput {
  const { tier, ...rest } = patch;
  const base: WishCardInput = {
    mode: "digits",
    found: tier !== "twilight",
    query: "12",
    count: tier === "twilight" ? 0 : 19800,
    firstPosition: tier === "twilight" ? null : 148,
    expected: tier === "gold" ? 0.001 : tier === "silver" ? 0.1 : 10,
    expectedDepthLog10: 24,
    datasetSize: 1_000_000_000,
    datasetWords: datasetWordsWithDigits(1_000_000_000),
    longestPrefix: null,
    context: { text: "...3141592653589793238462643...", matchStart: 9, matchLength: 2 },
    shareUrl: url("#/explore/digits?q=12"),
    hideQuery: false,
    tier,
    subject: "number",
    dedication: "",
    style: "collectible",
    ...rest,
  };
  return { ...base, tier };
}

interface CardState {
  id: string;
  label: string;
  section: "Tiers" | "Edge cases";
  input: WishCardInput;
  options: WishOptions;
  thumb: string | null;
  status: string | null;
  qrText: string;
}

function buildCards(): CardState[] {
  const cards: CardState[] = [];
  for (const tier of TIERS) {
    for (const format of FORMAT_LIST) {
      for (const style of STYLE_LIST) {
        const found = tier !== "twilight";
        cards.push({
          id: `tier-${tier}-${format}-${style}`,
          label: `${tier} · ${format} · ${style}`,
          section: "Tiers",
          input: make({ tier, found, count: found ? 19800 : 0, firstPosition: found ? 148 : null }),
          options: { format, style, hideQuery: false },
          thumb: null,
          status: null,
          qrText: "",
        });
      }
    }
  }
  const extras: Array<{ id: string; label: string; input: WishCardInput }> = [
    {
      id: "birthday-hidden",
      label: "birthday · hidden digits",
      input: make({
        tier: "gold", subject: "birthday", hideQuery: true, query: "07092006",
        firstPosition: 745388, shareUrl: url("#/explore/digits?q=07092006&d=1"),
      }),
    },
    {
      id: "long-dedication",
      label: "name · 24-character dedication",
      input: make({
        tier: "silver", mode: "letters", subject: "name", query: "PI",
        dedication: "To my favourite person!!", shareUrl: url("#/explore/letters?q=PI"),
      }),
    },
    {
      id: "long-digits",
      label: "20-digit query",
      input: make({
        tier: "gold", query: "98765432109876543210", expected: 0.00000001,
        firstPosition: 987654, count: 1,
      }),
    },
    {
      id: "long-word",
      label: "12-letter word",
      input: make({
        tier: "silver", mode: "letters", subject: "word", query: "MISSISSIPPIA",
        expected: 0.006, firstPosition: 12345, count: 3,
        shareUrl: url("#/explore/letters?q=MISSISSIPPIA"),
      }),
    },
    {
      id: "capped-count",
      label: "6×6 pattern · capped count",
      input: make({
        tier: "aurora", mode: "pixels", subject: "pattern", query: "6x6:1,2,3,4,5,6",
        count: 200_000, expected: 10, firstPosition: 100,
        pattern: { rows: 6, cols: 6, cells: [1, 2, 3, 4, 5, 6], kind: "color", exact: true },
        shareUrl: url("#/explore/colors?p=%5B1%2C2%2C3%2C4%2C5%2C6%5D&pr=6&pc=6"),
      }),
    },
    {
      id: "long-prefix",
      label: "not found · long prefix",
      input: make({
        tier: "twilight", found: false, count: 0, firstPosition: null, query: "1234567890",
        expected: 0.0000001, longestPrefix: { prefix: "123456789", position: 4242 },
      }),
    },
  ];
  for (const extra of extras) {
    cards.push({
      id: extra.id,
      label: extra.label,
      section: "Edge cases",
      input: extra.input,
      options: { format: "square", style: "collectible", hideQuery: extra.input.hideQuery },
      thumb: null,
      status: null,
      qrText: "",
    });
  }
  return cards;
}

function intersects(a: TextBox, plate: { x: number; y: number; size: number }): boolean {
  return a.x < plate.x + plate.size && a.x + a.w > plate.x &&
    a.y < plate.y + plate.size && a.y + a.h > plate.y;
}

function checkCard(
  canvas: HTMLCanvasElement,
  card: CardState,
  boxes: TextBox[],
): { ok: boolean; detail: string; qr: string | null } {
  const problems: string[] = [];
  const spec = FORMATS[card.options.format];
  const plate = qrPlateFor(card.options.format, card.options.style);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, detail: "no 2D context", qr: null };

  const qrCtx = canvas.getContext("2d");
  let qr: string | null = null;
  if (qrCtx) {
    const data = qrCtx.getImageData(plate.x, plate.y, plate.size, plate.size).data;
    qr = jsQR(data, plate.size, plate.size, { inversionAttempts: "dontInvert" })?.data ?? null;
  }
  if (!qr) problems.push("QR");

  // The clean style uses its own fixed legacy coordinates; the box list
  // belongs to the collectible layout. Both styles still get QR and colour checks.
  if (card.options.style === "collectible") {
    for (const box of boxes) {
      if (box.decorative) continue;
      if (box.x < spec.margin - 2 || box.y < spec.margin - 2 ||
          box.x + box.w > spec.width - spec.margin + 2 ||
          box.y + box.h > spec.height - spec.margin + 2) {
        problems.push(`margin:${box.id}`);
      }
      if (box.minSize < 12) problems.push(`size:${box.id}`);
      if (box.h < box.minSize) problems.push(`height:${box.id}`);
      if (card.options.format === "story" && (box.y < 220 || box.y + box.h > 1580)) {
        problems.push(`safe:${box.id}`);
      }
      if (intersects(box, plate)) problems.push(`qr-overlap:${box.id}`);
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
          problems.push(`overlap:${a.id}/${b.id}`);
        }
      }
    }
  }

  const patch = ctx.getImageData(6, 6, 24, 24).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < patch.length; i += 4) {
    r += patch[i];
    g += patch[i + 1];
    b += patch[i + 2];
  }
  const pixels = patch.length / 4;
  const avg = [r / pixels, g / pixels, b / pixels];
  const tier = card.input.tier;
  const familyOk =
    (tier === "gold" && avg[0] >= avg[1] && avg[1] >= avg[2]) ||
    (tier === "silver" && avg[2] > avg[1] && avg[1] > avg[0]) ||
    (tier === "aurora" && avg[1] > avg[2] && avg[2] > avg[0]) ||
    (tier === "twilight" && avg[2] > avg[0] && avg[0] > avg[1]);
  if (!familyOk) problems.push(`colour:${avg.map((v) => Math.round(v)).join(",")}`);

  return { ok: problems.length === 0, detail: problems.length ? problems.join(" ") : "OK", qr };
}

function thumbnail(canvas: HTMLCanvasElement): string {
  const small = document.createElement("canvas");
  const width = 180;
  small.width = width;
  small.height = Math.round((canvas.height / canvas.width) * width);
  const ctx = small.getContext("2d");
  if (ctx) ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, small.width, small.height);
  const data = small.toDataURL("image/png");
  small.width = 0;
  small.height = 0;
  return data;
}

function CanvasThumb({ card }: { card: CardState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren();
    if (!card.thumb) return;
    const img = document.createElement("img");
    img.src = card.thumb;
    img.alt = `${card.label} thumbnail`;
    img.style.width = "100%";
    img.style.display = "block";
    el.appendChild(img);
  }, [card.thumb, card.label]);
  return <div ref={ref} data-testid={`gallery-thumb-${card.id}`} />;
}

export default function WishGallery() {
  const [cards, setCards] = useState<CardState[]>(buildCards);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const card of cards) {
        if (cancelled) return;
        const rendered = await renderWishCard(card.input, card.options, true);
        if (cancelled) return;
        const checked = checkCard(rendered.canvas, card, rendered.boxes);
        const thumb = thumbnail(rendered.canvas);
        // Release the full-size canvas before the next card is drawn.
        rendered.canvas.width = 0;
        rendered.canvas.height = 0;
        setCards((prev) => prev.map((c) => (
          c.id === card.id
            ? { ...c, thumb, status: checked.ok ? "OK" : `FAIL: ${checked.detail}`, qrText: checked.qr ?? "" }
            : c
        )));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    };
    void run();
    return () => { cancelled = true; };
    // cards are built once; sequential rendering on mount is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderSection = (section: CardState["section"]) => (
    <section className="mt-6" aria-label={`${section} cards`}>
      <h2 className="text-lg">{section}</h2>
      <div data-testid={section === "Tiers" ? "wish-contact-sheet" : undefined}
        className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {cards.filter((c) => c.section === section).map((card) => (
          <article key={card.id} className="panel p-3">
            <h3 className="m-0 text-sm font-semibold">{card.label}</h3>
            <p
              className="m-0 mt-1 text-xs"
              data-testid={`gallery-status-${card.id}`}
              data-qr-text={card.qrText}
              data-tier={THEMES[card.input.tier] ? card.input.tier : "unknown"}
            >
              {card.status ?? "checking…"}
            </p>
            <CanvasThumb card={card} />
          </article>
        ))}
      </div>
    </section>
  );

  return (
    <main className="p-4">
      <h1 className="text-2xl">Wish card gallery (dev only)</h1>
      <p className="text-sm" style={{ color: "var(--text-2)" }}>
        One full-size card at a time: QR decode, layout boxes, colour family, then a thumbnail.
        {" "}Square {FORMATS.square.width}×{FORMATS.square.height} · Story {FORMATS.story.height} tall · Wide {FORMATS.wide.width}×{FORMATS.wide.height}.
      </p>
      {renderSection("Tiers")}
      {renderSection("Edge cases")}
    </main>
  );
}
