import { describe, it, expect } from "vitest";
import {
  parseExploreParams,
  serializeExplore,
  clampFieldWidth,
  parsePattern,
  buildShareUrl,
} from "../../src/lib/url";

describe("parseExploreParams", () => {
  it("defaults safely on empty/invalid input", () => {
    const s = parseExploreParams(new URLSearchParams(""));
    expect(s.mode).toBe("digits");
    expect(s.query).toBe("");
    expect(s.occurrence).toBe(1);
    expect(s.fieldWidth).toBe(48);
  });

  it("ignores invalid modes and clamps numbers", () => {
    const s = parseExploreParams(new URLSearchParams("mode=bogus&occ=99999999&w=13"));
    expect(s.mode).toBe("digits");
    expect(s.occurrence).toBe(1_000_000);
    expect(s.fieldWidth).toBe(16); // snapped into range
  });

  it("parses pattern and frame", () => {
    const s = parseExploreParams(
      new URLSearchParams('mode=shapes&p=[1,0,1,-1]&pr=2&pc=2&frame=B&exact=0'),
    );
    expect(s.mode).toBe("shapes");
    expect(s.pattern).toEqual([1, 0, 1, -1]);
    expect(s.patternRows).toBe(2);
    expect(s.patternCols).toBe(2);
    expect(s.frame).toBe("B");
    expect(s.exact).toBe(false);
  });

  it("rejects malformed patterns", () => {
    expect(parsePattern("not-json")).toBeNull();
    expect(parsePattern("[1,2,999]")).toBeNull();
    expect(parsePattern("[1,2]")).toEqual([1, 2]);
  });
});

describe("serializeExplore", () => {
  it("omits defaults", () => {
    expect(serializeExplore({ mode: "digits", query: "12" })).toBe("?q=12");
  });

  it("round-trips a full state", () => {
    const params = serializeExplore({
      mode: "shapes",
      query: "",
      pattern: [1, -1, 0],
      patternRows: 1,
      patternCols: 3,
      exact: false,
      fieldWidth: 64,
      occurrence: 3,
    });
    const parsed = parseExploreParams(new URLSearchParams(params));
    expect(parsed.mode).toBe("shapes");
    expect(parsed.pattern).toEqual([1, -1, 0]);
    expect(parsed.patternRows).toBe(1);
    expect(parsed.patternCols).toBe(3);
    expect(parsed.exact).toBe(false);
    expect(parsed.fieldWidth).toBe(64);
    expect(parsed.occurrence).toBe(3);
  });
});

describe("clampFieldWidth", () => {
  it("snaps to 8-step grid within 16–96", () => {
    expect(clampFieldWidth("48")).toBe(48);
    expect(clampFieldWidth("50")).toBe(48);
    expect(clampFieldWidth("8")).toBe(16);
    expect(clampFieldWidth("500")).toBe(96);
    expect(clampFieldWidth(null)).toBe(48);
  });
});

describe("buildShareUrl", () => {
  it("builds a hash URL preserving state", () => {
    const url = buildShareUrl("/explore/digits", { mode: "digits", query: "314159" });
    expect(url).toContain("#/explore/digits?q=314159");
    expect(url.startsWith(window.location.origin)).toBe(true);
  });
});
