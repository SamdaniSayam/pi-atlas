/**
 * Probability Laboratory (FR-07, §29).
 * Log10 arithmetic throughout — no overflowing powers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Dices } from "lucide-react";
import { computeOdds, compareToDataset, maxFindablePixels, MAGNITUDE_ANCHORS } from "../engine/odds";
import { formatMagnitude } from "../engine/format";
import { useDatasetSize } from "../data/piStore";
import { colourFor } from "../engine/palette";
import { useResolvedTheme } from "../state/useSettings";

const COLOURS = 10;

/** Deterministic procedural sample image (checker + gradient blend). */
function proceduralSample(w: number, h: number): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < h; r += 1) {
    const row: number[] = [];
    for (let c = 0; c < w; c += 1) {
      const wave = Math.sin((c / w) * Math.PI * 2) * 0.5 + 0.5;
      const checker = (r + c) % 2 === 0 ? 0.85 : 0.25;
      const v = Math.floor(((wave * 0.6 + checker * 0.4) * (COLOURS - 1)) + 0.5);
      row.push(Math.max(0, Math.min(COLOURS - 1, v)));
    }
    grid.push(row);
  }
  return grid;
}

function quantizeImage(
  img: HTMLImageElement,
  w: number,
  h: number,
  colours: number,
): number[][] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return proceduralSample(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const grid: number[][] = [];
  for (let r = 0; r < h; r += 1) {
    const row: number[] = [];
    for (let c = 0; c < w; c += 1) {
      const i = (r * w + c) * 4;
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      row.push(Math.min(colours - 1, Math.floor((lum / 255) * colours)));
    }
    grid.push(row);
  }
  return grid;
}

