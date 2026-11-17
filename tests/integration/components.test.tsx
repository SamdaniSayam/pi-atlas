import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import DigitViewer from "../../src/components/DigitViewer";
import Minimap from "../../src/components/Minimap";
import ResultCard from "../../src/components/ResultCard";
import { DATASET_SIZE } from "../../src/constants";

const digits = "31415926535897932384626433832795028841971693993751";

/** Emulate the service's /window endpoint for the first bucket. */
function stubWindows(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const m = /start=(\d+)&end=(\d+)/.exec(url);
    const start = Number(m?.[1] ?? 1);
    const end = Number(m?.[2] ?? 2048);
    const body = { first_position: start, digits: digits.slice(start - 1, end) };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }) as unknown as Response;
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", stubWindows());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DigitViewer accessibility", () => {
  it("renders rows with position gutters and screen-reader text", async () => {
    // Give the scroll container a measurable size so the virtualizer renders rows.
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
    Element.prototype.getBoundingClientRect = function () {
      return { width: 800, height: 600, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
    render(
      <HashRouter>
        <DigitViewer totalDigits={DATASET_SIZE} density={20} highlights={[{ start: 3, length: 5, primary: true }]} />
      </HashRouter>,
    );
    const region = screen.getByRole("region", { name: /digit stream/i });
    expect(region).toBeInTheDocument();
    // The sr-only span holds the full row text once the bucket arrives
    // (visible digits render as per-character spans).
    expect(await screen.findByText(/Digits at positions 1 to 20: 31415926/, undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe("Minimap", () => {
  it("exposes a slider with dataset bounds", () => {
    render(
      <Minimap
        datasetSize={DATASET_SIZE}
        viewportStart={1}
        viewportEnd={1000}
        matches={[148, 762]}
        selectedPosition={148}
        onSeek={() => undefined}
      />,
    );
    const slider = screen.getByRole("slider", { name: /dataset position/i });
    expect(slider.getAttribute("aria-valuemax")).toBe(String(DATASET_SIZE));
    expect(slider.getAttribute("aria-valuenow")).toBe("1");
  });
});

describe("ResultCard", () => {
  it("announces found status with icon + text (never colour alone)", () => {
    render(
      <ResultCard found title="Test" >
        <div>content</div>
      </ResultCard>,
    );
    expect(screen.getByText("FOUND")).toBeInTheDocument();
  });
});
