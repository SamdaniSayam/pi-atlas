/** Accessible Customize dialog for the wish card. */
import { useEffect, useRef, useState } from "react";
import Dialog from "../components/Dialog";
import { useToast } from "../components/Toast";
import { copyText } from "../lib/share";
import { buildCaption } from "./caption";
import { pickCopy, previewLine, sanitizeDedication } from "./copy";
import { fileNameFor } from "./layout";
import { downloadCard, prepareCardFile, shareCard } from "./share";
import type { RenderedCard } from "./render";
import {
  SUBJECT_CHIPS, type WishCardInput, type WishFormat,
  type WishOptions, type WishStyle, type WishSubject,
} from "./types";

const FORMATS: Array<{ id: WishFormat; label: string; size: string }> = [
  { id: "square", label: "Square", size: "1080×1080" },
  { id: "story", label: "Story", size: "1080×1920" },
  { id: "wide", label: "Wide", size: "1200×630" },
];
const STYLES: Array<{ id: WishStyle; label: string }> = [
  { id: "collectible", label: "Collectible" },
  { id: "clean", label: "Clean" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  input: WishCardInput;
  defaultSubject: WishSubject;
  options: WishOptions;
  onChange: (next: WishOptions) => void;
  onInputChange: (next: WishCardInput) => void;
  rendered: RenderedCard | null;
  file: File | null;
  fromDateHelper: boolean;
}

function Segment<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: Array<{ id: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="label mb-2">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <label
            key={item.id}
            className="chip cursor-pointer"
            style={
              value === item.id
                ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--surface-2)" }
                : undefined
            }
          >
            <input
              type="radio"
              name={`wish-${label}`}
              className="sr-only"
              checked={value === item.id}
              onChange={() => onChange(item.id)}
            />
            {item.label}
            {item.hint && <span className="ml-1 text-xs">{item.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Draws a copy of the rendered canvas into the dialog's larger preview. */
function DialogPreview({ rendered, label }: { rendered: RenderedCard | null; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    if (!rendered) return;
    const copy = document.createElement("canvas");
    copy.width = rendered.canvas.width;
    copy.height = rendered.canvas.height;
    copy.style.width = "100%";
    copy.style.height = "auto";
    copy.style.display = "block";
    copy.style.borderRadius = "8px";
    copy.setAttribute("role", "img");
    copy.setAttribute("aria-label", label);
    const ctx = copy.getContext("2d");
    if (ctx) ctx.drawImage(rendered.canvas, 0, 0);
    el.appendChild(copy);
  }, [rendered, label]);
  return (
    <div
      ref={host}
      className="w-full overflow-hidden rounded-lg"
      style={{ background: "var(--surface-2)", minHeight: 180 }}
    />
  );
}

export default function WishCardDialog({
  open,
  onClose,
  input,
  defaultSubject,
  options,
  onChange,
  onInputChange,
  rendered,
  file,
  fromDateHelper,
}: Props) {
  const toast = useToast((s) => s.show);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [dedicationHint, setDedicationHint] = useState(false);
  const filename = fileNameFor(input, options.format);
  const caption = buildCaption(input);
  const copy = pickCopy(input);
  const chips = SUBJECT_CHIPS[input.mode] ?? [];

  // Prepare the PNG as soon as the dialog opens and whenever options change.
  useEffect(() => {
    if (!open || !rendered) {
      setLocalFile(null);
      return;
    }
    let cancelled = false;
    void prepareCardFile(rendered.canvas, filename).then((prepared) => {
      if (!cancelled) setLocalFile(prepared);
    });
    return () => { cancelled = true; };
  }, [open, rendered, filename]);

  const activeFile = file ?? localFile;

  const copyCaption = async () => {
    const ok = await copyText(caption);
    toast(ok ? "Caption copied" : "Couldn’t make the card. Try again.");
  };

  const chooseSubject = (subject: WishSubject) => {
    onInputChange({ ...input, subject: subject === input.subject ? defaultSubject : subject });
  };

  const changeDedication = (raw: string) => {
    const result = sanitizeDedication(raw);
    setDedicationHint(result.removed);
    onInputChange({ ...input, dedication: result.value });
  };

  return (
    <Dialog open={open} onClose={onClose} title="Customize your wish card" sheet maxWidthPx={880}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
            {copy.eyebrow}
          </p>
          <h3 className="mb-2 mt-1 text-xl">{copy.headline}</h3>
          <DialogPreview
            rendered={rendered}
            label={`Wish card, ${copy.tierLabel} tier. Headline: ${copy.headline} Quote: ${copy.quote.text}${input.dedication ? ` Dedication: ${input.dedication}` : ""}`}
          />
          <p className="mb-0 mt-2 text-sm" style={{ color: "var(--text-2)" }}>{previewLine(input, copy)}</p>
          {!rendered && (
            <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>Rendering your card…</p>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {chips.length > 0 && (
            <fieldset className="m-0 border-0 p-0">
              <legend className="label mb-2">This is…</legend>
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <label
                    key={chip.id}
                    className="chip cursor-pointer"
                    style={input.subject === chip.id
                      ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--surface-2)" }
                      : undefined}
                  >
                    <input
                      type="radio"
                      name="wish-subject"
                      className="sr-only"
                      checked={input.subject === chip.id}
                      onChange={() => chooseSubject(chip.id)}
                    />
                    {chip.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className="block">
            <span className="label mb-2 block">Dedication (optional)</span>
            <input
              type="text"
              className="input w-full"
              maxLength={24}
              value={input.dedication}
              placeholder="For someone special"
              onChange={(e) => changeDedication(e.target.value)}
            />
            {dedicationHint && (
              <span className="mt-1 block text-xs" style={{ color: "var(--text-2)" }}>
                Latin letters only for now
              </span>
            )}
          </label>
          <Segment<WishStyle>
            label="Style"
            value={options.style}
            items={STYLES}
            onChange={(style) => onChange({ ...options, style })}
          />
          <Segment<WishFormat>
            label="Format"
            value={options.format}
            items={FORMATS.map((f) => ({ id: f.id, label: f.label, hint: f.size }))}
            onChange={(format) => onChange({ ...options, format })}
          />
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5"
              checked={options.hideQuery}
              onChange={(e) => onChange({ ...options, hideQuery: e.target.checked })}
            />
            <span>
              <strong>Hide my digits</strong>
              <span className="block text-xs" style={{ color: "var(--text-2)" }}>
                Removes your query from the card, QR code, caption and file name.
              </span>
            </span>
          </label>
          {fromDateHelper && (
            <p className="panel-2 m-0 p-3 text-xs" style={{ color: "var(--text-2)" }}>
              This card shows your date digits. Turn on Hide my digits to keep them private.
            </p>
          )}
          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!rendered}
              onClick={() => rendered && void downloadCard(rendered.canvas, filename, toast)}
            >
              Download PNG
            </button>
            <button
              type="button"
              className="btn"
              disabled={!rendered}
              onClick={() => rendered && void shareCard(activeFile, caption, rendered.canvas, filename, toast)}
            >
              Share
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void copyCaption()}>
              Copy caption
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
