import { describe, expect, it, vi } from "vitest";
import { cloneCoAForCompany } from "./coa-clone";

// Multi-company Phase 3: verify the cloner preserves tree shape + is
// idempotent per (companyId, accountName). Uses a stateful in-memory
// mock of the accounts table so we can assert what gets created and
// what gets skipped.

interface Acc {
  id: string;
  tenantId: string;
  companyId: string | null;
  accountName: string;
  rootType: string;
  accountType: string | null;
  parentId: string | null;
  isGroup: boolean;
}

function makeTx(initial: Acc[]) {
  const state: Acc[] = [...initial];
  let nextIdCounter = 100;
  return {
    company: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string; tenantId: string } }) => ({
        id: where.id,
      })),
    },
    account: {
      findMany: vi.fn().mockImplementation(
        async ({ where, select }: { where: Partial<Acc>; select: Record<string, boolean> }) => {
          const rows = state.filter(
            (r) =>
              r.tenantId === where.tenantId &&
              (where.companyId === null
                ? r.companyId === null
                : r.companyId === where.companyId),
          );
          if (select.accountName && !select.id) return rows.map((r) => ({ accountName: r.accountName }));
          return rows;
        },
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Omit<Acc, "id"> }) => {
        const id = `new-${nextIdCounter++}`;
        const row: Acc = {
          id,
          tenantId: data.tenantId,
          companyId: data.companyId ?? null,
          accountName: data.accountName,
          rootType: data.rootType,
          accountType: data.accountType ?? null,
          parentId: null,
          isGroup: data.isGroup,
        };
        state.push(row);
        return { id: row.id };
      }),
      update: vi.fn().mockImplementation(
        async ({ where, data }: { where: { id: string }; data: Partial<Acc> }) => {
          const row = state.find((r) => r.id === where.id);
          if (row && data.parentId !== undefined) row.parentId = data.parentId;
          return row;
        },
      ),
    },
    _state: state,
  } as any;
}

describe("cloneCoAForCompany", () => {
  it("clones a two-level tree preserving parent links", async () => {
    const tx = makeTx([
      { id: "a", tenantId: "t1", companyId: null, accountName: "Assets", rootType: "Asset", accountType: null, parentId: null, isGroup: true },
      { id: "b", tenantId: "t1", companyId: null, accountName: "Debtors", rootType: "Asset", accountType: "Receivable", parentId: "a", isGroup: false },
      { id: "c", tenantId: "t1", companyId: null, accountName: "Cash", rootType: "Asset", accountType: "Cash", parentId: "a", isGroup: false },
    ]);
    const result = await cloneCoAForCompany(tx, "t1", "co1");
    expect(result).toEqual({ created: 3, skipped: 0 });

    const clones = tx._state.filter((r: Acc) => r.companyId === "co1");
    expect(clones).toHaveLength(3);
    const cloneAssets = clones.find((r: Acc) => r.accountName === "Assets");
    const cloneDebtors = clones.find((r: Acc) => r.accountName === "Debtors");
    expect(cloneDebtors!.parentId).toBe(cloneAssets!.id);
  });

  it("skips accounts that already exist under the target company", async () => {
    const tx = makeTx([
      { id: "a", tenantId: "t1", companyId: null, accountName: "Assets", rootType: "Asset", accountType: null, parentId: null, isGroup: true },
      { id: "b", tenantId: "t1", companyId: null, accountName: "Debtors", rootType: "Asset", accountType: "Receivable", parentId: "a", isGroup: false },
      { id: "c", tenantId: "t1", companyId: "co1", accountName: "Debtors", rootType: "Asset", accountType: "Receivable", parentId: null, isGroup: false },
    ]);
    const result = await cloneCoAForCompany(tx, "t1", "co1");
    expect(result).toEqual({ created: 1, skipped: 1 });
  });

  it("returns zero when there's nothing to clone", async () => {
    const tx = makeTx([]);
    const result = await cloneCoAForCompany(tx, "t1", "co1");
    expect(result).toEqual({ created: 0, skipped: 0 });
  });

  it("throws when the target company is not owned by the tenant", async () => {
    const tx = makeTx([]);
    tx.company.findFirst = vi.fn().mockResolvedValue(null);
    await expect(cloneCoAForCompany(tx, "t1", "wrong")).rejects.toThrow(
      /does not belong to this tenant/,
    );
  });
});
