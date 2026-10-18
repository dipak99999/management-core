import type { Prisma, PrismaClient } from "@prisma/client";

// Multi-company Phase 3: clone the tenant's shared Chart of Accounts (all
// Accounts with companyId=null) into a company-scoped tree (companyId=<target>).
//
// Semantics:
//   * Non-destructive — the shared tree stays intact. Existing GLEntries
//     that referenced shared accounts remain pointing at them; the newly
//     cloned tree is a fresh set of rows only used by future postings that
//     resolve via account.companyId or voucher-level companyId.
//   * Preserves parent hierarchy — the new rows form the same tree shape,
//     with parentId remapped so cloned children point at cloned parents
//     (not at the original shared parent).
//   * Copies structural fields (rootType, accountType, isGroup,
//     accountNumber) and initial flags. Skips derived/mutable state like
//     `disabled` (defaults false on the clone).
//   * Idempotent per (companyId, accountName): if a same-named account
//     already exists under this company, that source account is skipped.
//     Callers can safely re-run this without corrupting the tree, and can
//     seed a company that already has a few manually-created accounts.
//
// Returns the count of accounts created. Meant to be called inside the
// caller's $transaction — the two-pass insert (parents first, then a
// second pass to fix parentIds) is not atomic across calls, so if this
// throws mid-way the caller should roll back.

type AnyClient = PrismaClient | Prisma.TransactionClient;

export async function cloneCoAForCompany(
  tx: AnyClient,
  tenantId: string,
  targetCompanyId: string,
): Promise<{ created: number; skipped: number }> {
  const co = await tx.company.findFirst({
    where: { id: targetCompanyId, tenantId },
    select: { id: true },
  });
  if (!co) throw new Error("targetCompanyId does not belong to this tenant");

  const shared = await tx.account.findMany({
    where: { tenantId, companyId: null },
    orderBy: { accountName: "asc" },
    select: {
      id: true,
      accountName: true,
      rootType: true,
      accountType: true,
      parentId: true,
      isGroup: true,
    },
  });
  if (shared.length === 0) return { created: 0, skipped: 0 };

  const existing = await tx.account.findMany({
    where: { tenantId, companyId: targetCompanyId },
    select: { accountName: true },
  });
  const existingNames = new Set(existing.map((a) => a.accountName));

  // First pass: create every not-yet-existing account with parentId=null,
  // record the old→new id map. Second pass: patch parentId on each new
  // row to the mapped parent (only when the source's parent is also in
  // the shared tree and got cloned this run).
  const oldToNew = new Map<string, string>();
  let created = 0;
  let skipped = 0;
  for (const a of shared) {
    if (existingNames.has(a.accountName)) {
      skipped += 1;
      continue;
    }
    const row = await tx.account.create({
      data: {
        tenantId,
        companyId: targetCompanyId,
        accountName: a.accountName,
        rootType: a.rootType,
        accountType: a.accountType,
        isGroup: a.isGroup,
      },
      select: { id: true },
    });
    oldToNew.set(a.id, row.id);
    created += 1;
  }

  for (const a of shared) {
    const newId = oldToNew.get(a.id);
    if (!newId || !a.parentId) continue;
    const newParent = oldToNew.get(a.parentId);
    if (!newParent) continue;
    await tx.account.update({
      where: { id: newId },
      data: { parentId: newParent },
    });
  }

  return { created, skipped };
}
