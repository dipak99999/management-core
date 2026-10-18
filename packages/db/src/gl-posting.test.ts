import { describe, expect, it, vi } from "vitest";
import { postGLEntries, type GLLine } from "./gl-posting";

// GL invariants — the balanced-books check is the load-bearing invariant of
// the whole accounting engine. Verify it fires on any imbalance BEFORE the
// helper reaches Prisma.

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    fiscalYear: { findFirst: vi.fn().mockResolvedValue(null) },
    account: {
      findMany: vi.fn().mockImplementation((args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.map((id: string) => ({
          id,
          isGroup: false,
          accountName: id,
          companyId: null,
        })),
      ),
    },
    // Multi-company Phase 1: gl-posting.ts stamps GLEntry.companyId from
    // either the account's companyId or the tenant's default Company. Mock
    // returns null → GLEntries get companyId=null (legacy tenant behavior).
    company: { findFirst: vi.fn().mockResolvedValue(null) },
    gLEntry: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    ...overrides,
  } as unknown as Parameters<typeof postGLEntries>[0];
}

const baseParams = {
  tenantId: "t1",
  postingDate: new Date("2026-01-15"),
  voucherType: "JournalEntry" as const,
  voucherId: "v1",
  voucherName: "JV-0001",
};

describe("postGLEntries invariants", () => {
  it("throws when debits don't equal credits", async () => {
    const tx = makeTx();
    const lines: GLLine[] = [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 99 },
    ];
    await expect(postGLEntries(tx, { ...baseParams, lines })).rejects.toThrow(
      /unbalanced/,
    );
  });

  it("accepts balanced lines and calls createMany", async () => {
    const tx = makeTx();
    const lines: GLLine[] = [
      { accountId: "a", debit: 500, credit: 0 },
      { accountId: "b", debit: 0, credit: 500 },
    ];
    await postGLEntries(tx, { ...baseParams, lines });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx as any).gLEntry.createMany).toHaveBeenCalledOnce();
  });

  it("rejects group-account postings", async () => {
    const tx = makeTx({
      account: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "grp", isGroup: true, accountName: "Assets" }]),
      },
    });
    const lines: GLLine[] = [
      { accountId: "grp", debit: 10, credit: 0 },
      { accountId: "grp", debit: 0, credit: 10 },
    ];
    await expect(postGLEntries(tx, { ...baseParams, lines })).rejects.toThrow(
      /group accounts/,
    );
  });

  it("refuses cross-tenant accounts", async () => {
    const tx = makeTx({
      account: {
        // Return fewer accounts than requested → mismatch → error.
        findMany: vi.fn().mockResolvedValue([]),
      },
    });
    const lines: GLLine[] = [
      { accountId: "a", debit: 1, credit: 0 },
      { accountId: "b", debit: 0, credit: 1 },
    ];
    await expect(postGLEntries(tx, { ...baseParams, lines })).rejects.toThrow(
      /do not belong to this tenant/,
    );
  });

  it("rejects postings inside a closed fiscal year", async () => {
    const tx = makeTx({
      fiscalYear: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ name: "FY24", closedTill: new Date("2026-02-01") }),
      },
    });
    const lines: GLLine[] = [
      { accountId: "a", debit: 1, credit: 0 },
      { accountId: "b", debit: 0, credit: 1 },
    ];
    await expect(postGLEntries(tx, { ...baseParams, lines })).rejects.toThrow(
      /is closed through/,
    );
  });

  it("tolerates rounding within 0.0001", async () => {
    const tx = makeTx();
    const lines: GLLine[] = [
      { accountId: "a", debit: 100.00001, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ];
    await postGLEntries(tx, { ...baseParams, lines });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx as any).gLEntry.createMany).toHaveBeenCalledOnce();
  });

  it("rejects when line accounts span multiple companies (no voucher companyId)", async () => {
    const tx = makeTx({
      account: {
        findMany: vi.fn().mockResolvedValue([
          { id: "a", isGroup: false, accountName: "AcctA", companyId: "co1" },
          { id: "b", isGroup: false, accountName: "AcctB", companyId: "co2" },
        ]),
      },
    });
    const lines: GLLine[] = [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ];
    await expect(postGLEntries(tx, { ...baseParams, lines })).rejects.toThrow(
      /Cross-company posting/,
    );
  });

  it("rejects when a foreign-company account leaks into a voucher scoped to a specific company", async () => {
    const tx = makeTx({
      account: {
        findMany: vi.fn().mockResolvedValue([
          { id: "a", isGroup: false, accountName: "AcctA", companyId: "co1" },
          { id: "b", isGroup: false, accountName: "AcctB", companyId: "co2" },
        ]),
      },
    });
    const lines: GLLine[] = [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ];
    await expect(
      postGLEntries(tx, { ...baseParams, lines, companyId: "co1" }),
    ).rejects.toThrow(/belong to a different company/);
  });

  it("accepts shared (companyId=null) accounts mixed with a specific company voucher", async () => {
    const tx = makeTx({
      account: {
        findMany: vi.fn().mockResolvedValue([
          { id: "a", isGroup: false, accountName: "AcctA", companyId: "co1" },
          { id: "b", isGroup: false, accountName: "SharedB", companyId: null },
        ]),
      },
    });
    const lines: GLLine[] = [
      { accountId: "a", debit: 100, credit: 0 },
      { accountId: "b", debit: 0, credit: 100 },
    ];
    await postGLEntries(tx, { ...baseParams, lines, companyId: "co1" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tx as any).gLEntry.createMany).toHaveBeenCalledOnce();
  });

  it("skips lines where both debit and credit are zero", async () => {
    const tx = makeTx();
    const lines: GLLine[] = [
      { accountId: "a", debit: 10, credit: 0 },
      { accountId: "b", debit: 0, credit: 10 },
      { accountId: "c", debit: 0, credit: 0 }, // noise — filtered
    ];
    await postGLEntries(tx, { ...baseParams, lines });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callData = ((tx as any).gLEntry.createMany.mock.calls[0][0] as { data: unknown[] }).data;
    expect(callData).toHaveLength(2);
  });
});
