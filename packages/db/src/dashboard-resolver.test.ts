import { describe, expect, it } from "vitest";
import { periodWindow } from "./dashboard-resolver";

describe("periodWindow", () => {
  const NOW = new Date("2026-03-15T12:34:56Z");

  it("computes month-to-date", () => {
    const w = periodWindow("mtd", NOW);
    expect(w.from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(w.to.toISOString()).toBe(NOW.toISOString());
  });

  it("computes quarter-to-date", () => {
    const w = periodWindow("qtd", NOW);
    // March is in Q1 (months 0-2), quarter start month = 0
    expect(w.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("computes year-to-date", () => {
    const w = periodWindow("ytd", NOW);
    expect(w.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("computes last30 rolling window", () => {
    const w = periodWindow("last30", NOW);
    const diffDays = (w.to.getTime() - w.from.getTime()) / (24 * 3600_000);
    expect(diffDays).toBeCloseTo(30, 1);
  });

  it("computes today window from midnight UTC", () => {
    const w = periodWindow("today", NOW);
    expect(w.from.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(w.to.toISOString()).toBe(NOW.toISOString());
  });

  it("prevFrom/prevTo cover an equal-length previous window", () => {
    const w = periodWindow("mtd", NOW);
    const span = w.to.getTime() - w.from.getTime();
    const prevSpan = w.prevTo.getTime() - w.prevFrom.getTime();
    expect(prevSpan).toBeCloseTo(span, -1);
    // prev window ends immediately before current start
    expect(w.prevTo.getTime()).toBe(w.from.getTime() - 1);
  });

  it("yesterday returns a full-day range with a full-day prev window", () => {
    const w = periodWindow("yesterday", NOW);
    expect(w.from.toISOString()).toBe("2026-03-14T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-03-14T23:59:59.999Z");
    expect(w.prevFrom.toISOString().slice(0, 10)).toBe("2026-03-13");
  });
});
