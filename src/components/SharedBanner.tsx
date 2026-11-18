/** Polite banner shown only to visitors who followed a Wish Card QR link. */
import { useEffect, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { announce } from "../lib/announce";
import { bannerParts, stripSrc, type SharedBannerResult } from "../lib/sharedBanner";
import type { SearchMode } from "../state/useHistory";

export interface SharedBannerProps {
  mode: SearchMode;
  result: SharedBannerResult;
  datasetSizeWords: string;
  /** False while the URL's search is still running: copy stays generic, no announcement. */
  ready: boolean;
}

const FOCUS_TARGET: Record<SearchMode, string> = {
  digits: "#digits-q",
  dates: "#date-q",
  letters: "#word-q",
  colors: '[aria-label^="Row 1 column 1"]',
  shapes: '[aria-label^="Row 1 column 1"]',
};

function focusSearchInput(mode: SearchMode): void {
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(FOCUS_TARGET[mode]);
    if (!el) return;
    if (el instanceof HTMLInputElement) {
      // Native setter + event keeps React's defaultValue/state in sync.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.focus();
  }, 0);
}

export default function SharedBanner({ mode, result, datasetSizeWords, ready }: SharedBannerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const parts = bannerParts(ready ? result : null, datasetSizeWords);
  const text = parts.map((part) => part.text).join("");

  useEffect(() => {
    if (ready && !dismissed) announce(text);
  }, [ready, dismissed, text]);

  const go = (clearQuery: boolean) => {
    setDismissed(true);
    const p = stripSrc(new URLSearchParams(location.search));
    if (clearQuery) {
      p.delete("q");
      p.delete("p");
      p.delete("d");
    }
    const search = p.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash },
      { replace: true },
    );
    if (clearQuery) focusSearchInput(mode);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    go(false);
  };

  if (dismissed) return null;
  return (
    <div
      role="region"
      aria-label="Shared result"
      onKeyDown={onKeyDown}
      className="shared-banner h-full"
      data-testid="shared-banner"
    >
      <span className="shared-banner-dot" aria-hidden="true" />
      <p className="shared-banner-text">{parts.map((part, i) => (
        part.mono
          ? <strong key={i} className="mono">{part.text}</strong>
          : <span key={i}>{part.text}</span>
      ))}</p>
      <div className="shared-banner-actions">
        <button type="button" className="btn btn-primary shared-banner-cta" onClick={() => go(true)}>
          Search your own
        </button>
        <button type="button" aria-label="Dismiss" className="shared-banner-close" onClick={() => go(false)}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
