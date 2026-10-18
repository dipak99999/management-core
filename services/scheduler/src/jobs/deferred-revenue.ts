// Deferred Revenue recognition tick — walks DeferredRevenueSchedule rows
// where dueDate <= today AND isBooked=false, and posts a JE to move the
// installment out of the deferred-revenue liability into recognized
// income. Idempotency via `isBooked` (durable dedup); safe to double-fire
// on scheduler restart.
//
// GL post per booking:
//   DR Tenant.defaultDeferredRevenueAccountId (liability drops)
//   CR Tenant.defaultIncomeAccountId          (revenue recognized)
//
// Both accounts are per-tenant defaults — a tenant with neither set gets
// skipped with a warning (no way to post cleanly). Voucher type is
// `DeferredRevenue` so cancel/rebuild is orthogonal to the source SI's
// posting.

import {
  postGLEntries,
  prisma,
  withCrossTenant,
} from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("deferred-revenue");

export interface DeferredRevenueTickResult {
  rowsChecked: number;
  installmentsBooked: number;
  errors: number;
}

// Cap so a long outage doesn't drop thousands of JEs in one tick; the
// next tick catches the tail.
const MAX_BOOKS_PER_TICK = 500;

export async function runDeferredRevenueTick(): Promise<DeferredRevenueTickResult> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rows = await prisma.deferredRevenueSchedule.findMany(
    withCrossTenant({
      where: {
        isBooked: false,
        dueDate: { lte: today },
      },
      include: {
        salesInvoiceItem: {
          select: {
            salesInvoice: { select: { name: true, isReturn: true } },
          },
        },
      },
      orderBy: [{ tenantId: "asc" as const }, { dueDate: "asc" as const }],
      take: MAX_BOOKS_PER_TICK,
    }),
  );

  let installmentsBooked = 0;
  let errors = 0;

  // Cache tenant defaults per iteration — same tenant likely has many
  // due rows.
  const tenantCache = new Map<
    string,
    {
      defaultDeferredRevenueAccountId: string | null;
      defaultIncomeAccountId: string | null;
    } | null
  >();

  for (const row of rows) {
    if (installmentsBooked >= MAX_BOOKS_PER_TICK) break;
    // Skip rows whose parent SI was cancelled + turned into a return.
    // Cancel path will eventually be responsible for wiping schedules;
    // in the interim we don't book them.
    if (row.salesInvoiceItem.salesInvoice.isReturn) continue;

    let td = tenantCache.get(row.tenantId);
    if (td === undefined) {
      td = await prisma.tenant.findUnique({
        where: { id: row.tenantId },
        select: {
          defaultDeferredRevenueAccountId: true,
          defaultIncomeAccountId: true,
        },
      });
      tenantCache.set(row.tenantId, td);
    }
    if (
      !td ||
      !td.defaultDeferredRevenueAccountId ||
      !td.defaultIncomeAccountId
    ) {
      log.warn("skipped: tenant missing default accounts", {
        tenantId: row.tenantId,
        rowId: row.id,
      });
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Re-read under tx so a manual booking between top-of-tick and
        // write can't double-post.
        const live = await tx.deferredRevenueSchedule.findUnique({
          where: { id: row.id },
        });
        if (!live || live.isBooked) return;

        const amount = Number(live.amount);
        await postGLEntries(tx, {
          tenantId: row.tenantId,
          postingDate: live.dueDate,
          voucherType: "DeferredRevenue",
          voucherId: live.id,
          voucherName: `${row.salesInvoiceItem.salesInvoice.name}/def-${live.installmentNo}`,
          lines: [
            {
              accountId: td!.defaultDeferredRevenueAccountId!,
              debit: amount,
              credit: 0,
              remarks: `Recognize deferred revenue installment ${live.installmentNo}`,
            },
            {
              accountId: td!.defaultIncomeAccountId!,
              debit: 0,
              credit: amount,
            },
          ],
        });

        await tx.deferredRevenueSchedule.update({
          where: { id: live.id },
          data: {
            isBooked: true,
            bookedAt: live.dueDate,
            bookedVoucherId: live.id,
          },
        });
      });
      installmentsBooked++;
    } catch (e) {
      errors++;
      log.warn("failed to recognize deferred revenue", {
        rowId: row.id,
        tenantId: row.tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    rowsChecked: rows.length,
    installmentsBooked,
    errors,
  };
}
