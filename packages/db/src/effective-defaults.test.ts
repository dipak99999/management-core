import { describe, expect, it, vi } from "vitest";
import { pickEffective, requireEffectiveDefaults } from "./effective-defaults";

describe("pickEffective", () => {
  it("prefers the company override when set", () => {
    expect(
      pickEffective(
        { defaultCashAccountId: "tenant-cash" },
        { defaultCashAccountId: "company-cash" },
        "defaultCashAccountId",
      ),
    ).toBe("company-cash");
  });
  it("falls back to tenant when company is null", () => {
    expect(
      pickEffective(
        { defaultCashAccountId: "tenant-cash" },
        null,
        "defaultCashAccountId",
      ),
    ).toBe("tenant-cash");
  });
  it("falls back to tenant when company field is null", () => {
    expect(
      pickEffective(
        { defaultCashAccountId: "tenant-cash" },
        { defaultCashAccountId: null },
        "defaultCashAccountId",
      ),
    ).toBe("tenant-cash");
  });
  it("returns null when neither is set", () => {
    expect(pickEffective({}, {}, "defaultCashAccountId")).toBeNull();
  });
});

describe("requireEffectiveDefaults", () => {
  function makeTx({
    tenant,
    company,
  }: {
    tenant: Record<string, string | null> | null;
    company?: Record<string, string | null> | null;
  }) {
    return {
      tenant: { findUnique: vi.fn().mockResolvedValue(tenant) },
      company: { findFirst: vi.fn().mockResolvedValue(company ?? null) },
    } as unknown as Parameters<typeof requireEffectiveDefaults>[0];
  }

  it("uses company override when present", async () => {
    const tx = makeTx({
      tenant: { defaultReceivableAccountId: "t-rec" },
      company: { defaultReceivableAccountId: "c-rec" },
    });
    const d = await requireEffectiveDefaults(
      tx,
      "t1",
      ["defaultReceivableAccountId"],
      "co1",
    );
    expect(d.defaultReceivableAccountId).toBe("c-rec");
  });

  it("falls back to tenant when company override is null", async () => {
    const tx = makeTx({
      tenant: { defaultReceivableAccountId: "t-rec" },
      company: { defaultReceivableAccountId: null },
    });
    const d = await requireEffectiveDefaults(
      tx,
      "t1",
      ["defaultReceivableAccountId"],
      "co1",
    );
    expect(d.defaultReceivableAccountId).toBe("t-rec");
  });

  it("skips company lookup when companyId omitted", async () => {
    const tx = makeTx({
      tenant: { defaultReceivableAccountId: "t-rec" },
    });
    const d = await requireEffectiveDefaults(tx, "t1", ["defaultReceivableAccountId"]);
    expect(d.defaultReceivableAccountId).toBe("t-rec");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx as any).company.findFirst).not.toHaveBeenCalled();
  });

  it("throws when required field is missing on both", async () => {
    const tx = makeTx({
      tenant: { defaultReceivableAccountId: null },
      company: { defaultReceivableAccountId: null },
    });
    await expect(
      requireEffectiveDefaults(tx, "t1", ["defaultReceivableAccountId"], "co1"),
    ).rejects.toThrow(/Missing default account "defaultReceivableAccountId"/);
  });

  it("throws when tenant not found", async () => {
    const tx = makeTx({ tenant: null });
    await expect(
      requireEffectiveDefaults(tx, "t1", ["defaultReceivableAccountId"]),
    ).rejects.toThrow(/Tenant not found/);
  });
});
