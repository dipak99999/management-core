import { describe, expect, it, vi } from "vitest";
import { companyPrefix, resolveCompanyForVoucher } from "./company-resolve";

describe("companyPrefix", () => {
  it("returns base prefix when code is null/undefined/empty", () => {
    expect(companyPrefix("SINV-", null)).toBe("SINV-");
    expect(companyPrefix("SINV-", undefined)).toBe("SINV-");
    expect(companyPrefix("SINV-", "")).toBe("SINV-");
  });
  it("inserts the code before the counter", () => {
    expect(companyPrefix("SINV-", "AC")).toBe("SINV-AC-");
    expect(companyPrefix("PE-", "BC")).toBe("PE-BC-");
  });
});

describe("resolveCompanyForVoucher", () => {
  function makeDb(overrides: Record<string, unknown> = {}) {
    return {
      company: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      ...overrides,
    } as unknown as Parameters<typeof resolveCompanyForVoucher>[0];
  }

  it("returns the tenant default when nothing requested", async () => {
    const db = makeDb({
      company: {
        findFirst: vi.fn().mockResolvedValue({ id: "def", code: "MAIN" }),
      },
    });
    const r = await resolveCompanyForVoucher(db, "t1", null);
    expect(r).toEqual({ id: "def", code: "MAIN" });
  });

  it("returns null when tenant has no default (legacy)", async () => {
    const db = makeDb();
    const r = await resolveCompanyForVoucher(db, "t1", undefined);
    expect(r).toBeNull();
  });

  it("returns the requested company when it belongs to the tenant", async () => {
    const db = makeDb({
      company: {
        findFirst: vi.fn().mockResolvedValue({ id: "req", code: "BC" }),
      },
    });
    const r = await resolveCompanyForVoucher(db, "t1", "req");
    expect(r).toEqual({ id: "req", code: "BC" });
  });

  it("throws when the requested company is not owned by the tenant", async () => {
    const db = makeDb({
      company: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    await expect(resolveCompanyForVoucher(db, "t1", "wrong")).rejects.toThrow(
      /does not belong to this tenant/,
    );
  });
});
