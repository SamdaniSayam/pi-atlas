/**
 * Pattern painter (§28): grid editor for colour & shape patterns.
 * Supports pointer drag painting, keyboard painting, presets, wildcards
 * (colour mode), and difficulty estimation.
 */
import { useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { PALETTE } from "../engine/palette";
import { useSettings } from "../state/useSettings";
import { announce } from "../lib/announce";

export interface PainterPreset {
  name: string;
  rows: number;
  cols: number;
  cells: number[]; // -1 wildcard (colour mode)
}

export const SHAPE_PRESETS: PainterPreset[] = [
  { name: "Plus", rows: 3, cols: 3, cells: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
  {
    name: "Smiley",
    rows: 5,
    cols: 5,
    cells: [
      0, 1, 1, 1, 0,
      1, 0, 0, 0, 1,
      1, 0, 1, 0, 1,
      1, 0, 0, 0, 1,
      0, 1, 1, 1, 0,
    ],
  },
  {
    name: "Arrow",
    rows: 4,
    cols: 4,
    cells: [
      1, 0, 0, 0,
      1, 1, 0, 0,
      1, 1, 1, 0,
      1, 0, 0, 0,
    ],
  },
  {
    name: "Heart",
    rows: 4,
    cols: 5,
    cells: [
      1, 1, 0, 1, 1,
      1, 1, 1, 1, 1,
      0, 1, 1, 1, 0,
      0, 0, 1, 0, 0,
    ],
  },
];

export const COLOUR_PRESETS: PainterPreset[] = [
  {
    name: "Rainbow",
    rows: 2,
    cols: 5,
    cells: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
  },
  {
    name: "Stripes",
    rows: 3,
    cols: 3,
    cells: [1, 1, 1, 2, 2, 2, 1, 1, 1],
  },
];

interface PatternPainterProps {
  rows: number;
  cols: number;
  cells: number[];
  onChange: (cells: number[]) => void;
  onResize: (rows: number, cols: number) => void;
  colourMode: boolean;
  /** Colour mode: allow toggling wildcard cells. */
  allowWildcard: boolean;
  expectedMatches: number;
  difficultyLabel: string;
  difficultyDescription: string;
  minCells: number;
  maxCells: number;
  onSearch: () => void;
  searching: boolean;
  progress: { checked: number; total: number } | null;
  onCancel: () => void;
  presets: PainterPreset[];
  disabled?: boolean;
}

export default function PatternPainter(props: PatternPainterProps) {
  const {
    rows,
    cols,
    cells,
    onChange,
    onResize,
    colourMode,
    allowWildcard,
    expectedMatches,
    difficultyLabel,
    difficultyDescription,
    minCells,
    maxCells,
    onSearch,
    searching,
    progress,
    onCancel,
    presets,
    disabled,
  } = props;

  const theme = useSettings((s) => s.theme);
  const light = theme === "light";
  const [cursor, setCursor] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [paintValue, setPaintValue] = useState<number>(colourMode ? 1 : 1);
  const [past, setPast] = useState<number[][]>([]);
  const paintingRef = useRef<number | null>(null);
  const constrained = cells.filter((v) => v !== -1).length;
  const tooFew = constrained < minCells;
  const tooMany = constrained > maxCells;

  const setCell = (r: number, c: number, value: number) => {
    const next = [...cells];
    next[r * cols + c] = value;
    setPast((p) => {
      const trimmed = p.length >= 50 ? p.slice(p.length - 49) : p;
      return [...trimmed, cells];
    });
    onChange(next);
  };

  const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    onChange(prev);
    announce("Undid last cell edit");
  };

  const handlePointerCell = (r: number, c: number, isDown: boolean) => {
    if (disabled) return;
    const current = cells[r * cols + c];
    let target: number;
    if (isDown) {
      // First cell decides the drag value: erase if already that colour, else paint
      if (colourMode && allowWildcard) {
        target = current === paintValue ? -1 : paintValue;
      } else {
        target = current === 1 ? 0 : 1;
      }
      paintingRef.current = target;
    } else {
      target = paintingRef.current ?? (colourMode && allowWildcard ? paintValue : 1);
    }
    setCell(r, c, target);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const { r, c } = cursor;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor({ r: Math.min(rows - 1, r + 1), c }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor({ r: Math.max(0, r - 1), c }); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setCursor({ r, c: Math.min(cols - 1, c + 1) }); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setCursor({ r, c: Math.max(0, c - 1) }); }
    else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const v = colourMode && allowWildcard ? paintValue : cells[r * cols + c] === 1 ? 0 : 1;
      setCell(r, c, v);
      announce(`Cell ${r + 1},${c + 1} set to ${v === -1 ? "wildcard" : v}`);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      setCell(r, c, -1);
      announce(`Cell ${r + 1},${c + 1} cleared`);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* size controls */}
      <div className="flex gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="label">Rows</span>
          <select
            className="field !w-16"
            value={rows}
            onChange={(e) => onResize(Number(e.target.value), cols)}
            disabled={disabled}
          >
            {Array.from({ length: 6 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="label">Columns</span>
          <select
            className="field !w-16"
            value={cols}
            onChange={(e) => onResize(rows, Number(e.target.value))}
            disabled={disabled}
          >
            {Array.from({ length: 6 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      {/* active colour (colour mode) */}
      {colourMode && (
        <div role="radiogroup" aria-label="Active colour" className="flex flex-wrap gap-1.5">
          {PALETTE.map((p) => (
            <button
              key={p.digit}
              type="button"
              role="radio"
              aria-checked={paintValue === p.digit}
              aria-label={`Paint ${p.name} (digit ${p.digit})`}
              onClick={() => setPaintValue(p.digit)}
              className="grid h-11 w-11 place-items-center rounded-md text-xs font-bold"
              style={{
                background: light ? p.light : p.dark,
                color: light ? "#fff" : "#111",
                outline: paintValue === p.digit ? "2px solid var(--accent)" : "1px solid var(--border)",
                outlineOffset: paintValue === p.digit ? 1 : 0,
              }}
            >
              {p.digit}
            </button>
          ))}
        </div>
      )}

      {/* grid — scrolls horizontally rather than overflowing the page on very narrow screens */}
      <div className="max-w-full overflow-x-auto pb-1">
        <div
          className="grid gap-0.5 rounded-lg p-2"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            width: "max-content",
            margin: "0 auto",
            touchAction: "none",
          }}
          role="grid"
          aria-label={`Pattern grid, ${rows} by ${cols}. Use arrow keys to move, space to paint, backspace to erase.`}
          tabIndex={0}
          onKeyDown={onKey}
        >
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} role="row" className="flex gap-0.5">
              {Array.from({ length: cols }, (_, c) => {
                const v = cells[r * cols + c];
                const isCursor = cursor.r === r && cursor.c === c;
                const p = PALETTE[v] ?? null;
                const bg = v === -1
                  ? "transparent"
                  : colourMode
                    ? (light ? p!.light : p!.dark)
                    : v === 1
                      ? "#f1f5f4"
                      : "#0a0d10";
                return (
                  <button
                    key={c}
                    type="button"
                    role="gridcell"
                    aria-label={`Row ${r + 1} column ${c + 1}: ${v === -1 ? "wildcard" : `value ${v}`}`}
                    aria-selected={isCursor}
                    className="h-10 w-10 rounded-[4px] md:h-11 md:w-11"
                  style={{
                    background: bg,
                    border: `1px dashed ${v === -1 ? "var(--border)" : "transparent"}`,
                    outline: isCursor ? "2px solid var(--accent)" : "none",
                    outlineOffset: 1,
                    color: colourMode && light && v !== -1 ? "#fff" : "var(--text)",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                  onPointerDown={(e) => { e.preventDefault(); handlePointerCell(r, c, true); }}
                  onPointerEnter={() => { if (paintingRef.current !== null && !(paintingRef.current === undefined)) handlePointerCell(r, c, false); }}
                  onPointerUp={() => { paintingRef.current = null; }}
                  disabled={disabled}
                >
                  {v !== -1 && colourMode ? v : ""}
                </button>
              );
            })}
          </div>
        ))}
        </div>
      </div>

      {/* presets */}
      <div className="flex flex-wrap gap-1.5">
        <span className="label mr-1 self-center">Presets:</span>
        {presets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => {
              onResize(preset.rows, preset.cols);
              onChange(preset.cells);
              announce(`${preset.name} preset applied`);
            }}
          >
            {preset.name}
          </button>
        ))}
        <button
          type="button"
          className="chip"
          disabled={disabled || past.length === 0}
          onClick={undo}
          aria-label="Undo last cell edit"
        >
          <Undo2 size={13} aria-hidden="true" /> Undo
        </button>
        <button
          type="button"
          className="chip"
          disabled={disabled}
          onClick={() => onChange(new Array(rows * cols).fill(-1))}
        >
          Clear
        </button>
      </div>

      {/* difficulty estimate */}
      <div className="panel-2 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold" style={{ color: "var(--text)" }}>{difficultyLabel}</span>
          <span className="text-xs" style={{ color: "var(--text-2)" }}>
            {constrained}/{maxCells} constrained cells
          </span>
        </div>
        <p className="mb-0 mt-1 text-xs" style={{ color: "var(--text-2)" }}>
          {difficultyDescription} Estimated matches ≈ {expectedMatches < 0.01 ? expectedMatches.toExponential(2) : Math.round(expectedMatches).toLocaleString()}.
        </p>
      </div>

      {searching && progress && (
        <div role="status" aria-label={`Searching: ${Math.round((progress.checked / Math.max(1, progress.total)) * 100)} percent complete`}>
          <div className="mb-1 flex justify-between text-xs" style={{ color: "var(--text-2)" }}>
            <span>Searching…</span>
            <button type="button" className="underline" onClick={onCancel}>
              Cancel
            </button>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (progress.checked / Math.max(1, progress.total)) * 100)}%`,
                background: "var(--accent)",
              }}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        onClick={onSearch}
        disabled={disabled || searching || tooFew || tooMany}
      >
        {searching ? "Searching…" : "Search pattern"}
      </button>
      {tooFew && (
        <p className="m-0 text-xs" style={{ color: "var(--warning)" }}>
          Paint at least {minCells} cells to search.
        </p>
      )}
      {tooMany && (
        <p className="m-0 text-xs" style={{ color: "var(--error)" }}>
          Too many constrained cells (max {maxCells}).
        </p>
      )}
    </div>
  );
}
