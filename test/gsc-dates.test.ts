import { describe, expect, it } from "vitest";
import {
  comparisonPeriods,
  formatSearchConsoleDate,
  periodEndingOn,
  subtractDays,
} from "../src/gsc/dates";

describe("Search Console date helpers", () => {
  it("formats instants using the America/Los_Angeles calendar date", () => {
    expect(formatSearchConsoleDate(new Date("2026-08-17T03:00:00Z"))).toBe("2026-08-16");
    expect(formatSearchConsoleDate(new Date("2026-01-17T07:30:00Z"))).toBe("2026-01-16");
  });

  it("subtracts days from date-only values across month and year boundaries", () => {
    expect(subtractDays("2026-08-01", 1)).toBe("2026-07-31");
    expect(subtractDays("2026-01-01", 1)).toBe("2025-12-31");
    expect(subtractDays("2024-03-01", 1)).toBe("2024-02-29");
  });

  it("builds inclusive periods ending on the requested date", () => {
    expect(periodEndingOn("2026-08-15", 7)).toEqual({
      startDate: "2026-08-09",
      endDate: "2026-08-15",
    });
    expect(periodEndingOn("2026-08-15", 28)).toEqual({
      startDate: "2026-07-19",
      endDate: "2026-08-15",
    });
  });

  it("builds adjacent 7-day and 28-day comparison periods", () => {
    expect(comparisonPeriods("2026-08-15")).toEqual({
      last7: { startDate: "2026-08-09", endDate: "2026-08-15" },
      previous7: { startDate: "2026-08-02", endDate: "2026-08-08" },
      last28: { startDate: "2026-07-19", endDate: "2026-08-15" },
      previous28: { startDate: "2026-06-21", endDate: "2026-07-18" },
    });
  });

  it("rejects malformed date-only values and non-positive period sizes", () => {
    expect(() => subtractDays("2026-02-30", 1)).toThrow("invalid_date");
    expect(() => subtractDays("2026/08/15", 1)).toThrow("invalid_date");
    expect(() => periodEndingOn("2026-08-15", 0)).toThrow("invalid_period_days");
  });
});