export default function OddsLab() {
  const [colours, setColours] = useState(10);
  const [width, setWidth] = useState(4);
  const [height, setHeight] = useState(4);
  const [grid, setGrid] = useState<number[][]>(() => proceduralSample(4, 4));
  const [imageName, setImageName] = useState<string | null>(null);
  const datasetSize = useDatasetSize();
  const fileRef = useRef<HTMLInputElement>(null);
  const imageUrlRef = useRef<string | null>(null);

  const odds = useMemo(() => computeOdds(colours, width, height), [colours, width, height]);
  const comparison = useMemo(() => compareToDataset(odds, datasetSize, width), [odds, width, datasetSize]);
  const maxPixels = maxFindablePixels(colours, datasetSize);

  const repaint = useCallback(() => {
    if (imageUrlRef.current) {
      const img = new Image();
      img.onload = () => setGrid(quantizeImage(img, width, height, colours));
      img.src = imageUrlRef.current;
    } else {
      setGrid(proceduralSample(width, height));
    }
  }, [width, height, colours]);

  useEffect(() => {
    repaint();
  }, [repaint]);

  useEffect(() => {
    document.title = `Probability Laboratory · π Atlas`;
  }, []);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    imageUrlRef.current = URL.createObjectURL(file);
    setImageName(file.name);
    repaint();
  };

  const light = useResolvedTheme() === "light";
  const palette = Array.from({ length: colours }, (_, i) =>
    colourFor(Math.round((i / Math.max(1, colours - 1)) * 9), light),
  );

  const oneIn = odds.probability > 0 ? 1 / odds.probability : Number.POSITIVE_INFINITY;
  const log10Expected = comparison.log10ExpectedMatches;
  const expectedFinds =
    log10Expected > 2
      ? `≈ ${formatMagnitude(10 ** Math.min(log10Expected, 300))}`
      : log10Expected > -3
        ? `≈ ${10 ** Number(log10Expected.toPrecision(2)) < 1 ? (10 ** Number(log10Expected.toPrecision(2))).toPrecision(2) : Math.round(10 ** Number(log10Expected.toPrecision(2)))}`
        : "≈ none";

  return (
    <div className="mx-auto max-w-4xl">
      <p className="eyebrow mb-2">PROBABILITY LABORATORY</p>
      <h1 className="m-0" style={{ fontSize: "clamp(28px, 4vw, 36px)" }}>
        How big can a findable picture be?
      </h1>
      <p className="mt-3 max-w-2xl text-[15px]" style={{ color: "var(--text-2)" }}>
        Choose a colour count and a canvas size. The lab computes the chance that your
        exact image appears somewhere in a billion digits. It uses logarithms, so even
        absurd sizes stay computable.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_320px]">
        {/* controls */}
        <section className="panel p-5" aria-label="Odds controls">
          <label className="block">
            <span className="label mb-1 flex justify-between">
              <span>Colours (quantization levels)</span>
              <span className="mono">{colours}</span>
            </span>
            <input
              type="range"
              className="w-full"
              min={2}
              max={256}
              value={colours}
              onChange={(e) => setColours(Number(e.target.value))}
            />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="label mb-1 flex justify-between">
                <span>Width</span>
                <span className="mono">{width}</span>
              </span>
              <input type="range" className="w-full" min={1} max={64} value={width}
                onChange={(e) => setWidth(Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="label mb-1 flex justify-between">
                <span>Height</span>
                <span className="mono">{height}</span>
              </span>
              <input type="range" className="w-full" min={1} max={64} value={height}
                onChange={(e) => setHeight(Number(e.target.value))} />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" className="btn" onClick={() => { if (imageUrlRef.current) { URL.revokeObjectURL(imageUrlRef.current); imageUrlRef.current = null; setImageName(null); } repaint(); }}>
              <Dices size={15} aria-hidden="true" /> Procedural sample
            </button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              <Upload size={15} aria-hidden="true" /> Upload image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
              aria-label="Upload an image (processed locally, never uploaded)"
            />
            {imageName && (
              <span className="text-xs" style={{ color: "var(--text-2)" }}>{imageName}</span>
            )}
          </div>
          <p className="mb-0 mt-2 text-xs" style={{ color: "var(--text-2)" }}>
            Uploads are resized, converted to luminance and quantized entirely inside
            your browser. No image data ever leaves this device.
          </p>
        </section>

        {/* preview */}
        <section className="panel p-5" aria-label="Image preview">
          <span className="label">Preview ({width}×{height})</span>
          <div
            className="mx-auto mt-3 grid gap-0.5"
            style={{
              gridTemplateColumns: `repeat(${width}, 1fr)`,
              width: "min(100%, 220px)",
            }}
            role="img"
            aria-label={`Quantized preview: ${height} rows of ${width} cells using ${colours} colours`}
          >
            {grid.flatMap((row, r) =>
              row.map((v, c) => (
                <div
                  key={`${r}-${c}`}
                  className="aspect-square rounded-[2px]"
                  style={{
                    width: "100%",
                    background: palette[Math.min(colours - 1, v)],
                    border: "1px solid var(--border)",
                  }}
                />
              )),
            )}
          </div>
        </section>
      </div>

      {/* results */}
      <section className="panel mt-4 p-5" aria-label="Odds results">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="panel-2 p-4">
            <span className="label">Chance at one spot</span>
            <p className="mb-0 mt-1 text-lg mono" style={{ color: "var(--accent)" }}>
              {oneIn < 1e15 ? `1 in ${Math.round(oneIn).toLocaleString()}` : `1 in 10^${odds.log10Space.toFixed(1)}`}
            </p>
          </div>
          <div className="panel-2 p-4">
            <span className="label">Search space</span>
            <p className="mb-0 mt-1 text-lg mono">{colours}^{width * height} = 10^{odds.log10Space.toFixed(1)}</p>
          </div>
          <div className="panel-2 p-4">
            <span className="label">Expected finds in π</span>
            <p className="mb-0 mt-1 text-lg mono" style={{ color: log10Expected > 0 ? "var(--success)" : "var(--error)" }}>
              {expectedFinds}
            </p>
          </div>
        </div>

        <p className="mt-4 mb-0 text-sm" style={{ color: "var(--text-2)" }}>
          {comparison.verdict} Under the model, the largest image you could still
          <em> expect</em> to find in a billion digits is about{" "}
          <strong className="mono" style={{ color: "var(--text)" }}>
            {Number.isFinite(maxPixels) ? maxPixels : "unbounded"} pixels
          </strong>{" "}
          (at {colours} colours).
        </p>

        {/* comparison ribbon */}
        <div className="mt-5" aria-hidden="true">
          <div className="relative h-7 overflow-hidden rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
            {(() => {
              const min = 0;
              const max = Math.max(102, odds.log10Space + 4);
              const x = (v: number) => `${((v - min) / (max - min)) * 100}%`;
              return (
                <>
                  {MAGNITUDE_ANCHORS.filter((a) => a.log10 <= max).map((a) => (
                    <div key={a.label} className="absolute top-0 h-full" style={{ left: x(a.log10) }}>
                      <div className="h-full w-px" style={{ background: "var(--border)" }} />
                      <span className="absolute left-1 top-1/2 -translate-y-1/2 whitespace-nowrap text-[0.65rem]" style={{ color: "var(--text-2)" }}>
                        {a.label}
                      </span>
                    </div>
                  ))}
                  <div className="absolute top-0 h-full" style={{ left: x(Math.min(odds.log10Space, max)) }}>
                    <div className="h-full w-0.5" style={{ background: "var(--accent)" }} />
                    <span
                      className="absolute -top-0.5 left-1 whitespace-nowrap rounded px-1 text-[0.65rem]"
                      style={{ background: "var(--accent)", color: "var(--accent-ink)", fontWeight: 700 }}
                    >
                      your image
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
          <p className="mb-0 mt-1 text-[0.7rem]" style={{ color: "var(--text-2)" }}>
            Logarithmic scale: each step is ×10. Real-world quantities are approximate.
          </p>
        </div>
      </section>

      <section className="panel-2 mt-4 p-5 text-sm" style={{ color: "var(--text-2)" }} aria-label="Scientific note">
        <p className="m-0">
          These estimates use an idealised random model in which every digit is
          independent and uniformly distributed. The digits of π have{" "}
          <strong style={{ color: "var(--text)" }}>
            not been proven to be statistically independent or normally distributed
          </strong>{" "}
          They have merely passed every statistical test ever thrown at them.
        </p>
      </section>
    </div>
  );
}
