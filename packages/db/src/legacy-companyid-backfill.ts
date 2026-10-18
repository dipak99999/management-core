import type { Prisma, PrismaClient } from "@prisma/client";

// Multi-company Phase 4: one-shot backfill for rows created before
// Phase 2 shipped `companyId` on SI/PI/PE/JE + their GLEntry lines.
//
// Semantics:
//   * Runs in the caller's transaction (or standalone if a PrismaClient
//     is passed) — a partial run is rolled back atomically per-model,
//     which is safe because setting companyId is idempotent.
//   * Uses the tenant's default Company (isDefault=true, disabled=false)
//     as the target. Tenants with no default cannot be backfilled — the
//     helper returns { skipped: true } and callers should surface a hint
//     to run `ensureDefaultCompany` first.
//   * Only touches rows where `companyId IS NULL`. Existing per-row
//     stamps (including any manual overrides) are preserved.
//   * Safe to re-run. Second call is a no-op.
//
// Returns per-model counts of rows updated so operators can eyeball the
// scope of the backfill before/after.

type AnyClient = PrismaClient | Prisma.TransactionClient;

export interface BackfillResult {
  companyId: string | null;
  salesInvoices: number;
  purchaseInvoices: number;
  paymentEntries: number;
  journalEntries: number;
  glEntries: number;
  skipped?: true;
  reason?: string;
}

export async function backfillLegacyCompanyIds(
  db: AnyClient,
  tenantId: string,
): Promise<BackfillResult> {
  const def = await db.company.findFirst({
    where: { tenantId, isDefault: true, disabled: false },
    select: { id: true },
  });
  if (!def) {
    return {
      companyId: null,
      salesInvoices: 0,
      purchaseInvoices: 0,
      paymentEntries: 0,
      journalEntries: 0,
      glEntries: 0,
      skipped: true,
      reason: "Tenant has no default Company — seed one before backfilling",
    };
  }

  const [si, pi, pe, je, gl] = await Promise.all([
    db.salesInvoice.updateMany({
      where: { tenantId, companyId: null },
      data: { companyId: def.id },
    }),
    db.purchaseInvoice.updateMany({
      where: { tenantId, companyId: null },
      data: { companyId: def.id },
    }),
    db.paymentEntry.updateMany({
      where: { tenantId, companyId: null },
      data: { companyId: def.id },
    }),
    db.journalEntry.updateMany({
      where: { tenantId, companyId: null },
      data: { companyId: def.id },
    }),
    db.gLEntry.updateMany({
      where: { tenantId, companyId: null },
      data: { companyId: def.id },
    }),
  ]);

  return {
    companyId: def.id,
    salesInvoices: si.count,
    purchaseInvoices: pi.count,
    paymentEntries: pe.count,
    journalEntries: je.count,
    glEntries: gl.count,
  };
}
