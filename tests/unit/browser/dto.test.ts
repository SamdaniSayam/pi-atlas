import { describe, it, expect } from "vitest";
import { datesDto, type CoreExact } from "../../../src/data/browser/dto";

const complete: CoreExact = {
  total: 1,
  positions: [148],
  truncated: false,
  incomplete: false,
};
const partial: CoreExact = {
  total: 1,
  positions: [148],
  truncated: false,
  incomplete: true,
};

describe("dates DTO", () => {
  it("reports incomplete when any encoded format was stopped early", () => {
    const rows = [
      { id: "DDMMYYYY", label: "DDMMYYYY", sequence: "01012000", result: complete, prefix: [0, 0] as [number, number] },
      { id: "MMDDYYYY", label: "MMDDYYYY", sequence: "01021000", result: partial, prefix: [0, 0] as [number, number] },
    ];
    const dto = datesDto(2000, 1, 1, rows);
    expect(dto.incomplete).toBe(true);
  });

  it("reports complete only when every format finished", () => {
    const rows = [
      { id: "DDMMYYYY", label: "DDMMYYYY", sequence: "01012000", result: complete, prefix: [0, 0] as [number, number] },
    ];
    expect(datesDto(2000, 1, 1, rows).incomplete).toBe(false);
  });
});
