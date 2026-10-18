// Stock repost tick — picks up Queued RepostItemValuation rows and runs
// the SLE-chain recomputation inside a $transaction. Cross-tenant scan,
// one job per tick to keep transaction size bounded.
//
// Flow:
//   1. Grab oldest Queued row (FIFO — order matters when multiple reposts
//      for the same bin are queued back-to-back).
//   2. Flip to Processing (visible via /repost-item-valuations for the UI).
//   3. Inside $transaction:
//      a. Compute prior bin state by summing active SLEs BEFORE fromDate.
//      b. Load active SLEs AT/AFTER fromDate ordered by (postingDate,
//         createdAt).
//      c. Call recomputeSleChain — pure helper.
//      d. Write each SLE's new (qtyAfterTransaction, valuationRate,
//         stockValue).
//      e. Upsert the Bin with the final state.
//   4. Flip to Done with slesReposted count, or Failed with errorMessage.

import {
  Prisma,
  prisma,
  recomputeSleChain,
  withCrossTenant,
} from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("stock-repost");

export interface StockRepostTickResult {
  jobsChecked: number;
  jobsProcessed: number;
  errors: number;
}

export async function runStockRepostTick(): Promise<StockRepostTickResult> {
  // One job per tick — the transaction can be large (thousands of SLE
  // writes for a fast-moving bin). Better to process serially and let the
  // next tick pick up the next Queued row than to run several concurrent
  // reposts.
  const job = await prisma.repostItemValuation.findFirst(
    withCrossTenant({
      where: { status: "Queued" },
      orderBy: { createdAt: "asc" as const },
    }),
  );
  if (!job) return { jobsChecked: 0, jobsProcessed: 0, errors: 0 };

  await prisma.repostItemValuation.update({
    where: { id: job.id },
    data: { status: "Processing", startedAt: new Date() },
  });

  try {
    const slesReposted = await prisma.$transaction(async (tx) => {
      // Prior state — sum active SLEs strictly before fromDate.
      const priorAgg = await tx.stockLedgerEntry.findMany({
        where: {
          tenantId: job.tenantId,
          itemId: job.itemId,
          warehouseId: job.warehouseId,
          isCancelled: false,
          postingDate: { lt: job.fromDate },
        },
        orderBy: [{ postingDate: "asc" as const }, { createdAt: "asc" as const }],
      });
      // Roll the "prior" chain forward using the same rules as
      // recomputeSleChain to derive priorQty/priorRate/priorValue.
      // Reuses recomputeSleChain by treating prior as a mini-chain with
      // no starting state.
      const priorRoll = recomputeSleChain({
        priorQty: 0,
        priorRate: 0,
        priorValue: 0,
        activeSles: priorAgg.map((s) => ({
          id: s.id,
          actualQty: Number(s.actualQty),
          incomingRate: Number(s.incomingRate),
        })),
      });

      // Active SLEs at or after fromDate — the chain we actually update.
      const activeSles = await tx.stockLedgerEntry.findMany({
        where: {
          tenantId: job.tenantId,
          itemId: job.itemId,
          warehouseId: job.warehouseId,
          isCancelled: false,
          postingDate: { gte: job.fromDate },
        },
        orderBy: [{ postingDate: "asc" as const }, { createdAt: "asc" as const }],
      });

      const result = recomputeSleChain({
        priorQty: priorRoll.finalQty,
        priorRate: priorRoll.finalRate,
        priorValue: priorRoll.finalValue,
        activeSles: activeSles.map((s) => ({
          id: s.id,
          actualQty: Number(s.actualQty),
          incomingRate: Number(s.incomingRate),
        })),
      });

      // Write per-row snapshots. Loop-serial for a bounded write count;
      // updateMany can't accept per-row data, and Prisma has no batch
      // update-with-different-values shortcut.
      for (const u of result.updates) {
        await tx.stockLedgerEntry.update({
          where: { id: u.id },
          data: {
            qtyAfterTransaction: new Prisma.Decimal(u.qtyAfterTransaction),
            valuationRate: new Prisma.Decimal(u.valuationRate),
            stockValue: new Prisma.Decimal(u.stockValue),
          },
        });
      }

      // Final Bin snapshot.
      await tx.bin.upsert({
        where: {
          tenantId_itemId_warehouseId: {
            tenantId: job.tenantId,
            itemId: job.itemId,
            warehouseId: job.warehouseId,
          },
        },
        create: {
          tenantId: job.tenantId,
          itemId: job.itemId,
          warehouseId: job.warehouseId,
          actualQty: new Prisma.Decimal(result.finalQty),
          valuationRate: new Prisma.Decimal(result.finalRate),
          stockValue: new Prisma.Decimal(result.finalValue),
        },
        update: {
          actualQty: new Prisma.Decimal(result.finalQty),
          valuationRate: new Prisma.Decimal(result.finalRate),
          stockValue: new Prisma.Decimal(result.finalValue),
        },
      });

      return result.updates.length;
    });

    await prisma.repostItemValuation.update({
      where: { id: job.id },
      data: {
        status: "Done",
        completedAt: new Date(),
        slesReposted,
      },
    });
    return { jobsChecked: 1, jobsProcessed: 1, errors: 0 };
  } catch (e) {
    await prisma.repostItemValuation.update({
      where: { id: job.id },
      data: {
        status: "Failed",
        completedAt: new Date(),
        errorMessage: e instanceof Error ? e.message.slice(0, 2000) : String(e),
      },
    });
    log.warn("failed to repost stock", {
      jobId: job.id,
      tenantId: job.tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { jobsChecked: 1, jobsProcessed: 0, errors: 1 };
  }
}
