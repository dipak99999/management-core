// Asset depreciation auto-book tick — walks every Depreciating Asset with
// unbooked AssetDepreciationSchedule rows whose dueDate has lapsed, and
// posts the DR Depreciation Expense / CR Accumulated Depreciation GL pair
// + marks the installment booked. Mirrors the `/assets/:id/book-depreciation`
// route body — the manual endpoint stays for admins who need to book
// ahead of schedule or catch up mid-tick with a specific postingDate.
//
// Idempotency: `isBooked` on the schedule row is the durable guard. Safe
// to double-fire on scheduler restart — already-booked rows are filtered
// at the query level.

import {
  Prisma,
  postGLEntries,
  prisma,
  withCrossTenant,
} from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("asset-depreciation");

export interface AssetDepreciationTickResult {
  assetsChecked: number;
  installmentsBooked: number;
  errors: number;
}

// Hard cap — a fresh scheduler restart after a long outage across many
// tenants shouldn't post thousands of GL entries in one tick. Subsequent
// ticks catch the tail.
const MAX_BOOKS_PER_TICK = 500;

export async function runAssetDepreciationTick(): Promise<AssetDepreciationTickResult> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Cross-tenant scan: any Depreciating asset with at least one unbooked
  // due installment. The include narrows to just those rows so we don't
  // over-fetch.
  const assets = await prisma.asset.findMany(
    withCrossTenant({
      where: {
        status: "Depreciating",
        schedule: {
          some: {
            isBooked: false,
            dueDate: { lte: today },
          },
        },
      },
      include: {
        category: {
          select: {
            depExpenseAccountId: true,
            accumDepreciationAccountId: true,
          },
        },
        schedule: {
          where: { isBooked: false, dueDate: { lte: today } },
          orderBy: { installmentNo: "asc" as const },
        },
      },
    }),
  );

  let installmentsBooked = 0;
  let errors = 0;

  for (const asset of assets) {
    if (installmentsBooked >= MAX_BOOKS_PER_TICK) break;

    // Missing category-level accounts → the asset can't be booked at all.
    // Skip with a warning rather than blocking the whole tick.
    if (
      !asset.category.depExpenseAccountId ||
      !asset.category.accumDepreciationAccountId
    ) {
      log.warn("skipped: asset category missing accounts", {
        assetCode: asset.assetCode,
        tenantId: asset.tenantId,
      });
      continue;
    }

    for (const inst of asset.schedule) {
      if (installmentsBooked >= MAX_BOOKS_PER_TICK) break;
      try {
        await prisma.$transaction(async (tx) => {
          // Re-read the installment under the tx to guard against the
          // manual /book-depreciation firing between the outer query and
          // this write. isBooked is the durable guard.
          const live = await tx.assetDepreciationSchedule.findUnique({
            where: { id: inst.id },
          });
          if (!live || live.isBooked) return;

          await postGLEntries(tx, {
            tenantId: asset.tenantId,
            postingDate: live.dueDate,
            voucherType: "AssetDepreciation",
            voucherId: live.id,
            voucherName: `${asset.assetCode}/${live.installmentNo}`,
            lines: [
              {
                accountId: asset.category.depExpenseAccountId!,
                debit: Number(live.amount),
                credit: 0,
                remarks: `Depreciation ${asset.assetName} inst ${live.installmentNo}`,
              },
              {
                accountId: asset.category.accumDepreciationAccountId!,
                debit: 0,
                credit: Number(live.amount),
              },
            ],
          });

          await tx.assetDepreciationSchedule.update({
            where: { id: live.id },
            data: {
              isBooked: true,
              bookedAt: live.dueDate,
              // Scheduler-booked rows carry a null bookedBy — the ledger
              // still shows who via GLEntry.createdBy (null → system).
              bookedBy: null,
            },
          });

          // Re-check + update from a fresh read so we don't drift when
          // the outer loop's cached `asset.currentValue` gets stale mid-tick.
          const remaining = await tx.assetDepreciationSchedule.count({
            where: { assetId: asset.id, isBooked: false },
          });
          const fresh = await tx.asset.findUnique({
            where: { id: asset.id },
            select: { currentValue: true, salvageValue: true },
          });
          if (!fresh) return;
          const cur = new Prisma.Decimal(fresh.currentValue).sub(live.amount);
          const salvage = new Prisma.Decimal(fresh.salvageValue);
          await tx.asset.update({
            where: { id: asset.id },
            data: {
              currentValue: cur.lt(salvage) ? salvage : cur,
              status: remaining === 0 ? "FullyDepreciated" : "Depreciating",
            },
          });
        });
        installmentsBooked++;
      } catch (e) {
        errors++;
        log.warn("failed to post depreciation installment", {
          assetCode: asset.assetCode,
          installmentNo: inst.installmentNo,
          tenantId: asset.tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return {
    assetsChecked: assets.length,
    installmentsBooked,
    errors,
  };
}
