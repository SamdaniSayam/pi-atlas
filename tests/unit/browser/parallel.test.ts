import { describe, expect, it } from "vitest";
import { mapLimit } from "../../../src/data/browser/parallel";

describe("mapLimit", () => {
  it("preserves input order", async () => {
    const out = await mapLimit([5, 1, 9, 3], 2, async (n) => n * 2);
    expect(out).toEqual([10, 2, 18, 6]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit(
      Array.from({ length: 24 }, (_, i) => i),
      4,
      async (n) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        await Promise.resolve();
        active -= 1;
        return n;
      },
    );
    expect(peak).toBe(4);
    expect(out).toHaveLength(24);
  });

  it("propagates errors", async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("handles an empty list", async () => {
    expect(await mapLimit([], 8, async (n) => n)).toEqual([]);
  });
});
