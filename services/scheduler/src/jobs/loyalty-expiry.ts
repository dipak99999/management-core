// Loyalty expiry sweep — walks Earned LoyaltyPointEntry rows whose
// expiryDate has passed and materializes a matching Expired counter-entry
// for each. Two effects downstream:
//   1. The reporting queries that sum entryType-signed points no longer
//      overstate the customer's balance.
//   2. The balance endpoint's computeLoyaltyBalance ALREADY subtracts
//      expired-at-read-time Earned rows (belt-and-braces), but persisting
//      Expired rows keeps the ledger honest for exports / third-party
//      integrations that don't run the balance helper.
//
// Idempotency: we dedup by looking for an existing Expired row whose
// `remarks` encodes the source Earned id (the pattern
// `Auto-expired from earned entry <id>`). Safe to double-fire on
// scheduler restart.

import { prisma, expiredEntryPayload } from "@lumaara/db";
import { getLogger } from "@lumaara/service-auth";

const log = getLogger("loyalty-expiry");

export interface LoyaltyExpiryTickResult {
  entriesChecked: number;
  entriesExpired: number;
  errors: number;
}

// Cap so a long outage doesn't produce a million writes in one tick;
// subsequent ticks pick up the tail.
const MAX_EXPIRES_PER_TICK = 2000;

export async function runLoyaltyExpiryTick(): Promise<LoyaltyExpiryTickResult> {
  const now = new Date();

  // Only stale Earned rows with an expiryDate in the past. `take` is a
  // soft cap on top of MAX_EXPIRES_PER_TICK — Prisma won't blow past it.
  const stale = await prisma.loyaltyPointEntry.findMany({
    where: {
      entryType: "Earned",
      expiryDate: { lte: now, not: null },
    },
    take: MAX_EXPIRES_PER_TICK,
    orderBy: { expiryDate: "asc" },
  });

  let entriesExpired = 0;
  let errors = 0;

  for (const s of stale) {
    // Dedup — has an Expired counter-entry already been written for this
    // Earned id? The redemption remarks convention is set by
    // expiredEntryPayload; matching on the suffix keeps us robust to
    // future remark-prefix changes.
    const existing = await prisma.loyaltyPointEntry.findFirst({
      where: {
        tenantId: s.tenantId,
        customerId: s.customerId,
        entryType: "Expired",
        remarks: { contains: s.id },
      },
      select: { id: true },
    });
    if (existing) continue;

    try {
      const payload = expiredEntryPayload(s);
      await prisma.loyaltyPointEntry.create({
        data: {
          tenantId: s.tenantId,
          programId: s.programId,
          customerId: s.customerId,
          ...payload,
        },
      });
      entriesExpired++;
    } catch (e) {
      errors++;
      log.warn("failed to expire entry", {
        entryId: s.id,
        tenantId: s.tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { entriesChecked: stale.length, entriesExpired, errors };
}
