/**
 * UI regressions from the audit: sticky-canvas coordinates, dialog focus and
 * close-callback staleness, error recovery, and live-region/clipboard cleanup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import PixelField from "../../src/components/PixelField";
import Dialog from "../../src/components/Dialog";
import ErrorBoundary from "../../src/components/ErrorBoundary";
import Toast, { useToast } from "../../src/components/Toast";
import { useSettings } from "../../src/state/useSettings";
import { announce } from "../../src/lib/announce";
import { copyText, shareOrCopy } from "../../src/lib/share";

beforeEach(() => {
  useSettings.getState().reset();
  document.body.style.overflow = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Minimal 2D context: PixelField only uses these five canvas primitives. */
function fakeContext() {
  return {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    imageSmoothingEnabled: false,
  };
}

describe("PixelField 1B window coordinates", () => {
  it("draws and hovers relative to the sticky canvas, not absolute row 0", async () => {
    const ctx = fakeContext();
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalRect = HTMLCanvasElement.prototype.getBoundingClientRect;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 96, bottom: 120, width: 96, height: 120, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ first_position: 1, digits: "1".repeat(2048) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ) as unknown as Response));

    const onCellHover = vi.fn();
    const { container } = render(
      <PixelField
        totalDigits={400_000}
        fieldCols={4}
        colourMode
        highlights={[]}
        focusPosition={300_001}
        onCellHover={onCellHover}
      />,
    );

    const region = container.querySelector('[role="region"]') as HTMLDivElement;
    Object.defineProperty(region, "clientHeight", { configurable: true, value: 120 });
    Object.defineProperty(region, "clientWidth", { configurable: true, value: 96 });
    region.scrollTop = 120;
    fireEvent.scroll(region);

    // Wait for the async window bucket and the redraw it triggers (the first
    // synchronous draw only paints the empty background).
    await vi.waitFor(() => {
      const cells = ctx.fillRect.mock.calls.filter((call) => call[2] === 12 && call[3] === 12);
      expect(cells.length).toBeGreaterThan(0);
    });
    const drawnY = ctx.fillRect.mock.calls
      .filter((call) => call[2] === 12 && call[3] === 12)
      .map((call) => call[1] as number);
    // Absolute-row coordinates would be in the hundreds of thousands.
    expect(Math.max(...drawnY)).toBeLessThanOrEqual(120);

    // The canvas is sticky: at scrollTop=120 (10 rows of 12px) the local row 3
    // under the cursor is dataset row windowStartRow + 13, column 2.
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    fireEvent.mouseMove(canvas, { clientX: 25, clientY: 37 });
    expect(onCellHover).toHaveBeenCalledWith(200_055);

    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = originalRect;
  });
});

describe("Dialog hardening", () => {
  it("uses the latest onClose, traps Tab, and restores focus/scroll on close", () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const view = render(
      <Dialog open onClose={firstClose} title="Settings">
        <button type="button">Extra</button>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const closeButton = screen.getByRole("button", { name: "Close dialog" });
    const extra = screen.getByRole("button", { name: "Extra" });

    expect(document.activeElement).toBe(closeButton);
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(
      <Dialog open onClose={latestClose} title="Settings">
        <button type="button">Extra</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(latestClose).toHaveBeenCalledTimes(1);
    expect(firstClose).not.toHaveBeenCalled();

    extra.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(extra);

    view.rerender(
      <Dialog open={false} onClose={latestClose} title="Settings">
        <button type="button">Extra</button>
      </Dialog>,
    );
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
    expect(dialog).not.toBeInTheDocument();
    opener.remove();
  });
});

describe("ErrorBoundary", () => {
  it("shows a recovery panel and lets a recovered route render again", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("boom in a lazy chunk");
      return <div>Recovered</div>;
    }
    render(<ErrorBoundary><Flaky /></ErrorBoundary>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("boom in a lazy chunk");

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

describe("live regions and clipboard", () => {
  it("keeps the toast live region mounted and restarts identical messages", () => {
    vi.useFakeTimers();
    render(<Toast />);
    const status = screen.getByRole("status", { hidden: true });
    act(() => useToast.getState().show("Saved"));
    expect(status).toHaveTextContent("Saved");
    act(() => vi.advanceTimersByTime(3000));
    act(() => useToast.getState().show("Saved"));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("status", { hidden: true })).toHaveTextContent("Saved");
    expect(screen.getByRole("status", { hidden: true })).toBe(status);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("status", { hidden: true })).toBeEmptyDOMElement();
  });

  it("announces only the newest pending message", () => {
    vi.useFakeTimers();
    announce("stale");
    announce("fresh");
    act(() => vi.advanceTimersByTime(50));
    const regions = Array.from(document.querySelectorAll('[aria-live="polite"]'));
    expect(regions.some((r) => r.textContent === "fresh")).toBe(true);
    expect(regions.some((r) => r.textContent === "stale")).toBe(false);
  });

  it("does not copy to the clipboard when native sharing is dismissed", async () => {
    const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockRejectedValue(Object.assign(new Error("dismissed"), { name: "AbortError" })),
    });
    try {
      expect(await shareOrCopy("https://example.test", "title")).toBe("cancelled");
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      if (originalShare) Object.defineProperty(navigator, "share", originalShare);
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
  });

  it("always removes the clipboard fallback textarea", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const originalExec = Object.getOwnPropertyDescriptor(document, "execCommand");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("insecure context")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("execCommand blocked");
      }),
    });
    try {
      expect(await copyText("hello")).toBe(false);
      expect(document.querySelectorAll("textarea")).toHaveLength(0);
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      if (originalExec) Object.defineProperty(document, "execCommand", originalExec);
    }
  });
});
