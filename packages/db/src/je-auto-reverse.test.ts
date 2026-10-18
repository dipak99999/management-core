import { describe, expect, it } from "vitest";
import { firstOfNextMonth } from "./je-auto-reverse";

describe("firstOfNextMonth", () => {
  it("returns Feb 1 for a Jan date", () => {
    const r = firstOfNextMonth(new Date("2026-01-15T10:00:00Z"));
    expect(r.toISOString().slice(0, 10)).toBe("2026-02-01");
  });
  it("rolls year on Dec → next Jan", () => {
    const r = firstOfNextMonth(new Date("2026-12-31T23:59:00Z"));
    expect(r.toISOString().slice(0, 10)).toBe("2027-01-01");
  });
  it("returns first-of-current-month + 1 month for first-of-month input", () => {
    const r = firstOfNextMonth(new Date("2026-03-01T00:00:00Z"));
    expect(r.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
});
